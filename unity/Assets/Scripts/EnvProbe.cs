using UnityEngine;
using UnityEngine.Rendering;

namespace StarkVarg
{
    /// <summary>
    /// A realtime reflection probe that follows the bike, so paint, chrome and glass reflect the
    /// street they are on. It re-renders one cube face per frame (time-sliced) every few seconds.
    /// </summary>
    public class EnvProbe : MonoBehaviour
    {
        public Transform follow;
        public float interval = 2f;
        /// <summary>Layer the bike and rider meshes are put on (built-in "TransparentFX"; render-only).</summary>
        public const int BikeLayer = 1;
        ReflectionProbe probe;
        float next;

        public static EnvProbe Create(Transform parent, Transform follow)
        {
            var go = new GameObject("ReflectionProbe");
            go.transform.SetParent(parent, false);
            var p = go.AddComponent<ReflectionProbe>();
            p.mode = ReflectionProbeMode.Realtime;
            p.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            p.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
            p.resolution = Application.isMobilePlatform ? 64 : 256;
            p.hdr = true;
            p.size = new Vector3(600, 200, 600);
            p.boxProjection = false;
            p.nearClipPlane = 0.5f;
            p.farClipPlane = 400f;
            p.shadowDistance = 0f;
            p.importance = 1;
            p.cullingMask = ~(1 << BikeLayer); // the bike itself never shows up in its own reflections
            p.clearFlags = ReflectionProbeClearFlags.Skybox;
            var e = go.AddComponent<EnvProbe>();
            e.probe = p;
            e.follow = follow;
            if (follow != null) go.transform.position = follow.position + Vector3.up * 2f;
            p.RenderProbe();
            return e;
        }

        void LateUpdate()
        {
            if (probe == null || Time.time < next) return;
            next = Time.time + interval;
            if (follow != null) transform.position = follow.position + Vector3.up * 2f;
            probe.RenderProbe();
        }
    }
}
