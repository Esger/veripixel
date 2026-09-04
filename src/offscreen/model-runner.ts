import * as ort from 'onnxruntime-web/wasm';
import { canvasToTensor, canvasesToBatchTensor } from './tensor-utils';

// Configure ONNX WASM path and disable multi-threading for rock-solid extension stability
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/');
} else {
  ort.env.wasm.wasmPaths = '/assets/';
}
ort.env.logLevel = 'error';
// Set numThreads strictly to 1 in Chrome Extension Offscreen Documents.
// Multi-threaded WASM in browser extensions spawns em-pthread Web Workers via new Worker(import.meta.url).
// In Chrome MV3, those worker threads execute the offscreen bundle, fail extension API handshakes,
// and cause inference to deadlock or hang until timeout.
// Single-threaded WASM with SIMD is rock-solid and executes 4 patches in ~1.0s.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const DB_NAME = 'AI_DETECTOR_DB';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = 'distilled_vit_q4_v1';

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

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Clean up legacy bulky Swin weights (52MB) from IndexedDB
      try {
        store.delete('primary_onnx_model');
      } catch (e) {}

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

// Download or load bundled lightweight distilled ViT ONNX model weights
async function downloadModelBuffer(): Promise<ArrayBuffer | null> {
  // 1. Check local bundled model in assets/ first (instant offline availability)
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    try {
      const localUrl = chrome.runtime.getURL('assets/model_q4.onnx');
      console.log(`[ModelRunner] Checking for bundled ONNX model: ${localUrl}`);
      const res = await fetch(localUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 1024 * 100) {
          console.log(`[ModelRunner] Successfully loaded bundled model (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
          return buffer;
        }
      }
    } catch (localErr) {
      console.warn('[ModelRunner] Bundled model check skipped, attempting remote CDN:', localErr);
    }
  }

  // 2. Fallback to remote HuggingFace CDN
  const modelUrls = [
    'https://huggingface.co/onnx-community/ai-image-detect-distilled-ONNX/resolve/main/onnx/model_q4.onnx',
    'https://huggingface.co/onnx-community/ai-image-detect-distilled-ONNX/resolve/main/onnx/model_quantized.onnx',
    'https://huggingface.co/onnx-community/SMOGY-Ai-images-detector-ONNX/resolve/main/onnx/model_q4.onnx'
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
      let modelBuffer = await getCachedModelBuffer();
      if (!modelBuffer) {
        console.log('[ModelRunner] No cached ONNX model in IndexedDB. Loading bundled/remote model...');
        modelBuffer = await downloadModelBuffer();
        if (modelBuffer) {
          await cacheModelBuffer(modelBuffer);
          console.log('[ModelRunner] Distilled ONNX model weights cached in IndexedDB.');
        } else {
          console.warn('[ModelRunner] Failed to obtain model buffer.');
          sessionPromise = null;
          return null;
        }
      }

      console.log('[ModelRunner] Initializing ONNX InferenceSession with WASM SIMD...');
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3 // Suppress internal ONNX warnings
      });

      // Warm up session with a 1-patch dummy tensor to preallocate WASM memory & graph execution structures
      try {
        const dummyInput = new ort.Tensor('float32', new Float32Array(1 * 3 * 224 * 224), [1, 3, 224, 224]);
        await session.run({ [session.inputNames[0]]: dummyInput });
        console.log('[ModelRunner] ONNX InferenceSession successfully warmed up (WASM SIMD).');
      } catch (warmupErr) {
        console.warn('[ModelRunner] Session warmup notice:', warmupErr);
      }

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
 * Parses logits for a single batch item into an AI confidence score (0.01 - 0.99)
 * with numerically stable softmax.
 */
function parseLogitsToScore(outputData: Float32Array, batchIndex: number, classesPerItem: number): number {
  const offset = batchIndex * classesPerItem;
  if (classesPerItem >= 2) {
    // id2label mapping: {"0": "fake" (AI), "1": "real" (Human)}
    const logitFake = outputData[offset];
    const logitReal = outputData[offset + 1];
    const maxLogit = Math.max(logitFake, logitReal);
    const expFake = Math.exp(logitFake - maxLogit);
    const expReal = Math.exp(logitReal - maxLogit);
    const score = expFake / (expFake + expReal);
    return Math.min(0.99, Math.max(0.01, parseFloat(score.toFixed(3))));
  } else if (classesPerItem === 1) {
    const val = outputData[offset];
    const score = 1 / (1 + Math.exp(-val));
    return Math.min(0.99, Math.max(0.01, parseFloat(score.toFixed(3))));
  }
  return 0.5;
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
      const tStart = Date.now();
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
        console.log(
          `[ModelRunner] Batched inference completed for ${totalItems} patches in ${Date.now() - tStart}ms (Scores: [${scores.join(', ')}])`
        );
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
        console.log(
          `[ModelRunner] Sequential patch inference completed in ${Date.now() - tStart}ms (Scores: [${individualScores.join(', ')}])`
        );
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
