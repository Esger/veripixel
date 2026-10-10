import { PatchBox } from '../shared/types';

export interface MeasuredSamples {
  allBoxes: PatchBox[];
  centerBox: PatchBox;
  targetPositions: string[];
}

/**
 * Creates the DOM element tree for sample placement matching samples placement/index.html.
 */
export function createSamplesDom(): HTMLElement {
  const samples = document.createElement('div');
  samples.className = 'samples';
  samples.innerHTML = `
    <div class="samples__wrapper">
      <div class="samples__top">
        <div class="sample__left"><div class="sample__target" data-pos="top-left"></div></div>
        <div class="sample__center"><div class="sample__target" data-pos="top-center"></div></div>
        <div class="sample__right"><div class="sample__target" data-pos="top-right"></div></div>
      </div>
      <div class="samples__middle">
        <div class="sample__left"><div class="sample__target" data-pos="mid-left"></div></div>
        <div class="sample__center"><div class="sample__target" data-pos="mid-center"></div></div>
        <div class="sample__right"><div class="sample__target" data-pos="mid-right"></div></div>
      </div>
      <div class="samples__bottom">
        <div class="sample__left"><div class="sample__target" data-pos="bot-left"></div></div>
        <div class="sample__center"><div class="sample__target" data-pos="bot-center"></div></div>
        <div class="sample__right"><div class="sample__target" data-pos="bot-right"></div></div>
      </div>
    </div>
  `;
  return samples;
}

let measurementHost: HTMLElement | null = null;
let measurementSamples: HTMLElement | null = null;

function getMeasurementElements(): { host: HTMLElement; samples: HTMLElement } {
  if (!measurementHost || !measurementHost.isConnected) {
    measurementHost = document.createElement('div');
    measurementHost.className = 'samplesMeasurementHost';
    measurementHost.style.cssText =
      'position: fixed; left: -99999px; top: -99999px; visibility: hidden; pointer-events: none; contain: strict; z-index: -1;';

    measurementSamples = createSamplesDom();
    measurementHost.appendChild(measurementSamples);
    (document.body || document.documentElement).appendChild(measurementHost);
  }
  return { host: measurementHost, samples: measurementSamples! };
}

/**
 * Measures the responsive CSS sample placement for a given width and height.
 * Sizing against natural image dimensions ensures we lose the least available
 * pixel information from the source image.
 */
export function measureSampleLayout(width: number, height: number, sampleSize = 240): MeasuredSamples {
  const safeW = Math.max(200, Math.round(width));
  const safeH = Math.max(200, Math.round(height));

  const { samples } = getMeasurementElements();
  samples.style.width = `${safeW}px`;
  samples.style.height = `${safeH}px`;
  samples.style.setProperty('--sampleSize', `${sampleSize}px`);

  // Force layout recalculation for CSS container queries
  void samples.offsetHeight;

  const sRect = samples.getBoundingClientRect();
  const targets = Array.from(samples.querySelectorAll<HTMLElement>('.sample__target')).filter((el) => {
    const comp = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return comp.display !== 'none' && comp.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });

  const allBoxes: PatchBox[] = [];
  const targetPositions: string[] = [];
  let centerBox: PatchBox | null = null;

  targets.forEach((t) => {
    const r = t.getBoundingClientRect();
    const pos = t.dataset.pos || '';
    const box: PatchBox = {
      x: Math.max(0, Math.min(1, (r.left - sRect.left) / sRect.width)),
      y: Math.max(0, Math.min(1, (r.top - sRect.top) / sRect.height)),
      width: Math.max(0.01, Math.min(1, r.width / sRect.width)),
      height: Math.max(0.01, Math.min(1, r.height / sRect.height))
    };
    allBoxes.push(box);
    targetPositions.push(pos);

    if (pos === 'mid-center') {
      centerBox = box;
    } else if (!centerBox && pos.includes('center')) {
      centerBox = box;
    }
  });

  if (!centerBox) {
    centerBox = allBoxes[Math.floor(allBoxes.length / 2)] || {
      x: Math.max(0, (safeW - sampleSize) / (2 * safeW)),
      y: Math.max(0, (safeH - sampleSize) / (2 * safeH)),
      width: Math.min(1, sampleSize / safeW),
      height: Math.min(1, sampleSize / safeH)
    };
  }

  return {
    allBoxes,
    centerBox,
    targetPositions
  };
}
