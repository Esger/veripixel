import {
  injectLoadingBadge,
  injectImageBadge,
  removeBadge,
  removeAllBadges,
  updateBadgePosition,
  checkPageModalState,
  getActiveModalElements,
  isElementInsideActiveModal,
  isDetectorElement,
  setOverlayEnabled
} from './overlay';
import { ExtensionMessage } from '../shared/types';

let isDetectorEnabled = false;
let isInitialized = false;

const MIN_IMAGE_SIZE = 224; // Skip images smaller than 224x224 (AI model sample size)

function isExtensionContextValid(): boolean {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function resolveUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return url;
  }
}

function getElementImageUrl(el: HTMLElement): string | null {
  if (el instanceof HTMLImageElement) {
    const raw = el.currentSrc || el.src || null;
    return raw ? resolveUrl(raw) : null;
  }

  const style = window.getComputedStyle(el);
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
    const match = bgImage.match(/^url\((['"]?)(.*?)\1\)/);
    if (match && match[2]) {
      return resolveUrl(match[2]);
    }
  }
  return null;
}

function isValidTargetElement(el: HTMLElement): boolean {
  const src = getElementImageUrl(el);
  if (!src) return false;

  // Allow http, https, data URIs, and blob URIs (except SVG vector graphics)
  if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
    return false;
  }
  if (src.includes('.svg')) {
    return false;
  }

  // Ignore 1x1 transparent tracking pixels / base64 placeholders
  if (src.startsWith('data:') && src.length < 200) {
    return false;
  }

  // If image element is not loaded yet, allow it to pass so load event listener can handle it
  if (el instanceof HTMLImageElement && !el.complete) {
    return true;
  }

  // 1. Check rendered on-screen dimensions
  const renderedWidth = el.offsetWidth || el.clientWidth || (el.getBoundingClientRect ? el.getBoundingClientRect().width : 0) || 0;
  const renderedHeight = el.offsetHeight || el.clientHeight || (el.getBoundingClientRect ? el.getBoundingClientRect().height : 0) || 0;

  // If BOTH sides are smaller than MIN_IMAGE_SIZE (224px), skip!
  // This eliminates small avatars, profile thumbnails, button icons, etc.
  if (renderedWidth < MIN_IMAGE_SIZE && renderedHeight < MIN_IMAGE_SIZE) {
    return false;
  }

  // Avoid thin 1px/10px divider lines or separator bars
  if (renderedWidth < 30 || renderedHeight < 30) {
    return false;
  }

  // 2. Check natural intrinsic dimensions (if image element)
  if (el instanceof HTMLImageElement) {
    const naturalWidth = el.naturalWidth || 0;
    const naturalHeight = el.naturalHeight || 0;
    if (naturalWidth > 0 && naturalHeight > 0) {
      if (naturalWidth < MIN_IMAGE_SIZE && naturalHeight < MIN_IMAGE_SIZE) {
        return false;
      }
    }
  }

  return true;
}

async function extractImageDataUrl(el: HTMLElement): Promise<string | null> {
  try {
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      // Limit to 800px max dimension to prevent main-thread jank while preserving ample resolution for 224x224 patches
      const maxDim = 800;
      let w = el.naturalWidth;
      let h = el.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      // Use createImageBitmap when available for off-thread asynchronous decoding and resizing
      if (typeof createImageBitmap !== 'undefined') {
        try {
          const bitmap = await createImageBitmap(el, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: 'medium'
          });
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return canvas.toDataURL('image/jpeg', 0.85);
        } catch (bitmapErr) {
          // Fallback to direct drawImage if createImageBitmap is restricted
        }
      }

      ctx.drawImage(el, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.85);
    }
  } catch (err) {
    // Ignore cross-origin tainted canvas restrictions
  }
  return null;
}

const inFlightUrls = new Set<string>();
const MAX_CONCURRENT_PAGE_SCANS = 2; // Capped to 2 to leave CPU and IPC responsive for browser and popover
let activeScanCount = 0;
const pendingScanQueue: HTMLElement[] = [];

