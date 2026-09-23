import {
  injectLoadingBadge,
  injectImageBadge,
  removeBadge,
  removeAllBadges,
  updateBadgePosition,
  checkPageModalState,
  getActiveModalElements,
  isElementInsideActiveModal,
  isDetectorElement
} from './overlay';
import { ExtensionMessage } from '../shared/types';

let isDetectorEnabled = true;

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
const MAX_CONCURRENT_PAGE_SCANS = 3;
let activeScanCount = 0;
const pendingScanQueue: HTMLElement[] = [];

function enqueueElementForScan(el: HTMLElement): void {
  if (
    !isExtensionContextValid() ||
    el.dataset.aiDetectorProcessed === 'true' ||
    el.dataset.aiDetectorProcessed === 'analyzing'
  ) {
    return;
  }
  if (!pendingScanQueue.includes(el)) {
    pendingScanQueue.push(el);
  }
  pumpScanQueue();
}

function pumpScanQueue(): void {
  if (!isExtensionContextValid() || document.visibilityState === 'hidden') {
    return;
  }

  // Prune invalid or already processed elements
  for (let i = pendingScanQueue.length - 1; i >= 0; i--) {
    const el = pendingScanQueue[i];
    if (!document.contains(el) || !isValidTargetElement(el) || el.dataset.aiDetectorProcessed === 'true') {
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

    if (nextEl.dataset.aiDetectorProcessed === 'true' || nextEl.dataset.aiDetectorProcessed === 'analyzing') {
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
    if (!isExtensionContextValid()) {
      resolve();
      return;
    }

    // Do not process or queue images while the tab is inactive/hidden
    if (document.visibilityState === 'hidden') {
      resolve();
      return;
    }

    if (el.dataset.aiDetectorProcessed === 'true' || el.dataset.aiDetectorProcessed === 'analyzing') {
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
      if (el.dataset.aiDetectorProcessed) {
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

    el.dataset.aiDetectorProcessed = 'analyzing';
    injectLoadingBadge(el);
    inFlightUrls.add(imageUrl);

    const activeModals = getActiveModalElements();
    const isInsideModal = activeModals.length > 0 && isElementInsideActiveModal(el, activeModals);
    const inViewport = isElementInViewport(el);
    const priority: 'high' | 'normal' = isInsideModal || inViewport ? 'high' : 'normal';

    const sendDataUrlAnalysis = async () => {
      const dataUrl = await extractImageDataUrl(el);
      if (!dataUrl || !isExtensionContextValid()) {
        inFlightUrls.delete(imageUrl);
        el.dataset.aiDetectorProcessed = 'failed';
        removeBadge(el, true);
        resolve();
        return;
      }

      try {
        chrome.runtime.sendMessage(
          {
            type: 'ANALYZE_IMAGE',
            imageUrl: dataUrl,
            priority,
            isModal: isInsideModal,
            sampleMode: 'fast'
          } as ExtensionMessage,
          (response) => {
            inFlightUrls.delete(imageUrl);
            if (!isExtensionContextValid() || chrome.runtime.lastError) {
              el.dataset.aiDetectorProcessed = 'failed';
              removeBadge(el, true);
              resolve();
              return;
            }
            if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
              if (response.result.status === 'complete') {
                injectImageBadge(el, response.result);
                el.dataset.aiDetectorProcessed = 'true';
              } else if (response.result.status === 'pending') {
                el.dataset.aiDetectorProcessed = 'pending';
              } else {
                el.dataset.aiDetectorProcessed = 'failed';
                removeBadge(el, true);
              }
            } else {
              el.dataset.aiDetectorProcessed = 'failed';
              removeBadge(el, true);
            }
            resolve();
          }
        );
      } catch {
        inFlightUrls.delete(imageUrl);
        el.dataset.aiDetectorProcessed = 'failed';
        removeBadge(el, true);
        resolve();
      }
    };

    // If URL is file:// or blob://, offscreen cannot fetch it over network; directly send data URL
    if (imageUrl.startsWith('file:') || imageUrl.startsWith('blob:')) {
      sendDataUrlAnalysis();
      return;
    }

    try {
      if (!isExtensionContextValid()) {
        inFlightUrls.delete(imageUrl);
        removeBadge(el, true);
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
          if (!isExtensionContextValid() || chrome.runtime.lastError) {
            el.dataset.aiDetectorProcessed = 'failed';
            removeBadge(el, true);
            resolve();
            return;
          }

          if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
            if (response.result.status === 'complete') {
              injectImageBadge(el, response.result);
              el.dataset.aiDetectorProcessed = 'true';
              resolve();
            } else if (response.result.status === 'pending') {
              el.dataset.aiDetectorProcessed = 'pending';
              resolve();
            } else if (response.result.status === 'error') {
              const errStr = String(response.result.error || '');
              if (
                !errStr.includes('timed out') &&
                !errStr.includes('cancelled') &&
                !errStr.includes('queue')
              ) {
                await sendDataUrlAnalysis();
              } else {
                el.dataset.aiDetectorProcessed = 'failed';
                removeBadge(el, true);
                resolve();
              }
            } else {
              el.dataset.aiDetectorProcessed = 'failed';
              removeBadge(el, true);
              resolve();
            }
          } else {
            el.dataset.aiDetectorProcessed = 'failed';
            removeBadge(el, true);
            resolve();
          }
        }
      );
    } catch (err) {
      inFlightUrls.delete(imageUrl);
      el.dataset.aiDetectorProcessed = 'failed';
      removeBadge(el, true);
      resolve();
    }
  });
}

