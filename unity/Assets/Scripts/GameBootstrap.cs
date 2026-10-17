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

            // --- Light: high warm sun, soft shadows, haze ---
            // (Explicit null checks: `??` bypasses Unity's fake-null for missing objects/components.)
            var sunGo = GameObject.Find("Directional Light");
            if (sunGo == null) sunGo = new GameObject("Sun");
            var sun = sunGo.GetComponent<Light>();
            if (sun == null) sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.95f, 0.86f);
            sun.intensity = 1.35f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.85f;
            sunGo.transform.rotation = Quaternion.Euler(55f, -35f, 0f);
            RenderSettings.sun = sun;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.75f, 0.83f, 0.9f);
            RenderSettings.fogStartDistance = 120f;
            RenderSettings.fogEndDistance = 520f;
            QualitySettings.shadowDistance = 140f;

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
            cam.transform.position = bikeGo.transform.position + new Vector3(0, 2f, -5f);
            var chase = cam.gameObject.GetComponent<ChaseCamera>();
            if (chase == null) chase = cam.gameObject.AddComponent<ChaseCamera>();
            chase.bike = bike;
            var hud = bikeGo.AddComponent<Hud>();
            hud.bike = bike;
            hud.input = input;
        }
    }
}
