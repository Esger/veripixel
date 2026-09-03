import { AnalysisResult, PatchResult } from '../shared/types';

interface BadgeEntry {
  badgeEl: HTMLElement;
  tooltipEl: HTMLElement;
  anchorName: string;
  regionEls: HTMLElement[];
  patches?: PatchResult[];
}

const badgeRegistry = new Map<HTMLElement, BadgeEntry>();
let prevModalOpen = false;

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
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }

    .detectorTooltip__patchItem:hover {
      background: #334155;
      transform: translateY(-1px);
    }

    /* Sampled Region Outlines */
    .detectorRegion {
      position: fixed;
      position-anchor: var(--badge-anchor);
      inset: auto;
      top: var(--fb-top, calc(anchor(top) + anchor-size(height) * var(--patch-y, 0)));
      left: var(--fb-left, calc(anchor(left) + anchor-size(width) * var(--patch-x, 0)));
      width: var(--fb-width, calc(anchor-size(width) * var(--patch-w, 1)));
      height: var(--fb-height, calc(anchor-size(height) * var(--patch-h, 1)));
      position-visibility: anchors-visible;
      pointer-events: none;
      border-radius: 6px;
      border: 2px dashed #10B981;
      background: rgba(16, 185, 129, 0.12);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.35);
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      z-index: 2147483642;
      transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }

    .detectorRegion--highAi {
      border-color: #EF4444;
      background: rgba(239, 68, 68, 0.15);
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.45);
      color: #EF4444;
    }

    .detectorRegion--mediumAi {
      border-color: #F59E0B;
      background: rgba(245, 158, 11, 0.15);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);
      color: #F59E0B;
    }

    .detectorRegion--lowAi {
      border-color: #10B981;
      background: rgba(16, 185, 129, 0.12);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.35);
      color: #10B981;
    }

    .detectorRegion--highlighted {
      border-width: 3px;
      border-style: solid;
      box-shadow: 0 0 20px currentColor;
      transform: scale(1.02);
      z-index: 2147483645;
    }

    .detectorRegion__label {
      position: absolute;
      top: 4px;
      left: 4px;
      padding: 2px 5px;
      border-radius: 4px;
      background: rgba(15, 23, 42, 0.9);
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.2px;
      backdrop-filter: blur(4px);
      user-select: none;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
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

export function getActiveModalElements(): HTMLElement[] {
  const activeModals: HTMLElement[] = [];

  // 1. Native <dialog open> (excluding our own elements)
  const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  for (const dialog of openDialogs) {
    if (!dialog.classList.contains('detectorBadge') && !dialog.classList.contains('detectorTooltip') && !dialog.classList.contains('detectorRegion')) {
      activeModals.push(dialog);
    }
  }

  // 2. Open popovers on page (excluding our own elements)
  const popovers = document.querySelectorAll<HTMLElement>('[popover]:not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion)');
  for (const popover of popovers) {
    try {
      if (popover.matches(':popover-open')) {
        activeModals.push(popover);
      }
    } catch (e) {}
  }

  // 3. Elements with aria-modal="true" that are visible
  const ariaModals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  for (const modal of ariaModals) {
    if (isElementVisible(modal) && !activeModals.includes(modal)) {
      activeModals.push(modal);
    }
  }

  // 4. Fixed or absolute elements with class containing modal, dialog, or lightbox
  const modalCandidates = document.querySelectorAll<HTMLElement>(
    '[class*="modal" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion), ' +
    '[class*="dialog" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion), ' +
    '[class*="lightbox" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion)'
  );

  for (const candidate of modalCandidates) {
    if (isElementVisible(candidate)) {
      const style = window.getComputedStyle(candidate);
      if (style.position === 'fixed' || style.position === 'absolute' || candidate.tagName === 'DIALOG') {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 120 && !activeModals.includes(candidate)) {
          activeModals.push(candidate);
        }
      }
    }
  }

  return activeModals;
}

export function isElementInsideActiveModal(el: HTMLElement, activeModals: HTMLElement[]): boolean {
  for (const modal of activeModals) {
    if (modal === el || modal.contains(el)) {
      return true;
    }
  }
  return false;
}

function showRegionsForEntry(entry: BadgeEntry, targetEl: HTMLElement): void {
  updateRegionPositions(targetEl, entry);
  entry.regionEls.forEach((regionEl) => {
    try {
      if (!regionEl.matches(':popover-open')) {
        regionEl.showPopover();
      }
    } catch (e) {}
  });
}

