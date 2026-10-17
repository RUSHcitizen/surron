using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Procedural city: a grid of asphalt streets with lane markings, raised sidewalks, buildings
    /// of varied height and colour, street trees and lamps, ringed by open grass. Static parts are
    /// batched. Also returns the street centre lines for traffic.
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

        public Transform Build(Transform parent)
        {
            var root = new GameObject("City").transform;
            root.SetParent(parent, false);
            var rnd = new System.Random(seed);
            var asphalt = Mats.Get(Mats.Hex("#3d4044"), 0.25f);
            var grass = Mats.Get(Mats.Hex("#4f7a34"), 0.05f);
            var kerb = Mats.Get(Mats.Hex("#a9a8a2"), 0.1f);
            var line = Mats.Get(Mats.Hex("#e8c547"), 0.3f);
            var white = Mats.Get(Mats.Hex("#eeeeea"), 0.3f);
            var trunk = Mats.Get(Mats.Hex("#4a3628"), 0.05f);
            var leaf = Mats.Get(Mats.Hex("#4e7f2e"), 0.1f);
            var pole = Mats.Get(Mats.Hex("#2a2d33"), 0.5f, 0.6f);
            var facade = new[] { "#c9b79c", "#d8d2c4", "#9c5a43", "#b9c4cc", "#e6dfd0", "#7d8a96", "#c2a07a" };

            // Ground: grass everywhere, asphalt over the city.
            Shapes.Prim(PrimitiveType.Cube, root, new Vector3(0, -0.5f, 0), new Vector3(4000, 1, 4000), grass, true);
            float span = blocks * Pitch + road;
            Shapes.Prim(PrimitiveType.Cube, root, new Vector3(0, -0.49f, 0), new Vector3(span, 1, span), asphalt, true);

            float start = -Half;
            for (int i = 0; i <= blocks; i++) streets.Add(start + i * Pitch);

            // Lane markings (dashed centre line) on every street.
            foreach (float s in streets)
            {
                for (float t = -Half; t < Half; t += 6f)
                {
                    Shapes.Prim(PrimitiveType.Cube, root, new Vector3(s, 0.012f, t), new Vector3(0.18f, 0.02f, 3f), line);
                    Shapes.Prim(PrimitiveType.Cube, root, new Vector3(t, 0.012f, s), new Vector3(3f, 0.02f, 0.18f), line);
                }
            }

            for (int bx = 0; bx < blocks; bx++)
            for (int bz = 0; bz < blocks; bz++)
            {
                float cx = start + bx * Pitch + Pitch / 2f, cz = start + bz * Pitch + Pitch / 2f;
                // Raised sidewalk slab (kerb height 15 cm) with a collider so you can hop it.
                Shapes.Prim(PrimitiveType.Cube, root, new Vector3(cx, 0.075f, cz), new Vector3(block, 0.15f, block), kerb, true);
                // Zebra crossings at the block's corner.
                for (int k = 0; k < 6; k++)
                    Shapes.Prim(PrimitiveType.Cube, root, new Vector3(cx - block / 2f - road / 2f, 0.013f, cz - block / 2f + 2f + k * 1.2f), new Vector3(3.5f, 0.02f, 0.6f), white);
                // A park every so often, otherwise buildings around the block edge.
                if (rnd.NextDouble() < 0.12)
                {
                    for (int k = 0; k < 10; k++) Tree(root, new Vector3(cx + (float)(rnd.NextDouble() - 0.5) * block * 0.8f, 0.15f, cz + (float)(rnd.NextDouble() - 0.5) * block * 0.8f), trunk, leaf, rnd);
                    continue;
                }
                int per = 3;
                float lot = (block - 8f) / per;
                for (int side = 0; side < 4; side++)
                for (int k = 0; k < per; k++)
                {
                    float along = -block / 2f + 4f + lot * (k + 0.5f);
                    float depth = 16f + (float)rnd.NextDouble() * 8f;
                    float h = 10f + (float)rnd.NextDouble() * (rnd.NextDouble() < 0.25 ? 60f : 22f);
                    float inset = block / 2f - 3.5f - depth / 2f;
                    Vector3 p; Vector3 size;
                    if (side == 0) { p = new Vector3(cx + along, h / 2f + 0.15f, cz + inset); size = new Vector3(lot - 0.6f, h, depth); }
                    else if (side == 1) { p = new Vector3(cx + along, h / 2f + 0.15f, cz - inset); size = new Vector3(lot - 0.6f, h, depth); }
                    else if (side == 2) { p = new Vector3(cx + inset, h / 2f + 0.15f, cz + along); size = new Vector3(depth, h, lot - 0.6f); }
                    else { p = new Vector3(cx - inset, h / 2f + 0.15f, cz + along); size = new Vector3(depth, h, lot - 0.6f); }
                    var mat = Mats.Get(Mats.Hex(facade[rnd.Next(facade.Length)]), h > 40f ? 0.85f : 0.1f, h > 40f ? 0.4f : 0f);
                    Building(root, p, size, mat, rnd);
                }
                // Street trees and lamps along the kerb.
                for (int k = 0; k < 4; k++)
                {
                    float a = -block / 2f + 6f + k * (block - 12f) / 3f;
                    Tree(root, new Vector3(cx + a, 0.15f, cz - block / 2f + 1.6f), trunk, leaf, rnd);
                    Tree(root, new Vector3(cx - block / 2f + 1.6f, 0.15f, cz + a), trunk, leaf, rnd);
                }
                Lamp(root, new Vector3(cx + block / 2f - 1f, 0.15f, cz + block / 2f - 1f), pole);
            }
            StaticBatchingUtility.Combine(root.gameObject);
            return root;
        }

        void Building(Transform root, Vector3 p, Vector3 size, Material mat, System.Random rnd)
        {
            var b = Shapes.Prim(PrimitiveType.Cube, root, p, size, mat, true);
            b.name = "Building";
            // Window bands: dark glass strips per floor on the street faces (cheap facade detail).
            var glass = Mats.Get(Mats.Hex("#26303a"), 0.92f, 0.6f);
            int floors = Mathf.FloorToInt((size.y - 1f) / 3.4f);
            for (int f = 1; f < floors; f++)
            {
                float y = p.y - size.y / 2f + f * 3.4f + 0.9f;
                Shapes.Prim(PrimitiveType.Cube, root, new Vector3(p.x, y, p.z), new Vector3(size.x + 0.04f, 1.5f, size.z + 0.04f), glass);
            }
            // Roof parapet.
            Shapes.Prim(PrimitiveType.Cube, root, new Vector3(p.x, p.y + size.y / 2f + 0.3f, p.z), new Vector3(size.x, 0.6f, size.z) * 1.0f, Mats.Get(Mats.Hex("#6b6d70"), 0.1f));
        }

        void Tree(Transform root, Vector3 p, Material trunk, Material leaf, System.Random rnd)
        {
            float s = 0.8f + (float)rnd.NextDouble() * 0.5f;
            Shapes.Prim(PrimitiveType.Cylinder, root, p + new Vector3(0, 1.6f * s, 0), new Vector3(0.28f * s, 1.6f * s, 0.28f * s), trunk);
            for (int k = 0; k < 5; k++)
            {
                var o = new Vector3((float)(rnd.NextDouble() - 0.5) * 2.2f, 3.6f + (float)rnd.NextDouble() * 1.6f, (float)(rnd.NextDouble() - 0.5) * 2.2f) * s;
                Shapes.Prim(PrimitiveType.Sphere, root, p + o, Vector3.one * (1.8f + (float)rnd.NextDouble() * 0.8f) * s, leaf);
            }
            // Trunk collider (you can hit a tree).
            var col = new GameObject("TreeCollider");
            col.transform.SetParent(root, false);
            col.transform.position = p + new Vector3(0, 1.5f, 0);
            var cap = col.AddComponent<CapsuleCollider>();
            cap.radius = 0.25f * s;
            cap.height = 3f;
        }

        void Lamp(Transform root, Vector3 p, Material pole)
        {
            Shapes.Prim(PrimitiveType.Cylinder, root, p + new Vector3(0, 3.5f, 0), new Vector3(0.14f, 3.5f, 0.14f), pole, true);
            Shapes.Prim(PrimitiveType.Cube, root, p + new Vector3(-0.8f, 7f, -0.8f), new Vector3(0.5f, 0.15f, 0.5f), Mats.Get(Color.white, 0.5f, 0f, new Color(1f, 0.92f, 0.75f) * 0.5f));
        }
    }
}
