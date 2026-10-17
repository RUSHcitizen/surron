using UnityEngine;

namespace StarkVarg
{
    /// <summary>Helpers to build placeholder geometry from Unity primitives.</summary>
    public static class Shapes
    {
        public static GameObject Prim(PrimitiveType type, Transform parent, Vector3 localPos, Vector3 scale, Material mat, bool keepCollider = false, Quaternion? rot = null)
        {
            var go = GameObject.CreatePrimitive(type);
            if (!keepCollider)
            {
                var col = go.GetComponent<Collider>();
                if (col != null) Object.Destroy(col);
            }
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = rot ?? Quaternion.identity;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        /// <summary>A capsule/cylinder stretched between two local points (a limb, a tube).</summary>
        public static GameObject Between(PrimitiveType type, Transform parent, Vector3 a, Vector3 b, float radius, Material mat)
        {
            var dir = b - a;
            float len = dir.magnitude;
            var rot = len > 1e-5f ? Quaternion.FromToRotation(Vector3.up, dir / len) : Quaternion.identity;
            // Capsules and cylinders are 2 units tall along Y; cubes are 1.
            float sy = type == PrimitiveType.Cube ? len : len * 0.5f;
            return Prim(type, parent, (a + b) * 0.5f, new Vector3(radius * 2f, sy, radius * 2f), mat, false, rot);
        }
    }
}
