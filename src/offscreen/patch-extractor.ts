export interface ExtractedPatch {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  patchIndex: number;
  canvas: HTMLCanvasElement;
}

/**
 * Extracts 4 patches from image centered at 1/3 and 2/3 grid intersection points (rule of thirds).
 * For small images (< targetSize), returns center crop or original image.
 */
export async function extractRuleOfThirdsPatches(
  blob: Blob,
  targetSize = 224
): Promise<ExtractedPatch[]> {
  const imageBitmap = await createImageBitmap(blob);
  const { width, height } = imageBitmap;

  const patches: ExtractedPatch[] = [];

  // Fallback for small images (dimensions close to or smaller than targetSize): single center crop/fit
  if (width < targetSize || height < targetSize || (width < targetSize * 1.35 && height < targetSize * 1.35)) {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (width < targetSize || height < targetSize) {
        ctx.drawImage(imageBitmap, 0, 0, width, height, 0, 0, targetSize, targetSize);
      } else {
        const sx = Math.round((width - targetSize) / 2);
        const sy = Math.round((height - targetSize) / 2);
        ctx.drawImage(imageBitmap, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
      }
    }
    patches.push({ position: 'center', patchIndex: 0, canvas });
    return patches;
  }

  // Calculate crop X positions
  // If width >= 3 * targetSize (e.g. 672px for 224), 1/3 and 2/3 centers produce non-overlapping crops.
  // If width < 3 * targetSize, push crops outward to top-left (sx=0) and top-right (sx=width - targetSize)
  // to eliminate redundant center overlap and maximize edge/corner coverage.
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
    patches.push({ position: name, patchIndex: index, canvas });
  }

  return patches;
}
