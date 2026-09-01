import { injectImageBadge, injectLoadingBadge, removeBadge } from './overlay';
import { ExtensionMessage } from '../shared/types';

console.log('[ContentScript] AI Image Detector scanner initialized.');

const MIN_IMAGE_SIZE = 50; // Catch thumbnails, cards, and avatars (>= 50px)

function isValidTargetImage(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src || '';
  if (!src) return false;

  // Allow http, https, data URIs, and blob URIs
  if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
    return false;
  }

  // Ignore 1x1 transparent tracking pixels / base64 placeholders
  if (src.startsWith('data:') && src.length < 200) {
    return false;
  }

  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;

  if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) {
    return false;
  }

  return true;
}

function processImage(img: HTMLImageElement): void {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }

  if (img.dataset.aiDetectorProcessed === 'true') {
    return;
  }

  // If image dimensions are not loaded yet, attach load event listener
  if (!img.complete || (img.naturalWidth === 0 && img.width === 0)) {
    const onLoad = () => {
      img.removeEventListener('load', onLoad);
      processImage(img);
    };
    img.addEventListener('load', onLoad);
    return;
  }

  if (!isValidTargetImage(img)) {
    return;
  }

  img.dataset.aiDetectorProcessed = 'true';
  injectLoadingBadge(img);

  const imageUrl = img.currentSrc || img.src;

  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      removeBadge(img);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_IMAGE', imageUrl } as ExtensionMessage,
      (response) => {
        if (chrome.runtime.lastError) {
          removeBadge(img);
          return;
        }

        if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
          if (response.result.status === 'complete') {
            injectImageBadge(img, response.result);
          } else if (response.result.status === 'error') {
            removeBadge(img);
          }
        }
      }
    );
  } catch (err) {
    removeBadge(img);
  }
}

// Intersection Observer for lazy scanning
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target instanceof HTMLImageElement) {
        processImage(entry.target);
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
  const images = document.querySelectorAll('img');
  images.forEach((img) => {
    observer.observe(img);
    if (!img.dataset.aiDetectorProcessed) {
      processImage(img);
    }
  });
}

// Initial DOM Scan
scanDOM();

// MutationObserver for dynamically added nodes AND src/srcset attribute changes
const mutationObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          observer.observe(node);
          processImage(node);
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('img').forEach((img) => {
            observer.observe(img);
            processImage(img);
          });
        }
      });
    } else if (mutation.type === 'attributes') {
      if (mutation.target instanceof HTMLImageElement) {
        delete mutation.target.dataset.aiDetectorProcessed;
        observer.observe(mutation.target);
        processImage(mutation.target);
      }
    }
  }
});

mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'data-src']
});

// Rescan DOM whenever user switches back to this tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scanDOM();
  }
});
