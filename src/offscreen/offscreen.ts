import exifr from 'exifr';
import { AnalysisResult, MetadataResult, PatchResult } from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';
import { runPatchInference } from './model-runner';

console.log('[Offscreen] Document script active.');

interface QueuedTask {
  run: () => void;
  cancel: () => void;
  priority: 'high' | 'normal';
  isModal: boolean;
}

// Queue concurrency limiter with priority queueing and graceful cancellation
class PriorityConcurrencyQueue {
  private active = 0;
  private queue: QueuedTask[] = [];

  constructor(private maxConcurrent = 1) {}

  async run<T>(
    task: () => Promise<T>,
    priority: 'high' | 'normal' = 'normal',
    isModal = false
  ): Promise<T | null> {
    if (this.active >= this.maxConcurrent) {
      const waitPromise = new Promise<boolean>((resolve) => {
        const item: QueuedTask = {
          run: () => resolve(true),
          cancel: () => resolve(false),
          priority,
          isModal
        };
        if (priority === 'high' || isModal) {
          // Jump to the front of the queue
          this.queue.unshift(item);
        } else {
          this.queue.push(item);
        }
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

// Process an incoming image array buffer
async function processImageBuffer(
  imageUrl: string,
  buffer: number[],
  contentType = 'image/jpeg',
  priority: 'high' | 'normal' = 'normal',
  isModal = false,
  sampleCount: 4 | 9 = 4
): Promise<AnalysisResult | null> {
  return queue.run(
    async () => {
      const uint8Array = new Uint8Array(buffer);
      const blob = new Blob([uint8Array], { type: contentType });

      // 1. Extract patches (single crop for <448px, 4 crops, or 9 crops for large images)
      const extraction = await extractRuleOfThirdsPatches(blob, 224, sampleCount);

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
          supports9Samples: false,
          sampleMode: sampleCount,
          imageWidth: extraction.width,
          imageHeight: extraction.height,
          error: 'Image too small (<224x224)'
        };
      }

      // 3. Compute patch scores via ONNX Runtime Web
      const patchScores: PatchResult[] = [];
      for (const patch of extraction.patches) {
        const aiScore = await runPatchInference(patch.canvas);
        patchScores.push({
          patchIndex: patch.patchIndex,
          position: patch.position,
          aiScore,
          box: patch.box
        });
      }

      // Aggregate overall score
      const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
      const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;

      let baseScore = maxPatchScore * 0.6 + avgPatchScore * 0.4;
      if (metadata.c2paPresent) {
        baseScore = Math.max(0.01, baseScore - 0.3);
      }

      const aggregatedScore = parseFloat(Math.min(0.99, Math.max(0.01, baseScore)).toFixed(2));

      return {
        imageUrl,
        status: 'complete',
        aiScore: aggregatedScore,
        patchScores,
        metadata,
        timestamp: Date.now(),
        supports9Samples: extraction.supports9Samples,
        sampleMode: extraction.sampleMode,
        imageWidth: extraction.width,
        imageHeight: extraction.height
      };
    },
    priority,
    isModal
  );
}

// Listen for background service worker requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PROCESS_IMAGE_BUFFER') {
    processImageBuffer(
      message.imageUrl,
      message.buffer,
      message.contentType,
      message.priority || 'normal',
      message.isModal || false,
      message.sampleCount || 4
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