// Intersection Observer for lazy scanning (50px tight margin so only genuinely visible images scan)
const observer = new IntersectionObserver(
  (entries) => {
    if (!isExtensionContextValid()) return;
    if (document.visibilityState === 'hidden') return;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target instanceof HTMLElement) {
        if (!entry.target.dataset.aiDetectorProcessed || entry.target.dataset.aiDetectorProcessed === 'pending') {
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
  if (!isExtensionContextValid()) return;
  for (const entry of entries) {
    const target = entry.target as HTMLElement;
    if (!target.dataset.aiDetectorProcessed || target.dataset.aiDetectorProcessed === 'pending') {
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
  if (!isValidTargetElement(el)) {
    if (el.dataset.aiDetectorProcessed) {
      removeBadge(el);
    }
    return;
  }

  observer.observe(el);
  resizeObserver.observe(el);

  if (immediateCheck && (!el.dataset.aiDetectorProcessed || el.dataset.aiDetectorProcessed === 'pending')) {
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
  if (!isExtensionContextValid()) return;
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

  // Prioritize and immediately process visible elements in visual reading order
  visibleElements.forEach((el) => {
    observeElement(el, true);
  });

  // Observe offscreen elements for lazy scanning via IntersectionObserver
  offscreenElements.forEach((el) => {
    observeElement(el, false);
  });
}

const scheduleIdleTask =
  typeof requestIdleCallback !== 'undefined'
    ? (cb: () => void) => requestIdleCallback(cb, { timeout: 400 })
    : (cb: () => void) => setTimeout(cb, 60);

let modalCheckScheduled = false;
function scheduleModalStateCheck(): void {
  if (!isDetectorEnabled || modalCheckScheduled) return;
  modalCheckScheduled = true;
  requestAnimationFrame(() => {
    modalCheckScheduled = false;
    handleModalStateCheck();
  });
}

let scanScheduled = false;
function scheduleScanDOM(immediate = false): void {
  if (!isDetectorEnabled || scanScheduled) return;
  scanScheduled = true;
  if (immediate) {
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanDOM();
    });
  } else {
    scheduleIdleTask(() => {
      scanScheduled = false;
      scanDOM();
    });
  }
}

function handleModalStateCheck(): void {
  checkPageModalState(() => {
    // When modal closes, resume scanning visible background images
    scheduleScanDOM();
  });
}

// Check persisted extensionEnabled state before running initial DOM scan
if (isExtensionContextValid()) {
  try {
    chrome.storage.local.get('extensionEnabled', (res) => {
      if (res && res.extensionEnabled === false) {
        isDetectorEnabled = false;
      } else {
        isDetectorEnabled = true;
        scheduleScanDOM(true);
        scheduleModalStateCheck();
      }
    });
  } catch {
    scheduleScanDOM(true);
    scheduleModalStateCheck();
  }
} else {
  scheduleScanDOM(true);
  scheduleModalStateCheck();
}

// Non-blocking MutationObserver that avoids forced synchronous style recalcs
const mutationObserver = new MutationObserver((mutations) => {
  if (!isExtensionContextValid()) return;
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
          if (node.dataset?.aiDetectorProcessed) {
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
          delete target.dataset.aiDetectorProcessed;
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
    scheduleModalStateCheck();
  },
  true
);

document.addEventListener(
  'keydown',
  (e) => {
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
    if (!isExtensionContextValid()) return;
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
    const target = e.target as HTMLElement;
    if (target && !isDetectorElement(target)) {
      scheduleModalStateCheck();
    }
  },
  true
);

window.addEventListener('resize', scheduleModalStateCheck, { passive: true });
window.addEventListener('popstate', scheduleModalStateCheck, { passive: true });

// Rescan DOM whenever user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (!isExtensionContextValid()) return;
  if (document.visibilityState === 'visible') {
    scheduleModalStateCheck();
    scheduleScanDOM();
  }
});

// Listen for global state changes and popup jump-to-image requests
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'GLOBAL_STATE_CHANGED') {
    isDetectorEnabled = message.enabled;
    if (!message.enabled) {
      pendingScanQueue.length = 0;
      activeScanCount = 0;
      removeAllBadges(false);
    } else {
      scheduleScanDOM(true);
      scheduleModalStateCheck();
    }
    return;
  }

  if (message.type === 'HIGHLIGHT_IMAGE_ON_PAGE') {
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

