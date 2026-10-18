using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Procedural art for the Stark Varg-style bike and its rider, built from sculpted SDF
    /// meshes (one continuous moulded surface per part, like injection-moulded plastic or a body
    /// in riding gear), swept profiles and tubes — no primitive cubes or capsules.
    ///
    /// Model space: origin on the ground under the middle of the wheelbase, +Z forward, +Y up,
    /// +X to the rider's right. Wheelbase 1.48 m; rear axle (0, 0.35, -0.74).
    /// </summary>
    public static class BikeArt
    {
        // Key points of the bike (model space).
        public static readonly Vector3 Battery = new Vector3(0, 0.74f, 0.02f), BatterySize = new Vector3(0.19f, 0.33f, 0.42f);
        public static readonly Vector3 Head = new Vector3(0, 1.0f, 0.39f), HeadTop = new Vector3(0, 1.18f, 0.30f);
        public static readonly Vector3 SwingPivot = new Vector3(0, 0.55f, -0.16f), RearAxle = new Vector3(0, 0.35f, -0.74f);
        public static readonly Vector3 Motor = new Vector3(0, 0.47f, -0.03f);
        public const float SeatY = 0.92f, SeatZ = -0.26f, SeatLength = 0.66f, Tail = 0.44f;
        public static readonly Vector3 Peg = new Vector3(0.2f, 0.47f, -0.12f);

        static readonly Dictionary<string, Mesh> meshes = new Dictionary<string, Mesh>();
        static Mesh Cached(string key, System.Func<Mesh> make)
        {
            if (!meshes.TryGetValue(key, out var m) || m == null) meshes[key] = m = make();
            return m;
        }

        // =====================================================================================
        // Bike
        // =====================================================================================

        /// <summary>
        /// Moulded bodywork as ONE smooth surface: tank cover, shrouds sweeping up to the steering
        /// head, saddle running onto the tank, side panels and an upswept tail. Sub-mesh 0 =
        /// plastic, 1 = saddle.
        /// </summary>
        public static Mesh BodyShell() => Cached("shell", () =>
        {
            Vector3 bat = Battery, bs = BatterySize, head = Head;
            float z0 = bat.z - bs.z / 2f;
            float seatFront = SeatZ + SeatLength / 2f, seatEnd = SeatZ - SeatLength / 2f, sy = SeatY;
            float halfW = Mathf.Max(bs.x / 2f + 0.03f, 0.115f);
            float tailEnd = seatEnd - Tail;
            Sdf.Field tank = (x, y, z) =>
            {
                float t = Mathf.Clamp01((z - seatFront) / (head.z - seatFront));
                float cy = sy + t * (head.y + 0.02f - sy);
                float w = halfW * (0.82f - 0.25f * t);
                return Sdf.RoundBox(x, y - cy, z - (seatFront + head.z) / 2f + 0.03f, w, 0.05f, (head.z - seatFront) / 2f + 0.03f, 0.045f);
            };
            Sdf.Field shroud = (x, y, z) =>
            {
                float sx = (Mathf.Abs(x) - (halfW - 0.035f)) * 2.2f;
                return Sdf.RoundCone(sx, y, z, new Vector3(0, bat.y + 0.02f, z0 + 0.07f), new Vector3(0, head.y - 0.015f, head.z - 0.02f), 0.1f, 0.06f) * 0.6f;
            };
            Sdf.Field side = (x, y, z) => Sdf.Ellipsoid(x, y - (sy - 0.095f), z - (seatEnd + 0.22f), halfW * 0.95f, 0.1f, 0.28f);
            Sdf.Field tail = (x, y, z) =>
                Sdf.RoundCone(x * 1.15f, (y - sy) * 1.7f, z, new Vector3(0, -0.05f * 1.7f, seatEnd + 0.14f), new Vector3(0, 0.045f * 1.7f, tailEnd), 0.075f, 0.026f) / 1.7f;
            Sdf.Field saddle = (x, y, z) =>
            {
                float front = seatFront + 0.1f;
                float t = Mathf.Clamp01((z - seatEnd) / (front - seatEnd));
                float w = 0.1f - t * 0.045f;
                float top = sy + 0.045f + t * t * 0.03f;
                return Sdf.RoundBox(x, y - (top - 0.035f), z - (seatEnd + front) / 2f, w, 0.035f, (front - seatEnd) / 2f, 0.03f);
            };
            Sdf.Field plastic = (x, y, z) => Sdf.SMin(Sdf.SMin(Sdf.SMin(tank(x, y, z), shroud(x, y, z), 0.06f), side(x, y, z), 0.07f), tail(x, y, z), 0.06f);
            Sdf.Field all = (x, y, z) => Sdf.SMin(plastic(x, y, z), saddle(x, y, z), 0.012f);
            var min = new Vector3(-halfW - 0.08f, Mathf.Min(bat.y - 0.1f, sy - 0.26f), tailEnd - 0.06f);
            var max = new Vector3(halfW + 0.08f, Mathf.Max(head.y + 0.14f, sy + 0.16f), head.z + 0.12f);
            return Sdf.Build(all, min, max, 0.0095f, p => saddle(p.x, p.y, p.z) < plastic(p.x, p.y, p.z) ? 1 : 0, 2, 6f);
        });

        /// <summary>Cast battery case with horizontal cooling fins along its flanks.</summary>
        public static Mesh BatteryCase() => Cached("battery", () =>
        {
            Vector3 c = Battery, h = BatterySize * 0.5f;
            Sdf.Field f = (x, y, z) =>
            {
                float d = Sdf.RoundBox(x - c.x, y - c.y, z - c.z, h.x, h.y, h.z, 0.035f);
                for (int k = 0; k < 6; k++)
                {
                    float fy = c.y - h.y * 0.8f + k * h.y * 0.22f;
                    d = Mathf.Min(d, Sdf.RoundBox(x - c.x, y - fy, z - c.z + 0.01f, h.x + 0.008f, 0.006f, h.z * 0.8f, 0.004f));
                }
                return d;
            };
            return Sdf.Build(f, c - h - Vector3.one * 0.05f, c + h + Vector3.one * 0.05f, 0.008f);
        });

        /// <summary>Tapered cast-alloy swingarm (both arms + a brace), pivot to rear axle.</summary>
        public static Mesh Swingarm() => Cached("swingarm", () =>
        {
            Vector3 a = SwingPivot, b = RearAxle;
            Sdf.Field arm = (x, y, z) =>
            {
                float d = 1e9f;
                for (int s = -1; s <= 1; s += 2)
                {
                    float sx = (x - s * 0.085f) * 2.0f;
                    d = Mathf.Min(d, Sdf.RoundCone(sx, y, z, new Vector3(0, a.y, a.z), new Vector3(0, b.y, b.z), 0.055f, 0.03f) / 2.0f);
                }
                d = Sdf.SMin(d, Sdf.RoundBox(x, y - Mathf.Lerp(a.y, b.y, 0.2f), z - Mathf.Lerp(a.z, b.z, 0.2f), 0.09f, 0.02f, 0.03f, 0.012f), 0.03f);
                return d;
            };
            return Sdf.Build(arm, new Vector3(-0.16f, b.y - 0.1f, b.z - 0.1f), new Vector3(0.16f, a.y + 0.1f, a.z + 0.1f), 0.008f);
        });

        /// <summary>A helical coil spring of n turns around the segment a→b.</summary>
        public static Mesh Spring(Vector3 a, Vector3 b, float radius, float wire, int turns)
        {
            var axis = (b - a);
            var dir = axis.normalized;
            var u = Vector3.Cross(dir, Vector3.right).sqrMagnitude > 1e-4f ? Vector3.Cross(dir, Vector3.right).normalized : Vector3.Cross(dir, Vector3.forward).normalized;
            var w = Vector3.Cross(dir, u);
            var pts = new List<Vector3>();
            int n = turns * 12;
            for (int i = 0; i <= n; i++)
            {
                float t = i / (float)n, ang = t * turns * Mathf.PI * 2f;
                pts.Add(a + axis * t + (u * Mathf.Cos(ang) + w * Mathf.Sin(ang)) * radius);
            }
            return MeshGen.Tube(pts, wire, n * 2, 8);
        }

        /// <summary>
        /// A moulded MX front fender: a U-section shell swept around the wheel from behind the
        /// fork to a long beak in front. Built around the axle in wheel space (X axis = axle).
        /// </summary>
        public static Mesh FrontFender(float wheelR) => Cached("ffender" + wheelR, () =>
        {
            float r0 = wheelR + 0.05f;
            var path = new List<Vector3>();
            for (int i = 0; i <= 20; i++)
            {
                // From 30° behind the top to 85° in front (beak), rising slightly at the tip.
                float a = Mathf.Lerp(-30f, 85f, i / 20f) * Mathf.Deg2Rad;
                float r = r0 + (i > 14 ? (i - 14) * 0.008f : 0f);
                path.Add(new Vector3(0, Mathf.Cos(a) * r, Mathf.Sin(a) * r));
            }
            // Closed U-shaped profile (lateral, radial): outer skin out, inner skin back.
            const float W = 0.085f, D = 0.04f, T = 0.006f;
            var prof = new List<Vector2> {
                new Vector2(-W, -D), new Vector2(-W + 0.02f, -0.006f), new Vector2(0, 0), new Vector2(W - 0.02f, -0.006f), new Vector2(W, -D),
                new Vector2(W - T, -D), new Vector2(W - 0.02f, -0.006f - T), new Vector2(0, -T), new Vector2(-W + 0.02f, -0.006f - T), new Vector2(-W + T, -D),
            };
            return Sweep(prof, path, Vector3.zero);
        });

        /// <summary>
        /// Sweep a closed 2D profile (x = lateral, y = outward from <paramref name="centre"/>)
        /// along a path; triangles are turned so the shell faces outward.
        /// </summary>
        public static Mesh Sweep(List<Vector2> prof, List<Vector3> path, Vector3 centre)
        {
            var v = new List<Vector3>(); var t = new List<int>();
            int np = prof.Count;
            for (int i = 0; i < path.Count; i++)
            {
                var p = path[i];
                var outward = (p - centre); outward.x = 0; outward.Normalize();
                foreach (var q in prof) v.Add(p + Vector3.right * q.x + outward * q.y);
            }
            for (int i = 0; i < path.Count - 1; i++)
                for (int k = 0; k < np; k++)
                {
                    int a = i * np + k, b = i * np + (k + 1) % np, c = a + np, d = b + np;
                    t.Add(a); t.Add(c); t.Add(b); t.Add(b); t.Add(c); t.Add(d);
                }
            // End caps (fans).
            for (int e = 0; e < 2; e++)
            {
                int ring = e == 0 ? 0 : (path.Count - 1) * np;
                for (int k = 1; k < np - 1; k++) { t.Add(ring); t.Add(ring + k); t.Add(ring + k + 1); }
            }
            var m = new Mesh();
            m.SetVertices(v);
            m.SetTriangles(t, 0);
            OrientOutward(m);
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>Flip all triangles if the closed mesh's signed volume is negative.</summary>
        public static void OrientOutward(Mesh m)
        {
            var v = m.vertices; var t = m.triangles;
            double vol = 0;
            for (int i = 0; i < t.Length; i += 3) vol += Vector3.Dot(v[t[i]], Vector3.Cross(v[t[i + 1]], v[t[i + 2]]));
            // Unity's front face is the side Cross(b - a, c - a) points to; outward-facing closed
            // meshes have positive signed volume by that convention.
            if (vol < 0)
            {
                for (int i = 0; i < t.Length; i += 3) { int tmp = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = tmp; }
                m.triangles = t;
            }
        }

        /// <summary>Spoked wheel parts around the X axis: rim and 32 spokes (one mesh), and the hub.</summary>
        public static Mesh SpokesAndRim(float r) => Cached("spokes" + r, () =>
        {
            var parts = new List<CombineInstance>();
            var rim = MeshGen.Tyre(r - 0.062f, 0.03f, 0.022f, 64, 8);
            parts.Add(new CombineInstance { mesh = rim, transform = Matrix4x4.identity });
            float rIn = r - 0.075f;
            for (int i = 0; i < 32; i++)
            {
                float a = i / 32f * Mathf.PI * 2f, a2 = a + (i % 2 == 0 ? 0.35f : -0.35f);
                var hub = new Vector3(i % 2 == 0 ? 0.035f : -0.035f, Mathf.Sin(a2) * 0.045f, Mathf.Cos(a2) * 0.045f);
                var rimP = new Vector3(0, Mathf.Sin(a) * rIn, Mathf.Cos(a) * rIn);
                parts.Add(new CombineInstance { mesh = MeshGen.Tube(new[] { hub, rimP }, 0.0022f, 1, 5), transform = Matrix4x4.identity });
            }
            return MeshGen.Combine(parts);
        });

        // =====================================================================================
        // Rider
        // =====================================================================================

        // Rider joints (model space), in the attack position.
        public static readonly Vector3 Hip = new Vector3(0, 1.02f, -0.3f), Neck = new Vector3(0, 1.46f, -0.08f), HeadC = new Vector3(0, 1.63f, 0.0f);

        /// <summary>Two-bone IK: the middle joint for a limb from a to c with lengths l1, l2, bending toward <paramref name="hint"/>.</summary>
        public static Vector3 Ik(Vector3 a, Vector3 c, float l1, float l2, Vector3 hint)
        {
            var ac = c - a;
            float d = Mathf.Clamp(ac.magnitude, 0.01f, l1 + l2 - 0.001f);
            var dir = ac.normalized;
            float x = (l1 * l1 - l2 * l2 + d * d) / (2f * d);
            float h = Mathf.Sqrt(Mathf.Max(0, l1 * l1 - x * x));
            var perp = (hint - dir * Vector3.Dot(hint, dir)).normalized;
            return a + dir * x + perp * h;
        }

        /// <summary>
        /// Torso in riding gear: pelvis, abdomen, chest, shoulder caps and neck as one smooth
        /// body. Sub-meshes: 0 jersey, 1 pants, 2 collar / neck brace.
        /// </summary>
        public static Mesh Torso() => Cached("torso", () =>
        {
            Vector3 hip = Hip, neck = Neck;
            var t = (neck - hip).normalized;
            Vector3 sL = neck + new Vector3(-0.19f, -0.06f, -0.02f), sR = neck + new Vector3(0.19f, -0.06f, -0.02f);
            Sdf.Field pelvis = (x, y, z) => Sdf.Ellipsoid(x - hip.x, y - hip.y - 0.02f, z - hip.z, 0.17f, 0.13f, 0.14f);
            Vector3 ab = Vector3.Lerp(hip, neck, 0.42f), ch = Vector3.Lerp(hip, neck, 0.74f);
            Sdf.Field abdomen = (x, y, z) => Sdf.Ellipsoid(x - ab.x, y - ab.y, z - ab.z, 0.15f, 0.15f, 0.12f);
            Sdf.Field chest = (x, y, z) => Sdf.Ellipsoid(x - ch.x, y - ch.y, z - ch.z, 0.2f, 0.16f, 0.14f);
            Sdf.Field shoulders = (x, y, z) => Sdf.RoundCone(x, y, z, sL, sR, 0.07f, 0.07f);
            Sdf.Field neckF = (x, y, z) => Sdf.RoundCone(x, y, z, neck - t * 0.04f, HeadC + new Vector3(0, -0.06f, -0.02f), 0.058f, 0.05f);
            Sdf.Field brace = (x, y, z) =>
            {
                // A torus around the neck (the neck brace).
                float px = x - neck.x, py = y - neck.y + 0.01f, pz = z - neck.z;
                float hh = px * t.x + py * t.y + pz * t.z;
                float qx = px - t.x * hh, qy = py - t.y * hh, qz = pz - t.z * hh;
                float a = Mathf.Sqrt(qx * qx + qy * qy + qz * qz) - 0.09f;
                return Mathf.Sqrt(a * a + hh * hh) - 0.028f;
            };
            Sdf.Field body = (x, y, z) => Sdf.SMin(Sdf.SMin(Sdf.SMin(Sdf.SMin(pelvis(x, y, z), abdomen(x, y, z), 0.08f), chest(x, y, z), 0.08f), shoulders(x, y, z), 0.06f), neckF(x, y, z), 0.03f);
            Sdf.Field all = (x, y, z) =>
            {
                float d = body(x, y, z);
                // Loose fabric: a faint crumple on the surface.
                d += (Mathf.Sin(x * 55f + Mathf.Sin(y * 23f) * 2f) * Mathf.Sin(z * 47f + y * 21f)) * 0.0025f;
                return Mathf.Min(d, brace(x, y, z));
            };
            float belt = hip.y + 0.09f;
            return Sdf.Build(all, new Vector3(-0.32f, hip.y - 0.2f, hip.z - 0.25f), new Vector3(0.32f, HeadC.y, neck.z + 0.25f), 0.011f,
                p => brace(p.x, p.y, p.z) < 0.004f || p.y > neck.y + 0.02f ? 2 : p.y < belt + (p.z - hip.z) * 0.15f ? 1 : 0, 3, 8f);
        });

        /// <summary>
        /// MX helmet around its own centre (z forward): shell, extended chin bar, eye port with
        /// goggles, and a peak. Sub-meshes: 0 shell, 1 accent (peak, chin stripe), 2 goggle lens, 3 strap/trim.
        /// </summary>
        public static Mesh Helmet() => Cached("helmet", () =>
        {
            float pp = -0.24f, cp = Mathf.Cos(pp), sp = Mathf.Sin(pp);
            Sdf.Field shell = (x, y, z) => Sdf.Ellipsoid(x, y - 0.015f, z + 0.01f, 0.133f, 0.142f, 0.158f);
            Sdf.Field chin = (x, y, z) => Sdf.RoundCone(x, y, z, new Vector3(0, -0.065f, 0.055f), new Vector3(0, -0.108f, 0.152f), 0.086f, 0.05f);
            Sdf.Field eyePort = (x, y, z) => Sdf.Ellipsoid(x, y - 0.006f, z - 0.152f, 0.098f, 0.043f, 0.07f);
            Sdf.Field goggles = (x, y, z) => Sdf.Ellipsoid(x, y - 0.006f, z - 0.118f, 0.1f, 0.039f, 0.052f);
            Sdf.Field peak = (x, y, z) =>
            {
                float ly = y - 0.088f, lz = z - 0.168f;
                float py = ly * cp - lz * sp, pz = ly * sp + lz * cp;
                float taper = 1f - 0.25f * Mathf.Max(0, pz / 0.09f);
                return Sdf.RoundBox(x, py, pz, 0.105f * taper, 0.01f, 0.085f, 0.008f);
            };
            Sdf.Field all = (x, y, z) =>
            {
                float d = Sdf.SMin(shell(x, y, z), chin(x, y, z), 0.05f);
                d = Sdf.SSub(d, eyePort(x, y, z), 0.012f);
                d = Sdf.SMin(d, goggles(x, y, z), 0.008f);
                return Sdf.SMin(d, peak(x, y, z), 0.035f);
            };
            return Sdf.Build(all, new Vector3(-0.17f, -0.19f, -0.2f), new Vector3(0.17f, 0.17f, 0.27f), 0.0065f, p =>
            {
                float x = p.x, y = p.y, z = p.z;
                if (Mathf.Abs(goggles(x, y, z)) < 0.004f && z > 0.12f) return Mathf.Abs(y - 0.006f) < 0.027f && Mathf.Abs(x) < 0.084f ? 2 : 3;
                if (Mathf.Abs(peak(x, y, z)) < 0.004f) return 1;
                if (Mathf.Abs(y - 0.008f) < 0.017f && z < 0.1f && shell(x, y, z) < 0.004f) return 3;
                if (y < -0.118f && z < 0.06f) return 3;
                if (Mathf.Abs(x) < 0.022f && y > 0.07f) return 1;
                if (chin(x, y, z) < shell(x, y, z) - 0.004f && Mathf.Abs(x) < 0.03f) return 1;
                return 0;
            }, 4, 10f);
        });

        /// <summary>
        /// One arm in shoulder-local space (origin = shoulder): sleeve, forearm and a gloved fist
        /// at <paramref name="wrist"/>. Sub-meshes: 0 sleeve, 1 glove.
        /// </summary>
        public static Mesh Arm(Vector3 elbow, Vector3 wrist, string key) => Cached("arm" + key, () =>
        {
            var cuff = wrist + (elbow - wrist).normalized * 0.07f;
            Sdf.Field upper = (x, y, z) => Sdf.SMin(Sdf.Ellipsoid(x, y, z, 0.07f, 0.065f, 0.065f), Sdf.RoundCone(x, y, z, Vector3.zero, elbow, 0.055f, 0.045f), 0.04f);
            Sdf.Field fore = (x, y, z) => Sdf.RoundCone(x, y, z, elbow, cuff, 0.047f, 0.037f);
            Sdf.Field glove = (x, y, z) => Sdf.Ellipsoid(x - wrist.x, y - wrist.y, z - wrist.z, 0.045f, 0.05f, 0.055f);
            Sdf.Field all = (x, y, z) => Sdf.SMin(Sdf.SMin(upper(x, y, z), fore(x, y, z), 0.03f), glove(x, y, z), 0.02f)
                + Mathf.Sin(x * 60f + y * 31f) * Mathf.Sin(z * 53f) * 0.002f;
            var lo = Vector3.Min(Vector3.zero, Vector3.Min(elbow, wrist)) - Vector3.one * 0.1f;
            var hi = Vector3.Max(Vector3.zero, Vector3.Max(elbow, wrist)) + Vector3.one * 0.1f;
            return Sdf.Build(all, lo, hi, 0.009f, p => (p - wrist).magnitude < 0.075f ? 1 : 0, 2, 10f);
        });

        /// <summary>
        /// One leg in hip-local space: pants over the thigh, knee guard, tall MX boot with buckles
        /// and a sole. Sub-meshes: 0 pants, 1 boot, 2 sole/guard (dark).
        /// </summary>
        public static Mesh Leg(Vector3 knee, Vector3 ankle, string key) => Cached("leg" + key, () =>
        {
            var toe = ankle + new Vector3(0, -0.03f, 0.19f);
            var shinDir = (ankle - knee).normalized;
            Sdf.Field thigh = (x, y, z) => Sdf.RoundCone(x, y, z, Vector3.zero, knee, 0.088f, 0.064f);
            Sdf.Field guard = (x, y, z) => Sdf.Ellipsoid(x - knee.x, y - knee.y + 0.02f, z - knee.z - 0.045f, 0.055f, 0.085f, 0.035f);
            Sdf.Field boot = (x, y, z) => Sdf.RoundCone(x, y, z, knee + shinDir * 0.04f, ankle, 0.066f, 0.058f);
            Sdf.Field foot = (x, y, z) => Sdf.RoundCone(x, y, z, ankle + new Vector3(0, -0.01f, -0.04f), toe, 0.062f, 0.042f);
            Sdf.Field sole = (x, y, z) => Sdf.RoundBox(x - ankle.x, y - (ankle.y - 0.06f), z - (ankle.z + 0.06f), 0.05f, 0.016f, 0.145f, 0.012f);
            Sdf.Field all = (x, y, z) =>
            {
                float d = Sdf.SMin(thigh(x, y, z) + Mathf.Sin(x * 50f + z * 27f) * Mathf.Sin(y * 44f) * 0.0025f, boot(x, y, z), 0.03f);
                d = Sdf.SMin(d, foot(x, y, z), 0.035f);
                d = Mathf.Min(d, guard(x, y, z));
                return Sdf.SMin(d, sole(x, y, z), 0.01f);
            };
            var lo = Vector3.Min(Vector3.zero, Vector3.Min(knee, Vector3.Min(ankle, toe))) - Vector3.one * 0.13f;
            var hi = Vector3.Max(Vector3.zero, Vector3.Max(knee, Vector3.Max(ankle, toe))) + Vector3.one * 0.13f;
            float kneeT = 0.04f;
            return Sdf.Build(all, lo, hi, 0.01f, p =>
            {
                if (sole(p.x, p.y, p.z) < 0.004f || guard(p.x, p.y, p.z) < 0.003f) return 2;
                // Boot where the boot shaft / foot is the nearer shape, pants elsewhere.
                float along = Vector3.Dot(p - knee, shinDir);
                if ((boot(p.x, p.y, p.z) < thigh(p.x, p.y, p.z) && along > kneeT) || foot(p.x, p.y, p.z) < 0.01f)
                {
                    // Dark buckle straps across the boot shaft.
                    float bt = along / Mathf.Max(0.01f, (ankle - knee).magnitude);
                    foreach (float b in new[] { 0.45f, 0.62f, 0.8f }) if (Mathf.Abs(bt - b) < 0.025f) return 2;
                    return 1;
                }
                return 0;
            }, 3, 10f);
        });
    }
}
