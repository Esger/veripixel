import { injectImageBadge, injectLoadingBadge, removeBadge } from './overlay';
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

function getElementImageUrl(el: HTMLElement): string | null {
  if (el instanceof HTMLImageElement) {
    return el.currentSrc || el.src || null;
  }

  const style = window.getComputedStyle(el);
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
    const match = bgImage.match(/^url\((['"]?)(.*?)\1\)/);
    if (match && match[2]) {
      return match[2];
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
    width = el.naturalWidth || el.width || 0;
    height = el.naturalHeight || el.height || 0;
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

  try {
    if (!isExtensionContextValid()) {
      removeBadge(el);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_IMAGE', imageUrl } as ExtensionMessage,
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

function scanDOM(): void {
  if (!isExtensionContextValid()) return;

  // Query <img> tags as well as elements commonly used for CSS background-images
  const elements = document.querySelectorAll<HTMLElement>('img, [style*="background"], div, section, a, span');
  elements.forEach((el) => {
    const bg = el instanceof HTMLImageElement ? '' : window.getComputedStyle(el).backgroundImage;
    if (el instanceof HTMLImageElement || (bg && bg !== 'none')) {
      observer.observe(el);
      if (!el.dataset.aiDetectorProcessed) {
        processElement(el);
      }
    }
  });
}

// Initial DOM Scan
scanDOM();

// MutationObserver for dynamically added nodes AND src/srcset/style attribute changes
const mutationObserver = new MutationObserver((mutations) => {
  if (!isExtensionContextValid()) return;

  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node instanceof HTMLImageElement || window.getComputedStyle(node).backgroundImage !== 'none') {
            observer.observe(node);
            processElement(node);
          }
          node.querySelectorAll<HTMLElement>('img, [style*="background"], div, section, a, span').forEach((child) => {
            const bg = child instanceof HTMLImageElement ? '' : window.getComputedStyle(child).backgroundImage;
            if (child instanceof HTMLImageElement || (bg && bg !== 'none')) {
              observer.observe(child);
              processElement(child);
            }
          });
        }
      });
    } else if (mutation.type === 'attributes') {
      if (mutation.target instanceof HTMLElement) {
        delete mutation.target.dataset.aiDetectorProcessed;
        observer.observe(mutation.target);
        processElement(mutation.target);
      }
    }
  }
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'data-src', 'style', 'class']
});

// Rescan DOM whenever user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (!isExtensionContextValid()) return;
  if (document.visibilityState === 'visible') {
    scanDOM();
  }
});
