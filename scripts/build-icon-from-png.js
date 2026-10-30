// Builds buildResources/icon.ico from a source PNG (the Google Drive image).
// No external dependencies — decodes PNG with Node's built-in zlib.
// Run: node scripts/build-icon-from-png.js [path/to/source.png]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = process.argv[2] || path.join(__dirname, '..', 'buildResources', 'icon.png');
const OUT = path.join(__dirname, '..', 'buildResources', 'icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

// ---------- PNG decode ----------
function decodePng(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Not a PNG file: ' + SRC);
  }

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len; // length + type + data + crc

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error('Only 8-bit PNGs are supported (got ' + bitDepth + ').');
      if (colorType !== 6 && colorType !== 2) throw new Error('Only RGBA (6) or RGB (2) PNGs are supported (got ' + colorType + ').');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new Error('Could not read PNG header.');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;

  // Un-filter scanlines.
  const pixels = Buffer.alloc(width * height * 4); // always RGBA
  const prev = Buffer.alloc(stride);

  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    const line = Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const val = raw[r++];
      const bpp = bytesPerPixel;
      const left = x >= bpp ? line[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;

      let v;
      switch (filter) {
        case 0: v = val; break;
        case 1: v = (val + left) & 255; break;
        case 2: v = (val + up) & 255; break;
        case 3: v = (val + ((left + up) >> 1)) & 255; break;
        case 4: {
          // Paeth predictor
          const p = left + up - ul;
          const pl = Math.abs(p - left), pu = Math.abs(p - up), pa = Math.abs(p - ul);
          const pred = (pl <= pu && pl <= pa) ? left : (pu <= pa) ? up : ul;
          v = (val + pred) & 255;
          break;
        }
        default: throw new Error('Unknown PNG filter type: ' + filter);
      }
      line[x] = v;
    }

    for (let x = 0; x < width; x++) {
      const o = y * width * 4 + x * 4;
      const s = x * bytesPerPixel;
      pixels[o] = line[s];
      pixels[o + 1] = line[s + 1];
      pixels[o + 2] = line[s + 2];
      pixels[o + 3] = bytesPerPixel === 4 ? line[s + 3] : 255;
    }

    line.copy(prev);
  }

  return { width, height, pixels };
}

// ---------- Area-average resize (good quality downscale) ----------
function resize(src, W, H) {
  const out = Buffer.alloc(W * H * 4);
  const sx = src.width / W;
  const sy = src.height / H;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(Math.ceil((x + 1) * sx), src.width);
      const y0 = Math.floor(y * sy), y1 = Math.min(Math.ceil((y + 1) * sy), src.height);

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy2 = y0; sy2 < y1; sy2++) {
        for (let sx2 = x0; sx2 < x1; sx2++) {
          const i = (sy2 * src.width + sx2) * 4;
          // Premultiply by alpha so transparent pixels don't darken edges
          const al = src.pixels[i + 3] / 255;
          r += src.pixels[i] * al;
          g += src.pixels[i + 1] * al;
          b += src.pixels[i + 2] * al;
          a += src.pixels[i + 3];
          n++;
        }
      }

      const o = (y * W + x) * 4;
      const am = a / n;
      out[o] = n ? Math.round(r / n * (am ? 255 / am : 0)) : 0;
      out[o + 1] = n ? Math.round(g / n * (am ? 255 / am : 0)) : 0;
      out[o + 2] = n ? Math.round(b / n * (am ? 255 / am : 0)) : 0;
      out[o + 3] = Math.round(am);
    }
  }

  return out;
}

// ---------- ICO ----------
function bmpEntry(S, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(S, 4);
  header.writeInt32LE(S * 2, 8);           // image + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const maskBytes = Math.ceil(S / 32) * 4 * S;
  header.writeUInt32LE(pixels.length + maskBytes, 20);

  // ICO stores rows bottom-up, BGRA
  const body = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const src = (y * S + x) * 4;
      const dst = ((S - 1 - y) * S + x) * 4;
      body[dst] = pixels[src + 2];
      body[dst + 1] = pixels[src + 1];
      body[dst + 2] = pixels[src];
      body[dst + 3] = pixels[src + 3];
    }
  }

  // AND mask: 1 = transparent, 0 = opaque
  const mask = Buffer.alloc(maskBytes);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (pixels[(y * S + x) * 4 + 3] < 128) {
        const row = maskBytes - (Math.ceil(S / 32) * 4) * (S - 1 - y); // rows bottom-up too
        const rb = Math.ceil(S / 32) * 4;
        const base = (S - 1 - y) * rb;
        mask[base + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
  }

  return Buffer.concat([header, body, mask]);
}

if (!fs.existsSync(SRC)) {
  console.error('Source PNG not found: ' + SRC);
  console.error('Download the Drive file first, e.g.:');
  console.error('  curl -L "https://drive.google.com/uc?export=download&id=<FILE_ID>" -o buildResources/icon.png');
  process.exit(1);
}

const src = decodePng(fs.readFileSync(SRC));
console.log('Source: ' + SRC + ' (' + src.width + 'x' + src.height + ')');

const entries = SIZES.map(S => ({ S, data: bmpEntry(S, resize(src, S, S)) }));

const dir = Buffer.alloc(6 + 16 * entries.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);            // type = icon
dir.writeUInt16LE(entries.length, 4);

let offset = dir.length;
entries.forEach((e, i) => {
  const p = 6 + i * 16;
  dir.writeUInt8(e.S === 256 ? 0 : e.S, p);
  dir.writeUInt8(e.S === 256 ? 0 : e.S, p + 1);
  dir.writeUInt16LE(0, p + 2);
  dir.writeUInt16LE(1, p + 4);
  dir.writeUInt16LE(32, p + 6);
  dir.writeUInt32LE(e.data.length, p + 8);
  dir.writeUInt32LE(offset, p + 12);
  offset += e.data.length;
});

const ico = Buffer.concat([dir, ...entries.map(e => e.data)]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ico);

console.log('Wrote ' + OUT + ' (' + ico.length + ' bytes, sizes: ' + SIZES.join(', ') + ')');