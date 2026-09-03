import { AnalysisResult } from '../shared/types';

interface BadgeEntry {
  badgeEl: HTMLElement;
  tooltipEl: HTMLElement;
  anchorName: string;
}

const badgeRegistry = new WeakMap<HTMLElement, BadgeEntry>();

function ensureGlobalStyles(): void {
  if (document.getElementById('ai-detector-top-layer-styles')) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'ai-detector-top-layer-styles';
  styleEl.textContent = `
    @keyframes cycleColors {
      0% { background-color: #10B981; box-shadow: 0 0 6px #10B981; }
      33% { background-color: #F59E0B; box-shadow: 0 0 6px #F59E0B; }
      66% { background-color: #EF4444; box-shadow: 0 0 6px #EF4444; }
      100% { background-color: #10B981; box-shadow: 0 0 6px #10B981; }
    }

    .detectorBadge {
      position: fixed;
      position-anchor: var(--badge-anchor);
      top: auto;
      left: auto;
      bottom: calc(anchor(bottom) + 6px);
      right: calc(anchor(right) + 6px);
      position-visibility: anchors-visible;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #64748B;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      transition: transform 0.15s ease, border-color 0.3s ease;
      user-select: none;
      margin: 0;
      inset: auto;
      z-index: 2147483640;
    }

    .detectorBadge:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    .detectorBadge__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: #10B981;
      box-shadow: 0 0 6px #10B981;
    }

    .detectorBadge__dot--loading {
      animation: cycleColors 1.2s infinite linear;
    }

    .detectorBadge__scoreText {
      color: #FFFFFF;
    }

    .detectorTooltip {
      position: fixed;
      position-anchor: var(--badge-anchor);
      top: auto;
      left: auto;
      bottom: calc(anchor(bottom) + 36px);
      right: calc(anchor(right) + 6px);
      position-try-fallbacks: flip-block;
      position-visibility: anchors-visible;
      margin: 0;
      padding: 12px;
      border: 1px solid #334155;
      border-radius: 10px;
      background: #0F172A;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      width: 220px;
      inset: auto;
      z-index: 2147483647;
    }

    .detectorTooltip__header {
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
    }

    .detectorTooltip__row {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 11px;
      color: #94A3B8;
    }

    .detectorTooltip__val {
      color: #E2E8F0;
      font-weight: 500;
    }

    .detectorTooltip__patchesGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #1E293B;
    }

    .detectorTooltip__patchItem {
      background: #1E293B;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 10px;
      text-align: center;
    }
  `;

  document.head.appendChild(styleEl);
}

export function updateBadgePosition(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

  const rect = targetEl.getBoundingClientRect();
  const isVisible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth &&
    window.getComputedStyle(targetEl).visibility !== 'hidden' &&
    window.getComputedStyle(targetEl).display !== 'none';

  if (!isVisible) {
    if (entry.badgeEl.matches(':popover-open')) {
      try {
        entry.badgeEl.hidePopover();
      } catch (e) {}
    }
    if (entry.tooltipEl.matches(':popover-open')) {
      try {
        entry.tooltipEl.hidePopover();
      } catch (e) {}
    }
    return;
  }

  if (!entry.badgeEl.matches(':popover-open')) {
    try {
      entry.badgeEl.showPopover();
    } catch (e) {}
  }

  // JS coordinate fallback if browser does not yet support CSS Anchor Positioning
  if (!('anchorName' in document.documentElement.style)) {
    const fallbackBottom = Math.max(6, window.innerHeight - rect.bottom + 6);
    const fallbackRight = Math.max(6, window.innerWidth - rect.right + 6);
    entry.badgeEl.style.bottom = `${fallbackBottom}px`;
    entry.badgeEl.style.right = `${fallbackRight}px`;
    entry.tooltipEl.style.bottom = `${fallbackBottom + 32}px`;
    entry.tooltipEl.style.right = `${fallbackRight}px`;
  }
}

