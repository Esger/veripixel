import { MediaType, MetadataResult } from '../shared/types';
import { ExtractedPatch } from './patch-extractor';

interface PixelStats {
  flatRatio: number;
  uniqueColorRatio: number;
  highSaturationRatio: number;
  sharpEdgeRatio: number;
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
      flatRatio: 0,
      uniqueColorRatio: 0.8,
      highSaturationRatio: 0,
      sharpEdgeRatio: 0
    };
  }

  // Sample from the first 2 patches for fast, representative statistics
  const patchesToSample = patches.slice(0, 2);
  let totalPairs = 0;
  let flatPairs = 0;
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

    // 1. Horizontal neighbor differences (flat ratio and sharp edge ratio)
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

        const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
        totalPairs++;

        if (diff <= 1) {
          flatPairs++;
        }

        // Relative luminance comparison
        const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        if (Math.abs(lum1 - lum2) > 115) {
          sharpEdgePairs++;
        }
      }
    }

    // 2. Palette quantization & saturation sampling
    // Step by 53 (prime stride) across the patch for uniform sampling (~946 pixels)
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
        if (sat > 0.70) {
          highSatPixels++;
        }
      }
    }
  }

  return {
    flatRatio: totalPairs > 0 ? flatPairs / totalPairs : 0,
    uniqueColorRatio: totalSampledPixels > 0 ? uniqueColorBins.size / totalSampledPixels : 0.8,
    highSaturationRatio: totalSampledPixels > 0 ? highSatPixels / totalSampledPixels : 0,
    sharpEdgeRatio: totalPairs > 0 ? sharpEdgePairs / totalPairs : 0
  };
}

/**
 * Classifies image media type based on hardware metadata, screen aspect ratios,
 * and statistical pixel properties (flat color fills, palette quantization, saturation).
 */
export function detectMediaType(
  width: number,
  height: number,
  metadata: MetadataResult,
  patches: ExtractedPatch[]
): MediaType {
  // 1. Definite camera photo: verified camera hardware Make/Model in EXIF
  if (metadata.cameraModel) {
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

  // 2. Graphic Design / UI (extremely flat fills or minimal quantized palette)
  if (stats.flatRatio > 0.35 || (stats.flatRatio > 0.20 && stats.uniqueColorRatio < 0.18)) {
    return 'graphic-or-ui';
  }

  // 3. Exact screen resolution without camera metadata (OS, browser, app, or desktop screenshot)
  if (isExactScreen && !metadata.exifPresent) {
    // If cel-shaded or line-art heavy, likely a 2D drawing or graphic
    if (stats.flatRatio > 0.18 || stats.uniqueColorRatio < 0.30) {
      return 'digital-art';
    }
    return 'screen-capture';
  }

  // 4. Digital Artwork / Illustration / Graphic Design
  // Characterized by discrete color palettes, flat cel shading, line art, or vibrant digital primaries
  if (
    (stats.flatRatio > 0.08 && stats.uniqueColorRatio < 0.45) ||
    (stats.flatRatio > 0.05 && stats.highSaturationRatio > 0.22) ||
    (stats.sharpEdgeRatio > 0.035 && stats.uniqueColorRatio < 0.50) ||
    stats.uniqueColorRatio < 0.28
  ) {
    return 'digital-art';
  }

  // 5. Screen Capture / Display Recording
  // Screen aspect ratio (16:9, 16:10, 21:9) without camera hardware EXIF
  if (isScreenAspect && !metadata.exifPresent && (stats.highSaturationRatio > 0.10 || stats.flatRatio > 0.03)) {
    return 'screen-capture';
  }

  // 6. Camera photograph characteristics (continuous analog sensor noise, rich color distribution)
  if (stats.flatRatio < 0.03 && stats.uniqueColorRatio > 0.65) {
    return 'camera-photo';
  }

  return 'general-media';
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
