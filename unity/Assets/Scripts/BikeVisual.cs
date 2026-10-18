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

        // --- Procedural Stark Varg-style bike: sculpted, moulded parts (see BikeArt) ---
        static GameObject Part(string name, Transform parent, Mesh mesh, params Material[] mats)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterials = mats;
            return go;
        }

        void BuildPlaceholderBike()
        {
            var fabric = ProcTex.FabricNormal();
            var white = Mats.Get(Mats.Hex("#f2f3f5"), 0.84f, 0f);
            var seat = Mats.Normal("seat", Mats.Hex("#1e2024"), fabric, 0.28f, 0f, 0.7f, new Vector2(6, 6));
            var caseM = Mats.Get(Mats.Hex("#2c3036"), 0.55f, 0.65f);
            var frame = Mats.Get(Mats.Hex("#1b1d22"), 0.55f, 0.4f);
            var alloy = Mats.Get(Mats.Hex("#b8bcc4"), 0.75f, 1f);
            var gold = Mats.Get(Mats.Hex("#d4a72c"), 0.8f, 1f);
            var anod = Mats.Get(Mats.Hex("#202227"), 0.72f, 0.85f);
            var steel = Mats.Get(Mats.Hex("#a3a8b0"), 0.88f, 1f);
            var rubber = Mats.Get(Mats.Hex("#141516"), 0.3f, 0f);
            var tread = Mats.Pbr("tread", ProcTex.Tread(), Color.white, 1f, 1.2f);
            var led = Mats.Get(Color.white, 0.9f, 0f, new Color(1f, 0.97f, 0.9f) * 2.2f);
            var tailLed = Mats.Get(Mats.Hex("#400000"), 0.9f, 0f, new Color(1f, 0.05f, 0.05f) * 1.2f);

            // Bodywork, battery, motor, frame, swingarm, shock.
            Part("BodyShell", model, BikeArt.BodyShell(), white, seat);
            Part("Battery", model, BikeArt.BatteryCase(), caseM);
            var motor = Part("Motor", model, MeshGen.Disc(0.11f, 0.0f, 0.15f), alloy);
            motor.transform.localPosition = BikeArt.Motor;
            var cap = Part("MotorCap", model, MeshGen.Disc(0.075f, 0.0f, 0.17f), anod);
            cap.transform.localPosition = BikeArt.Motor;
            Part("HeadTube", model, MeshGen.Tube(new[] { BikeArt.Head + new Vector3(0, -0.02f, 0.01f), BikeArt.HeadTop }, 0.032f, 2, 14), frame);
            for (int i = 0; i < 2; i++)
            {
                float s = i == 0 ? 1f : -1f;
                Part("Rail", model, MeshGen.Tube(new[] { BikeArt.HeadTop + new Vector3(s * 0.05f, -0.04f, 0), new Vector3(s * 0.08f, 1.0f, 0.18f), new Vector3(s * 0.08f, 0.93f, -0.05f), new Vector3(s * 0.075f, 0.9f, -0.35f), new Vector3(s * 0.07f, 0.88f, -0.6f) }, 0.016f, 30, 10), frame);
                Part("Downtube", model, MeshGen.Tube(new[] { BikeArt.Head + new Vector3(s * 0.03f, -0.03f, 0), new Vector3(s * 0.06f, 0.72f, 0.3f), new Vector3(s * 0.06f, 0.47f, 0.2f), new Vector3(s * 0.06f, 0.4f, 0f), new Vector3(s * 0.06f, 0.5f, -0.16f), new Vector3(s * 0.06f, 0.7f, -0.32f), new Vector3(s * 0.06f, 0.86f, -0.42f) }, 0.019f, 40, 10), frame);
                Part("Peg", model, MeshGen.Tube(new[] { new Vector3(s * 0.12f, BikeArt.Peg.y, BikeArt.Peg.z), new Vector3(s * 0.25f, BikeArt.Peg.y, BikeArt.Peg.z) }, 0.016f, 2, 8), alloy);
            }
            Part("Swingarm", model, BikeArt.Swingarm(), alloy);
            Vector3 shockTop = new Vector3(0, 0.93f, -0.14f), shockBot = new Vector3(0, 0.6f, -0.34f);
            Part("ShockBody", model, MeshGen.Tube(new[] { shockTop, shockBot }, 0.02f, 2, 12), anod);
            Part("ShockSpring", model, BikeArt.Spring(Vector3.Lerp(shockTop, shockBot, 0.12f), Vector3.Lerp(shockTop, shockBot, 0.85f), 0.038f, 0.0065f, 9), gold);
            // Final drive: sprockets and chain on the right.
            var fs = Part("FrontSprocket", model, MeshGen.Disc(0.045f, 0.012f, 0.008f, 24), steel);
            fs.transform.localPosition = new Vector3(0.075f, 0.5f, -0.1f);
            Part("ChainTop", model, MeshGen.Tube(new[] { new Vector3(0.075f, 0.545f, -0.1f), new Vector3(0.075f, BikeArt.RearAxle.y + 0.1f, BikeArt.RearAxle.z) }, 0.006f, 2, 6), rubber);
            Part("ChainBottom", model, MeshGen.Tube(new[] { new Vector3(0.075f, 0.455f, -0.1f), new Vector3(0.075f, BikeArt.RearAxle.y - 0.1f, BikeArt.RearAxle.z) }, 0.006f, 2, 6), rubber);
            var tl = Part("TailLight", model, MeshGen.Box(new Vector3(0.07f, 0.02f, 0.02f)), tailLed);
            tl.transform.localPosition = new Vector3(0, BikeArt.SeatY - 0.02f, BikeArt.SeatZ - BikeArt.SeatLength / 2f - BikeArt.Tail * 0.7f);

            // Rear wheel (spins): tyre, rim + spokes, hub, brake rotor, sprocket.
            float zr = -Wheelbase / 2f, zf = Wheelbase / 2f;
            rearWheel = Wheel("RearWheel", model, new Vector3(0, RearR, zr), RearR, 0.12f, 0.11f, tread, anod, alloy, steel);
            var rs = Part("Sprocket", rearWheel, MeshGen.Disc(0.105f, 0.035f, 0.006f, 48), steel);
            rs.transform.localPosition = new Vector3(0.075f, 0, 0);

            // Front end turns about a raked steering axis through the head tube.
            steering = new GameObject("Steering").transform;
            steering.SetParent(model, false);
            steering.localPosition = BikeArt.HeadTop;
            steering.localRotation = Quaternion.Euler(-26f, 0, 0);
            var axleLocal = steering.InverseTransformPoint(model.TransformPoint(new Vector3(0, FrontR, zf)));
            frontWheel = Wheel("FrontWheel", steering, axleLocal, FrontR, 0.09f, 0.095f, tread, anod, alloy, steel);
            frontWheel.localRotation = Quaternion.Euler(26f, 0, 0);
            for (int i = 0; i < 2; i++)
            {
                float s = i == 0 ? 1f : -1f;
                var top = new Vector3(s * 0.09f, 0.02f, 0.045f);
                var bot = axleLocal + new Vector3(s * 0.09f, 0, 0);
                var mid = Vector3.Lerp(top, bot, 0.45f);
                Part("ForkUpper", steering, MeshGen.Tube(new[] { top, mid + (bot - top).normalized * 0.06f }, 0.028f, 2, 16), gold);
                Part("ForkLower", steering, MeshGen.Tube(new[] { mid, bot + (bot - top).normalized * 0.03f }, 0.037f, 2, 16), anod);
                Part("ForkGuard", steering, MeshGen.Tube(new[] { Vector3.Lerp(top, bot, 0.55f) + new Vector3(0, 0, 0.012f), bot + new Vector3(0, 0.06f, 0.015f) }, 0.042f, 2, 14), white);
            }
            var tc = Part("TopClamp", steering, MeshGen.Box(new Vector3(0.27f, 0.035f, 0.085f)), anod);
            tc.transform.localPosition = new Vector3(0, 0.02f, 0.03f);
            var bc = Part("BottomClamp", steering, MeshGen.Box(new Vector3(0.27f, 0.04f, 0.09f)), anod);
            bc.transform.localPosition = new Vector3(0, -0.17f, 0.04f);
            // Cockpit: bend bar, pad, grips, levers.
            var bar = new[] { new Vector3(-0.41f, 0.13f, -0.09f), new Vector3(-0.3f, 0.11f, -0.05f), new Vector3(-0.12f, 0.08f, -0.005f), new Vector3(0.12f, 0.08f, -0.005f), new Vector3(0.3f, 0.11f, -0.05f), new Vector3(0.41f, 0.13f, -0.09f) };
            Part("Handlebar", steering, MeshGen.Tube(bar, 0.011f, 40, 10), anod);
            Part("BarPad", steering, MeshGen.Tube(new[] { new Vector3(-0.1f, 0.095f, 0f), new Vector3(0.1f, 0.095f, 0f) }, 0.022f, 2, 14), rubber);
            for (int i = 0; i < 2; i++)
            {
                float s = i == 0 ? 1f : -1f;
                Part("Grip", steering, MeshGen.Tube(new[] { new Vector3(s * 0.31f, 0.112f, -0.052f), new Vector3(s * 0.43f, 0.135f, -0.1f) }, 0.017f, 2, 12), rubber);
                Part("Lever", steering, MeshGen.Tube(new[] { new Vector3(s * 0.25f, 0.115f, -0.02f), new Vector3(s * 0.33f, 0.11f, 0.04f), new Vector3(s * 0.4f, 0.1f, 0.05f) }, 0.006f, 8, 6), alloy);
            }
            // Number plate with the LED headlight strip, and the moulded front fender.
            var plate = Part("NumberPlate", steering, MeshGen.Box(new Vector3(0.25f, 0.23f, 0.014f)), white);
            plate.transform.localPosition = new Vector3(0, -0.1f, 0.12f);
            plate.transform.localRotation = Quaternion.Euler(-12f, 0, 0);
            var light = Part("Headlight", plate.transform, MeshGen.Box(new Vector3(0.12f, 0.02f, 0.01f)), led);
            light.transform.localPosition = new Vector3(0, -0.07f, 0.01f);
            var fender = Part("FrontFender", steering, BikeArt.FrontFender(FrontR), white);
            fender.transform.localPosition = axleLocal;
            fender.transform.localRotation = Quaternion.Euler(26f, 0, 0);
            var cal = Part("Caliper", steering, MeshGen.Box(new Vector3(0.04f, 0.09f, 0.06f)), anod);
            cal.transform.localPosition = axleLocal + new Vector3(-0.07f, 0.1f, -0.05f);
        }

        /// <summary>Wheel spinning about its X axis: knobbly tyre, rim + spokes, hub and brake rotor.</summary>
        Transform Wheel(string name, Transform parent, Vector3 pos, float r, float width, float height, Material tyre, Material rim, Material hub, Material rotor)
        {
            var t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.localPosition = pos;
            Part("Tyre", t, MeshGen.Tyre(r, width, height), tyre);
            Part("RimSpokes", t, BikeArt.SpokesAndRim(r), rim);
            Part("Hub", t, MeshGen.Disc(0.055f, 0.0f, 0.13f, 32), hub);
            var disc = Part("Rotor", t, MeshGen.Disc(r > 0.36f ? 0.13f : 0.11f, 0.06f, 0.005f, 48), rotor);
            disc.transform.localPosition = new Vector3(-0.065f, 0, 0);
            return t;
        }

        // --- Rider in MX gear: sculpted torso, helmet, arms and legs (see BikeArt) ---
        // Limb pivots (shoulders and hips) and each limb's rest direction, for the trick poses.
        readonly Transform[] arm = new Transform[2], leg = new Transform[2];
        readonly Vector3[] armRest = new Vector3[2], legRest = new Vector3[2];

        void BuildPlaceholderRider()
        {
            riderRoot = new GameObject("Rider").transform;
            riderRoot.SetParent(model, false);
            var fabric = ProcTex.FabricNormal();
            var tiling = new Vector2(5, 5);
            var jersey = Mats.Normal("jersey", Mats.Hex("#eceef0"), fabric, 0.18f, 0f, 0.9f, tiling);
            var pants = Mats.Normal("pants", Mats.Hex("#1d1f24"), fabric, 0.14f, 0f, 0.9f, tiling);
            var glove = Mats.Normal("glove", Mats.Hex("#141619"), fabric, 0.25f, 0f, 0.6f, tiling);
            var boot = Mats.Get(Mats.Hex("#f2f3f5"), 0.62f, 0f);
            var dark = Mats.Get(Mats.Hex("#1a1b1e"), 0.35f, 0f);
            var shell = Mats.Get(Mats.Hex("#f4f5f7"), 0.93f, 0.05f);
            var accent = Mats.Get(Mats.Hex("#1b1d22"), 0.88f, 0.1f);
            var lens = Mats.Get(Mats.Hex("#26324a"), 0.97f, 0.9f);
            var strap = Mats.Get(Mats.Hex("#16171a"), 0.3f, 0f);

            Part("Torso", riderRoot, BikeArt.Torso(), jersey, pants, dark);
            var helmet = Part("Helmet", riderRoot, BikeArt.Helmet(), shell, accent, lens, strap);
            helmet.transform.localPosition = BikeArt.HeadC;
            helmet.transform.localRotation = Quaternion.Euler(6f, 0, 0);

            // Hands on the grips (as the bars sit straight), elbows out, feet on the pegs.
            for (int i = 0; i < 2; i++)
            {
                float s = i == 0 ? 1f : -1f; // +1 = the rider's right (+X)
                Vector3 sh = BikeArt.Neck + new Vector3(s * 0.19f, -0.06f, -0.02f);
                Vector3 grip = steering != null
                    ? model.InverseTransformPoint(steering.TransformPoint(new Vector3(s * 0.38f, 0.125f, -0.08f)))
                    : new Vector3(s * 0.38f, 1.25f, 0.18f);
                Vector3 el = BikeArt.Ik(sh, grip, 0.3f, 0.28f, new Vector3(s * 1f, -0.4f, -0.4f));
                arm[i] = Pivot("Arm" + i, sh);
                armRest[i] = (grip - sh).normalized;
                Part("Arm", arm[i], BikeArt.Arm(el - sh, grip - sh, s > 0 ? "R" : "L"), jersey, glove);
                Vector3 hs = BikeArt.Hip + new Vector3(s * 0.11f, -0.02f, -0.02f);
                Vector3 an = new Vector3(s * 0.19f, BikeArt.Peg.y + 0.08f, BikeArt.Peg.z - 0.02f);
                Vector3 kn = BikeArt.Ik(hs, an, 0.45f, 0.45f, new Vector3(s * 0.3f, 0.2f, 1f));
                leg[i] = Pivot("Leg" + i, hs);
                legRest[i] = (an - hs).normalized;
                Part("Leg", leg[i], BikeArt.Leg(kn - hs, an - hs, s > 0 ? "R" : "L"), pants, boot, dark);
            }
        }

        Transform Pivot(string name, Vector3 at)
        {
            var t = new GameObject(name).transform;
            t.SetParent(riderRoot, false);
            t.localPosition = at;
            return t;
        }

        void LateUpdate()
        {
            if (bike == null || lean == null) return;
            // Whip: the bike is thrown sideways in the air (laid over and turned across the path).
            float whip = bike.Whip;
            lean.localRotation = Quaternion.Euler(0, whip * 32f, -(bike.LeanDeg + whip * 58f));
            pitch.localRotation = Quaternion.Euler(-bike.PitchDeg, 0, 0);
            if (steering != null) steering.localRotation = Quaternion.Euler(-26f, 0, 0) * Quaternion.Euler(0, bike.SteerAngle, 0);
            float dt = Time.deltaTime;
            rearSpin += bike.Speed / RearR * Mathf.Rad2Deg * dt;
            frontSpin += bike.Speed / FrontR * Mathf.Rad2Deg * dt;
            if (rearWheel != null) rearWheel.localRotation = Quaternion.Euler(rearSpin, 0, 0);
            if (frontWheel != null) frontWheel.localRotation = Quaternion.Euler(26f, 0, 0) * Quaternion.Euler(frontSpin, 0, 0);
            if (riderRoot == null) return;
            // Rider hangs off into the lean, tucks in a wheelie, crouches to pre-load a bunny hop.
            float amt = bike.TrickAmt;
            var pose = bike.TrickPose;
            float sup = pose == BikeController.Pose.Superman ? amt : 0f;
            riderRoot.localPosition = new Vector3(Mathf.Clamp(bike.LeanDeg / 50f, -1, 1) * 0.06f, -0.12f * bike.JumpCharge + 0.14f * sup, (bike.PitchDeg > 5f ? -0.08f : 0f) - 0.1f * sup);
            riderRoot.localRotation = Quaternion.Euler((bike.PitchDeg > 5f ? -bike.PitchDeg * 0.35f : 0f) + 28f * sup, 0, -bike.LeanDeg * 0.15f);
            if (arm[0] == null) return;
            for (int i = 0; i < 2; i++)
            {
                float s = i == 0 ? 1f : -1f;
                // No-hander: arms flung out wide and up.
                Vector3 armT = pose == BikeController.Pose.NoHander ? new Vector3(s * 0.8f, 0.6f, 0.1f).normalized : armRest[i];
                arm[i].localRotation = Quaternion.Slerp(Quaternion.identity, Quaternion.FromToRotation(armRest[i], armT), pose == BikeController.Pose.NoHander ? amt : 0f);
                // Superman: both legs stretched out behind. Can-can: one leg swung over the seat.
                Vector3 legT = legRest[i];
                float w = 0f;
                if (pose == BikeController.Pose.Superman) { legT = new Vector3(s * 0.12f, 0.2f, -1f).normalized; w = amt; }
                else if (pose == BikeController.Pose.CanCan && s == bike.TrickSide) { legT = new Vector3(-s * 0.9f, 0.35f, 0.3f).normalized; w = amt; }
                leg[i].localRotation = Quaternion.Slerp(Quaternion.identity, Quaternion.FromToRotation(legRest[i], legT), w);
            }
        }
    }
}
