import { AnalysisResult, PatchResult } from '../shared/types';

interface BadgeEntry {
  badgeEl: HTMLElement;
  tooltipEl: HTMLElement;
  anchorName: string;
  regionsWrapperEl?: HTMLElement;
  regionsContainerEl?: HTMLElement;
  regionEls: HTMLElement[];
  patches?: PatchResult[];
  result?: AnalysisResult;
}

const badgeRegistry = new Map<HTMLElement, BadgeEntry>();
let prevModalOpen = false;

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
 * Calculates the real unclipped rendered geometry (size and offset) of the image,
 * taking into account object-fit (cover, contain, fill).
 */
function getRealImageGeometry(targetEl: HTMLElement, imageWidth?: number, imageHeight?: number) {
  const rect = targetEl.getBoundingClientRect();
  const elW = rect.width;
  const elH = rect.height;

  if (elW <= 0 || elH <= 0) {
    return { elW, elH, displayW: elW, displayH: elH, offsetX: 0, offsetY: 0, naturalW: elW, naturalH: elH };
  }

  const naturalW = (targetEl instanceof HTMLImageElement ? targetEl.naturalWidth : 0) || imageWidth || elW;
  const naturalH = (targetEl instanceof HTMLImageElement ? targetEl.naturalHeight : 0) || imageHeight || elH;

  const computedStyle = window.getComputedStyle(targetEl);
  const objectFit = computedStyle.objectFit;

  let displayW = elW;
  let displayH = elH;
  let offsetX = 0;
  let offsetY = 0;

  if (naturalW > 0 && naturalH > 0) {
    const elRatio = elW / elH;
    const imgRatio = naturalW / naturalH;

    if (objectFit === 'cover') {
      if (imgRatio > elRatio) {
        // Image is wider: height matches container, width overflows
        const scale = elH / naturalH;
        displayW = naturalW * scale;
        displayH = elH;
        offsetX = (elW - displayW) / 2;
        offsetY = 0;
      } else {
        // Image is taller: width matches container, height overflows
        const scale = elW / naturalW;
        displayW = elW;
        displayH = naturalH * scale;
        offsetX = 0;
        offsetY = (elH - displayH) / 2;
      }
    } else if (objectFit === 'contain') {
      if (imgRatio > elRatio) {
        // Letterbox top and bottom
        const scale = elW / naturalW;
        displayW = elW;
        displayH = naturalH * scale;
        offsetX = 0;
        offsetY = (elH - displayH) / 2;
      } else {
        // Pillarbox left and right
        const scale = elH / naturalH;
        displayW = naturalW * scale;
        displayH = elH;
        offsetX = (elW - displayW) / 2;
        offsetY = 0;
      }
    }
  }

  return { elW, elH, displayW, displayH, offsetX, offsetY, naturalW, naturalH };
}

/**
 * Positions the wrapper over the target element, sizes the inner container
 * to mimic the real image size and offset, and lets CSS Grid/Flexbox handle sample layout.
 */
function applyRegionPositions(targetEl: HTMLElement, entry: BadgeEntry): void {
  if (!entry.regionsWrapperEl || !entry.regionsContainerEl) return;

  const geo = getRealImageGeometry(targetEl, entry.result?.imageWidth, entry.result?.imageHeight);
  if (geo.elW <= 0 || geo.elH <= 0) return;

  // 1. Position the wrapper directly over the target element
  entry.regionsWrapperEl.style.top = 'anchor(top)';
  entry.regionsWrapperEl.style.left = 'anchor(left)';
  entry.regionsWrapperEl.style.width = 'anchor-size(width)';
  entry.regionsWrapperEl.style.height = 'anchor-size(height)';

  // 2. Size the inner container to mimic the real image size and offset
  entry.regionsContainerEl.style.setProperty('--image-offset-x', `${Math.round(geo.offsetX)}px`);
  entry.regionsContainerEl.style.setProperty('--image-offset-y', `${Math.round(geo.offsetY)}px`);
  entry.regionsContainerEl.style.setProperty('--image-width', `${Math.round(geo.displayW)}px`);
  entry.regionsContainerEl.style.setProperty('--image-height', `${Math.round(geo.displayH)}px`);

  // 3. Render boxes at the exact sample size (224px native crop mapped to rendered display scale)
  const naturalW = geo.naturalW || entry.result?.imageWidth || geo.displayW;
  const scale = naturalW > 0 ? geo.displayW / naturalW : 1;
  const sampleSize = Math.max(24, Math.round(224 * scale));
  entry.regionsContainerEl.style.setProperty('--sample-size', `${sampleSize}px`);
  entry.regionsContainerEl.style.setProperty('--region-size', `${sampleSize}px`);

  // 4. Read rendered values from DOM elements
  if (entry.regionsWrapperEl.matches(':popover-open')) {
    const wrapperRect = entry.regionsWrapperEl.getBoundingClientRect();
    entry.regionEls.forEach((regionEl) => {
      const rRect = regionEl.getBoundingClientRect();
      const relX = rRect.left - wrapperRect.left;
      const relY = rRect.top - wrapperRect.top;
      regionEl.dataset.renderedX = String(Math.round(relX));
      regionEl.dataset.renderedY = String(Math.round(relY));
      regionEl.dataset.renderedSize = String(Math.round(rRect.width));
    });
  }
}

