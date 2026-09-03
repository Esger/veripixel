import { ExtensionMessage, AnalysisResult } from '../shared/types';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

// Cache for results in session storage
async function getCachedResult(url: string): Promise<AnalysisResult | null> {
  const data = await chrome.storage.session.get(`img_${url}`);
  return (data[`img_${url}`] as AnalysisResult) || null;
}

async function setCachedResult(url: string, result: AnalysisResult): Promise<void> {
  await chrome.storage.session.set({ [`img_${url}`]: result });
}

let creatingOffscreenPromise: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  if ('hasDocument' in chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });
  return contexts.length > 0;
}

// Manage Offscreen Document Lifecycle
async function ensureOffscreenDocumentExists(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenPromise) {
    creatingOffscreenPromise = (async () => {
      try {
        if (await hasOffscreenDocument()) return;
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
          justification: 'AI Model Inference using ONNX Runtime Web and DOM Canvas image cropping'
        });
        console.log('[Background] Offscreen Document created successfully.');
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (msg.includes('single offscreen document') || msg.includes('already exists')) {
          console.log('[Background] Offscreen document already active.');
        } else {
          console.error('[Background] Failed to create offscreen document:', err);
        }
      } finally {
        creatingOffscreenPromise = null;
      }
    })();
  }

  await creatingOffscreenPromise;
}

// Fetch cross-origin image bytes safely without CORS canvas taint issues
async function fetchImageBuffer(url: string): Promise<{ buffer: number[]; contentType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    return {
      buffer: Array.from(new Uint8Array(buffer)),
      contentType
    };
  } catch (err) {
    console.error(`[Background] Failed to fetch image ${url}:`, err);
    return null;
  }
}

// Listen for messages from Content Scripts, Popup, or Offscreen Document
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'ANALYZE_IMAGE') {
        const { imageUrl, priority, isModal } = message;

        // Check cache first
        const cached = await getCachedResult(imageUrl);
        if (cached) {
          sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: cached });
          return;
        }

        await ensureOffscreenDocumentExists();

        // Fetch CORS-safe buffer
        const fetchedData = await fetchImageBuffer(imageUrl);
        if (!fetchedData) {
          const errorResult: AnalysisResult = {
            imageUrl,
            status: 'error',
            aiScore: 0,
            patchScores: [],
            metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0 },
            timestamp: Date.now(),
            error: 'Failed to fetch image data'
          };
          sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: errorResult });
          return;
        }

        // Relay to Offscreen Document with priority
        chrome.runtime.sendMessage(
          {
            type: 'PROCESS_IMAGE_BUFFER',
            imageUrl,
            buffer: fetchedData.buffer,
            contentType: fetchedData.contentType,
            priority: priority || 'normal',
            isModal: isModal || false
          },
          async (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Background] Message error to offscreen:', chrome.runtime.lastError.message);
            }

            if (response && response.result) {
              await setCachedResult(imageUrl, response.result);
              sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: response.result });
            } else if (response && response.cancelled) {
              sendResponse({
                type: 'IMAGE_ANALYSIS_RESULT',
                result: {
                  imageUrl,
                  status: 'pending',
                  aiScore: 0,
                  patchScores: [],
                  metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0 },
                  timestamp: Date.now()
                }
              });
            } else {
              sendResponse({
                type: 'IMAGE_ANALYSIS_RESULT',
                result: {
                  imageUrl,
                  status: 'error',
                  aiScore: 0,
                  patchScores: [],
                  metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0 },
                  timestamp: Date.now(),
                  error: 'Offscreen processing failed'
                }
              });
            }
          }
        );
      } else if (message.type === 'CANCEL_BACKGROUND_ANALYSIS') {
        if (await hasOffscreenDocument()) {
          chrome.runtime.sendMessage({ type: 'CANCEL_BACKGROUND_ANALYSIS' }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
        sendResponse({ status: 'ok' });
      } else if (message.type === 'GET_PAGE_STATS') {
        const allData = await chrome.storage.session.get(null);
        const results = Object.values(allData).filter(
          (val): val is AnalysisResult => typeof val === 'object' && val !== null && 'aiScore' in val
        );
        const total = results.length;
        const aiDetected = results.filter((r) => r.aiScore >= 0.7).length;

        sendResponse({
          type: 'PAGE_STATS_RESULT',
          stats: { total, analyzed: total, aiDetected }
        });
      }
    } catch (err) {
      console.error('[Background] Error handling message:', err);
      sendResponse({
        type: 'IMAGE_ANALYSIS_RESULT',
        result: {
          imageUrl: (message as any)?.imageUrl || '',
          status: 'error',
          aiScore: 0,
          patchScores: [],
          metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0 },
          timestamp: Date.now(),
          error: String(err)
        }
      });
    }
  })();

  return true; // Keep message channel open for async response
});

console.log('[Background] Service worker initialized.');
