import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = createCRC32Table();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function encodePNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image data with filter byte 0 for each scanline
  const scanlineLength = width * 4 + 1;
  const rawData = Buffer.alloc(height * scanlineLength);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // filter type 0: None
    rgbaBuffer.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Draws a high-DPI toggle switch icon:
 * - state: 'on' | 'off'
 * - size: width/height in pixels
 */
function renderSwitchIcon(size, state) {
  const buf = Buffer.alloc(size * size * 4);
  const isOn = state === 'on';

  // Coordinate space: 0 to 1
  // Pill track dimensions in normalized coordinates
  const pillW = 0.88;
  const pillH = 0.54;
  const pillX = (1 - pillW) / 2;
  const pillY = (1 - pillH) / 2;
  const radius = pillH / 2;

  // Thumb knob circle
  const thumbRadius = radius * 0.78;
  const thumbY = pillY + radius;
  const thumbX = isOn ? (pillX + pillW - radius) : (pillX + radius);

  // Super-sampling (4x4 per pixel for crisp anti-aliasing)
  const SAMPLES = 4;
  const step = 1 / SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const nx = (px + (sx + 0.5) * step) / size;
          const ny = (py + (sy + 0.5) * step) / size;

          // Check if point is inside thumb knob
          const dxThumb = nx - thumbX;
          const dyThumb = ny - thumbY;
          const distThumb = Math.sqrt(dxThumb * dxThumb + dyThumb * dyThumb);

          // Check if point is inside pill track
          let insidePill = false;
          const clampedX = Math.max(pillX + radius, Math.min(pillX + pillW - radius, nx));
          const dxPill = nx - clampedX;
          const dyPill = ny - (pillY + radius);
          const distPill = Math.sqrt(dxPill * dxPill + dyPill * dyPill);
          if (distPill <= radius) {
            insidePill = true;
          }

          if (distThumb <= thumbRadius) {
            // Thumb knob: crisp white with subtle specular highlight
            const highlight = Math.max(0, 1 - (distThumb / thumbRadius));
            rSum += 255;
            gSum += 255;
            bSum += 255;
            aSum += 255;
          } else if (insidePill) {
            if (isOn) {
              // ON Track: Modern Emerald -> Cyan Gradient (#10B981 to #06B6D4)
              const t = (nx - pillX) / pillW;
              const r = Math.round(16 * (1 - t) + 6 * t);
              const g = Math.round(185 * (1 - t) + 182 * t);
              const b = Math.round(129 * (1 - t) + 212 * t);
              rSum += r;
              gSum += g;
              bSum += b;
              aSum += 255;
            } else {
              // OFF Track: Muted Slate Gray (#475569)
              rSum += 71;
              gSum += 85;
              bSum += 105;
              aSum += 240;
            }
          }
        }
      }

      const totalSamples = SAMPLES * SAMPLES;
      const idx = (py * size + px) * 4;
      buf[idx] = Math.round(rSum / totalSamples);
      buf[idx + 1] = Math.round(gSum / totalSamples);
      buf[idx + 2] = Math.round(bSum / totalSamples);
      buf[idx + 3] = Math.round(aSum / totalSamples);
    }
  }

  return encodePNG(size, size, buf);
}

const outDir = path.resolve('src/assets/icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const sizes = [16, 32, 48, 128];
for (const s of sizes) {
  const onPng = renderSwitchIcon(s, 'on');
  fs.writeFileSync(path.join(outDir, `icon-${s}.png`), onPng);

  const offPng = renderSwitchIcon(s, 'off');
  fs.writeFileSync(path.join(outDir, `icon-off-${s}.png`), offPng);
}

console.log('Successfully generated ON/OFF switch icons for sizes:', sizes);
