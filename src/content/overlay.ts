import { AnalysisResult } from '../shared/types';

export function injectLoadingBadge(targetEl: HTMLElement): void {
  if (targetEl.dataset.aiDetectorBadgeInjected) {
    return;
  }
  targetEl.dataset.aiDetectorBadgeInjected = 'loading';

  let container: HTMLElement;
  let relativeBottom = 4;
  let relativeRight = 4;

  if (targetEl instanceof HTMLImageElement && targetEl.parentElement) {
    container = targetEl.parentElement;
    const parentStyle = window.getComputedStyle(container);
    if (parentStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const imgRect = targetEl.getBoundingClientRect();
    const parentRect = container.getBoundingClientRect();
    relativeBottom = Math.max(0, parentRect.bottom - imgRect.bottom + 4);
    relativeRight = Math.max(0, parentRect.right - imgRect.right + 4);
  } else {
    container = targetEl;
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }
  }

  const host = document.createElement('div');
  host.className = 'ai-detector-badge-host';
  host.style.position = 'absolute';
  host.style.bottom = `${relativeBottom}px`;
  host.style.right = `${relativeRight}px`;
  host.style.top = 'auto';
  host.style.left = 'auto';

  const shadow = host.attachShadow({ mode: 'open' });

  const shadowStyles = `
    @keyframes cycleColors {
      0% { background-color: #10B981; box-shadow: 0 0 6px #10B981; }
      33% { background-color: #F59E0B; box-shadow: 0 0 6px #F59E0B; }
      66% { background-color: #EF4444; box-shadow: 0 0 6px #EF4444; }
      100% { background-color: #10B981; box-shadow: 0 0 6px #10B981; }
    }
    .badge {
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
    }
    .badge:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: #10B981;
      box-shadow: 0 0 6px #10B981;
    }
    .dot.loading {
      animation: cycleColors 1.2s infinite linear;
    }
    .tooltip {
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
      position: fixed;
      inset: auto;
    }
    .tooltip:popover-open {
      display: block;
    }
    .tooltip-header {
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
    }
    .tooltip-row {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 11px;
      color: #94A3B8;
    }
    .tooltip-val {
      color: #E2E8F0;
      font-weight: 500;
    }
    .patches-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #1E293B;
    }
    .patch-item {
      background: #1E293B;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 10px;
      text-align: center;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = shadowStyles;

  const badgeEl = document.createElement('div');
  badgeEl.className = 'badge';
  badgeEl.id = 'badge-el';
  badgeEl.innerHTML = `
    <span class="dot loading" id="dot-el"></span>
    <span id="score-text">...</span>
  `;

  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.id = 'tooltip-el';
  tooltipEl.setAttribute('popover', 'manual');
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

  ['click', 'auxclick'].forEach((type) => {
    host.addEventListener(type, preventAndStop);
    badgeEl.addEventListener(type, preventAndStop);
    tooltipEl.addEventListener(type, preventAndStop);
  });

  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((type) => {
    host.addEventListener(type, stopOnly);
    badgeEl.addEventListener(type, stopOnly);
    tooltipEl.addEventListener(type, stopOnly);
  });

  badgeEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      tooltipEl.hidePopover();
    } else if (typeof tooltipEl.showPopover === 'function') {
      const badgeRect = badgeEl.getBoundingClientRect();
      const spaceAbove = badgeRect.top;

      if (spaceAbove > 200) {
        tooltipEl.style.top = 'auto';
        tooltipEl.style.bottom = `${window.innerHeight - badgeRect.top + 4}px`;
      } else {
        tooltipEl.style.bottom = 'auto';
        tooltipEl.style.top = `${badgeRect.bottom + 4}px`;
      }

      tooltipEl.style.left = `${Math.max(10, badgeRect.right - 220)}px`;
      tooltipEl.showPopover();
    }
  });

  document.addEventListener('click', () => {
    if (tooltipEl.matches && tooltipEl.matches(':popover-open')) {
      tooltipEl.hidePopover();
    }
  });

  shadow.appendChild(styleEl);
  shadow.appendChild(badgeEl);
  shadow.appendChild(tooltipEl);

  container.appendChild(host);
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

  const container = targetEl instanceof HTMLImageElement ? targetEl.parentElement : targetEl;
  if (!container) return;

  const host = container.querySelector('.ai-detector-badge-host');
  if (!host || !host.shadowRoot) return;

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

  const badgeEl = host.shadowRoot.querySelector('#badge-el') as HTMLElement | null;
  const dotEl = host.shadowRoot.querySelector('#dot-el') as HTMLElement | null;
  const scoreText = host.shadowRoot.querySelector('#score-text') as HTMLElement | null;
  const tooltipEl = host.shadowRoot.querySelector('#tooltip-el') as HTMLElement | null;

  if (badgeEl) {
    badgeEl.style.borderColor = color;
  }

  if (dotEl) {
    dotEl.classList.remove('loading');
    dotEl.style.backgroundColor = color;
    dotEl.style.boxShadow = `0 0 6px ${color}`;
  }

  if (scoreText) {
    scoreText.textContent = `${scorePercent}%`;
  }

  if (tooltipEl) {
    const patchesHtml = result.patchScores
      .map(
        (p) =>
          `<div class="patch-item">${p.position}: <strong style="color: ${p.aiScore >= 0.7 ? '#EF4444' : '#10B981'}">${Math.round(p.aiScore * 100)}%</strong></div>`
      )
      .join('');

    tooltipEl.innerHTML = `
      <div class="tooltip-header" style="color: ${color}">
        <span>${statusText}</span>
        <span>${scorePercent}% AI</span>
      </div>
      <div class="tooltip-row">
        <span>EXIF Camera:</span>
        <span class="tooltip-val">${result.metadata.cameraModel || (result.metadata.exifPresent ? 'Present' : 'None/Stripped')}</span>
      </div>
      <div class="tooltip-row">
        <span>C2PA Signature:</span>
        <span class="tooltip-val">${result.metadata.c2paPresent ? 'Detected' : 'None'}</span>
      </div>
      <div class="tooltip-row">
        <span>Quality score:</span>
        <span class="tooltip-val">${Math.round(result.metadata.qualityScore * 100)}%</span>
      </div>
      <div class="patches-grid">
        ${patchesHtml}
      </div>
    `;
  }
}

export function removeBadge(targetEl: HTMLElement): void {
  delete targetEl.dataset.aiDetectorBadgeInjected;
  delete targetEl.dataset.aiDetectorProcessed;

  const container = targetEl instanceof HTMLImageElement ? targetEl.parentElement : targetEl;
  if (!container) return;

  const host = container.querySelector('.ai-detector-badge-host');
  if (host) {
    host.remove();
  }
}
