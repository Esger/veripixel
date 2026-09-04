import { PatchBox, PatchPosition, GridDimensions } from '../shared/types';

export interface ExtractedPatch {
  position: PatchPosition;
  patchIndex: number;
  canvas: HTMLCanvasElement;
  box: PatchBox;
}

export interface ExtractionResult {
  patches: ExtractedPatch[];
  supportsDeepSampling: boolean;
  deepGrid: GridDimensions;
  currentGrid: GridDimensions;
  sampleMode: 'fast' | 'standard' | 'deep';
  width: number;
  height: number;
}

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure mathematical layout generator for sample box coordinates.
 * Completely eliminates offscreen DOM insertion and synchronous layout reflows.
 */
export function calculateSampleLayout(
  containerWidth: number,
  containerHeight: number,
  boxSize: number,
  cols: number,
  rows: number
): BoxRect[] {
  const count = cols * rows;
  if (count === 1) {
    return [
      {
        x: Math.max(0, (containerWidth - boxSize) / 2),
        y: Math.max(0, (containerHeight - boxSize) / 2),
        width: boxSize,
        height: boxSize
      }
    ];
  }
  if (count === 4) {
    const half = boxSize / 2;
    const x1 = containerWidth * (1 / 3) - half;
    const x2 = containerWidth * (2 / 3) - half;
    const y1 = containerHeight * (1 / 3) - half;
    const y2 = containerHeight * (2 / 3) - half;
    return [
      { x: x1, y: y1, width: boxSize, height: boxSize },
      { x: x2, y: y1, width: boxSize, height: boxSize },
      { x: x1, y: y2, width: boxSize, height: boxSize },
      { x: x2, y: y2, width: boxSize, height: boxSize }
    ];
  }
  // Generic space-around layout for 2, 6, 9 boxes
  const xSlack = Math.max(0, containerWidth - cols * boxSize);
  const ySlack = Math.max(0, containerHeight - rows * boxSize);
  const xOuter = xSlack / (cols * 2);
  const xGap = xSlack / cols;
  const yOuter = ySlack / (rows * 2);
  const yGap = ySlack / rows;
  const res: BoxRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      res.push({
        x: xOuter + c * (boxSize + xGap),
        y: yOuter + r * (boxSize + yGap),
        width: boxSize,
        height: boxSize
      });
    }
  }
  return res;
}

/**
 * Formulates intuitive semantic position names for arbitrary grid dimensions (e.g. 2x2, 3x2, 2x3, 3x3, 2x1, 1x2).
 */
function getGridPositionName(col: number, row: number, totalCols: number, totalRows: number): PatchPosition {
  if (totalCols === 1 && totalRows === 1) return 'center';

  if (totalRows === 1) {
    if (col === 0) return 'middle-left';
    if (col === totalCols - 1) return 'middle-right';
    return 'center';
  }

  if (totalCols === 1) {
    if (row === 0) return 'top-center';
    if (row === totalRows - 1) return 'bottom-center';
    return 'center';
  }

  const colName = col === 0 ? 'left' : col === totalCols - 1 ? 'right' : 'center';
  const rowName = row === 0 ? 'top' : row === totalRows - 1 ? 'bottom' : 'middle';

  if (rowName === 'middle' && colName === 'center') return 'center';
  if (rowName === 'middle') return `middle-${colName}` as PatchPosition;
  if (colName === 'center') return `${rowName}-center` as PatchPosition;
  return `${rowName}-${colName}` as PatchPosition;
}

/**
 * Extracts patches from image centered on grid.
 * - In fast mode: extracts 1 center crop (224x224) for immediate ~280ms badge display.
 * - In standard mode: extracts 4 corner samples (2x2) for all images >= targetSize (224px).
 * - In deep mode: extracts up to 9 samples (3x3) if image dimensions permit.
 * - If only one side is >= targetSize, letterboxes/pillarboxes the smaller side.
 * - If BOTH sides are < targetSize (224), returns empty patches to skip small avatars.
 */
