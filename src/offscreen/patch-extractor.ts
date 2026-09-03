import { PatchBox } from '../shared/types';

export interface ExtractedPatch {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  patchIndex: number;
  canvas: HTMLCanvasElement;
  box: PatchBox;
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

  // Fallback for small/medium images (< 2x targetSize = 448px): 1 single center crop/fit to save 75% WASM inference time
  if (width < targetSize * 2 || height < targetSize * 2) {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    let box: PatchBox = { x: 0, y: 0, width: 1, height: 1 };

    if (ctx) {
      if (width < targetSize || height < targetSize) {
        ctx.drawImage(imageBitmap, 0, 0, width, height, 0, 0, targetSize, targetSize);
        box = { x: 0, y: 0, width: 1, height: 1 };
      } else {
        const sx = Math.round((width - targetSize) / 2);
        const sy = Math.round((height - targetSize) / 2);
        ctx.drawImage(imageBitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
        box = {
          x: sx / width,
          y: sy / height,
          width: targetSize / width,
          height: targetSize / height
        };
      }
    }
    patches.push({ position: 'center', patchIndex: 0, canvas, box });
    return patches;
  }

  // Calculate crop X positions
  let sxLeft: number;
  let sxRight: number;
  if (width >= 3 * targetSize) {
    const half = Math.floor(targetSize / 2);
    sxLeft = Math.round(width * (1 / 3)) - half;
    sxRight = Math.round(width * (2 / 3)) - half;
  } else {
    sxLeft = 0;
    sxRight = width - targetSize;
  }

  // Calculate crop Y positions
  let syTop: number;
  let syBottom: number;
  if (height >= 3 * targetSize) {
    const half = Math.floor(targetSize / 2);
    syTop = Math.round(height * (1 / 3)) - half;
    syBottom = Math.round(height * (2 / 3)) - half;
  } else {
    syTop = 0;
    syBottom = height - targetSize;
  }

  // Ensure coordinates remain clamped within valid image boundaries
  sxLeft = Math.max(0, Math.min(width - targetSize, sxLeft));
  sxRight = Math.max(0, Math.min(width - targetSize, sxRight));
  syTop = Math.max(0, Math.min(height - targetSize, syTop));
  syBottom = Math.max(0, Math.min(height - targetSize, syBottom));

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
