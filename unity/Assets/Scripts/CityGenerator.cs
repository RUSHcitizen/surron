using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Procedural city with physically based materials: worn asphalt streets (normal-mapped) with
    /// lane and edge markings, concrete-slab pavements with granite kerbs, buildings with
    /// textured façades (brick, plaster, concrete, glass curtain walls) — recessed windows that
    /// reflect the sky, shopfronts and awnings at street level, parapets and rooftop plant —
    /// leafy street trees (alpha-tested leaf cards), and lamp posts. Static parts are batched.
    /// Also returns the street centre lines for traffic.
    /// </summary>
    public class CityGenerator
    {
        public int blocks = 6;          // blocks per side
        public float block = 64f;       // block size (kerb to kerb)
        public float road = 14f;        // street width
        public int seed = 7;

        public float Pitch => block + road;
        public float Half => blocks * Pitch * 0.5f;
        /// <summary>Street centre lines: x positions of N-S streets and z positions of E-W streets.</summary>
        public readonly List<float> streets = new List<float>();

        Material asphalt, concrete, grass, kerbStone, line, white, shopGlass, roofM, plant, pole, lampHead, trunk;
        Material[] leaves;
        Mesh[] treeCrowns, treeTrunks;

        static GameObject Piece(Transform parent, string name, Mesh mesh, Material mat, Vector3 pos, bool collider = false)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            if (collider) go.AddComponent<BoxCollider>();
            return go;
        }

        public Transform Build(Transform parent)
        {
            var root = new GameObject("City").transform;
            root.SetParent(parent, false);
            var rnd = new System.Random(seed);
            asphalt = Mats.Pbr("asphalt", ProcTex.Asphalt(), Color.white, 1f, 1f, new Vector2(0.25f, 0.25f));
            concrete = Mats.Pbr("concrete", ProcTex.Concrete(), Color.white, 1f, 1f, new Vector2(0.5f, 0.5f));
            grass = Mats.Pbr("grass", ProcTex.Grass(), Color.white, 1f, 1f, new Vector2(0.33f, 0.33f));
            kerbStone = Mats.Pbr("kerb", ProcTex.Concrete(), new Color(0.82f, 0.82f, 0.85f), 1.3f, 0.6f, new Vector2(1f, 1f));
            line = Mats.Get(Mats.Hex("#e3c14a"), 0.35f);
            white = Mats.Get(Mats.Hex("#e9e9e4"), 0.35f);
            shopGlass = Mats.Get(Mats.Hex("#1c242c"), 0.95f, 0.5f);
            roofM = Mats.Pbr("roof", ProcTex.Concrete(), new Color(0.62f, 0.62f, 0.6f), 0.6f, 1f, new Vector2(0.3f, 0.3f));
            plant = Mats.Get(Mats.Hex("#8d9096"), 0.45f, 0.6f);
            pole = Mats.Get(Mats.Hex("#2a2d33"), 0.55f, 0.6f);
            lampHead = Mats.Get(Color.white, 0.6f, 0f, new Color(1f, 0.92f, 0.75f) * 0.6f);
            trunk = Mats.Get(Mats.Hex("#4a3a2c"), 0.08f);
            var leafTex = ProcTex.Leaves();
            leaves = new[] { Mats.Cutout("leafA", leafTex, Color.white), Mats.Cutout("leafB", leafTex, new Color(0.85f, 0.95f, 0.75f)), Mats.Cutout("leafC", leafTex, new Color(1f, 0.92f, 0.8f)) };
            treeCrowns = new Mesh[3]; treeTrunks = new Mesh[3];
            for (int i = 0; i < 3; i++) { treeCrowns[i] = CrownMesh(100 + i); treeTrunks[i] = TrunkMesh(200 + i); }

            // Ground: grass everywhere, asphalt over the city.
            Piece(root, "Grass", MeshGen.Box(new Vector3(4000, 1, 4000)), grass, new Vector3(0, -0.5f, 0), true);
            float span = blocks * Pitch + road;
            Piece(root, "Asphalt", MeshGen.Box(new Vector3(span, 1, span)), asphalt, new Vector3(0, -0.49f, 0), true);

            float start = -Half;
            for (int i = 0; i <= blocks; i++) streets.Add(start + i * Pitch);

            // Dashed centre line and solid edge lines on every street.
            var dash = MeshGen.Box(new Vector3(0.16f, 0.02f, 3f));
            var dashX = MeshGen.Box(new Vector3(3f, 0.02f, 0.16f));
            foreach (float s in streets)
            {
                for (float t = -Half + 4f; t < Half - 4f; t += 7f)
                {
                    if (Mathf.Abs(Mathf.Repeat(t - start + Pitch / 2f, Pitch) - Pitch / 2f) < road / 2f + 3f) continue; // not across junctions
                    Piece(root, "Dash", dash, line, new Vector3(s, 0.012f, t));
                    Piece(root, "Dash", dashX, line, new Vector3(t, 0.012f, s));
                }
            }

            for (int bx = 0; bx < blocks; bx++)
                for (int bz = 0; bz < blocks; bz++)
                {
                    float cx = start + bx * Pitch + Pitch / 2f, cz = start + bz * Pitch + Pitch / 2f;
                    // Pavement slab (kerb height 15 cm) with granite kerb stones around it.
                    Piece(root, "Pavement", MeshGen.Box(new Vector3(block - 0.5f, 0.15f, block - 0.5f)), concrete, new Vector3(cx, 0.075f, cz), true);
                    var kx = MeshGen.Box(new Vector3(block, 0.16f, 0.25f)); var kz = MeshGen.Box(new Vector3(0.25f, 0.16f, block));
                    Piece(root, "Kerb", kx, kerbStone, new Vector3(cx, 0.08f, cz + block / 2f - 0.125f));
                    Piece(root, "Kerb", kx, kerbStone, new Vector3(cx, 0.08f, cz - block / 2f + 0.125f));
                    Piece(root, "Kerb", kz, kerbStone, new Vector3(cx + block / 2f - 0.125f, 0.08f, cz));
                    Piece(root, "Kerb", kz, kerbStone, new Vector3(cx - block / 2f + 0.125f, 0.08f, cz));
                    // Edge lines along the kerbs and a zebra crossing at the block's corner.
                    var edgeX = MeshGen.Box(new Vector3(block - 6f, 0.02f, 0.12f)); var edgeZ = MeshGen.Box(new Vector3(0.12f, 0.02f, block - 6f));
                    Piece(root, "Edge", edgeX, white, new Vector3(cx, 0.011f, cz + block / 2f + 0.5f));
                    Piece(root, "Edge", edgeX, white, new Vector3(cx, 0.011f, cz - block / 2f - 0.5f));
                    Piece(root, "Edge", edgeZ, white, new Vector3(cx + block / 2f + 0.5f, 0.011f, cz));
                    Piece(root, "Edge", edgeZ, white, new Vector3(cx - block / 2f - 0.5f, 0.011f, cz));
                    var zebra = MeshGen.Box(new Vector3(3.5f, 0.02f, 0.55f));
                    for (int k = 0; k < 8; k++) Piece(root, "Zebra", zebra, white, new Vector3(cx - block / 2f - road / 2f, 0.013f, cz - block / 2f + 2f + k * 1.1f));
                    // A park every so often, otherwise buildings around the block edge.
                    if (rnd.NextDouble() < 0.12)
                    {
                        Piece(root, "ParkLawn", MeshGen.Box(new Vector3(block - 6f, 0.05f, block - 6f)), grass, new Vector3(cx, 0.17f, cz));
                        for (int k = 0; k < 14; k++) Tree(root, new Vector3(cx + (float)(rnd.NextDouble() - 0.5) * block * 0.8f, 0.15f, cz + (float)(rnd.NextDouble() - 0.5) * block * 0.8f), rnd);
                        continue;
                    }
                    int per = 3;
                    float lot = (block - 8f) / per;
                    for (int side = 0; side < 4; side++)
                        for (int k = 0; k < per; k++)
                        {
                            float along = -block / 2f + 4f + lot * (k + 0.5f);
                            float depth = 16f + (float)rnd.NextDouble() * 8f;
                            bool tower = rnd.NextDouble() < 0.22;
                            float h = tower ? 42f + (float)rnd.NextDouble() * 40f : 10.5f + 3.5f * rnd.Next(0, 6);
                            float inset = block / 2f - 3.5f - depth / 2f;
                            Vector3 p, size, front;
                            if (side == 0) { p = new Vector3(cx + along, 0, cz + inset); size = new Vector3(lot - 0.6f, h, depth); front = Vector3.forward; }
                            else if (side == 1) { p = new Vector3(cx + along, 0, cz - inset); size = new Vector3(lot - 0.6f, h, depth); front = Vector3.back; }
                            else if (side == 2) { p = new Vector3(cx + inset, 0, cz + along); size = new Vector3(depth, h, lot - 0.6f); front = Vector3.right; }
                            else { p = new Vector3(cx - inset, 0, cz + along); size = new Vector3(depth, h, lot - 0.6f); front = Vector3.left; }
                            Building(root, p, size, front, tower, rnd);
                        }
                    // Street trees and lamps along the kerb.
                    for (int k = 0; k < 4; k++)
                    {
                        float a = -block / 2f + 6f + k * (block - 12f) / 3f;
                        Tree(root, new Vector3(cx + a, 0.15f, cz - block / 2f + 1.6f), rnd);
                        Tree(root, new Vector3(cx - block / 2f + 1.6f, 0.15f, cz + a), rnd);
                    }
                    Lamp(root, new Vector3(cx + block / 2f - 1f, 0.15f, cz + block / 2f - 1f));
                    Lamp(root, new Vector3(cx - block / 2f + 1f, 0.15f, cz - block / 2f + 1f));
                }
            StaticBatchingUtility.Combine(root.gameObject);
            return root;
        }

        static readonly string[] Plaster = { "#e6dfd0", "#d8cdb6", "#c9b79c", "#e8e2d8", "#d4c4a8" };
        static readonly string[] Brick = { "#8e4a37", "#9c5a43", "#7d4334", "#a8644a" };
        static readonly string[] Concrete = { "#9ea2a6", "#b5b2aa", "#8c9096" };
        static readonly string[] GlassTint = { "#5d6b78", "#4c5a66", "#6d7a84" };

        void Building(Transform root, Vector3 p, Vector3 size, Vector3 front, bool tower, System.Random rnd)
        {
            ProcTex.FacadeStyle style;
            string col;
            if (tower) { style = rnd.NextDouble() < 0.6 ? ProcTex.FacadeStyle.Glass : ProcTex.FacadeStyle.Concrete; col = style == ProcTex.FacadeStyle.Glass ? GlassTint[rnd.Next(GlassTint.Length)] : Concrete[rnd.Next(Concrete.Length)]; }
            else
            {
                double r = rnd.NextDouble();
                style = r < 0.35 ? ProcTex.FacadeStyle.Brick : r < 0.85 ? ProcTex.FacadeStyle.Plaster : ProcTex.FacadeStyle.Concrete;
                col = style == ProcTex.FacadeStyle.Brick ? Brick[rnd.Next(Brick.Length)] : style == ProcTex.FacadeStyle.Plaster ? Plaster[rnd.Next(Plaster.Length)] : Concrete[rnd.Next(Concrete.Length)];
            }
            var wall = Mats.Hex(col);
            var mat = Mats.Pbr("facade" + style + col, ProcTex.Facade(style, wall), Color.white, 1f, 1f, new Vector2(1f / 3f, 1f / 3.5f));
            float baseY = 0.15f;
            Piece(root, "Building", MeshGen.Box(size), mat, new Vector3(p.x, baseY + size.y / 2f, p.z), true);
            // Parapet / roof slab and rooftop plant.
            Piece(root, "Roof", MeshGen.Box(new Vector3(size.x + 0.3f, 0.8f, size.z + 0.3f), 0.5f), roofM, new Vector3(p.x, baseY + size.y + 0.4f, p.z));
            int units = rnd.Next(0, 4);
            for (int u = 0; u < units; u++)
                Piece(root, "RoofUnit", MeshGen.Box(new Vector3(1.6f, 1.2f, 2.2f)), plant, new Vector3(p.x + ((float)rnd.NextDouble() - 0.5f) * size.x * 0.6f, baseY + size.y + 1.4f, p.z + ((float)rnd.NextDouble() - 0.5f) * size.z * 0.6f));
            if (tower) return;
            // Street level: a dark shopfront band with an awning on the street face.
            var right = Vector3.Cross(Vector3.up, front);
            float faceW = Mathf.Abs(Vector3.Dot(size, right)), halfD = Mathf.Abs(Vector3.Dot(size, front)) / 2f;
            var facePos = p + front * (halfD + 0.02f);
            var shop = MeshGen.Box(new Vector3(Mathf.Abs(right.x) * (faceW - 1f) + 0.04f * Mathf.Abs(front.x), 3.0f, Mathf.Abs(right.z) * (faceW - 1f) + 0.04f * Mathf.Abs(front.z)));
            Piece(root, "Shopfront", shop, shopGlass, new Vector3(facePos.x, baseY + 1.6f, facePos.z));
            if (rnd.NextDouble() < 0.6)
            {
                string[] aw = { "#2f5f4a", "#7a2f2f", "#2f3f6a", "#c9a43a", "#3a3a3a" };
                var awn = MeshGen.Box(new Vector3(Mathf.Abs(right.x) * (faceW - 2f) + 1.2f * Mathf.Abs(front.x), 0.12f, Mathf.Abs(right.z) * (faceW - 2f) + 1.2f * Mathf.Abs(front.z)));
                var ap = p + front * (halfD + 0.6f);
                Piece(root, "Awning", awn, Mats.Get(Mats.Hex(aw[rnd.Next(aw.Length)]), 0.2f), new Vector3(ap.x, baseY + 3.3f, ap.z));
            }
        }

        // --- Trees: a tapered trunk with branches and a crown of alpha-tested leaf cards -------
        static Mesh TrunkMesh(int seed)
        {
            var rnd = new System.Random(seed);
            var parts = new List<CombineInstance>
            {
                new CombineInstance { mesh = MeshGen.Tube(new[] { Vector3.zero, new Vector3(0.05f, 1.8f, 0f), new Vector3(-0.04f, 3.4f, 0.05f) }, 0.17f, 12, 9, 0.08f), transform = Matrix4x4.identity },
            };
            for (int b = 0; b < 4; b++)
            {
                float a = b / 4f * Mathf.PI * 2f + (float)rnd.NextDouble();
                var from = new Vector3(0, 2.4f + b * 0.25f, 0);
                var to = from + new Vector3(Mathf.Cos(a) * 1.3f, 0.9f, Mathf.Sin(a) * 1.3f);
                parts.Add(new CombineInstance { mesh = MeshGen.Tube(new[] { from, Vector3.Lerp(from, to, 0.5f) + Vector3.up * 0.15f, to }, 0.07f, 6, 6, 0.025f), transform = Matrix4x4.identity });
            }
            return MeshGen.Combine(parts);
        }

        static Mesh CrownMesh(int seed)
        {
            var rnd = new System.Random(seed);
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            var centre = new Vector3(0, 4.3f, 0);
            for (int c = 0; c < 9; c++)
            {
                float a = (float)rnd.NextDouble() * Mathf.PI * 2f, r = (float)rnd.NextDouble() * 1.4f;
                var clump = centre + new Vector3(Mathf.Cos(a) * r, ((float)rnd.NextDouble() - 0.4f) * 1.6f, Mathf.Sin(a) * r);
                float cr = 0.9f + (float)rnd.NextDouble() * 0.5f;
                for (int k = 0; k < 9; k++)
                {
                    var d = new Vector3((float)rnd.NextDouble() * 2 - 1, (float)rnd.NextDouble() * 1.6f - 0.6f, (float)rnd.NextDouble() * 2 - 1).normalized;
                    var pc = clump + d * cr * (0.5f + (float)rnd.NextDouble() * 0.4f);
                    float size = cr * (1.3f + (float)rnd.NextDouble() * 0.6f);
                    var q = Quaternion.Euler((float)rnd.NextDouble() * 180f - 90f, Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg + ((float)rnd.NextDouble() - 0.5f) * 70f, (float)rnd.NextDouble() * 180f - 90f);
                    var nn = ((pc - centre).normalized + Vector3.up * 0.6f).normalized;
                    var corners = new[] { new Vector2(-0.5f, -0.5f), new Vector2(0.5f, -0.5f), new Vector2(0.5f, 0.5f), new Vector2(-0.5f, 0.5f) };
                    // Both faces (the leaf texture is alpha-tested; back faces are culled).
                    for (int face = 0; face < 2; face++)
                    {
                        int b0 = v.Count;
                        foreach (var cn in corners)
                        {
                            v.Add(pc + q * new Vector3(cn.x * size, cn.y * size, 0));
                            n.Add(nn);
                            uv.Add(new Vector2(cn.x + 0.5f, cn.y + 0.5f));
                        }
                        if (face == 0) { t.Add(b0); t.Add(b0 + 1); t.Add(b0 + 2); t.Add(b0); t.Add(b0 + 2); t.Add(b0 + 3); }
                        else { t.Add(b0); t.Add(b0 + 2); t.Add(b0 + 1); t.Add(b0); t.Add(b0 + 3); t.Add(b0 + 2); }
                    }
                }
            }
            var m = new Mesh();
            m.SetVertices(v); m.SetNormals(n); m.SetUVs(0, uv); m.SetTriangles(t, 0);
            m.RecalculateBounds();
            return m;
        }

        void Tree(Transform root, Vector3 p, System.Random rnd)
        {
            int k = rnd.Next(3);
            float s = 0.8f + (float)rnd.NextDouble() * 0.45f;
            var tr = new GameObject("Tree").transform;
            tr.SetParent(root, false);
            tr.localPosition = p;
            tr.localRotation = Quaternion.Euler(0, (float)rnd.NextDouble() * 360f, 0);
            tr.localScale = Vector3.one * s;
            Piece(tr, "Trunk", treeTrunks[k], trunk, Vector3.zero);
            Piece(tr, "Crown", treeCrowns[k], leaves[rnd.Next(leaves.Length)], Vector3.zero);
            // Trunk collider (you can hit a tree).
            var cap = tr.gameObject.AddComponent<CapsuleCollider>();
            cap.radius = 0.25f;
            cap.height = 3f;
            cap.center = new Vector3(0, 1.5f, 0);
        }

        void Lamp(Transform root, Vector3 p)
        {
            var pts = new[] { p, p + new Vector3(0, 6.8f, 0), p + new Vector3(-0.3f, 7.3f, -0.3f), p + new Vector3(-1.1f, 7.35f, -1.1f) };
            var post = Piece(root, "LampPost", MeshGen.Tube(pts, 0.08f, 24, 10, 0.05f), pole, Vector3.zero);
            var c = post.AddComponent<CapsuleCollider>();
            c.center = p + new Vector3(0, 3.4f, 0);
            c.radius = 0.12f;
            c.height = 6.8f;
            Piece(root, "LampHead", MeshGen.Box(new Vector3(0.55f, 0.14f, 0.3f)), lampHead, p + new Vector3(-1.15f, 7.28f, -1.15f));
        }
    }
}
