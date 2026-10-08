import { TabScanStats, ImageSummary } from '../shared/types';
import './popup.css';

let activeTabId: number | null = null;
let isExtensionEnabled = true;
let currentStats: TabScanStats = {
  tabId: 0,
  totalScanned: 0,
  aiDetected: 0,
  suspectedAi: 0,
  likelyReal: 0,
  isScanning: false,
  images: []
};

// Cached DOM element references
const brandIconEl = document.getElementById('brandIcon');
const liveBadgeEl = document.getElementById('liveBadge');
const liveDotEl = document.getElementById('liveDot');
const liveTextEl = document.getElementById('liveText');
const enabledSwitchEl = document.getElementById('enabledSwitch') as HTMLInputElement | null;
const switchSliderEl = document.getElementById('switchSlider');
const disabledBannerEl = document.getElementById('disabledBanner');

const metricScannedEl = document.getElementById('metricScanned');
const metricAiFakeEl = document.getElementById('metricAiFake');
const metricEditedEl = document.getElementById('metricEdited');
const metricRealEl = document.getElementById('metricReal');

const feedCountEl = document.getElementById('feedCount');
const emptyStateEl = document.getElementById('emptyState');
const imageListEl = document.getElementById('imageList');
const rescanBtnEl = document.getElementById('rescanBtn');

function updateEnabledUI(enabled: boolean): void {
  isExtensionEnabled = enabled;
  if (brandIconEl) {
    brandIconEl.textContent = enabled ? '🛡️' : '⏸️';
  }
  if (enabledSwitchEl) {
    enabledSwitchEl.checked = enabled;
  }
  if (switchSliderEl) {
    if (enabled) {
      switchSliderEl.classList.add('popupView__switchSlider--checked');
    } else {
      switchSliderEl.classList.remove('popupView__switchSlider--checked');
    }
  }
  if (disabledBannerEl) {
    disabledBannerEl.style.display = enabled ? 'none' : 'flex';
  }
  updateLiveBadgeUI();
}

function updateLiveBadgeUI(): void {
  if (!liveBadgeEl || !liveDotEl || !liveTextEl) return;

  if (!isExtensionEnabled) {
    liveBadgeEl.className = 'popupView__liveBadge popupView__liveBadge--disabled';
    liveDotEl.className = 'popupView__liveDot popupView__liveDot--disabled';
    liveTextEl.textContent = 'Off';
  } else if (currentStats.isScanning) {
    liveBadgeEl.className = 'popupView__liveBadge popupView__liveBadge--scanning';
    liveDotEl.className = 'popupView__liveDot popupView__liveDot--scanning';
    liveTextEl.textContent = 'Scanning...';
  } else {
    liveBadgeEl.className = 'popupView__liveBadge';
    liveDotEl.className = 'popupView__liveDot';
    liveTextEl.textContent = 'Live';
  }
}

function createImageCardElement(img: ImageSummary): HTMLElement {
  const card = document.createElement('div');
  card.className = 'popupView__imageCard';
  card.dataset.imageUrl = img.imageUrl;
  card.title = 'Click to jump to image on page';

  const scorePercent = Math.round(img.aiScore * 100);
  let verdictClass = 'popupView__verdictBadge--real';
  let badgeLabel = 'Real';
  if (scorePercent >= 70) {
    verdictClass = 'popupView__verdictBadge--ai';
    badgeLabel = 'AI Gen';
  } else if (scorePercent >= 30) {
    verdictClass = 'popupView__verdictBadge--edited';
    badgeLabel = 'Edited';
  }

  const thumb = document.createElement('img');
  thumb.loading = 'lazy';
  thumb.src =
    img.imageUrl ||
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" fill="%23334155"><rect width="38" height="38" rx="6"/><text x="19" y="24" font-size="16" text-anchor="middle" fill="%2394a3b8">🖼️</text></svg>';
  thumb.alt = 'Preview';
  thumb.className = 'popupView__thumbnail';

  const details = document.createElement('div');
  details.className = 'popupView__imageDetails';

  const tagGroup = document.createElement('div');
  tagGroup.className = 'popupView__tagGroup';

  const verdictBadge = document.createElement('span');
  verdictBadge.className = `popupView__verdictBadge ${verdictClass}`;
  verdictBadge.textContent = `${badgeLabel} ${scorePercent}%`;
  tagGroup.appendChild(verdictBadge);

  if (img.c2paPresent) {
    const c2paTag = document.createElement('span');
    c2paTag.className = 'popupView__c2paTag';
    c2paTag.textContent = 'C2PA';
    tagGroup.appendChild(c2paTag);
  }

  if (img.cameraModel) {
    const cameraTag = document.createElement('span');
    cameraTag.className = 'popupView__cameraTag';
    cameraTag.textContent = img.cameraModel;
    tagGroup.appendChild(cameraTag);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'popupView__imageTitle';
  titleEl.textContent = img.reasoningTitle || img.imageUrl;

  details.appendChild(tagGroup);
  details.appendChild(titleEl);

  const jumpIcon = document.createElement('span');
  jumpIcon.className = 'popupView__jumpIcon';
  jumpIcon.textContent = '📍';

  card.appendChild(thumb);
  card.appendChild(details);
  card.appendChild(jumpIcon);

  card.addEventListener('click', () => {
    if (activeTabId !== null) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'HIGHLIGHT_IMAGE_ON_PAGE',
        imageUrl: img.imageUrl
      });
    }
  });

  return card;
}

