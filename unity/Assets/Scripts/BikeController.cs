using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// Arcade electric dirt bike (tuned to the Stark Varg MX: ~118 kg, 80 hp, 0-100 km/h in ~3.5 s).
    ///
    /// The Rigidbody carries position, gravity and collisions; heading, speed and the "bike"
    /// angles (lean, wheelie pitch) are driven here, the way mobile riding games do it, so the
    /// bike never tips over by accident. Turning is coordinated: the yaw rate is the one the
    /// lean balances (v·ω = g·tanφ), so the bike leans exactly as much as the corner needs.
    /// Held wheelies ride at a balance point the stick raises or lowers; a crash needs a hit
    /// at 30+ mph (13.4 m/s).
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class BikeController : MonoBehaviour
    {
        [Header("Powertrain")]
        public float topSpeed = 36f;          // m/s (~130 km/h)
        public float boostTopSpeed = 46f;
        public float launchAccel = 8.5f;      // m/s² at low speed (traction limited)
        public float powerAccelAt30 = 3.0f;   // m/s² left at 30 m/s (power limited)
        public float brakeDecel = 11f;
        public float coastDrag = 0.6f;

        [Header("Handling")]
        public float maxLeanDeg = 52f;
        public float leanRate = 4.5f;         // how fast the lean follows the input (1/s)
        public float lowSpeedYaw = 1.9f;      // rad/s at walking pace (bars turned)
        public float grip = 1.3f;             // sideways grip (1/s): how fast slides are caught

        [Header("Wheelie")]
        public float wheelieBaseDeg = 32f;
        public float wheelieStickDeg = 22f;
        public float wheelieCruise = 17f;     // m/s the button alone cruises to

        public BikeInput input;
        public float Speed { get; private set; }
        public float LeanDeg { get; private set; }
        public float PitchDeg { get; private set; }
        public float SteerAngle { get; private set; }
        public bool Grounded { get; private set; }
        public bool Crashed { get; private set; }
        public float WheelieDistance { get; private set; }
        public float BestWheelie { get; private set; }
        public float BoostMeter { get; private set; } = 1f;
        public float AirTime { get; private set; }

        // --- Tricks ---
        public enum Pose { None, Superman, CanCan, NoHander }
        /// <summary>Bunny-hop pre-load 0..1 (JUMP held).</summary>
        public float JumpCharge { get; private set; }
        /// <summary>Whip / flick in the air: -1..1 (visual roll and yaw across the flight path).</summary>
        public float Whip { get; private set; }
        public Pose TrickPose { get; private set; }
        public float TrickAmt { get; private set; }
        public int TrickSide { get; private set; } = 1;
        /// <summary>Running score and the last landed trick (name, points), for the HUD.</summary>
        public int Score { get; private set; }
        public string LastTrick { get; private set; } = "";
        public int LastTrickPoints { get; private set; }
        public float LastTrickAge { get; private set; } = 99f;
        bool jumpHeld, hopFlag;
        float hopCooldown, airWhipMax, poseTime, airPitchAccum;
        Pose posePeak;

        Rigidbody rb;
        // Unity 6 renamed Rigidbody.velocity to linearVelocity.
        Vector3 Vel
        {
#if UNITY_6000_0_OR_NEWER
            get => rb.linearVelocity;
            set => rb.linearVelocity = value;
#else
            get => rb.velocity;
            set => rb.velocity = value;
#endif
        }
        float yaw, yawRate, crashTimer, airPitch;
        Vector3 groundNormal = Vector3.up;
        Vector3 spawnPos;
        float spawnYaw;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            rb.mass = 118f + 75f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            rb.constraints = RigidbodyConstraints.FreezeRotation;
            yaw = transform.eulerAngles.y;
            spawnPos = transform.position;
            spawnYaw = yaw;
            BestWheelie = PlayerPrefs.GetFloat("bestWheelie", 0f);
        }

        public void Respawn(Vector3 pos, float yawDeg)
        {
            rb.position = pos;
            transform.position = pos;
            Vel = Vector3.zero;
            yaw = yawDeg;
            Speed = 0;
            PitchDeg = LeanDeg = 0;
            Crashed = false;
            crashTimer = 0;
            rb.MoveRotation(Quaternion.Euler(0, yaw, 0));
        }

        void FixedUpdate()
        {
            float dt = Time.fixedDeltaTime;
            if (input == null) return;
            if (input.ResetPressed) Respawn(rb.position + Vector3.up * 0.5f, yaw);

            // --- Ground probe (from the bike's middle) ---
            Grounded = Physics.Raycast(rb.position + Vector3.up * 0.6f, Vector3.down, out var hit, 0.78f, ~0, QueryTriggerInteraction.Ignore);
            LastTrickAge += dt;
            groundNormal = Grounded ? hit.normal : Vector3.up;

            if (Crashed)
            {
                crashTimer += dt;
                Speed = Mathf.MoveTowards(Speed, 0, 12f * dt);
                if (crashTimer > 2.5f) Respawn(rb.position + Vector3.up * 0.5f, yaw);
                ApplyVelocity(dt);
                return;
            }

            float v = Speed;
            float av = Mathf.Abs(v);

            // --- Bunny hop: hold JUMP to pre-load, release to pop (tap ≈ 0.6 m, full ≈ 1.6 m) ---
            hopCooldown = Mathf.Max(0, hopCooldown - dt);
            if (input.Jump) JumpCharge = Mathf.Min(1f, JumpCharge + dt / 0.6f);
            if (!input.Jump && jumpHeld && Grounded && hopCooldown <= 0)
            {
                float up = 3.3f + 2.3f * JumpCharge;
                var vel0 = Vel;
                vel0.y = Mathf.Max(vel0.y, 0f) + up;
                Vel = vel0;
                PitchDeg = Mathf.Max(PitchDeg, 6f + 8f * JumpCharge); // front comes up first
                hopCooldown = 0.35f;
                hopFlag = true;
                Grounded = false;
            }
            if (!input.Jump) JumpCharge = Mathf.Max(0, JumpCharge - dt * 4f);
            jumpHeld = input.Jump;

            // --- Drive ---
            bool boosting = input.Boost && BoostMeter > 0.02f;
            BoostMeter = Mathf.Clamp01(BoostMeter + (boosting ? -0.22f : 0.04f) * dt);
            float vmax = boosting ? boostTopSpeed : topSpeed;
            float thr = input.Throttle;
            bool wheelie = input.Wheelie && Grounded;
            if (wheelie) thr = Mathf.Max(thr, 0.45f);
            // Traction-limited launch fading into a power-limited pull (P = F·v).
            float accel = Mathf.Lerp(launchAccel, powerAccelAt30, Mathf.Clamp01(av / 30f)) * thr * (boosting ? 1.6f : 1f);
            accel *= 1f - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(vmax * 0.85f, vmax, av));
            if (wheelie) accel *= 1f - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(Mathf.Lerp(wheelieCruise, vmax, Mathf.InverseLerp(0.45f, 1f, input.Throttle)) - 4f, Mathf.Lerp(wheelieCruise, vmax, Mathf.InverseLerp(0.45f, 1f, input.Throttle)), av));
            float decel = input.Brake * brakeDecel + coastDrag + 0.0012f * v * v;
            if (Grounded)
            {
                v += accel * dt;
                v = Mathf.MoveTowards(v, 0, decel * dt * (thr > 0.05f && input.Brake < 0.05f ? 0.15f : 1f));
                // Slopes: gravity along the heading slows you uphill and speeds you down.
                var fwd = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                v += Vector3.Dot(Physics.gravity, Vector3.ProjectOnPlane(fwd, groundNormal).normalized) * dt;
            }
            Speed = v;

            // --- Steering: coordinated lean and yaw ---
            float g = -Physics.gravity.y;
            float maxLean = maxLeanDeg * Mathf.Deg2Rad * Mathf.Lerp(0.3f, 1f, Mathf.InverseLerp(1.5f, 10f, av)) * (1f - 0.12f * Mathf.InverseLerp(26f, 40f, av));
            float leanTarget = input.Steer * maxLean;
            float leanRad = LeanDeg * Mathf.Deg2Rad;
            if (Grounded && !wheelie) leanRad = Mathf.MoveTowards(leanRad, leanTarget, leanRate * Mathf.Max(0.35f, Mathf.Abs(leanTarget - leanRad)) * dt * 2f);
            else if (wheelie) leanRad = Mathf.MoveTowards(leanRad, leanTarget * 0.45f, 2f * dt);
            LeanDeg = leanRad * Mathf.Rad2Deg;
            // Yaw rate: what the lean balances at speed; the bars steer directly at a walk.
            float coordinated = av > 0.5f ? g * Mathf.Tan(leanRad + (leanTarget - leanRad) * 0.35f) / Mathf.Max(av, 3f) : 0f;
            float direct = input.Steer * lowSpeedYaw * Mathf.Clamp01(av / 1.5f);
            float wDirect = 1f - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(2.5f, 6f, av));
            float yawT = Mathf.Lerp(coordinated, direct, wDirect) * Mathf.Sign(v == 0 ? 1 : v);
            if (wheelie) yawT = input.Steer * Mathf.Min(0.9f, 7.5f / Mathf.Max(av, 1f));
            if (!Grounded) yawT = yawRate; // keep the spin you took off with
            yawRate = Mathf.Lerp(yawRate, yawT, 1f - Mathf.Exp(-10f * dt));
            yaw += yawRate * Mathf.Rad2Deg * dt;
            SteerAngle = Mathf.Lerp(SteerAngle, Mathf.Lerp(leanRad * 0.25f, input.Steer * 0.6f, wDirect) * Mathf.Rad2Deg, 1f - Mathf.Exp(-12f * dt));

            // --- Wheelie / air pitch ---
            float pitchTarget = 0f;
            if (wheelie)
            {
                // Stick back (lean < 0) raises the front, forward lowers it.
                pitchTarget = Mathf.Clamp(wheelieBaseDeg - input.Lean * wheelieStickDeg, 10f, 55f);
                // A gentle bob so the balance point looks ridden.
                pitchTarget += Mathf.Sin(Time.time * 2.3f) * 1.4f;
                WheelieDistance += av * dt;
            }
            else if (WheelieDistance > 0)
            {
                if (WheelieDistance > BestWheelie && WheelieDistance > 25f)
                {
                    BestWheelie = WheelieDistance;
                    PlayerPrefs.SetFloat("bestWheelie", BestWheelie);
                }
                WheelieDistance = 0;
            }
            if (Grounded) PitchDeg = Mathf.MoveTowards(PitchDeg, pitchTarget, (pitchTarget > PitchDeg ? 60f : 90f) * dt);
            else
            {
                // In the air the stick pitches the bike (nose up / down).
                // (Ignored while posing or whipping: the rider is busy.)
                float pitchIn = input.Trick || Mathf.Abs(Whip) > 0.1f ? 0f : -input.Lean;
                airPitch = Mathf.Lerp(airPitch, pitchIn * 360f, 1f - Mathf.Exp(-3f * dt));
                PitchDeg += airPitch * dt;
                airPitchAccum += airPitch * dt;
                AirTime += dt;
                AirTricks(dt);
            }
            if (Grounded && AirTime > 0) Land();
            if (Grounded)
            {
                Whip = Mathf.MoveTowards(Whip, 0, 8f * dt);
                TrickAmt = Mathf.MoveTowards(TrickAmt, 0, 8f * dt);
                if (TrickAmt == 0) TrickPose = Pose.None;
            }

            ApplyVelocity(dt);
        }

        /// <summary>
        /// Air tricks: steer = whip (the bike is thrown sideways and straightens itself for the
        /// last 0.45 s before touchdown); TRICK held = a pose picked by the stick.
        /// </summary>
        void AirTricks(float dt)
        {
            if (input.Trick && TrickPose == Pose.None && AirTime > 0.12f)
            {
                if (input.Lean > 0.4f) TrickPose = Pose.NoHander;
                else if (Mathf.Abs(input.Steer) > 0.4f) { TrickPose = Pose.CanCan; TrickSide = input.Steer > 0 ? 1 : -1; }
                else TrickPose = Pose.Superman;
            }
            TrickAmt = Mathf.MoveTowards(TrickAmt, input.Trick && TrickPose != Pose.None ? 1f : 0f, (input.Trick ? 5f : 6f) * dt);
            if (TrickAmt == 0) TrickPose = Pose.None;
            if (TrickAmt > 0.7f) { poseTime += dt; posePeak = TrickPose; }

            // Time to touchdown (ballistic, ground below): straighten up for the last 0.45 s.
            float g = -Physics.gravity.y;
            float h = Physics.Raycast(rb.position + Vector3.up * 0.2f, Vector3.down, out var gh, 50f, ~0, QueryTriggerInteraction.Ignore) ? gh.distance - 0.2f : 0f;
            float vy = Vel.y;
            float tLand = (vy + Mathf.Sqrt(vy * vy + 2f * g * Mathf.Max(0, h))) / g;
            bool landing = tLand < 0.45f;
            float target = input.Trick || landing || Mathf.Abs(input.Steer) < 0.25f ? 0f : input.Steer;
            Whip = Mathf.MoveTowards(Whip, target, (target != 0 ? 4.5f : landing ? 11f : 6f) * dt);
            airWhipMax = Mathf.Max(airWhipMax, Mathf.Abs(Whip));
        }

        /// <summary>Touchdown: name and score the jump, forgive the landing angle (arcade).</summary>
        void Land()
        {
            float air = AirTime;
            AirTime = 0;
            bool bailed = TrickAmt > 0.45f;
            var parts = new System.Collections.Generic.List<string>();
            float pts = air > 0.4f ? 80f * air * air + 60f * air : (hopFlag && air > 0.2f ? 60f + 120f * air : 0f);
            int flips = Mathf.FloorToInt((Mathf.Abs(airPitchAccum) + 40f) / 360f);
            if (flips > 0) { parts.Add((airPitchAccum > 0 ? "Backflip" : "Frontflip") + (flips > 1 ? " x" + flips : "")); pts += 1500f * flips; }
            if (posePeak != Pose.None && poseTime > 0.15f)
            {
                parts.Add(posePeak == Pose.Superman ? "Superman" : posePeak == Pose.CanCan ? "Can-Can" : "No-Hander");
                pts += 400f + 900f * Mathf.Min(1.5f, poseTime);
            }
            if (airWhipMax > 0.45f) { parts.Add(airWhipMax > 0.85f ? "Big Whip" : "Whip"); pts += 500f * airWhipMax; }
            parts.Add(air > 1.2f ? "Big Air" : hopFlag ? "Bunny Hop" : "Air");
            if (bailed) { pts *= 0.25f; parts.Add("(bailed)"); }
            if (pts > 0)
            {
                LastTrick = string.Join(" · ", parts);
                LastTrickPoints = Mathf.RoundToInt(pts);
                LastTrickAge = 0;
                Score += LastTrickPoints;
            }
            hopFlag = false;
            airWhipMax = 0;
            poseTime = 0;
            posePeak = Pose.None;
            airPitchAccum = 0;
            PitchDeg = Mathf.Clamp(Mathf.DeltaAngle(0, PitchDeg), -10f, 40f);
        }

        void ApplyVelocity(float dt)
        {
            var heading = Quaternion.Euler(0, yaw, 0);
            var fwd = heading * Vector3.forward;
            var vel = Vel;
            if (Grounded)
            {
                var along = Vector3.ProjectOnPlane(fwd, groundNormal).normalized;
                var target = along * Speed;
                // Sideways grip: catch the lateral velocity quickly but not instantly (a little slide).
                var horiz = Vector3.ProjectOnPlane(vel, groundNormal);
                var newH = Vector3.Lerp(horiz, target, 1f - Mathf.Exp(-grip * 6f * dt));
                vel = newH + Vector3.Project(vel, groundNormal);
                // Stick to the ground over small bumps.
                vel += -groundNormal * 2f * dt;
            }
            Vel = vel;
            rb.MoveRotation(heading);
        }

        void OnCollisionEnter(Collision c)
        {
            if (Crashed) return;
            // Only hard hits count, and only the part of the impact along the contact normal.
            float hitSpeed = 0;
            foreach (var cp in c.contacts) hitSpeed = Mathf.Max(hitSpeed, Mathf.Abs(Vector3.Dot(c.relativeVelocity, cp.normal)));
            // Floors, ramps and kerb edges (the round collider rides up a 15 cm kerb) are not hits.
            bool ground = c.contacts.Length > 0 && c.contacts[0].normal.y > 0.5f;
            if (!ground && hitSpeed > 13.4f) Crash();
            else if (!ground) Speed *= 0.4f; // a scrape or a bump: lose speed, keep riding
        }

        public void Crash()
        {
            Crashed = true;
            crashTimer = 0;
            WheelieDistance = 0;
        }

        public Vector3 SpawnPos => spawnPos;
        public float SpawnYaw => spawnYaw;
    }
}
