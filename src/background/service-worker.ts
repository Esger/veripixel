import { ExtensionMessage, AnalysisResult, TabScanStats, ImageSummary } from '../shared/types';
import { logger } from './logger';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

// Cache for results in session storage using SHA-256 hash keys to prevent quota exhaustion from data URLs
async function getCacheKey(url: string, sampleMode?: string): Promise<string> {
  const full = sampleMode ? `${url}::${sampleMode}` : url;
  if (full.length > 128 || full.startsWith('data:')) {
    const data = new TextEncoder().encode(full);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `img_${hashHex}`;
  }
  return `img_${full}`;
}

async function getCachedResult(url: string, sampleMode?: string): Promise<AnalysisResult | null> {
  try {
    const key = await getCacheKey(url, sampleMode);
    const data = await chrome.storage.session.get(key);
    return (data[key] as AnalysisResult) || null;
  } catch (e) {
    logger.warn('[Background] Failed to get cached result:', e);
    return null;
  }
}

async function setCachedResult(url: string, result: AnalysisResult): Promise<void> {
  try {
    const defaultKey = await getCacheKey(url);
    const toStore: Record<string, AnalysisResult> = { [defaultKey]: result };
    if (result.sampleMode) {
      const modeKey = await getCacheKey(url, result.sampleMode);
      toStore[modeKey] = result;
    }
    await chrome.storage.session.set(toStore);
  } catch (e) {
    logger.warn('[Background] Failed to set cached result:', e);
  }
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
          logger.log('[Background] Offscreen Document created successfully.');
        }

        // Wait for offscreen script to evaluate and respond to ping (up to 2 seconds)
        for (let i = 0; i < 20; i++) {
          const ready = await pingOffscreen(100);
          if (ready) {
            logger.log('[Background] Verified Offscreen Document script is ready and listening.');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        logger.warn('[Background] Offscreen Document created, ping timed out; proceeding anyway.');
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (msg.includes('single offscreen document') || msg.includes('already exists')) {
          logger.log('[Background] Offscreen document already active.');
        } else {
          logger.error('[Background] Failed to create offscreen document:', err);
        }
      } finally {
        creatingOffscreenPromise = null;
      }
    })();
  }

  await creatingOffscreenPromise;
}

// Per-tab scan statistics with chrome.storage.session persistence to survive MV3 30s service worker shutdowns
const tabStatsMap = new Map<number, TabScanStats>();
const tabStatsLoadingMap = new Map<number, Promise<TabScanStats>>();
const inFlightScansPerTab = new Map<number, number>();

function startInFlightScan(tabId: number): void {
  const current = inFlightScansPerTab.get(tabId) || 0;
  inFlightScansPerTab.set(tabId, current + 1);
}

function finishInFlightScan(tabId: number): boolean {
  const current = inFlightScansPerTab.get(tabId) || 1;
  const remaining = Math.max(0, current - 1);
  if (remaining === 0) {
    inFlightScansPerTab.delete(tabId);
    return false;
  }
  inFlightScansPerTab.set(tabId, remaining);
  return true;
}

export async function getOrCreateTabStats(tabId: number): Promise<TabScanStats> {
  const memoryStats = tabStatsMap.get(tabId);
  if (memoryStats) {
    memoryStats.isScanning = (inFlightScansPerTab.get(tabId) || 0) > 0;
    return memoryStats;
  }

  const pending = tabStatsLoadingMap.get(tabId);
  if (pending) return await pending;

  const loadPromise = (async () => {
    try {
      const stored = await chrome.storage.session.get(`tab_${tabId}`);
      if (stored && stored[`tab_${tabId}`]) {
        const stats = stored[`tab_${tabId}`] as TabScanStats;
        stats.isScanning = (inFlightScansPerTab.get(tabId) || 0) > 0;
        tabStatsMap.set(tabId, stats);
        return stats;
      }
    } catch (e) {}

    const newStats: TabScanStats = {
      tabId,
      totalScanned: 0,
      aiDetected: 0,
      suspectedAi: 0,
      likelyReal: 0,
      isScanning: (inFlightScansPerTab.get(tabId) || 0) > 0,
      images: []
    };
    tabStatsMap.set(tabId, newStats);
    await chrome.storage.session.set({ [`tab_${tabId}`]: newStats }).catch(() => {});
    return newStats;
  })();

  tabStatsLoadingMap.set(tabId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    tabStatsLoadingMap.delete(tabId);
  }
}

