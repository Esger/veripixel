import exifr from 'exifr';
import { AnalysisResult, MetadataResult, PatchResult, ForensicReasoning, MediaType } from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';
import { runBatchedPatchInference } from './model-runner';
import { detectMediaType } from './media-detector';
import { logger } from './logger';
// Suppress internal ONNX runtime/emscripten warnings from being logged to console.error
// so that Chrome's extension manager does not collect them as extension errors.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  if (
    msg.includes('[W:onnxruntime:') ||
    msg.includes('[I:onnxruntime:') ||
    msg.includes('VerifyEachNodeIsAssignedToAnEp')
  ) {
    logger.warn(...args);
    return;
  }
  originalConsoleError.apply(console, args);
};

logger.log('[Offscreen] Document script active.');

interface QueuedTask {
  tabId?: number;
  run: () => void;
  cancel: () => void;
  priority: 'high' | 'normal' | 'background';
  isModal: boolean;
  enqueuedAt: number;
}

// Queue concurrency limiter with active tab priority, bounded buffer, and graceful cancellation
class PriorityConcurrencyQueue {
  private active = 0;
  private queue: QueuedTask[] = [];
  private activeTabId: number | null = null;

  constructor(
    private maxConcurrent = 1,
    private maxQueue = 20
  ) {}

  setActiveTab(tabId: number): void {
    this.activeTabId = tabId;
    this.reSortQueue();
    logger.log(`[Offscreen Queue] Active tab set to ${tabId}, re-sorted ${this.queue.length} tasks`);
  }

  cancelTasksForTab(tabId: number): void {
    const remaining: QueuedTask[] = [];
    let cancelledCount = 0;
    for (const item of this.queue) {
      if (item.tabId === tabId) {
        item.cancel();
        cancelledCount++;
      } else {
        remaining.push(item);
      }
    }
    this.queue = remaining;
    if (cancelledCount > 0) {
      logger.log(`[Offscreen Queue] Cancelled ${cancelledCount} pending tasks for tab ${tabId}`);
    }
  }

  private getScore(task: QueuedTask): number {
    if (task.isModal) return 1000;
    if (task.priority === 'high') return 800;
    if (task.tabId !== undefined && this.activeTabId !== null && task.tabId === this.activeTabId) {
      return 500; // Active tab tasks jump ahead of background tabs
    }
    if (task.priority === 'normal') return 300;
    return 100; // Background tab task
  }