function enqueueElementForScan(el: HTMLElement): void {
  if (
    !isDetectorEnabled ||
    !isExtensionContextValid() ||
    el.dataset.veripixelProcessed === 'true' ||
    el.dataset.veripixelProcessed === 'analyzing'
  ) {
    return;
  }
  if (!pendingScanQueue.includes(el)) {
    // Bound queue length to 10 to prevent massive background backlogs on infinite scroll
    if (pendingScanQueue.length >= 10) {
      return;
    }
    pendingScanQueue.push(el);
  }
  pumpScanQueue();
}

function pumpScanQueue(): void {
  if (!isDetectorEnabled) {
    pendingScanQueue.length = 0;
    activeScanCount = 0;
    return;
  }
  if (!isExtensionContextValid() || document.visibilityState === 'hidden') {
    return;
  }

  // Prune invalid or already processed elements
  for (let i = pendingScanQueue.length - 1; i >= 0; i--) {
    const el = pendingScanQueue[i];
    if (!document.contains(el) || !isValidTargetElement(el) || el.dataset.veripixelProcessed === 'true') {
      pendingScanQueue.splice(i, 1);
    }
  }

  // Priority sorting:
  // 1. Modals first
  // 2. Visible elements closest to viewport center
  // 3. Offscreen elements
  const activeModals = getActiveModalElements();
  const vCenterY = window.innerHeight / 2;

  pendingScanQueue.sort((a, b) => {
    const aModal = activeModals.length > 0 && isElementInsideActiveModal(a, activeModals);
    const bModal = activeModals.length > 0 && isElementInsideActiveModal(b, activeModals);
    if (aModal && !bModal) return -1;
    if (!aModal && bModal) return 1;

    const aInVp = isElementInViewport(a);
    const bInVp = isElementInViewport(b);
    if (aInVp && !bInVp) return -1;
    if (!aInVp && bInVp) return 1;

    if (aInVp && bInVp) {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const aDist = Math.abs(ra.top + ra.height / 2 - vCenterY);
      const bDist = Math.abs(rb.top + rb.height / 2 - vCenterY);
      return aDist - bDist;
    }

    return 0;
  });

  while (activeScanCount < MAX_CONCURRENT_PAGE_SCANS && pendingScanQueue.length > 0) {
    const nextEl = pendingScanQueue.shift();
    if (!nextEl) break;

    if (nextEl.dataset.veripixelProcessed === 'true' || nextEl.dataset.veripixelProcessed === 'analyzing') {
      continue;
    }

    activeScanCount++;
    processElement(nextEl)
      .catch(() => {})
      .finally(() => {
        activeScanCount--;
        pumpScanQueue();
      });
  }
}

