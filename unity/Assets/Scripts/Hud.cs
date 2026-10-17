using UnityEngine;

namespace StarkVarg
{
    /// <summary>IMGUI heads-up display and touch-control overlay (no Canvas setup needed).</summary>
    public class Hud : MonoBehaviour
    {
        public BikeController bike;
        public BikeInput input;
        GUIStyle big, small, btn;
        Texture2D white;

        void EnsureStyles()
        {
            if (big != null) return;
            white = Texture2D.whiteTexture;
            float u = Mathf.Min(Screen.width, Screen.height) / 400f;
            big = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(44 * u), fontStyle = FontStyle.Bold };
            big.normal.textColor = Color.white;
            small = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(14 * u) };
            small.normal.textColor = new Color(1, 1, 1, 0.85f);
            btn = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(15 * u), fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            btn.normal.textColor = Color.white;
        }

        void Box(Rect r, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, white);
            GUI.color = old;
        }

        void OnGUI()
        {
            if (bike == null) return;
            EnsureStyles();
            float u = Mathf.Min(Screen.width, Screen.height) / 400f;
            // Speedometer panel.
            var panel = new Rect(14, 14, 190 * u, 92 * u);
            Box(panel, new Color(0.04f, 0.05f, 0.07f, 0.7f));
            GUI.Label(new Rect(panel.x + 12 * u, panel.y + 4 * u, 200 * u, 56 * u), Mathf.RoundToInt(Mathf.Abs(bike.Speed) * 3.6f).ToString(), big);
            GUI.Label(new Rect(panel.x + 110 * u, panel.y + 26 * u, 80 * u, 24 * u), "km/h", small);
            Box(new Rect(panel.x + 12 * u, panel.y + 66 * u, 166 * u, 6 * u), new Color(1, 1, 1, 0.15f));
            Box(new Rect(panel.x + 12 * u, panel.y + 66 * u, 166 * u * bike.BoostMeter, 6 * u), new Color(0.31f, 0.64f, 1f, 0.9f));
            GUI.Label(new Rect(panel.x + 12 * u, panel.y + 72 * u, 180 * u, 20 * u), "BOOST", small);
            if (bike.WheelieDistance > 2f)
                GUI.Label(new Rect(Screen.width / 2f - 120 * u, 14, 240 * u, 50 * u), $"Wheelie {bike.WheelieDistance:0} m", big);
            if (bike.BestWheelie > 0)
                GUI.Label(new Rect(panel.x, panel.yMax + 4, 240 * u, 22 * u), $"Best wheelie {bike.BestWheelie:0} m", small);
            if (bike.Crashed)
                GUI.Label(new Rect(Screen.width / 2f - 160 * u, Screen.height * 0.35f, 320 * u, 60 * u), "Crashed! Resetting...", big);

            // Touch controls (only once a touch has been seen).
            if (input != null && input.TouchActive)
            {
                Box(input.ThrottleRect, new Color(1, 1, 1, input.Throttle > 0 ? 0.32f : 0.16f));
                GUI.Label(input.ThrottleRect, "THROTTLE", btn);
                Box(input.BrakeRect, new Color(1, 1, 1, input.Brake > 0 ? 0.32f : 0.16f));
                GUI.Label(input.BrakeRect, "BRAKE", btn);
                Box(input.WheelieRect, new Color(0.78f, 0.96f, 0.2f, input.Wheelie ? 0.5f : 0.25f));
                GUI.Label(input.WheelieRect, "WHEELIE", btn);
                Box(input.BoostRect, new Color(0.31f, 0.64f, 1f, input.Boost ? 0.6f : 0.3f));
                GUI.Label(input.BoostRect, "BOOST", btn);
                Box(input.ResetRect, new Color(1, 1, 1, 0.16f));
                GUI.Label(input.ResetRect, "RESET", btn);
                if (input.StickHeld)
                {
                    float r = Mathf.Min(Screen.width, Screen.height) * 0.12f;
                    Box(new Rect(input.StickOrigin.x - r, input.StickOrigin.y - r, r * 2, r * 2), new Color(1, 1, 1, 0.08f));
                    Box(new Rect(input.StickPos.x - r * 0.35f, input.StickPos.y - r * 0.35f, r * 0.7f, r * 0.7f), new Color(1, 1, 1, 0.35f));
                }
            }
            else
            {
                GUI.Label(new Rect(14, Screen.height - 30 * u, Screen.width, 26 * u), "W/S throttle/brake · A/D steer · Shift wheelie (Q/E height) · F boost · R reset", small);
            }
        }
    }
}