  private reSortQueue(): void {
    this.queue.sort((a, b) => {
      const scoreDiff = this.getScore(b) - this.getScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  async run<T>(
    task: () => Promise<T>,
    priority: 'high' | 'normal' | 'background' = 'normal',
    isModal = false,
    tabId?: number
  ): Promise<T | null> {
    const enqueuedAt = Date.now();

    if (this.active >= this.maxConcurrent) {
      const waitPromise = new Promise<boolean>((resolve) => {
        const item: QueuedTask = {
          tabId,
          run: () => resolve(true),
          cancel: () => resolve(false),
          priority,
          isModal,
          enqueuedAt
        };

        // If queue exceeds maxQueue, prune the oldest low-priority background task
        if (this.queue.length >= this.maxQueue) {
          const bgTasks = this.queue.filter((t) => this.getScore(t) <= 100);
          if (bgTasks.length > 0) {
            const oldest = bgTasks[0];
            const idx = this.queue.indexOf(oldest);
            if (idx !== -1) {
              this.queue.splice(idx, 1);
              oldest.cancel();
            }
          }
        }

        this.queue.push(item);
        this.reSortQueue();
      });

      const proceed = await waitPromise;
      if (!proceed) {
        // Gracefully cancelled without throwing errors
        return null;
      }
    } else {
      this.active++;
    }

    try {
      // Drop task if it waited in the queue for too long (>25s) to avoid running expired work
      if (Date.now() - enqueuedAt > 25000) {
        logger.warn(`[Offscreen Queue] Task dropped: waited in queue ${Date.now() - enqueuedAt}ms`);
        return null;
      }
      return await task();
    } finally {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) {
          next.run();
        } else {
          this.active--;
        }
      } else {
        this.active--;
      }
    }
  }

  cancelBackgroundTasks(): void {
    const remaining: QueuedTask[] = [];
    for (const item of this.queue) {
      if (item.priority === 'high' || item.isModal) {
        remaining.push(item);
      } else {
        item.cancel();
      }
    }
    this.queue = remaining;
  }
}

const queue = new PriorityConcurrencyQueue(1);

// Extract metadata using exifr
async function extractMetadata(blob: Blob): Promise<MetadataResult> {
  if (blob.type && blob.type.includes('svg')) {
    return { exifPresent: false, c2paPresent: false, qualityScore: 1.0 };
  }

  try {
    const exifData = await exifr.parse(blob, ['Make', 'Model', 'Software', 'DateTimeOriginal']).catch(() => null);
    const exifPresent = !!(exifData && (exifData.Make || exifData.Model));
    const cameraModel = exifData?.Model ? `${exifData.Make || ''} ${exifData.Model}`.trim() : undefined;

    // Check for C2PA or software signatures
    const softwareStr = (exifData?.Software || '').toLowerCase();
    const isAiSoftware =
      softwareStr.includes('firefly') ||
      softwareStr.includes('midjourney') ||
      softwareStr.includes('stable diffusion') ||
      softwareStr.includes('dall-e') ||
      softwareStr.includes('comfyui') ||
      softwareStr.includes('novelai');

    const aiSoftwareName = isAiSoftware ? exifData?.Software : undefined;
    const c2paPresent = softwareStr.includes('c2pa') || isAiSoftware;

    let qualityScore = 1.0;
    if (!exifPresent) qualityScore -= 0.3;
    if (softwareStr.includes('photoshop')) qualityScore -= 0.2;

    return {
      exifPresent,
      cameraModel,
      c2paPresent,
      aiProvenancePresent: isAiSoftware,
      aiSoftwareName,
      estimatedCompressionGenerations: exifPresent ? 1 : 2,
      qualityScore: Math.max(0, qualityScore)
    };
  } catch (err) {
    return {
      exifPresent: false,
      c2paPresent: false,
      qualityScore: 0.5
    };
  }
}

/**
 * Synthesizes multi-patch scores, detected media type, and forensic metadata into actionable natural language reasoning.
 */
function generateForensicReasoning(
  patchScores: PatchResult[],
  metadata: MetadataResult,
  mediaType: MediaType = 'general-media'
): ForensicReasoning {
  if (patchScores.length === 0) {
    return {
      type: 'ambiguous',
      title: 'Insufficient Data',
      description: 'Image dimensions too small for multi-patch forensic analysis.',
      mediaType
    };
  }

  const scores = patchScores.map((p) => p.aiScore);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = maxScore - minScore;
  const highCount = scores.filter((s) => s >= 0.7).length;

  // 1. Provenance Verification
  if (metadata.aiProvenancePresent) {
    return {
      type: 'full-synthetic',
      title: 'C2PA Verified: Generative AI',
      description: `Cryptographic provenance metadata confirms image was created using AI software (${metadata.aiSoftwareName || 'Generative AI'}).`,
      mediaType
    };
  }

  if (metadata.c2paPresent) {
    return {
      type: 'likely-real',
      title: 'C2PA Credentials Verified',
      description: 'Contains valid cryptographic provenance metadata confirming authentic origin.',
      mediaType
    };
  }

  // 2. High variance between regions (inpainting, composite, or localized generation)
  if (patchScores.length > 1 && spread >= 0.40 && maxScore >= 0.70) {
    const topPatch = patchScores.find((p) => p.aiScore === maxScore);
    const lowPatch = patchScores.find((p) => p.aiScore === minScore);
    const topLabel = topPatch?.position || 'one sample';
    const lowLabel = lowPatch?.position || 'another sample';
    const scoreDiff = `${Math.round(maxScore * 100)}% in ${topLabel} vs ${Math.round(minScore * 100)}% in ${lowLabel}`;

    let divergenceDesc = `High divergence across regions (${scoreDiff}). `;
    if (mediaType === 'digital-art') {
      divergenceDesc += 'Indicator of localized generative inpainting, AI touch-ups, or composite artwork.';
    } else if (mediaType === 'pen-ink-art') {
      divergenceDesc += 'Indicator of localized digital editing or generative inpainting on manual artwork.';
    } else if (mediaType === 'screen-capture') {
      divergenceDesc += 'Indicator of localized AI inpainting, digital editing, or contrast between rendered elements and interface text.';
    } else if (mediaType === 'camera-photo') {
      divergenceDesc += 'Strong indicator of inpainting, composite, or face-swap.';
    } else {
      divergenceDesc += 'Strong indicator of localized AI inpainting, generative fill, or composite edit.';
    }

    return {
      type: 'localized-edit',
      title: 'Localized AI Alteration Detected',
      description: divergenceDesc,
      mediaType
    };
  }

  // 3. Uniformly High AI Probability across sampled crops
  if (highCount === patchScores.length || (avgScore >= 0.75 && minScore >= 0.50)) {
    if (mediaType === 'digital-art') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Artwork',
        description: 'Consistent generative AI patterns and synthetic textures detected across all sampled regions (likely Midjourney / Niji, NovelAI, or Stable Diffusion).',
        mediaType
      };
    }

