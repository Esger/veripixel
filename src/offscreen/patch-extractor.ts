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
  sampleMode: 'standard' | 'deep';
  width: number;
  height: number;
}

/**
 * Calculates start and end offsets for 2 crops along an axis matching the photographic Rule of Thirds.
 * Centers the crops in the outer thirds (midpoints at 1/6 and 5/6) while guaranteeing zero overlap.
 */
function calculateTwoNonOverlappingOffsets(totalLength: number, targetSize: number): { start: number; end: number } {
  const maxSlack = totalLength - 2 * targetSize;
  if (maxSlack <= 0) {
    return { start: 0, end: Math.max(0, totalLength - targetSize) };
  }

  const half = targetSize / 2;
  // Ideal centers of the outer thirds (1/6 = 16.7% and 5/6 = 83.3%)
  const idealStart = Math.round(totalLength * (1 / 6) - half);
  const idealEnd = Math.round(totalLength * (5 / 6) - half);

  let start = Math.max(0, idealStart);
  let end = Math.min(totalLength - targetSize, idealEnd);

  // If slack is small and ideal positions would overlap or leave no central gap,
  // distribute slack evenly between left, center, and right.
  if (end < start + targetSize) {
    const margin = Math.floor(maxSlack / 3);
    start = margin;
    end = totalLength - targetSize - margin;
  }

  return { start, end };
}

/**
 * Calculates start, mid, and end offsets for 3 non-overlapping crops along an axis (1/6, 1/2, 5/6).
 */
function calculateThreeNonOverlappingOffsets(
  totalLength: number,
  targetSize: number
): { start: number; mid: number; end: number } {
  const maxSlack = totalLength - 3 * targetSize;
  if (maxSlack <= 0) {
    return {
      start: 0,
      mid: Math.round((totalLength - targetSize) / 2),
      end: Math.max(0, totalLength - targetSize)
    };
  }

  const half = targetSize / 2;
  let start = Math.round(totalLength * (1 / 6) - half);
  let mid = Math.round(totalLength * (1 / 2) - half);
  let end = Math.round(totalLength * (5 / 6) - half);

  start = Math.max(0, start);
  end = Math.min(totalLength - targetSize, end);

  // If spacing between any two adjacent crops is too tight or overlaps, distribute slack evenly
  if (mid < start + targetSize || end < mid + targetSize) {
    const margin = Math.floor(maxSlack / 4);
    start = margin;
    mid = Math.round((totalLength - targetSize) / 2);
    end = totalLength - targetSize - margin;
  }

  return { start, mid, end };
}

/**
 * Calculates crop offsets along an axis for 1, 2, or 3 non-overlapping crops.
 */
function calculateAxisOffsets(totalLength: number, targetSize: number, count: number): number[] {
  if (totalLength < targetSize || count <= 1) {
    return [Math.max(0, Math.round((totalLength - targetSize) / 2))];
  }
  if (count === 2) {
    const { start, end } = calculateTwoNonOverlappingOffsets(totalLength, targetSize);
    return [start, end];
  }
  const { start, mid, end } = calculateThreeNonOverlappingOffsets(totalLength, targetSize);
  return [start, mid, end];
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
 * Extracts patches from image centered on non-overlapping grid.
 * If only one of the sides is >= targetSize (224), the missing part on the smaller side
 * is filled with black letterbox/pillarbox padding to preserve aspect ratio without adding AI artifacts.
 * If BOTH sides are < targetSize (224), returns empty patches to skip small avatars.
 */
export async function extractRuleOfThirdsPatches(
  blob: Blob,
  targetSize = 224,
  sampleMode: 'standard' | 'deep' = 'standard'
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

  // Determine maximum non-overlapping crops along each axis
  const maxCols = width >= targetSize * 3 ? 3 : width >= targetSize * 2 ? 2 : 1;
  const maxRows = height >= targetSize * 3 ? 3 : height >= targetSize * 2 ? 2 : 1;
  const deepTotal = maxCols * maxRows;
  const supportsDeepSampling = deepTotal > 4; // True for 3x2 (6), 2x3 (6), or 3x3 (9)
  const deepGrid: GridDimensions = { cols: maxCols, rows: maxRows, total: deepTotal };

  // Determine active grid
  let activeCols = 1;
  let activeRows = 1;

  if (sampleMode === 'deep' && supportsDeepSampling) {
    activeCols = maxCols;
    activeRows = maxRows;
  } else if (maxCols >= 2 && maxRows >= 2) {
    activeCols = 2;
    activeRows = 2;
  } else {
    activeCols = maxCols;
    activeRows = maxRows;
  }

  const currentGrid: GridDimensions = {
    cols: activeCols,
    rows: activeRows,
    total: activeCols * activeRows
  };

  const xOffsets = calculateAxisOffsets(width, targetSize, activeCols);
  const yOffsets = calculateAxisOffsets(height, targetSize, activeRows);
  const patches: ExtractedPatch[] = [];

  let patchIndex = 0;
  for (let r = 0; r < activeRows; r++) {
    for (let c = 0; c < activeCols; c++) {
      const position = getGridPositionName(c, r, activeCols, activeRows);

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');

      let sx = 0;
      let sy = 0;
      let sw = targetSize;
      let sh = targetSize;
      let dx = 0;
      let dy = 0;
      let dw = targetSize;
      let dh = targetSize;
      let boxX = 0;
      let boxY = 0;
      let boxW = 1;
      let boxH = 1;

      if (width >= targetSize) {
        sx = xOffsets[c];
        sw = targetSize;
        dx = 0;
        dw = targetSize;
        boxX = sx / width;
        boxW = targetSize / width;
      } else {
        // Width is smaller than targetSize: center image horizontally with black padding
        sx = 0;
        sw = width;
        dx = Math.round((targetSize - width) / 2);
        dw = width;
        boxX = 0;
        boxW = 1;
      }

      if (height >= targetSize) {
        sy = yOffsets[r];
        sh = targetSize;
        dy = 0;
        dh = targetSize;
        boxY = sy / height;
        boxH = targetSize / height;
      } else {
        // Height is smaller than targetSize: center image vertically with black padding
        sy = 0;
        sh = height;
        dy = Math.round((targetSize - height) / 2);
        dh = height;
        boxY = 0;
        boxH = 1;
      }

      if (ctx) {
        // Fill missing part with pure neutral black (no artificial AI features or noise)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetSize, targetSize);
        ctx.drawImage(imageBitmap, sx, sy, sw, sh, dx, dy, dw, dh);
      }

      const box: PatchBox = {
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH
      };

      patches.push({ position, patchIndex: patchIndex++, canvas, box });
    }
  }

  return {
    patches,
    supportsDeepSampling,
    deepGrid,
    currentGrid,
    sampleMode: sampleMode === 'deep' && supportsDeepSampling ? 'deep' : 'standard',
    width,
    height
  };
}
