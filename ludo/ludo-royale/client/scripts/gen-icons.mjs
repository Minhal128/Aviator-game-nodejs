/**
 * gen-icons.mjs — builds the PWA icons (public/icons/icon-192.png and
 * icon-512.png) procedurally at build time: full-bleed violet gradient
 * (maskable-safe) + a white rounded die (face 5) with a soft purple shadow,
 * matching the in-game palette (theme/tokens.ts worldTop / sceneSkyMid /
 * hudInk / sceneShadowInk).
 *
 * Dependency-free on purpose: pixels are composed into a raw RGBA buffer and
 * the PNG is encoded by hand (node:zlib deflate + CRC32), so the repo ships
 * no binary assets and pulls no icon/canvas packages.
 *
 * Run: node scripts/gen-icons.mjs   (wired into the npm `dev`/`build` scripts)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ palette
const BG_TOP = [0x5e, 0x3f, 0xd6]; // worldTop
const BG_BOTTOM = [0x94, 0x63, 0xdd]; // sceneSkyMid
const DIE_TOP = [0xff, 0xff, 0xff];
const DIE_BOTTOM = [0xe7, 0xe2, 0xf5];
const PIP = [0x3a, 0x22, 0x70]; // hudInk
const SHADOW = [0x2a, 0x15, 0x60]; // sceneShadowInk

// -------------------------------------------------------------- PNG encoder
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // One filter byte (0 = None) prefixes every scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ drawing
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, f) => a + (b - a) * f;

/** Signed distance to a rounded rect centered at (cx, cy), half-size hw/hh. */
function rrSdf(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const dieHalf = size * 0.29;
  const dieR = size * 0.1;
  const tilt = (-8 * Math.PI) / 180; // playful die tilt
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const pipR = size * 0.052;
  const pipOff = size * 0.152;
  // Face 5 layout, in die-local coordinates.
  const pips = [
    [-pipOff, -pipOff],
    [pipOff, -pipOff],
    [0, 0],
    [-pipOff, pipOff],
    [pipOff, pipOff],
  ];

  for (let y = 0; y < size; y++) {
    const fy = y / (size - 1);
    for (let x = 0; x < size; x++) {
      // 1. Full-bleed vertical gradient + a faint glow behind the die.
      const glow = clamp01(1 - Math.hypot(x - c, y - c * 0.9) / (size * 0.62)) * 0.1;
      let r = mix(BG_TOP[0], BG_BOTTOM[0], fy) + glow * 255;
      let g = mix(BG_TOP[1], BG_BOTTOM[1], fy) + glow * 255;
      let b = mix(BG_TOP[2], BG_BOTTOM[2], fy) + glow * 255;

      // 2. Soft drop shadow under the die (wide SDF falloff = cheap blur).
      const shSdf = rrSdf(x, y, c, c + size * 0.055, dieHalf, dieHalf, dieR);
      const shA = clamp01(0.5 - shSdf / (size * 0.05)) * 0.32;
      r = mix(r, SHADOW[0], shA);
      g = mix(g, SHADOW[1], shA);
      b = mix(b, SHADOW[2], shA);

      // 3. The die: rotate the sample point into die-local space.
      const rx = cosT * (x - c) - sinT * (y - c) + c;
      const ry = sinT * (x - c) + cosT * (y - c) + c;
      const dieSdf = rrSdf(rx, ry, c, c, dieHalf, dieHalf, dieR);
      const dieA = clamp01(0.5 - dieSdf); // ~1px anti-aliased edge
      if (dieA > 0) {
        const dfy = clamp01((ry - (c - dieHalf)) / (dieHalf * 2));
        let dr = mix(DIE_TOP[0], DIE_BOTTOM[0], dfy);
        let dg = mix(DIE_TOP[1], DIE_BOTTOM[1], dfy);
        let db = mix(DIE_TOP[2], DIE_BOTTOM[2], dfy);
        for (const [ox, oy] of pips) {
          const pd = Math.hypot(rx - (c + ox), ry - (c + oy)) - pipR;
          const pa = clamp01(0.5 - pd);
          dr = mix(dr, PIP[0], pa);
          dg = mix(dg, PIP[1], pa);
          db = mix(db, PIP[2], pa);
        }
        r = mix(r, dr, dieA);
        g = mix(g, dg, dieA);
        b = mix(b, db, dieA);
      }

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(clamp01(r / 255) * 255);
      rgba[i + 1] = Math.round(clamp01(g / 255) * 255);
      rgba[i + 2] = Math.round(clamp01(b / 255) * 255);
      rgba[i + 3] = 255; // opaque: maskable-safe full-bleed tile
    }
  }
  return rgba;
}

// ------------------------------------------------------------------- output
const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(clientRoot, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size, drawIcon(size)));
}
process.stdout.write('gen-icons: public/icons/icon-192.png + icon-512.png written\n');
