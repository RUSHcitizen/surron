using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.EnhancedTouch;
using ETouch = UnityEngine.InputSystem.EnhancedTouch.Touch;
#endif

namespace StarkVarg
{
    /// <summary>
    /// Rider inputs from keyboard, gamepad and touch, combined.
    ///
    /// Touch layout (landscape): left half = floating steering stick (x steer, y lean);
    /// right side = THROTTLE pad (bottom right), BRAKE, WHEELIE and BOOST buttons above it.
    /// Rects are in GUI coordinates (origin top-left) so the HUD can draw them.
    /// </summary>
    public class BikeInput : MonoBehaviour
    {
        public float Throttle, Brake, Steer, Lean;
        public bool Wheelie, Boost, ResetPressed;

        // Touch state
        public bool TouchActive { get; private set; }
        public Vector2 StickOrigin, StickPos;
        public bool StickHeld;
        public Rect ThrottleRect, BrakeRect, WheelieRect, BoostRect, ResetRect;
        float steerSmooth;
        int stickFinger = -1;

        void OnEnable()
        {
#if ENABLE_INPUT_SYSTEM
            EnhancedTouchSupport.Enable();
#endif
        }

        void Layout()
        {
            float w = Screen.width, h = Screen.height, u = Mathf.Min(w, h) / 6f;
            ThrottleRect = new Rect(w - u * 1.5f - 20, h - u * 2.6f - 20, u * 1.5f, u * 2.6f);
            BrakeRect = new Rect(ThrottleRect.x - u * 1.25f - 14, h - u * 1.2f - 20, u * 1.25f, u * 1.2f);
            WheelieRect = new Rect(BrakeRect.x, BrakeRect.y - u * 1.2f - 12, u * 1.25f, u * 1.15f);
            BoostRect = new Rect(ThrottleRect.x, ThrottleRect.y - u * 0.9f - 12, u * 1.5f, u * 0.9f);
            ResetRect = new Rect(w - u * 0.9f - 20, 20, u * 0.9f, u * 0.7f);
        }

        void Update()
        {
            Layout();
            float thr = 0, brk = 0, steer = 0, lean = 0;
            bool wheelie = false, boost = false, reset = false;

#if ENABLE_INPUT_SYSTEM
            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.wKey.isPressed || kb.upArrowKey.isPressed) thr = 1;
                if (kb.sKey.isPressed || kb.downArrowKey.isPressed || kb.spaceKey.isPressed) brk = 1;
                if (kb.aKey.isPressed || kb.leftArrowKey.isPressed) steer -= 1;
                if (kb.dKey.isPressed || kb.rightArrowKey.isPressed) steer += 1;
                if (kb.leftShiftKey.isPressed || kb.zKey.isPressed) wheelie = true;
                if (kb.fKey.isPressed) boost = true;
                if (kb.qKey.isPressed) lean -= 1;
                if (kb.eKey.isPressed) lean += 1;
                if (kb.rKey.wasPressedThisFrame) reset = true;
            }
            var gp = Gamepad.current;
            if (gp != null)
            {
                thr = Mathf.Max(thr, gp.rightTrigger.ReadValue());
                brk = Mathf.Max(brk, gp.leftTrigger.ReadValue());
                var st = gp.leftStick.ReadValue();
                if (Mathf.Abs(st.x) > Mathf.Abs(steer)) steer = st.x;
                if (Mathf.Abs(st.y) > 0.3f) lean = st.y;
                wheelie |= gp.buttonSouth.isPressed;
                boost |= gp.rightShoulder.isPressed;
                reset |= gp.buttonNorth.wasPressedThisFrame;
            }
            TouchActive = ETouch.activeTouches.Count > 0 || TouchActive;
            bool stickSeen = false;
            foreach (var t in ETouch.activeTouches)
            {
                // Screen coords are bottom-left origin; GUI coords top-left.
                var p = new Vector2(t.screenPosition.x, Screen.height - t.screenPosition.y);
                HandleTouch(t.touchId, p, t.phase == UnityEngine.InputSystem.TouchPhase.Began, ref thr, ref brk, ref wheelie, ref boost, ref reset, ref steer, ref lean, ref stickSeen);
            }
#else
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) thr = 1;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow) || Input.GetKey(KeyCode.Space)) brk = 1;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) steer -= 1;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) steer += 1;
            if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.Z)) wheelie = true;
            if (Input.GetKey(KeyCode.F)) boost = true;
            if (Input.GetKey(KeyCode.Q)) lean -= 1;
            if (Input.GetKey(KeyCode.E)) lean += 1;
            if (Input.GetKeyDown(KeyCode.R)) reset = true;
            TouchActive = Input.touchCount > 0 || TouchActive;
            bool stickSeen = false;
            for (int i = 0; i < Input.touchCount; i++)
            {
                var t = Input.GetTouch(i);
                var p = new Vector2(t.position.x, Screen.height - t.position.y);
                HandleTouch(t.fingerId, p, t.phase == UnityEngine.TouchPhase.Began, ref thr, ref brk, ref wheelie, ref boost, ref reset, ref steer, ref lean, ref stickSeen);
            }
#endif
            if (!stickSeen)
            {
                stickFinger = -1;
                StickHeld = false;
            }
            // Keyboard steering ramps in (a key is all-or-nothing); touch/gamepad are analogue.
            steerSmooth = Mathf.MoveTowards(steerSmooth, steer, Time.deltaTime * (Mathf.Abs(steer) > Mathf.Abs(steerSmooth) ? 4.5f : 7f));
            Throttle = thr;
            Brake = brk;
            Steer = StickHeld ? steer : steerSmooth;
            Lean = lean;
            Wheelie = wheelie;
            Boost = boost;
            ResetPressed = reset;
        }

        void HandleTouch(int id, Vector2 p, bool began, ref float thr, ref float brk, ref bool wheelie, ref bool boost, ref bool reset,
            ref float steer, ref float lean, ref bool stickSeen)
        {
            if (ThrottleRect.Contains(p))
            {
                // Higher on the pad = more throttle (bottom = 45%).
                float f = 1f - (p.y - ThrottleRect.y) / ThrottleRect.height;
                thr = Mathf.Max(thr, Mathf.Clamp01(0.45f + f * 1.1f));
                return;
            }
            if (BrakeRect.Contains(p)) { brk = 1; return; }
            if (WheelieRect.Contains(p)) { wheelie = true; return; }
            if (BoostRect.Contains(p)) { boost = true; thr = 1; return; }
            if (ResetRect.Contains(p)) { if (began) reset = true; return; }
            if (began && stickFinger < 0 && p.x < Screen.width * 0.5f)
            {
                stickFinger = id;
                StickOrigin = p;
            }
            if (id != stickFinger) return;
            stickSeen = true;
            StickHeld = true;
            float r = Mathf.Min(Screen.width, Screen.height) * 0.12f;
            var d = Vector2.ClampMagnitude(p - StickOrigin, r);
            StickPos = StickOrigin + d;
            float sx = d.x / r, sy = d.y / r;
            // Full lock at ~75% deflection; lean needs a deliberate vertical push.
            steer = Mathf.Sign(sx) * Mathf.Clamp01((Mathf.Abs(sx) - 0.05f) / 0.7f);
            lean = Mathf.Abs(sy) > 0.35f ? -Mathf.Sign(sy) * Mathf.Clamp01((Mathf.Abs(sy) - 0.35f) / 0.6f) : 0f;
        }
    }
}