function hideRegionsForEntry(entry: BadgeEntry): void {
  entry.regionEls.forEach((regionEl) => {
    try {
      if (regionEl.matches(':popover-open')) {
        regionEl.hidePopover();
      }
    } catch (e) {}
  });
}

function updateRegionPositions(targetEl: HTMLElement, entry: BadgeEntry): void {
  const rect = targetEl.getBoundingClientRect();
  entry.regionEls.forEach((regionEl, idx) => {
    const patch = entry.patches?.[idx];
    const box = patch?.box || { x: 0, y: 0, width: 1, height: 1 };
    regionEl.style.setProperty('--patch-x', `${box.x}`);
    regionEl.style.setProperty('--patch-y', `${box.y}`);
    regionEl.style.setProperty('--patch-w', `${box.width}`);
    regionEl.style.setProperty('--patch-h', `${box.height}`);

    regionEl.style.setProperty('--fb-top', `${rect.top + rect.height * box.y}px`);
    regionEl.style.setProperty('--fb-left', `${rect.left + rect.width * box.x}px`);
    regionEl.style.setProperty('--fb-width', `${rect.width * box.width}px`);
    regionEl.style.setProperty('--fb-height', `${rect.height * box.height}px`);
  });
}

export function checkPageModalState(onModalClosed?: () => void): void {
  const activeModals = getActiveModalElements();
  const isModalOpen = activeModals.length > 0;

  // When a modal opens: cancel background calculations and suspend unfinished loading cards
  if (isModalOpen && !prevModalOpen) {
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CANCEL_BACKGROUND_ANALYSIS' }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch (e) {}

    for (const [targetEl, entry] of badgeRegistry.entries()) {
      if (!isElementInsideActiveModal(targetEl, activeModals)) {
        hideRegionsForEntry(entry);
        if (targetEl.dataset.aiDetectorBadgeInjected === 'loading') {
          delete targetEl.dataset.aiDetectorProcessed;
          delete targetEl.dataset.aiDetectorBadgeInjected;
          removeBadge(targetEl);
        }
      }
    }
  } else if (!isModalOpen && prevModalOpen) {
    // When modal closes: notify to resume calculations on visible background images
    if (onModalClosed) {
      onModalClosed();
    }
  }

  prevModalOpen = isModalOpen;

  for (const [targetEl, entry] of badgeRegistry.entries()) {
    if (!targetEl.isConnected) {
      removeBadge(targetEl);
      continue;
    }

    const isInsideModal = isModalOpen && isElementInsideActiveModal(targetEl, activeModals);

    if (isModalOpen && !isInsideModal) {
      // Hide background badges & tooltips & regions
      hideRegionsForEntry(entry);
      try {
        if (entry.badgeEl.matches(':popover-open')) {
          entry.badgeEl.hidePopover();
        }
      } catch (e) {}
      entry.badgeEl.style.display = 'none';

      try {
        if (entry.tooltipEl.matches(':popover-open')) {
          entry.tooltipEl.hidePopover();
        }
      } catch (e) {}
      entry.tooltipEl.style.display = 'none';
    } else {
      // Element is inside the active modal (or no modal is open): keep/restore badge open!
      entry.badgeEl.style.display = '';
      updateBadgePosition(targetEl);
    }
  }
}

