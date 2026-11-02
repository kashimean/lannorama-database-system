// Generates the NSIS installer graphics (24-bit BMP) in the 49ers theme.
// electron-builder requires exact sizes: header 164x57, sidebar 164x314
// (MUI_HEADERIMAGE_BITMAP and MUI_WELCOMEFINISHPAGE_BITMAP). These only apply
// to the assisted installer, which is what `oneClick: false` produces.
// No image library is used - BMP is simple enough to write by hand.
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'buildResources');

// 49ers palette (BMP stores BGR)
const SCARLET = [198, 1, 31];
const GOLD = [207, 177, 84];
const DARK = [18, 6, 7];
const DARK2 = [42, 17, 20];
const WHITE = [248, 250, 252];

// Minimal 5x7 bitmap font (rows top -> bottom, '#' = lit pixel)
const FONT = {
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': '#####,#....#,#....#,#####,....#,#....#,#####'.split(','),
  'C': '.###.,#....#,#....#,#....#,#....#,#....#,.###.'.split(','),
  'D': '#####,....#,#....#,#....#,#....#,....#,#####'.split(','),
  'E': '#####,#....#,#....#,#####,#....#,#....#,#####'.split(','),
  'F': '#####,#....#,#....#,#####,....#,....#,....#'.split(','),
  'G': '.###.,#....#,#....#,#..###,#....#,#....#,.###.'.split(','),
  'H': '#...#,#....#,#####,#....#,#....#,#....#,....#'.split(','),
  'I': '#####,..#..,..#..,..#..,..#..,..#..,#####'.split(','),
  'J': '....#,#....#,#....#,#....#,#....#,#....#,.###.'.split(','),
  'K': '#....#,#...#,#..#,###.,#..#,#...#,#....#'.split(','),
  'L': '#....#,#....#,#....#,#....#,#....#,#....#,#####'.split(','),
  'M': '#...#,#.#.#,#.#.#,#.#.#,#...#,#...#,....#'.split(','),
  'N': '#...#,#.#.#,#.#.#,#.#.#,#...#,#...#,....#'.split(','),
  'O': '.###.,#...#,#...#,#...#,#...#,#...#,.###.'.split(','),
  'P': '#####,#...#,#...#,#####,....#,....#,....#'.split(','),
  'Q': '.###.,#...#,#...#,#...#,#.#.#,#.#.#,.#.#.'.split(','),
  'R': '#####,#...#,#...#,#####,.#.#,#..#,#...#'.split(','),
  'S': '.####,#....#,#....#,.###.,....#,#....#,####.'.split(','),
  'T': '#####,..#..,..#..,..#..,..#..,..#..,..#..'.split(','),
  'U': '#...#,#...#,#...#,#...#,#...#,#...#,.###.'.split(','),
  'V': '#...#,#...#,#...#,#...#,#...#,.#.#.,..#..'.split(','),
  'W': '.....#,#...#,#...#,#.#.#,#.#.#,#.#.#,.#.#.'.split(','),
  'X': '#...#,#...#,.#.#.,..#..,.#.#.,#...#,#...#'.split(','),
  'Y': '#...#,#...#,.#.#.,..#..,..#..,..#..,..#..'.split(','),
  'Z': '#####,....#,...#.,..#..,.#...,#....,#####'.split(','),
  '0': '.###.,#...#,#.#.#,#.#.#,#.#.#,#...#,.###.'.split(','),
  '1': '..#..,.##..,..#..,..#..,..#..,..#..,#####'.split(','),
  '2': '.###.,#...#,....#,...#.,..#..,.#...,#####'.split(','),
  '3': '#####,...#.,...#.,.###.,....#,....#,#####'.split(','),
  '4': '....#,...#.,..#..,.#...,#....,#####,....#'.split(','),
  '5': '#####,#....,#####,....#,....#,....#,#####'.split(','),
  '6': '.###.,#....,#####,....#,#....,#....,.###.'.split(','),
  '7': '#####,....#,...#.,..#..,.#...,#....,#....'.split(','),
  '8': '.###.,#...#,.#.#.,..#..,.#.#.,#...#,.###.'.split(','),
  '9': '.###.,#...#,#...#,.###.,....#,....#,....#'.split(','),
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '&': '.##..,#..#.,#..#.,.##..,#.#.#,#..#.,.##.#'.split(','),
  '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
  ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
};

