/**
 * gen-icons.mjs — draw the app icon set from the BrandMark geometry.
 *
 *   node scripts/gen-icons.mjs
 *
 * WHY A SCRIPT AND NOT AN EXPORTED ASSET: the logo is defined by CSS in
 * `components/shell/BrandMark.vue` — a rounded tile holding two offset squares ("local copy +
 * synced copy: two blocks, offset, same shape", design_skiil.md §Brand/Logo). There is no source
 * file to export from, and no rasterizer in this project's toolchain. The geometry is simple
 * enough to draw directly, so the icons stay derived from the same numbers the component uses:
 * change the brand, re-run this, and every size follows.
 *
 * PNG is written by hand — Node's zlib is the only thing needed. A PNG is a signature, an IHDR,
 * one deflated IDAT of filter-prefixed RGBA scanlines, and an IEND.
 *
 * THREE VARIANTS, because the platforms genuinely differ:
 *   any       rounded tile, transparent outside the corners — the browser/OS shows it as-is
 *   maskable  full bleed, mark shrunk into the safe zone — Android crops this to its own shape,
 *             and anything outside the central 80% circle can be cut off
 *   apple     full bleed, NO transparency — iOS composites a transparent icon onto BLACK and
 *             rounds the corners itself, so a rounded transparent tile gets black wedges
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* --- brand colours: the indigo preset from theme/tokens.css §5 -------------- */
const ACCENT_MID = [0x6c, 0x7b, 0xf5]; // --accent-mid, top of the tile gradient
const ACCENT_DEEP = [0x4e, 0x5a, 0xd9]; // --accent-deep, bottom of the tile gradient
const WHITE = [0xff, 0xff, 0xff];

/* --- geometry, in fractions of the icon's side (BrandMark.vue) -------------- */
const SQUARE = 0.37; // each block's side, relative to the mark group's box
const SQUARE_R = 0.1; // each block's corner radius
const OFFSET = 0.17; // how far the front block is pushed down-right from the back one
const GROUP = SQUARE + OFFSET; // 0.54 — the mark's total extent

/** Signed distance to a rounded rectangle: negative inside, positive outside. */
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Paint `src` over `dst` (both RGBA 0-255 arrays) with coverage `a` in 0..1. */
function over(dst, i, src, a) {
  if (a <= 0) return;
  const sa = a;
  const da = dst[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round((src[c] * sa + dst[i + c] * da * (1 - sa)) / outA);
  }
  dst[i + 3] = Math.round(outA * 255);
}

/**
 * Render one icon.
 * @param {number} size    pixels, square
 * @param {'any'|'maskable'|'apple'} variant
 */
function render(size, variant) {
  const px = new Uint8Array(size * size * 4); // starts fully transparent
  const SS = 4; // 4×4 supersampling — the corners are curves, and jaggies show at 192px
  const step = 1 / SS;

  // the tile: rounded for 'any', full bleed for the two the OS masks itself
  const tileR = variant === 'any' ? size * 0.22 : 0;

  // how much of the icon the mark occupies. 'maskable' must stay inside the safe zone: a circle
  // of 80% diameter, whose inscribed square is 0.8/√2 ≈ 0.566 of the side. 0.50 leaves margin.
  const groupFrac = variant === 'maskable' ? 0.5 : 0.62;
  const groupPx = size * groupFrac;
  const groupX = (size - groupPx) / 2;
  const groupY = (size - groupPx) / 2;

  // the two blocks, in absolute pixels
  const sq = (groupPx / GROUP) * SQUARE;
  const sqR = (groupPx / GROUP) * SQUARE_R;
  const off = (groupPx / GROUP) * OFFSET;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      let tileCov = 0;
      let backCov = 0;
      let frontCov = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) * step;
          const fy = y + (sy + 0.5) * step;

          if (tileR > 0) {
            if (sdRoundRect(fx, fy, 0, 0, size, size, tileR) <= 0) tileCov++;
          } else {
            tileCov++;
          }
          if (sdRoundRect(fx, fy, groupX, groupY, sq, sq, sqR) <= 0) backCov++;
          if (sdRoundRect(fx, fy, groupX + off, groupY + off, sq, sq, sqR) <= 0) frontCov++;
        }
      }

      const n = SS * SS;
      // tile gradient: accent-mid at the top easing to accent-deep at the bottom
      const t = y / (size - 1);
      const bg = [
        Math.round(ACCENT_MID[0] + (ACCENT_DEEP[0] - ACCENT_MID[0]) * t),
        Math.round(ACCENT_MID[1] + (ACCENT_DEEP[1] - ACCENT_MID[1]) * t),
        Math.round(ACCENT_MID[2] + (ACCENT_DEEP[2] - ACCENT_MID[2]) * t),
      ];

      over(px, i, bg, tileCov / n);
      // the back block is the "other copy": same shape, held back at 42% so the front one leads
      over(px, i, WHITE, (backCov / n) * 0.42);
      over(px, i, WHITE, frontCov / n);
    }
  }

  return px;
}

/* --- PNG container --------------------------------------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // truecolour with alpha
  // 10,11,12 = deflate / adaptive filtering / no interlace, all zero

  // each scanline is prefixed with its filter type; 0 (None) keeps this readable and deflate
  // still does the work on what is mostly flat colour
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- favicon.svg: the same geometry, but vector ---------------------------- */
function faviconSvg() {
  const S = 64;
  const g = S * 0.62;
  const x0 = (S - g) / 2;
  const sq = (g / GROUP) * SQUARE;
  const r = (g / GROUP) * SQUARE_R;
  const off = (g / GROUP) * OFFSET;
  const f = (n) => Number(n.toFixed(2));
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hex(ACCENT_MID)}"/>
      <stop offset="1" stop-color="${hex(ACCENT_DEEP)}"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${f(S * 0.22)}" fill="url(#g)"/>
  <rect x="${f(x0)}" y="${f(x0)}" width="${f(sq)}" height="${f(sq)}" rx="${f(r)}" fill="#fff" opacity="0.42"/>
  <rect x="${f(x0 + off)}" y="${f(x0 + off)}" width="${f(sq)}" height="${f(sq)}" rx="${f(r)}" fill="#fff"/>
</svg>
`;
}

/* --- go -------------------------------------------------------------------- */
mkdirSync(OUT, { recursive: true });

const targets = [
  ['pwa-192.png', 192, 'any'],
  ['pwa-512.png', 512, 'any'],
  ['maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'apple'],
  ['favicon-48.png', 48, 'any'],
];

for (const [name, size, variant] of targets) {
  const png = toPng(render(size, variant), size);
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(22)} ${size}×${size} ${variant.padEnd(9)} ${(png.length / 1024).toFixed(1)} kB`);
}

writeFileSync(join(OUT, 'favicon.svg'), faviconSvg());
console.log('favicon.svg            vector');
