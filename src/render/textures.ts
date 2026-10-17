/** Procedural canvas textures — no image downloads, fully offline. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { mulberry32 } from '../core/noise';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

function tex(c: HTMLCanvasElement, repeat = false, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, Texture>();
/** Per-build textures (livery, plate) are keyed by colour/number, so they are kept in a small LRU. */
const LRU_PREFIXES = ['livery-', 'plate-'];
const LRU_MAX = 12;
function cached<T extends Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (t) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, t);
    return t;
  }
  cache.set(key, (t = make()));
  if (LRU_PREFIXES.some((p) => key.startsWith(p))) {
    const lru = [...cache.keys()].filter((k) => LRU_PREFIXES.some((p) => k.startsWith(p)));
    // Evicted textures are disposed (GPU memory freed); if still in use three.js re-uploads them.
    for (const k of lru.slice(0, Math.max(0, lru.length - LRU_MAX))) {
      cache.get(k)?.dispose();
      cache.delete(k);
    }
  }
  return t;
}

/** Building façade: windows on a neutral base (tinted by material colour). */
export function facadeTexture(): CanvasTexture {
  return cached('facade', () => {
    const { c, g } = canvas(256, 256);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    const r = mulberry32(3);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const lit = r() < 0.25;
        g.fillStyle = lit ? '#e9e3c8' : '#5b6773';
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 36);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 4);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < 4; y++) g.fillRect(0, y * 64 + 58, 256, 4);
    return tex(c, true);
  });
}

/** Emissive window mask for night lighting. */
export function facadeEmissive(): CanvasTexture {
  return cached('facadeE', () => {
    const { c, g } = canvas(256, 256);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    const r = mulberry32(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (r() < 0.25) {
        g.fillStyle = '#ffd890';
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 36);
      }
    }
    return tex(c, true);
  });
}

/** Grey-scale noise detail for terrain (multiplied with vertex colours). */
export function groundDetail(): CanvasTexture {
  return cached('ground', () => {
    const { c, g } = canvas(256, 256);
    const img = g.createImageData(256, 256);
    const r = mulberry32(9);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 200 + r() * 55;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // soft blotches
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 6 + r() * 26, 0, Math.PI * 2);
      g.fill();
    }
    return tex(c, true, false);
  });
}

/** Tire tread bump pattern. */
export function treadTexture(kind: string): CanvasTexture {
  return cached('tread-' + kind, () => {
    const { c, g } = canvas(64, 256);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#202020';
    const rows = kind === 'street' ? 16 : kind === 'dualsport' ? 20 : 24;
    for (let i = 0; i < rows; i++) {
      const y = (i * 256) / rows;
      if (kind === 'street') {
        g.fillRect(8 + (i % 2) * 24, y, 24, 3);
      } else if (kind === 'paddle') {
        g.fillRect(0, y, 64, 4);
      } else {
        g.fillRect(4 + (i % 2) * 12, y + 2, 16, 6);
        g.fillRect(36 + (i % 2) * 8, y + 4, 16, 6);
      }
    }
    return tex(c, true, false);
  });
}

/** Number plate with original styling. */
export function plateTexture(number: string, bg: string, fg: string): CanvasTexture {
  return cached(`plate-${number}-${bg}-${fg}`, () => {
    const { c, g } = canvas(256, 192);
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, 248, 184, 28);
    g.fill();
    g.fillStyle = fg;
    g.font = 'bold 128px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(number, 128, 104);
    return tex(c);
  });
}

