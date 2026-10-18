using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Sculpted electric city cars. Each body style is one smooth signed-distance-field shell:
    /// a lower body with a sloping bonnet, a glasshouse whose pillars rake inwards, wheel arches
    /// cut out and mirrors blended on. Sub-meshes: 0 paint, 1 glass, 2 headlights, 3 tail
    /// lights, 4 black trim (sills, grille, arch liners). Meshes are cached per style.
    /// </summary>
    public static class CarArt
    {
        public struct Kind
        {
            public float length, width, clear, belt, roof, cabFront, cabRear, insetFront, insetRear, wheelR, wheelBase;
        }

        public static readonly Kind[] Kinds =
        {
            // Saloon.
            new Kind { length = 4.5f, width = 1.84f, clear = 0.2f, belt = 0.92f, roof = 1.44f, cabFront = 0.75f, cabRear = -1.3f, insetFront = 0.7f, insetRear = 0.5f, wheelR = 0.34f, wheelBase = 2.8f },
            // Hatchback.
            new Kind { length = 4.1f, width = 1.78f, clear = 0.2f, belt = 0.9f, roof = 1.5f, cabFront = 0.68f, cabRear = -1.78f, insetFront = 0.62f, insetRear = 0.2f, wheelR = 0.33f, wheelBase = 2.6f },
            // Crossover / SUV.
            new Kind { length = 4.6f, width = 1.9f, clear = 0.28f, belt = 1.06f, roof = 1.68f, cabFront = 0.85f, cabRear = -2.0f, insetFront = 0.58f, insetRear = 0.14f, wheelR = 0.38f, wheelBase = 2.85f },
        };

        static readonly Dictionary<string, Mesh> meshes = new Dictionary<string, Mesh>();
        static Mesh Cached(string key, System.Func<Mesh> make)
        {
            if (!meshes.TryGetValue(key, out var m) || m == null) meshes[key] = m = make();
            return m;
        }

        public static Mesh Body(int kind) => Cached("car" + kind, () => BuildBody(Kinds[kind]));

        static Mesh BuildBody(Kind k)
        {
            float hl = k.length / 2f, hw = k.width / 2f;
            float zw = k.wheelBase / 2f;
            Sdf.Field lower = (x, y, z) =>
            {
                // The bonnet and boot lid fall away towards the bumpers.
                float drop = 0.09f * Mathf.Clamp01((z - hl * 0.35f) / (hl * 0.65f)) + 0.05f * Mathf.Clamp01((-z - hl * 0.6f) / (hl * 0.4f));
                float top = k.belt - drop;
                float bulge = 0.025f * Mathf.Clamp01(1f - Mathf.Abs(y - (k.clear + top) * 0.55f) * 4f);
                return Sdf.RoundBox(x, y - (k.clear + top) / 2f, z, hw - 0.03f + bulge, (top - k.clear) / 2f, hl, 0.17f) * 0.9f;
            };
            Sdf.Field cabin = (x, y, z) =>
            {
                float t = Mathf.Clamp01((y - k.belt) / (k.roof - k.belt));
                float front = k.cabFront - k.insetFront * t;
                float rear = k.cabRear + k.insetRear * t;
                float w = Mathf.Lerp(hw - 0.07f, hw - 0.24f, t);
                return Sdf.RoundBox(x, y - (k.belt - 0.1f + k.roof) / 2f, z - (front + rear) / 2f, w, (k.roof - k.belt + 0.1f) / 2f, (front - rear) / 2f, 0.12f) * 0.75f;
            };
            Sdf.Field arch = (x, y, z) =>
            {
                float dz = Mathf.Abs(z) - zw;
                float cyl = Mathf.Sqrt((y - k.wheelR) * (y - k.wheelR) + dz * dz) - (k.wheelR + 0.08f);
                return Mathf.Max(cyl, (hw - 0.32f) - Mathf.Abs(x));
            };
            Sdf.Field mirror = (x, y, z) => Sdf.Ellipsoid(Mathf.Abs(x) - (hw + 0.03f), y - (k.belt + 0.1f), z - (k.cabFront - 0.12f), 0.08f, 0.055f, 0.045f);
            Sdf.Field body = (x, y, z) => Sdf.SMin(Sdf.SMin(lower(x, y, z), cabin(x, y, z), 0.16f), mirror(x, y, z), 0.05f);
            Sdf.Field all = (x, y, z) => Sdf.SSub(body(x, y, z), arch(x, y, z), 0.03f);

            System.Func<Vector3, int> region = p =>
            {
                float ax = Mathf.Abs(p.x);
                if (Mathf.Abs(arch(p.x, p.y, p.z)) < 0.04f) return 4;
                if (p.y < k.clear + 0.13f) return 4;
                if (p.y > k.belt + 0.06f && p.y < k.roof - 0.06f && mirror(p.x, p.y, p.z) > 0.02f) return 1;
                if (p.z > hl - 0.16f && ax > hw - 0.5f && p.y > k.belt - 0.28f && p.y < k.belt - 0.08f) return 2;
                if (p.z < -hl + 0.14f && ax > hw - 0.48f && p.y > k.belt - 0.3f && p.y < k.belt - 0.1f) return 3;
                if (p.z > hl - 0.08f && ax < hw - 0.55f && p.y < k.belt - 0.3f) return 4;
                return 0;
            };
            var min = new Vector3(-hw - 0.15f, k.clear - 0.05f, -hl - 0.08f);
            var max = new Vector3(hw + 0.15f, k.roof + 0.08f, hl + 0.08f);
            return Sdf.Build(all, min, max, 0.04f, region, 5, 1f);
        }

        /// <summary>Low-profile road tyre about the X axis.</summary>
        public static Mesh TyreMesh(float r) => Cached("cartyre" + r, () => MeshGen.Tyre(r, 0.22f, 0.12f, 48, 12));

        /// <summary>Five-spoke alloy: rim barrel, spokes and centre cap on both faces.</summary>
        public static Mesh HubMesh(float r) => Cached("carhub" + r, () =>
        {
            float rim = r - 0.11f;
            var parts = new List<CombineInstance>
            {
                new CombineInstance { mesh = MeshGen.Disc(rim, rim - 0.025f, 0.2f, 40), transform = Matrix4x4.identity },
            };
            foreach (float side in new[] { 1f, -1f })
            {
                parts.Add(new CombineInstance { mesh = MeshGen.Disc(0.05f, 0f, 0.03f, 20), transform = Matrix4x4.Translate(new Vector3(side * 0.09f, 0, 0)) });
                for (int s = 0; s < 5; s++)
                {
                    var rot = Quaternion.Euler(s * 72f, 0, 0);
                    var m = Matrix4x4.TRS(new Vector3(side * 0.085f, 0, 0) + rot * new Vector3(0, rim * 0.5f, 0), rot, Vector3.one);
                    parts.Add(new CombineInstance { mesh = MeshGen.Box(new Vector3(0.025f, rim, 0.05f)), transform = m });
                }
            }
            return MeshGen.Combine(parts);
        });
    }
}