function glyph(ch) {
  const raw = FONT[ch.toUpperCase()] || FONT[' '];
  // Normalize every row to exactly 5 columns (some entries above are 6 wide).
  return raw.map(r => r.padEnd(5, '.').slice(0, 5));
}

function makeCanvas(w, h) {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => DARK));
}

// Diagonal gradient fill
function gradient(canvas, w, h, c1, c2) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      canvas[y][x] = [
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
      ];
    }
  }
}

function drawText(canvas, text, x, y, color, scale = 1) {
  const h = 7 * scale;
  for (let i = 0; i < text.length; i++) {
    const g = glyph(text[i]);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] !== '#') continue;
        const px = x + (i * 6 * scale) + c * scale;
        const py = y + r * scale;
        if (py < 0 || py >= canvas.length || px < 0 || px >= canvas[0].length) continue;
        canvas[py][px] = color;
      }
    }
  }
}

function writeBmp(file, canvas) {
  const h = canvas.length;
  const w = canvas[0].length;
  const rowPad = (4 - (w * 3) % 4) % 4;
  const dataSize = (w * 3 + rowPad) * h;
  const infoSize = 40;
  const fileSize = 54 + infoSize + dataSize;

  const buf = Buffer.alloc(fileSize);
  // BITMAPFILEHEADER
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54 + infoSize, 10);
  // BITMAPINFOHEADER
  buf.writeUInt32LE(infoSize, 14);
  buf.writeUInt32LE(w, 18);
  buf.writeUInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);

  // BMP rows are stored bottom-up
  for (let y = 0; y < h; y++) {
    const row = canvas[h - 1 - y];
    for (let x = 0; x < w; x++) {
      const [r, g, b] = row[x];
      const off = 54 + infoSize + y * (w * 3 + rowPad) + x * 3;
      buf[off] = b;
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
  }
  fs.writeFileSync(file, buf);
  return file;
}

// ---- Installer header (164x57) ----
const HW = 164, HH = 57;
const header = makeCanvas(HW, HH);
gradient(header, HW, HH, [30, 8, 10], SCARLET);
// gold accent bar along the bottom
for (let x = 0; x < HW; x++) {
  for (let y = HH - 3; y < HH; y++) header[y][x] = GOLD;
}
drawText(header, 'LANNORAMA', 10, 14, WHITE, 2);
drawText(header, 'DATABASE SYSTEM', 10, 36, GOLD, 1);

// ---- Installer sidebar (164x314, MUI_WELCOMEFINISHPAGE_BITMAP) ----
const SW = 164, SH = 314;
const sidebar = makeCanvas(SW, SH);
gradient(sidebar, SW, SH, DARK, [60, 12, 16]);
// gold frame
for (let x = 0; x < SW; x++) { sidebar[0][x] = GOLD; sidebar[SH - 1][x] = GOLD; }
for (let y = 0; y < SH; y++) { sidebar[y][0] = GOLD; sidebar[y][SW - 1] = GOLD; }
// scarlet banner block
for (let y = 18; y < 66; y++) {
  for (let x = 10; x < SW - 10; x++) {
    const t = (y - 24) / 54;
    sidebar[y][x] = [
      Math.round(SCARLET[0] + (DARK2[0] - SCARLET[0]) * t),
      Math.round(SCARLET[1] + (DARK2[1] - SCARLET[1]) * t),
      Math.round(SCARLET[2] + (DARK2[2] - SCARLET[2]) * t),
    ];
  }
}
drawText(sidebar, 'LANNORAMA', 14, 30, WHITE, 2);
drawText(sidebar, 'DATABASE SYSTEM', 14, 52, GOLD, 1);
drawText(sidebar, 'EQUIPMENT TRACKER', 12, 86, WHITE, 1);
drawText(sidebar, 'INSTALL / UPDATE', 12, 104, GOLD, 1);
drawText(sidebar, 'OFFLINE FIRST', 12, 126, WHITE, 1);
drawText(sidebar, 'CLOUD SYNCED', 12, 144, WHITE, 1);
drawText(sidebar, '49ERS THEME', 12, 162, GOLD, 1);

fs.mkdirSync(OUT_DIR, { recursive: true });
const hFile = writeBmp(path.join(OUT_DIR, 'installerHeader.bmp'), header);
const sFile = writeBmp(path.join(OUT_DIR, 'installerSidebar.bmp'), sidebar);
console.log('wrote', hFile);
console.log('wrote', sFile);