function processElement(el: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isDetectorEnabled || !isExtensionContextValid()) {
      resolve();
      return;
    }

    // Do not process or queue images while the tab is inactive/hidden
    if (document.visibilityState === 'hidden') {
      resolve();
      return;
    }

    if (el.dataset.veripixelProcessed === 'true' || el.dataset.veripixelProcessed === 'analyzing') {
      resolve();
      return;
    }

    // If image dimensions are not loaded yet (for <img>), attach load event listener
    if (el instanceof HTMLImageElement && (!el.complete || (el.naturalWidth === 0 && el.width === 0))) {
      const onLoad = () => {
        el.removeEventListener('load', onLoad);
        const inVp = isElementInViewport(el);
        const activeModals = getActiveModalElements();
        const isInsideModal = activeModals.length > 0 && isElementInsideActiveModal(el, activeModals);
        if (inVp || isInsideModal) {
          enqueueElementForScan(el);
        }
      };
      el.addEventListener('load', onLoad);
      resolve();
      return;
    }

    if (!isValidTargetElement(el)) {
      if (el.dataset.veripixelProcessed) {
        removeBadge(el);
      }
      resolve();
      return;
    }

    const imageUrl = getElementImageUrl(el);
    if (!imageUrl) {
      removeBadge(el);
      resolve();
      return;
    }

    // Avoid duplicate in-flight requests for identical images
    if (inFlightUrls.has(imageUrl)) {
      resolve();
      return;
    }

    el.dataset.veripixelProcessed = 'analyzing';
    injectLoadingBadge(el);
    inFlightUrls.add(imageUrl);

    const activeModals = getActiveModalElements();
    const isInsideModal = activeModals.length > 0 && isElementInsideActiveModal(el, activeModals);
    const inViewport = isElementInViewport(el);
    const priority: 'high' | 'normal' = isInsideModal || inViewport ? 'high' : 'normal';

    const sendDataUrlAnalysis = async () => {
      if (!isDetectorEnabled) {
        inFlightUrls.delete(imageUrl);
        removeBadge(el, false);
        resolve();
        return;
      }
      const dataUrl = await extractImageDataUrl(el);
      if (!dataUrl || !isExtensionContextValid() || !isDetectorEnabled) {
        inFlightUrls.delete(imageUrl);
        el.dataset.veripixelProcessed = 'failed';
        removeBadge(el, isDetectorEnabled);
        resolve();
        return;
      }

      try {
        chrome.runtime.sendMessage(
          {
            type: 'ANALYZE_IMAGE',
            imageUrl, // Pass original HTTP URL so ImageSummary and storage use clean URL
            dataUrl,  // Pass extracted base64 dataUrl for inference
            priority,
            isModal: isInsideModal,
            sampleMode: 'fast'
          } as ExtensionMessage,
          (response) => {
            inFlightUrls.delete(imageUrl);
            if (!isDetectorEnabled) {
              removeBadge(el, false);
              resolve();
              return;
            }
            if (!isExtensionContextValid() || chrome.runtime.lastError) {
              el.dataset.veripixelProcessed = 'failed';
              removeBadge(el, true);
              resolve();
              return;
            }
            if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
              if (response.result.status === 'complete') {
                injectImageBadge(el, response.result);
                el.dataset.veripixelProcessed = 'true';
              } else if (response.result.status === 'pending') {
                el.dataset.veripixelProcessed = 'pending';
              } else {
                el.dataset.veripixelProcessed = 'failed';
                removeBadge(el, true);
              }
            } else {
              el.dataset.veripixelProcessed = 'failed';
              removeBadge(el, true);
            }
            resolve();
          }
        );
      } catch {
        inFlightUrls.delete(imageUrl);
        el.dataset.veripixelProcessed = 'failed';
        removeBadge(el, isDetectorEnabled);
        resolve();
      }
    };

    // If URL is file:// or blob://, offscreen cannot fetch it over network; directly send data URL
    if (imageUrl.startsWith('file:') || imageUrl.startsWith('blob:')) {
      sendDataUrlAnalysis();
      return;
    }

    try {
      if (!isExtensionContextValid() || !isDetectorEnabled) {
        inFlightUrls.delete(imageUrl);
        removeBadge(el, isDetectorEnabled);
        resolve();
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: 'ANALYZE_IMAGE',
          imageUrl,
          priority,
          isModal: isInsideModal,
          sampleMode: 'fast'
        } as ExtensionMessage,
        async (response) => {
          inFlightUrls.delete(imageUrl);
          if (!isDetectorEnabled) {
            removeBadge(el, false);
            resolve();
            return;
          }
          if (!isExtensionContextValid() || chrome.runtime.lastError) {
            el.dataset.veripixelProcessed = 'failed';
            removeBadge(el, true);
            resolve();
            return;
          }

          if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
            if (response.result.status === 'complete') {
              injectImageBadge(el, response.result);
              el.dataset.veripixelProcessed = 'true';
              resolve();
            } else if (response.result.status === 'pending') {
              el.dataset.veripixelProcessed = 'pending';
              resolve();
            } else if (response.result.status === 'error') {
              const errStr = String(response.result.error || '');
              if (
                isDetectorEnabled &&
                !errStr.includes('disabled') &&
                !errStr.includes('timed out') &&
                !errStr.includes('cancelled') &&
                !errStr.includes('queue')
              ) {
                await sendDataUrlAnalysis();
              } else {
                el.dataset.veripixelProcessed = 'failed';
                removeBadge(el, isDetectorEnabled);
                resolve();
              }
            } else {
              el.dataset.veripixelProcessed = 'failed';
              removeBadge(el, isDetectorEnabled);
              resolve();
            }
          } else {
            el.dataset.veripixelProcessed = 'failed';
            removeBadge(el, isDetectorEnabled);
            resolve();
          }
        }
      );
    } catch (err) {
      inFlightUrls.delete(imageUrl);
      el.dataset.veripixelProcessed = 'failed';
      removeBadge(el, isDetectorEnabled);
      resolve();
    }
  });
}

