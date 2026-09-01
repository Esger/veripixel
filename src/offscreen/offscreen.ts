import exifr from 'exifr';
import { AnalysisResult, MetadataResult, PatchResult } from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';

console.log('[Offscreen] Document script active.');

// Queue concurrency limiter (max 2 parallel inference tasks)
class ConcurrencyQueue {
  private active = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private maxConcurrent = 2) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push(async () => resolve());
      });
    }

    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }
}

const queue = new ConcurrencyQueue(2);

// Extract metadata using exifr
async function extractMetadata(blob: Blob): Promise<MetadataResult> {
  try {
    const exifData = await exifr.parse(blob, ['Make', 'Model', 'Software', 'DateTimeOriginal']);
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
async function processImageBuffer(imageUrl: string, buffer: number[]): Promise<AnalysisResult> {
  return queue.run(async () => {
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array]);

    // 1. Extract 4 patches on rule-of-thirds grid
    const patches = await extractRuleOfThirdsPatches(blob, 224);

    // 2. Extract EXIF / Metadata
    const metadata = await extractMetadata(blob);

    // 3. Compute patch scores (placeholder for ONNX model inference pass in Phase 2)
    // For skeleton testing: perform heuristic analysis based on patch variance & EXIF presence
    const patchScores: PatchResult[] = patches.map((patch) => {
      // Calculate basic canvas pixel variance as test heuristic
      const ctx = patch.canvas.getContext('2d');
      let aiScore = 0.15; // default low probability
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, patch.canvas.width, patch.canvas.height);
        let sum = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
          sum += imgData.data[i];
        }
        const avg = sum / (imgData.data.length / 4);
        // Slight variation per patch
        aiScore = (avg % 100) / 200 + (metadata.exifPresent ? 0.05 : 0.2);
      }

      return {
        patchIndex: patch.patchIndex,
        position: patch.position,
        aiScore: Math.min(0.99, Math.max(0.01, aiScore))
      };
    });

    // Aggregate overall score (max score among patches + metadata factor)
    const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
    const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;
    const aggregatedScore = parseFloat((maxPatchScore * 0.6 + avgPatchScore * 0.4).toFixed(2));

    return {
      imageUrl,
      status: 'complete',
      aiScore: aggregatedScore,
      patchScores,
      metadata,
      timestamp: Date.now()
    };
  });
}

// Listen for background service worker requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PROCESS_IMAGE_BUFFER') {
    processImageBuffer(message.imageUrl, message.buffer)
      .then((result) => sendResponse({ result }))
      .catch((err) => {
        console.error('[Offscreen] Error processing image:', err);
        sendResponse({ error: err.message });
      });
    return true; // async response
  }
  return false;
});
