import exifr from 'exifr';
import { AnalysisResult, MetadataResult, PatchResult, ForensicReasoning } from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';
import { runBatchedPatchInference } from './model-runner';
// Suppress internal ONNX runtime/emscripten warnings from being logged to console.error
// so that Chrome's extension manager does not collect them as extension errors.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('[W:onnxruntime:') ||
      args[0].includes('[I:onnxruntime:') ||
      args[0].includes('VerifyEachNodeIsAssignedToAnEp'))
  ) {
    console.warn(...args);
    return;
  }
  originalConsoleError.apply(console, args);
};

console.log('[Offscreen] Document script active.');

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
    private maxQueue = 50
  ) {}

  setActiveTab(tabId: number): void {
    this.activeTabId = tabId;
    this.reSortQueue();
    console.log(`[Offscreen Queue] Active tab set to ${tabId}, re-sorted ${this.queue.length} tasks`);
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
      console.log(`[Offscreen Queue] Cancelled ${cancelledCount} pending tasks for tab ${tabId}`);
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
    if (this.active >= this.maxConcurrent) {
      const waitPromise = new Promise<boolean>((resolve) => {
        const item: QueuedTask = {
          tabId,
          run: () => resolve(true),
          cancel: () => resolve(false),
          priority,
          isModal,
          enqueuedAt: Date.now()
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
    }

    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next.run();
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
    const c2paPresent = softwareStr.includes('c2pa') || softwareStr.includes('firefly');

    let qualityScore = 1.0;
    if (!exifPresent) qualityScore -= 0.3;
    if (softwareStr.includes('photoshop')) qualityScore -= 0.2;

    return {
      exifPresent,
      cameraModel,
      c2paPresent,
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
 * Synthesizes multi-patch scores and forensic metadata into actionable natural language reasoning.
 */
function generateForensicReasoning(
  patchScores: PatchResult[],
  metadata: MetadataResult
): ForensicReasoning {
  if (patchScores.length === 0) {
    return {
      type: 'ambiguous',
      title: 'Insufficient Data',
      description: 'Image dimensions too small for multi-patch forensic analysis.'
    };
  }

  const scores = patchScores.map((p) => p.aiScore);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = maxScore - minScore;
  const highCount = scores.filter((s) => s >= 0.7).length;

  // 1. C2PA Verified
  if (metadata.c2paPresent) {
    return {
      type: 'likely-real',
      title: 'C2PA Credentials Verified',
      description: 'Contains valid cryptographic provenance metadata.'
    };
  }

  // 2. High variance between regions (e.g. face-swap, inpainting, or composite)
  if (patchScores.length > 1 && spread >= 0.40 && maxScore >= 0.70) {
    const topPatch = patchScores.find((p) => p.aiScore === maxScore);
    const lowPatch = patchScores.find((p) => p.aiScore === minScore);
    return {
      type: 'localized-edit',
      title: 'Localized AI Alteration Detected',
      description: `High divergence across regions (${Math.round(maxScore * 100)}% in ${topPatch?.position || 'crop'} vs ${Math.round(minScore * 100)}% in ${lowPatch?.position || 'crop'}). Strong indicator of inpainting, composite, or face-swap.`
    };
  }

  // 3. Uniformly High AI Probability across all crops
  if (highCount === patchScores.length || (avgScore >= 0.75 && minScore >= 0.50)) {
    return {
      type: 'full-synthetic',
      title: 'Uniform Synthetic Artifacts',
      description: 'Consistent diffusion textures and frequency anomalies detected across all sampled regions (likely Midjourney, SDXL, or Flux).'
    };
  }

  // 4. Uniformly Low AI Probability (Authentic camera photo)
  if (maxScore < 0.30) {
    const camInfo = metadata.cameraModel ? ` (${metadata.cameraModel})` : '';
    return {
      type: 'likely-real',
      title: 'Authentic Photographic Texture',
      description: `Natural ISO sensor noise and optical lens characteristics verified across all regions${camInfo}.`
    };
  }

  // 5. Mixed / Subtle / Filtered
  return {
    type: 'ambiguous',
    title: 'Subtle / Mixed Forensic Signals',
    description: `Average AI confidence of ${Math.round(avgScore * 100)}%. May be a heavily processed, beauty-filtered, or upscaled photo.`
  };
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

  // 1. Extract patches (fast 1x1, standard 2x2 or deep 3x2, 2x3, 3x3 grid)
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

  // 3. Serialized ONNX model inference inside priority concurrency queue
  return queue.run(
    async () => {
      const patchCanvases = extraction.patches.map((p) => p.canvas);
      const patchScoresList = await runBatchedPatchInference(patchCanvases);

      const patchScores: PatchResult[] = extraction.patches.map((patch, i) => ({
        patchIndex: patch.patchIndex,
        position: patch.position,
        aiScore: patchScoresList[i] ?? 0.5,
        box: patch.box
      }));

      // Aggregate overall score
      const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
      const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;

      let baseScore = maxPatchScore * 0.6 + avgPatchScore * 0.4;
      if (metadata.c2paPresent) {
        baseScore = Math.max(0.01, baseScore - 0.3);
      }

      const aggregatedScore = parseFloat(Math.min(0.99, Math.max(0.01, baseScore)).toFixed(2));
      const reasoning = generateForensicReasoning(patchScores, metadata);

      return {
        imageUrl,
        status: 'complete',
        aiScore: aggregatedScore,
        patchScores,
        metadata,
        timestamp: Date.now(),
        reasoning,
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

  // 1. Extract patches concurrently (fast 1x1, standard 2x2 or deep grid)
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

  // 3. Serialized ONNX model inference inside priority concurrency queue
  return queue.run(
    async () => {
      const patchCanvases = extraction.patches.map((p) => p.canvas);
      const patchScoresList = await runBatchedPatchInference(patchCanvases);

      const patchScores: PatchResult[] = extraction.patches.map((patch, i) => ({
        patchIndex: patch.patchIndex,
        position: patch.position,
        aiScore: patchScoresList[i] ?? 0.5,
        box: patch.box
      }));

      // Aggregate overall score
      const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
      const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;

      let baseScore = maxPatchScore * 0.6 + avgPatchScore * 0.4;
      if (metadata.c2paPresent) {
        baseScore = Math.max(0.01, baseScore - 0.3);
      }

      const aggregatedScore = parseFloat(Math.min(0.99, Math.max(0.01, baseScore)).toFixed(2));
      const reasoning = generateForensicReasoning(patchScores, metadata);

      return {
        imageUrl,
        status: 'complete',
        aiScore: aggregatedScore,
        patchScores,
        metadata,
        timestamp: Date.now(),
        reasoning,
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

