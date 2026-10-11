import { MediaType, MetadataResult } from '../shared/types';
import { ExtractedPatch } from './patch-extractor';

export interface PatchPeriodicityResult {
  hasRepetitivePattern: boolean;
  patternPeriodicity: number;
  patternType?: 'grid' | 'horizontal-bands' | 'vertical-bands';
}

export interface PixelStats {
  exactFlatRatio: number;
  subtleFlatRatio: number;
  textureRatio: number;
  sharpEdgeRatio: number;
  uniqueColorCount: number;
  uniqueColorRatio: number;
  highSaturationRatio: number;
  lowSaturationRatio: number;
  paperRatio: number;
  inkRatio: number;
  isPenAndInk: boolean;
  hasRepetitivePattern: boolean;
  patternPatchRatio: number;
  maxPatternPeriodicity: number;
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

/**
 * Analyzes pixel data for physical repetitive patterns (masonry/brickwork, building stories/window grids,
 * woven cloth/textiles, tiles, and architectural grids).
 *
 * Real physical grids generate strong periodic autocorrelation peaks in 1D scanline projections
 * at discrete lags (4 - 50 px).
 */
export function detectDataPeriodicity(
  data: Uint8ClampedArray,
  width: number,
  height: number
): PatchPeriodicityResult {
  if (width < 32 || height < 32) {
    return { hasRepetitivePattern: false, patternPeriodicity: 0 };
  }

  // 1. Compute 1D luminance profile projections along rows and columns
  const rowLum = new Float32Array(height);
  const colLum = new Float32Array(width);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += lum;
      colLum[x] += lum;
    }
    rowLum[y] = sum / width;
  }
  for (let x = 0; x < width; x++) {
    colLum[x] /= height;
  }

  // 2. Measure normalized autocorrelation peaks for spatial lags 4 to 50
  function getAutoCorrPeak(signal: Float32Array): { maxCorr: number; bestLag: number } {
    const N = signal.length;
    let mean = 0;
    for (let i = 0; i < N; i++) mean += signal[i];
    mean /= N;

    let variance = 0;
    for (let i = 0; i < N; i++) {
      const d = signal[i] - mean;
      variance += d * d;
    }
    variance /= N;

    // Reject flat or extremely low-contrast regions (skies, flat color)
    if (variance < 6.0) {
      return { maxCorr: 0, bestLag: 0 };
    }

    const maxLag = Math.min(50, Math.floor(N / 2));
    const corrs: number[] = new Array(maxLag + 1).fill(0);
    for (let lag = 4; lag <= maxLag; lag++) {
      let cov = 0;
      let count = 0;
      for (let i = 0; i < N - lag; i++) {
        cov += (signal[i] - mean) * (signal[i + lag] - mean);
        count++;
      }
      corrs[lag] = cov / (count * variance);
    }

    let maxCorr = -1;
    let bestLag = 0;
    for (let lag = 5; lag < maxLag; lag++) {
      const c = corrs[lag];
      const prev = corrs[lag - 1];
      const next = corrs[lag + 1];
      // A genuine periodic peak is a local maximum distinct from neighboring lags
      if (c > prev && c > next && c > 0.35) {
        if (c > maxCorr) {
          maxCorr = c;
          bestLag = lag;
        }
      }
    }

    return { maxCorr: Math.max(0, maxCorr), bestLag };
  }

  const rowPeak = getAutoCorrPeak(rowLum);
  const colPeak = getAutoCorrPeak(colLum);

  // Periodic grid: bricks, tile grids, plaid cloth, window matrices
  const hasGrid = rowPeak.maxCorr > 0.32 && colPeak.maxCorr > 0.32;
  // Horizontal bands: building stories, horizontal mortar, horizontal stripes
  const hasHorizontal = rowPeak.maxCorr > 0.40;
  // Vertical bands: vertical window mullions, siding, vertical fabric stripes
  const hasVertical = colPeak.maxCorr > 0.40;

  const hasRepetitivePattern = hasGrid || hasHorizontal || hasVertical;
  const patternPeriodicity = Math.max(rowPeak.maxCorr, colPeak.maxCorr);
  const patternType = hasGrid
    ? 'grid'
    : hasHorizontal
      ? 'horizontal-bands'
      : hasVertical
        ? 'vertical-bands'
        : undefined;

  return {
    hasRepetitivePattern,
    patternPeriodicity: parseFloat(patternPeriodicity.toFixed(3)),
    patternType
  };
}