async function saveTabStats(stats: TabScanStats): Promise<void> {
  tabStatsMap.set(stats.tabId, stats);
  try {
    await chrome.storage.session.set({ [`tab_${stats.tabId}`]: stats });
  } catch (e) {
    logger.warn('[Background] Failed to persist tab stats:', e);
  }
}

const ON_ICONS = {
  16: 'assets/icons/icon-16.png',
  32: 'assets/icons/icon-32.png',
  48: 'assets/icons/icon-48.png',
  128: 'assets/icons/icon-128.png'
};

const OFF_ICONS = {
  16: 'assets/icons/icon-off-16.png',
  32: 'assets/icons/icon-off-32.png',
  48: 'assets/icons/icon-off-48.png',
  128: 'assets/icons/icon-off-128.png'
};

let isExtensionEnabled = true;
let isExtensionEnabledResolved = false;

// Load persisted state from chrome.storage.local on startup
const extensionEnabledReady = new Promise<boolean>((resolve) => {
  chrome.storage.local.get('extensionEnabled', (res) => {
    if (res && typeof res.extensionEnabled === 'boolean') {
      isExtensionEnabled = res.extensionEnabled;
    } else {
      isExtensionEnabled = true;
      chrome.storage.local.set({ extensionEnabled: true });
    }
    isExtensionEnabledResolved = true;
    updateGlobalToolbarState();
    resolve(isExtensionEnabled);
  });
});

// React to state changes from popup or background
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled !== undefined) {
    isExtensionEnabled = Boolean(changes.extensionEnabled.newValue);
    if (!isExtensionEnabled) {
      inFlightScansPerTab.clear();
      for (const stats of tabStatsMap.values()) {
        stats.isScanning = false;
        saveTabStats(stats).catch(() => {});
        broadcastTabStatsUpdate(stats);
      }
    }
    updateGlobalToolbarState();
    broadcastGlobalState(isExtensionEnabled);
  }
});

function updateGlobalToolbarState(): void {
  if (!chrome.action) return;
  try {
    if (isExtensionEnabled) {
      chrome.action.setIcon({ path: ON_ICONS }).catch(() => {});
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
      for (const [tabId, stats] of tabStatsMap.entries()) {
        updateTabToolbarBadge(tabId, stats);
      }
    } else {
      chrome.action.setIcon({ path: OFF_ICONS }).catch(() => {});
      chrome.action.setBadgeText({ text: 'OFF' }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#6B7280' }).catch(() => {});
    }
  } catch (e) {}
}

function broadcastGlobalState(enabled: boolean): void {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'GLOBAL_STATE_CHANGED',
            enabled
          } as ExtensionMessage).catch(() => {});
        }
      }
    });
  } catch (e) {}
}