/** Side-panel livery: base plastic colour + decal + number. */
export function liveryTexture(base: string, decal: string, decalColor: string, accent: string, number: string): CanvasTexture {
  return cached(`livery-${base}-${decal}-${decalColor}-${accent}-${number}`, () => {
    const { c, g } = canvas(512, 256);
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = decalColor;
    g.strokeStyle = decalColor;
    const r = mulberry32(5);
    switch (decal) {
      case 'stripes':
        g.fillRect(0, 150, 512, 22);
        g.fillRect(0, 182, 512, 10);
        break;
      case 'bolt':
        g.beginPath();
        g.moveTo(140, 20); g.lineTo(260, 20); g.lineTo(210, 110); g.lineTo(300, 110);
        g.lineTo(150, 240); g.lineTo(190, 135); g.lineTo(110, 135);
        g.closePath();
        g.fill();
        break;
      case 'chevron':
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(60 + i * 90, 40); g.lineTo(110 + i * 90, 128); g.lineTo(60 + i * 90, 216);
          g.lineTo(90 + i * 90, 216); g.lineTo(140 + i * 90, 128); g.lineTo(90 + i * 90, 40);
          g.closePath();
          g.fill();
        }
        break;
      case 'camo':
        for (let i = 0; i < 140; i++) {
          g.globalAlpha = 0.55 + r() * 0.4;
          g.fillStyle = i % 3 === 0 ? decalColor : i % 3 === 1 ? accent : '#1b1d22';
          const s = 12 + Math.floor(r() * 3) * 12;
          g.fillRect(Math.floor(r() * 42) * 12, Math.floor(r() * 21) * 12, s, s);
        }
        g.globalAlpha = 1;
        break;
      case 'circuit':
        g.lineWidth = 5;
        for (let i = 0; i < 16; i++) {
          let x = r() * 512, y = r() * 256;
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            if (k % 2) x += (r() - 0.5) * 160; else y += (r() - 0.5) * 100;
            g.lineTo(x, y);
          }
          g.stroke();
          g.beginPath();
          g.arc(x, y, 7, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'split':
        g.beginPath();
        g.moveTo(0, 256); g.lineTo(512, 90); g.lineTo(512, 256);
        g.closePath();
        g.fill();
        g.fillStyle = accent;
        g.beginPath();
        g.moveTo(0, 240); g.lineTo(512, 74); g.lineTo(512, 90); g.lineTo(0, 256);
        g.closePath();
        g.fill();
        break;
      case 'checker':
        for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2 === 0) g.fillRect(x * 32, 160 + y * 24, 32, 24);
        break;
      case 'waves':
        g.lineWidth = 12;
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          for (let x = 0; x <= 512; x += 8) {
            const y = 120 + k * 30 + Math.sin(x / 50 + k) * 18;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.globalAlpha = 1 - k * 0.2;
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      default:
        break;
    }
    // Number roundel
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.ellipse(390, 92, 80, 62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 82px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(number, 390, 96);
    // wordmark
    g.fillStyle = accent;
    g.font = 'italic 900 34px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('STARK VARG', 40, 60);
    return tex(c);
  });
}

/** Text sign texture (world labels). */
export function signTexture(text: string, fg = '#ffffff', bg = 'rgba(15,18,24,0.85)'): CanvasTexture {
  return cached(`sign-${text}-${fg}-${bg}`, () => {
    const { c, g } = canvas(512, 128);
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(0, 0, 512, 128, 20);
    g.fill();
    g.fillStyle = fg;
    g.font = '800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68, 480);
    return tex(c);
  });
}

/** Soft round particle sprite. */
export function puffTexture(): CanvasTexture {
  return cached('puff', () => {
    const { c, g } = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return tex(c, false, false);
  });
}

/** Garage floor tiles. */
export function floorTexture(): CanvasTexture {
  return cached('floor', () => {
    const { c, g } = canvas(256, 256);
    g.fillStyle = '#3b4048';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#2b2f36';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
    }
    return tex(c, true);
  });
}

export type FacadeStyle = 'brick' | 'office' | 'apartment' | 'stucco' | 'shop';

/**
 * Building façade set for one style: colour map, night emissive mask and an ORM map
 * (G = roughness, B = metalness) so glass is glossy and reflects the sky while walls stay
 * matte. One texture tile = one window bay × one floor. The top-left corner is always plain
 * wall: roofs sample it.
 */
