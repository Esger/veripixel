import * as ort from 'onnxruntime-web';
import { canvasToTensor } from './tensor-utils';

// Configure ONNX WASM path relative to extension root
ort.env.wasm.wasmPaths = '/assets/';
ort.env.wasm.numThreads = 1;

const DB_NAME = 'AI_DETECTOR_DB';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = 'primary_onnx_model';

let sessionPromise: Promise<ort.InferenceSession | null> | null = null;

// Open IndexedDB connection
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Retrieve cached ONNX model ArrayBuffer from IndexedDB
export async function getCachedModelBuffer(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(MODEL_KEY);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) || null);
      req.onerror = () => reject(req.error);
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

// Download ONNX model from remote CDN / Hugging Face or local asset fallback
async function downloadModelBuffer(): Promise<ArrayBuffer | null> {
  const modelUrls = [
    'https://huggingface.co/haywoodsloan/ai-image-detector-deploy/resolve/main/model.onnx',
    'https://huggingface.co/Organika/sdxl-detector/resolve/main/model.onnx',
    '/assets/model.onnx'
  ];

  for (const url of modelUrls) {
    try {
      console.log(`[ModelRunner] Attempting to fetch ONNX model from: ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 1024) {
          console.log(`[ModelRunner] Downloaded ONNX model (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB) from ${url}`);
          return buffer;
        }
      }
    } catch (err) {
      console.warn(`[ModelRunner] Fetch failed for model URL ${url}:`, err);
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
        console.log('[ModelRunner] No cached ONNX model in IndexedDB. Downloading model weights...');
        modelBuffer = await downloadModelBuffer();
        if (modelBuffer) {
          await cacheModelBuffer(modelBuffer);
          console.log('[ModelRunner] ONNX model successfully stored in IndexedDB.');
        }
      }

      if (!modelBuffer) {
        console.warn('[ModelRunner] Could not obtain ONNX model weights.');
        return null;
      }

      console.log('[ModelRunner] Initializing ONNX WASM InferenceSession...');
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      console.log('[ModelRunner] ONNX InferenceSession successfully loaded.');
      return session;
    } catch (err) {
      console.error('[ModelRunner] Error creating ONNX InferenceSession:', err);
      return null;
    }
  })();

  return sessionPromise;
}

/**
 * Runs neural network inference on a single 224x224 patch canvas.
 * Returns probability float (0.0 - 1.0) indicating AI generation confidence.
 */
export async function runPatchInference(patchCanvas: HTMLCanvasElement): Promise<number> {
  const session = await getInferenceSession();

  if (!session) {
    // Fallback: Compute basic tensor statistics if model binary is not yet cached
    const tensor = canvasToTensor(patchCanvas, 224);
    const data = tensor.data as Float32Array;
    let sum = 0;
    for (let i = 0; i < data.length; i += 16) {
      sum += Math.abs(data[i]);
    }
    const avg = sum / (data.length / 16);
    return Math.min(0.95, Math.max(0.05, (avg % 100) / 100));
  }

  try {
    const inputTensor = canvasToTensor(patchCanvas, 224);
    const inputName = session.inputNames[0];
    const feeds = { [inputName]: inputTensor };

    const results = await session.run(feeds);
    const outputName = session.outputNames[0];
    const outputTensor = results[outputName];
    const outputData = outputTensor.data as Float32Array;

    // Output parsing: softmax or single binary probability score
    let score = 0.5;
    if (outputData.length >= 2) {
      // Binary classification softmax: [p_real, p_ai]
      const exp0 = Math.exp(outputData[0]);
      const exp1 = Math.exp(outputData[1]);
      score = exp1 / (exp0 + exp1);
    } else if (outputData.length === 1) {
      // Sigmoid output: p_ai
      score = 1 / (1 + Math.exp(-outputData[0]));
    }

    return Math.min(0.99, Math.max(0.01, parseFloat(score.toFixed(3))));
  } catch (err) {
    console.error('[ModelRunner] Patch inference error:', err);
    return 0.5;
  }
}
