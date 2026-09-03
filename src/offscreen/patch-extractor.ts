import { PatchBox } from '../shared/types';

export interface ExtractedPatch {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  patchIndex: number;
  canvas: HTMLCanvasElement;
  box: PatchBox;
}

/**
 * Calculates start and end offsets for 2 crops along an axis.
 * Uses rule-of-thirds centers (1/3 and 2/3). If the image is smaller or the
 * thirds rule cannot be maintained without hitting outer bounds, shifts the
 * crops toward each other toward the center to avoid leaving a dead zone in the middle.
 */
function calculateThirdsOffsets(totalLength: number, targetSize: number): { start: number; end: number } {
  const maxOffset = Math.max(0, totalLength - targetSize);
  const half = targetSize / 2;

  // Ideal rule-of-thirds centers (1/3 and 2/3)
  const center1 = totalLength / 3;
  const center2 = (totalLength * 2) / 3;

  let start = Math.round(center1 - half);
  let end = Math.round(center2 - half);

  // Clamp within image boundaries [0, maxOffset]
  start = Math.max(0, Math.min(maxOffset, start));
  end = Math.max(0, Math.min(maxOffset, end));

  // If the image is small enough that crops hit the outer edges (start is 0 and end is maxOffset),
  // shift them inward toward each other so they cover the central subject rather than sticking to outer corners
  if (start === 0 && end === maxOffset) {
    const center = Math.round(maxOffset / 2);
    const inwardShift = Math.round(maxOffset * 0.25);
    start = Math.min(center, start + inwardShift);
    end = Math.max(center, end - inwardShift);
  }

  return { start, end };
}

/**
 * Extracts patches from image centered at 1/3 and 2/3 grid intersection points (rule of thirds)
 * or a single center crop for small/medium images. Returns normalized box coordinates for overlay highlights.
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

  // Fallback for small images (< targetSize = 224px): 1 single center crop/fit
  if (width < targetSize || height < targetSize) {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    let box: PatchBox = { x: 0, y: 0, width: 1, height: 1 };

    if (ctx) {
      ctx.drawImage(imageBitmap, 0, 0, width, height, 0, 0, targetSize, targetSize);
    }
    patches.push({ position: 'center', patchIndex: 0, canvas, box });
    return patches;
  }

  // Calculate crop X and Y offsets using rule-of-thirds centers, shifting inward when needed
  const { start: sxLeft, end: sxRight } = calculateThirdsOffsets(width, targetSize);
  const { start: syTop, end: syBottom } = calculateThirdsOffsets(height, targetSize);

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
