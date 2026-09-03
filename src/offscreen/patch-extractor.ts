import { PatchBox, PatchPosition } from '../shared/types';

export interface ExtractedPatch {
  position: PatchPosition;
  patchIndex: number;
  canvas: HTMLCanvasElement;
  box: PatchBox;
}

export interface ExtractionResult {
  patches: ExtractedPatch[];
  supports9Samples: boolean;
  width: number;
  height: number;
  sampleMode: 4 | 9;
}

/**
 * Calculates start and end offsets for 2 crops along an axis with STRICTLY ZERO overlap.
 * If totalLength >= 3 * targetSize, uses ideal rule-of-thirds centers (1/3 and 2/3).
 * If 2 * targetSize <= totalLength < 3 * targetSize, distributes available slack evenly
 * between outer margins and the center gap to shift crops inward toward each other
 * while strictly guaranteeing end >= start + targetSize (zero overlap, no duplicate info).
 */
function calculateTwoNonOverlappingOffsets(totalLength: number, targetSize: number): { start: number; end: number } {
  const maxSlack = totalLength - 2 * targetSize;
  if (maxSlack <= 0) {
    return { start: 0, end: targetSize };
  }

  // When totalLength >= 3 * targetSize, 1/3 and 2/3 centers naturally have >= targetSize separation
  if (totalLength >= 3 * targetSize) {
    const half = targetSize / 2;
    const start = Math.max(0, Math.round(totalLength * (1 / 3) - half));
    const end = Math.min(totalLength - targetSize, Math.round(totalLength * (2 / 3) - half));
    return {
      start,
      end: Math.max(start + targetSize, end)
    };
  }

  // When 2 * targetSize <= totalLength < 3 * targetSize:
  // Distribute slack evenly: 1/3 start margin, 1/3 center gap, 1/3 end margin.
  const margin = Math.floor(maxSlack / 3);
  const start = margin;
  const end = totalLength - targetSize - margin;

  return { start, end };
}

/**
 * Calculates start, mid, and end offsets for 3 non-overlapping crops along an axis.
 * Requires totalLength >= 3 * targetSize.
 */
function calculateThreeNonOverlappingOffsets(
  totalLength: number,
  targetSize: number
): { start: number; mid: number; end: number } {
  const maxSlack = totalLength - 3 * targetSize;
  const outerMargin = Math.floor(maxSlack / 4);
  const start = outerMargin;
  const mid = Math.round((totalLength - targetSize) / 2);
  const end = totalLength - targetSize - outerMargin;

  return { start, mid, end };
}

/**
 * Extracts patches from image centered on rule-of-thirds grid (4 crops) or 3x3 grid (9 crops) without overlap.
 * For small/medium images (< 2x targetSize = 448px in either dimension), extracts 1 single
 * center crop to strictly prevent crop overlap and duplicate redundant sampling.
 */
export async function extractRuleOfThirdsPatches(
  blob: Blob,
  targetSize = 224,
  sampleMode: 4 | 9 = 4
): Promise<ExtractionResult> {
  let imageBitmap: ImageBitmap;
  try {
    imageBitmap = await createImageBitmap(blob);
  } catch (err) {
    return { patches: [], supports9Samples: false, width: 0, height: 0, sampleMode };
  }

  const { width, height } = imageBitmap;
  const supports9Samples = width >= targetSize * 3 && height >= targetSize * 3;

  // Skip images smaller than targetSize (224x224) - upscaling introduces distortion and unrealistic scores
  if (width < targetSize || height < targetSize) {
    return { patches: [], supports9Samples: false, width, height, sampleMode };
  }

  const patches: ExtractedPatch[] = [];

  // For small/medium images (< 448px in either dimension), 2 full crops cannot fit without
  // overlapping. We use 1 center crop to strictly prevent overlap and loss of information.
  if (width < targetSize * 2 || height < targetSize * 2) {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    const sx = Math.round((width - targetSize) / 2);
    const sy = Math.round((height - targetSize) / 2);

    if (ctx) {
      ctx.drawImage(imageBitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
    }
    const box: PatchBox = {
      x: sx / width,
      y: sy / height,
      width: targetSize / width,
      height: targetSize / height
    };
    patches.push({ position: 'center', patchIndex: 0, canvas, box });
    return { patches, supports9Samples: false, width, height, sampleMode };
  }

  // 9-sample mode (3x3 grid) for large images
  if (sampleMode === 9 && supports9Samples) {
    const { start: sxLeft, mid: sxMid, end: sxRight } = calculateThreeNonOverlappingOffsets(width, targetSize);
    const { start: syTop, mid: syMid, end: syBottom } = calculateThreeNonOverlappingOffsets(height, targetSize);

    const cropConfigs9 = [
      { name: 'top-left' as const, index: 0, sx: sxLeft, sy: syTop },
      { name: 'top-center' as const, index: 1, sx: sxMid, sy: syTop },
      { name: 'top-right' as const, index: 2, sx: sxRight, sy: syTop },
      { name: 'middle-left' as const, index: 3, sx: sxLeft, sy: syMid },
      { name: 'center' as const, index: 4, sx: sxMid, sy: syMid },
      { name: 'middle-right' as const, index: 5, sx: sxRight, sy: syMid },
      { name: 'bottom-left' as const, index: 6, sx: sxLeft, sy: syBottom },
      { name: 'bottom-center' as const, index: 7, sx: sxMid, sy: syBottom },
      { name: 'bottom-right' as const, index: 8, sx: sxRight, sy: syBottom }
    ];

    for (const { name, index, sx, sy } of cropConfigs9) {
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageBitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
      }
      const box: PatchBox = {
        x: sx / width,
        y: sy / height,
        width: targetSize / width,
        height: targetSize / height
      };
      patches.push({ position: name, patchIndex: index, canvas, box });
    }

    return { patches, supports9Samples: true, width, height, sampleMode: 9 };
  }

  // 4-sample mode (2x2 rule-of-thirds grid)
  const { start: sxLeft, end: sxRight } = calculateTwoNonOverlappingOffsets(width, targetSize);
  const { start: syTop, end: syBottom } = calculateTwoNonOverlappingOffsets(height, targetSize);

  const cropConfigs4 = [
    { name: 'top-left' as const, index: 0, sx: sxLeft, sy: syTop },
    { name: 'top-right' as const, index: 1, sx: sxRight, sy: syTop },
    { name: 'bottom-left' as const, index: 2, sx: sxLeft, sy: syBottom },
    { name: 'bottom-right' as const, index: 3, sx: sxRight, sy: syBottom }
  ];

  for (const { name, index, sx, sy } of cropConfigs4) {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(imageBitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
    }
    const box: PatchBox = {
      x: sx / width,
      y: sy / height,
      width: targetSize / width,
      height: targetSize / height
    };
    patches.push({ position: name, patchIndex: index, canvas, box });
  }

  return { patches, supports9Samples, width, height, sampleMode: 4 };
}
