/**
 * Heading-up minimap. The whole world is painted once into an offscreen canvas from the
 * terrain's surface map (roads, paths, grass, sand), the lake and the building footprints;
 * each update just draws a rotated crop of it around the bike, plus traffic and the bike.
 */
import type { Game } from '../game/game';

const SURF_RGB: [number, number, number][] = [
  [62, 66, 72], // asphalt
  [150, 150, 146], // concrete
  [140, 104, 66], // dirt
  [74, 104, 52], // grass
  [196, 178, 128], // sand
  [128, 122, 112], // gravel
];

export class Minimap {
  el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private px = 1;
  private x0 = 0;
  private z0 = 0;
  /** Visible radius in metres. */
  range = 140;

  constructor(private game: Game) {
    this.el = document.createElement('canvas');
    this.el.className = 'hud-map';
    this.ctx = this.el.getContext('2d')!;
  }

  private build() {
    const d = this.game.data, hf = d.terrain;
    const n = hf.n;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const { lake } = d;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        let [r, gg, b] = SURF_RGB[hf.surfaces[i]] ?? SURF_RGB[3];
        const x = hf.x0 + ix * hf.cell, z = hf.z0 + iz * hf.cell;
        if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r && hf.heights[i] < lake.level) [r, gg, b] = [52, 104, 150];
        const o = i * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Building footprints.
    g.fillStyle = 'rgb(190,186,176)';
    for (const bx of d.boxes) {
      if (bx.kind !== 'building' && bx.kind !== 'warehouse') continue;
      g.save();
      g.translate((bx.x - hf.x0) / hf.cell, (bx.z - hf.z0) / hf.cell);
      g.rotate(-(bx.yaw ?? 0));
      g.fillRect(-bx.sx / 2 / hf.cell, -bx.sz / 2 / hf.cell, bx.sx / hf.cell, bx.sz / hf.cell);
      g.restore();
    }
    this.base = c;
    this.px = 1 / hf.cell;
    this.x0 = hf.x0;
    this.z0 = hf.z0;
  }

  draw() {
    if (!this.base) this.build();
    const el = this.el;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(el.clientWidth * dpr);
    if (w <= 0) return;
    if (el.width !== w) el.width = el.height = w;
    const g = this.ctx, b = this.game.bike;
    const cx = w / 2;
    const k = (w / 2 / this.range) / this.px; // canvas px per base px
    g.save();
    g.clearRect(0, 0, w, w);
    g.beginPath();
    g.arc(cx, cx, cx, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgb(74,104,52)';
    g.fillRect(0, 0, w, w);
    // Heading up: rotate the map so the bike's forward (sin yaw, cos yaw) points up.
    g.translate(cx, cx);
    g.rotate(b.yaw - Math.PI);
    g.scale(k, k);
    g.translate(-(b.pos.x - this.x0) * this.px, -(b.pos.z - this.z0) * this.px);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base!, 0, 0);
    // Traffic.
    g.fillStyle = '#ff5468';
    const r = 1.6 / k * dpr;
    for (const car of this.game.traffic.cars) {
      const dx = car.x - b.pos.x, dz = car.z - b.pos.z;
      if (dx * dx + dz * dz > this.range * this.range * 1.1) continue;
      g.beginPath();
      g.arc((car.x - this.x0) * this.px, (car.z - this.z0) * this.px, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Bike arrow (always pointing up) and a rim.
    g.save();
    g.translate(cx, cx);
    g.fillStyle = '#c6f432';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = dpr;
    const s = 6 * dpr;
    g.beginPath();
    g.moveTo(0, -s * 1.3);
    g.lineTo(s * 0.85, s);
    g.lineTo(0, s * 0.45);
    g.lineTo(-s * 0.85, s);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.beginPath();
    g.arc(cx, cx, cx - dpr, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2 * dpr;
    g.stroke();
  }
}
