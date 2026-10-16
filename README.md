# Stark Varg EBike — Electric Dirt Bike Sandbox

A 3D browser game about building, tuning and riding lightweight **electric** dirt bikes.

> Naming note: the game is branded "Stark Varg EBike" at the owner's request. Stark Varg is a real product of
> Stark Future; this is an unofficial fan project and is not affiliated with or endorsed by them. Check trademark use
> before distributing it publicly. Models, textures and sounds are still all procedurally generated in-house.
Build a bike in the garage, take it to the city streets, the MX track or the test facilities, and feel what every change does
to acceleration, grip, suspension, wheelies and drifts. No accounts, no servers, and it plays offline once installed.

Electric only: no cars, no combustion engines, no gear shifting. All models, textures and sounds are procedurally
generated, so there are no downloaded asset packs.

## Run it

```bash
npm install          # Node 20+ (tested on Node 22)
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build → dist/
npm run preview      # serve dist/ at http://localhost:4173 (service worker active here)
npm test             # unit + physics scenario tests (Vitest)
npm run test:e2e     # Playwright end-to-end tests against the production build (incl. offline)
npm run lab          # physics "lab": verbose scenario sweeps used for tuning (SCEN=turn,drift,... to filter)
```

The service worker is only registered in production builds (`npm run build && npm run preview`), never in `npm run dev`.

## Controls

### Keyboard (rebindable in Settings → Controls)

| Key | Action |
| --- | --- |
| **W** / ↑ | Throttle (progressive ramp) |
| **S** / ↓ | Front brake |
| **Space** | Rear brake (lock it to start slides) |
| **A D** / ← → | Steer. The rider leans and countersteers for you |
| **Q** / Shift | Lean back: wheelie, pull up in the air |
| **E** | Lean forward: keep the front down, stoppie, push down in the air |
| **Z** | **Wheelie button** (hold). Pops and holds a wheelie; hold it too long (about 3 s) and you loop out and fall off the back |
| **X** | **Stoppie button** (hold). Weight forward plus front brake; too long at speed sends you over the bars |
| **R** | Reset to the last safe spot |
| **C** | Camera: chase / far / helmet |
| **M** | Ride mode: Eco / Standard / Sport / **Hyper** (very fast: up to ~230 km/h depending on the bike) |
| **G** | Garage |
| **L** | Headlight |
| **H** | Toggle HUD |
| **Esc** / P | Pause (teleport, challenges, settings) |
| Mouse drag / wheel | Look around / zoom |

**Gamepad:** RT throttle, LT front brake, RB/B rear brake, left stick steer, right stick lean (LB = lean back), A wheelie, L3 stoppie, Y reset, Start pause, X ride mode.

### Touch (phones/tablets, landscape)

* **Left stick** (floating: it centres wherever your thumb lands on the left half): steer (left/right) and lean (up = forward, down = back).
* **Throttle pad** (tall, right): slide your thumb up for more throttle.
* **FRONT / REAR** brake buttons. Your thumb can slide between throttle and brakes without lifting.
* **WHEELIE / STOPPIE** buttons above the brakes. The wheelie button fills red the longer you hold it; let go before it is full or you fall off the back.
* Top-right: pause ❚❚, reset ⟲, camera ◉, ride mode M.
* Drag the empty upper-right area to look around.
* All controls are multitouch, so you can throttle, steer and brake at the same time. There's a left-handed layout in Settings.

## What's in the game

* **Graphics**:
  * Smooth, sculpted bike bodywork with clear-coat paint and reflections from a sky environment map.
  * A realistic rider: one continuous, smoothly skinned body of a man in motocross gear (jersey with cuffs, pants with leg
    stripes, knee guards, tall buckled boots, gloves, neck brace) and a sculpted helmet (MX, full-face or trail) with chin bar,
    peak, goggles and strap. It is modelled as a signed distance field, meshed at load and posed by IK on the bike every frame.
  * Articulated pedestrians with individual height, build, skin tone, hair and outfits, faces, and a walk cycle with knees and
    elbows. People near you switch to sculpted body parts (head with jaw, nose and ears, shaped limbs, shoes).
  * A city of distinct buildings: brick, glass offices with setback towers, apartments with balconies, stucco houses. They have shopfronts, awnings, cornices, rooftop units, water tanks and street trees.
  * Volumetric-looking clouds, distant mountain ranges, terrain shading that blends asphalt, concrete slabs, dirt and grass.
  * Wind-swayed grass, organic trees, track flags and tyre stacks, EV chargers and planters at the hub.
  * A lake with animated, sky-reflecting water and sun glints. Ride in and you get a splash and water drag; go under and you're
    put back on the shore.
  * Drifting cloud shadows, soft baked shadows under trees and rocks, flocks of birds.
  * At night, per-window city lights and warm pools of light under street lamps.
  * Post-processing on Medium/High: HDR bloom, a radial speed blur at high speed, colour grading, vignette and dithering.
  * A glass-fronted Stark Varg showroom at the hub; leaf-clump shading on trees and bushes; surface relief on asphalt,
    concrete joints and dirt.
  * A spring-damped chase camera that swings to a three-quarter view during wheelies and stoppies, and widens its view with speed.
