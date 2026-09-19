# AUTONEX — INDIADRIVE AI · City V3

Frontend-only SIH interactive 3D project showcase.

## V3 changes

- Keeps the temporary procedural sports coupe for now.
- Adds a visible 3D cockpit: dashboard, instrument glow, steering wheel and seats.
- 10.5-second automatic opening sequence:
  1. distant hero-car approach
  2. low wheel/shoulder tracking
  3. city side tracking
  4. camera moves through the windshield into the driver position
- Start Engine now appears as a compact ignition control while the actual 3D cockpit remains visible.
- Larger city: three long boulevards and six cross streets.
- Long road-locked navigation; the vehicle cannot cut diagonally through blocks.
- Turn-aware speed control: faster on straights and slower at intersections.
- Real wheel rotation is driven by vehicle speed.
- 10–15 floor skyline buildings with multiple architectural types.
- Glass, terraced, faceted, offset-slab and framed towers.
- Physical red illuminated destination signboards mounted to buildings.
- Ambient traffic, long rows of street lights and increased fog depth for stronger scale.
- Six destinations with dedicated parking bays.

## Run

Install Node.js 20+.

```powershell
npm install
npm run dev
```

Open the Vite URL, normally:

```text
http://localhost:5173/
```

Do not use VS Code Live Server / port 5500.

## Replace links

Edit:

```text
src/data.js
```

Replace the placeholder GitHub, video and prototype URLs with your real project links.

## Mustang later

The current car is intentionally implemented in:

```text
src/scene/HeroCar.jsx
```

When the Ford Mustang 2023 model is ready, export it from Blender as:

```text
public/models/autonex-mustang.glb
```

Then only the car component needs to change. The city, routing, navigation, HUD and camera architecture remain reusable.


## V4 updates
- Integrated Sketchfab Ford Mustang GT500 GLB (`public/models/mustang-gt500.glb`)
- 5 AM dawn atmosphere with warm orange/blue lighting
- Lane-centered path following
- Premium cockpit glow and clearer chase view

## V5 safety-behaviour fixes
- Fixed arrival-stop bug: the car now decelerates to zero, parks, and triggers the OPEN DOOR panel.
- Added live front-vehicle detection using simulated traffic actor positions.
- AutoNex evaluates the passing lane before overtaking.
- If the passing lane is occupied or a turn is near, AutoNex waits/follows instead of overtaking.
- Overtaking performs a smooth lane shift and later returns to the normal lane.
- The vehicle slows automatically before bends/intersections.
- Amber left/right turn indicators blink during turns and lane changes.
- HUD now shows front distance, passing-lane state, indicator and AI decision.


## V5.1 docking correction
- Final 14 m enters DOCK mode.
- Lane offset smoothly returns to zero before the bay.
- Mustang stops exactly at the center of the two red parking lines.
- Destination actions are not rendered until exact docking completes.
- Red stop bar + center marker added for visual confirmation.

## V6 Stable Website Pass

This build focuses on reliability before real destination URLs are added.

- Intro no longer starts before the Mustang GLB is ready.
- Intro overlay and camera use the same render-clock progress, preventing skipped opening shots when loading is slow.
- Intro clock clamps large frame gaps instead of jumping across camera stages.
- Rendering load reduced: DPR capped at 1.25, imported Mustang shadow pass disabled, frustum culling restored.
- Start Engine is now a compact cockpit/centre-console control rather than a large floating modal.
- Mustang proportions adjusted to roughly match the simple traffic cars and fit cleanly inside the red bay.
- Left/right amber indicators remain tied to turn and lane-change decisions.
- Destination docking uses the exact destination-node coordinate that World.jsx uses for the red parking bay.
- Arrival/Open Door fires only after the final exact-centre parking snap.

Real destination URLs are intentionally left for the next pass, as requested.


## V6.1 camera + scale update
- Mustang increased to approximately normal road-car proportions (~2.0 m wide, ~4.8 m long).
- Cockpit is the default camera after Start Engine and while driving.
- Optional TOP VIEW / COCKPIT VIEW toggle added to the live world UI.
- Existing turn-indicator logic and exact red-bay center docking retained.


## V6.2 vehicle-alignment pass
- Recentered the visible Mustang body on the HeroCar route/docking origin.
- Replaced distorted non-uniform scaling with a uniform 0.90 scale (~1.99 m wide × 1.47 m high × 4.84 m long).
- Corrected vertical placement so tyre bottoms sit close to the road surface.
- Hidden exported rig-helper meshes (`extra controls_24`) and the unrelated export cone (`Cone_95`) to reduce rendering overhead.
- Existing exact destination-node docking now centers the visible Mustang inside the red parking bay before OPEN DOOR is enabled.
- Cockpit default, optional Top View, turn indicators, traffic detection and overtake/wait logic are retained.


## V6.3 cockpit correction
- Fixed intro-to-cockpit transition using vehicle-local camera coordinates.
- Driver-eye anchor moved to the GT500 steering-wheel side.
- Intro finishes at the same HOME lane position used by the cockpit state.
- Cockpit remains the default driving camera; Top View remains optional.
- Exact red-bay docking logic from V6.2 is unchanged.


## V6.4 driver-view update
- Default driving camera is rigidly attached to the driver-eye point; no fore/aft follow drift.
- TOP VIEW now restores the earlier third-person car-and-road chase view (not bird's-eye).
- Restored the Mustang skinned interior/door/window hierarchy that was incorrectly hidden in V6.3.
- Driver-side door uses its real skin bone and opens only after exact docking.
- Wheel spin is separated from front-wheel steering so all four wheels visibly rotate while driving.


## V6.5 final polish
- Uses `SkeletonUtils.clone` so the rigged Mustang's skinned doors/interior follow cloned bones reliably.
- Corrected return-lane indicator direction and stops lane-change signals after lateral motion finishes.
- Tightened final docking convergence so the visible Mustang is already centered before exact bay lock.
- Driver camera remains rigidly fixed to the driver-eye point; FOV adjusted for less cockpit distortion.
- TOP VIEW remains the prior third-person car + road camera and now avoids transitioning through the car body.
- WebGL requests the high-performance GPU path and slightly reduces maximum DPR for steadier animation.


## V6.6 stability fixes
- Corrected overtaking and return-lane indicator direction for the road coordinate convention.
- Arrival now requires exact red-bay centering AND near-zero physical speed before PARK / OPEN DOOR.
- Removed any duplicate indicator geometry from the Mustang light groups.


## V6.7 cockpit and traffic-car fix
- Cockpit camera moved to a true driver-eye windshield position
- Wider in-car FOV and tighter near clip for interior visibility
- Added visible side-door detailing to ambient traffic cars


## V6.8 visibility and wheel fix
- Cockpit camera moved forward/lower for a clear road view
- Wider driver-view FOV
- Bonnet/hood hidden during cockpit view for visibility
- Wheel rotation strengthened and applied to visible wheel meshes


## V6.9 cockpit-seat and intro-wheel fix
- Cockpit camera moved back to the actual driver-seat area
- Hood/bonnet restored so engine bay is no longer exposed
- Stronger wheel spin, especially during the intro animation
- Intro speed increased so wheel motion is more visible


## V7.0 mechanical audit
- Cockpit anchor is derived from the real steering-wheel position in the GLB
- Wheel spin moved to the four true DEF-Wheel center pivots
- Front-wheel steering + wheel spin are composed on the same pivots
- Physical wheel angular speed replaces over-spun animation to avoid strobing
- Bonnet/hood is explicitly kept visible as the engine cover
- Existing exact red-bay docking and arrival gating are retained
