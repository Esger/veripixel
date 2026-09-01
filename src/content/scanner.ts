import { injectImageBadge } from './overlay';
import { ExtensionMessage } from '../shared/types';

console.log('[ContentScript] AI Image Detector scanner initialized.');

const MIN_IMAGE_SIZE = 100; // Ignore tiny icons/buttons

function isValidTargetImage(img: HTMLImageElement): boolean {
  if (!img.src || !img.src.startsWith('http')) return false;

  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;

  if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) return false;

  return true;
}

function processImage(img: HTMLImageElement): void {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }

  if (img.dataset.aiDetectorProcessed === 'true') {
    return;
  }

  // If image dimensions are not loaded yet, wait for load event
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

  const imageUrl = img.src;

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_IMAGE', imageUrl } as ExtensionMessage,
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[ContentScript] Message error for image:', imageUrl, chrome.runtime.lastError.message);
        delete img.dataset.aiDetectorProcessed;
        return;
      }

      if (response && response.type === 'IMAGE_ANALYSIS_RESULT' && response.result) {
        if (response.result.status === 'complete') {
          injectImageBadge(img, response.result);
        } else if (response.result.status === 'error') {
          delete img.dataset.aiDetectorProcessed;
        }
      }
    }
  );
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
    rootMargin: '100px',
    threshold: 0.1
  }
);

function scanDOM(): void {
  const images = document.querySelectorAll('img');
  images.forEach((img) => observer.observe(img));
}

// Scan initially and observe DOM mutations for dynamic content (infinite scroll)
scanDOM();

const mutationObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLImageElement) {
        observer.observe(node);
      } else if (node instanceof HTMLElement) {
        node.querySelectorAll('img').forEach((img) => observer.observe(img));
      }
    });
  }
});

mutationObserver.observe(document.body, { childList: true, subtree: true });