export function facadeSet(style: FacadeStyle): { map: CanvasTexture; emissive: CanvasTexture; orm: CanvasTexture; normal: CanvasTexture } {
  return cached(`facade-${style}`, () => {
    const S = 256;
    const col = canvas(S, S), em = canvas(S, S), orm = canvas(S, S), hgt = canvas(S, S);
    const g = col.g, e = em.g, o = orm.g;
    // Relief (0..255): drawn alongside the colour, turned into a normal map at the end, so
    // panes sit back in their openings and frames, sills and bricks stand proud.
    const H = (x: number, y: number, w: number, h: number, v: number) => {
      hgt.g.fillStyle = `rgb(${v},${v},${v})`;
      hgt.g.fillRect(x, y, w, h);
    };
    H(0, 0, S, S, style === 'brick' ? 112 : 128);
    const r = mulberry32(style.length * 97 + 13);
    e.fillStyle = '#000';
    e.fillRect(0, 0, S, S);
    o.fillStyle = 'rgb(0,235,0)';
    o.fillRect(0, 0, S, S);
    const panes: [number, number, number, number][] = [];
    const glass = (x: number, y: number, w: number, h: number, warm = false) => {
      panes.push([x, y, w, h]);
      const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      gr.addColorStop(0, warm ? '#6d5a44' : '#7d97ad');
      gr.addColorStop(0.5, warm ? '#3e3226' : '#3a4d5e');
      gr.addColorStop(1, warm ? '#2b231b' : '#26323d');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
      // Sky reflection streak.
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.beginPath();
      g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x - w * 0.15 + 1, y + h);
      g.closePath();
      g.fill();
      o.fillStyle = 'rgb(0,30,170)';
      o.fillRect(x, y, w, h);
      H(x, y, w, h, 60);
    };
    const frame = (x: number, y: number, w: number, h: number, c: string, t: number) => {
      g.fillStyle = c;
      g.fillRect(x - t, y - t, w + 2 * t, t);
      g.fillRect(x - t, y + h, w + 2 * t, t);
      g.fillRect(x - t, y, t, h);
      g.fillRect(x + w, y, t, h);
      for (const [a, b, c2, d] of [[x - t, y - t, w + 2 * t, t], [x - t, y + h, w + 2 * t, t], [x - t, y, t, h], [x + w, y, t, h]]) H(a, b, c2, d, 185);
    };
    if (style === 'brick') {
      g.fillStyle = '#9a5b45';
      g.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y += 8) {
        const off = (y / 8) % 2 ? 0 : 12;
        for (let x = -24; x < S; x += 24) {
          const v = 0.85 + r() * 0.3;
          g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(84 * v)},${Math.round(62 * v)})`;
          g.fillRect(x + off + 1, y + 1, 22, 6);
          H(x + off + 1, y + 1, 22, 6, 128 + Math.round(r() * 14));
        }
      }
      glass(78, 56, 100, 130);
      frame(78, 56, 100, 130, '#ece6da', 7);
      g.fillStyle = '#ece6da';
      g.fillRect(126, 56, 4, 130);
      g.fillRect(78, 118, 100, 4);
      H(126, 56, 4, 130, 150); H(78, 118, 100, 4, 150);
      g.fillStyle = '#c9c1b2';
      g.fillRect(66, 196, 124, 10); // sill
      g.fillRect(70, 34, 116, 12); // lintel
      H(66, 196, 124, 10, 220); H(70, 34, 116, 12, 205);
    } else if (style === 'office') {
      g.fillStyle = '#c9ced4';
      g.fillRect(0, 0, S, S);
      glass(6, 6, S - 12, S - 66);
      g.fillStyle = '#2b3138';
      g.fillRect(6, S - 56, S - 12, 50); // spandrel
      H(6, S - 56, S - 12, 50, 110);
      o.fillStyle = 'rgb(0,60,120)';
      o.fillRect(6, S - 56, S - 12, 50);
      g.fillStyle = '#c9ced4';
      g.fillRect(126, 0, 4, S);
      H(126, 0, 4, S, 190); H(0, 0, 6, S, 190); H(S - 6, 0, 6, S, 190); // mullions
    } else if (style === 'apartment') {
      g.fillStyle = '#f2f0ea';
      g.fillRect(0, 0, S, S);
      glass(40, 40, 176, 120);
      frame(40, 40, 176, 120, '#ffffff', 5);
      g.fillStyle = '#ffffff';
      g.fillRect(126, 40, 4, 120);
      // Balcony slab + rail.
      g.fillStyle = '#d8d4cc';
      g.fillRect(20, 214, 216, 14);
      g.fillStyle = '#4a4f57';
      g.fillRect(20, 172, 216, 4);
      for (let x = 24; x < 236; x += 12) g.fillRect(x, 172, 3, 42);
      H(20, 214, 216, 14, 235); H(20, 172, 216, 4, 215);
      for (let x = 24; x < 236; x += 12) H(x, 172, 3, 42, 205);
    } else if (style === 'stucco') {
      g.fillStyle = '#f4efe6';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.04})`;
        g.fillRect(r() * S, r() * S, 3, 3);
      }
      glass(96, 40, 64, 160);
      frame(96, 40, 64, 160, '#ffffff', 5);
      g.fillStyle = '#2f5d4a'; // shutters
      g.fillRect(58, 36, 32, 168);
      g.fillRect(166, 36, 32, 168);
      H(58, 36, 32, 168, 170); H(166, 36, 32, 168, 170);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 44; y < 200; y += 10) { g.fillRect(60, y, 28, 2); g.fillRect(168, y, 28, 2); H(60, y, 28, 2, 145); H(168, y, 28, 2, 145); }
      g.fillStyle = '#e1d8c8';
      g.fillRect(88, 206, 80, 10);
      H(88, 206, 80, 10, 215);
    } else {
      // Shopfront: sign band, big display window with a lit interior, door on the right.
      g.fillStyle = '#3a3d44';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#23262b';
      g.fillRect(0, 0, S, 46);
      g.fillStyle = '#d9d4c7';
      for (let i = 0; i < 5; i++) g.fillRect(24 + i * 22 + r() * 6, 16, 14, 14); // sign lettering blocks
      glass(10, 60, 170, 170, true);
      g.fillStyle = 'rgba(255,220,170,0.35)';
      g.fillRect(10, 200, 170, 30); // interior counter glow
      frame(10, 60, 170, 170, '#1b1d21', 5);
      glass(198, 80, 48, 160, true);
      frame(198, 80, 48, 160, '#1b1d21', 4);
      g.fillStyle = '#9a9ea6';
      g.fillRect(0, 240, S, 16); // kick plate
      H(0, 0, S, 46, 165); H(0, 240, S, 16, 150);
    }
    // Plain wall corner for roofs (top-left 10 px).
    if (style !== 'office') {
      g.fillStyle = style === 'brick' ? '#8a5644' : style === 'shop' ? '#3a3d44' : '#ece8e0';
      g.fillRect(0, 0, 10, 10);
    }
    // Night windows: the emissive map spans 4×4 window bays (repeat ¼), each pane lit at random,
    // so neighbouring windows differ instead of every bay sharing one lit/unlit state.
    em.c.width = em.c.height = S * 2;
    e.fillStyle = '#000';
    e.fillRect(0, 0, S * 2, S * 2);
    const sc = 0.5;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      panes.forEach(([x, y, w, h2], k) => {
        const lit = style === 'shop' ? k === 0 || r() < 0.5 : r() < (style === 'office' ? 0.45 : 0.38);
        if (!lit) return;
        e.fillStyle = r() < 0.5 ? '#ffd890' : r() < 0.5 ? '#ffe9c2' : '#cfe4ff';
        e.fillRect((tx * S + x) * sc, (ty * S + y) * sc, w * sc, h2 * sc);
      });
    }
    const t = tex(col.c, true);
    const te = tex(em.c, true);
    te.repeat.set(0.25, 0.25);
    const to = tex(orm.c, true, false);
    // Plain-wall corner stays flat (roofs sample it).
    H(0, 0, 10, 10, style === 'brick' ? 112 : 128);
    const tn = tex(normalFromHeight(hgt, S, 2.2), true, false);
    t.anisotropy = te.anisotropy = to.anisotropy = tn.anisotropy = 8;
    return { map: t, emissive: te, orm: to, normal: tn } as unknown as Texture;
  }) as unknown as { map: CanvasTexture; emissive: CanvasTexture; orm: CanvasTexture; normal: CanvasTexture };
}

