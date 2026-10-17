import { it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/world/layout';
// Top-down map (surface colours, boxes dark, heights shaded): tools/shots/map.png
it('map', () => {
  const d = generateWorld();
  const N = 800, img = Buffer.alloc(N * N * 3);
  const col: Record<string, number[]> = { asphalt: [60, 60, 66], concrete: [150, 150, 150], dirt: [140, 100, 60], grass: [80, 130, 60], sand: [220, 200, 140], gravel: [120, 115, 110] };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - 400, z = 400 - j;
    const c = col[d.terrain.surfaceAt(x, z)] ?? [255, 0, 255];
    const h = d.terrain.heightAt(x, z);
    const k = Math.max(0.5, Math.min(1.4, 1 + h / 40));
    const o = (j * N + i) * 3;
    img[o] = Math.min(255, c[0] * k); img[o + 1] = Math.min(255, c[1] * k); img[o + 2] = Math.min(255, c[2] * k);
    if (x % 100 === 0 || z % 100 === 0) { img[o] = 255; img[o + 1] = 255; img[o + 2] = 0; }
  }
  for (const b of d.boxes) {
    if (b.kind === 'invisible') continue;
    for (let x = Math.round(b.x - b.sx / 2); x <= b.x + b.sx / 2; x++) for (let z = Math.round(b.z - b.sz / 2); z <= b.z + b.sz / 2; z++) {
      const i = x + 400, j = 400 - z;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const o = (j * N + i) * 3; img[o] = 30; img[o + 1] = 20; img[o + 2] = 40;
    }
  }
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let j = 0; j < N; j++) { raw[j * (N * 3 + 1)] = 0; img.copy(raw, j * (N * 3 + 1) + 1, j * N * 3, (j + 1) * N * 3); }
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync('tools/shots/map.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
});
