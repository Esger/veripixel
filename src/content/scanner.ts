import {
  injectImageBadge,
  injectLoadingBadge,
  removeBadge,
  updateBadgePosition,
  checkPageModalState,
  getActiveModalElements,
  isElementInsideActiveModal
} from './overlay';
import { ExtensionMessage } from '../shared/types';

console.log('[ContentScript] AI Image Detector scanner initialized.');

const MIN_IMAGE_SIZE = 50; // Catch thumbnails, cards, and avatars (>= 50px)

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

  let width = 0;
  let height = 0;
  if (el instanceof HTMLImageElement) {
    width = el.naturalWidth || el.width || el.offsetWidth || 0;
    height = el.naturalHeight || el.height || el.offsetHeight || 0;
  } else {
    const rect = el.getBoundingClientRect();
    width = el.offsetWidth || rect.width || 0;
    height = el.offsetHeight || rect.height || 0;
  }

  if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) {
    return false;
  }

  return true;
}

function processElement(el: HTMLElement): void {
  if (!isExtensionContextValid()) {
    return;
  }

  if (el.dataset.aiDetectorProcessed === 'true') {
    return;
  }

  // If image dimensions are not loaded yet (for <img>), attach load event listener
  if (el instanceof HTMLImageElement && (!el.complete || (el.naturalWidth === 0 && el.width === 0))) {
    const onLoad = () => {
      el.removeEventListener('load', onLoad);
      processElement(el);
    };
    el.addEventListener('load', onLoad);
    return;
  }

  if (!isValidTargetElement(el)) {
    return;
  }

  el.dataset.aiDetectorProcessed = 'true';
  injectLoadingBadge(el);

  const imageUrl = getElementImageUrl(el);
  if (!imageUrl) {
    removeBadge(el);
    return;
  }

  const activeModals = getActiveModalElements();
  const isInsideModal = activeModals.length > 0 && isElementInsideActiveModal(el, activeModals);
  const priority = isInsideModal ? 'high' : 'normal';

  try {
    if (!isExtensionContextValid()) {
      removeBadge(el);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'ANALYZE_IMAGE',
        imageUrl,
        priority,
        isModal: isInsideModal
      } as ExtensionMessage,
      (response) => {
        if (!isExtensionContextValid() || chrome.runtime.lastError) {
          removeBadge(el);
          return;
        }

        if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
          if (response.result.status === 'complete') {
            injectImageBadge(el, response.result);
          } else if (response.result.status === 'error') {
            removeBadge(el);
          }
        }
      }
    );
  } catch (err) {
    removeBadge(el);
  }
}

// Intersection Observer for lazy scanning
const observer = new IntersectionObserver(
  (entries) => {
    if (!isExtensionContextValid()) return;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target instanceof HTMLElement) {
        processElement(entry.target);
      }
    }
  },
  {
    root: null,
    rootMargin: '200px',
    threshold: 0.01
  }
);

// Resize Observer to pick up modal/responsive images as soon as they layout & resize
const resizeObserver = new ResizeObserver((entries) => {
  if (!isExtensionContextValid()) return;
  for (const entry of entries) {
    const target = entry.target as HTMLElement;
    if (!target.dataset.aiDetectorProcessed) {
      if (isValidTargetElement(target)) {
        processElement(target);
      }
    } else {
      updateBadgePosition(target);
    }
  }
});

function observeElement(el: HTMLElement, immediateCheck = false): void {
  observer.observe(el);
  resizeObserver.observe(el);

  if (immediateCheck && !el.dataset.aiDetectorProcessed && isValidTargetElement(el)) {
    processElement(el);
  }
}

function scanDOM(): void {
  if (!isExtensionContextValid()) return;

  const elements = document.querySelectorAll<HTMLElement>('img, [style*="background"], div, section, a, span');
  elements.forEach((el) => {
    const bg = el instanceof HTMLImageElement ? '' : window.getComputedStyle(el).backgroundImage;
    if (el instanceof HTMLImageElement || (bg && bg !== 'none')) {
      const rect = el.getBoundingClientRect();
      const isVisibleInViewport =
        rect.width >= MIN_IMAGE_SIZE &&
        rect.height >= MIN_IMAGE_SIZE &&
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0;
      observeElement(el, isVisibleInViewport);
    }
  });
}

