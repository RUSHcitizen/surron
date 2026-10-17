using System.Collections.Generic;
using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Material factory. Materials are cloned from Resources/BaseLit (Standard shader) so the
    /// shader is always included in player builds; under URP it falls back to URP/Lit.
    /// </summary>
    public static class Mats
    {
        static Material baseMat;
        static readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();

        static Material Base()
        {
            if (baseMat != null) return baseMat;
            var urp = Shader.Find("Universal Render Pipeline/Lit");
            bool usingUrp = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null && urp != null;
            if (usingUrp) baseMat = new Material(urp);
            else
            {
                baseMat = Resources.Load<Material>("BaseLit");
                if (baseMat == null) baseMat = new Material(Shader.Find("Standard"));
            }
            return baseMat;
        }

        /// <summary>A lit material: colour, smoothness (0 matte .. 1 mirror), metallic.</summary>
        public static Material Get(Color color, float smoothness = 0.35f, float metallic = 0f, Color? emission = null)
        {
            string key = ColorUtility.ToHtmlStringRGBA(color) + smoothness.ToString("F2") + metallic.ToString("F2") + (emission.HasValue ? ColorUtility.ToHtmlStringRGB(emission.Value) : "");
            if (cache.TryGetValue(key, out var m)) return m;
            m = new Material(Base());
            m.enableInstancing = true;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
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

        public static Color Hex(string hex)
        {
            return ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;
        }
    }
}
