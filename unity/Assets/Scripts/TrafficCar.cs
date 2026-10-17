using UnityEngine;

namespace StarkVarg
{
    /// <summary>
    /// An electric city car driving the street grid in its right-hand lane, turning at random at
    /// junctions, slowing for whatever is ahead of it (other cars, the bike). Kinematic: it
    /// pushes the bike, it is never pushed.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class TrafficCar : MonoBehaviour
    {
        public CityGenerator city;
        public float cruise = 11f;
        Vector3 dir;         // unit heading along a street axis
        float speed;
        Vector3 lastJunction;
        Rigidbody rb;
        System.Random rnd;

        public void Init(CityGenerator c, Vector3 start, Vector3 heading, int seed)
        {
            city = c;
            dir = heading;
            rnd = new System.Random(seed);
            cruise = 9f + (float)rnd.NextDouble() * 5f;
            speed = cruise;
            transform.position = start;
            transform.rotation = Quaternion.LookRotation(dir);
            rb = GetComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            lastJunction = new Vector3(9999, 0, 9999);
            BuildBody();
        }

        void BuildBody()
        {
            var paints = new[] { "#e8e8ea", "#1b1d22", "#8a2f2f", "#2f4f8a", "#7a7f86", "#c6c9ce", "#2d5a3d" };
            var paint = Mats.Get(Mats.Hex(paints[rnd.Next(paints.Length)]), 0.85f, 0.35f);
            var glass = Mats.Get(Mats.Hex("#1d2530"), 0.95f, 0.5f);
            var tyre = Mats.Get(Mats.Hex("#151515"), 0.1f);
            var t = transform;
            Shapes.Prim(PrimitiveType.Cube, t, new Vector3(0, 0.62f, 0), new Vector3(1.85f, 0.7f, 4.4f), paint);
            Shapes.Prim(PrimitiveType.Cube, t, new Vector3(0, 1.18f, -0.25f), new Vector3(1.6f, 0.5f, 2.3f), glass);
            Shapes.Prim(PrimitiveType.Cube, t, new Vector3(0, 0.95f, 2.05f), new Vector3(1.75f, 0.08f, 0.3f), Mats.Get(Color.white, 0.6f, 0f, Color.white * 0.6f));
            foreach (float x in new[] { 0.82f, -0.82f })
            foreach (float z in new[] { 1.4f, -1.4f })
                Shapes.Prim(PrimitiveType.Cylinder, t, new Vector3(x, 0.34f, z), new Vector3(0.68f, 0.12f, 0.68f), tyre, false, Quaternion.Euler(0, 0, 90));
            var box = gameObject.AddComponent<BoxCollider>();
            box.center = new Vector3(0, 0.8f, 0);
            box.size = new Vector3(1.85f, 1.3f, 4.4f);
        }

        void FixedUpdate()
        {
            if (city == null) return;
            float dt = Time.fixedDeltaTime;
            var pos = rb.position;
            // Look ahead for anything in the lane.
            float want = cruise;
            if (Physics.BoxCast(pos + Vector3.up * 0.8f + dir * 2.6f, new Vector3(0.8f, 0.5f, 0.3f), dir, out var hit, Quaternion.LookRotation(dir), 6f + speed * 1.4f))
                want = Mathf.Min(want, Mathf.Max(0, (hit.distance - 2f) * 1.2f));
            speed = Mathf.MoveTowards(speed, want, (want < speed ? 9f : 3f) * dt);

            // Junctions: at each street crossing pick straight / left / right.
            float laneOffset = 3.5f;
            Vector3 right = new Vector3(dir.z, 0, -dir.x);
            float axisPos = Mathf.Abs(dir.x) > 0.5f ? pos.x : pos.z;
            foreach (float s in city.streets)
            {
                if (Mathf.Abs(axisPos - s) < 0.4f && (lastJunction - pos).sqrMagnitude > 100f)
                {
                    lastJunction = pos;
                    int choice = rnd.Next(4);
                    if (choice == 1) dir = right;
                    else if (choice == 2) dir = -right;
                    // Snap onto the new lane.
                    Vector3 r2 = new Vector3(dir.z, 0, -dir.x);
                    float cross = Mathf.Abs(dir.x) > 0.5f ? NearestStreet(pos.z) : NearestStreet(pos.x);
                    if (Mathf.Abs(dir.x) > 0.5f) pos.z = cross + r2.z * laneOffset;
                    else pos.x = cross + r2.x * laneOffset;
                    break;
                }
            }
            // Turn around at the edge of the city.
            float lim = city.Half;
            if (Mathf.Abs(pos.x) > lim + 2f || Mathf.Abs(pos.z) > lim + 2f)
            {
                dir = -dir;
                Vector3 r3 = new Vector3(dir.z, 0, -dir.x);
                if (Mathf.Abs(dir.x) > 0.5f) pos.z = NearestStreet(pos.z) + r3.z * laneOffset;
                else pos.x = NearestStreet(pos.x) + r3.x * laneOffset;
                pos += dir * 3f;
            }
            pos += dir * speed * dt;
            pos.y = 0;
            rb.MovePosition(pos);
            rb.MoveRotation(Quaternion.Slerp(rb.rotation, Quaternion.LookRotation(dir), 1f - Mathf.Exp(-8f * dt)));
        }

        float NearestStreet(float v)
        {
            float best = v, bd = float.MaxValue;
            foreach (float s in city.streets)
            {
                float d = Mathf.Abs(s - v);
                if (d < bd) { bd = d; best = s; }
            }
            return best;
        }
    }
}
