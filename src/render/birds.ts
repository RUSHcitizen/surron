/**
 * A few small flocks of birds wheeling over the map. Wings flap in the vertex shader
 * (per-instance phase from gl_InstanceID); the CPU only moves each bird along its loop.
 * One draw call for every bird.
 */
import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { mulberry32 } from '../core/noise';

interface Flock { cx: number; cz: number; r: number; y: number; speed: number; phase: number; dir: number }

export class Birds {
  mesh: InstancedMesh;
  private flocks: Flock[] = [];
  private offsets: Vector3[] = [];
  private flockOf: number[] = [];
  private time = { value: 0 };
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);

  constructor(count = 36) {
    // Body + two wings: a shallow V, wingtips at |x| = 0.55.
    const v = new Float32Array([
      0, 0, 0.18, -0.55, 0.02, -0.05, 0, 0, -0.12,
      0, 0, 0.18, 0, 0, -0.12, 0.55, 0.02, -0.05,
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(v, 3));
    g.computeVertexNormals();
    const mat = new MeshBasicMaterial({ color: new Color(0x23262b), side: 2 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.time = this.time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float time;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 1.7;
          float flap = sin(time * 9.0 + ph) * 0.8 + 0.25;
          transformed.y += abs(position.x) * flap * 0.7;`);
    };
    this.mesh = new InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false;
    const r = mulberry32(99);
    const centers: [number, number][] = [[-160, 260], [180, 120], [40, -220], [-260, -40]];
    for (const [cx, cz] of centers) {
      this.flocks.push({ cx, cz, r: 50 + r() * 60, y: 38 + r() * 25, speed: 0.12 + r() * 0.08, phase: r() * 6, dir: r() < 0.5 ? 1 : -1 });
    }
    for (let i = 0; i < count; i++) {
      this.flockOf.push(i % this.flocks.length);
      this.offsets.push(new Vector3((r() - 0.5) * 14, (r() - 0.5) * 5, (r() - 0.5) * 14));
    }
  }

  update(time: number) {
    this.time.value = time;
    for (let i = 0; i < this.offsets.length; i++) {
      const f = this.flocks[this.flockOf[i]];
      const o = this.offsets[i];
      const a = f.phase + time * f.speed * f.dir + o.x * 0.004;
      const x = f.cx + Math.cos(a) * (f.r + o.z), z = f.cz + Math.sin(a) * (f.r + o.z);
      // Heading along the circle tangent, with a gentle bank.
      const yaw = Math.atan2(-Math.sin(a) * f.dir, Math.cos(a) * f.dir);
      this.q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      this.p.set(x + o.x * 0.3, f.y + o.y + Math.sin(time * 0.7 + i) * 1.5, z);
      this.m4.compose(this.p, this.q, this.s.setScalar(1.4));
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