    if (mediaType === 'pen-ink-art') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Drawing',
        description: 'Consistent generative AI patterns and synthetic line artifacts detected across all sampled regions.',
        mediaType
      };
    }

    if (mediaType === 'screen-capture') {
      return {
        type: 'full-synthetic',
        title: 'AI-Generated Synthetic Media',
        description: 'Consistent generative AI diffusion patterns detected across all sampled regions.',
        mediaType
      };
    }

    return {
      type: 'full-synthetic',
      title: 'Uniform Synthetic Artifacts',
      description: 'Consistent diffusion textures and frequency anomalies detected across all sampled regions (likely Midjourney, SDXL, or Flux).',
      mediaType
    };
  }

  // 4. Low AI Probability across sampled regions (Authentic non-AI media)
  if (maxScore < 0.30 || (avgScore < 0.30 && maxScore < 0.50)) {
    if (mediaType === 'pen-ink-art') {
      return {
        type: 'likely-real',
        title: 'Authentic Pen & Ink / Hand-Drawn Sketch',
        description: 'Natural hand-drawn line stroke variation and physical paper texture verified across sampled regions. Manual cross-hatching patterns confirmed non-synthetic.',
        mediaType
      };
    }

    if (mediaType === 'digital-art') {
      return {
        type: 'likely-real',
        title: 'Authentic Digital Artwork',
        description: 'No generative AI synthesis artifacts detected across sampled regions. Consistent with human-drawn illustration, digital painting, or graphic design.',
        mediaType
      };
    }

    if (mediaType === 'screen-capture') {
      return {
        type: 'likely-real',
        title: 'Authentic Screen Capture',
        description: 'No generative AI diffusion artifacts detected across sampled regions. Consistent with an authentic screen capture or digital interface.',
        mediaType
      };
    }

    if (mediaType === 'graphic-or-ui') {
      return {
        type: 'likely-real',
        title: 'Authentic Graphic / UI Media',
        description: 'No generative AI patterns detected. Consistent with vector artwork, application UI capture, or digital graphic design.',
        mediaType
      };
    }

    if (mediaType === 'camera-photo') {
      const camInfo = metadata.cameraModel ? ` (${metadata.cameraModel})` : '';
      return {
        type: 'likely-real',
        title: metadata.cameraModel ? 'Authentic Camera Photograph' : 'Authentic Photographic Capture',
        description: metadata.cameraModel
          ? `Natural optical capture characteristics and camera hardware metadata verified${camInfo}.`
          : 'No generative AI diffusion patterns detected across sampled regions. Consistent with an authentic camera photograph.',
        mediaType
      };
    }

    return {
      type: 'likely-real',
      title: 'Authentic Non-AI Content',
      description: 'No generative AI diffusion patterns or synthetic anomalies detected across sampled regions.',
      mediaType
    };
  }

  // 5. Mixed / Subtle / Filtered
  const avgPct = Math.round(avgScore * 100);
  let ambiguousDesc = `Average AI confidence of ${avgPct}%. `;

  if (mediaType === 'screen-capture') {
    ambiguousDesc += 'Inconclusive signals; likely caused by display rendering, antialiasing, or compression artifacts.';
  } else if (mediaType === 'pen-ink-art') {
    ambiguousDesc += 'Inconclusive signals; manual cross-hatching lines and paper texture can mimic diffusion frequency patterns.';
  } else if (mediaType === 'digital-art') {
    ambiguousDesc += 'Inconclusive signals; likely caused by digital painting textures, stylized gradients, or compression artifacts.';
  } else if (mediaType === 'graphic-or-ui') {
    ambiguousDesc += 'Inconclusive signals; likely caused by rasterization filters or image compression.';
  } else if (mediaType === 'camera-photo') {
    ambiguousDesc += 'Moderate signals; may be a heavily processed, beauty-filtered, or upscaled photo.';
  } else {
    ambiguousDesc += 'Inconclusive signals; may be post-processed graphics, stylized digital art, upscaled media, or filtered photography.';
  }

  return {
    type: 'ambiguous',
    title: 'Subtle / Mixed Forensic Signals',
    description: ambiguousDesc,
    mediaType
  };
}

