import { AnalysisResult } from '../shared/types';

interface BadgeEntry {
  badgeEl: HTMLElement;
  tooltipEl: HTMLElement;
  anchorName: string;
}

const badgeRegistry = new WeakMap<HTMLElement, BadgeEntry>();
let isSuspendedDueToModal = false;

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
      inset: auto;
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
      inset: auto;
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

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isPageModalActive(): boolean {
  // 1. Check for native <dialog open> (excluding our own elements)
  const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  for (const dialog of openDialogs) {
    if (!dialog.classList.contains('detectorBadge') && !dialog.classList.contains('detectorTooltip')) {
      return true;
    }
  }

  // 2. Check for native open popovers on the page (excluding our own elements)
  const popovers = document.querySelectorAll<HTMLElement>('[popover]:not(.detectorBadge):not(.detectorTooltip)');
  for (const popover of popovers) {
    try {
      if (popover.matches(':popover-open')) {
        return true;
      }
    } catch (e) {}
  }

  // 3. Check for elements with aria-modal="true" that are visible
  const ariaModals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  for (const modal of ariaModals) {
    if (isElementVisible(modal)) {
      return true;
    }
  }

  // 4. Check for visible fixed/absolute elements with class containing modal, dialog, or lightbox
  const modalCandidates = document.querySelectorAll<HTMLElement>(
    '[class*="modal" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip), ' +
    '[class*="dialog" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip), ' +
    '[class*="lightbox" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip)'
  );

  for (const candidate of modalCandidates) {
    if (isElementVisible(candidate)) {
      const style = window.getComputedStyle(candidate);
      if (style.position === 'fixed' || style.position === 'absolute' || candidate.tagName === 'DIALOG') {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 120) {
          return true;
        }
      }
    }
  }

  // 5. Check body / html classes commonly used to indicate modal active states
  const bodyClasses = (document.body.className + ' ' + document.documentElement.className).toLowerCase();
  if (
    bodyClasses.includes('modal-open') ||
    bodyClasses.includes('has-modal') ||
    bodyClasses.includes('overcast') ||
    bodyClasses.includes('dialog-open')
  ) {
    return true;
  }

  return false;
}

export function setModalSuspended(suspended: boolean): void {
  if (isSuspendedDueToModal === suspended) return;
  isSuspendedDueToModal = suspended;

  const allBadges = document.querySelectorAll<HTMLElement>('.detectorBadge');
  const allTooltips = document.querySelectorAll<HTMLElement>('.detectorTooltip');

  if (suspended) {
    allBadges.forEach((badge) => {
      try {
        if (badge.matches(':popover-open')) {
          badge.hidePopover();
        }
      } catch (e) {}
      badge.style.display = 'none';
    });
    allTooltips.forEach((tooltip) => {
      try {
        if (tooltip.matches(':popover-open')) {
          tooltip.hidePopover();
        }
      } catch (e) {}
      tooltip.style.display = 'none';
    });
  } else {
    allBadges.forEach((badge) => {
      badge.style.display = '';
      try {
        if (!badge.matches(':popover-open')) {
          badge.showPopover();
        }
      } catch (e) {}
    });
    allTooltips.forEach((tooltip) => {
      tooltip.style.display = '';
    });
  }
}

export function checkPageModalState(): void {
  setModalSuspended(isPageModalActive());
}

export function updateBadgePosition(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

  if (isSuspendedDueToModal) {
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const hasDimensions = rect.width > 0 && rect.height > 0;
  const isDisplayNone =
    window.getComputedStyle(targetEl).display === 'none' ||
    window.getComputedStyle(targetEl).visibility === 'hidden';

  // Only hide popovers if the element is explicitly hidden or has 0 dimensions
  if (!hasDimensions || isDisplayNone) {
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

  // Ensure badge is ALWAYS open by default in top-layer
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
  badgeEl.style.setProperty('position-anchor', anchorName);
  badgeEl.innerHTML = `
    <span class="detectorBadge__dot detectorBadge__dot--loading"></span>
    <span class="detectorBadge__scoreText">...</span>
  `;

  // Create dropdown tooltip popover in native top layer (closed by default)
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'detectorTooltip';
  tooltipEl.setAttribute('popover', 'manual');
  tooltipEl.style.setProperty('--badge-anchor', anchorName);
  tooltipEl.style.setProperty('position-anchor', anchorName);
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

  // Open badge popover immediately by default unless page modal is active
  if (isSuspendedDueToModal) {
    badgeEl.style.display = 'none';
  } else {
    try {
      badgeEl.showPopover();
    } catch (e) {
      console.warn('[Overlay] showPopover failed:', e);
    }
    updateBadgePosition(targetEl);
  }
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

  // Ensure badge popover is open by default unless page modal is active
  if (!isSuspendedDueToModal && !badgeEl.matches(':popover-open')) {
    try {
      badgeEl.showPopover();
    } catch (e) {}
  }

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

  if (!isSuspendedDueToModal) {
    updateBadgePosition(targetEl);
  }
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