// Intersection Observer for lazy scanning (50px tight margin so only genuinely visible images scan)
const observer = new IntersectionObserver(
  (entries) => {
    if (!isDetectorEnabled || !isExtensionContextValid()) return;
    if (document.visibilityState === 'hidden') return;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target instanceof HTMLElement) {
        if (!entry.target.dataset.veripixelProcessed || entry.target.dataset.veripixelProcessed === 'pending') {
          enqueueElementForScan(entry.target);
        }
      }
    }
  },
  {
    root: null,
    rootMargin: '50px',
    threshold: 0.01
  }
);

// Resize Observer to pick up modal/responsive images as soon as they layout & resize
const resizeObserver = new ResizeObserver((entries) => {
  if (!isDetectorEnabled || !isExtensionContextValid()) return;
  for (const entry of entries) {
    const target = entry.target as HTMLElement;
    if (!target.dataset.veripixelProcessed || target.dataset.veripixelProcessed === 'pending') {
      if (isValidTargetElement(target)) {
        const inViewport = isElementInViewport(target);
        const activeModals = getActiveModalElements();
        const isInsideModal = activeModals.length > 0 && isElementInsideActiveModal(target, activeModals);
        if (inViewport || isInsideModal) {
          enqueueElementForScan(target);
        }
      }
    } else {
      if (!isValidTargetElement(target)) {
        removeBadge(target);
      } else {
        updateBadgePosition(target);
      }
    }
  }
});

function observeElement(el: HTMLElement, immediateCheck = false): void {
  if (!isDetectorEnabled) return;
  if (!isValidTargetElement(el)) {
    if (el.dataset.veripixelProcessed) {
      removeBadge(el);
    }
    return;
  }

  observer.observe(el);
  resizeObserver.observe(el);

  if (immediateCheck && (!el.dataset.veripixelProcessed || el.dataset.veripixelProcessed === 'pending')) {
    enqueueElementForScan(el);
  }
}

function isElementInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

const TARGET_IMAGE_SELECTOR =
  'img, picture source, [style*="background-image"], [style*="background:"], [role="img"], figure';

function scanDOM(): void {
  if (!isDetectorEnabled || !isExtensionContextValid()) return;
  if (document.visibilityState === 'hidden') return;

  const elements = Array.from(document.querySelectorAll<HTMLElement>(TARGET_IMAGE_SELECTOR));
  const visibleElements: HTMLElement[] = [];
  const offscreenElements: HTMLElement[] = [];

  for (const el of elements) {
    if (!isValidTargetElement(el)) continue;
    if (isElementInViewport(el)) {
      visibleElements.push(el);
    } else {
      offscreenElements.push(el);
    }
  }

  // Sort visible elements top-to-bottom, left-to-right (visual reading order)
  // This guarantees that all columns in multi-column CSS / masonry layouts (like Pixlr) are scanned in visual order
  visibleElements.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 20) {
      return ra.top - rb.top;
    }
    return ra.left - rb.left;
  });

  // Prioritize and immediately process the top 6 most prominent visible elements.
  // The rest are observed lazily via IntersectionObserver, preventing CPU and IPC flooding on infinite-scroll pages like Pinterest.
  const MAX_IMMEDIATE_VISIBLE_SCANS = 6;
  visibleElements.slice(0, MAX_IMMEDIATE_VISIBLE_SCANS).forEach((el) => {
    observeElement(el, true);
  });
  visibleElements.slice(MAX_IMMEDIATE_VISIBLE_SCANS).forEach((el) => {
    observeElement(el, false);
  });

  // Observe offscreen elements for lazy scanning via IntersectionObserver
  offscreenElements.forEach((el) => {
    observeElement(el, false);
  });
}