/** Tangent-space normal map from a grey height canvas (tiling: samples wrap at the edges). */
function normalFromHeight(h: { g: CanvasRenderingContext2D }, S: number, strength: number) {
  const src = h.g.getImageData(0, 0, S, S).data;
  const out = canvas(S, S);
  const img = out.g.createImageData(S, S);
  const at = (x: number, y: number) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // Canvas y runs down the texture; texture-space +v runs up.
    const nx = -(at(x + 1, y) - at(x - 1, y)) * strength, ny = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(nx, ny, 1);
    const k = (y * S + x) * 4;
    img.data[k] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
    img.data[k + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
    img.data[k + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    img.data[k + 3] = 255;
  }
  out.g.putImageData(img, 0, 0);
  return out.c;
}

/** Corrugated sheet metal (warehouses, shipping containers); grey-scale, tinted by vertex colour. */
export function corrugatedTexture(): CanvasTexture {
  return cached('corrugated', () => {
    const { c, g } = canvas(128, 128);
    for (let x = 0; x < 128; x++) {
      const v = 0.72 + 0.28 * Math.sin((x / 16) * Math.PI * 2);
      g.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(255 * v)},${Math.round(255 * v)})`;
      g.fillRect(x, 0, 1, 128);
    }
    const r = mulberry32(21);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(80,60,40,${r() * 0.08})`;
      g.fillRect(r() * 128, r() * 128, 2 + r() * 10, 2 + r() * 30);
    }
    return tex(c, true);
  });
}

