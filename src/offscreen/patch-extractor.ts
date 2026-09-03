import { PatchBox } from '../shared/types';

export interface ExtractedPatch {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  patchIndex: number;
  canvas: HTMLCanvasElement;
  box: PatchBox;
}

/**
 * Calculates start and end offsets for 2 crops along an axis with STRICTLY ZERO overlap.
 * If totalLength >= 3 * targetSize, uses ideal rule-of-thirds centers (1/3 and 2/3).
 * If 2 * targetSize <= totalLength < 3 * targetSize, distributes available slack evenly
 * between outer margins and the center gap to shift crops inward toward each other
 * while strictly guaranteeing end >= start + targetSize (zero overlap, no duplicate info).
 */
function calculateNonOverlappingOffsets(totalLength: number, targetSize: number): { start: number; end: number } {
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
  // This shifts crops inward toward each other while strictly preventing overlap.
  const margin = Math.floor(maxSlack / 3);
  const start = margin;
  const end = totalLength - targetSize - margin;

  return { start, end };
}

/**
 * Extracts patches from image centered on rule-of-thirds grid without overlap.
 * For small/medium images (< 2x targetSize = 448px in either dimension), extracts 1 single
 * center crop to strictly prevent crop overlap and duplicate redundant sampling.
 */
export async function extractRuleOfThirdsPatches(
  blob: Blob,
  targetSize = 224
): Promise<ExtractedPatch[]> {
  let imageBitmap: ImageBitmap;
  try {
    imageBitmap = await createImageBitmap(blob);
  } catch (err) {
    return [];
  }

  const { width, height } = imageBitmap;
  const patches: ExtractedPatch[] = [];

  // Skip images smaller than targetSize (224x224) - upscaling introduces distortion and unrealistic scores
  if (width < targetSize || height < targetSize) {
    return [];
  }

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
    return patches;
  }

  // Calculate crop X and Y offsets with guaranteed ZERO overlap
  const { start: sxLeft, end: sxRight } = calculateNonOverlappingOffsets(width, targetSize);
  const { start: syTop, end: syBottom } = calculateNonOverlappingOffsets(height, targetSize);

  const cropConfigs = [
    { name: 'top-left' as const, index: 0, sx: sxLeft, sy: syTop },
    { name: 'top-right' as const, index: 1, sx: sxRight, sy: syTop },
    { name: 'bottom-left' as const, index: 2, sx: sxLeft, sy: syBottom },
    { name: 'bottom-right' as const, index: 3, sx: sxRight, sy: syBottom }
  ];

  for (const { name, index, sx, sy } of cropConfigs) {
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

  return patches;
}
