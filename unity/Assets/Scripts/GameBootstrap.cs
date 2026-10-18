using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Builds the whole game at runtime, so any scene (even an empty one) becomes playable:
    /// open the project, press Play. Skipped if the scene already contains a BikeController
    /// (so you can author your own scene with the same components).
    /// </summary>
    public static class GameBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
#pragma warning disable CS0618 // FindObjectOfType is fine here (runs once).
            if (Object.FindObjectOfType<BikeController>() != null) return;
#pragma warning restore 618

            // Phones: landscape only, 60 fps.
            Screen.autorotateToPortrait = false;
            Screen.autorotateToPortraitUpsideDown = false;
            Screen.autorotateToLandscapeLeft = true;
            Screen.autorotateToLandscapeRight = true;
            Screen.orientation = ScreenOrientation.AutoRotation;
            Application.targetFrameRate = 60;
            Physics.defaultSolverIterations = 10;

            var world = new GameObject("StarkVarg").transform;

            // --- Light: high warm sun, soft shadows, sky-lit ambient, haze ---
            // (Explicit null checks: `??` bypasses Unity's fake-null for missing objects/components.)
            var sunGo = GameObject.Find("Directional Light");
            if (sunGo == null) sunGo = new GameObject("Sun");
            var sun = sunGo.GetComponent<Light>();
            if (sun == null) sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.93f, 0.82f);
            sun.intensity = 1.45f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.9f;
            sun.shadowBias = 0.03f;
            sun.shadowNormalBias = 0.25f;
            sun.shadowResolution = UnityEngine.Rendering.LightShadowResolution.VeryHigh;
            sunGo.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
            RenderSettings.sun = sun;
            SetupSky();
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(0.72f, 0.8f, 0.88f);
            RenderSettings.fogDensity = 0.0026f;
            SetupQuality();

            // --- City and traffic ---
            var city = new CityGenerator();
            city.Build(world);
            int mid = city.streets.Count / 2;
            for (int i = 0; i < 28; i++)
            {
                var go = new GameObject("Car" + i);
                go.transform.SetParent(world, false);
                go.AddComponent<Rigidbody>();
                var car = go.AddComponent<TrafficCar>();
                float s = city.streets[(i * 3 + 1) % city.streets.Count];
                bool alongZ = i % 2 == 0;
                var heading = (i % 4 < 2) ? (alongZ ? Vector3.forward : Vector3.right) : (alongZ ? Vector3.back : Vector3.left);
                var right = new Vector3(heading.z, 0, -heading.x);
                float t = -city.Half + 20f + (i * 37f) % (city.Half * 2f - 40f);
                var start = alongZ ? new Vector3(s, 0, t) : new Vector3(t, 0, s);
                start += right * 3.5f;
                car.Init(city, start, heading, 1000 + i);
            }

            // --- Bike ---
            var bikeGo = new GameObject("Bike");
            bikeGo.transform.SetParent(world, false);
            bikeGo.transform.position = new Vector3(city.streets[mid] + 3.5f, 0.05f, -city.Half + 30f);
            bikeGo.AddComponent<Rigidbody>();
            var col = bikeGo.AddComponent<CapsuleCollider>();
            col.direction = 2; // along Z
            col.center = new Vector3(0, 0.42f, 0);
            col.radius = 0.4f;
            col.height = 1.9f;
            var input = bikeGo.AddComponent<BikeInput>();
            var bike = bikeGo.AddComponent<BikeController>();
            bike.input = input;
            var visGo = new GameObject("Visual");
            visGo.transform.SetParent(bikeGo.transform, false);
            var vis = visGo.AddComponent<BikeVisual>();
            vis.bike = bike;
            vis.Build();
            SetLayer(visGo.transform, EnvProbe.BikeLayer);
            EnvProbe.Create(world, bikeGo.transform);

            // --- Camera and HUD ---
            var cam = Camera.main;
            if (cam == null)
            {
                var cgo = new GameObject("Main Camera") { tag = "MainCamera" };
                cam = cgo.AddComponent<Camera>();
                cgo.AddComponent<AudioListener>();
            }
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 900f;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            cam.renderingPath = RenderingPath.Forward; // MSAA needs forward
            if (cam.GetComponent<PostFx>() == null) cam.gameObject.AddComponent<PostFx>();
            cam.transform.position = bikeGo.transform.position + new Vector3(0, 2f, -5f);
            var chase = cam.gameObject.GetComponent<ChaseCamera>();
            if (chase == null) chase = cam.gameObject.AddComponent<ChaseCamera>();
            chase.bike = bike;
            var hud = bikeGo.AddComponent<Hud>();
            hud.bike = bike;
            hud.input = input;
        }

        /// <summary>Procedural sky with a crisp sun disc; the ambient light and default reflections come from it.</summary>
        static void SetupSky()
        {
            Material sky = null;
            if (RenderSettings.skybox != null && RenderSettings.skybox.shader != null && RenderSettings.skybox.shader.name == "Skybox/Procedural")
                sky = new Material(RenderSettings.skybox);
            else
            {
                var sh = Shader.Find("Skybox/Procedural");
                if (sh != null) sky = new Material(sh);
            }
            if (sky != null)
            {
                if (sky.HasProperty("_SunDisk")) sky.SetFloat("_SunDisk", 2f); // high quality
                if (sky.HasProperty("_SunSize")) sky.SetFloat("_SunSize", 0.035f);
                if (sky.HasProperty("_SunSizeConvergence")) sky.SetFloat("_SunSizeConvergence", 6f);
                if (sky.HasProperty("_AtmosphereThickness")) sky.SetFloat("_AtmosphereThickness", 0.85f);
                if (sky.HasProperty("_SkyTint")) sky.SetColor("_SkyTint", new Color(0.46f, 0.52f, 0.6f));
                if (sky.HasProperty("_GroundColor")) sky.SetColor("_GroundColor", new Color(0.36f, 0.34f, 0.31f));
                if (sky.HasProperty("_Exposure")) sky.SetFloat("_Exposure", 1.2f);
                RenderSettings.skybox = sky;
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Skybox;
                RenderSettings.ambientIntensity = 1.0f;
            }
            else
            {
                // No sky shader in this build: a three-colour gradient ambient instead.
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = new Color(0.55f, 0.65f, 0.8f);
                RenderSettings.ambientEquatorColor = new Color(0.55f, 0.56f, 0.55f);
                RenderSettings.ambientGroundColor = new Color(0.28f, 0.25f, 0.22f);
            }
            RenderSettings.defaultReflectionMode = UnityEngine.Rendering.DefaultReflectionMode.Skybox;
            RenderSettings.reflectionIntensity = 1f;
            DynamicGI.UpdateEnvironment();
        }

        /// <summary>Shadows, anti-aliasing and texture filtering: high on desktop, tuned down for phones.</summary>
        static void SetupQuality()
        {
            bool mobile = Application.isMobilePlatform;
            QualitySettings.shadows = ShadowQuality.All;
            QualitySettings.shadowResolution = mobile ? ShadowResolution.High : ShadowResolution.VeryHigh;
            QualitySettings.shadowCascades = mobile ? 2 : 4;
            QualitySettings.shadowDistance = mobile ? 80f : 160f;
            QualitySettings.shadowProjection = ShadowProjection.StableFit;
            QualitySettings.antiAliasing = mobile ? 2 : 4;
            QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
            QualitySettings.pixelLightCount = 4;
            QualitySettings.softParticles = false;
            QualitySettings.lodBias = 2f;
        }

        static void SetLayer(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            for (int i = 0; i < t.childCount; i++) SetLayer(t.GetChild(i), layer);
        }
    }
}
