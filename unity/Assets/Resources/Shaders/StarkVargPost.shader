// Stark Varg post-processing for the built-in render pipeline (used by PostFx.cs):
// soft-knee bloom (mip-chain downsample / tent upsample), ACES filmic tonemap, colour
// grade (contrast, saturation, warm highlights / cool shadows) and a gentle vignette.
Shader "Hidden/StarkVarg/Post"
{
    Properties
    {
        _MainTex ("Source", 2D) = "black" {}
        _BloomTex ("Bloom", 2D) = "black" {}
    }
    CGINCLUDE
    #include "UnityCG.cginc"

    sampler2D _MainTex;
    float4 _MainTex_TexelSize;
    sampler2D _BloomTex;
    sampler2D _BaseTex;
    float _Threshold, _Knee, _BloomIntensity, _Exposure, _Contrast, _Saturation, _Vignette;

    half3 Box4(float2 uv, float d)
    {
        float4 o = _MainTex_TexelSize.xyxy * float4(-d, -d, d, d);
        half3 s = tex2D(_MainTex, uv + o.xy).rgb + tex2D(_MainTex, uv + o.zy).rgb
                + tex2D(_MainTex, uv + o.xw).rgb + tex2D(_MainTex, uv + o.zw).rgb;
        return s * 0.25h;
    }

    half4 FragPrefilter(v2f_img i) : SV_Target
    {
        half3 c = Box4(i.uv, 1.0);
        c = min(c, 32.0h); // tame single-pixel fireflies (sun glints)
        half br = max(c.r, max(c.g, c.b));
        half soft = clamp(br - _Threshold + _Knee, 0.0h, 2.0h * _Knee);
        soft = soft * soft / (4.0h * _Knee + 1e-4h);
        half contrib = max(soft, br - _Threshold) / max(br, 1e-4h);
        return half4(c * contrib, 1);
    }

    half4 FragDown(v2f_img i) : SV_Target { return half4(Box4(i.uv, 1.0), 1); }
    half4 FragUp(v2f_img i) : SV_Target { return half4(Box4(i.uv, 0.5) + tex2D(_BaseTex, i.uv).rgb, 1); }

    // Krzysztof Narkowicz's fitted ACES curve.
    half3 Aces(half3 x)
    {
        return saturate((x * (2.51h * x + 0.03h)) / (x * (2.43h * x + 0.59h) + 0.14h));
    }

    half4 FragComposite(v2f_img i) : SV_Target
    {
        half3 c = tex2D(_MainTex, i.uv).rgb;
        c += tex2D(_BloomTex, i.uv).rgb * _BloomIntensity;
        c *= _Exposure;
        #if !defined(UNITY_COLORSPACE_GAMMA)
        half3 lin = c;
        #else
        half3 lin = GammaToLinearSpace(c);
        #endif
        lin = Aces(lin);
        // Grade in a perceptual-ish space.
        half3 g = sqrt(lin);
        half luma = dot(g, half3(0.2126h, 0.7152h, 0.0722h));
        g = lerp(luma.xxx, g, _Saturation);
        g = (g - 0.5h) * _Contrast + 0.5h;
        // Split tone: a touch of warmth in the highlights, cool in the shadows.
        g += (luma - 0.5h) * half3(0.025h, 0.006h, -0.03h);
        // Vignette.
        float2 d = (i.uv - 0.5) * float2(_MainTex_TexelSize.y * _MainTex_TexelSize.z, 1.0);
        g *= 1.0h - _Vignette * smoothstep(0.35h, 1.05h, length(d) * 1.35h);
        lin = saturate(g) * saturate(g);
        #if defined(UNITY_COLORSPACE_GAMMA)
        lin = LinearToGammaSpace(lin);
        #endif
        return half4(lin, 1);
    }
    ENDCG

    SubShader
    {
        Cull Off ZWrite Off ZTest Always
        // 0: bright-pass prefilter (to half resolution)
        Pass { CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment FragPrefilter
            ENDCG }
        // 1: downsample
        Pass { CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment FragDown
            ENDCG }
        // 2: upsample, added onto the larger mip (_BaseTex)
        Pass { CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment FragUp
            ENDCG }
        // 3: composite + tonemap + grade
        Pass { CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment FragComposite
            ENDCG }
    }
    Fallback Off
}
