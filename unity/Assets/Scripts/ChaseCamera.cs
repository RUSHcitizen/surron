using UnityEngine;

namespace StarkVarg
{
    /// <summary>Chase camera: trails the bike's heading, widens the view with speed, rolls a little with the lean.</summary>
    public class ChaseCamera : MonoBehaviour
    {
        public BikeController bike;
        public float distance = 4.2f, height = 1.9f, lookAhead = 3f;
        float yawSmooth;
        Camera cam;

        void Start()
        {
            cam = GetComponent<Camera>();
            if (bike != null) yawSmooth = bike.transform.eulerAngles.y;
        }

        void LateUpdate()
        {
            if (bike == null) return;
            float dt = Time.deltaTime;
            float target = bike.transform.eulerAngles.y;
            yawSmooth = Mathf.LerpAngle(yawSmooth, target, 1f - Mathf.Exp(-5f * dt));
            var rot = Quaternion.Euler(0, yawSmooth, 0);
            float sp = Mathf.Abs(bike.Speed);
            float d = distance + sp * 0.03f;
            var bikePos = bike.transform.position;
            var want = bikePos + rot * new Vector3(0, height, -d);
            // Keep the camera out of walls.
            var from = bikePos + Vector3.up * 1.2f;
            if (Physics.SphereCast(from, 0.25f, want - from, out var hit, (want - from).magnitude, ~0, QueryTriggerInteraction.Ignore) && hit.rigidbody == null)
                want = from + (want - from).normalized * Mathf.Max(0.8f, hit.distance - 0.1f);
            transform.position = Vector3.Lerp(transform.position, want, 1f - Mathf.Exp(-10f * dt));
            var look = bikePos + Vector3.up * 1.1f + rot * Vector3.forward * lookAhead;
            transform.rotation = Quaternion.LookRotation(look - transform.position) * Quaternion.Euler(0, 0, -bike.LeanDeg * 0.25f);
            if (cam != null) cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 60f + Mathf.Clamp01(sp / 40f) * 14f + (bike.input != null && bike.input.Boost ? 6f : 0f), 1f - Mathf.Exp(-3f * dt));
        }
    }
}
