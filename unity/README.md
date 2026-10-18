# Stark Varg EBike — Unity version

A Unity port of the browser game in this repository: an electric dirt bike (tuned to the
Stark Varg MX) in a procedural city with traffic, with held wheelies, coordinated turning,
boost and touch controls. The whole game is built from code when you press Play, so there is
no scene to set up.

**Status:** first playable port. The scripts compile against the Unity 2021.3 API with Mono,
with no errors or warnings. The Input System members they use were checked against that
package's source. It has **not** been opened or run in the Unity Editor yet: nothing here could
run Unity. Expect a round of small fixes when you first open it, and report any console errors.

## Open it

1. Install **Unity Hub** and a Unity Editor (**2022.3 LTS** or **Unity 6**). Add the
   **iOS Build Support** module if you want to put it on an iPhone, or **WebGL Build Support**
   for the browser.
2. Unity Hub → **Add → Add project from disk** → choose this `unity/` folder.
3. When Unity asks about the **new Input System**, click **Yes**. It restarts the editor.
4. Open any scene (the default `SampleScene`, or **File → New Scene**) and press **Play**.

### Controls

- **Keyboard:** W / S throttle and brake, A / D steer, **Shift or Z: wheelie** (hold it; Q / E
  raises or lowers it), F boost, R reset.
- **Tricks:**
  - **J: bunny hop.** Tap for a small hop, or hold up to 0.6 s to charge and release for a big
    one.
  - **A / D in the air: whip.** It throws the bike sideways; it straightens itself before
    landing.
  - **Q / E in the air:** back and front flips.
  - **T in the air: pose.** Superman; with A or D held, Can-Can; with E held, No-Hander. Let
    go before landing, or it counts as a bail.
- **Gamepad:** right and left triggers for throttle and brake, left stick to steer, A for
  wheelie, B to jump, X for tricks, RB for boost, Y to reset.
- **Touch** (on the phone, landscape):
  - left half: a floating stick for steering and lean;
  - right side: THROTTLE pad, BRAKE, WHEELIE, BOOST, JUMP and TRICK buttons;
  - RESET at the top right.

## Graphics

Everything is generated in code when Play starts. There are no art files to import.

- **Sculpted models.** The bike bodywork, battery case, swingarm, rider (torso, helmet, arms,
  legs, boots) and the cars are each one smooth surface. They are modelled as signed distance
  fields and meshed at startup (`Sdf.cs`, `BikeArt.cs`, `CarArt.cs`). There are no boxy
  primitives.
- **PBR materials** use procedural albedo, normal and smoothness maps (`ProcTex.cs`) for:
  - asphalt, concrete pavements and grass;
  - brick, plaster, concrete and glass facades with recessed windows;
  - tyre tread and riding-kit fabric.
- **Lighting:**
  - a warm sun with soft, very-high-resolution cascaded shadows;
  - a procedural sky with a sun disc, which also supplies the ambient light;
  - a realtime reflection probe that follows the bike, so car paint and glass reflect the
    street;
  - exponential fog;
  - MSAA and HDR.
- **Post-processing** (`PostFx.cs` + `Resources/Shaders/StarkVargPost.shader`): bloom, ACES
  filmic tonemapping, a light colour grade and a vignette. Phones get lighter settings
  automatically (2 shadow cascades, 2× MSAA, a smaller probe).
- **Project settings.** `Assets/Editor/StarkVargProjectSetup.cs` switches the project to
  **Linear** colour space (needed for correct PBR) and landscape-only the first time it opens.
  Unity re-imports for a minute when this happens; that is normal.
- **Startup cost.** Building the meshes takes about 1–2 s on a Mac, and longer on a phone.

## Make it look like the real thing

The procedural bike and rider can be swapped for imported assets:

- **Your own bike or rider model.** Put a prefab named `BikeModel` and/or `RiderModel` in
  `Assets/Resources/`, and it replaces the placeholder automatically.
  - Bike convention: origin on the ground under the middle of the wheelbase, facing +Z,
    about 1.48 m wheelbase.
  - Child objects named `FrontWheel`, `RearWheel` and `Steering` are spun and turned if
    present.
  - Detailed motocross bikes and riders are on the Unity Asset Store (some free), Sketchfab
    and CGTrader. Check each model's licence.
- **URP for better lighting.**
  1. Package Manager → install **Universal RP**.
  2. Create a URP asset (Assets → Create → Rendering → URP Asset (with Universal Renderer)).
  3. Assign it in Project Settings → Graphics and Quality.
  4. Materials made by the scripts switch to URP/Lit automatically.
  5. Add a **Volume** with Bloom, Tonemapping (ACES) and Color Adjustments (`PostFx` only
     works in the built-in pipeline and switches itself off under URP).
- **Real city assets** can replace `CityGenerator`, for example a modular city pack placed in
  your own scene. The bike works in any scene that has colliders on the ground and the
  buildings.

## Build for iPhone

1. File → Build Settings → **iOS** → Switch Platform.
2. In Player Settings → Resolution and Presentation, set **Default Orientation** to
   **Landscape Left** or **Auto Rotation** with only the landscape options ticked. The code
   already forces landscape at runtime.
3. Build. Open the generated Xcode project on a Mac, sign it with your Apple ID and run it on
   the phone.

## Build for the web (Cloudflare)

File → Build Settings → **WebGL** → Build. Upload the output folder as a static site. Unity
WebGL runs on iPhone Safari, but loads slower and uses more memory than the Three.js version.
Keep textures small, and use the "Brotli" compression with the matching Cloudflare headers.

## Code map (`Assets/Scripts`)

| File | What it does |
| --- | --- |
| `GameBootstrap.cs` | Builds the light, fog, city, traffic, bike, camera and HUD when Play starts. Skips itself if the scene already has a `BikeController`. |
| `BikeController.cs` | Arcade physics (Rigidbody): traction then power-limited acceleration, coordinated lean and yaw, held wheelies, boost, crashes only on hits over 30 mph. Tricks: charged bunny hop, air whip (it straightens before touchdown), flips, Superman / Can-Can / No-Hander poses, and trick naming and scoring on landing. |
| `BikeVisual.cs` | Lean, wheelie pitch about the rear axle, steering and wheel spin; assembles the procedural bike and rider (or your prefabs). |
| `BikeArt.cs`, `CarArt.cs` | Sculpted bike, rider and car meshes (SDF shapes). |
| `Sdf.cs`, `MeshGen.cs` | Surface-nets SDF mesher; tubes, tyres, discs, world-UV boxes. |
| `ProcTex.cs` | Procedural PBR texture sets. |
| `PostFx.cs`, `EnvProbe.cs` | Bloom / ACES / grade / vignette; following reflection probe. |
| `BikeInput.cs` | Keyboard, gamepad and multi-touch, for both the new Input System and the legacy Input Manager. |
| `CityGenerator.cs` | Street grid with PBR asphalt, markings and granite kerbs; facade-textured buildings with roofs, shopfronts and awnings; leaf-card trees; lamps; static batching. |
| `TrafficCar.cs` | Lane-keeping electric cars (three sculpted body styles, rolling alloy wheels) that turn at junctions and brake for whatever is ahead. |
| `ChaseCamera.cs` | Follow camera with speed FOV, lean roll and wall avoidance. |
| `Hud.cs` | Speed, boost meter, wheelie distance and best, and the touch-button overlay (IMGUI). |
| `Mats.cs`, `Shapes.cs` | Material factory (built-in Standard / URP Lit) and primitive helpers. |
