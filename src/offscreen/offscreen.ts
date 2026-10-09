import exifr from 'exifr';
import {
  AnalysisResult,
  MetadataResult,
  PatchResult,
  PatchBox,
  ExtensionMessage
} from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';
import { runBatchedPatchInference } from './model-runner';
import { analyzeSystem1 } from './system1-analyzer';
import { detectPatchPeriodicity } from './media-detector';
import { fuseDecision } from './decision-engine';
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



// In-memory cache for evaluated patch scores keyed by imageUrl and normalized box coordinates.
// Ensures that center patches evaluated in Fast mode are reused directly when upgrading to Standard or Deep mode,
// and previously evaluated Standard patches are preserved when Deep mode runs.
const imagePatchScoreCache = new Map<string, Map<string, number>>();
const MAX_CACHED_IMAGES = 60;

function getPatchCacheKey(box?: PatchBox): string {
  if (!box) return '0_0_0_0';
  return `${Math.round(box.x * 1000)}_${Math.round(box.y * 1000)}_${Math.round(box.width * 1000)}_${Math.round(box.height * 1000)}`;
}

function getCachedPatchScore(imageUrl: string, box?: PatchBox): number | undefined {
  const map = imagePatchScoreCache.get(imageUrl);
  if (!map) return undefined;
  return map.get(getPatchCacheKey(box));
}

function setCachedPatchScore(imageUrl: string, box: PatchBox | undefined, score: number): void {
  let map = imagePatchScoreCache.get(imageUrl);
  if (!map) {
    if (imagePatchScoreCache.size >= MAX_CACHED_IMAGES) {
      const oldestKey = imagePatchScoreCache.keys().next().value;
      if (oldestKey) imagePatchScoreCache.delete(oldestKey);
    }
    map = new Map<string, number>();
    imagePatchScoreCache.set(imageUrl, map);
  }
  map.set(getPatchCacheKey(box), score);
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

  // 3. Ultra-fast System 1 Triage (<5ms)
  const system1 = analyzeSystem1(extraction.width, extraction.height, metadata, extraction.patches);
  const mediaType = system1.mediaType;

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

  // 4. Immediately broadcast progressive System 1 preliminary result to background/tabs
  try {
    chrome.runtime.sendMessage({
      type: 'IMAGE_PRELIMINARY_RESULT',
      imageUrl,
      system1,
      tabId
    } as ExtensionMessage).catch(() => {});
  } catch (e) {}

  // 5. Check if System 1 can bypass expensive System 2 neural scan
  // (e.g. cryptographically signed C2PA, provenance-flagged AI, or trivial flat vector UI)
  if (system1.canBypassSystem2 && !isModal && sampleMode !== 'deep') {
    const fused = fuseDecision(system1, [], metadata);
    return {
      imageUrl,
      status: 'complete',
      aiScore: fused.aiScore,
      patchScores: fused.patchScores,
      metadata,
      timestamp: Date.now(),
      reasoning: fused.reasoning,
      mediaType,
      system1,
      supportsDeepSampling: extraction.supportsDeepSampling,
      deepGrid: extraction.deepGrid,
      currentGrid: extraction.currentGrid,
      sampleMode: extraction.sampleMode,
      imageWidth: extraction.width,
      imageHeight: extraction.height
    };
  }

  // 6. Serialized ONNX System 2 neural model inference inside priority concurrency queue
  return queue.run(
    async () => {
      // Check cache for already evaluated patches (e.g. Center patch from fast mode or standard mode)
      const uncomputedPatches: { index: number; canvas: HTMLCanvasElement }[] = [];
      const patchScoresList: number[] = new Array(extraction.patches.length);

      extraction.patches.forEach((p, i) => {
        const cached = getCachedPatchScore(imageUrl, p.box);
        if (cached !== undefined) {
          patchScoresList[i] = cached;
        } else {
          uncomputedPatches.push({ index: i, canvas: p.canvas });
        }
      });

      if (uncomputedPatches.length > 0) {
        const uncomputedScores = await runBatchedPatchInference(uncomputedPatches.map((u) => u.canvas));
        uncomputedPatches.forEach((u, j) => {
          const score = uncomputedScores[j] ?? 0.5;
          patchScoresList[u.index] = score;
          setCachedPatchScore(imageUrl, extraction.patches[u.index].box, score);
        });
      }

      const rawPatchScores: PatchResult[] = extraction.patches.map((patch, i) => {
        const periodicity = detectPatchPeriodicity(patch.canvas);
        return {
          patchIndex: patch.patchIndex,
          position: patch.position,
          aiScore: patchScoresList[i] ?? 0.5,
          box: patch.box,
          hasPattern: periodicity.hasRepetitivePattern,
          patternPeriodicity: periodicity.patternPeriodicity
        };
      });

      // Retrieve any OTHER previously evaluated patches for this image from cache
      // (e.g. the 4 Rule-of-Thirds power points if upgrading from Standard to Deep)
      // so the Bayesian Decision Engine preserves all unique spatial observations across the canvas!
      const allEvaluatedPatches: PatchResult[] = [...rawPatchScores];
      const cachedMap = imagePatchScoreCache.get(imageUrl);
      if (cachedMap && extraction.sampleMode === 'deep') {
        const currentKeys = new Set(rawPatchScores.map((p) => getPatchCacheKey(p.box)));
        let extraIdx = rawPatchScores.length;
        cachedMap.forEach((score, key) => {
          if (!currentKeys.has(key)) {
            const [x, y, w, h] = key.split('_').map((n) => Number(n) / 1000);
            allEvaluatedPatches.push({
              patchIndex: extraIdx++,
              position: `Sample #${extraIdx}`,
              aiScore: score,
              box: { x, y, width: w, height: h }
            });
          }
        });
      }

      // 7. System 1 + System 2 Decision & Evidence Fusion
      const fused = fuseDecision(system1, allEvaluatedPatches, metadata);

      return {
        imageUrl,
        status: 'complete',
        aiScore: fused.aiScore,
        patchScores: rawPatchScores,
        metadata,
        timestamp: Date.now(),
        reasoning: fused.reasoning,
        mediaType,
        system1,
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

