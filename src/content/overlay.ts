import { AnalysisResult, PatchResult } from '../shared/types';

interface BadgeEntry {
  badgeEl: HTMLElement;
  tooltipEl: HTMLElement;
  anchorName: string;
  regionEls: HTMLElement[];
  patches?: PatchResult[];
  result?: AnalysisResult;
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

    /* CSS Anchor Positioning @position-try fallbacks to keep tooltip clear of sample regions */
    @position-try --tooltip-below {
      top: calc(anchor(bottom) + 8px);
      bottom: auto;
      right: calc(anchor(right) + 6px);
      left: auto;
    }

    @position-try --tooltip-above {
      top: auto;
      bottom: calc(anchor(top) + 8px);
      right: calc(anchor(right) + 6px);
      left: auto;
    }

    @position-try --tooltip-left-of-image {
      top: auto;
      bottom: calc(anchor(bottom) + 6px);
      right: calc(anchor(left) + 8px);
      left: auto;
    }

    @position-try --tooltip-right-of-image {
      top: auto;
      bottom: calc(anchor(bottom) + 6px);
      left: calc(anchor(right) + 8px);
      right: auto;
    }

    @position-try --tooltip-inside-shifted-left {
      top: auto;
      bottom: calc(anchor(bottom) + 6px);
      right: calc(anchor(right) + 240px);
      left: auto;
    }

