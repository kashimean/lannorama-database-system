// Generates every icon asset from the two source PNGs.
//   desktop source -> Windows taskbar / .ico / in-app interface
//   mobile source  -> iOS + Android launcher icons + PWA manifest icons
// No external dependencies: PNG decode with zlib, PNG encode with zlib.
//
// Run: node scripts/build-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DESKTOP_SRC = path.join(ROOT, 'buildResources', 'source-desktop.png');
const MOBILE_SRC = path.join(ROOT, 'buildResources', 'source-mobile.png');

// ---------- PNG decode ----------
function decodePng(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Not a PNG file: ' + buf);
  }

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;

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
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;

  const pixels = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);

  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    const line = Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const val = raw[r++];
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
      const o = (y * width + x) * 4;
      const s = x * bpp;
      pixels[o] = line[s];
      pixels[o + 1] = line[s + 1];
      pixels[o + 2] = line[s + 2];
      pixels[o + 3] = bpp === 4 ? line[s + 3] : 255;
    }

    line.copy(prev);
  }

  return { width, height, pixels };
}

// ---------- Area-average resize ----------
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

// ---------- PNG encode ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(W, H, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    pixels.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- ICO ----------
function bmpEntry(S, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(S, 4);
  header.writeInt32LE(S * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const maskBytes = Math.ceil(S / 32) * 4 * S;
  header.writeUInt32LE(pixels.length + maskBytes, 20);

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

  const mask = Buffer.alloc(maskBytes);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (pixels[(y * S + x) * 4 + 3] < 128) {
        const rb = Math.ceil(S / 32) * 4;
        const base = (S - 1 - y) * rb;
        mask[base + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
  }

  return Buffer.concat([header, body, mask]);
}

function buildIco(src, out) {
  const SIZES = [16, 32, 48, 64, 128, 256];
  const entries = SIZES.map(S => ({ S, data: bmpEntry(S, resize(src, S, S)) }));

  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
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
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, ico);
  console.log('  ' + path.relative(ROOT, out) + ' (' + ico.length + ' bytes, ' + SIZES.join(', ') + ')');
}

function writePng(src, size, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = encodePng(size, size, resize(src, size, size));
  fs.writeFileSync(out, buf);
  console.log('  ' + path.relative(ROOT, out) + ' (' + size + 'x' + size + ', ' + buf.length + ' bytes)');
}

// Adaptive icon foregrounds are drawn onto a 108dp canvas and then masked to a circle,
// diamond or squircle by the launcher. Content must stay inside the ~66% safe zone or it
// gets clipped, so the artwork is centred with transparent padding around it.
function writePaddedPng(src, canvasSize, contentSize, out) {
  const art = resize(src, contentSize, contentSize);
  const canvas = Buffer.alloc(canvasSize * canvasSize * 4);
  const off = Math.floor((canvasSize - contentSize) / 2);

  for (let y = 0; y < contentSize; y++) {
    for (let x = 0; x < contentSize; x++) {
      const s = (y * contentSize + x) * 4;
      const d = ((y + off) * canvasSize + (x + off)) * 4;
      canvas[d] = art[s];
      canvas[d + 1] = art[s + 1];
      canvas[d + 2] = art[s + 2];
      canvas[d + 3] = art[s + 3];
    }
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = encodePng(canvasSize, canvasSize, canvas);
  fs.writeFileSync(out, buf);
  console.log('  ' + path.relative(ROOT, out) + ' (' + canvasSize + 'x' + canvasSize + ', art ' + contentSize + 'x' + contentSize + ', ' + buf.length + ' bytes)');
}

for (const f of [DESKTOP_SRC, MOBILE_SRC]) {
  if (!fs.existsSync(f)) {
    console.error('Missing source: ' + f);
    console.error('Download it first: curl -L "https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1024" -o ' + f);
    process.exit(1);
  }
}

const desktop = decodePng(fs.readFileSync(DESKTOP_SRC));
const mobile = decodePng(fs.readFileSync(MOBILE_SRC));

console.log('Desktop source: ' + desktop.width + 'x' + desktop.height);
console.log('Mobile source:  ' + mobile.width + 'x' + mobile.height);

console.log('\nDesktop (taskbar / in-app):');
writePng(desktop, 512, path.join(ROOT, 'buildResources', 'icon.png'));
buildIco(desktop, path.join(ROOT, 'buildResources', 'icon.ico'));
writePng(desktop, 512, path.join(ROOT, 'src', 'assets', 'icon.png'));

console.log('\nAndroid launcher (mipmap densities):');
// Launcher icon sizes and adaptive-icon foreground sizes per density bucket.
// Launcher icon = 48dp, adaptive canvas = 108dp, safe zone = 66% of the canvas.
const ANDROID = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 152, xxxhdpi: 192 };
const ANDROID_ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

for (const [d, size] of Object.entries(ANDROID)) {
  const dir = path.join(ROOT, 'mobile', 'icons', 'android', 'mipmap-' + d);
  writePng(mobile, size, path.join(dir, 'ic_launcher.png'));
  writePng(mobile, size, path.join(dir, 'ic_launcher_round.png'));
  writePaddedPng(mobile, ANDROID_ADAPTIVE[d], Math.round(ANDROID_ADAPTIVE[d] * 0.66), path.join(dir, 'ic_launcher_foreground.png'));

  // Mirror into the Android project so a build picks them up without a manual copy.
  if (fs.existsSync(ANDROID_RES)) {
    const target = path.join(ANDROID_RES, 'mipmap-' + d);
    if (fs.existsSync(target)) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
        fs.copyFileSync(path.join(dir, name), path.join(target, name));
      }
    }
  }
}

console.log('\niOS launcher (Apple requires these exact sizes):');
for (const size of [1024, 180, 120, 76, 40]) {
  writePng(mobile, size, path.join(ROOT, 'mobile', 'icons', 'ios', 'Icon-' + size + '.png'));
}

console.log('\nPWA manifest icons:');
writePng(mobile, 192, path.join(ROOT, 'src', 'assets', 'pwa-192.png'));
writePng(mobile, 512, path.join(ROOT, 'src', 'assets', 'pwa-512.png'));
writePng(mobile, 180, path.join(ROOT, 'src', 'assets', 'apple-touch-icon.png'));

console.log('\nDone.');