function updateStatsUI(stats: TabScanStats): void {
  currentStats = stats;

  if (metricScannedEl) metricScannedEl.textContent = String(stats.totalScanned);
  if (metricAiFakeEl) metricAiFakeEl.textContent = String(stats.aiDetected);
  if (metricEditedEl) metricEditedEl.textContent = String(stats.suspectedAi);
  if (metricRealEl) metricRealEl.textContent = String(stats.likelyReal);

  if (feedCountEl) {
    feedCountEl.textContent = `${stats.images.length} images`;
  }

  updateLiveBadgeUI();

  if (!emptyStateEl || !imageListEl) return;

  if (stats.images.length === 0) {
    imageListEl.style.display = 'none';
    imageListEl.innerHTML = '';
    emptyStateEl.style.display = 'block';

    if (stats.isScanning) {
      emptyStateEl.textContent = 'Analyzing visible images on page...';
      emptyStateEl.className = 'popupView__emptyState popupView__emptyState--scanning';
    } else {
      emptyStateEl.textContent = 'No images over 224×224 found on this page.';
      emptyStateEl.className = 'popupView__emptyState';
    }
  } else {
    emptyStateEl.style.display = 'none';
    imageListEl.style.display = 'flex';

    // Cap rendered cards to top 20 to maintain high performance and prevent DOM thrashing
    const displayedImages = stats.images.slice(0, 20);
    const existingCards = Array.from(imageListEl.children) as HTMLElement[];
    const isSameCount = existingCards.length === displayedImages.length;
    const isSameOrder =
      isSameCount &&
      existingCards.every((card, idx) => card.dataset.imageUrl === displayedImages[idx]?.imageUrl);

    if (!isSameOrder) {
      imageListEl.innerHTML = '';
      const fragment = document.createDocumentFragment();
      for (const img of displayedImages) {
        fragment.appendChild(createImageCardElement(img));
      }
      imageListEl.appendChild(fragment);
    }
  }
}

// 1. Immediately read persisted extension state
chrome.storage.local.get('extensionEnabled', (res) => {
  if (res && typeof res.extensionEnabled === 'boolean') {
    updateEnabledUI(res.extensionEnabled);
  }
});

// 2. Immediately inspect session storage for activeTabId and cached tab stats (0ms instant paint)
chrome.storage.session.get(null, (sessionData) => {
  const targetId = sessionData?.activeTabId;
  if (typeof targetId === 'number') {
    activeTabId = targetId;
    if (sessionData[`tab_${targetId}`]) {
      updateStatsUI(sessionData[`tab_${targetId}`] as TabScanStats);
    }
  }
});

// 3. Confirm active tab with tabs.query
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (tab && tab.id !== undefined) {
    activeTabId = tab.id;

    try {
      const stored = await chrome.storage.session.get(`tab_${tab.id}`);
      if (stored && stored[`tab_${tab.id}`]) {
        updateStatsUI(stored[`tab_${tab.id}`] as TabScanStats);
      }
    } catch {}

    // Background sync request as fallback
    chrome.runtime.sendMessage({ type: 'GET_TAB_STATS', tabId: tab.id }, (response) => {
      if (response && response.stats) {
        updateStatsUI(response.stats);
      }
    });
  }
});

// 3. Listen for changes in local and session storage for real-time updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    updateEnabledUI(changes.extensionEnabled.newValue);
  }
  if (area === 'session' && activeTabId !== null) {
    const tabKey = `tab_${activeTabId}`;
    if (changes[tabKey] && changes[tabKey].newValue) {
      updateStatsUI(changes[tabKey].newValue as TabScanStats);
    }
  }
});

// 4. Listen for runtime broadcast messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TAB_STATS_UPDATED' && message.stats) {
    if (activeTabId === null || message.stats.tabId === activeTabId) {
      updateStatsUI(message.stats);
    }
  }
});

// 5. User interaction hooks
if (enabledSwitchEl) {
  enabledSwitchEl.addEventListener('change', () => {
    const next = enabledSwitchEl.checked;
    updateEnabledUI(next);
    chrome.storage.local.set({ extensionEnabled: next });
    chrome.runtime.sendMessage({ type: 'SET_GLOBAL_STATE', enabled: next }).catch(() => {});
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'GLOBAL_STATE_CHANGED',
            enabled: next
          }).catch(() => {});
        }
      }
    });
  });
}

if (rescanBtnEl) {
  rescanBtnEl.addEventListener('click', () => {
    if (activeTabId !== null) {
      chrome.tabs.reload(activeTabId);
      window.close();
    }
  });
}
