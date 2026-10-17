/**
 * Lightweight post-processing for the ride view, tuned for phones:
 *
 *  - Scene rendered once into a multisampled HDR target (anti-aliased, linear light).
 *  - Bloom: bright areas are downsampled through three small mip levels and added back,
 *    so the sun on chrome, headlights and night windows glow softly.
 *  - Speed blur: a radial blur from the screen centre that only appears at high speed
 *    (it costs nothing below ~70 km/h).
 *  - Final grade: ACES tone mapping (same curve as before), a touch more contrast and
 *    saturation with warm highlights / cool shadows, vignette and dithering.
 *
 * About five full-screen-equivalent texture reads per pixel at full resolution; the bloom
 * levels are 1/2, 1/4 and 1/8 size.
 */
import {
  AddEquation, CustomBlending, HalfFloatType, LinearFilter, NoBlending, OneFactor, ShaderMaterial, Vector2, WebGLRenderTarget,
} from 'three';
import type { Camera, Scene, Texture, WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Box-filtered 2× downsample (4 bilinear taps = 16 texels); optional soft threshold. */
const DOWN = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    if (threshold > 0.0) {
      float l = max(c.r, max(c.g, c.b));
      float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      c *= max(soft, l - threshold) / max(l, 1e-4);
      c = min(c, vec3(24.0));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

/** 9-tap tent upsample, blended additively into the next larger level. */
const UP = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 texel; uniform float weight;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
    c += (texture2D(tSrc, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(texel.x, 0.0)).rgb
        + texture2D(tSrc, vUv + vec2(0.0, texel.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, texel.y)).rgb) * 2.0;
    c += texture2D(tSrc, vUv + texel).rgb + texture2D(tSrc, vUv - texel).rgb
       + texture2D(tSrc, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(tSrc, vUv + vec2(-texel.x, texel.y)).rgb;
    gl_FragColor = vec4(c / 16.0 * weight, 1.0);
  }`;

const FINAL = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float bloom; uniform float blur; uniform float vignette; uniform float time;
  uniform vec2 resolution; uniform float grade;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    // Radial speed blur, strongest toward the edges, nothing at the centre (the bike stays sharp).
    if (blur > 0.001) {
      vec2 d = vUv - vec2(0.5, 0.56);
      float r = length(d);
      vec2 stepv = d * blur * smoothstep(0.12, 0.6, r) * 0.06;
      float j = hash(gl_FragCoord.xy + time) - 0.5;
      vec3 acc = c;
      for (int i = 1; i < 7; i++) acc += texture2D(tScene, vUv - stepv * (float(i) + j)).rgb;
      c = acc / 7.0;
    }
    c += texture2D(tBloom, vUv).rgb * bloom;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Grade (display space): gentle S-curve, a little more saturation, warm highs, cool lows.
    vec3 g = gl_FragColor.rgb;
    float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    vec3 graded = mix(vec3(l), g, 1.12);
    graded = graded + (graded - 0.5) * 0.07 * (1.0 - abs(graded - 0.5) * 2.0);
    graded *= mix(vec3(0.99, 0.995, 1.015), vec3(1.025, 1.0, 0.97), smoothstep(0.2, 0.8, l));
    g = mix(g, graded, grade);
    // Vignette and dithering (kills banding in the sky gradient).
    vec2 v = vUv - 0.5;
    g *= 1.0 - vignette * smoothstep(0.35, 0.95, length(v * vec2(1.0, 1.2)));
    g += (hash(gl_FragCoord.xy + fract(time)) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
  }`;

export class PostFX {
  private scene: WebGLRenderTarget;
  private levels: WebGLRenderTarget[] = [];
  private quad = new FullScreenQuad();
  private down: ShaderMaterial;
  private up: ShaderMaterial;
  private final: ShaderMaterial;
  private size = new Vector2(1, 1);
  /** 0..1 speed blur amount (set by the game from speed). */
  blur = 0;
  bloomStrength = 0.55;
  enabled = true;
  /** Draw calls / triangles of the last scene pass (diagnostics; the final pass resets renderer.info). */
  sceneCalls = 0;
  sceneTris = 0;

  constructor(samples: number) {
    this.scene = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples, depthBuffer: true });
    for (let i = 0; i < 3; i++) {
      this.levels.push(new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }));
    }
    this.down = new ShaderMaterial({
      uniforms: { tSrc: { value: null }, texel: { value: new Vector2() }, threshold: { value: 0 }, knee: { value: 0.5 } },
      vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false, blending: NoBlending,
    });
    this.up = new ShaderMaterial({
      uniforms: { tSrc: { value: null }, texel: { value: new Vector2() }, weight: { value: 1 } },
      vertexShader: VERT, fragmentShader: UP, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor,
    });
    this.final = new ShaderMaterial({
      uniforms: {
        tScene: { value: this.scene.texture }, tBloom: { value: this.levels[0].texture }, bloom: { value: 0.55 }, blur: { value: 0 },
        vignette: { value: 0.32 }, time: { value: 0 }, resolution: { value: new Vector2() }, grade: { value: 1 },
      },
      vertexShader: VERT, fragmentShader: FINAL, depthTest: false, depthWrite: false, toneMapped: true,
    });
  }

  setSize(w: number, h: number) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.size.x && h === this.size.y) return;
    this.size.set(w, h);
    this.scene.setSize(w, h);
    for (let i = 0; i < this.levels.length; i++) this.levels[i].setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)));
    this.final.uniforms.resolution.value.set(w, h);
  }

  private pass(mat: ShaderMaterial, src: Texture, target: WebGLRenderTarget | null, renderer: WebGLRenderer) {
    mat.uniforms.tSrc.value = src;
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, time: number) {
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);
    this.sceneCalls = renderer.info.render.calls;
    this.sceneTris = renderer.info.render.triangles;
    // Bloom chain: threshold + downsample ×3, then tent-upsample back up, adding each level.
    const L = this.levels;
    const autoClear = renderer.autoClear;
    let src: Texture = this.scene.texture;
    let w = this.size.x, h = this.size.y;
    for (let i = 0; i < L.length; i++) {
      this.down.uniforms.texel.value.set(1 / w, 1 / h);
      this.down.uniforms.threshold.value = i === 0 ? 1.35 : 0;
      this.pass(this.down, src, L[i], renderer);
      src = L[i].texture;
      w = L[i].width;
      h = L[i].height;
    }
    renderer.autoClear = false;
    for (let i = L.length - 1; i > 0; i--) {
      this.up.uniforms.texel.value.set(1 / L[i].width, 1 / L[i].height);
      this.up.uniforms.weight.value = 0.8;
      this.pass(this.up, L[i].texture, L[i - 1], renderer);
    }
    renderer.autoClear = autoClear;
    const u = this.final.uniforms;
    u.bloom.value = this.bloomStrength;
    u.blur.value = this.blur;
    u.time.value = time % 1000;
    this.quad.material = this.final;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose() {
    this.scene.dispose();
    for (const l of this.levels) l.dispose();
    this.down.dispose();
    this.up.dispose();
    this.final.dispose();
    this.quad.dispose();
  }
}
