import exifr from 'exifr';
import { AnalysisResult, MetadataResult, PatchResult } from '../shared/types';
import { extractRuleOfThirdsPatches } from './patch-extractor';
import { runPatchInference } from './model-runner';

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
async function processImageBuffer(imageUrl: string, buffer: number[], contentType = 'image/jpeg'): Promise<AnalysisResult> {
  return queue.run(async () => {
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: contentType });

    // 1. Extract 4 patches on rule-of-thirds grid
    const patches = await extractRuleOfThirdsPatches(blob, 224);

    // 2. Extract EXIF / Metadata
    const metadata = await extractMetadata(blob);

    // 3. Compute patch scores via ONNX Runtime Web / Model Runner
    const patchScores: PatchResult[] = await Promise.all(
      patches.map(async (patch) => {
        const aiScore = await runPatchInference(patch.canvas);
        return {
          patchIndex: patch.patchIndex,
          position: patch.position,
          aiScore
        };
      })
    );

    // Aggregate overall score (max score among patches + metadata adjustment)
    const maxPatchScore = Math.max(...patchScores.map((p) => p.aiScore));
    const avgPatchScore = patchScores.reduce((acc, p) => acc + p.aiScore, 0) / patchScores.length;

    // Apply metadata adjustments (C2PA digital signature reduces AI confidence, missing EXIF slightly increases probability)
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
      timestamp: Date.now()
    };
  });
}

// Listen for background service worker requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PROCESS_IMAGE_BUFFER') {
    processImageBuffer(message.imageUrl, message.buffer, message.contentType)
      .then((result) => sendResponse({ result }))
      .catch((err) => {
        console.error('[Offscreen] Error processing image:', err);
        sendResponse({ error: err.message });
      });
    return true; // async response
  }
  return false;
});
