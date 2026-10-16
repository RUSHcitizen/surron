# Development notes

## Architecture

```
src/
  vehicle/   parts.ts (catalog + trade-offs) · build.ts (saved build format, presets, sanitising)
             spec.ts (computeVehicleSpec: build → physics + geometry) · stats.ts (garage estimates, dyno)
  physics/   bike.ts (6-DOF dynamics, tires, suspension, rider controller, crashes) · powertrain.ts
             tuning.ts (ALL handling constants) · sim.ts (headless scenarios: tests + garage test bench)
  world/     collision.ts (heightfield + OBBs, ray/sphere queries) · layout.ts (procedural map) · pedestrians.ts
  render/    worldView.ts · bikeModel.ts (procedural bike) · rider.ts (skinned SDF rider + helmet, IK posing)
             sdfMesh.ts (SDF primitives + surface-nets mesher) · pedParts.ts (near-LOD pedestrian parts)
             postfx.ts (bloom, speed blur, grade) · effects.ts · textures.ts (canvas textures)
  camera/    chaseCamera.ts          input/  input.ts (keyboard/gamepad) · touch.ts
  audio/     audio.ts (procedural Web Audio)
  gameplay/  scoring.ts · challenges.ts
  save/      save.ts (IndexedDB/localStorage/memory, versioned migration, import/export)
  ui/        ui.ts (screens) · hud.ts · garage.ts · dom.ts · styles.css
  game/      game.ts (loop, state machine, systems wiring)
  pwa/       register.ts · sw-template.js (vite.config.ts injects the precache list + version)
tools/       physics lab (scenario sweeps/traces) and screenshot drivers used during development
```

**One source of truth.** `computeVehicleSpec(build)` produces everything physical: masses, CoM, inertia, wheel radii and
inertias, axle mounts and suspension axes, rake/trail, spring and damper rates, tire μ and stiffness per surface, and the
powertrain. The physics (`BikeDynamics`), the 3D model (`BikeModel`), the garage estimates and the headless test bench all
consume it. A part therefore can't look different without behaving differently, and the reverse holds too. A unit test
asserts that every catalog part changes the spec.

**Fixed step.** Physics runs at 240 Hz, with tire/wheel spin sub-stepped 6×. Rendering interpolates position and
orientation between steps. The loop caps work per frame (dt ≤ 0.1 s, ≤ 40 steps), so slow frames slow the game down
instead of exploding it.

## Key trade-offs

* **No Rapier, no physics engine.** The world is static (heightfield + oriented boxes), and convincing two-wheel behaviour
  needs custom tire, suspension and rider code anyway. Going custom avoids about 2 MB of WASM, keeps the offline cache
  small (~200 KB gzipped total), and lets the exact game physics run in Node for repeatable tests and in the garage test bench.
* **Rider model + assists rather than raw inverted-pendulum control.** The player asks for a lean; a rider controller targets
  a roll rate and chooses the steering angle (countersteering emerges). Steering is limited to the front tire's peak slip
  angle relative to the direction of travel, and in slides the steering reference switches to the travel direction.
  Assists are explicit, scaled by the user's Assist slider, and documented in `tuning.ts`:
  * balance torque, strongest near standstill
  * lean margin to grip
  * stoppie, loop-out and slide-limit instincts
  * in-air levelling, off while leaning
  * slide yaw damping and foot-dab roll support

  At 0% assist you can lowside, loop out and endo.
* **Massless wheel heave.** Unsprung mass is part of the body mass. This is stable and cheap; the cost is that wheel hop is
  approximate.
* **Procedural everything.** Textures, models, icons and sound are generated at runtime or build time. Visuals are stylised
  low-poly rather than photoreal.

## Tuning workflow

1. Change constants in `src/physics/tuning.ts` (or part values in `src/vehicle/parts.ts`).
2. Run `npm run lab`. For a specific sweep: `SCEN=turn,slalom,drift,wheelie,uturn,presets npm run lab`.
   For a single trace: `V=16.7 DUR=6 npx vitest run --config tools/vitest.lab.config.ts tools/lab-trace.test.ts --reporter=verbose`.
3. Run `npm test` to confirm the regression scenarios still pass.

## Status checklist

### Done
- [x] Repository initialised (it was empty): Vite + TypeScript + Three.js, Vitest, Playwright.
- [x] Physics:
  - [x] Suspension and combined-slip tires per surface; electric powertrain with regen, thermal and battery models.
  - [x] Countersteer rider controller; wheelies, stoppies, jumps, flips, drifts and burnouts; crashes with ragdoll and safe-spot reset.
  - [x] Full customization system wired to the physics; five original presets.
