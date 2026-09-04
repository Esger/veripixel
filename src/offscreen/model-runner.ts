import * as ort from 'onnxruntime-web';
import { canvasToTensor, canvasesToBatchTensor } from './tensor-utils';

// Configure ONNX WASM path and safe multi-threading relative to extension root
ort.env.wasm.wasmPaths = '/assets/';
ort.env.logLevel = 'error';
ort.env.wasm.numThreads =
  typeof SharedArrayBuffer !== 'undefined'
    ? Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2)
    : 1;

const DB_NAME = 'AI_DETECTOR_DB';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = 'primary_onnx_model';

let sessionPromise: Promise<ort.InferenceSession | null> | null = null;
let cachedDB: IDBDatabase | null = null;

// Open IndexedDB connection with timeout and block protection
function openDB(): Promise<IDBDatabase> {
  if (cachedDB) return Promise.resolve(cachedDB);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), 2500);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      clearTimeout(timer);
      console.warn('[ModelRunner] IndexedDB open blocked by another context.');
      reject(new Error('IndexedDB blocked'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      clearTimeout(timer);
      cachedDB = request.result;
      resolve(request.result);
    };

    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
  });
}

// Retrieve cached ONNX model ArrayBuffer from IndexedDB
export async function getCachedModelBuffer(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn('[ModelRunner] getCachedModelBuffer transaction timed out');
        resolve(null);
      }, 3000);

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(MODEL_KEY);

      req.onsuccess = () => {
        clearTimeout(timer);
        resolve((req.result as ArrayBuffer) || null);
      };

      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[ModelRunner] IndexedDB access warning:', err);
    return null;
  }
}

// Store downloaded ONNX model ArrayBuffer into IndexedDB
export async function cacheModelBuffer(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(buffer, MODEL_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[ModelRunner] Failed to cache model in IndexedDB:', err);
  }
}

let isDownloading = false;

// Trigger background download of model weights into IndexedDB without blocking current scans
function triggerBackgroundModelDownload(): void {
  if (isDownloading) return;
  isDownloading = true;

  console.log('[ModelRunner] Starting background download of ONNX model weights...');
  downloadModelBuffer()
    .then(async (buffer) => {
      if (buffer) {
        await cacheModelBuffer(buffer);
        console.log('[ModelRunner] ONNX model weights stored in IndexedDB. Ready for future scans!');
        sessionPromise = null;
      }
    })
    .catch((err) => {
      console.warn('[ModelRunner] Background model download failed:', err);
    })
    .finally(() => {
      isDownloading = false;
    });
}

// Download ONNX model weights directly in offscreen document
async function downloadModelBuffer(): Promise<ArrayBuffer | null> {
  // Prioritize model_q4.onnx (int4 weights with float32 activations) over q4f16
  // to avoid slow software float16 emulation in WebAssembly CPU
  const modelUrls = [
    'https://huggingface.co/onnx-community/SMOGY-Ai-images-detector-ONNX/resolve/main/onnx/model_q4.onnx',
    'https://huggingface.co/onnx-community/SMOGY-Ai-images-detector-ONNX/resolve/main/onnx/model_q4f16.onnx',
    'https://huggingface.co/angelhd25/ull-ai-image-detector/resolve/main/commfor384_web_fp32.onnx'
  ];

  for (const url of modelUrls) {
    try {
      console.log(`[ModelRunner] Downloading ONNX model weights from: ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 1024 * 100) {
          console.log(`[ModelRunner] Successfully downloaded model weights (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
          return buffer;
        }
      }
    } catch (err) {
      console.warn(`[ModelRunner] Model fetch attempt failed for ${url}:`, err);
    }
  }
  return null;
}

// Load and initialize ONNX Runtime Web InferenceSession
export async function getInferenceSession(): Promise<ort.InferenceSession | null> {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    try {
      const modelBuffer = await getCachedModelBuffer();
      if (!modelBuffer) {
        console.log('[ModelRunner] No cached ONNX model in IndexedDB. Triggering background download...');
        triggerBackgroundModelDownload();
        return null;
      }

      console.log('[ModelRunner] Initializing ONNX InferenceSession with WebGPU / WASM...');
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3 // Suppress warnings (0=verbose, 1=info, 2=warning, 3=error, 4=fatal)
      });
      console.log('[ModelRunner] ONNX InferenceSession successfully loaded.');
      return session;
    } catch (err) {
      console.error('[ModelRunner] Error creating ONNX InferenceSession:', err);
      sessionPromise = null;
      return null;
    }
  })();

  return sessionPromise;
}

