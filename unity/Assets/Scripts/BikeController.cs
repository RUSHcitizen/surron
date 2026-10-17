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
            Grounded = Physics.Raycast(rb.position + Vector3.up * 0.6f, Vector3.down, out var hit, 1.0f, ~0, QueryTriggerInteraction.Ignore);
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
                airPitch = Mathf.Lerp(airPitch, -input.Lean * 90f, 1f - Mathf.Exp(-3f * dt));
                PitchDeg += airPitch * dt;
                AirTime += dt;
            }
            if (Grounded && AirTime > 0) { AirTime = 0; PitchDeg = Mathf.Clamp(PitchDeg, -10f, 40f); }

            ApplyVelocity(dt);
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
