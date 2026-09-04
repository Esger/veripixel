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
let isOffscreenReady = false;

async function pingOffscreen(timeoutMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    try {
      chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response || response.status !== 'pong') {
          resolve(false);
        } else {
          isOffscreenReady = true;
          resolve(true);
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function hasOffscreenDocument(): Promise<boolean> {
  if ('hasDocument' in chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });
  return contexts.length > 0;
}

// Manage Offscreen Document Lifecycle with verified script readiness
async function ensureOffscreenDocumentExists(): Promise<void> {
  const exists = await hasOffscreenDocument();
  if (exists) {
    if (isOffscreenReady || (await pingOffscreen(100))) {
      return;
    }
  }

  if (!creatingOffscreenPromise) {
    creatingOffscreenPromise = (async () => {
      try {
        if (!(await hasOffscreenDocument())) {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
            justification: 'AI Model Inference using ONNX Runtime Web and DOM Canvas image cropping'
          });
          console.log('[Background] Offscreen Document created successfully.');
        }

        // Wait for offscreen script to evaluate and respond to ping (up to 2 seconds)
        for (let i = 0; i < 20; i++) {
          const ready = await pingOffscreen(100);
          if (ready) {
            console.log('[Background] Verified Offscreen Document script is ready and listening.');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        console.warn('[Background] Offscreen Document created, ping timed out; proceeding anyway.');
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
  if (!chrome.action) return;
  try {
    if (stats.aiDetected > 0) {
      chrome.action.setBadgeText({ tabId, text: `${stats.aiDetected}` }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#EF4444' }).catch(() => {}); // Red
    } else if (stats.suspectedAi > 0) {
      chrome.action.setBadgeText({ tabId, text: `${stats.suspectedAi}` }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#F59E0B' }).catch(() => {}); // Amber/Orange
    } else if (stats.isScanning) {
      chrome.action.setBadgeText({ tabId, text: '...' }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' }).catch(() => {}); // Blue
    } else {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
  } catch (e) {}
}

function broadcastTabStatsUpdate(stats: TabScanStats): void {
  try {
    chrome.runtime.sendMessage({ type: 'TAB_STATS_UPDATED', stats } as ExtensionMessage).catch(() => {});
  } catch (e) {}
}

// Track currently active tab to prioritize user's active viewport over background tabs
let currentActiveTabId: number | null = null;

try {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs && tabs[0]?.id !== undefined) {
      currentActiveTabId = tabs[0].id;
    }
  });
} catch (e) {}

chrome.tabs.onActivated.addListener((activeInfo) => {
  currentActiveTabId = activeInfo.tabId;
  chrome.runtime.sendMessage({
    type: 'SET_ACTIVE_TAB',
    activeTabId: activeInfo.tabId
  } as ExtensionMessage).catch(() => {});
});

if (chrome.windows?.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs[0]?.id !== undefined) {
        currentActiveTabId = tabs[0].id;
        chrome.runtime.sendMessage({
          type: 'SET_ACTIVE_TAB',
          activeTabId: tabs[0].id
        } as ExtensionMessage).catch(() => {});
      }
    });
  });
}

// Clear stats, badge, and pending queue when a tab reloads or navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStatsMap.delete(tabId);
    if (chrome.action) {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
    chrome.runtime.sendMessage({
      type: 'CANCEL_TAB_TASKS',
      tabId
    } as ExtensionMessage).catch(() => {});
  }
});

// Clean up memory and cancel tasks when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStatsMap.delete(tabId);
  chrome.runtime.sendMessage({
    type: 'CANCEL_TAB_TASKS',
    tabId
  } as ExtensionMessage).catch(() => {});
});

// Listen for messages from Content Scripts, Popup, or Offscreen Document
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_READY') {
    isOffscreenReady = true;
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.type === 'ANALYZE_IMAGE' || message.type === 'ANALYZE_IMAGE_BUFFER') {
    (async () => {
      const tabId = sender.tab?.id;
      const imageUrl = message.imageUrl;
      const priority = message.priority || 'normal';
      const isModal = message.isModal || false;
      const requestedSampleMode = message.sampleMode || 'standard';
      const forceRescan = message.forceRescan || false;

      // Active tab tasks get normal/high priority; background tab tasks get background priority
      const isSenderActive = tabId !== undefined && currentActiveTabId !== null && tabId === currentActiveTabId;
      const effectivePriority: 'high' | 'normal' | 'background' =
        isModal || priority === 'high' ? 'high' : isSenderActive ? 'normal' : 'background';

      try {
        if (tabId !== undefined) {
          const stats = getOrCreateTabStats(tabId);
          stats.isScanning = true;
          updateTabToolbarBadge(tabId, stats);
          broadcastTabStatsUpdate(stats);
        }

        // Check cache first (unless forceRescan is requested or sampleMode differs)
        if (!forceRescan) {
          const cached = await getCachedResult(imageUrl);
          if (cached) {
            const isCacheCompatible =
              cached.sampleMode === requestedSampleMode ||
              (!cached.sampleMode && requestedSampleMode === 'standard') ||
              (requestedSampleMode === 'fast' && (cached.sampleMode === 'standard' || cached.sampleMode === 'deep'));

            if (isCacheCompatible) {
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
        }

        await ensureOffscreenDocumentExists();

        const relayMessage: ExtensionMessage =
          message.type === 'ANALYZE_IMAGE_BUFFER'
            ? {
                type: 'PROCESS_IMAGE_BUFFER',
                imageUrl,
                buffer: message.buffer,
                contentType: message.contentType,
                tabId,
                priority: effectivePriority,
                isModal,
                sampleMode: requestedSampleMode
              }
            : {
                type: 'PROCESS_IMAGE_URL',
                imageUrl,
                tabId,
                priority: effectivePriority,
                isModal,
                sampleMode: requestedSampleMode
              };

        let responseHandled = false;
        const relayTimer = setTimeout(() => {
          if (!responseHandled) {
            responseHandled = true;
            console.warn('[Background] Offscreen processing timed out (45s) for:', imageUrl);
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
                error: 'Offscreen processing timed out (45s)'
              }
            });
          }
        }, 45000);

        chrome.runtime.sendMessage(relayMessage, async (response) => {
          if (responseHandled) return;
          responseHandled = true;
          clearTimeout(relayTimer);

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
                error: response?.error || 'Offscreen processing failed'
              }
            });
          }
        });
      } catch (err) {
        console.error('[Background] Error handling image analysis:', err);
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
            error: String(err)
          }
        });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === 'CANCEL_BACKGROUND_ANALYSIS') {
    (async () => {
      if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({ type: 'CANCEL_BACKGROUND_ANALYSIS' }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
      sendResponse({ status: 'ok' });
    })();
    return true;
  }

  if (message.type === 'GET_TAB_STATS') {
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
    }
    return true;
  }

  if (message.type === 'GET_PAGE_STATS') {
    (async () => {
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
    })();
    return true;
  }

  // Any other message (e.g. PROCESS_IMAGE_URL, PING_OFFSCREEN, TAB_STATS_UPDATED) is NOT handled by the service worker
  return false;
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