function updateTabToolbarBadge(tabId: number, stats: TabScanStats): void {
  if (!chrome.action) return;
  if (!isExtensionEnabled) {
    chrome.action.setBadgeText({ tabId, text: 'OFF' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#6B7280' }).catch(() => {});
    return;
  }
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
  chrome.storage.session.set({ activeTabId: activeInfo.tabId }).catch(() => {});
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
    inFlightScansPerTab.delete(tabId);
    tabStatsMap.delete(tabId);
    chrome.storage.session.remove(`tab_${tabId}`).catch(() => {});
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
  inFlightScansPerTab.delete(tabId);
  tabStatsMap.delete(tabId);
  chrome.storage.session.remove(`tab_${tabId}`).catch(() => {});
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
      const dataUrl = 'dataUrl' in message ? message.dataUrl : undefined;
      const targetInferenceUrl = dataUrl || imageUrl;
      const priority = message.priority || 'normal';
      const isModal = message.isModal || false;
      const requestedSampleMode = message.sampleMode || 'standard';
      const forceRescan = message.forceRescan || false;

      if (tabId !== undefined) {
        chrome.storage.session.set({ activeTabId: tabId }).catch(() => {});
      }

      // Active tab tasks get normal/high priority; background tab tasks get background priority
      const isSenderActive = tabId !== undefined && currentActiveTabId !== null && tabId === currentActiveTabId;
      const effectivePriority: 'high' | 'normal' | 'background' =
        isModal || priority === 'high' ? 'high' : isSenderActive ? 'normal' : 'background';

      if (!isExtensionEnabledResolved) {
        await extensionEnabledReady;
      }

      if (!isExtensionEnabled) {
        sendResponse({
          type: 'IMAGE_ANALYSIS_RESULT',
          result: {
            imageUrl,
            status: 'error',
            aiScore: 0,
            patchScores: [],
            metadata: { exifPresent: false, c2paPresent: false, qualityScore: 0 },
            timestamp: Date.now(),
            error: 'Extension is disabled'
          }
        });
        return;
      }

      try {
        if (tabId !== undefined) {
          startInFlightScan(tabId);
          const stats = await getOrCreateTabStats(tabId);
          const wasScanning = stats.isScanning;
          stats.isScanning = true;
          if (!wasScanning) {
            await saveTabStats(stats);
            updateTabToolbarBadge(tabId, stats);
            broadcastTabStatsUpdate(stats);
          }
        }

        // Check cache first (unless forceRescan is requested or sampleMode differs)
        if (!forceRescan) {
          let cached = await getCachedResult(imageUrl, requestedSampleMode);
          if (!cached) {
            const latestCached = await getCachedResult(imageUrl);
            if (latestCached) {
              const isCacheCompatible =
                latestCached.sampleMode === requestedSampleMode ||
                (!latestCached.sampleMode && requestedSampleMode === 'standard') ||
                (requestedSampleMode === 'fast' && (latestCached.sampleMode === 'standard' || latestCached.sampleMode === 'deep'));
              if (isCacheCompatible) {
                cached = latestCached;
              }
            }
          }

          if (cached) {
            if (tabId !== undefined) {
              const stillScanning = finishInFlightScan(tabId);
              const stats = await getOrCreateTabStats(tabId);
              stats.isScanning = stillScanning;
              recordTabImageResult(stats, cached);
              await saveTabStats(stats);
              updateTabToolbarBadge(tabId, stats);
              broadcastTabStatsUpdate(stats);
            }
            sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: cached });
            return;
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
                imageUrl: targetInferenceUrl,
                originalUrl: imageUrl,
                tabId,
                priority: effectivePriority,
                isModal,
                sampleMode: requestedSampleMode
              };

        let responseHandled = false;
        const relayTimer = setTimeout(async () => {
          if (!responseHandled) {
            responseHandled = true;
            logger.warn('[Background] Offscreen processing timed out (45s) for:', imageUrl);
            if (tabId !== undefined) {
              const stillScanning = finishInFlightScan(tabId);
              const stats = await getOrCreateTabStats(tabId);
              stats.isScanning = stillScanning;
              await saveTabStats(stats);
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
            logger.warn('[Background] Message error to offscreen:', chrome.runtime.lastError.message);
          }

          if (response && response.result) {
            response.result.imageUrl = imageUrl;
            await setCachedResult(imageUrl, response.result);
            if (tabId !== undefined) {
              const stillScanning = finishInFlightScan(tabId);
              const stats = await getOrCreateTabStats(tabId);
              stats.isScanning = stillScanning;
              recordTabImageResult(stats, response.result);
              await saveTabStats(stats);
              updateTabToolbarBadge(tabId, stats);
              broadcastTabStatsUpdate(stats);
            }
            sendResponse({ type: 'IMAGE_ANALYSIS_RESULT', result: response.result });
          } else if (response && response.cancelled) {
            if (tabId !== undefined) {
              const stillScanning = finishInFlightScan(tabId);
              const stats = await getOrCreateTabStats(tabId);
              stats.isScanning = stillScanning;
              await saveTabStats(stats);
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
              const stillScanning = finishInFlightScan(tabId);
              const stats = await getOrCreateTabStats(tabId);
              stats.isScanning = stillScanning;
              await saveTabStats(stats);
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
        logger.error('[Background] Error handling image analysis:', err);
        if (tabId !== undefined) {
          const stillScanning = finishInFlightScan(tabId);
          const stats = await getOrCreateTabStats(tabId);
          stats.isScanning = stillScanning;
          await saveTabStats(stats);
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
    (async () => {
      const targetTabId = message.tabId;
      if (targetTabId !== undefined) {
        const stats = await getOrCreateTabStats(targetTabId);
        sendResponse({ type: 'TAB_STATS_RESULT', stats });
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const activeId = tabs[0]?.id;
          const stats = activeId !== undefined ? await getOrCreateTabStats(activeId) : {
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
    })();
    return true;
  }

  if (message.type === 'GET_PAGE_STATS') {
    (async () => {
      const allData = await chrome.storage.session.get(null);
      const results = Object.entries(allData)
        .filter(([key, val]) => key.startsWith('img_') && typeof val === 'object' && val !== null && 'aiScore' in val)
        .map(([, val]) => val as AnalysisResult);
      const total = results.length;
      const aiDetected = results.filter((r) => r.aiScore >= 0.7).length;

      sendResponse({
        type: 'PAGE_STATS_RESULT',
        stats: { total, analyzed: total, aiDetected }
      });
    })();
    return true;
  }

  if (message.type === 'GET_GLOBAL_STATE') {
    sendResponse({ enabled: isExtensionEnabled });
    return false;
  }

  if (message.type === 'SET_GLOBAL_STATE') {
    isExtensionEnabled = message.enabled;
    if (!isExtensionEnabled) {
      inFlightScansPerTab.clear();
      for (const stats of tabStatsMap.values()) {
        stats.isScanning = false;
        saveTabStats(stats).catch(() => {});
        broadcastTabStatsUpdate(stats);
      }
    }
    chrome.storage.local.set({ extensionEnabled: message.enabled }, () => {
      updateGlobalToolbarState();
      broadcastGlobalState(message.enabled);
      sendResponse({ status: 'ok', enabled: message.enabled });
    });
    return true;
  }

  // Any other message (e.g. PROCESS_IMAGE_URL, PING_OFFSCREEN, TAB_STATS_UPDATED) is NOT handled by the service worker
  return false;
});

function recordTabImageResult(stats: TabScanStats, result: AnalysisResult): void {
  if (result.status !== 'complete') return;

  let displayUrl = result.imageUrl;
  // If imageUrl is a raw base64 data string, do NOT store 500KB strings in session storage
  if (displayUrl.startsWith('data:') && displayUrl.length > 512) {
    displayUrl = '';
  }

  const summaryItem: ImageSummary = {
    imageUrl: displayUrl,
    aiScore: result.aiScore,
    status: result.status,
    timestamp: result.timestamp,
    cameraModel: result.metadata.cameraModel,
    c2paPresent: result.metadata.c2paPresent,
    reasoningTitle: result.reasoning?.title,
    mediaType: result.mediaType || result.reasoning?.mediaType
  };

  const existingIdx = stats.images.findIndex((img) => img.imageUrl === displayUrl && displayUrl !== '');
  if (existingIdx >= 0) {
    stats.images[existingIdx] = summaryItem;
  } else {
    stats.images.unshift(summaryItem);
    // Cap images at 30 entries to protect session storage quota and ensure instant popup rendering
    if (stats.images.length > 30) {
      stats.images.length = 30;
    }
  }

  stats.totalScanned = stats.images.length;
  stats.aiDetected = stats.images.filter((img) => img.aiScore >= 0.7).length;
  stats.suspectedAi = stats.images.filter((img) => img.aiScore >= 0.3 && img.aiScore < 0.7).length;
  stats.likelyReal = stats.images.filter((img) => img.aiScore < 0.3).length;
}

logger.log('[Background] Service worker initialized.');