- [x] Garage:
  - [x] Live preview, stats with deltas, dyno chart.
  - [x] Estimates vs. simulated vs. measured results.
  - [x] Builds, compare, import/export.
- [x] World, pedestrians, collectibles and unlocks, 7 challenges with medals, drift/stunt scoring.
- [x] Audio, effects, HUD/telemetry, settings (assist, graphics, audio, camera, controls with rebinding, data).
- [x] Desktop, gamepad and multitouch controls; portrait rotation hint; safe-area insets.
- [x] IndexedDB saves (versioned, migration, corruption-safe, fallbacks).
- [x] PWA: manifest, icons, generated precaching service worker, offline fallback, cache versioning.
- [x] Cloudflare Pages config (`_headers`, `wrangler.toml`, docs).
- [x] 53 unit/scenario tests and 7 e2e tests passing, including an offline reload and the touch wheelie button.
- [x] Round 4: skinned SDF rider (man in MX gear, sculpted helmets), arcade crash rule (only 30+ mph impacts or a
      looped-out wheelie; auto-righting), Hyper ride mode (up to ~230 km/h) with high-speed stability aids, wheelie/stoppie
      buttons that work at speed, spring-damped camera with a three-quarter trick view, post-processing (bloom, speed blur,
      grade, vignette), glass showroom, foliage shading, ground relief, near-LOD sculpted pedestrians.
- [x] Round 3: cooling/damper/pegs/handguard parts, rider tab (weight + gear), more paint; ~100 city pedestrians with
      joggers/idlers and spectator crowds (per-area culling, no crowd shadows); lake with water shader, cloud shadows,
      baked tree AO, birds, night window lights and lamp light pools, speed vignette. Medium at iPhone-15 size measured
      at ~210–250 draw calls and ~440–550k triangles per frame.
- [x] Round 2:
  - [x] Bug audit fixes: garage texture leak, Reset everything, immediate saves on backgrounding, audio silenced off-ride,
        Long Jump stale result, unlock re-announcements, hidden pedestrians colliding, stuck rebinds, lifetime odometer,
        SW shell/asset mismatch, deleting the active build.
  - [x] iPhone: floating stick, slide-between buttons, per-finger aggregation, iOS audio unlock (touchend), pinch/callout
        blocking, rotation resize, context-loss handling, adaptive resolution, compact phone menus, garage framing.
  - [x] Graphics: sculpted bodywork, IBL, clouds, mountains, splatted terrain, grass, organic trees, articulated
        pedestrians, styled city buildings, track/hub dressing.
  - [x] Wheelie/stoppie trick buttons (`TUNING.tricks`), renamed to Stark Varg EBike.

### Known limitations
- Not tested on a real iPhone, or on real GPU hardware. Only headless Chromium with SwiftShader was available (no WebKit
  build could be downloaded in the dev container). Measured render load at an iPhone-15-sized viewport on Medium: about
  180–220 draw calls and 370–550k triangles per frame (shadow pass included); High adds grass density and shadow detail.
- Not deployed to Cloudflare. No credentials were available; the steps are in the README.
- Visuals are low-poly and procedural:
  - The rider is a procedural skinned body, not a scanned character; there is no face (the helmet covers it).
  - Pedestrians are rigid articulated parts (sculpted near the camera), not skinned.
  - Buildings are detailed boxes (no interiors, no curved architecture).
- Physics:
  - Wheel hop and chatter are approximated (massless wheels).
  - There is no gyroscopic precession of the chassis body.
  - Steering-head drop with steer is not modelled.
  - The most extreme build (22 kW "Monster" on dual-sport tires) can't do rear-brake-entry drifts reliably. That's
    intentional and listed in its cons, but it's harsh.
- Pedestrians use simple loop paths; there are no crosswalk behaviours.
- Touch steering is a virtual stick. There is no tilt (accelerometer) option yet.
- Audio has only been verified to initialise without errors. I haven't listened to it on real hardware, so levels may need tuning.

### Next most valuable improvements
1. Real-device playtesting on iPhone and an integrated-GPU laptop. Tune assists, touch curve and audio mix from feel.
2. Optional tilt steering on mobile, plus haptics tuning.
3. Track dressing (tire walls, banners, start gate), more props, and better rider and bike materials.
4. Ghost replays for time trials, and lap/challenge leaderboards stored locally.
5. Wheel hop (unsprung mass) and gyroscopic effects for even richer jumps.
6. LOD for distant terrain chunks and tree impostors for low-end phones.
