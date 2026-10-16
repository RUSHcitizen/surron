// Generates the PWA icons as PNGs with no dependencies (zlib + a tiny rasteriser).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Signed-distance helpers (in unit square coords)
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
function sdSeg(x, y, ax, ay, bx, by) {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}
function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function draw(size, { maskable = false, rounded = true }) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0.18 : 0.06;
  const s = (v) => pad + v * (1 - 2 * pad);
  const bolt = [[0.58, 0.08], [0.3, 0.52], [0.47, 0.52], [0.38, 0.92], [0.72, 0.42], [0.54, 0.42], [0.64, 0.08]].map(([a, b]) => [s(a), s(b)]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const u = (x + (sx + 0.5) / 3) / size, v = (y + (sy + 0.5) / 3) / size;
        // background: rounded square (or full bleed for maskable)
        let a = 1;
        if (rounded && !maskable) {
          const r = 0.2, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
          a = Math.hypot(dx, dy) <= r ? 1 : 0;
        }
        let col = [13 + 20 * v, 15 + 18 * v, 19 + 24 * v];
        // wheels
        const wr = 0.16 * (1 - 2 * pad);
        const d1 = Math.abs(sdCircle(u, v, s(0.24), s(0.74), wr)) - 0.03 * (1 - 2 * pad);
        const d2 = Math.abs(sdCircle(u, v, s(0.78), s(0.74), wr)) - 0.03 * (1 - 2 * pad);
        if (d1 < 0 || d2 < 0) col = [232, 232, 234];
        // frame line
        const fr = Math.min(sdSeg(u, v, s(0.24), s(0.74), s(0.48), s(0.5)), sdSeg(u, v, s(0.48), s(0.5), s(0.78), s(0.74)));
        if (fr < 0.022 * (1 - 2 * pad)) col = [232, 232, 234];
        if (inPoly(u, v, bolt)) col = [198, 244, 50];
        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += a * 255;
      }
      const i = (y * size + x) * 4;
      px[i] = acc[0] / 9; px[i + 1] = acc[1] / 9; px[i + 2] = acc[2] / 9; px[i + 3] = acc[3] / 9;
    }
  }
  return png(size, size, px);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', draw(192, {}));
writeFileSync('public/icons/icon-512.png', draw(512, {}));
writeFileSync('public/icons/icon-maskable-512.png', draw(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', draw(180, { rounded: false }));
console.log('icons written');