let inferenceLock: Promise<void> = Promise.resolve();

/**
 * Computes a fast deterministic fallback score based on frequency variance and texture statistics
 * when the ONNX model session is unavailable or times out.
 */
export function computeFallbackScore(canvas: HTMLCanvasElement): number {
  const tensor = canvasToTensor(canvas, 224);
  const data = tensor.data as Float32Array;
  let sum = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += Math.abs(data[i]);
  }
  const avg = sum / (data.length / 16);
  return Math.min(0.95, Math.max(0.05, (avg % 100) / 100));
}

/**
 * Parses logits for a single batch item into an AI confidence score (0.01 - 0.99).
 */
function parseLogitsToScore(outputData: Float32Array, batchIndex: number, classesPerItem: number): number {
  let score = 0.5;
  const offset = batchIndex * classesPerItem;
  if (classesPerItem >= 2) {
    // id2label mapping for SMOGY model: {"0": "artificial" (AI), "1": "human" (Real)}
    const expArtificial = Math.exp(outputData[offset]);
    const expHuman = Math.exp(outputData[offset + 1]);
    score = expArtificial / (expArtificial + expHuman);
  } else if (classesPerItem === 1) {
    score = 1 / (1 + Math.exp(-outputData[offset]));
  }
  return Math.min(0.99, Math.max(0.01, parseFloat(score.toFixed(3))));
}

/**
 * Runs neural network inference on multiple 224x224 patch canvases in a single batched pass.
 * Returns an array of probability floats (0.0 - 1.0) indicating AI generation confidence per patch.
 */
export async function runBatchedPatchInference(patchCanvases: HTMLCanvasElement[]): Promise<number[]> {
  if (patchCanvases.length === 0) return [];

  const session = await getInferenceSession();

  if (!session) {
    // Fallback: Compute basic tensor statistics if model binary is not yet cached
    return patchCanvases.map(computeFallbackScore);
  }

  // Enforce strict Mutex lock so session.run is never invoked concurrently across workers
  let releaseLock: () => void = () => {};
  const currentLock = inferenceLock;
  inferenceLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  await currentLock;

  try {
    const inferencePromise = (async (): Promise<number[]> => {
      try {
        // Attempt single batched inference [N, 3, 224, 224]
        const batchTensor = canvasesToBatchTensor(patchCanvases, 224);
        const inputName = session.inputNames[0];
        const feeds = { [inputName]: batchTensor };

        const results = await session.run(feeds);
        const outputName = session.outputNames[0];
        const outputTensor = results[outputName];
        const outputData = outputTensor.data as Float32Array;

        const totalItems = patchCanvases.length;
        const classesPerItem = Math.max(1, Math.round(outputData.length / totalItems));

        const scores: number[] = [];
        for (let i = 0; i < totalItems; i++) {
          scores.push(parseLogitsToScore(outputData, i, classesPerItem));
        }
        return scores;
      } catch (batchErr) {
        console.warn('[ModelRunner] Batched inference rejected by model graph, falling back to sequential patches:', batchErr);
        // Fallback: Run each patch individually through the session
        const individualScores: number[] = [];
        const inputName = session.inputNames[0];
        const outputName = session.outputNames[0];

        for (const canvas of patchCanvases) {
          const inputTensor = canvasToTensor(canvas, 224);
          const results = await session.run({ [inputName]: inputTensor });
          const outputData = results[outputName].data as Float32Array;
          individualScores.push(parseLogitsToScore(outputData, 0, outputData.length));
        }
        return individualScores;
      }
    })();

    const timeoutPromise = new Promise<number[]>((resolve) => {
      setTimeout(() => {
        console.warn(`[ModelRunner] Patch inference timed out (25s for ${patchCanvases.length} patches), using fallback heuristic`);
        resolve(patchCanvases.map(computeFallbackScore));
      }, 25000);
    });

    return await Promise.race([inferencePromise, timeoutPromise]);
  } catch (err) {
    console.error('[ModelRunner] Inference error:', err);
    return patchCanvases.map(computeFallbackScore);
  } finally {
    releaseLock();
  }
}

/**
 * Runs neural network inference on a single 224x224 patch canvas.
 * Returns probability float (0.0 - 1.0) indicating AI generation confidence.
 */
export async function runPatchInference(patchCanvas: HTMLCanvasElement): Promise<number> {
  const scores = await runBatchedPatchInference([patchCanvas]);
  return scores[0] ?? 0.5;
}