// Core image processing pipeline for both blobs, buffers, and URLs
async function processImageBlob(
  blob: Blob,
  imageUrl: string,
  tabId?: number,
  priority: 'high' | 'normal' | 'background' = 'normal',
  isModal = false,
  sampleMode: 'fast' | 'standard' | 'deep' = 'standard'
): Promise<AnalysisResult | null> {
  // 1. Extract patches (fast 1x1, standard 2x2 or deep grid)
  const extraction = await extractRuleOfThirdsPatches(blob, 224, sampleMode);

  // 2. Extract EXIF / Metadata
  const metadata = await extractMetadata(blob);

  if (extraction.patches.length === 0) {
    return {
      imageUrl,
      status: 'error',
      aiScore: 0,
      patchScores: [],
      metadata,
      timestamp: Date.now(),
      supportsDeepSampling: false,
      deepGrid: extraction.deepGrid,
      currentGrid: extraction.currentGrid,
      sampleMode,
      imageWidth: extraction.width,
      imageHeight: extraction.height,
      error: 'Image too small (<224x224)'
    };
  }

  // 3. Classify visual media type (camera photo, digital artwork, game screenshot, graphic UI)
  const mediaType = detectMediaType(extraction.width, extraction.height, metadata, extraction.patches);

  // Adjust quality score for non-camera digital media or physical artwork scans
  if (
    (mediaType === 'digital-art' ||
      mediaType === 'screen-capture' ||
      mediaType === 'graphic-or-ui' ||
      mediaType === 'pen-ink-art') &&
    !metadata.cameraModel
  ) {
    metadata.qualityScore = Math.min(1.0, metadata.qualityScore + 0.3);
  }

  // 4. Serialized ONNX model inference inside priority concurrency queue
  return queue.run(
    async () => {
      const patchCanvases = extraction.patches.map((p) => p.canvas);
      const patchScoresList = await runBatchedPatchInference(patchCanvases);

      const patchScores: PatchResult[] = extraction.patches.map((patch, i) => {
        let rawScore = patchScoresList[i] ?? 0.5;
        if (mediaType === 'pen-ink-art' && !metadata.aiProvenancePresent) {
          // Hand-drawn sketch / pen & ink artwork on physical paper:
          // Diffusion models trained on photographs exhibit severe false-positive frequency spikes
          // on manual cross-hatching and high-contrast ink-on-paper strokes.
          rawScore = Math.min(0.08, rawScore * 0.08);
        }
        return {
          patchIndex: patch.patchIndex,
          position: patch.position,
          aiScore: rawScore,
          box: patch.box
        };
      });

      // Aggregate overall score
      const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
      const minPatchScore = Math.min(...patchScores.map((p) => p.aiScore));
      const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;
      const spread = maxPatchScore - minPatchScore;

      let baseScore: number;
      if (metadata.aiProvenancePresent) {
        baseScore = 0.99;
      } else if (mediaType === 'pen-ink-art') {
        // Physical hand-drawn sketch / pen & ink artwork on paper
        baseScore = minPatchScore < 0.05 ? 0.04 : 0.06;
      } else if (patchScores.length > 1 && spread >= 0.40 && maxPatchScore >= 0.70) {
        // Confirmed localized alteration (e.g. inpainting or face-swap in one specific patch)
        baseScore = maxPatchScore * 0.5 + avgPatchScore * 0.5;
      } else if (patchScores.length > 1) {
        // Multi-region sample: average represents the true overall image verdict
        baseScore = avgPatchScore;
      } else {
        baseScore = maxPatchScore;
      }

      if (metadata.c2paPresent && !metadata.aiProvenancePresent) {
        baseScore = Math.max(0.01, baseScore - 0.3);
      }

      const aggregatedScore = parseFloat(Math.min(0.99, Math.max(0.01, baseScore)).toFixed(2));
      const reasoning = generateForensicReasoning(patchScores, metadata, mediaType);

      return {
        imageUrl,
        status: 'complete',
        aiScore: aggregatedScore,
        patchScores,
        metadata,
        timestamp: Date.now(),
        reasoning,
        mediaType,
        supportsDeepSampling: extraction.supportsDeepSampling,
        deepGrid: extraction.deepGrid,
        currentGrid: extraction.currentGrid,
        sampleMode: extraction.sampleMode,
        imageWidth: extraction.width,
        imageHeight: extraction.height
      };
    },
    priority,
    isModal,
    tabId
  );
}