/** Showroom interior seen through the garage glass: lit ceiling, display bikes, banners. */
export function showroomTexture(): CanvasTexture {
  return cached('showroom', () => {
    const { c, g } = canvas(1024, 256);
    const wall = g.createLinearGradient(0, 0, 0, 256);
    wall.addColorStop(0, '#2b3038');
    wall.addColorStop(0.55, '#c9ccd1');
    wall.addColorStop(0.62, '#8e939a');
    wall.addColorStop(1, '#d8dadd');
    g.fillStyle = wall;
    g.fillRect(0, 0, 1024, 256);
    // Ceiling light rows.
    g.fillStyle = 'rgba(255,248,232,0.95)';
    for (let x = 40; x < 1024; x += 120) g.fillRect(x, 14, 70, 7);
    // Banners.
    for (const [x, col] of [[150, '#c6f432'], [512, '#ff6b1a'], [870, '#00c2ff']] as const) {
      g.fillStyle = '#16191e';
      g.fillRect(x - 60, 40, 120, 70);
      g.fillStyle = col;
      g.fillRect(x - 60, 104, 120, 6);
      g.fillStyle = '#ffffff';
      g.font = '800 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      g.textAlign = 'center';
      g.fillText('STARK', x, 70);
      g.fillText('VARG', x, 95);
    }
    // Display bikes (side silhouettes) on the floor.
    const bike = (x: number, col: string) => {
      g.strokeStyle = '#111317';
      g.lineWidth = 7;
      for (const wx of [x - 46, x + 46]) {
        g.beginPath();
        g.arc(wx, 214, 24, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(x - 50, 182);
      g.lineTo(x + 10, 170);
      g.lineTo(x + 40, 178);
      g.lineTo(x + 20, 200);
      g.lineTo(x - 30, 200);
      g.closePath();
      g.fill();
      g.fillStyle = '#1b1d22';
      g.fillRect(x - 40, 168, 46, 7);
      g.strokeStyle = '#9aa0a8';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + 46, 214);
      g.lineTo(x + 30, 160);
      g.stroke();
    };
    bike(300, '#e8e8ea');
    bike(700, '#c6f432');
    return tex(c);
  });
}
