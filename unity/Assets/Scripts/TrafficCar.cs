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

        // --- Body: a sculpted signed-distance-field shell (see CarArt), glossy paint, tinted glass,
        // lit head/tail lights, alloy wheels that roll with the car. ---
        readonly Transform[] wheels = new Transform[4];
        float wheelR = 0.34f;

        void BuildBody()
        {
            var paints = new[] { "#e8e8ea", "#1b1d22", "#8a2f2f", "#2f4f8a", "#7a7f86", "#c6c9ce", "#2d5a3d", "#f4f4f2", "#3b3f46" };
            int kind = rnd.Next(CarArt.Kinds.Length);
            var k = CarArt.Kinds[kind];
            var paintCol = Mats.Hex(paints[rnd.Next(paints.Length)]);
            var paint = Mats.Get(paintCol, 0.9f, 0.45f);
            var glass = Mats.Get(Mats.Hex("#10161d"), 0.97f, 0.85f);
            var head = Mats.Get(Mats.Hex("#e9eef5"), 0.95f, 0.2f, new Color(1.6f, 1.6f, 1.5f));
            var tail = Mats.Get(Mats.Hex("#7a0a0a"), 0.9f, 0.1f, new Color(1.3f, 0.05f, 0.03f));
            var trim = Mats.Get(Mats.Hex("#17181b"), 0.3f, 0f);
            var tyre = Mats.Get(Mats.Hex("#141414"), 0.12f, 0f);
            var alloy = Mats.Get(Mats.Hex("#b9bdc3"), 0.8f, 1f);

            var body = new GameObject("Body");
            body.transform.SetParent(transform, false);
            body.AddComponent<MeshFilter>().sharedMesh = CarArt.Body(kind);
            body.AddComponent<MeshRenderer>().sharedMaterials = new[] { paint, glass, head, tail, trim };

            wheelR = k.wheelR;
            var tyreMesh = CarArt.TyreMesh(k.wheelR);
            var hubMesh = CarArt.HubMesh(k.wheelR);
            int i = 0;
            foreach (float z in new[] { k.wheelBase / 2f, -k.wheelBase / 2f })
                foreach (float side in new[] { 1f, -1f })
                {
                    var w = new GameObject("Wheel").transform;
                    w.SetParent(transform, false);
                    w.localPosition = new Vector3(side * (k.width / 2f - 0.14f), k.wheelR, z);
                    var ty = new GameObject("Tyre");
                    ty.transform.SetParent(w, false);
                    ty.AddComponent<MeshFilter>().sharedMesh = tyreMesh;
                    ty.AddComponent<MeshRenderer>().sharedMaterial = tyre;
                    var hb = new GameObject("Alloy");
                    hb.transform.SetParent(w, false);
                    hb.AddComponent<MeshFilter>().sharedMesh = hubMesh;
                    hb.AddComponent<MeshRenderer>().sharedMaterial = alloy;
                    wheels[i++] = w;
                }
            var box = gameObject.AddComponent<BoxCollider>();
            box.center = new Vector3(0, (k.roof + k.clear) / 2f, 0);
            box.size = new Vector3(k.width, k.roof - k.clear, k.length);
        }

        void Update()
        {
            float spin = speed / wheelR * Time.deltaTime * Mathf.Rad2Deg;
            foreach (var w in wheels)
                if (w != null) w.localRotation *= Quaternion.Euler(spin, 0, 0);
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