export function injectLoadingBadge(targetEl: HTMLElement): void {
  if (targetEl.dataset.aiDetectorBadgeInjected) {
    return;
  }
  targetEl.dataset.aiDetectorBadgeInjected = 'loading';

  ensureGlobalStyles();

  // Generate unique anchor name for this image
  let anchorName = targetEl.dataset.aiDetectorAnchor;
  if (!anchorName) {
    const uuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).substring(2, 11);
    anchorName = `--ai-img-${uuid}`;
    targetEl.dataset.aiDetectorAnchor = anchorName;
  }

  // Assign anchor-name to target image
  targetEl.style.setProperty('anchor-name', anchorName);

  // Create badge popover in native top layer
  const badgeEl = document.createElement('div');
  badgeEl.className = 'detectorBadge';
  badgeEl.setAttribute('popover', 'manual');
  badgeEl.style.setProperty('--badge-anchor', anchorName);
  (badgeEl.style as any).positionAnchor = anchorName;
  badgeEl.innerHTML = `
    <span class="detectorBadge__dot detectorBadge__dot--loading"></span>
    <span class="detectorBadge__scoreText">...</span>
  `;

  // Create dropdown tooltip popover in native top layer
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'detectorTooltip';
  tooltipEl.setAttribute('popover', 'manual');
  tooltipEl.style.setProperty('--badge-anchor', anchorName);
  (tooltipEl.style as any).positionAnchor = anchorName;
  tooltipEl.innerHTML = `
    <div style="font-weight:600; color: #94A3B8;">Analyzing image with AI model...</div>
  `;

  const preventAndStop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const stopOnly = (e: Event) => {
    e.stopPropagation();
  };

  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((type) => {
    badgeEl.addEventListener(type, stopOnly);
    tooltipEl.addEventListener(type, stopOnly);
  });

  badgeEl.addEventListener('click', (e) => {
    preventAndStop(e);

    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      tooltipEl.hidePopover();
    } else if (typeof tooltipEl.showPopover === 'function') {
      tooltipEl.showPopover();
    }
  });

  // Light-dismiss on click outside
  document.addEventListener('click', (e) => {
    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      if (!tooltipEl.contains(e.target as Node) && !badgeEl.contains(e.target as Node)) {
        tooltipEl.hidePopover();
      }
    }
  });

  document.body.appendChild(badgeEl);
  document.body.appendChild(tooltipEl);

  badgeRegistry.set(targetEl, { badgeEl, tooltipEl, anchorName });

  try {
    badgeEl.showPopover();
  } catch (e) {
    console.warn('[Overlay] showPopover failed:', e);
  }

  updateBadgePosition(targetEl);
}

export function injectImageBadge(targetEl: HTMLElement, result: AnalysisResult): void {
  if (targetEl.dataset.aiDetectorBadgeInjected === 'true') {
    return;
  }

  // Ensure loading badge is created if not already present
  if (targetEl.dataset.aiDetectorBadgeInjected !== 'loading') {
    injectLoadingBadge(targetEl);
  }
  targetEl.dataset.aiDetectorBadgeInjected = 'true';

  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

  const { badgeEl, tooltipEl } = entry;

  const scorePercent = Math.round(result.aiScore * 100);
  let color = '#10B981'; // Green (<30%)
  let statusText = 'Likely Real';

  if (scorePercent >= 70) {
    color = '#EF4444'; // Red (>70%)
    statusText = 'High AI Probability';
  } else if (scorePercent >= 30) {
    color = '#F59E0B'; // Orange (30-70%)
    statusText = 'Possible AI/Edited';
  }

  badgeEl.style.borderColor = color;

  const dotEl = badgeEl.querySelector('.detectorBadge__dot') as HTMLElement | null;
  const scoreText = badgeEl.querySelector('.detectorBadge__scoreText') as HTMLElement | null;

  if (dotEl) {
    dotEl.classList.remove('detectorBadge__dot--loading');
    dotEl.style.backgroundColor = color;
    dotEl.style.boxShadow = `0 0 6px ${color}`;
  }

  if (scoreText) {
    scoreText.textContent = `${scorePercent}%`;
  }

  const patchesHtml = result.patchScores
    .map(
      (p) =>
        `<div class="detectorTooltip__patchItem">${p.position}: <strong style="color: ${
          p.aiScore >= 0.7 ? '#EF4444' : '#10B981'
        }">${Math.round(p.aiScore * 100)}%</strong></div>`
    )
    .join('');

  tooltipEl.innerHTML = `
    <div class="detectorTooltip__header" style="color: ${color}">
      <span>${statusText}</span>
      <span>${scorePercent}% AI</span>
    </div>
    <div class="detectorTooltip__row">
      <span>EXIF Camera:</span>
      <span class="detectorTooltip__val">${result.metadata.cameraModel || (result.metadata.exifPresent ? 'Present' : 'None/Stripped')}</span>
    </div>
    <div class="detectorTooltip__row">
      <span>C2PA Signature:</span>
      <span class="detectorTooltip__val">${result.metadata.c2paPresent ? 'Detected' : 'None'}</span>
    </div>
    <div class="detectorTooltip__row">
      <span>Quality score:</span>
      <span class="detectorTooltip__val">${Math.round(result.metadata.qualityScore * 100)}%</span>
    </div>
    <div class="detectorTooltip__patchesGrid">
      ${patchesHtml}
    </div>
  `;

  updateBadgePosition(targetEl);
}

export function removeBadge(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (entry) {
    try {
      if (entry.badgeEl.matches(':popover-open')) {
        entry.badgeEl.hidePopover();
      }
    } catch (e) {}
    entry.badgeEl.remove();

    try {
      if (entry.tooltipEl.matches(':popover-open')) {
        entry.tooltipEl.hidePopover();
      }
    } catch (e) {}
    entry.tooltipEl.remove();

    badgeRegistry.delete(targetEl);
  }

  targetEl.style.removeProperty('anchor-name');
  delete targetEl.dataset.aiDetectorAnchor;
  delete targetEl.dataset.aiDetectorBadgeInjected;
  delete targetEl.dataset.aiDetectorProcessed;
}
