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
function cached<T extends Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) cache.set(key, (t = make()));
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
    // brand-neutral wordmark
    g.fillStyle = accent;
    g.font = 'italic 900 34px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('VOLTLINE', 40, 60);
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
