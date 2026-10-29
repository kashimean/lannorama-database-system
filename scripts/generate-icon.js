// Generates buildResources/icon.ico with no external dependencies.
// Run: node scripts/generate-icon.js
//
// Design: rounded square, indigo -> cyan gradient, white camera glyph.

const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 256];
const OUT = path.join(__dirname, '..', 'buildResources', 'icon.ico');

const TOP = [99, 102, 241];    // #6366f1
const BOTTOM = [6, 182, 212];  // #06b6d4
const WHITE = [248, 250, 252];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function roundedRect(x, y, w, h, r) {
  if (x < r) return false;
  if (y < r) return false;
  if (x > w - r) return false;
  if (y > h - r) return false;
  return true;
}

function inRounded(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function renderSize(S) {
  const pixels = new Uint8Array(S * S * 4);

  // Background rounded square
  const pad = Math.round(S * 0.04);
  const r = Math.round(S * 0.22);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x, y, pad, pad, S - pad, S - pad, r)) continue;

      const t = (x + y) / (2 * S);
      const col = [lerp(TOP[0], BOTTOM[0], t), lerp(TOP[1], BOTTOM[1], t), lerp(TOP[2], BOTTOM[2], t)];

      // Camera glyph (only when big enough to look clean)
      if (S >= 32) {
        const bx0 = Math.round(S * 0.20), by0 = Math.round(S * 0.34);
        const bx1 = Math.round(S * 0.80), by1 = Math.round(S * 0.72);
        const br = Math.round(S * 0.08);

        // viewfinder bump
        const vx0 = Math.round(S * 0.38), vy0 = Math.round(S * 0.24);
        const vx1 = Math.round(S * 0.62), vy1 = Math.round(S * 0.34);

        const onBody = inRounded(x, y, bx0, by0, bx1, by1, br);
        const onBump = inRounded(x, y, vx0, vy0, vx1, vy1, Math.round(S * 0.04));

        if (onBody || onBump) {
          // lens hole
          const lensR = Math.round(S * 0.15);
          const lensC = Math.round(S * 0.50);
          if (inCircle(x, y, lensC, Math.round(S * 0.53), lensR)) {
            const ringR = Math.round(S * 0.11);
            if (!inCircle(x, y, lensC, Math.round(S * 0.53), ringR)) {
              col[0] = WHITE[0]; col[1] = WHITE[1]; col[2] = WHITE[2];
            } else {
              col[0] = 15; col[1] = 23; col[2] = 42;
            }
          } else {
            col[0] = WHITE[0]; col[1] = WHITE[1]; col[2] = WHITE[2];
          }
        }
      } else {
        col[0] = WHITE[0]; col[1] = WHITE[1]; col[2] = WHITE[2];
      }

      // ICO BMP stores rows bottom-up, BGRA
      const idx = ((S - 1 - y) * S + x) * 4;
      pixels[idx] = col[2];
      pixels[idx + 1] = col[1];
      pixels[idx + 2] = col[0];
      pixels[idx + 3] = 255;
    }
  }

  return pixels;
}

function buildEntry(S, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);            // header size
  header.writeInt32LE(S, 4);              // width
  header.writeInt32LE(S * 2, 8);          // height (image + mask)
  header.writeUInt16LE(1, 12);            // planes
  header.writeUInt16LE(32, 14);           // bpp
  header.writeUInt32LE(0, 16);            // compression
  const maskBytes = Math.ceil(S / 32) * 4 * S;
  header.writeUInt32LE(pixels.length + maskBytes, 20);

  // AND mask (all zero = fully opaque)
  const mask = Buffer.alloc(maskBytes);

  return Buffer.concat([header, pixels, mask]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const entries = SIZES.map(S => ({ S, data: buildEntry(S, renderSize(S)) }));

const dir = Buffer.alloc(6 + 16 * entries.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);                  // type = icon
dir.writeUInt16LE(entries.length, 4);

let offset = dir.length;
entries.forEach((e, i) => {
  const p = 6 + i * 16;
  dir.writeUInt8(e.S === 256 ? 0 : e.S, p);       // width (0 means 256)
  dir.writeUInt8(e.S === 256 ? 0 : e.S, p + 1);   // height
  dir.writeUInt16LE(0, p + 2);
  dir.writeUInt16LE(1, p + 4);
  dir.writeUInt16LE(32, p + 6);
  dir.writeUInt32LE(e.data.length, p + 8);
  dir.writeUInt32LE(offset, p + 12);
  offset += e.data.length;
});

const ico = Buffer.concat([dir, ...entries.map(e => e.data)]);
fs.writeFileSync(OUT, ico);

console.log(`Wrote ${OUT} (${ico.length} bytes, sizes: ${SIZES.join(', ')})`);
