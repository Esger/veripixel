import { AnalysisResult } from '../shared/types';

export function injectLoadingBadge(imgElement: HTMLImageElement): void {
  if (imgElement.dataset.aiDetectorBadgeInjected) {
    return;
  }
  imgElement.dataset.aiDetectorBadgeInjected = 'loading';

  const parent = imgElement.parentElement;
  if (!parent) return;

  const parentStyle = window.getComputedStyle(parent);
  if (parentStyle.position === 'static') {
    parent.style.position = 'relative';
  }

  const imgRect = imgElement.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  const relativeTop = imgRect.top - parentRect.top;
  const relativeRight = parentRect.right - imgRect.right;

  const host = document.createElement('div');
  host.className = 'ai-detector-badge-host';
  host.style.position = 'absolute';
  host.style.zIndex = '99999';
  host.style.top = `${Math.max(0, relativeTop + 4)}px`;
  host.style.right = `${Math.max(0, relativeRight + 4)}px`;
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
      display: none;
      position: absolute;
      top: 28px;
      right: 0;
      width: 220px;
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 100000;
    }
    .tooltip.visible {
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

  badgeEl.addEventListener('click', () => {
    const isVisible = tooltipEl.classList.toggle('visible');
    if (isVisible && parent) {
      const comp = window.getComputedStyle(parent);
      if (comp.overflow === 'hidden' || comp.overflowX === 'hidden' || comp.overflowY === 'hidden') {
        parent.dataset.aiDetectorOrigOverflow = parent.style.overflow || 'hidden';
        parent.style.overflow = 'visible';
      }
    } else if (parent && parent.dataset.aiDetectorOrigOverflow) {
      parent.style.overflow = parent.dataset.aiDetectorOrigOverflow === 'hidden' ? '' : parent.dataset.aiDetectorOrigOverflow;
      delete parent.dataset.aiDetectorOrigOverflow;
    }
  });

  document.addEventListener('click', () => {
    tooltipEl.classList.remove('visible');
    if (parent && parent.dataset.aiDetectorOrigOverflow) {
      parent.style.overflow = parent.dataset.aiDetectorOrigOverflow === 'hidden' ? '' : parent.dataset.aiDetectorOrigOverflow;
      delete parent.dataset.aiDetectorOrigOverflow;
    }
  });

  shadow.appendChild(styleEl);
  shadow.appendChild(badgeEl);
  shadow.appendChild(tooltipEl);

  parent.appendChild(host);
}

export function injectImageBadge(imgElement: HTMLImageElement, result: AnalysisResult): void {
  if (imgElement.dataset.aiDetectorBadgeInjected === 'true') {
    return;
  }

  // Ensure loading badge is created if not already present
  if (imgElement.dataset.aiDetectorBadgeInjected !== 'loading') {
    injectLoadingBadge(imgElement);
  }
  imgElement.dataset.aiDetectorBadgeInjected = 'true';

  const parent = imgElement.parentElement;
  if (!parent) return;

  const host = parent.querySelector('.ai-detector-badge-host');
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

export function removeBadge(imgElement: HTMLImageElement): void {
  delete imgElement.dataset.aiDetectorBadgeInjected;
  delete imgElement.dataset.aiDetectorProcessed;

  const parent = imgElement.parentElement;
  if (!parent) return;

  const host = parent.querySelector('.ai-detector-badge-host');
  if (host) {
    host.remove();
  }
}