    .detectorTooltip {
      position: fixed;
      position-anchor: var(--badge-anchor);
      inset: auto;
      /* Default preferred position: Outside below the image, clear of all sample regions */
      top: calc(anchor(bottom) + 8px);
      right: calc(anchor(right) + 6px);
      position-try-fallbacks:
        --tooltip-above,
        --tooltip-left-of-image,
        --tooltip-right-of-image,
        --tooltip-inside-shifted-left,
        flip-block;
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
      width: 260px;
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

    .detectorTooltip__patchesGrid--2Cols {
      grid-template-columns: 1fr 1fr;
    }

    .detectorTooltip__patchesGrid--3Cols {
      grid-template-columns: 1fr 1fr 1fr;
    }

    .detectorTooltip__patchItem {
      background: #1E293B;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 10px;
      text-align: center;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .detectorTooltip__patchesGrid--3Cols .detectorTooltip__patchItem {
      font-size: 9px;
      padding: 3px 4px;
    }

    .detectorTooltip__patchItem:hover {
      background: #334155;
      transform: translateY(-1px);
    }

    /* Forensic Reasoning Assessment Card */
    .detectorTooltip__assessment {
      margin-top: 8px;
      padding: 7px 9px;
      border-radius: 6px;
      background: rgba(30, 41, 59, 0.75);
      border-left: 3px solid #64748B;
      box-sizing: border-box;
    }

    .detectorTooltip__assessment--localized {
      border-left-color: #A855F7;
      background: rgba(168, 85, 247, 0.12);
    }

    .detectorTooltip__assessment--synthetic {
      border-left-color: #EF4444;
      background: rgba(239, 68, 68, 0.12);
    }

    .detectorTooltip__assessment--real {
      border-left-color: #10B981;
      background: rgba(16, 185, 129, 0.12);
    }

    .detectorTooltip__assessment--ambiguous {
      border-left-color: #F59E0B;
      background: rgba(245, 158, 11, 0.12);
    }

    .detectorTooltip__assessmentHeader {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 700;
      color: #F8FAFC;
      font-size: 11px;
      margin-bottom: 3px;
    }

    .detectorTooltip__assessmentIcon {
      font-size: 12px;
      flex-shrink: 0;
    }

    .detectorTooltip__assessmentDesc {
      color: #CBD5E1;
      font-size: 10px;
      line-height: 1.35;
    }

    .detectorTooltip__sampleToggleBtn {
      width: 100%;
      margin-top: 10px;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid #3B82F6;
      background: rgba(59, 130, 246, 0.15);
      color: #93C5FD;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.1s ease;
    }

    .detectorTooltip__sampleToggleBtn:hover {
      background: rgba(59, 130, 246, 0.3);
      border-color: #60A5FA;
      transform: translateY(-1px);
    }

    .detectorTooltip__sampleToggleBtn:active {
      transform: translateY(0);
    }

    .detectorTooltip__sampleToggleBtn--active {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10B981;
      color: #6EE7B7;
    }

    .detectorTooltip__sampleToggleBtn--loading {
      opacity: 0.7;
      cursor: wait;
    }

    /* Native CSS Anchor Positioned Region Outlines - Guaranteed 1:1 Square */
    .detectorRegion {
      position: fixed;
      position-anchor: var(--badge-anchor);
      inset: auto;
      top: calc(anchor(top) + var(--region-top, 0px));
      left: calc(anchor(left) + var(--region-left, 0px));
      width: var(--region-size, 60px);
      height: var(--region-size, 60px);
      aspect-ratio: 1 / 1;
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

/**
 * Calculates the exact rendered pixel geometry of the photo,
 * supporting object-fit: cover, object-fit: contain, and standard scaling.
 */
function getDisplayedImageGeometry(targetEl: HTMLElement, imageWidth?: number, imageHeight?: number) {
  const rect = targetEl.getBoundingClientRect();
  const naturalW = (targetEl instanceof HTMLImageElement ? targetEl.naturalWidth : 0) || imageWidth || rect.width;
  const naturalH = (targetEl instanceof HTMLImageElement ? targetEl.naturalHeight : 0) || imageHeight || rect.height;

  if (naturalW <= 0 || naturalH <= 0 || rect.width <= 0 || rect.height <= 0) {
    return {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      naturalW: rect.width,
      naturalH: rect.height,
      clipWidth: rect.width,
      clipHeight: rect.height
    };
  }

  const computedStyle = window.getComputedStyle(targetEl);
  const objectFit = computedStyle.objectFit;

  const elW = rect.width;
  const elH = rect.height;
  const elRatio = elW / elH;
  const imgRatio = naturalW / naturalH;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (objectFit === 'cover') {
    // cover: image fills the entire element container; overflow is clipped
    if (imgRatio > elRatio) {
      // Image is wider than container: height matches container, width overflows horizontally
      scale = elH / naturalH;
      const displayW = naturalW * scale;
      offsetX = (elW - displayW) / 2; // negative offset (centered horizontally)
      offsetY = 0;
    } else {
      // Image is taller than container: width matches container, height overflows vertically
      scale = elW / naturalW;
      const displayH = naturalH * scale;
      offsetX = 0;
      offsetY = (elH - displayH) / 2; // negative offset (centered vertically)
    }
  } else if (objectFit === 'contain') {
    // contain: image fits entirely inside container; letterbox or pillarbox
    if (imgRatio > elRatio) {
      // Letterbox top and bottom
      scale = elW / naturalW;
      const displayH = naturalH * scale;
      offsetX = 0;
      offsetY = (elH - displayH) / 2;
    } else {
      // Pillarbox left and right
      scale = elH / naturalH;
      const displayW = naturalW * scale;
      offsetX = (elW - displayW) / 2;
      offsetY = 0;
    }
  } else {
    // fill or default:
    scale = elW / naturalW;
    offsetX = 0;
    offsetY = 0;
  }

  return {
    offsetX,
    offsetY,
    scale,
    naturalW,
    naturalH,
    clipWidth: elW,
    clipHeight: elH
  };
}

/**
 * Applies exact pixel coordinates to region elements, ensuring they are 100% square
 * and clamped strictly within the visible image boundary.
 */
function applyRegionPositions(targetEl: HTMLElement, entry: BadgeEntry): void {
  if (!entry.patches || entry.regionEls.length === 0) return;
  const geo = getDisplayedImageGeometry(targetEl, entry.result?.imageWidth, entry.result?.imageHeight);

  // Exact scale of 224px sample on screen
  const squareSize = Math.max(20, Math.round(224 * geo.scale));

  entry.regionEls.forEach((regionEl, idx) => {
    const patch = entry.patches?.[idx];
    if (!patch) return;
    const box = patch.box || { x: 0, y: 0, width: 1, height: 1 };

    // Compute pixel position relative to container
    const sx = box.x * geo.naturalW;
    const sy = box.y * geo.naturalH;

    let pixelLeft = Math.round(geo.offsetX + sx * geo.scale);
    let pixelTop = Math.round(geo.offsetY + sy * geo.scale);

    // Clamp strictly within the visible target element boundary (never spill outside)
    pixelLeft = Math.max(0, Math.min(Math.round(geo.clipWidth - squareSize), pixelLeft));
    pixelTop = Math.max(0, Math.min(Math.round(geo.clipHeight - squareSize), pixelTop));

    regionEl.style.setProperty('--region-left', `${pixelLeft}px`);
    regionEl.style.setProperty('--region-top', `${pixelTop}px`);
    regionEl.style.setProperty('--region-size', `${squareSize}px`);
  });
}

export function getActiveModalElements(): HTMLElement[] {
  const activeModals: HTMLElement[] = [];

  // 1. Native <dialog open> (excluding our own elements)
  const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  for (const dialog of openDialogs) {
    if (
      !dialog.classList.contains('detectorBadge') &&
      !dialog.classList.contains('detectorTooltip') &&
      !dialog.classList.contains('detectorRegion')
    ) {
      activeModals.push(dialog);
    }
  }

  // 2. Open popovers on page (excluding our own elements)
  const popovers = document.querySelectorAll<HTMLElement>(
    '[popover]:not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion)'
  );
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

function showRegionsForEntry(entry: BadgeEntry): void {
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

export function checkPageModalState(onModalClosed?: () => void): void {
  const activeModals = getActiveModalElements();
  const isModalOpen = activeModals.length > 0;

  // When a modal opens: cancel background calculations to prioritize newly added modal images
  if (isModalOpen && !prevModalOpen) {
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CANCEL_BACKGROUND_ANALYSIS' }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch (e) {}
  } else if (!isModalOpen && prevModalOpen) {
    // When modal closes: notify scanner to resume scanning visible background images
    if (onModalClosed) {
      onModalClosed();
    }
  }

  prevModalOpen = isModalOpen;

  for (const [targetEl] of badgeRegistry.entries()) {
    if (!targetEl.isConnected) {
      removeBadge(targetEl);
      continue;
    }
    updateBadgePosition(targetEl);
  }
}

export function updateBadgePosition(targetEl: HTMLElement): void {
  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

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

  // Synchronize region box coordinates and dimensions to remain 100% square
  applyRegionPositions(targetEl, entry);
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
      // Open region markers first so they enter the top layer underneath
      if (currentEntry) showRegionsForEntry(currentEntry);
      // Open tooltip popover second so it appears on top of the region markers
      tooltipEl.showPopover();
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

  try {
    badgeEl.showPopover();
  } catch (e) {
    console.warn('[Overlay] showPopover failed:', e);
  }
  updateBadgePosition(targetEl);
}

export function injectImageBadge(targetEl: HTMLElement, result: AnalysisResult): void {
  // Ensure loading badge is created if not already present
  if (!targetEl.dataset.aiDetectorBadgeInjected) {
    injectLoadingBadge(targetEl);
  }
  targetEl.dataset.aiDetectorBadgeInjected = 'true';

  const entry = badgeRegistry.get(targetEl);
  if (!entry) return;

  const { badgeEl, tooltipEl } = entry;
  entry.patches = result.patchScores;
  entry.result = result;

  if (!badgeEl.matches(':popover-open')) {
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

  // Create native anchor-positioned region outline popovers
  hideRegionsForEntry(entry);
  entry.regionEls.forEach((el) => el.remove());
  entry.regionEls = [];

  result.patchScores.forEach((patch) => {
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

    const formattedPos = patch.position.charAt(0).toUpperCase() + patch.position.slice(1);
    regionEl.innerHTML = `<span class="detectorRegion__label" style="border-left: 3px solid ${regionColor}">${formattedPos} (${patchScorePercent}%)</span>`;

    document.body.appendChild(regionEl);
    entry.regionEls.push(regionEl);
  });

  // Calculate and apply exact square dimensions on screen
  applyRegionPositions(targetEl, entry);

  const deepGrid = result.deepGrid || { cols: 3, rows: 3, total: 9 };
  const currentGrid = result.currentGrid || { cols: 2, rows: 2, total: 4 };
  const isDeepActive = result.sampleMode === 'deep';
  const gridCols = currentGrid.cols;
  const gridClass = `detectorTooltip__patchesGrid detectorTooltip__patchesGrid--${gridCols}Cols`;

  const patchesHtml = result.patchScores
    .map(
      (p, idx) =>
        `<div class="detectorTooltip__patchItem" data-patch-index="${idx}" title="${p.position}: ${Math.round(
          p.aiScore * 100
        )}%">${p.position}: <strong style="color: ${p.aiScore >= 0.7 ? '#EF4444' : '#10B981'}">${Math.round(
          p.aiScore * 100
        )}%</strong></div>`
    )
    .join('');

  let switchButtonHtml = '';
  if (result.supportsDeepSampling) {
    const btnText = isDeepActive
      ? 'Switch to standard (4 samples)'
      : `Switch to ${deepGrid.total} samples (${deepGrid.cols}×${deepGrid.rows})`;
    switchButtonHtml = `
      <button class="detectorTooltip__sampleToggleBtn ${isDeepActive ? 'detectorTooltip__sampleToggleBtn--active' : ''}">
        ${btnText}
      </button>
    `;
  }

  let assessmentHtml = '';
  if (result.reasoning) {
    let icon = '🔍';
    if (result.reasoning.type === 'localized-edit') icon = '🎭';
    else if (result.reasoning.type === 'full-synthetic') icon = '🤖';
    else if (result.reasoning.type === 'likely-real') icon = '📸';

    assessmentHtml = `
      <div class="detectorTooltip__assessment detectorTooltip__assessment--${result.reasoning.type}">
        <div class="detectorTooltip__assessmentHeader">
          <span class="detectorTooltip__assessmentIcon">${icon}</span>
          <span>${result.reasoning.title}</span>
        </div>
        <div class="detectorTooltip__assessmentDesc">${result.reasoning.description}</div>
      </div>
    `;
  }

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
    <div class="${gridClass}">
      ${patchesHtml}
    </div>
    ${assessmentHtml}
    ${switchButtonHtml}
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

  // Attach click listener for standard <-> deep sample toggle button
  const toggleBtn = tooltipEl.querySelector<HTMLButtonElement>('.detectorTooltip__sampleToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const nextMode: 'standard' | 'deep' = isDeepActive ? 'standard' : 'deep';
      toggleBtn.disabled = true;
      toggleBtn.classList.add('detectorTooltip__sampleToggleBtn--loading');
      toggleBtn.textContent =
        nextMode === 'deep'
          ? `Analyzing ${deepGrid.total} samples (${deepGrid.cols}×${deepGrid.rows})...`
          : `Analyzing standard samples...`;

      try {
        chrome.runtime.sendMessage(
          {
            type: 'ANALYZE_IMAGE',
            imageUrl: result.imageUrl,
            sampleMode: nextMode,
            forceRescan: true,
            priority: 'high'
          },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.result) {
              toggleBtn.disabled = false;
              toggleBtn.classList.remove('detectorTooltip__sampleToggleBtn--loading');
              toggleBtn.textContent = isDeepActive
                ? 'Switch to standard (4 samples)'
                : `Switch to ${deepGrid.total} samples (${deepGrid.cols}×${deepGrid.rows})`;
              return;
            }
            if (response.result.status === 'complete') {
              const wasTooltipOpen = tooltipEl.matches && tooltipEl.matches(':popover-open');
              injectImageBadge(targetEl, response.result);
              if (wasTooltipOpen) {
                const currentEntry = badgeRegistry.get(targetEl);
                if (currentEntry) showRegionsForEntry(currentEntry);
                try {
                  tooltipEl.hidePopover();
                  tooltipEl.showPopover();
                } catch (e) {}
              }
            }
          }
        );
      } catch (err) {
        toggleBtn.disabled = false;
        toggleBtn.classList.remove('detectorTooltip__sampleToggleBtn--loading');
      }
    });
  }

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