export function updateBadgePosition(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

  const activeModals = getActiveModalElements();
  const isModalOpen = activeModals.length > 0;
  const isInsideModal = isModalOpen && isElementInsideActiveModal(targetEl, activeModals);

  // If a modal is open and this element is OUTSIDE it, hide it
  if (isModalOpen && !isInsideModal) {
    hideRegionsForEntry(entry);
    if (entry.badgeEl.matches(':popover-open')) {
      try {
        entry.badgeEl.hidePopover();
      } catch (e) {}
    }
    entry.badgeEl.style.display = 'none';
    return;
  }

  entry.badgeEl.style.display = '';

  const rect = targetEl.getBoundingClientRect();
  const hasDimensions = rect.width > 0 && rect.height > 0;
  const isDisplayNone =
    window.getComputedStyle(targetEl).display === 'none' ||
    window.getComputedStyle(targetEl).visibility === 'hidden';

  // Only hide popovers if the element is explicitly hidden or has 0 dimensions
  if (!hasDimensions || isDisplayNone) {
    hideRegionsForEntry(entry);
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

  // Ensure badge is open by default in top-layer
  if (!entry.badgeEl.matches(':popover-open')) {
    try {
      entry.badgeEl.showPopover();
    } catch (e) {}
  }

  // Update region positions if tooltip popover is currently active
  if (entry.tooltipEl.matches && entry.tooltipEl.matches(':popover-open')) {
    updateRegionPositions(targetEl, entry);
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

    const currentEntry = badgeRegistry.get(targetEl);
    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      tooltipEl.hidePopover();
      if (currentEntry) hideRegionsForEntry(currentEntry);
    } else if (typeof tooltipEl.showPopover === 'function') {
      tooltipEl.showPopover();
      if (currentEntry) showRegionsForEntry(currentEntry, targetEl);
    }
  });

  // Light-dismiss on click outside
  document.addEventListener('click', (e) => {
    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      if (!tooltipEl.contains(e.target as Node) && !badgeEl.contains(e.target as Node)) {
        tooltipEl.hidePopover();
        const currentEntry = badgeRegistry.get(targetEl);
        if (currentEntry) hideRegionsForEntry(currentEntry);
      }
    }
  });

  document.body.appendChild(badgeEl);
  document.body.appendChild(tooltipEl);

  badgeRegistry.set(targetEl, { badgeEl, tooltipEl, anchorName, regionEls: [] });

  const activeModals = getActiveModalElements();
  const isModalOpen = activeModals.length > 0;
  const isInsideModal = isModalOpen && isElementInsideActiveModal(targetEl, activeModals);

  if (isModalOpen && !isInsideModal) {
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
  entry.patches = result.patchScores;

  const activeModals = getActiveModalElements();
  const isModalOpen = activeModals.length > 0;
  const isInsideModal = isModalOpen && isElementInsideActiveModal(targetEl, activeModals);

  // Ensure badge popover is open if in modal or no modal is active
  if (!isModalOpen || isInsideModal) {
    if (!badgeEl.matches(':popover-open')) {
      try {
        badgeEl.showPopover();
      } catch (e) {}
    }
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

  // Create region outline popover elements for each sampled patch
  hideRegionsForEntry(entry);
  entry.regionEls.forEach((el) => el.remove());
  entry.regionEls = [];

  result.patchScores.forEach((patch) => {
    const box = patch.box || { x: 0, y: 0, width: 1, height: 1 };
    const patchScorePercent = Math.round(patch.aiScore * 100);

    let modifierClass = 'detectorRegion--lowAi';
    let regionColor = '#10B981';
    if (patchScorePercent >= 70) {
      modifierClass = 'detectorRegion--highAi';
      regionColor = '#EF4444';
    } else if (patchScorePercent >= 30) {
      modifierClass = 'detectorRegion--mediumAi';
      regionColor = '#F59E0B';
    }

    const regionEl = document.createElement('div');
    regionEl.className = `detectorRegion ${modifierClass}`;
    regionEl.setAttribute('popover', 'manual');
    regionEl.style.setProperty('--badge-anchor', entry.anchorName);
    regionEl.style.setProperty('position-anchor', entry.anchorName);
    regionEl.style.setProperty('--patch-x', `${box.x}`);
    regionEl.style.setProperty('--patch-y', `${box.y}`);
    regionEl.style.setProperty('--patch-w', `${box.width}`);
    regionEl.style.setProperty('--patch-h', `${box.height}`);

    const formattedPos = patch.position.charAt(0).toUpperCase() + patch.position.slice(1);
    regionEl.innerHTML = `<span class="detectorRegion__label" style="border-left: 3px solid ${regionColor}">${formattedPos} (${patchScorePercent}%)</span>`;

    document.body.appendChild(regionEl);
    entry.regionEls.push(regionEl);
  });

  const patchesHtml = result.patchScores
    .map(
      (p, idx) =>
        `<div class="detectorTooltip__patchItem" data-patch-index="${idx}">${p.position}: <strong style="color: ${
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

  // Attach hover highlight listeners to patch items in tooltip
  tooltipEl.querySelectorAll<HTMLElement>('.detectorTooltip__patchItem').forEach((item) => {
    const idx = parseInt(item.dataset.patchIndex || '-1', 10);
    if (idx >= 0 && entry.regionEls[idx]) {
      item.addEventListener('mouseenter', () => {
        entry.regionEls[idx].classList.add('detectorRegion--highlighted');
      });
      item.addEventListener('mouseleave', () => {
        entry.regionEls[idx].classList.remove('detectorRegion--highlighted');
      });
    }
  });

  updateBadgePosition(targetEl);
}

export function removeBadge(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (entry) {
    hideRegionsForEntry(entry);
    entry.regionEls.forEach((el) => el.remove());
    entry.regionEls = [];

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