export function getActiveModalElements(): HTMLElement[] {
  const activeModals: HTMLElement[] = [];

  // 1. Native <dialog open> (excluding our own elements)
  const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  for (const dialog of openDialogs) {
    if (
      !dialog.classList.contains('detectorBadge') &&
      !dialog.classList.contains('detectorTooltip') &&
      !dialog.classList.contains('detectorRegion') &&
      !dialog.classList.contains('detectorRegions') &&
      !dialog.classList.contains('detectorRegionsWrapper')
    ) {
      activeModals.push(dialog);
    }
  }

  // 2. Open popovers on page (excluding our own elements)
  const popovers = document.querySelectorAll<HTMLElement>(
    '[popover]:not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion):not(.detectorRegions):not(.detectorRegionsWrapper)'
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
    '[class*="modal" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion):not(.detectorRegions):not(.detectorRegionsWrapper), ' +
      '[class*="dialog" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion):not(.detectorRegions):not(.detectorRegionsWrapper), ' +
      '[class*="lightbox" i]:not(body):not(html):not(.detectorBadge):not(.detectorTooltip):not(.detectorRegion):not(.detectorRegions):not(.detectorRegionsWrapper)'
  );

  for (const candidate of modalCandidates) {
    if (!candidate.isConnected) continue;
    const style = window.getComputedStyle(candidate);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue;
    }
    if (style.position === 'fixed' || style.position === 'absolute' || candidate.tagName === 'DIALOG') {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 120 && !activeModals.includes(candidate)) {
        activeModals.push(candidate);
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

function showRegionsForEntry(entry: BadgeEntry, targetEl?: HTMLElement): void {
  if (entry.regionsWrapperEl) {
    try {
      if (!entry.regionsWrapperEl.matches(':popover-open')) {
        entry.regionsWrapperEl.showPopover();
      }
    } catch (e) {}
    if (targetEl) {
      applyRegionPositions(targetEl, entry);
    }
  }
}

function hideRegionsForEntry(entry: BadgeEntry): void {
  if (entry.regionsWrapperEl) {
    try {
      if (entry.regionsWrapperEl.matches(':popover-open')) {
        entry.regionsWrapperEl.hidePopover();
      }
    } catch (e) {}
  }
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
    <div class="detectorTooltip__loading">Analyzing image with AI model...</div>
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
      if (currentEntry) showRegionsForEntry(currentEntry, targetEl);
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
  let statusModifier = 'lowAi';
  let statusText = 'Likely Real';

  if (scorePercent >= 70) {
    statusModifier = 'highAi';
    statusText = 'High AI Probability';
  } else if (scorePercent >= 30) {
    statusModifier = 'mediumAi';
    statusText = 'Possible AI/Edited';
  }

  badgeEl.classList.remove('detectorBadge--lowAi', 'detectorBadge--mediumAi', 'detectorBadge--highAi');
  badgeEl.classList.add(`detectorBadge--${statusModifier}`);

  const dotEl = badgeEl.querySelector('.detectorBadge__dot') as HTMLElement | null;
  const scoreText = badgeEl.querySelector('.detectorBadge__scoreText') as HTMLElement | null;

  if (dotEl) {
    dotEl.classList.remove('detectorBadge__dot--loading');
  }

  if (scoreText) {
    scoreText.textContent = `${scorePercent}%`;
  }

  // Create or retrieve native anchor-positioned regions wrapper & container
  hideRegionsForEntry(entry);
  if (!entry.regionsWrapperEl) {
    const regionsWrapperEl = document.createElement('div');
    regionsWrapperEl.className = 'detectorRegionsWrapper';
    regionsWrapperEl.setAttribute('popover', 'manual');
    regionsWrapperEl.style.setProperty('--badge-anchor', entry.anchorName);
    regionsWrapperEl.style.setProperty('position-anchor', entry.anchorName);

    const regionsContainerEl = document.createElement('div');
    regionsContainerEl.className = 'detectorRegions';
    regionsWrapperEl.appendChild(regionsContainerEl);

    document.body.appendChild(regionsWrapperEl);
    entry.regionsWrapperEl = regionsWrapperEl;
    entry.regionsContainerEl = regionsContainerEl;
  }

  const containerEl = entry.regionsContainerEl!;

  // Clear existing region elements
  containerEl.innerHTML = '';
  entry.regionEls = [];

  const totalCount = result.patchScores.length;
  const deepGrid = result.deepGrid || { cols: 3, rows: 3, total: 9 };
  const currentGrid = result.currentGrid || { cols: 2, rows: 2, total: 4 };
  const isDeepActive = result.sampleMode === 'deep';
  const gridCols = currentGrid.cols;

  containerEl.className = 'detectorRegions';

  const createRegionEl = (patch: PatchResult, idx: number): HTMLElement => {
    const patchScorePercent = Math.round(patch.aiScore * 100);
    let mod = 'lowAi';
    if (patchScorePercent >= 70) {
      mod = 'highAi';
    } else if (patchScorePercent >= 30) {
      mod = 'mediumAi';
    }

    const regionEl = document.createElement('div');
    regionEl.className = `detectorRegion detectorRegion--${mod}`;
    regionEl.dataset.patchIndex = String(idx);

    const formattedPos = patch.position.charAt(0).toUpperCase() + patch.position.slice(1);
    regionEl.innerHTML = `<span class="detectorRegion__label detectorRegion__label--${mod}">${formattedPos} (${patchScorePercent}%)</span>`;

    return regionEl;
  };

  if (totalCount === 1) {
    // 1 box: grid lines 50%
    containerEl.classList.add('detectorRegions--1Box');
    const regionEl = createRegionEl(result.patchScores[0], 0);
    containerEl.appendChild(regionEl);
    entry.regionEls.push(regionEl);
  } else if (totalCount === 2) {
    // 2 boxes: flex space-around / wrap
    containerEl.classList.add('detectorRegions--2Boxes');
    result.patchScores.forEach((patch, idx) => {
      const regionEl = createRegionEl(patch, idx);
      containerEl.appendChild(regionEl);
      entry.regionEls.push(regionEl);
    });
  } else if (totalCount === 4) {
    // 4 boxes: grid-lines 1/3 (Rule of Thirds)
    containerEl.classList.add('detectorRegions--4Boxes');
    result.patchScores.forEach((patch, idx) => {
      const regionEl = createRegionEl(patch, idx);
      containerEl.appendChild(regionEl);
      entry.regionEls.push(regionEl);
    });
  } else {
    // 6 or 9 boxes: flex space-around inline and block / wrap
    containerEl.classList.add(totalCount === 6 ? 'detectorRegions--6Boxes' : 'detectorRegions--9Boxes');
    const colsCount = gridCols || (totalCount === 6 ? 3 : 3);
    const rowsCount = Math.ceil(totalCount / colsCount);
    for (let r = 0; r < rowsCount; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'detectorRegions__row';
      containerEl.appendChild(rowEl);
      for (let c = 0; c < colsCount; c++) {
        const idx = r * colsCount + c;
        const patch = result.patchScores[idx];
        if (!patch) continue;
        const regionEl = createRegionEl(patch, idx);
        rowEl.appendChild(regionEl);
        entry.regionEls.push(regionEl);
      }
    }
  }

  // Calculate container geometry and read rendered values from the browser
  applyRegionPositions(targetEl, entry);

  const gridClass = `detectorTooltip__patchesGrid detectorTooltip__patchesGrid--${gridCols}Cols`;

  const patchesHtml = result.patchScores
    .map(
      (p, idx) =>
        `<div class="detectorTooltip__patchItem" data-patch-index="${idx}" title="${p.position}: ${Math.round(
          p.aiScore * 100
        )}%">${p.position}: <strong class="${
          p.aiScore >= 0.7 ? 'detectorTooltip__patchScore--highAi' : 'detectorTooltip__patchScore--lowAi'
        }">${Math.round(p.aiScore * 100)}%</strong></div>`
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
    <div class="detectorTooltip__header detectorTooltip__header--${statusModifier}">
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
    if (entry.regionsWrapperEl) {
      entry.regionsWrapperEl.remove();
    }
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
