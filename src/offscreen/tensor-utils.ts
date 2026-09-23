import * as ort from 'onnxruntime-web/wasm';

/**
 * Converts a 2D HTML Canvas patch into a normalized 4D Float32 Tensor for ONNX model inference.
 * Shape: [1, 3, targetSize, targetSize] (NCHW format)
 * Normalization: ImageNet Feature Extractor Mean [0.485, 0.456, 0.406] and Std [0.229, 0.224, 0.225] for Swin Transformer
 */
export function canvasToTensor(canvas: HTMLCanvasElement, targetSize = 224): ort.Tensor {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to get 2D context from patch canvas');
  }

  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imageData; // RGBA Uint8ClampedArray (size: 4 * targetSize * targetSize)

  const numPixels = targetSize * targetSize;
  const float32Data = new Float32Array(3 * numPixels);

  // Channel offsets in planar NCHW format
  const rOffset = 0;
  const gOffset = numPixels;
  const bOffset = 2 * numPixels;

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let i = 0; i < numPixels; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];

    float32Data[rOffset + i] = (r / 255.0 - mean[0]) / std[0];
    float32Data[gOffset + i] = (g / 255.0 - mean[1]) / std[1];
    float32Data[bOffset + i] = (b / 255.0 - mean[2]) / std[2];
  }

  return new ort.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
}

/**
 * Converts multiple 2D HTML Canvas patches into a single 4D Batched Float32 Tensor.
 * Shape: [batchSize, 3, targetSize, targetSize] (NCHW format)
 */
export function canvasesToBatchTensor(canvases: HTMLCanvasElement[], targetSize = 224): ort.Tensor {
  const batchSize = canvases.length;
  if (batchSize === 0) {
    throw new Error('Cannot construct tensor from empty canvas array');
  }

  const numPixels = targetSize * targetSize;
  const patchFloatCount = 3 * numPixels;
  const float32Data = new Float32Array(batchSize * patchFloatCount);

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let b = 0; b < batchSize; b++) {
    const canvas = canvases[b];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error(`Failed to get 2D context from patch canvas at index ${b}`);
    }

    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    const { data } = imageData;

    const baseOffset = b * patchFloatCount;
    const rOffset = baseOffset;
    const gOffset = baseOffset + numPixels;
    const bOffset = baseOffset + 2 * numPixels;

    for (let i = 0; i < numPixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];

      float32Data[rOffset + i] = (r / 255.0 - mean[0]) / std[0];
      float32Data[gOffset + i] = (g / 255.0 - mean[1]) / std[1];
      float32Data[bOffset + i] = (b / 255.0 - mean[2]) / std[2];
    }
  }

  return new ort.Tensor('float32', float32Data, [batchSize, 3, targetSize, targetSize]);
}

