using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace StarkVarg
{
    /// <summary>
    /// Signed-distance-field modelling for organic, sculpted shapes (bike bodywork, rider,
    /// helmet, car bodies). Shapes are written as smooth unions of a few primitives and turned
    /// into one continuous smooth mesh with naive surface nets: one vertex per grid cell that
    /// straddles the surface, quads across every sign-changing grid edge, vertices projected
    /// onto the surface and normals from the field gradient. Same algorithm as the web game.
    /// </summary>
    public static class Sdf
    {
        public delegate float Field(float x, float y, float z);

        /// <summary>Polynomial smooth minimum (blend radius k).</summary>
        public static float SMin(float a, float b, float k)
        {
            if (k <= 0) return Mathf.Min(a, b);
            float h = Mathf.Max(k - Mathf.Abs(a - b), 0) / k;
            return Mathf.Min(a, b) - h * h * k * 0.25f;
        }

        /// <summary>Smooth subtraction: a minus b.</summary>
        public static float SSub(float a, float b, float k) => -SMin(-a, b, k);

        /// <summary>Tapered capsule from a (radius ra) to b (radius rb); exact distance.</summary>
        public static float RoundCone(float px, float py, float pz, Vector3 a, Vector3 b, float ra, float rb)
        {
            float bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
            float l2 = bax * bax + bay * bay + baz * baz;
            float rr = ra - rb;
            float a2 = l2 - rr * rr;
            float il2 = 1f / l2;
            float pax = px - a.x, pay = py - a.y, paz = pz - a.z;
            float y = pax * bax + pay * bay + paz * baz;
            float z = y - l2;
            float qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
            float x2 = qx * qx + qy * qy + qz * qz;
            float y2 = y * y * l2;
            float z2 = z * z * l2;
            float k = Mathf.Sign(rr) * rr * rr * x2;
            if (Mathf.Sign(z) * a2 * z2 > k) return Mathf.Sqrt(x2 + z2) * il2 - rb;
            if (Mathf.Sign(y) * a2 * y2 < k) return Mathf.Sqrt(x2 + y2) * il2 - ra;
            return (Mathf.Sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
        }

        /// <summary>Axis-aligned ellipsoid (good approximation near the surface).</summary>
        public static float Ellipsoid(float px, float py, float pz, float rx, float ry, float rz)
        {
            float ax = px / rx, ay = py / ry, az = pz / rz;
            float bx = ax / rx, by = ay / ry, bz = az / rz;
            float k0 = Mathf.Sqrt(ax * ax + ay * ay + az * az);
            float k1 = Mathf.Sqrt(bx * bx + by * by + bz * bz);
            return k1 < 1e-9f ? -Mathf.Min(rx, Mathf.Min(ry, rz)) : k0 * (k0 - 1f) / k1;
        }

        /// <summary>Axis-aligned rounded box of half extents (hx, hy, hz) and corner radius r.</summary>
        public static float RoundBox(float px, float py, float pz, float hx, float hy, float hz, float r)
        {
            float qx = Mathf.Abs(px) - hx + r, qy = Mathf.Abs(py) - hy + r, qz = Mathf.Abs(pz) - hz + r;
            float ox = Mathf.Max(qx, 0), oy = Mathf.Max(qy, 0), oz = Mathf.Max(qz, 0);
            return Mathf.Sqrt(ox * ox + oy * oy + oz * oz) + Mathf.Min(Mathf.Max(qx, Mathf.Max(qy, qz)), 0) - r;
        }

        static readonly int[,] Corners = { { 0, 0, 0 }, { 1, 0, 0 }, { 0, 1, 0 }, { 1, 1, 0 }, { 0, 0, 1 }, { 1, 0, 1 }, { 0, 1, 1 }, { 1, 1, 1 } };
        static readonly int[,] Edges = { { 0, 1 }, { 2, 3 }, { 4, 5 }, { 6, 7 }, { 0, 2 }, { 1, 3 }, { 4, 6 }, { 5, 7 }, { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 } };

        /// <summary>
        /// Mesh the zero level set of <paramref name="f"/> inside [min, max] with cell size h.
        /// <paramref name="region"/> (optional) sorts triangles into sub-meshes (one material each)
        /// by majority vote of their corners; <paramref name="regions"/> is the sub-mesh count.
        /// UVs are a box projection scaled by <paramref name="uvScale"/> (for detail textures).
        /// </summary>
        public static Mesh Build(Field f, Vector3 min, Vector3 max, float h, Func<Vector3, int> region = null, int regions = 1, float uvScale = 4f)
        {
            Surface(f, min, max, h, out var verts, out var normals, out var idx);
            return ToMesh(verts, normals, idx, region, regions, uvScale);
        }

        /// <summary>The pure geometry part of <see cref="Build"/> (no Unity objects; testable).</summary>
        public static void Surface(Field f, Vector3 min, Vector3 max, float h, out List<Vector3> verts, out Vector3[] normals, out List<int> idx)
        {
            int nx = Mathf.CeilToInt((max.x - min.x) / h) + 1;
            int ny = Mathf.CeilToInt((max.y - min.y) / h) + 1;
            int nz = Mathf.CeilToInt((max.z - min.z) / h) + 1;
            var val = new float[nx * ny * nz];

            // Coarse pass every C cells; fine samples where the surface cannot be take the
            // interpolated coarse value (only the sign and rough magnitude matter there).
            const int C = 2;
            int cx = (nx - 1 + C - 1) / C + 1, cy = (ny - 1 + C - 1) / C + 1, cz = (nz - 1 + C - 1) / C + 1;
            var coarse = new float[cx * cy * cz];
            for (int k = 0; k < cz; k++)
                for (int j = 0; j < cy; j++)
                    for (int i = 0; i < cx; i++)
                        coarse[i + cx * (j + cy * k)] = f(min.x + i * C * h, min.y + j * C * h, min.z + k * C * h);
            float margin = C * h * 0.95f;
            var c8 = new float[8];
            for (int K = 0; K < cz - 1; K++)
                for (int J = 0; J < cy - 1; J++)
                    for (int I = 0; I < cx - 1; I++)
                    {
                        bool far = true;
                        bool neg = false, pos = false;
                        for (int c = 0; c < 8; c++)
                        {
                            float v = coarse[I + Corners[c, 0] + cx * (J + Corners[c, 1] + cy * (K + Corners[c, 2]))];
                            c8[c] = v;
                            if (Mathf.Abs(v) < margin) far = false;
                            if (v < 0) neg = true; else pos = true;
                        }
                        if (neg && pos) far = false;
                        for (int dk = 0; dk <= C; dk++)
                        {
                            int k = K * C + dk;
                            if (k >= nz) break;
                            for (int dj = 0; dj <= C; dj++)
                            {
                                int j = J * C + dj;
                                if (j >= ny) break;
                                for (int di = 0; di <= C; di++)
                                {
                                    int i = I * C + di;
                                    if (i >= nx) break;
                                    if (far)
                                    {
                                        float u = di / (float)C, v = dj / (float)C, w = dk / (float)C;
                                        float x00 = c8[0] + (c8[1] - c8[0]) * u, x10 = c8[2] + (c8[3] - c8[2]) * u;
                                        float x01 = c8[4] + (c8[5] - c8[4]) * u, x11 = c8[6] + (c8[7] - c8[6]) * u;
                                        float y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
                                        val[((i) + nx * ((j) + ny * (k)))] = y0 + (y1 - y0) * w;
                                    }
                                    else val[((i) + nx * ((j) + ny * (k)))] = f(min.x + i * h, min.y + j * h, min.z + k * h);
                                }
                            }
                        }
                    }

            // One vertex per surface cell: the mean of the edge crossings.
            var cellVert = new int[(nx - 1) * (ny - 1) * (nz - 1)];
            for (int q = 0; q < cellVert.Length; q++) cellVert[q] = -1;
            verts = new List<Vector3>();
            var cv = new float[8];
            var off = new int[8];
            for (int c = 0; c < 8; c++) off[c] = Corners[c, 0] + nx * (Corners[c, 1] + ny * Corners[c, 2]);
            for (int k = 0; k < nz - 1; k++)
                for (int j = 0; j < ny - 1; j++)
                {
                    int bas = nx * (j + ny * k);
                    for (int i = 0; i < nx - 1; i++, bas++)
                    {
                        int negs = 0;
                        for (int c = 0; c < 8; c++)
                        {
                            float v = val[bas + off[c]];
                            cv[c] = v;
                            if (v < 0) negs++;
                        }
                        if (negs == 0 || negs == 8) continue;
                        float sx = 0, sy = 0, sz = 0;
                        int n = 0;
                        for (int e = 0; e < 12; e++)
                        {
                            int e0 = Edges[e, 0], e1 = Edges[e, 1];
                            float v0 = cv[e0], v1 = cv[e1];
                            if ((v0 < 0) == (v1 < 0)) continue;
                            float t = v0 / (v0 - v1);
                            sx += Corners[e0, 0] + (Corners[e1, 0] - Corners[e0, 0]) * t;
                            sy += Corners[e0, 1] + (Corners[e1, 1] - Corners[e0, 1]) * t;
                            sz += Corners[e0, 2] + (Corners[e1, 2] - Corners[e0, 2]) * t;
                            n++;
                        }
                        cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k)))] = verts.Count;
                        verts.Add(new Vector3(min.x + (i + sx / n) * h, min.y + (j + sy / n) * h, min.z + (k + sz / n) * h));
                    }
                }

            // Quads across sign-changing edges (split along the shorter diagonal).
            var vl = verts;
            var il = new List<int>();
            for (int k = 0; k < nz; k++)
                for (int j = 0; j < ny; j++)
                    for (int i = 0; i < nx; i++)
                    {
                        int p0 = ((i) + nx * ((j) + ny * (k)));
                        bool in0 = val[p0] < 0;
                        if ((i >= nx - 1 || (val[p0 + 1] < 0) == in0) && (j >= ny - 1 || (val[p0 + nx] < 0) == in0) && (k >= nz - 1 || (val[p0 + nx * ny] < 0) == in0)) continue;
                        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && in0 != (val[((i + 1) + nx * ((j) + ny * (k)))] < 0))
                            Quad(vl, il, cellVert[(((i)) + (nx - 1) * ((j - 1) + (ny - 1) * (k - 1)))], cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k - 1)))], cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k)))], cellVert[(((i)) + (nx - 1) * ((j - 1) + (ny - 1) * (k)))], !in0);
                        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && in0 != (val[((i) + nx * ((j + 1) + ny * (k)))] < 0))
                            Quad(vl, il, cellVert[(((i - 1)) + (nx - 1) * ((j) + (ny - 1) * (k - 1)))], cellVert[(((i - 1)) + (nx - 1) * ((j) + (ny - 1) * (k)))], cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k)))], cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k - 1)))], !in0);
                        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && in0 != (val[((i) + nx * ((j) + ny * (k + 1)))] < 0))
                            Quad(vl, il, cellVert[(((i - 1)) + (nx - 1) * ((j - 1) + (ny - 1) * (k)))], cellVert[(((i)) + (nx - 1) * ((j - 1) + (ny - 1) * (k)))], cellVert[(((i)) + (nx - 1) * ((j) + (ny - 1) * (k)))], cellVert[(((i - 1)) + (nx - 1) * ((j) + (ny - 1) * (k)))], !in0);
                    }

            // Project onto the surface (at most half a cell) and take gradient normals.
            normals = new Vector3[vl.Count];
            float eps = h * 0.5f;
            for (int v = 0; v < vl.Count; v++)
            {
                var p = vl[v];
                for (int it = 0; it < 2; it++)
                {
                    float d = f(p.x, p.y, p.z);
                    var g = new Vector3(f(p.x + eps, p.y, p.z) - f(p.x - eps, p.y, p.z), f(p.x, p.y + eps, p.z) - f(p.x, p.y - eps, p.z), f(p.x, p.y, p.z + eps) - f(p.x, p.y, p.z - eps));
                    g = g.sqrMagnitude > 1e-12f ? g.normalized : Vector3.up;
                    if (it == 0) p -= g * Mathf.Clamp(d, -h * 0.5f, h * 0.5f);
                    else normals[v] = g;
                }
                vl[v] = p;
            }
            // Wind every triangle outward (front face on the side the gradient points to).
            for (int t = 0; t < il.Count; t += 3)
            {
                Vector3 a = vl[il[t]], b = vl[il[t + 1]], c = vl[il[t + 2]];
                var fn = Vector3.Cross(b - a, c - a);
                if (Vector3.Dot(fn, normals[il[t]] + normals[il[t + 1]] + normals[il[t + 2]]) < 0) { int tmp = il[t + 1]; il[t + 1] = il[t + 2]; il[t + 2] = tmp; }
            }

            idx = il;
        }

        static void Quad(List<Vector3> vl, List<int> il, int a, int b, int c, int d, bool flip)
        {
            if (a < 0 || b < 0 || c < 0 || d < 0) return;
            if (flip) { int t = b; b = d; d = t; }
            if ((vl[a] - vl[c]).sqrMagnitude <= (vl[b] - vl[d]).sqrMagnitude) { il.Add(a); il.Add(b); il.Add(c); il.Add(a); il.Add(c); il.Add(d); }
            else { il.Add(a); il.Add(b); il.Add(d); il.Add(b); il.Add(c); il.Add(d); }
        }

        static Mesh ToMesh(List<Vector3> verts, Vector3[] normals, List<int> idx, Func<Vector3, int> region, int regions, float uvScale)
        {
            // Box-projected UVs (dominant normal axis) for tiling detail textures.
            var uv = new Vector2[verts.Count];
            for (int v = 0; v < verts.Count; v++)
            {
                var p = verts[v] * uvScale;
                var n = normals[v];
                float ax = Mathf.Abs(n.x), ay = Mathf.Abs(n.y), az = Mathf.Abs(n.z);
                uv[v] = ax >= ay && ax >= az ? new Vector2(p.z, p.y) : ay >= az ? new Vector2(p.x, p.z) : new Vector2(p.x, p.y);
            }

            var mesh = new Mesh { indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(verts);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uv);
            if (region == null || regions <= 1) mesh.SetTriangles(idx, 0);
            else
            {
                var reg = new int[verts.Count];
                for (int v = 0; v < verts.Count; v++) reg[v] = Mathf.Clamp(region(verts[v]), 0, regions - 1);
                var lists = new List<int>[regions];
                for (int r = 0; r < regions; r++) lists[r] = new List<int>();
                for (int t = 0; t < idx.Count; t += 3)
                {
                    int r0 = reg[idx[t]], r1 = reg[idx[t + 1]], r2 = reg[idx[t + 2]];
                    int r = r1 == r2 ? r1 : r0;
                    lists[r].Add(idx[t]); lists[r].Add(idx[t + 1]); lists[r].Add(idx[t + 2]);
                }
                mesh.subMeshCount = regions;
                for (int r = 0; r < regions; r++) mesh.SetTriangles(lists[r], r);
            }
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