export function detectPatchPeriodicity(canvas: HTMLCanvasElement): PatchPeriodicityResult {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { hasRepetitivePattern: false, patternPeriodicity: 0 };
  }
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectDataPeriodicity(imgData.data, canvas.width, canvas.height);
}

export function analyzeCanvasPixels(patches: ExtractedPatch[]): PixelStats {
  if (patches.length === 0) {
    return {
      exactFlatRatio: 0,
      subtleFlatRatio: 0,
      textureRatio: 0.6,
      sharpEdgeRatio: 0,
      uniqueColorCount: 500,
      uniqueColorRatio: 0.5,
      highSaturationRatio: 0,
      lowSaturationRatio: 0,
      paperRatio: 0,
      inkRatio: 0,
      isPenAndInk: false,
      hasRepetitivePattern: false,
      patternPatchRatio: 0,
      maxPatternPeriodicity: 0,
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
  let lowSatPixels = 0;
  let paperLumPixels = 0; // > 165
  let inkLumPixels = 0;   // < 95

  let patternPatchesCount = 0;
  let maxPatternPeriodicity = 0;

  const uniqueColorBins = new Set<number>();

  for (const patch of patchesToSample) {
    const ctx = patch.canvas.getContext('2d');
    if (!ctx) continue;

    const imgData = ctx.getImageData(0, 0, patch.canvas.width, patch.canvas.height);
    const data = imgData.data;
    const w = patch.canvas.width;
    const h = patch.canvas.height;

    // Detect physical repetitive patterns (masonry, window grids, cloth weave/patterns)
    const periodicity = detectDataPeriodicity(data, w, h);
    if (periodicity.hasRepetitivePattern) {
      patternPatchesCount++;
      if (periodicity.patternPeriodicity > maxPatternPeriodicity) {
        maxPatternPeriodicity = periodicity.patternPeriodicity;
      }
    }

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

    // 2. Palette quantization, saturation, and paper/ink luminance sampling
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
      const sat = max > 0 ? (max - min) / max : 0;
      if (sat > 0.75) {
        highSatPixels++;
      }
      if (sat < 0.20) {
        lowSatPixels++;
      }

      // Relative luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Real paper substrate must be bright (lum > 165) AND low-saturation (sat < 0.18: white, cream, parchment)
      // This prevents high-saturation daylight skies, sunshine, or colorful clothes from being counted as paper
      if (lum > 165 && sat < 0.18) {
        paperLumPixels++;
      } else if (lum < 95) {
        inkLumPixels++;
      }
    }
  }

  const exactFlatRatio = totalPairs > 0 ? exactFlatPairs / totalPairs : 0;
  const subtleFlatRatio = totalPairs > 0 ? subtleFlatPairs / totalPairs : 0;
  const textureRatio = totalPairs > 0 ? texturePairs / totalPairs : 0;
  const sharpEdgeRatio = totalPairs > 0 ? sharpEdgePairs / totalPairs : 0;
  const lowSaturationRatio = totalSampledPixels > 0 ? lowSatPixels / totalSampledPixels : 0;
  const paperRatio = totalSampledPixels > 0 ? paperLumPixels / totalSampledPixels : 0;
  const inkRatio = totalSampledPixels > 0 ? inkLumPixels / totalSampledPixels : 0;

  const patternPatchRatio = patchesToSample.length > 0 ? patternPatchesCount / patchesToSample.length : 0;
  const hasRepetitivePattern = patternPatchesCount > 0;

  // Hand-drawn artwork, sketches, pen & ink, or colored marker/pencil drawings on physical paper:
  // Real paper has analog surface grain (textureRatio > 0.25) and is not digitally dead-flat (exactFlatRatio < 0.25).
  // Real drawings have manual stroke boundaries (sharpEdgeRatio > 0.012).
  const hasPaperTextureAndStrokes =
    textureRatio > 0.25 &&
    exactFlatRatio < 0.25 &&
    sharpEdgeRatio > 0.012;

  // Drawings have constrained palette size (paper + discrete drawing instruments)
  // whereas photographs have hundreds to thousands of continuous chromatic hues across nature/lighting
  const isConstrainedDrawingPalette = uniqueColorBins.size < 280;

  // Case 1: Monochrome / Ballpoint Pen & Ink / Pencil / Charcoal
  // High desaturation, bimodal paper and ink luminance
  const isMonochromeDrawing =
    lowSaturationRatio > 0.55 &&
    paperRatio + inkRatio > 0.55 &&
    inkRatio > 0.04 &&
    paperRatio > 0.18 &&
    isConstrainedDrawingPalette;

  // Case 2: Colored Sketch / Marker Art / Felt-Tip Pens / Colored Pencils on Paper
  // Substantial paper substrate visible behind the drawing, line strokes and colored/dark marks
  const isColoredDrawing =
    paperRatio > 0.22 &&
    inkRatio > 0.06 &&
    paperRatio + inkRatio > 0.40 &&
    isConstrainedDrawingPalette;

  const isPenAndInk = hasPaperTextureAndStrokes && (isMonochromeDrawing || isColoredDrawing);

  return {
    exactFlatRatio,
    subtleFlatRatio,
    textureRatio,
    sharpEdgeRatio,
    uniqueColorCount: uniqueColorBins.size,
    uniqueColorRatio: totalSampledPixels > 0 ? uniqueColorBins.size / totalSampledPixels : 0.8,
    highSaturationRatio: totalSampledPixels > 0 ? highSatPixels / totalSampledPixels : 0,
    lowSaturationRatio,
    paperRatio,
    inkRatio,
    isPenAndInk,
    hasRepetitivePattern,
    patternPatchRatio,
    maxPatternPeriodicity,
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
  const stats = analyzeCanvasPixels(patches);

  // 1. Definite camera photo: verified camera hardware Make/Model or authentic camera EXIF
  // Priority #1: If hardware camera EXIF exists, never misclassify as a sketch or digital art!
  if (metadata.cameraModel || (metadata.exifPresent && !metadata.aiProvenancePresent)) {
    return 'camera-photo';
  }

  // 2. Hand-drawn sketch / pen & ink drawing on physical paper
  if (stats.isPenAndInk) {
    return 'pen-ink-art';
  }

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

  // 3. Graphic Design / UI (flat vector panels, solid icons, minimal quantized palette, zero natural texture)
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

  // 4. Artwork / Painting / Illustration (Oil, acrylic, watercolor, digital painting, cel-shaded art)
  // Non-camera continuous media characterized by artistic pigment saturation, painterly brush edges, or palette clustering
  if (!stats.hasRepetitivePattern) {
    if (
      // Cel-shaded / 2D illustration / Anime
      (stats.exactFlatRatio > 0.25 &&
        stats.textureRatio < 0.22 &&
        (stats.sharpEdgeRatio > 0.03 || stats.highSaturationRatio > 0.18)) ||
      // Traditional & digital paintings: rich artistic pigment saturation with painterly stroke boundaries
      (stats.highSaturationRatio > 0.18 && stats.sharpEdgeRatio > 0.020 && stats.uniqueColorCount < 400) ||
      // Stylized digital art / watercolor / pastel with vivid palette
      (stats.highSaturationRatio > 0.25 && stats.uniqueColorCount < 350) ||
      // Artworks with visible stroke boundaries and non-photographic flat blending
      (stats.sharpEdgeRatio > 0.040 && stats.exactFlatRatio > 0.15)
    ) {
      return 'digital-art';
    }
  }

  // 5. Screen Capture (exact screen resolution or screen aspect with digital UI flatness and lack of texture)
  if ((isExactScreen || isScreenAspect) && !metadata.exifPresent) {
    if (stats.exactFlatRatio > 0.45 && stats.textureRatio < 0.28) {
      return 'screen-capture';
    }
  }

  // 6. Photographic Capture (Natural continuous micro-texture, rich palette, or physical repetitive pattern)
  if (stats.textureRatio >= 0.22 || stats.uniqueColorCount >= 100 || stats.hasRepetitivePattern) {
    return 'camera-photo';
  }

  // Fallback for natural continuous media
  return 'camera-photo';
}

export function formatMediaTypeLabel(mediaType?: MediaType): string {
  switch (mediaType) {
    case 'pen-ink-art':
      return 'Hand-Drawn Artwork / Sketch';
    case 'digital-art':
      return 'Artwork / Painting / Illustration';
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