function handleModalStateCheck(): void {
  checkPageModalState(() => {
    // When modal closes, resume scanning visible background images
    setTimeout(() => scanDOM(), 50);
    setTimeout(() => scanDOM(), 250);
  });
}

// Initial DOM Scan
scanDOM();
handleModalStateCheck();

// MutationObserver for dynamically added nodes AND src/srcset/style/class attribute changes (modals)
const mutationObserver = new MutationObserver((mutations) => {
  if (!isExtensionContextValid()) return;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          const bg = node instanceof HTMLImageElement ? '' : window.getComputedStyle(node).backgroundImage;
          if (node instanceof HTMLImageElement || (bg && bg !== 'none')) {
            observeElement(node, true);
          }
          node.querySelectorAll<HTMLElement>('img, [style*="background"], div, section, a, span').forEach((child) => {
            const childBg = child instanceof HTMLImageElement ? '' : window.getComputedStyle(child).backgroundImage;
            if (child instanceof HTMLImageElement || (childBg && childBg !== 'none')) {
              observeElement(child, true);
            }
          });
        }
      });

      mutation.removedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          removeBadge(node);
          node.querySelectorAll<HTMLElement>('img, [style*="background"], div, section, a, span').forEach((child) => {
            removeBadge(child);
          });
        }
      });
    } else if (mutation.type === 'attributes') {
      if (mutation.target instanceof HTMLElement) {
        const target = mutation.target;
        const isTargetImage = target instanceof HTMLImageElement || window.getComputedStyle(target).backgroundImage !== 'none';
        if (isTargetImage) {
          delete target.dataset.aiDetectorProcessed;
          observeElement(target, true);
        }
        // Deep scan when modal containers change class/style/open
        target.querySelectorAll<HTMLElement>('img, [style*="background"]').forEach((child) => {
          const childBg = child instanceof HTMLImageElement ? '' : window.getComputedStyle(child).backgroundImage;
          if (child instanceof HTMLImageElement || (childBg && childBg !== 'none')) {
            observeElement(child, true);
          }
        });
      }
    }
  }

  // Update modal state to hide/revert badges and dropdowns
  handleModalStateCheck();
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'data-src', 'style', 'class', 'open', 'hidden', 'aria-modal']
});

mutationObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'style']
});

// Event listeners to instantly detect page popover and dialog openings/closures
document.addEventListener(
  'toggle',
  (e) => {
    const target = e.target as HTMLElement;
    if (target && !target.classList.contains('detectorBadge') && !target.classList.contains('detectorTooltip')) {
      handleModalStateCheck();
    }
  },
  true
);

document.addEventListener(
  'close',
  () => {
    handleModalStateCheck();
  },
  true
);

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      setTimeout(handleModalStateCheck, 50);
    }
  },
  true
);

// User click hook: modals and lightboxes are triggered on click
document.addEventListener(
  'click',
  () => {
    if (!isExtensionContextValid()) return;
    setTimeout(() => {
      handleModalStateCheck();
      scanDOM();
    }, 100);
    setTimeout(() => {
      handleModalStateCheck();
      scanDOM();
    }, 400);
  },
  { passive: true }
);

// Scroll & visibility listener
window.addEventListener(
  'scroll',
  () => {
    if (!isExtensionContextValid()) return;
    document.querySelectorAll<HTMLElement>('[data-ai-detector-badge-injected]').forEach((el) => {
      updateBadgePosition(el);
    });
  },
  { passive: true }
);

// Rescan DOM whenever user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (!isExtensionContextValid()) return;
  if (document.visibilityState === 'visible') {
    handleModalStateCheck();
    scanDOM();
  }
});
