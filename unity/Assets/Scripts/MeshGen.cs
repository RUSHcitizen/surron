using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace StarkVarg
{
    /// <summary>Procedural meshes: boxes with world-scale UVs, tubes along curves, tyres, discs.</summary>
    public static class MeshGen
    {
        /// <summary>
        /// A box centred on the origin. UVs are in metres × <paramref name="uvPerMetre"/> on every
        /// face, so a tiling texture keeps its real size however big the box is (no stretching).
        /// </summary>
        public static Mesh Box(Vector3 size, float uvPerMetre = 1f)
        {
            var h = size * 0.5f;
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            Face(v, n, uv, t, h, uvPerMetre, Vector3.forward, Vector3.left, Vector3.up, size.x, size.y);
            Face(v, n, uv, t, h, uvPerMetre, Vector3.back, Vector3.right, Vector3.up, size.x, size.y);
            Face(v, n, uv, t, h, uvPerMetre, Vector3.right, Vector3.forward, Vector3.up, size.z, size.y);
            Face(v, n, uv, t, h, uvPerMetre, Vector3.left, Vector3.back, Vector3.up, size.z, size.y);
            Face(v, n, uv, t, h, uvPerMetre, Vector3.up, Vector3.right, Vector3.forward, size.x, size.z);
            Face(v, n, uv, t, h, uvPerMetre, Vector3.down, Vector3.left, Vector3.forward, size.x, size.z);
            return FixWinding(Finish(v, n, uv, t));
        }

        static void Face(List<Vector3> v, List<Vector3> n, List<Vector2> uv, List<int> t, Vector3 h, float uvPerMetre, Vector3 normal, Vector3 u, Vector3 w, float du, float dw)
        {
            var c = Vector3.Scale(normal, h);
            int b = v.Count;
            v.Add(c - u * du * 0.5f - w * dw * 0.5f); v.Add(c + u * du * 0.5f - w * dw * 0.5f);
            v.Add(c + u * du * 0.5f + w * dw * 0.5f); v.Add(c - u * du * 0.5f + w * dw * 0.5f);
            for (int i = 0; i < 4; i++) n.Add(normal);
            uv.Add(new Vector2(0, 0)); uv.Add(new Vector2(du * uvPerMetre, 0));
            uv.Add(new Vector2(du * uvPerMetre, dw * uvPerMetre)); uv.Add(new Vector2(0, dw * uvPerMetre));
            t.Add(b); t.Add(b + 2); t.Add(b + 1); t.Add(b); t.Add(b + 3); t.Add(b + 2);
        }

        /// <summary>A tube of radius r along a Catmull-Rom curve through the points.</summary>
        public static Mesh Tube(IList<Vector3> pts, float r, int segments = 24, int sides = 10, float rEnd = -1f)
        {
            if (rEnd < 0) rEnd = r;
            var centers = new List<Vector3>();
            for (int s = 0; s <= segments; s++) centers.Add(CatmullRom(pts, s / (float)segments));
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            Vector3 prevUp = Vector3.up;
            float len = 0;
            for (int s = 0; s <= segments; s++)
            {
                var c = centers[s];
                var tan = (centers[Mathf.Min(segments, s + 1)] - centers[Mathf.Max(0, s - 1)]).normalized;
                var side = Vector3.Cross(tan, prevUp);
                if (side.sqrMagnitude < 1e-6f) side = Vector3.Cross(tan, Vector3.right);
                side.Normalize();
                var up = Vector3.Cross(side, tan).normalized;
                prevUp = up;
                if (s > 0) len += (centers[s] - centers[s - 1]).magnitude;
                float rr = Mathf.Lerp(r, rEnd, s / (float)segments);
                for (int k = 0; k <= sides; k++)
                {
                    float a = k / (float)sides * Mathf.PI * 2f;
                    var dir = side * Mathf.Cos(a) + up * Mathf.Sin(a);
                    v.Add(c + dir * rr); n.Add(dir); uv.Add(new Vector2(k / (float)sides, len * 4f));
                }
            }
            int ring = sides + 1;
            for (int s = 0; s < segments; s++)
                for (int k = 0; k < sides; k++)
                {
                    int a = s * ring + k, b = a + 1, c = a + ring, d = c + 1;
                    t.Add(a); t.Add(c); t.Add(b); t.Add(b); t.Add(c); t.Add(d);
                }
            return FixWinding(Finish(v, n, uv, t));
        }

        public static Vector3 CatmullRom(IList<Vector3> p, float u)
        {
            if (p.Count == 2) return Vector3.Lerp(p[0], p[1], u);
            float f = u * (p.Count - 1);
            int i = Mathf.Min(p.Count - 2, Mathf.FloorToInt(f));
            float t = f - i;
            Vector3 p0 = p[Mathf.Max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Mathf.Min(p.Count - 1, i + 2)];
            float t2 = t * t, t3 = t2 * t;
            return 0.5f * ((2f * p1) + (-p0 + p2) * t + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 + (-p0 + 3f * p1 - 3f * p2 + p3) * t3);
        }

        /// <summary>
        /// A tyre around the X axis: a torus with an oval (taller-than-wide) section, the motocross
        /// profile. UV.x runs around the tread (for the knobbly tread texture).
        /// </summary>
        public static Mesh Tyre(float radius, float width, float height, int around = 72, int section = 16)
        {
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            float rc = radius - height * 0.5f;
            for (int i = 0; i <= around; i++)
            {
                float a = i / (float)around * Mathf.PI * 2f;
                var radial = new Vector3(0, Mathf.Sin(a), Mathf.Cos(a));
                for (int j = 0; j <= section; j++)
                {
                    float b = j / (float)section * Mathf.PI * 2f;
                    float cx = Mathf.Sin(b) * width * 0.5f, cr = Mathf.Cos(b) * height * 0.5f;
                    v.Add(new Vector3(cx, 0, 0) + radial * (rc + cr));
                    // Ellipse normal.
                    var nn = new Vector3(Mathf.Sin(b) / (width * 0.5f), 0, 0) + radial * (Mathf.Cos(b) / (height * 0.5f));
                    n.Add(nn.normalized);
                    uv.Add(new Vector2(i / (float)around * 36f, j / (float)section));
                }
            }
            int ring = section + 1;
            for (int i = 0; i < around; i++)
                for (int j = 0; j < section; j++)
                {
                    int a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
                    t.Add(a); t.Add(c); t.Add(b); t.Add(b); t.Add(c); t.Add(d);
                }
            return FixWinding(Finish(v, n, uv, t));
        }

        /// <summary>A disc / short cylinder around the X axis (brake rotor, hub, motor case).</summary>
        public static Mesh Disc(float rOuter, float rInner, float thickness, int around = 48)
        {
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            float hx = thickness * 0.5f;
            for (int side = -1; side <= 1; side += 2)
            {
                int b = v.Count;
                for (int i = 0; i <= around; i++)
                {
                    float a = i / (float)around * Mathf.PI * 2f;
                    var d = new Vector3(0, Mathf.Sin(a), Mathf.Cos(a));
                    v.Add(new Vector3(side * hx, 0, 0) + d * rOuter); n.Add(new Vector3(side, 0, 0)); uv.Add(new Vector2(d.z, d.y) * 0.5f);
                    v.Add(new Vector3(side * hx, 0, 0) + d * rInner); n.Add(new Vector3(side, 0, 0)); uv.Add(new Vector2(d.z, d.y) * 0.5f * rInner / rOuter);
                }
                for (int i = 0; i < around; i++)
                {
                    int a = b + i * 2;
                    t.Add(a); t.Add(a + 1); t.Add(a + 2); t.Add(a + 1); t.Add(a + 3); t.Add(a + 2);
                }
            }
            // Outer rim.
            int rb = v.Count;
            for (int i = 0; i <= around; i++)
            {
                float a = i / (float)around * Mathf.PI * 2f;
                var d = new Vector3(0, Mathf.Sin(a), Mathf.Cos(a));
                v.Add(new Vector3(-hx, 0, 0) + d * rOuter); n.Add(d); uv.Add(new Vector2(i / (float)around, 0));
                v.Add(new Vector3(hx, 0, 0) + d * rOuter); n.Add(d); uv.Add(new Vector2(i / (float)around, 1));
            }
            for (int i = 0; i < around; i++)
            {
                int a = rb + i * 2;
                t.Add(a); t.Add(a + 1); t.Add(a + 2); t.Add(a + 1); t.Add(a + 3); t.Add(a + 2);
            }
            return FixWinding(Finish(v, n, uv, t));
        }

        static Mesh Finish(List<Vector3> v, List<Vector3> n, List<Vector2> uv, List<int> t)
        {
            var m = new Mesh { indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            m.SetVertices(v); m.SetNormals(n); m.SetUVs(0, uv); m.SetTriangles(t, 0);
            m.RecalculateTangents();
            m.RecalculateBounds();
            return m;
        }

        /// <summary>Make every triangle face the way its vertex normals point (Unity: clockwise from the front).</summary>
        public static Mesh FixWinding(Mesh m)
        {
            var v = m.vertices; var n = m.normals;
            for (int s = 0; s < m.subMeshCount; s++)
            {
                var t = m.GetTriangles(s);
                for (int i = 0; i < t.Length; i += 3)
                {
                    var fn = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                    if (Vector3.Dot(fn, n[t[i]] + n[t[i + 1]] + n[t[i + 2]]) < 0) { int tmp = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = tmp; }
                }
                m.SetTriangles(t, s);
            }
            m.RecalculateTangents();
            return m;
        }

        /// <summary>Combine many (mesh, matrix) parts into one mesh (one draw call).</summary>
        public static Mesh Combine(List<CombineInstance> parts)
        {
            var m = new Mesh { indexFormat = IndexFormat.UInt32 };
            m.CombineMeshes(parts.ToArray(), true, true);
            m.RecalculateBounds();
            return m;
        }
    }
}
