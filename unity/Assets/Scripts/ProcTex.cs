using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Procedural PBR textures, generated at startup (nothing to download or import):
    /// albedo, normal maps (from a height field) and metallic/smoothness maps for asphalt,
    /// concrete slabs, building façades with recessed windows, grass, tyre tread, leaves and
    /// fabric. Cached; all tile seamlessly.
    /// </summary>
    public static class ProcTex
    {
        public struct Set
        {
            public Texture2D albedo, normal, metalSmooth;
        }

        static readonly Dictionary<string, Set> cache = new Dictionary<string, Set>();

        // --- Noise (tileable value noise + fbm) ------------------------------------------------
        static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                int h = x * 374761393 + y * 668265263 + seed * 2147483647;
                h = (h ^ (h >> 13)) * 1274126177;
                return ((h ^ (h >> 16)) & 0xffff) / 65535f;
            }
        }

        /// <summary>Tileable value noise with period p (cells).</summary>
        public static float Noise(float x, float y, int p, int seed)
        {
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float fx = x - xi, fy = y - yi;
            float u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
            int x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
            float a = Hash(x0, y0, seed), b = Hash(x1, y0, seed), c = Hash(x0, y1, seed), d = Hash(x1, y1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(c, d, u), v);
        }

        /// <summary>Fractal noise over [0,1)² that tiles, base period p.</summary>
        public static float Fbm(float u, float v, int p, int octaves, int seed)
        {
            float sum = 0, amp = 0.5f, norm = 0;
            for (int o = 0; o < octaves; o++)
            {
                int per = p << o;
                sum += Noise(u * per, v * per, per, seed + o * 17) * amp;
                norm += amp;
                amp *= 0.5f;
            }
            return sum / norm;
        }

        static Texture2D NewTex(int size, bool linear, string name)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, true, linear) { name = name, wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8 };
            return t;
        }

        /// <summary>Normal map from a tileable height field (strength = slope scale).</summary>
        static Texture2D NormalFromHeight(float[] h, int size, float strength, string name)
        {
            var tex = NewTex(size, true, name + "_N");
            var px = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float l = h[y * size + (x - 1 + size) % size], r = h[y * size + (x + 1) % size];
                    float d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
                    var n = new Vector3((l - r) * strength, (d - u) * strength, 1f).normalized;
                    px[y * size + x] = new Color32((byte)((n.x * 0.5f + 0.5f) * 255), (byte)((n.y * 0.5f + 0.5f) * 255), (byte)((n.z * 0.5f + 0.5f) * 255), 255);
                }
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }

        static Texture2D FromColors(Color[] c, int size, bool linear, string name)
        {
            var tex = NewTex(size, linear, name);
            tex.SetPixels(c);
            tex.Apply(true);
            return tex;
        }

        // --- Surfaces ------------------------------------------------------------------------
        /// <summary>Worn city asphalt: aggregate, darker tyre-polished patches, sealed cracks. 1 tile = 4 m.</summary>
        public static Set Asphalt()
        {
            if (cache.TryGetValue("asphalt", out var s)) return s;
            const int N = 512;
            var h = new float[N * N]; var c = new Color[N * N]; var ms = new Color[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    float big = Fbm(u, v, 4, 3, 1);
                    float grit = Noise(u * 256, v * 256, 256, 7);
                    float crack = 1f - Mathf.Abs(Fbm(u, v, 3, 4, 9) * 2f - 1f);
                    float sealed_ = Mathf.SmoothStep(0.93f, 0.98f, crack) * Mathf.SmoothStep(0.55f, 0.7f, Fbm(u, v, 2, 2, 31));
                    float tone = 0.22f + big * 0.09f + (grit - 0.5f) * 0.08f - sealed_ * 0.09f;
                    c[y * N + x] = new Color(tone, tone, tone * 1.02f, 1);
                    h[y * N + x] = grit * 0.6f + big * 0.4f - sealed_ * 0.3f;
                    float sm = 0.18f + (1f - big) * 0.1f + sealed_ * 0.25f;
                    ms[y * N + x] = new Color(0, 0, 0, sm);
                }
            s = new Set { albedo = FromColors(c, N, false, "Asphalt"), normal = NormalFromHeight(h, N, 2.2f, "Asphalt"), metalSmooth = FromColors(ms, N, true, "Asphalt_MS") };
            cache["asphalt"] = s;
            return s;
        }

        /// <summary>Concrete pavement slabs with joints. 1 tile = 2 m (four 1 m slabs).</summary>
        public static Set Concrete()
        {
            if (cache.TryGetValue("concrete", out var s)) return s;
            const int N = 512;
            var h = new float[N * N]; var c = new Color[N * N]; var ms = new Color[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    float fu = (u * 2f) % 1f, fv = (v * 2f) % 1f;
                    float jd = Mathf.Min(Mathf.Min(fu, 1 - fu), Mathf.Min(fv, 1 - fv));
                    float joint = 1f - Mathf.SmoothStep(0.004f, 0.012f, jd);
                    int slab = (int)(u * 2) + (int)(v * 2) * 2;
                    float slabTone = Hash(slab, 3, 5) * 0.06f;
                    float grit = Noise(u * 200, v * 200, 200, 3);
                    float stain = Fbm(u, v, 3, 3, 11);
                    float tone = 0.6f + slabTone + (grit - 0.5f) * 0.05f - stain * 0.1f - joint * 0.25f;
                    c[y * N + x] = new Color(tone, tone * 0.99f, tone * 0.96f, 1);
                    h[y * N + x] = 1f - joint * 1.5f + grit * 0.15f;
                    ms[y * N + x] = new Color(0, 0, 0, 0.12f + stain * 0.08f);
                }
            s = new Set { albedo = FromColors(c, N, false, "Concrete"), normal = NormalFromHeight(h, N, 3f, "Concrete"), metalSmooth = FromColors(ms, N, true, "Concrete_MS") };
            cache["concrete"] = s;
            return s;
        }

        /// <summary>Lawn grass. 1 tile = 3 m.</summary>
        public static Set Grass()
        {
            if (cache.TryGetValue("grass", out var s)) return s;
            const int N = 256;
            var h = new float[N * N]; var c = new Color[N * N]; var ms = new Color[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    float blades = Noise(u * 128, v * 32, 128, 5) * 0.5f + Noise(u * 64, v * 128, 64, 6) * 0.5f;
                    float patch = Fbm(u, v, 3, 3, 21);
                    var col = Color.Lerp(new Color(0.18f, 0.3f, 0.09f), new Color(0.36f, 0.48f, 0.18f), blades * 0.7f + patch * 0.3f);
                    col = Color.Lerp(col, new Color(0.45f, 0.44f, 0.22f), Mathf.SmoothStep(0.62f, 0.8f, patch) * 0.5f);
                    c[y * N + x] = col;
                    h[y * N + x] = blades;
                    ms[y * N + x] = new Color(0, 0, 0, 0.08f);
                }
            s = new Set { albedo = FromColors(c, N, false, "Grass"), normal = NormalFromHeight(h, N, 2.5f, "Grass"), metalSmooth = FromColors(ms, N, true, "Grass_MS") };
            cache["grass"] = s;
            return s;
        }

        public enum FacadeStyle { Brick, Plaster, Concrete, Glass }

        /// <summary>
        /// One window bay of a façade (3 m wide × 3.5 m floor): wall material around a recessed,
        /// framed window with a sill. The glass is smooth and slightly metallic so it reflects
        /// the sky; the wall is matte. Tile it with UVs of 1/3 per metre across, 1/3.5 up.
        /// </summary>
        public static Set Facade(FacadeStyle style, Color wall)
        {
            string key = "facade" + style + ColorUtility.ToHtmlStringRGB(wall);
            if (cache.TryGetValue(key, out var s)) return s;
            const int N = 256;
            var h = new float[N * N]; var c = new Color[N * N]; var ms = new Color[N * N];
            bool glassWall = style == FacadeStyle.Glass;
            // Window rectangle (in bay units).
            float wx0 = glassWall ? 0.03f : 0.22f, wx1 = glassWall ? 0.97f : 0.78f, wy0 = glassWall ? 0.06f : 0.28f, wy1 = glassWall ? 0.96f : 0.85f;
            int lit = (int)(Hash(style.GetHashCode(), 1, 2) * 10);
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    float hh = 1f, sm = 0.1f, met = 0f;
                    Color col = wall;
                    // Wall surface.
                    float grain = Noise(u * 96, v * 96, 96, 4);
                    if (style == FacadeStyle.Brick)
                    {
                        float bu = u * 12f, bv = v * 42f;
                        int row = Mathf.FloorToInt(bv);
                        float fu = (bu + (row % 2) * 0.5f) % 1f, fv = bv - row;
                        float mortar = (fu < 0.06f || fv < 0.12f) ? 1f : 0f;
                        float brickTone = Hash(Mathf.FloorToInt(bu + (row % 2) * 0.5f), row, 9) * 0.18f - 0.09f;
                        col = mortar > 0 ? new Color(0.62f, 0.6f, 0.56f) : new Color(wall.r + brickTone, wall.g + brickTone * 0.7f, wall.b + brickTone * 0.5f);
                        hh = mortar > 0 ? 0.6f : 1f + grain * 0.1f;
                    }
                    else if (style == FacadeStyle.Concrete)
                    {
                        // Precast panels with joints and form-tie dots.
                        float pj = Mathf.Min(Mathf.Abs(u - 0.0f), Mathf.Abs(u - 1f));
                        if (pj < 0.01f || v < 0.012f) { col *= 0.7f; hh = 0.7f; }
                        col *= 0.92f + grain * 0.12f;
                    }
                    else col *= 0.93f + grain * 0.1f;
                    // Grime streaks down from the windows.
                    float streak = Mathf.SmoothStep(0.55f, 0.9f, Noise(u * 40, v * 3, 40, 12)) * (v < wy0 ? 1f : 0.3f);
                    col *= 1f - streak * 0.12f;

                    bool inWin = u > wx0 && u < wx1 && v > wy0 && v < wy1;
                    float fw = 0.035f; // frame width (bay units)
                    bool inGlass = u > wx0 + fw && u < wx1 - fw && v > wy0 + fw && v < wy1 - fw;
                    if (inWin && !inGlass)
                    {
                        col = glassWall ? new Color(0.16f, 0.17f, 0.19f) : new Color(0.85f, 0.85f, 0.83f);
                        hh = 0.75f; sm = 0.45f; met = glassWall ? 0.6f : 0f;
                    }
                    else if (inGlass)
                    {
                        // Mullion in the middle; glass reflects (smooth, a little metallic); a few lit rooms.
                        bool mullion = Mathf.Abs(u - 0.5f) < 0.012f || (glassWall && Mathf.Abs(v - 0.5f) < 0.01f);
                        if (mullion) { col = glassWall ? new Color(0.16f, 0.17f, 0.19f) : new Color(0.85f, 0.85f, 0.83f); hh = 0.7f; sm = 0.45f; }
                        else
                        {
                            float sky = 0.12f + (v - wy0) / (wy1 - wy0) * 0.12f;
                            col = new Color(sky * 0.8f, sky * 0.95f, sky * 1.2f);
                            if (lit % 3 == 0 && !glassWall) col = Color.Lerp(col, new Color(0.45f, 0.38f, 0.28f), 0.4f);
                            hh = 0.5f; sm = 0.96f; met = 0.35f;
                        }
                    }
                    // Sill below the window.
                    if (!glassWall && u > wx0 - 0.03f && u < wx1 + 0.03f && v > wy0 - 0.045f && v <= wy0) { col = new Color(0.78f, 0.77f, 0.74f); hh = 1.25f; sm = 0.2f; }
                    c[y * N + x] = col;
                    h[y * N + x] = hh;
                    ms[y * N + x] = new Color(met, 0, 0, sm);
                }
            s = new Set { albedo = FromColors(c, N, false, key), normal = NormalFromHeight(h, N, 6f, key), metalSmooth = FromColors(ms, N, true, key + "_MS") };
            cache[key] = s;
            return s;
        }

        /// <summary>Knobbly motocross tread around the tyre (U = around, V = across).</summary>
        public static Set Tread()
        {
            if (cache.TryGetValue("tread", out var s)) return s;
            const int N = 128;
            var h = new float[N * N]; var c = new Color[N * N]; var ms = new Color[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    // Staggered blocks across the crown; sidewall (outer V) smooth.
                    float across = Mathf.Abs(v - 0.5f) * 2f; // 0 centre .. 1 edge of the section
                    int row = Mathf.FloorToInt(u * 2);
                    float bu = (u * 2f) % 1f, bv = (v * 5f + (row % 2) * 0.5f) % 1f;
                    float knob = across < 0.55f && bu > 0.15f && bu < 0.75f && bv > 0.15f && bv < 0.8f ? 1f : 0f;
                    float rubber = 0.06f + Noise(u * 64, v * 64, 64, 2) * 0.02f;
                    c[y * N + x] = new Color(rubber, rubber, rubber, 1);
                    h[y * N + x] = knob;
                    ms[y * N + x] = new Color(0, 0, 0, knob > 0 ? 0.32f : 0.22f);
                }
            s = new Set { albedo = FromColors(c, N, false, "Tread"), normal = NormalFromHeight(h, N, 4f, "Tread"), metalSmooth = FromColors(ms, N, true, "Tread_MS") };
            cache["tread"] = s;
            return s;
        }

        /// <summary>Fine fabric weave (normal only) for riding gear.</summary>
        public static Texture2D FabricNormal()
        {
            if (cache.TryGetValue("fabric", out var s)) return s.normal;
            const int N = 128;
            var h = new float[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float u = x / (float)N, v = y / (float)N;
                    float weave = Mathf.Sin(u * Mathf.PI * 2 * 32) * Mathf.Sin(v * Mathf.PI * 2 * 32) * 0.3f;
                    h[y * N + x] = weave + Fbm(u, v, 4, 3, 41) * 1.2f;
                }
            s = new Set { normal = NormalFromHeight(h, N, 1.6f, "Fabric") };
            cache["fabric"] = s;
            return s.normal;
        }

        /// <summary>Leaf cluster with alpha (for cutout tree crowns): many small leaves, ragged edge.</summary>
        public static Texture2D Leaves()
        {
            if (cache.TryGetValue("leaves", out var s)) return s.albedo;
            const int N = 256;
            var c = new Color[N * N];
            for (int i = 0; i < c.Length; i++) c[i] = new Color(0.2f, 0.3f, 0.12f, 0f);
            var rnd = new System.Random(911);
            for (int l = 0; l < 420; l++)
            {
                float r = Mathf.Sqrt((float)rnd.NextDouble()) * 118f, a = (float)rnd.NextDouble() * Mathf.PI * 2f;
                if (r > 70 && rnd.NextDouble() < (r - 70) / 60f) continue;
                float cx = N / 2f + Mathf.Cos(a) * r, cy = N / 2f + Mathf.Sin(a) * r;
                float len = 9f + (float)rnd.NextDouble() * 7f, wid = len * 0.42f;
                float ang = a + ((float)rnd.NextDouble() - 0.5f) * 1.6f;
                float ca = Mathf.Cos(ang), sa = Mathf.Sin(ang);
                float light = 0.55f + (float)rnd.NextDouble() * 0.45f;
                var col = new Color(0.32f * light, 0.5f * light, 0.16f * light, 1f);
                int x0 = Mathf.Max(0, (int)(cx - len)), x1 = Mathf.Min(N - 1, (int)(cx + len)), y0 = Mathf.Max(0, (int)(cy - len)), y1 = Mathf.Min(N - 1, (int)(cy + len));
                for (int y = y0; y <= y1; y++)
                    for (int x = x0; x <= x1; x++)
                    {
                        float dx = x - cx, dy = y - cy;
                        float lu = dx * ca + dy * sa, lv = -dx * sa + dy * ca;
                        // Leaf shape: pointed ellipse.
                        float t = lu / (len * 0.5f);
                        if (Mathf.Abs(t) > 1f) continue;
                        float half = wid * 0.5f * (1f - t * t);
                        if (Mathf.Abs(lv) > half) continue;
                        float shade = lv > 0 ? 0.85f : 1f; // midrib shading
                        c[y * N + x] = new Color(col.r * shade, col.g * shade, col.b * shade, 1f);
                    }
            }
            var tex = FromColors(c, N, false, "Leaves");
            tex.wrapMode = TextureWrapMode.Clamp;
            s = new Set { albedo = tex };
            cache["leaves"] = s;
            return tex;
        }
    }
}
