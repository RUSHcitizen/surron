using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Bike + rider visuals. Leans about the tyre contact line, pitches about the rear axle for
    /// wheelies, steers the front end and spins the wheels.
    ///
    /// Drop-in models: put prefabs named "BikeModel" and/or "RiderModel" in a Resources folder
    /// (e.g. Assets/Resources/BikeModel.prefab). They are used instead of the placeholders.
    /// Bike prefab convention: origin on the ground under the middle of the wheelbase, facing
    /// +Z, ~1.48 m wheelbase. Optional child transforms named "FrontWheel", "RearWheel" and
    /// "Steering" are spun / turned if present.
    /// </summary>
    public class BikeVisual : MonoBehaviour
    {
        public BikeController bike;
        const float Wheelbase = 1.48f, RearR = 0.35f, FrontR = 0.37f;

        Transform lean, pitch, model, frontWheel, rearWheel, steering, riderRoot;
        float frontSpin, rearSpin;

        public void Build()
        {
            lean = new GameObject("Lean").transform;
            lean.SetParent(transform, false);
            pitch = new GameObject("PitchAboutRearAxle").transform;
            pitch.SetParent(lean, false);
            pitch.localPosition = new Vector3(0, 0, -Wheelbase / 2f);
            model = new GameObject("Model").transform;
            model.SetParent(pitch, false);
            model.localPosition = new Vector3(0, 0, Wheelbase / 2f);

            var bikePrefab = Resources.Load<GameObject>("BikeModel");
            if (bikePrefab != null)
            {
                var b = Instantiate(bikePrefab, model, false);
                frontWheel = FindDeep(b.transform, "FrontWheel");
                rearWheel = FindDeep(b.transform, "RearWheel");
                steering = FindDeep(b.transform, "Steering");
            }
            else BuildPlaceholderBike();

            var riderPrefab = Resources.Load<GameObject>("RiderModel");
            if (riderPrefab != null) riderRoot = Instantiate(riderPrefab, model, false).transform;
            else BuildPlaceholderRider();

            foreach (var r in GetComponentsInChildren<Renderer>())
            {
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                r.receiveShadows = true;
            }
        }

        static Transform FindDeep(Transform t, string name)
        {
            if (t.name == name) return t;
            foreach (Transform c in t)
            {
                var f = FindDeep(c, name);
                if (f != null) return f;
            }
            return null;
        }

        // --- Placeholder Stark Varg-style bike (white plastics, black frame, dark battery) ---
        void BuildPlaceholderBike()
        {
            var white = Mats.Get(Mats.Hex("#f2f3f5"), 0.75f);
            var black = Mats.Get(Mats.Hex("#1b1d22"), 0.35f, 0.2f);
            var batt = Mats.Get(Mats.Hex("#2c3036"), 0.55f, 0.5f);
            var alloy = Mats.Get(Mats.Hex("#b8bcc4"), 0.7f, 0.9f);
            var tyre = Mats.Get(Mats.Hex("#151515"), 0.15f);
            var seat = Mats.Get(Mats.Hex("#202226"), 0.2f);

            float zr = -Wheelbase / 2f, zf = Wheelbase / 2f;
            rearWheel = Wheel("RearWheel", new Vector3(0, RearR, zr), RearR, 0.12f, tyre, alloy);
            // Front end turns about a raked steering axis.
            steering = new GameObject("Steering").transform;
            steering.SetParent(model, false);
            steering.localPosition = new Vector3(0, 0.98f, zf - 0.42f);
            steering.localRotation = Quaternion.Euler(-26f, 0, 0);
            var axleLocal = steering.InverseTransformPoint(model.TransformPoint(new Vector3(0, FrontR, zf)));
            frontWheel = Wheel("FrontWheel", Vector3.zero, FrontR, 0.08f, tyre, alloy);
            frontWheel.SetParent(steering, false);
            frontWheel.localPosition = axleLocal;
            frontWheel.localRotation = Quaternion.Euler(26f, 0, 0);
            foreach (float x in new[] { 0.09f, -0.09f })
                Shapes.Between(PrimitiveType.Cylinder, steering, new Vector3(x, 0.05f, 0), axleLocal + new Vector3(x, 0, 0), 0.026f, black);
            Shapes.Prim(PrimitiveType.Cube, steering, new Vector3(0, 0.06f, 0), new Vector3(0.26f, 0.04f, 0.08f), alloy);
            Shapes.Between(PrimitiveType.Cylinder, steering, new Vector3(-0.4f, 0.17f, -0.06f), new Vector3(0.4f, 0.17f, -0.06f), 0.012f, black);
            // Front fender and number plate.
            Shapes.Prim(PrimitiveType.Cube, steering, axleLocal + new Vector3(0, FrontR + 0.06f, 0.1f), new Vector3(0.16f, 0.02f, 0.55f), white, false, Quaternion.Euler(-8f, 0, 0));
            Shapes.Prim(PrimitiveType.Cube, steering, new Vector3(0, -0.12f, 0.1f), new Vector3(0.24f, 0.22f, 0.02f), white, false, Quaternion.Euler(-14f, 0, 0));

            // Battery (the big dark block low in the frame) and motor.
            Shapes.Prim(PrimitiveType.Cube, model, new Vector3(0, 0.6f, 0.18f), new Vector3(0.2f, 0.33f, 0.42f), batt);
            Shapes.Prim(PrimitiveType.Cylinder, model, new Vector3(0, 0.36f, 0.08f), new Vector3(0.22f, 0.08f, 0.22f), alloy, false, Quaternion.Euler(0, 0, 90));
            // Frame rails.
            Shapes.Between(PrimitiveType.Cylinder, model, new Vector3(0, 1.0f, zf - 0.44f), new Vector3(0, 0.82f, -0.05f), 0.025f, black);
            Shapes.Between(PrimitiveType.Cylinder, model, new Vector3(0, 0.95f, zf - 0.4f), new Vector3(0, 0.42f, 0.36f), 0.028f, black);
            // Moulded bodywork: shrouds + tank + side panels + tail, smooth capsules.
            Shapes.Prim(PrimitiveType.Capsule, model, new Vector3(0, 0.88f, 0.22f), new Vector3(0.26f, 0.32f, 0.2f), white, false, Quaternion.Euler(70f, 0, 0));
            foreach (float x in new[] { 0.11f, -0.11f })
                Shapes.Prim(PrimitiveType.Capsule, model, new Vector3(x, 0.78f, 0.3f), new Vector3(0.08f, 0.24f, 0.2f), white, false, Quaternion.Euler(58f, 0, 0));
            Shapes.Prim(PrimitiveType.Capsule, model, new Vector3(0, 0.74f, -0.4f), new Vector3(0.24f, 0.36f, 0.16f), white, false, Quaternion.Euler(95f, 0, 0));
            Shapes.Prim(PrimitiveType.Capsule, model, new Vector3(0, 0.86f, -0.88f), new Vector3(0.13f, 0.32f, 0.06f), white, false, Quaternion.Euler(80f, 0, 0));
            // Saddle.
            Shapes.Prim(PrimitiveType.Capsule, model, new Vector3(0, 0.92f, -0.22f), new Vector3(0.2f, 0.42f, 0.08f), seat, false, Quaternion.Euler(92f, 0, 0));
            // Swingarm and shock.
            foreach (float x in new[] { 0.085f, -0.085f })
                Shapes.Between(PrimitiveType.Cube, model, new Vector3(x, 0.42f, 0.0f), new Vector3(x, RearR, zr), 0.03f, alloy);
            Shapes.Between(PrimitiveType.Cylinder, model, new Vector3(0, 0.82f, -0.12f), new Vector3(0, 0.45f, -0.3f), 0.03f, Mats.Get(Mats.Hex("#d4a72c"), 0.75f, 0.9f));
            // Footpegs.
            foreach (float x in new[] { 0.2f, -0.2f })
                Shapes.Prim(PrimitiveType.Cube, model, new Vector3(x, 0.38f, 0.04f), new Vector3(0.1f, 0.025f, 0.05f), alloy);
        }

        Transform Wheel(string name, Vector3 pos, float r, float w, Material tyre, Material hub)
        {
            var t = new GameObject(name).transform;
            t.SetParent(model, false);
            t.localPosition = pos;
            Shapes.Prim(PrimitiveType.Cylinder, t, Vector3.zero, new Vector3(r * 2f, w * 0.5f, r * 2f), tyre, false, Quaternion.Euler(0, 0, 90));
            Shapes.Prim(PrimitiveType.Cylinder, t, Vector3.zero, new Vector3(r * 1.55f, w * 0.52f, r * 1.55f), hub, false, Quaternion.Euler(0, 0, 90));
            Shapes.Prim(PrimitiveType.Cube, t, Vector3.zero, new Vector3(w * 1.1f, r * 1.5f, 0.03f), tyre); // spoke hint (shows rotation)
            return t;
        }

        // --- Placeholder rider in MX gear (white jersey, black pants, white boots/helmet) ---
        void BuildPlaceholderRider()
        {
            riderRoot = new GameObject("Rider").transform;
            riderRoot.SetParent(model, false);
            var jersey = Mats.Get(Mats.Hex("#eceef0"), 0.15f);
            var pants = Mats.Get(Mats.Hex("#1b1d22"), 0.15f);
            var boot = Mats.Get(Mats.Hex("#f4f5f7"), 0.5f);
            var glove = Mats.Get(Mats.Hex("#141619"), 0.2f);
            var helmet = Mats.Get(Mats.Hex("#f4f5f7"), 0.85f);
            var visor = Mats.Get(Mats.Hex("#1b2330"), 0.95f, 0.8f);
            Vector3 hip = new Vector3(0, 1.0f, -0.18f), neck = new Vector3(0, 1.48f, 0.12f), head = new Vector3(0, 1.66f, 0.2f);
            Shapes.Between(PrimitiveType.Capsule, riderRoot, hip, neck, 0.17f, jersey);
            Shapes.Prim(PrimitiveType.Sphere, riderRoot, head, new Vector3(0.28f, 0.29f, 0.32f), helmet);
            Shapes.Prim(PrimitiveType.Cube, riderRoot, head + new Vector3(0, 0.0f, 0.15f), new Vector3(0.2f, 0.07f, 0.05f), visor);
            Shapes.Prim(PrimitiveType.Cube, riderRoot, head + new Vector3(0, 0.1f, 0.2f), new Vector3(0.22f, 0.02f, 0.14f), helmet, false, Quaternion.Euler(-15f, 0, 0));
            foreach (float s in new[] { 1f, -1f })
            {
                Vector3 sh = neck + new Vector3(s * 0.2f, -0.06f, 0), el = new Vector3(s * 0.34f, 1.25f, 0.32f), wr = new Vector3(s * 0.38f, 1.17f, 0.58f);
                Shapes.Between(PrimitiveType.Capsule, riderRoot, sh, el, 0.055f, jersey);
                Shapes.Between(PrimitiveType.Capsule, riderRoot, el, wr, 0.048f, jersey);
                Shapes.Prim(PrimitiveType.Sphere, riderRoot, wr, Vector3.one * 0.1f, glove);
                Vector3 hs = hip + new Vector3(s * 0.11f, 0, 0), kn = new Vector3(s * 0.2f, 0.92f, 0.32f), an = new Vector3(s * 0.2f, 0.45f, 0.06f);
                Shapes.Between(PrimitiveType.Capsule, riderRoot, hs, kn, 0.085f, pants);
                Shapes.Between(PrimitiveType.Capsule, riderRoot, kn, an, 0.07f, boot);
                Shapes.Prim(PrimitiveType.Cube, riderRoot, an + new Vector3(0, -0.04f, 0.07f), new Vector3(0.1f, 0.07f, 0.26f), boot);
            }
        }

        void LateUpdate()
        {
            if (bike == null || lean == null) return;
            lean.localRotation = Quaternion.Euler(0, 0, -bike.LeanDeg);
            pitch.localRotation = Quaternion.Euler(-bike.PitchDeg, 0, 0);
            if (steering != null) steering.localRotation = Quaternion.Euler(-26f, 0, 0) * Quaternion.Euler(0, bike.SteerAngle, 0);
            float dt = Time.deltaTime;
            rearSpin += bike.Speed / RearR * Mathf.Rad2Deg * dt;
            frontSpin += bike.Speed / FrontR * Mathf.Rad2Deg * dt;
            if (rearWheel != null) rearWheel.localRotation = Quaternion.Euler(rearSpin, 0, 0);
            if (frontWheel != null) frontWheel.localRotation = Quaternion.Euler(26f, 0, 0) * Quaternion.Euler(frontSpin, 0, 0);
            // Rider hangs off a little into the lean and tucks in a wheelie.
            if (riderRoot != null)
            {
                riderRoot.localPosition = new Vector3(Mathf.Clamp(bike.LeanDeg / 50f, -1, 1) * 0.06f, 0, bike.PitchDeg > 5f ? -0.08f : 0f);
                riderRoot.localRotation = Quaternion.Euler(bike.PitchDeg > 5f ? -bike.PitchDeg * 0.35f : 0f, 0, -bike.LeanDeg * 0.15f);
            }
        }
    }
}
