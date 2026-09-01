import { AnalysisResult } from '../shared/types';

export function injectImageBadge(imgElement: HTMLImageElement, result: AnalysisResult): void {
  // Prevent duplicate badges
  if (imgElement.dataset.aiDetectorBadgeInjected === 'true') {
    return;
  }
  imgElement.dataset.aiDetectorBadgeInjected = 'true';

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

  // Create host container positioned relative to image
  const host = document.createElement('div');
  host.className = 'ai-detector-badge-host';
  host.style.position = 'absolute';
  host.style.zIndex = '99999';

  // Calculate position relative to image in DOM
  const rect = imgElement.getBoundingClientRect();
  const parent = imgElement.offsetParent || document.body;
  const parentRect = parent.getBoundingClientRect();

  const top = rect.top - parentRect.top + 8;
  const left = rect.left - parentRect.left + rect.width - 70;

  host.style.top = `${Math.max(8, top)}px`;
  host.style.left = `${Math.max(8, left)}px`;

  // Attach Shadow DOM to insulate styles from target webpage
  const shadow = host.attachShadow({ mode: 'open' });

  const shadowStyles = `
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
      border: 1px solid ${color};
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
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
      background-color: ${color};
      box-shadow: 0 0 6px ${color};
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
      color: ${color};
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
  badgeEl.innerHTML = `
    <span class="dot"></span>
    <span>${scorePercent}%</span>
  `;

  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';

  const patchesHtml = result.patchScores
    .map(
      (p) =>
        `<div class="patch-item">${p.position}: <strong style="color: ${p.aiScore >= 0.7 ? '#EF4444' : '#10B981'}">${Math.round(p.aiScore * 100)}%</strong></div>`
    )
    .join('');

  tooltipEl.innerHTML = `
    <div class="tooltip-header">
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

  const preventAndStop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const stopOnly = (e: Event) => {
    e.stopPropagation();
  };

  // Prevent default action (e.g., <a> navigation) and stop propagation on clicks
  ['click', 'auxclick'].forEach((eventType) => {
    host.addEventListener(eventType, preventAndStop);
    badgeEl.addEventListener(eventType, preventAndStop);
    tooltipEl.addEventListener(eventType, preventAndStop);
  });

  // Stop propagation for mouse, pointer, and touch events to avoid triggering container/link handlers
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((eventType) => {
    host.addEventListener(eventType, stopOnly);
    badgeEl.addEventListener(eventType, stopOnly);
    tooltipEl.addEventListener(eventType, stopOnly);
  });

  badgeEl.addEventListener('click', () => {
    tooltipEl.classList.toggle('visible');
  });

  // Hide tooltip when clicking outside
  document.addEventListener('click', () => {
    tooltipEl.classList.remove('visible');
  });

  shadow.appendChild(styleEl);
  shadow.appendChild(badgeEl);
  shadow.appendChild(tooltipEl);

  // Append host relative to image parent
  if (imgElement.parentElement) {
    // Ensure parent has position context if static
    const parentStyle = window.getComputedStyle(imgElement.parentElement);
    if (parentStyle.position === 'static') {
      imgElement.parentElement.style.position = 'relative';
    }
    imgElement.parentElement.appendChild(host);
  }
}