* **Crowds**: about 100 people in the city on two-way sidewalks (walkers, joggers, people window-shopping or on their phones),
  plus cheering spectators at the MX track, stunt park and hub.
  * Mobile-friendly: vegetation is chunked and distance-culled, static bike parts are merged, and adaptive resolution keeps the frame rate up.

* **Motorcycle physics**: a 6-DOF rigid body with two suspended wheels.
  * Torus tire contact that rides over curbs and ramp lips.
  * A combined-slip tire model per surface.
  * Wheel spin with motor/brake reaction torques: throttle in the air lifts the nose, brakes dip it.
  * Weight transfer that produces wheelies and stoppies.
  * A rider controller that countersteers to reach the lean you ask for.
  * Adjustable assist: balance, lean margin, and rider instincts at the stoppie, loop-out and slide limits.
  * **Crashes: "Big hits only" (default)**: you only crash when you hit something (a wall, tree, pole) at 30 mph or more, or
    when you loop out a held wheelie. Leaning, sliding, landings and slow bumps never throw you off; a bike that tips over
    is stood back up. **Realistic** (Settings → Riding) brings back lowsides, endos and hard-landing crashes.
  * Wheelie and stoppie buttons work at any speed (the rider pops the front with body weight).
* **Electric powertrain**:
  * Torque curve with back-EMF fade, controller current and battery power limits.
  * Battery voltage sag and state of charge.
  * Coast and brake regen.
  * Motor thermal model with derating.
  * Smooth, strong drive: at full throttle (with rider assist) the rider keeps the front down instead of popping an
    accidental wheelie, a straight-line launch control holds the rear tyre near peak grip, and the rider's instinctive
    roll-offs are fed back in smoothly rather than switching the drive on and off.
  * Throttle maps, Eco/Standard/Sport/Hyper modes, traction control and wheelie control. Hyper unlocks the controller and
    motor speed, tucks the rider (less drag) and adds launch-grade traction control.
* **Customization that changes the physics**. Every part feeds `computeVehicleSpec`, and the same spec drives both the
  physics and the procedural 3D model:
  * motor, controller, battery
  * front/rear rim diameter, tire width, profile, tread, compound, pressure, rim style
  * fork, shock, spring/preload/compression/rebound
  * swingarm length, steering geometry (rake/offset → trail)
  * handlebar, seat, rider position, frame, body kit, fenders, lights, brakes
  * sprockets (final drive), regen strength
  * motor cooling (finned cover, liquid jacket), steering damper, footpegs, handguards
  * paint, finish (incl. chrome and pearl), decals, number plate, fork tube and grip colours
  * **Rider**: weight (50–115 kg, changes the physics), helmet style (MX, full-face, trail) and gear colours
* **Garage**:
  * Live 3D preview and stats with deltas against the version you started from.
  * Clearly separated **estimates**, **simulated test bench** results (the real physics run headlessly), and **measured** in-world results.
  * Dyno chart, saved builds, 2–3-way comparison, and JSON import/export.
* **World** (800 m square): city grid with curbs, alleys, a parking lot and industrial yards; the hub with the garage; a drag strip
  with braking zone; drift pad; cone course; MX track with tabletops, berms and whoops; stunt park with kicker/landing pairs;
  sand pit; off-road hills. Pedestrians on the sidewalks step aside (non-graphic contact), there are 30 collectible charge
  cores that unlock cosmetic parts, and you can switch between day, sunset and night.
* **Challenges with medals**: Drag Strip 201 m, Brake Test, Drift Pad, Stunt Park Jam, MX Track Lap, Cone Course, Long Jump.
* **Scoring**: drifts, wheelies, stoppies, air, flips and spins, with combos, multipliers, clean-landing bonuses and busts on crashes.
* **Effects**: tire marks, smoke on tarmac, dust and roost on loose ground, and landing dust.
* **Audio**: procedural Web Audio (no samples):
  * motor electrical whine and gear-mesh tone that follow rpm
  * inverter (PWM) hiss under load, a regen tone, chain noise
  * surface-dependent tire roar, squeal on paved slides, wind
  * landing/crash/scrape impacts, city vs. nature ambience
* **Persistence**: IndexedDB with localStorage and in-memory fallbacks. The save format is versioned with migration, and
  corrupted saves are quarantined.
* **PWA**: manifest, icons, and a service worker that precaches every built asset with a content-hashed cache version, so the
  game works offline after one load.