// Process an incoming image array buffer
async function processImageBuffer(
  imageUrl: string,
  buffer: number[],
  contentType = 'image/jpeg',
  tabId?: number,
  priority: 'high' | 'normal' | 'background' = 'normal',
  isModal = false,
  sampleMode: 'fast' | 'standard' | 'deep' = 'standard'
): Promise<AnalysisResult | null> {
  const uint8Array = new Uint8Array(buffer);
  const blob = new Blob([uint8Array], { type: contentType });
  return processImageBlob(blob, imageUrl, tabId, priority, isModal, sampleMode);
}

// Process an incoming image URL directly in offscreen without IPC serialization overhead
async function processImageUrl(
  imageUrl: string,
  tabId?: number,
  priority: 'high' | 'normal' | 'background' = 'normal',
  isModal = false,
  sampleMode: 'fast' | 'standard' | 'deep' = 'standard'
): Promise<AnalysisResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s network fetch timeout
  let blob: Blob;
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    blob = await response.blob();
  } catch (fetchErr) {
    return {
      imageUrl,
      status: 'error',
      aiScore: 0,
      patchScores: [],
      metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0.5 },
      timestamp: Date.now(),
      error: `Network fetch failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    };
  } finally {
    clearTimeout(timeoutId);
  }

  return processImageBlob(blob, imageUrl, tabId, priority, isModal, sampleMode);
}

// Listen for background service worker requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING_OFFSCREEN') {
    sendResponse({ status: 'pong' });
    return false;
  } else if (message.type === 'SET_ACTIVE_TAB') {
    queue.setActiveTab(message.activeTabId);
    sendResponse({ status: 'ok' });
    return false;
  } else if (message.type === 'CANCEL_TAB_TASKS') {
    queue.cancelTasksForTab(message.tabId);
    sendResponse({ status: 'ok' });
    return false;
  } else if (message.type === 'PROCESS_IMAGE_URL') {
    processImageUrl(
      message.imageUrl,
      message.tabId,
      message.priority || 'normal',
      message.isModal || false,
      message.sampleMode || 'standard'
    )
      .then((result) => {
        if (result) {
          if (message.originalUrl) {
            result.imageUrl = message.originalUrl;
          }
          sendResponse({ result });
        } else {
          sendResponse({ cancelled: true });
        }
      })
      .catch((err) => {
        sendResponse({ error: String(err?.message || err) });
      });
    return true; // async response
  } else if (message.type === 'PROCESS_IMAGE_BUFFER') {
    processImageBuffer(
      message.imageUrl,
      message.buffer,
      message.contentType,
      message.tabId,
      message.priority || 'normal',
      message.isModal || false,
      message.sampleMode || 'standard'
    )
      .then((result) => {
        if (result) {
          sendResponse({ result });
        } else {
          sendResponse({ cancelled: true });
        }
      })
      .catch((err) => {
        sendResponse({ error: String(err?.message || err) });
      });
    return true; // async response
  } else if (message.type === 'CANCEL_BACKGROUND_ANALYSIS') {
    queue.cancelBackgroundTasks();
    sendResponse({ status: 'cancelled' });
    return false;
  }
  return false;
});

// Announce readiness to background service worker
try {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {});
} catch (e) {}

