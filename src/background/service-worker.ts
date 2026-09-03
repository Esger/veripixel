import { ExtensionMessage, AnalysisResult, TabScanStats, ImageSummary } from '../shared/types';

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


// Per-tab scan statistics for toolbar badge and real-time popup updates
const tabStatsMap = new Map<number, TabScanStats>();

export function getOrCreateTabStats(tabId: number): TabScanStats {
  let stats = tabStatsMap.get(tabId);
  if (!stats) {
    stats = {
      tabId,
      totalScanned: 0,
      aiDetected: 0,
      suspectedAi: 0,
      likelyReal: 0,
      isScanning: false,
      images: []
    };
    tabStatsMap.set(tabId, stats);
  }
  return stats;
}

function updateTabToolbarBadge(tabId: number, stats: TabScanStats): void {
  try {
    if (!chrome.action) return;

    if (stats.aiDetected > 0) {
      chrome.action.setBadgeText({ tabId, text: `${stats.aiDetected}` });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#EF4444' }); // Red
    } else if (stats.suspectedAi > 0) {
      chrome.action.setBadgeText({ tabId, text: `${stats.suspectedAi}` });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#F59E0B' }); // Amber/Orange
    } else if (stats.isScanning) {
      chrome.action.setBadgeText({ tabId, text: '...' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' }); // Blue
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (e) {}
}

function broadcastTabStatsUpdate(stats: TabScanStats): void {
  try {
    chrome.runtime.sendMessage({ type: 'TAB_STATS_UPDATED', stats } as ExtensionMessage).catch(() => {});
  } catch (e) {}
}

// Clear stats and badge when a tab reloads or navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStatsMap.delete(tabId);
    if (chrome.action) {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
  }
});

// Clean up memory when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStatsMap.delete(tabId);
});

// Listen for messages from Content Scripts, Popup, or Offscreen Document
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'ANALYZE_IMAGE') {
        const { imageUrl, priority, isModal, sampleMode, forceRescan } = message;
        const requestedSampleMode = sampleMode || 'standard';
        const tabId = sender.tab?.id;

        if (tabId !== undefined) {
          const stats = getOrCreateTabStats(tabId);
          stats.isScanning = true;
          updateTabToolbarBadge(tabId, stats);
          broadcastTabStatsUpdate(stats);
        }

        // Check cache first (unless forceRescan is requested or sampleMode differs)
        if (!forceRescan) {
          const cached = await getCachedResult(imageUrl);
          if (
            cached &&
            (cached.sampleMode === requestedSampleMode || (!cached.sampleMode && requestedSampleMode === 'standard'))
          ) {
            if (tabId !== undefined) {
              const stats = getOrCreateTabStats(tabId);
              stats.isScanning = false;
              recordTabImageResult(stats, cached);
              updateTabToolbarBadge(tabId, stats);
              broadcastTabStatsUpdate(stats);
            }
            sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: cached });
            return;
          }
        }

        await ensureOffscreenDocumentExists();

        // Relay directly to Offscreen Document with priority and sampleMode (offscreen fetches directly as Blob)
        chrome.runtime.sendMessage(
          {
            type: 'PROCESS_IMAGE_URL',
            imageUrl,
            priority: priority || 'normal',
            isModal: isModal || false,
            sampleMode: requestedSampleMode
          },
          async (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Background] Message error to offscreen:', chrome.runtime.lastError.message);
            }

            if (response && response.result) {
              await setCachedResult(imageUrl, response.result);
              if (tabId !== undefined) {
                const stats = getOrCreateTabStats(tabId);
                stats.isScanning = false;
                recordTabImageResult(stats, response.result);
                updateTabToolbarBadge(tabId, stats);
                broadcastTabStatsUpdate(stats);
              }
              sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: response.result });
            } else if (response && response.cancelled) {
              if (tabId !== undefined) {
                const stats = getOrCreateTabStats(tabId);
                stats.isScanning = false;
                updateTabToolbarBadge(tabId, stats);
                broadcastTabStatsUpdate(stats);
              }
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
              if (tabId !== undefined) {
                const stats = getOrCreateTabStats(tabId);
                stats.isScanning = false;
                updateTabToolbarBadge(tabId, stats);
                broadcastTabStatsUpdate(stats);
              }
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
      } else if (message.type === 'GET_TAB_STATS') {
        const targetTabId = message.tabId;
        if (targetTabId !== undefined) {
          const stats = getOrCreateTabStats(targetTabId);
          sendResponse({ type: 'TAB_STATS_RESULT', stats });
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeId = tabs[0]?.id;
            const stats = activeId !== undefined ? getOrCreateTabStats(activeId) : {
              tabId: 0,
              totalScanned: 0,
              aiDetected: 0,
              suspectedAi: 0,
              likelyReal: 0,
              isScanning: false,
              images: []
            };
            sendResponse({ type: 'TAB_STATS_RESULT', stats });
          });
          return;
        }
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

function recordTabImageResult(stats: TabScanStats, result: AnalysisResult): void {
  if (result.status !== 'complete') return;

  const summaryItem: ImageSummary = {
    imageUrl: result.imageUrl,
    aiScore: result.aiScore,
    status: result.status,
    timestamp: result.timestamp,
    cameraModel: result.metadata.cameraModel,
    c2paPresent: result.metadata.c2paPresent,
    reasoningTitle: result.reasoning?.title
  };

  const existingIdx = stats.images.findIndex((img) => img.imageUrl === result.imageUrl);
  if (existingIdx >= 0) {
    stats.images[existingIdx] = summaryItem;
  } else {
    stats.images.unshift(summaryItem);
  }

  stats.totalScanned = stats.images.length;
  stats.aiDetected = stats.images.filter((img) => img.aiScore >= 0.7).length;
  stats.suspectedAi = stats.images.filter((img) => img.aiScore >= 0.3 && img.aiScore < 0.7).length;
  stats.likelyReal = stats.images.filter((img) => img.aiScore < 0.3).length;
}

console.log('[Background] Service worker initialized.');