let modalCheckScheduled = false;
function scheduleModalStateCheck(): void {
  if (!isDetectorEnabled || modalCheckScheduled) return;
  modalCheckScheduled = true;
  requestAnimationFrame(() => {
    modalCheckScheduled = false;
    handleModalStateCheck();
  });
}

let scanTimer: any = null;
function scheduleScanDOM(immediate = false): void {
  if (!isDetectorEnabled) return;
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(
    () => {
      scanTimer = null;
      scanDOM();
    },
    immediate ? 80 : 350
  );
}

function handleModalStateCheck(): void {
  checkPageModalState(() => {
    // When modal closes, resume scanning visible background images
    scheduleScanDOM();
  });
}

function setDetectorEnabledState(enabled: boolean): void {
  if (isDetectorEnabled === enabled && isInitialized) return;
  isDetectorEnabled = enabled;
  isInitialized = true;
  setOverlayEnabled(enabled);

  if (!enabled) {
    pendingScanQueue.length = 0;
    activeScanCount = 0;
    inFlightUrls.clear();
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    observer.disconnect();
    resizeObserver.disconnect();
    removeAllBadges(false);
  } else {
    scheduleScanDOM(true);
    scheduleModalStateCheck();
  }
}

// Check persisted extensionEnabled state before running initial DOM scan
if (isExtensionContextValid()) {
  try {
    chrome.storage.local.get('extensionEnabled', (res) => {
      const isEnabled = !(res && res.extensionEnabled === false);
      setDetectorEnabledState(isEnabled);
    });
  } catch {
    setDetectorEnabledState(true);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.extensionEnabled !== undefined) {
        setDetectorEnabledState(Boolean(changes.extensionEnabled.newValue));
      }
    });
  } catch {}
} else {
  setDetectorEnabledState(true);
}

// Non-blocking MutationObserver that avoids forced synchronous style recalcs
const mutationObserver = new MutationObserver((mutations) => {
  if (!isDetectorEnabled || !isInitialized || !isExtensionContextValid()) return;
  if (document.visibilityState === 'hidden') return;

  let shouldRescan = false;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (isDetectorElement(node)) {
            return;
          }
          shouldRescan = true;
          scheduleModalStateCheck();
          if (isValidTargetElement(node)) {
            observeElement(node, isElementInViewport(node));
          }
          // In case a container card was added (e.g. <a class="community-item"><img></a>)
          node.querySelectorAll<HTMLElement>(TARGET_IMAGE_SELECTOR).forEach((child) => {
            if (isValidTargetElement(child)) {
              observeElement(child, isElementInViewport(child));
            }
          });
        }
      });

      mutation.removedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.dataset?.veripixelProcessed) {
            removeBadge(node);
          }
          scheduleModalStateCheck();
        }
      });
    } else if (mutation.type === 'attributes') {
      const target = mutation.target as HTMLElement;
      if (isDetectorElement(target)) {
        continue;
      }

      if (
        mutation.attributeName === 'src' ||
        mutation.attributeName === 'srcset' ||
        mutation.attributeName === 'data-src'
      ) {
        if (target instanceof HTMLImageElement) {
          delete target.dataset.veripixelProcessed;
          if (isValidTargetElement(target)) {
            observeElement(target, isElementInViewport(target));
          }
        }
      } else if (
        mutation.attributeName === 'open' ||
        mutation.attributeName === 'aria-modal' ||
        mutation.attributeName === 'aria-hidden' ||
        mutation.attributeName === 'class' ||
        mutation.attributeName === 'style' ||
        mutation.attributeName === 'hidden' ||
        mutation.attributeName === 'data-state' ||
        mutation.attributeName === 'role'
      ) {
        scheduleModalStateCheck();
        if (
          mutation.attributeName === 'open' ||
          mutation.attributeName === 'aria-modal' ||
          mutation.attributeName === 'data-state'
        ) {
          shouldRescan = true;
        }
      }
    }
  }

  if (shouldRescan) {
    scheduleModalStateCheck();
    scheduleScanDOM(true);
  }
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'data-src', 'style', 'class', 'open', 'hidden', 'aria-modal', 'aria-hidden', 'data-state', 'role']
});

mutationObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'style', 'data-state']
});

// Event listeners to instantly detect page popover and dialog openings/closures
document.addEventListener(
  'toggle',
  (e) => {
    if (!isDetectorEnabled) return;
    const target = e.target as HTMLElement;
    if (target && !isDetectorElement(target)) {
      scheduleModalStateCheck();
    }
  },
  true
);

document.addEventListener(
  'close',
  () => {
    if (!isDetectorEnabled) return;
    scheduleModalStateCheck();
  },
  true
);

document.addEventListener(
  'keydown',
  (e) => {
    if (!isDetectorEnabled) return;
    if (e.key === 'Escape') {
      scheduleModalStateCheck();
      setTimeout(scheduleModalStateCheck, 100);
      setTimeout(scheduleModalStateCheck, 300);
    }
  },
  true
);

// User click hook: modals and lightboxes are triggered on click
document.addEventListener(
  'click',
  () => {
    if (!isDetectorEnabled || !isExtensionContextValid()) return;
    scheduleModalStateCheck();
    setTimeout(scheduleModalStateCheck, 100);
    setTimeout(scheduleModalStateCheck, 300);
    scheduleScanDOM();
  },
  { passive: true }
);

// CSS animation/transition completion hooks for animated modals
document.addEventListener(
  'transitionend',
  (e) => {
    if (!isDetectorEnabled) return;
    const target = e.target as HTMLElement;
    if (target && !isDetectorElement(target)) {
      scheduleModalStateCheck();
    }
  },
  true
);

document.addEventListener(
  'animationend',
  (e) => {
    if (!isDetectorEnabled) return;
    const target = e.target as HTMLElement;
    if (target && !isDetectorElement(target)) {
      scheduleModalStateCheck();
    }
  },
  true
);

window.addEventListener('resize', () => { if (isDetectorEnabled) scheduleModalStateCheck(); }, { passive: true });
window.addEventListener('popstate', () => { if (isDetectorEnabled) scheduleModalStateCheck(); }, { passive: true });

// Rescan DOM whenever user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (!isDetectorEnabled || !isExtensionContextValid()) return;
  if (document.visibilityState === 'visible') {
    scheduleModalStateCheck();
    scheduleScanDOM();
  }
});

// Listen for global state changes and popup jump-to-image requests
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'GLOBAL_STATE_CHANGED') {
    setDetectorEnabledState(Boolean(message.enabled));
    return;
  }

  if (message.type === 'HIGHLIGHT_IMAGE_ON_PAGE') {
    if (!isDetectorEnabled) return;
    const targetUrl = message.imageUrl;
    const allImages = document.querySelectorAll<HTMLElement>('img, [style*="background"]');
    for (const el of allImages) {
      if (getElementImageUrl(el) === targetUrl) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'outline 0.3s ease, box-shadow 0.3s ease';
        el.style.outline = '4px solid #3B82F6';
        el.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.7)';
        setTimeout(() => {
          el.style.outline = '';
          el.style.boxShadow = '';
        }, 2200);
        break;
      }
    }
  }
});

