using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Camera post-processing for the built-in pipeline: bloom, ACES filmic tonemapping, a light
    /// colour grade and vignette (shader: Resources/Shaders/StarkVargPost). Under URP use a
    /// Volume instead (OnRenderImage is not called there); if the shader is missing or not
    /// supported the component switches itself off and the game renders without it.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public class PostFx : MonoBehaviour
    {
        public float threshold = 1.0f, knee = 0.5f, bloom = 1.0f; // bloom: total strength over the whole mip chain
        public float exposure = 1.0f, contrast = 1.06f, saturation = 1.06f, vignette = 0.28f;
        [Range(2, 7)] public int bloomMips = 6;

        Material mat;
        readonly RenderTexture[] mips = new RenderTexture[8], ups = new RenderTexture[8];

        static readonly int IdThreshold = Shader.PropertyToID("_Threshold"), IdKnee = Shader.PropertyToID("_Knee"),
            IdBloom = Shader.PropertyToID("_BloomIntensity"), IdExposure = Shader.PropertyToID("_Exposure"),
            IdContrast = Shader.PropertyToID("_Contrast"), IdSaturation = Shader.PropertyToID("_Saturation"),
            IdVignette = Shader.PropertyToID("_Vignette"), IdBloomTex = Shader.PropertyToID("_BloomTex"), IdBaseTex = Shader.PropertyToID("_BaseTex");

        void OnEnable()
        {
            var shader = Resources.Load<Shader>("Shaders/StarkVargPost");
            if (shader == null) shader = Shader.Find("Hidden/StarkVarg/Post");
            if (shader == null || !shader.isSupported || Mats.Urp) { enabled = false; return; }
            if (mat == null) mat = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };
            if (Application.isMobilePlatform) bloomMips = Mathf.Min(bloomMips, 5);
        }

        void OnDisable()
        {
            if (mat != null) Destroy(mat);
            mat = null;
        }

        void OnRenderImage(RenderTexture src, RenderTexture dst)
        {
            if (mat == null) { Graphics.Blit(src, dst); return; }
            bool hdr = src.format == RenderTextureFormat.ARGBHalf || src.format == RenderTextureFormat.DefaultHDR || src.format == RenderTextureFormat.ARGBFloat || src.format == RenderTextureFormat.RGB111110Float;
            mat.SetFloat(IdThreshold, hdr ? threshold : 0.82f);
            mat.SetFloat(IdKnee, knee);
            mat.SetFloat(IdExposure, exposure);
            mat.SetFloat(IdContrast, contrast);
            mat.SetFloat(IdSaturation, saturation);
            mat.SetFloat(IdVignette, vignette);

            var fmt = hdr ? src.format : RenderTextureFormat.Default;
            int w = src.width / 2, h = src.height / 2;
            int n = 0;
            for (; n < bloomMips && w >= 8 && h >= 8; n++, w /= 2, h /= 2)
            {
                mips[n] = RenderTexture.GetTemporary(w, h, 0, fmt);
                mips[n].filterMode = FilterMode.Bilinear;
                Graphics.Blit(n == 0 ? src : mips[n - 1], mips[n], mat, n == 0 ? 0 : 1);
            }
            // Walk back up, adding each blurred mip onto the next larger one.
            RenderTexture last = n > 0 ? mips[n - 1] : null;
            for (int i = n - 2; i >= 0; i--)
            {
                ups[i] = RenderTexture.GetTemporary(mips[i].width, mips[i].height, 0, fmt);
                ups[i].filterMode = FilterMode.Bilinear;
                mat.SetTexture(IdBaseTex, mips[i]);
                Graphics.Blit(last, ups[i], mat, 2);
                last = ups[i];
            }
            mat.SetFloat(IdBloom, bloom / Mathf.Max(1, n));
            mat.SetTexture(IdBloomTex, last != null ? (Texture)last : Texture2D.blackTexture);
            Graphics.Blit(src, dst, mat, 3);
            for (int i = 0; i < n; i++)
            {
                RenderTexture.ReleaseTemporary(mips[i]); mips[i] = null;
                if (ups[i] != null) { RenderTexture.ReleaseTemporary(ups[i]); ups[i] = null; }
            }
        }
    }
}