export async function extractRuleOfThirdsPatches(
  blob: Blob,
  targetSize = 224,
  sampleMode: 'fast' | 'standard' | 'deep' = 'standard'
): Promise<ExtractionResult> {
  let imageBitmap: ImageBitmap;
  try {
    imageBitmap = await createImageBitmap(blob);
  } catch (err) {
    const emptyGrid = { cols: 0, rows: 0, total: 0 };
    return { patches: [], supportsDeepSampling: false, deepGrid: emptyGrid, currentGrid: emptyGrid, sampleMode, width: 0, height: 0 };
  }

  const { width, height } = imageBitmap;

  // Skip images where BOTH sides are smaller than targetSize (224x224)
  if (width < targetSize && height < targetSize) {
    const emptyGrid = { cols: 0, rows: 0, total: 0 };
    return { patches: [], supportsDeepSampling: false, deepGrid: emptyGrid, currentGrid: emptyGrid, sampleMode, width, height };
  }

  // Determine maximum crops along each axis
  const maxCols = width >= targetSize * 3 ? 3 : width >= targetSize ? 2 : 1;
  const maxRows = height >= targetSize * 3 ? 3 : height >= targetSize ? 2 : 1;
  const deepTotal = maxCols * maxRows;
  const supportsDeepSampling = deepTotal > 4; // True for 3x2 (6), 2x3 (6), or 3x3 (9)
  const deepGrid: GridDimensions = { cols: maxCols, rows: maxRows, total: deepTotal };

  // Determine active grid
  let activeCols = 1;
  let activeRows = 1;

  if (sampleMode === 'fast') {
    activeCols = 1;
    activeRows = 1;
  } else if (sampleMode === 'deep' && supportsDeepSampling) {
    activeCols = maxCols;
    activeRows = maxRows;
  } else {
    // Standard mode: extract 4 corner samples (2x2) whenever both dimensions >= targetSize (allowing overlap)
    activeCols = width >= targetSize ? 2 : 1;
    activeRows = height >= targetSize ? 2 : 1;
  }

  const currentGrid: GridDimensions = {
    cols: activeCols,
    rows: activeRows,
    total: activeCols * activeRows
  };

  const boxRects = calculateSampleLayout(width, height, targetSize, activeCols, activeRows);
  const patches: ExtractedPatch[] = [];

  let patchIndex = 0;
  for (let r = 0; r < activeRows; r++) {
    for (let c = 0; c < activeCols; c++) {
      const idx = r * activeCols + c;
      const boxRect = boxRects[idx];
      if (!boxRect) continue;

      const position = getGridPositionName(c, r, activeCols, activeRows);

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      let sx = 0;
      let sy = 0;
      let sw = targetSize;
      let sh = targetSize;
      let dx = 0;
      let dy = 0;
      let dw = targetSize;
      let dh = targetSize;

      if (width >= targetSize) {
        sx = Math.max(0, Math.min(width - targetSize, Math.round(boxRect.x)));
        sw = targetSize;
        dx = 0;
        dw = targetSize;
      } else {
        // Width is smaller than targetSize: center image horizontally with black padding
        sx = 0;
        sw = width;
        dx = Math.round((targetSize - width) / 2);
        dw = width;
      }

      if (height >= targetSize) {
        sy = Math.max(0, Math.min(height - targetSize, Math.round(boxRect.y)));
        sh = targetSize;
        dy = 0;
        dh = targetSize;
      } else {
        // Height is smaller than targetSize: center image vertically with black padding
        sy = 0;
        sh = height;
        dy = Math.round((targetSize - height) / 2);
        dh = height;
      }

      if (ctx) {
        // Fill missing part with pure neutral black (no artificial AI features or noise)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetSize, targetSize);
        ctx.drawImage(imageBitmap, sx, sy, sw, sh, dx, dy, dw, dh);
      }

      const box: PatchBox = {
        x: sx / width,
        y: sy / height,
        width: sw / width,
        height: sh / height
      };

      patches.push({ position, patchIndex: patchIndex++, canvas, box });
    }
  }

  return {
    patches,
    supportsDeepSampling,
    deepGrid,
    currentGrid,
    sampleMode: sampleMode === 'fast' ? 'fast' : sampleMode === 'deep' && supportsDeepSampling ? 'deep' : 'standard',
    width,
    height
  };
}
