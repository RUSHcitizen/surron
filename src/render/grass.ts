/**
 * Grass tufts around the camera, entirely on the GPU.
 *
 * A fixed set of instances tiles a square around the camera (positions wrap toroidally, so
 * tufts stay put in the world as you ride). The vertex shader reads terrain height and the
 * grass weight from a float texture of the heightfield, so tufts only grow on grass and sit
 * exactly on the ground. Blades sway in the wind. One draw call, no per-frame CPU work.
 */
import {
  Color, DataTexture, FloatType, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NearestFilter, RGBAFormat,
  ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3, BufferAttribute,
} from 'three';
import type { Heightfield } from '../world/collision';
import { SURFACE_INDEX } from '../world/collision';
import { mulberry32 } from '../core/noise';

export class Grass {
  mesh: Mesh;
  private mat: ShaderMaterial;
  private tex: DataTexture;

  constructor(hf: Heightfield, count: number, radius = 26) {
    const n = hf.n;
    const data = new Float32Array(n * n * 4);
    const grassId = SURFACE_INDEX.indexOf('grass');
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = hf.heights[i];
      data[i * 4 + 1] = hf.surfaces[i] === grassId ? 1 : 0;
    }
    this.tex = new DataTexture(data, n, n, RGBAFormat, FloatType);
    this.tex.minFilter = this.tex.magFilter = NearestFilter;
    this.tex.needsUpdate = true;

    // One tuft = 3 tapered blades (crossed), 1 triangle each, plus 2 short side blades.
    const blades: number[] = [];
    const tips: number[] = [];
    const B = 5;
    for (let b = 0; b < B; b++) {
      const a = (b / B) * Math.PI + (b % 2) * 0.3;
      const w = 0.085, h = b < 3 ? 1 : 0.7;
      const ox = Math.cos(a) * w, oz = Math.sin(a) * w;
      const lean = (b - 2) * 0.06;
      blades.push(-ox, 0, -oz, ox, 0, oz, lean * Math.sin(a), h, lean * Math.cos(a));
      tips.push(0, 0, 1);
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(blades), 3));
    g.setAttribute('tip', new BufferAttribute(new Float32Array(tips), 1));
    const r = mulberry32(77);
    const offs = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      offs[i * 4] = (r() * 2 - 1) * radius;
      offs[i * 4 + 1] = (r() * 2 - 1) * radius;
      offs[i * 4 + 2] = 0.55 + r() * 0.6; // size
      offs[i * 4 + 3] = r() * Math.PI * 2; // rotation
    }
    g.setAttribute('offset', new InstancedBufferAttribute(offs, 4));
    g.instanceCount = count;

    this.mat = new ShaderMaterial({
      fog: true,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          heights: { value: this.tex },
          hfOrigin: { value: new Vector2(hf.x0, hf.z0) },
          hfCell: { value: hf.cell },
          hfN: { value: n },
          center: { value: new Vector3() },
          radius: { value: radius },
          time: { value: 0 },
          baseColor: { value: new Color(0x243d14) },
          tipColor: { value: new Color(0x6f8f3a) },
          light: { value: new Color(1, 1, 1) },
          ambient: { value: new Color(0.45, 0.5, 0.55) },
        },
      ]),
      vertexShader: /* glsl */ `
        precision highp sampler2D;
        attribute vec4 offset;
        attribute float tip;
        uniform sampler2D heights;
        uniform vec2 hfOrigin; uniform float hfCell; uniform float hfN;
        uniform vec3 center; uniform float radius; uniform float time;
        varying float vTip; varying float vShade;
        #include <fog_pars_vertex>
        vec2 hfAt(vec2 xz) {
          vec2 g = (xz - hfOrigin) / hfCell;
          vec2 i = clamp(floor(g), vec2(0.0), vec2(hfN - 2.0));
          vec2 f = clamp(g - i, 0.0, 1.0);
          ivec2 ii = ivec2(i);
          vec2 a = texelFetch(heights, ii, 0).rg, b = texelFetch(heights, ii + ivec2(1, 0), 0).rg;
          vec2 c = texelFetch(heights, ii + ivec2(0, 1), 0).rg, d = texelFetch(heights, ii + ivec2(1, 1), 0).rg;
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main() {
          // Wrap the instance offset around the camera so tufts are fixed in the world.
          vec2 rel = mod(offset.xy - center.xz + radius, 2.0 * radius) - radius;
          vec2 world = center.xz + rel;
          vec2 hg = hfAt(world);
          float d = length(rel);
          float s = offset.z * hg.y * (1.0 - smoothstep(radius * 0.55, radius * 0.95, d));
          float c = cos(offset.w), sn = sin(offset.w);
          vec3 p = vec3(position.x * c - position.z * sn, position.y, position.x * sn + position.z * c) * vec3(1.0, 0.36, 1.0) * s;
          // Wind: gusts travel across the field; only blade tips move.
          float wind = sin(time * 1.7 + world.x * 0.35 + world.y * 0.2) * 0.5 + sin(time * 3.1 + world.x * 0.9) * 0.2;
          p.xz += tip * vec2(wind * 0.09, wind * 0.05) * s;
          vec4 mvPosition = modelViewMatrix * vec4(world.x + p.x, hg.x + p.y - 0.02, world.y + p.z, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vTip = tip;
          vShade = 0.85 + fract(sin(offset.w * 91.7) * 4375.5) * 0.3;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 baseColor; uniform vec3 tipColor; uniform vec3 light; uniform vec3 ambient;
        varying float vTip; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          vec3 c = mix(baseColor, tipColor, vTip) * vShade;
          gl_FragColor = vec4(c * (ambient + light * (0.35 + 0.65 * vTip)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mat.side = 2; // DoubleSide
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  update(cam: Vector3, time: number) {
    this.mat.uniforms.center.value.copy(cam);
    this.mat.uniforms.time.value = time;
  }

  setLighting(sun: Color, sunIntensity: number, ambient: Color, ambientIntensity: number) {
    this.mat.uniforms.light.value.copy(sun).multiplyScalar(sunIntensity * 0.32);
    this.mat.uniforms.ambient.value.copy(ambient).multiplyScalar(ambientIntensity * 0.55 + 0.12);
  }

  setCount(n: number) {
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = n;
    this.mesh.visible = n > 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