## Deploying to Cloudflare

The build output is a static site in `dist/`. `wrangler.toml` deploys it as a Cloudflare **Worker with static assets**
(Worker name `surron`), with no server code. `public/_headers` sets `sw.js` and `index.html` to no-cache and fingerprinted
`/assets/*` to immutable.

**Option A — Workers Builds (Git integration)**
1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and pick this repo.
2. Build settings:
   * Build command: `npm run build`
   * Deploy command: `npx wrangler deploy`
   * Root directory: `/`
3. Each push to the connected branch rebuilds and redeploys. The site is served at `https://surron.<your-subdomain>.workers.dev`.
   The relative base path (`base: './'`) also works on custom domains and preview URLs.

If you rename the Worker in the dashboard, change `name` in `wrangler.toml` to match.

**Option B — Direct upload with Wrangler**
```bash
npx wrangler login
npm run deploy        # = npm run build && npx wrangler deploy
```

## Install on iPhone (Add to Home Screen)

1. Open the deployed HTTPS URL in **Safari** on the iPhone.
2. Wait until the menu appears, then give it about 5 more seconds while the service worker caches everything.
3. Tap **Share** (□↑), then **Add to Home Screen**, then **Add**.
4. Launch **Stark Varg EBike** from the Home Screen icon. It opens full-screen without Safari's toolbars. Rotate to landscape.

## Verifying offline play

**On desktop Chrome or Edge:**
1. `npm run build && npm run preview`, then open http://localhost:4173.
2. DevTools → Application → Service Workers: `sw.js` should be *activated and running*. In Cache Storage, a
   `voltline-<hash>` cache lists `index.html`, `assets/*`, icons and the manifest.
3. In the Network tab, tick **Offline** and reload. The game still boots, rides, and your saved builds and settings are still there.

**On a real iPhone** (I couldn't test this; I had no device):
1. Install as described above while online, and open it once from the Home Screen.
2. Enable **Airplane Mode**.
3. Force-quit the app (swipe it away) and launch it again from the Home Screen. It should start normally.
4. Ride, open the garage, change a part, and press Save. Force-quit and relaunch, still offline. The change should still be there.
5. Turn Airplane Mode off. After the next deploy, the game downloads the update in the background and applies it on the following launch.

**iOS storage notes:**
* Data stored by an installed Home Screen web app is kept separate from Safari's.
* iOS may evict storage for web apps that go unused for weeks. The game calls `navigator.storage.persist()` where supported.
* Use **Builds → Export** or **Settings → Data → Export all data** for backups.
* If storage is unavailable (for example, some private modes), the game still runs, warns you, and keeps progress in memory only.

## Tests

* `npm test`: 54 Vitest tests.
  * Physics scenarios:
    * settling and sag; acceleration and top speed; braking for every preset without flipping
    * turn equilibrium vs. tanφ = v²/(gR); right-steer → right-lean; low-speed U-turn; slaloms at 3 speeds
    * held wheelies; sustained dirt power slides; traction control suppressing slides
    * kicker jump landing; curb climbing; 40 s random-input fuzz (no NaN); crash/reset recovery
    * trick buttons: a short wheelie hold lifts the front safely, holding too long loops out, the stoppie button lifts the rear,
      and the wheelie button works at 50 km/h on every preset
    * holding full throttle drives every preset forward cleanly: no accidental wheelie, no on/off throttle chatter
    * arcade crash rule: full-lock turning at any speed never crashes or lays the bike down; a wall hit below 30 mph is not a
      crash, above 30 mph head-on it is; Hyper mode passes 180 km/h
    * the rider mesh builds quickly at a sane size
  * Customization effects:
    * gearing; rear wheel size; knobby vs. street tires
    * battery mass and inertia; spring rate and preload
    * swingarm wheelbase and turning circle; eco mode
    * every part option changes the physical spec
    * rider weight, cooling, steering damper and footpegs effects; old saves migrate to the new rider fields
  * Powertrain: back-EMF fade, drain and regen, thermal derate, limp mode.
  * Saves: garbage → defaults, v1 → v2 migration, round-trip, build import/export.
  * Scoring/medals, and world spawns.
* `npm run test:e2e`: 7 Playwright tests on the production build:
  * boot with zero console errors
  * keyboard riding, reset, pause
  * a garage part change updates stats, persists across reload (IndexedDB) and applies to the ride
  * a full drag-strip challenge run that records a measured result
  * the service worker caches assets, and an **offline reload** still boots and rides with settings intact
  * the manifest and icons resolve
  * mobile multitouch: throttle and steer at once, brakes, the wheelie button lifting the front, buttons
  * riding tests switch to the Low preset and wait on game time, because software-rendered CI is very slow

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture, trade-offs, known limitations and the continuation checklist.
