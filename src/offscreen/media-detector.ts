import { MediaType, MetadataResult } from '../shared/types';
import { ExtractedPatch } from './patch-extractor';

interface PixelStats {
  exactFlatRatio: number;
  subtleFlatRatio: number;
  textureRatio: number;
  sharpEdgeRatio: number;
  uniqueColorCount: number;
  uniqueColorRatio: number;
  highSaturationRatio: number;
  totalSampledPixels: number;
}

const COMMON_SCREEN_RESOLUTIONS: ReadonlyArray<[number, number]> = [
  // 16:9 standard gaming / display resolutions
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1280, 720],
  [1600, 900],
  [1366, 768],
  // 21:9 & 32:9 ultrawide gaming
  [2560, 1080],
  [3440, 1440],
  [5120, 1440],
  // 16:10 standard gaming / display resolutions
  [1920, 1200],
  [2560, 1600],
  [1280, 800]
];

function isExactScreenResolution(width: number, height: number): boolean {
  return COMMON_SCREEN_RESOLUTIONS.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w)
  );
}

function analyzeCanvasPixels(patches: ExtractedPatch[]): PixelStats {
  if (patches.length === 0) {
    return {
      exactFlatRatio: 0,
      subtleFlatRatio: 0,
      textureRatio: 0.6,
      sharpEdgeRatio: 0,
      uniqueColorCount: 500,
      uniqueColorRatio: 0.5,
      highSaturationRatio: 0,
      totalSampledPixels: 0
    };
  }

  // Sample across all available crops (up to 4) for holistic representation across the image
  const patchesToSample = patches.slice(0, 4);
  let totalPairs = 0;
  let exactFlatPairs = 0;
  let subtleFlatPairs = 0;
  let texturePairs = 0;
  let sharpEdgePairs = 0;

  let totalSampledPixels = 0;
  let highSatPixels = 0;
  const uniqueColorBins = new Set<number>();

  for (const patch of patchesToSample) {
    const ctx = patch.canvas.getContext('2d');
    if (!ctx) continue;

    const imgData = ctx.getImageData(0, 0, patch.canvas.width, patch.canvas.height);
    const data = imgData.data;
    const w = patch.canvas.width;
    const h = patch.canvas.height;

    // 1. Horizontal neighbor differences (exact flat, subtle flat, micro-texture, and sharp edges)
    // Sample every 2nd row to remain lightning-fast (<1ms)
    for (let y = 0; y < h; y += 2) {
      const rowOffset = y * w * 4;
      for (let x = 0; x < w - 1; x++) {
        const i1 = rowOffset + x * 4;
        const i2 = i1 + 4;

        const r1 = data[i1];
        const g1 = data[i1 + 1];
        const b1 = data[i1 + 2];

        const r2 = data[i2];
        const g2 = data[i2 + 1];
        const b2 = data[i2 + 2];

        totalPairs++;

        if (r1 === r2 && g1 === g2 && b1 === b2) {
          exactFlatPairs++;
        }

        const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
        if (diff <= 1) {
          subtleFlatPairs++;
        } else if (diff <= 36) {
          // Natural analog texture / camera sensor noise / surface grain
          texturePairs++;
        }

        // Relative luminance comparison
        const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        if (Math.abs(lum1 - lum2) > 100) {
          sharpEdgePairs++;
        }
      }
    }

    // 2. Palette quantization & saturation sampling
    // Step by 53 (prime stride) across the patch for uniform sampling
    const totalPixelsInPatch = w * h;
    for (let p = 0; p < totalPixelsInPatch; p += 53) {
      const idx = p * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      totalSampledPixels++;

      // 15-bit color bin (32 levels per channel)
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      uniqueColorBins.add(bin);

      // Saturation calculation: (max - min) / max
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 30) {
        const sat = (max - min) / max;
        if (sat > 0.75) {
          highSatPixels++;
        }
      }
    }
  }

  return {
    exactFlatRatio: totalPairs > 0 ? exactFlatPairs / totalPairs : 0,
    subtleFlatRatio: totalPairs > 0 ? subtleFlatPairs / totalPairs : 0,
    textureRatio: totalPairs > 0 ? texturePairs / totalPairs : 0,
    sharpEdgeRatio: totalPairs > 0 ? sharpEdgePairs / totalPairs : 0,
    uniqueColorCount: uniqueColorBins.size,
    uniqueColorRatio: totalSampledPixels > 0 ? uniqueColorBins.size / totalSampledPixels : 0.8,
    highSaturationRatio: totalSampledPixels > 0 ? highSatPixels / totalSampledPixels : 0,
    totalSampledPixels
  };
}

