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
 * Calculates start and end offsets for 2 crops along an axis with STRICTLY ZERO overlap.
 */
function calculateTwoNonOverlappingOffsets(totalLength: number, targetSize: number): { start: number; end: number } {
  const maxSlack = totalLength - 2 * targetSize;
  if (maxSlack <= 0) {
    return { start: 0, end: Math.max(0, totalLength - targetSize) };
  }

  if (totalLength >= 3 * targetSize) {
    const half = targetSize / 2;
    const start = Math.max(0, Math.round(totalLength * (1 / 3) - half));
    const end = Math.min(totalLength - targetSize, Math.round(totalLength * (2 / 3) - half));
    return {
      start,
      end: Math.max(start + targetSize, end)
    };
  }

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
 * Calculates crop offsets along an axis for 1, 2, or 3 non-overlapping crops.
 */
function calculateAxisOffsets(totalLength: number, targetSize: number, count: number): number[] {
  if (count <= 1) {
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
 * Formulates intuitive semantic position names for arbitrary grid dimensions (e.g. 2x2, 3x2, 2x3, 3x3).
 */
function getGridPositionName(col: number, row: number, totalCols: number, totalRows: number): PatchPosition {
  if (totalCols === 1 && totalRows === 1) return 'center';

  const colName = totalCols === 1 ? 'center' : col === 0 ? 'left' : col === totalCols - 1 ? 'right' : 'center';
  const rowName = totalRows === 1 ? 'middle' : row === 0 ? 'top' : row === totalRows - 1 ? 'bottom' : 'middle';

  if (rowName === 'middle' && colName === 'center') return 'center';
  if (rowName === 'middle') return `middle-${colName}` as PatchPosition;
  if (colName === 'center') return `${rowName}-center` as PatchPosition;
  return `${rowName}-${colName}` as PatchPosition;
}

/**
 * Extracts patches from image centered on non-overlapping grid (standard 2x2 or deep 3x2, 2x3, 3x3).
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

  // Skip images smaller than targetSize (224x224)
  if (width < targetSize || height < targetSize) {
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
    activeCols = 1;
    activeRows = 1;
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
      const sx = xOffsets[c];
      const sy = yOffsets[r];
      const position = getGridPositionName(c, r, activeCols, activeRows);

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
