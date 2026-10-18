using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Material factory. Built-in pipeline: materials are cloned from the Resources/BaseLit*
    /// materials (Standard shader, with the keyword variants we use) so the shader and those
    /// variants are included in player builds. Under URP they use URP/Lit with the same inputs.
    /// </summary>
    public static class Mats
    {
        static readonly Dictionary<string, Material> baseMats = new Dictionary<string, Material>();
        static readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();
        static bool? urp;

        public static bool Urp
        {
            get
            {
                if (!urp.HasValue) urp = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null && Shader.Find("Universal Render Pipeline/Lit") != null;
                return urp.Value;
            }
        }

        static Material Base(string variant)
        {
            if (baseMats.TryGetValue(variant, out var b) && b != null) return b;
            if (Urp) b = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            else
            {
                b = Resources.Load<Material>(variant) ?? Resources.Load<Material>("BaseLit");
                if (b == null) b = new Material(Shader.Find("Standard"));
            }
            baseMats[variant] = b;
            return b;
        }

        static void SetColor(Material m, Color color)
        {
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
        }

        /// <summary>A plain lit material: colour, smoothness (0 matte .. 1 mirror), metallic, optional glow.</summary>
        public static Material Get(Color color, float smoothness = 0.35f, float metallic = 0f, Color? emission = null)
        {
            string key = ColorUtility.ToHtmlStringRGBA(color) + smoothness.ToString("F2") + metallic.ToString("F2") + (emission.HasValue ? ColorUtility.ToHtmlStringRGB(emission.Value) : "");
            if (cache.TryGetValue(key, out var m)) return m;
            m = new Material(Base(emission.HasValue ? "BaseLit_Emissive" : "BaseLit")) { enableInstancing = true };
            SetColor(m, color);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            if (emission.HasValue)
            {
                m.EnableKeyword("_EMISSION");
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
                if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", emission.Value);
            }
            cache[key] = m;
            return m;
        }

        /// <summary>
        /// A textured PBR material: albedo × tint, normal map, metallic (R) / smoothness (A) map.
        /// Smoothness from the map is scaled by <paramref name="smoothScale"/>.
        /// </summary>
        public static Material Pbr(string key, ProcTex.Set set, Color tint, float smoothScale = 1f, float normalScale = 1f, Vector2? tiling = null)
        {
            if (cache.TryGetValue("pbr" + key, out var m)) return m;
            m = new Material(Base("BaseLit_Tex")) { enableInstancing = true, name = key };
            SetColor(m, tint);
            var tile = tiling ?? Vector2.one;
            if (set.albedo != null) SetTex(m, Urp ? "_BaseMap" : "_MainTex", set.albedo, tile);
            if (set.normal != null)
            {
                SetTex(m, "_BumpMap", set.normal, tile);
                m.SetFloat("_BumpScale", normalScale);
                m.EnableKeyword("_NORMALMAP");
            }
            if (set.metalSmooth != null)
            {
                SetTex(m, "_MetallicGlossMap", set.metalSmooth, tile);
                m.EnableKeyword(Urp ? "_METALLICSPECGLOSSMAP" : "_METALLICGLOSSMAP");
                if (m.HasProperty("_GlossMapScale")) m.SetFloat("_GlossMapScale", smoothScale);
                if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothScale);
                if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 1f);
            }
            cache["pbr" + key] = m;
            return m;
        }

        /// <summary>A plain colour with only a detail normal map (fabric, plastic grain).</summary>
        public static Material Normal(string key, Color color, Texture2D normal, float smoothness, float metallic, float normalScale, Vector2 tiling)
        {
            if (cache.TryGetValue("nrm" + key, out var m)) return m;
            m = new Material(Base("BaseLit_Normal")) { enableInstancing = true, name = key };
            SetColor(m, color);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            SetTex(m, "_BumpMap", normal, tiling);
            m.SetFloat("_BumpScale", normalScale);
            m.EnableKeyword("_NORMALMAP");
            cache["nrm" + key] = m;
            return m;
        }

        /// <summary>Alpha-tested foliage (leaf cards): double-sided look comes from crossed cards.</summary>
        public static Material Cutout(string key, Texture2D tex, Color tint)
        {
            if (cache.TryGetValue("cut" + key, out var m)) return m;
            m = new Material(Base("BaseLit_Cutout")) { enableInstancing = true, name = key };
            SetColor(m, tint);
            SetTex(m, Urp ? "_BaseMap" : "_MainTex", tex, Vector2.one);
            m.SetFloat("_Cutoff", 0.5f);
            if (Urp) { m.SetFloat("_AlphaClip", 1f); m.SetFloat("_Cull", 0f); }
            else { m.SetFloat("_Mode", 1f); m.SetOverrideTag("RenderType", "TransparentCutout"); }
            m.EnableKeyword("_ALPHATEST_ON");
            m.renderQueue = 2450;
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", 0.2f);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.2f);
            cache["cut" + key] = m;
            return m;
        }

        static void SetTex(Material m, string prop, Texture tex, Vector2 tiling)
        {
            if (!m.HasProperty(prop)) return;
            m.SetTexture(prop, tex);
            m.SetTextureScale(prop, tiling);
        }

        public static Color Hex(string hex)
        {
            return ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;
        }
    }
}