/**
 * Classifies image media type based on hardware metadata, screen aspect ratios,
 * and statistical pixel properties (photographic micro-texture, flat color fills, palette variety).
 */
export function detectMediaType(
  width: number,
  height: number,
  metadata: MetadataResult,
  patches: ExtractedPatch[]
): MediaType {
  // 1. Definite camera photo: verified camera hardware Make/Model or authentic camera EXIF
  if (metadata.cameraModel || (metadata.exifPresent && !metadata.aiProvenancePresent)) {
    return 'camera-photo';
  }

  const stats = analyzeCanvasPixels(patches);
  const isExactScreen = isExactScreenResolution(width, height);

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const aspect = shortEdge > 0 ? longEdge / shortEdge : 1;

  // Aspect ratio close to 16:9 (1.778), 16:10 (1.6), or 21:9 (2.37)
  const isScreenAspect =
    (Math.abs(aspect - 16 / 9) < 0.03 ||
      Math.abs(aspect - 16 / 10) < 0.03 ||
      Math.abs(aspect - 21 / 9) < 0.05) &&
    longEdge >= 1000;

  // 2. Graphic Design / UI (flat vector panels, solid icons, minimal quantized palette, zero natural texture)
  if (
    stats.exactFlatRatio > 0.75 ||
    (stats.exactFlatRatio > 0.50 &&
      stats.textureRatio < 0.20 &&
      stats.uniqueColorCount < 100 &&
      stats.highSaturationRatio < 0.20) ||
    (stats.exactFlatRatio > 0.40 && stats.textureRatio < 0.15 && stats.uniqueColorCount < 60)
  ) {
    if ((isExactScreen || isScreenAspect) && !metadata.exifPresent) {
      return 'screen-capture';
    }
    return 'graphic-or-ui';
  }

  // 3. Digital 2D Cel-Shaded Artwork / Anime / Cartoon / Vector Illustration
  // Characterized by flat cel fills, line art outlines or high digital saturation, low micro-texture, small palette
  if (
    (stats.exactFlatRatio > 0.35 &&
      stats.textureRatio < 0.22 &&
      (stats.sharpEdgeRatio > 0.04 || stats.highSaturationRatio > 0.20) &&
      stats.uniqueColorCount < 120) ||
    (stats.sharpEdgeRatio > 0.06 &&
      stats.exactFlatRatio > 0.28 &&
      stats.textureRatio < 0.22 &&
      stats.uniqueColorCount < 150)
  ) {
    return 'digital-art';
  }

  // 4. Screen Capture (exact screen resolution or screen aspect with digital UI flatness and lack of texture)
  if ((isExactScreen || isScreenAspect) && !metadata.exifPresent) {
    if (stats.exactFlatRatio > 0.45 && stats.textureRatio < 0.28) {
      return 'screen-capture';
    }
  }

  // 5. Photographic Capture (Natural continuous micro-texture or rich continuous palette)
  if (stats.textureRatio >= 0.22 || stats.uniqueColorCount >= 100) {
    return 'camera-photo';
  }

  // Fallback for natural continuous media
  return 'camera-photo';
}

export function formatMediaTypeLabel(mediaType?: MediaType): string {
  switch (mediaType) {
    case 'digital-art':
      return 'Digital Artwork / Illustration';
    case 'screen-capture':
      return 'Screen Capture / Screenshot';
    case 'graphic-or-ui':
      return 'Graphic Design / UI';
    case 'camera-photo':
      return 'Camera Photograph';
    case 'general-media':
    default:
      return 'Digital Media';
  }
}
