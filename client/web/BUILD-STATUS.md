# Ski and bike web build — 2026-10-16

Skiing (Granite Cirque) and mountain biking (graded T5/T6) run the shared
`shared/activities/ride.js` rules on the core's ground, trails and snow stamp. A
chase camera follows, with first person on V or gamepad Y. Startup verifies 69
fetched files. The new snow stamp and graded treads are drawn by small additions
to `style.js` and `details.js`.

On `main` this build is merged with the 2026-10-16 visual fidelity pass (softer
crowns, water and ground, and a ridge ring on the horizon). On the block, only
the core snow stamp draws snow. After the merge,
`node --test client/web/tests/*.test.mjs` gives **115/115**. Before it, this
branch alone gave **114/114**, including 11 ride checks.
Headed Chromium at 1440×900 and 1× drove both sports through the client's real
gamepad path with a stand-in gamepad, with no page errors. Over 240 frames per
sport: p50 16.7 ms and p95 17.6 ms. Full simulated bike descents in the page
with the client's tree hit test finish both trails without a crash. The 390×844
layout has no overflow. Physical controller feel is unverified. Figures,
captures and limits are in [the current handoff](../../docs/HANDOVER.md).

---

# Alpine web build — 2026-10-13

The local working tree implements the current shared alpine/flight world.
Nothing was committed or pushed. No new runtime/build dependency was added.
Run `python3.11 client/web/tools/serve.py` from the root, or inspect the active
[review server](http://127.0.0.1:8001/client/web/scene.html).

Shared sources and generated data are described in
[the current handoff](../../docs/HANDOVER.md),
[flight rules](../../shared/activities/README.md), and
[the forest assortment](../../shared/geometry/redwood/FLIGHT-ASSORTMENT.md).
The human's explicit flight request authorizes source-derived near/far rendering;
the same core individuals remain represented through every swap.

## Validation

`node --test client/web/tests/*.test.mjs`: **103/103 pass**. The formerly failing
partition mutations use a core-generated nonempty wire specimen; the actual
retired partition has separate empty-state checks. No legacy failures remain in
this web suite. Changed Python modules have zero pyright errors and one existing
export warning. The broader core run's changed-world assertions were repaired
and their affected classes rechecked; the final focused core run passes 14 checks.
Schemas and generated placement/stamp/map freshness pass. Whole-repository
pyright and a complete final shared-suite rerun are not claimed.

Startup hashes **64 fetched files**, including core JSON, shared flight/ecology
rules, both float buffers, live source, vendor modules and actual GLBs. A
single-byte buffer mutation stops startup and identifies `heightmap.f32`.
The generation Git label remains a label, not a clean-checkout certificate.

Headed Chromium at 1440×900, 1× exercised all views, keyboard walking and all
three activities. The parakite is free flight with energy-preserving dive/flare
control and a distinct wing. A motor flight remained airborne for 30 seconds
and traveled more than 300 m. Physical controller feel is unverified.
Every one of the 10,362 tree transforms stayed represented across the measured
near/far transitions. Cumulus can be entered; depth clips it behind the world.

Forced context loss paused frames; restoration rebuilt tree/shore targets and
resumed. Eleven resource-deletion warnings occurred during the forced restore /
cleanup sequence; no JavaScript or shader error occurred. The restored image was
opened. Mobile 390×844 has no document-width overflow. Optional procedural sound
starts/suspends on the button; no subjective listening verdict is claimed.

## Local frame observations

Headed Chromium, 1440×900, 1×. Four inspection views and two unpowered modes
were measured for 240 consecutive intervals each; motor flight for 1,800
intervals (30 seconds), with screenshots outside the measurement. Observed p50
was 16.7 ms and p95 17.4–17.6 ms. Motor flight traveled 339 m and remained
above ground. Beauty-plus-cloud/composite submissions ranged from 2.64 to
5.13 million triangles and 90–896 draws in these views. These are browser
frame intervals and submission counters, not GPU timings or a sustained
cross-device/thermal claim. The last ground-colour blend repair received an
additional fresh browser/pixel check after this measured run.

## Opened visual evidence

Ignored `output/playwright/alpine-*-final.png` contains home, mountain, river,
village, each flight mode, mobile and restored views. `alpine-qa.json` contains
raw observations. The home view shows dense grass/flowers and source trees; the
river view shows fish beneath green water, shore insects/plants and mossy stones.
The mountain view shows exposed granite, forest glades, cumulus and the river
system. The style remains visibly geometric. Water highlights and banks still
need refinement, and distant canopies remain source-baked approximations.
These opened images establish the current local result, not human acceptance.

The ordered next work and Unreal parity/integration limits are in the current
handoff. The older sections below are historical.

---

# Web client integration — 2026-10-13

The shared format correction, complete toon web client, existing Unreal render
deletions, stamp layout repair and documentation are organized into separate
commits and integrated locally into `main`. Nothing was pushed. Browser captures
stay on disk under `output/playwright/`, now ignored; no source changes remain
uncommitted after this integration.

## Commit boundaries

- `cbda62d`: correct meadow uint16 index declarations in the shared writer and
  13 GLBs. Comparison against the parent proved every binary geometry buffer is
  unchanged; only the component declarations differ.
- `09713e9`: the web renderer, height-grid generator/buffers, tests and vendored
  Three.js r180. Both vendor modules matched the pinned upstream tag byte-for-byte;
  [vendor/README.md](vendor/README.md) records checksums, URLs and the MIT license.
- `40c8bfe`: the 22 Unreal render deletions already present before this work,
  isolated from the implementation. Their pixels remain recoverable in history.
- `bd9fb7d`: compact the 2D provenance stamp's line leading after the additional
  far-field digest grew its box. Every line and the displayed font floor remain;
  all seven existing layout properties pass without weakening tests.
- The documentation commit records final checkout evidence and remaining limits.

## Clean checkout evidence

A new local Git clone of the integration branch was tested without copying any
untracked files. Unreal LFS binaries were left as pointers because this was a
web-client check; no Unreal build or visual acceptance is implied.

- All 54 focused 3D tests pass. The terrain probe now checks the committed height
  grid actually rendered by the browser, so it does not require the ignored,
  unused `shared/geometry/terrain/terrain.glb` from a prior local generation.
- All seven stamp-layout tests pass; the complete web suite passes **83/93**.
  The 10 remaining failures also occur on baseline `2bad796`, which passes 27/39.
  The updated manifest resolves two baseline failures; the integration comparison
  caught and fixed the stamp regression. No newly failing test names remain.
- Regenerating `hillshade.png`, `heightmap.f32` and `farfield.f32` in a temporary
  output directory reproduces identical bytes. The manifest reproduces identically
  except its deliberately changing generation-commit label. Stored `2bad796`
  identifies the original data-generation moment, not the current renderer.
- The three changed Python files pass pyright with zero diagnostics, in both the
  working tree and clean clone. Repository-wide pyright still reports 129 errors
  and one warning in other source/tests; that broader check is not green.
- The shared GLB suite passes 81/82; its water triangle-count contract failure
  reproduces on baseline, with unchanged water asset and contract files.
- Fresh Chromium served from the clone reached `Take your time.` and completed
  120 frames without runtime/shader errors. Initial local-server connection resets
  required one reload; no missing file was involved. The opened capture is
  `output/playwright/toon-clean-checkout.png`, ignored and regenerable.

The longer visual/performance record below is still applicable. Human approval
of the cozy direction, further grass/crown/bank refinement, sustained performance,
other browsers/devices, first-person/gamepad input, habitat/audio parity, fetched-byte
provenance and the 10 baseline partition failures remain open. Source integration
is complete; those product and verification tasks are separate.

---

# Earlier toon and lighting pass — 2026-10-13

This section supersedes the earlier inspection-build status below. The build is
local and uncommitted. No new runtime dependency, core data edit, world placement,
commit or push was introduced in this pass; preserve the unrelated working-tree
changes and deleted Unreal renders.

## Delivered

- `src3d/style.js`: real MeshToonMaterial lighting with a shared four-step ramp,
  warm sun/cool fill, foliage rim fill, procedural meadow variation, procedural
  sky/clouds and animated opaque depth-coloured river/reservoir shaders. Native
  renderer tone mapping, colour management, fog and shadow support are retained.
- `main.js`: golden/morning/evening light controls; a 2048 px local sun shadow map
  cached until light or its quantized target changes; bounded three-worker asset
  fetch/decode; async shader compilation; 1× default pixel scale; optional scale
  control; hidden-tab pause, context recovery and teardown. No extra fullscreen
  postprocessing pass or PBR lighting pipeline is required.
- `forest.js`: 22 height slices × 12 azimuth sectors measure the source redwood
  foliage envelope and form a continuous lobed crown. All 17,208 core tree
  transforms survive. One 528-triangle kit is shared across 312 static 192 m
  batches, culled conservatively by the renderer. No near/far geometry swap or
  radius omission remains. Original source needle geometry is released after the
  stylization is constructed. This changes presentation fidelity uniformly.
- `groundcover.js`: all 140,323 stamp cells use the same 42-triangle grass/flower
  kit in 681 128 m batches. Wind runs in the vertex shader; flower colours use
  the stamp's published mix and deterministic 24 m colour drifts. Conservative
  bounds include wind. This kit is a client interpretation of the density stamp.
- `terrain.js`: upward face winding; correct one-sided normals on all four
  borders; brighter slope/elevation palette. No terrain resampling or carving.
  World-space water draws the union of its named parts exactly once.
- `glb.js`: embedded images resolve by image index rather than bufferView index;
  textures and multiplicative base colour factors survive single-primitive
  batching. RGBA vertex colours retain dome glass transparency.
- `controls.js` / `scene.html`: clear homestead, river and elevated valley camera
  bookmarks, corrected right/middle/Ctrl-left panning and disposal, usable pan
  scale, no leftover damping after a bookmark reset, responsive scene controls,
  and optional diagnostics in Field notes. Camera bookmarks do not alter core data.

## Browser evidence

Local installed Chromium, headed, 1440×900 canvas at 1× scale. Each view was warmed
for 500 ms, then **240 consecutive requestAnimationFrame intervals** were measured;
screenshot work happened afterward. No page or shader errors during that run. Six harmless undefined-side material
warnings were then eliminated by using explicit FrontSide/DoubleSide values.
A fresh final startup, orbit and lighting-selection check returned zero errors
and zero warnings. The temporary verification browser was closed afterward;
the root HTTP server remains on port 8000 for inspection.
These intervals include browser scheduling and presentation, not isolated GPU time.

| View | Draws | Submitted triangles | p50 interval | p95 interval | max interval |
|---|---:|---:|---:|---:|---:|
| Homestead | 466 | 9,423,280 | 16.7 ms | 17.4 ms | 17.7 ms |
| River | 101 | 1,605,546 | 16.7 ms | 17.5 ms | 17.7 ms |
| Elevated valley | 689 | 10,475,146 | 16.7 ms | 17.6 ms | 17.7 ms |

CPU submission snapshots were 0.9–3.1 ms. Draw/triangle counters describe the
steady beauty pass; they exclude the cached shadow update. Shadow updates on
view/light changes can still produce a spike. No GPU timer, thermal soak,
physical-controller test or other-browser performance result was obtained.

The previous startup submission was 61,153,176 triangles. The camera framing,
visibility rules, geometry and lighting changed, so do not turn that comparison
into a controlled FPS speedup. The first toon draft still submitted 15.8 million
triangles in the homestead and ran around 33 ms; uniform kit simplification
removed that avoidable workload while retaining all cells and tree instances.

Opened local evidence (regenerable, untracked):

- `output/playwright/toon-before.png`: original dark scene with missing ground.
- `output/playwright/toon-home-verified.png`: readable house, flower meadow,
  warm/cool shading and long soft shadows.
- `output/playwright/toon-river-verified.png`: turquoise water, flowing highlights,
  cleared sightline and both banks.
- `output/playwright/toon-valley-verified.png`: whole-landscape distribution,
  meandering river, forest, distant settlements and sky.

Lighting selectors and right-drag panning were exercised in the browser.
Deliberate context loss stopped frame advancement; restoration resumed it.
Daylight, evening and 390×844 mobile screenshots were opened. Native context
reset behaviour outside this deliberate extension remains untested.

Source owns the result; leave the screenshots out of commits. Serve from the root
with `python3 -m http.server 8000 --bind 127.0.0.1`, open `client/web/scene.html`,
use 1/2/3 for the same views. Hard-refresh after source updates. Lighting changes
are client-only and never save into shared JSON.

## Verification and next work

The focused suite passes **54 tests**:

```sh
node --test client/web/tests/assets.test.mjs \
  client/web/tests/controls.test.mjs client/web/tests/glb.test.mjs \
  client/web/tests/heights.test.mjs client/web/tests/placements.test.mjs \
  client/web/tests/world.test.mjs client/web/tests/rendering.test.mjs
```

Properties cover triangle winding versus normals, all source tree transforms
exactly once through static batches, finite culling bounds, stamp coverage and
height alignment, embedded texture retention, glass alpha and usable/reset-safe
controls. Obsolete tests requiring near/far substitution were replaced by the
uniform-geometry/transform property. The full suite observed 81/92 passing before
the additional glass regression; the same **11 older 2D partition/digest/stamp
failures** remain and were not weakened. The focused suite then passed 54/54.

Remaining, in order:

1. **Visual refinement:** the crown is a stylized hull, meadow blades remain
   visibly angular/repetitive up close, banks retain the core's polygonal form,
   and the far-field ground is sparsely detailed. The tree hull does not claim
   needle-level source fidelity. Human acceptance of the cozy direction is open.
2. **Longer profiling:** cached shadow refreshes, continuous pan/orbit through
   dense forest, memory/thermal behaviour, lower-end hardware and other browsers.
   The measured short views run near 60 Hz; sustained 60 FPS is not established.
3. **Client parity:** first-person/gamepad navigation, core habitat life and audio
   still need their own implementation. No new world systems were invented here.
4. **Integration:** repair older 2D tests and fetched-byte provenance; review the
   pre-existing vendor/buffers/generator and shared index-width changes before
   committing a reproducible checkout. No clean-clone verification was performed.

---

# Earlier inspection-build record — 2026-10-13

`scene.html` is a working **read-only 3D inspection build** in the local working
tree. It uses the vendored Three.js r180 ES modules in `vendor/`, with no npm
install, bundler or transpilation step. The browser consumes the core's exported
data; it does not run Python, edit the world, or provide the Unreal gameplay.

**Status:** implemented and briefly browser-verified; visual acceptance,
first-person/controller navigation, sustained performance and clean-checkout
integration remain open. The 3D source, vendor modules, two height buffers and
3D tests are currently untracked. The manifest and data generator have local
edits. HEAD is `2bad796`; that is also the manifest's generation label, not a
commit containing this build. No build/fix commit or push was made in this chat.

## Run and regenerate

Serve from the repository root so both clients can read `shared/`:

```sh
# from the repository root
python3 -m http.server 8000 --bind 127.0.0.1
```

- 3D: <http://127.0.0.1:8000/client/web/scene.html>
- Existing 2D map: <http://127.0.0.1:8000/client/web/>

Current mouse bindings in `src3d/controls.js` are left-drag orbit, middle-drag
pan, and right-drag or wheel zoom. The page incorrectly advertises right-drag
pan. Ctrl-left also enters orbit before its intended pan branch. There is no
first-person or Gamepad API implementation.

If data is missing or stale, regenerate before serving:

```sh
python3.11 client/web/tools/make_viewer_data.py
```

This writes `data/hillshade.png`, `data/heightmap.f32`, `data/farfield.f32` and
`data/viewer.json`, using the core's heightfield readers. Both float grids have
south-up rows (`row_0=min_y`); the manifest declares their dimensions and pitch.
Regeneration changes these local artifacts. The browser itself writes no files.

A browser can retain a WebGL block after context loss. Close the scene tab,
fully quit/reopen the browser, then reopen the page and hard-refresh (macOS:
Cmd-Shift-R). A hard refresh was needed during verification to discard an old
module. The client reports denied context creation, pauses on loss and resumes
on restoration; creating another canvas does not remove a browser block.

## What exists

| Area | Implementation |
|---|---|
| Ground | Block terrain and far-field ring from the exported height samples; client colours and normals. `src3d/heights.js`, `terrain.js` |
| Assets | A restricted GLB reader for the core's emitted format, named parts, transforms, vertex colours and material factors. `src3d/glb.js`, `world.js` |
| Placements | Non-forest instances batched by asset/part/material; world-space water handled separately. Current input has 17,283 instances. `src3d/placements.js` |
| Forest | 17,208 core-published trees; full geometry inside 100 m, client-generated conifer silhouettes from 100–2,500 m, omitted beyond. These are existing presentation compromises, not approved fidelity. `src3d/placements.js` |
| Meadow | 140,323 stamped cells interpreted as scaled grass tufts in four 2,048 m tiles. The live scene does not implement the documented flower mix. `src3d/main.js`, `groundcover.js` |
| Rendering | Directional/hemisphere light, fog, tone mapping, orbit controls, live workload stamp and context-loss handling. Shadows are disabled. `src3d/main.js`, `controls.js` |

The repair passed the far-tree result's `.geometry` to `InstancedMesh`, removed
the generic path's duplicate full-detail forest, used the camera's scene x/z
axes for distance checks, refreshed instance bounds, and stopped idle controls
from zooming automatically. Rendering stops after a render exception instead of
scheduling the same failing frame indefinitely.

## Evidence and its limits

The 2026-10-13 Chromium check at camera `(-1600, 200, -780)` in scene metres
reached `ready`, produced an opened screenshot, and completed 120 animation
frames with no uncaught errors. The interval including screenshot capture was
11,189 ms; this is a short stability observation, **not an FPS benchmark**.

| Renderer stamp | Observed value |
|---|---:|
| Submitted triangles in the earlier overloaded frame | 13,184,171,356 |
| Submitted triangles in the corrected startup frame | 61,153,176 |
| Draw calls in the corrected frame | 27 |
| Generic placement parts / draws | 86 / 18 |
| Selected near / far trees | 74 / 12,012 |

These are renderer submission counters, not visible-pixel counts, GPU timings
or the core's source-triangle census. The two frames did not use identical
selection behaviour because the camera-axis and idle-zoom faults were fixed.
They establish removal of the overload, not a controlled performance ratio.

WebGL's `WEBGL_lose_context` test extension confirmed pause and restoration to
`ready`. A separately simulated denied context confirmed that the actual
creation reason and browser-restart instruction reach the status line. This
does not prove recovery from every real GPU/driver failure or clear the human's
already blocked browser session.

`output/playwright/three-context-fixed.png` is the local, untracked screenshot;
it was opened and shows the trees, turbines and water, with very dark/missing
ground and coarse distant silhouettes. It is evidence of rendering, not a
visual-target pass. Temporary CLI logs were moved out of the repository to
a temporary folder; temporary evidence is not durable
checkout content. The verification browser was closed. The human's HTTP server
was left running after verification; the later documentation check found no
listener on port 8000. Start it with the command above and check the port before
starting another copy.

The final focused suite passed **54 tests**:

```sh
node --test client/web/tests/assets.test.mjs \
  client/web/tests/controls.test.mjs client/web/tests/glb.test.mjs \
  client/web/tests/heights.test.mjs client/web/tests/placements.test.mjs \
  client/web/tests/world.test.mjs
```

Regressions cover geometry events/bounds, exclusive forest drawing, horizontal
camera selection, moving culling bounds and idle-camera stability. Each new
failure was observed before its corresponding fix. The earlier full web run
had 11 failures in the older partition-digest, partition-identity, 2D scene and
stamp-layout tests; a green focused suite does not clear that baseline.

## Immediate gaps and ordered next work

1. **Restore visible ground and correct water submission.** A source/data probe
   of `buildBlockTerrain` found the first face normal's y is `-0.999793`, while
   its supplied normal's y is `+0.999788` and its material is `FrontSide`.
   Triangle winding therefore faces downward; the far-field uses the same
   builder. Correct the winding and inspect ground from above and at eye height.
   `buildWater` currently emits `river:0, lake:0, river:0, lake:0` for the two
   water records. Both core records also list both named parts, so filtering
   only by `instance.parts` would still repeat them. Reconcile body/part
   selection with the core's world-space contract, draw each part once and
   check transparency at both bodies. Replacement terrain/water geometry is
   not needed to address these findings.
2. **Measure interactive cost after correctness fixes.** About 61 million
   submitted triangles at the start remains substantial. Profile frame times,
   memory, dense stands, camera travel, resize and longer thermal runs. Forest
   meshes span the stand and meadow tiles are 2 km wide, limiting culling.
   Instancing reduces draws/storage but does not remove submitted triangles.
   No 60 FPS, all-view stability or cross-browser claim is established.
3. **Close the visual fidelity gap.** The opened image has coarse dark distant
   trees and unconvincing ground/water. The so-called billboards are fixed
   tapered cone meshes, not camera-facing textured billboards. Distance-based
   substitutes conflict with the world's no-distance-ladder target and remain
   unresolved. Blimp PNG bytes are parsed but never decoded/applied by the live
   scene; merged material colours lose that texture. Meadow flowers, shadows,
   animated water and broader material parity are absent. Review matched views
   after fixes; do not interpret crash recovery as visual acceptance.
4. **Deliver the requested inspection navigation.** First-person movement,
   DualShock input, safe focus/disconnect handling, return-to-start and named
   bank viewpoints are absent. Fix the mouse help/bindings; `controls.dispose()`
   also references nonexistent `handleWheel` instead of `handleMouseWheel`.
   Keep physical controller feel unverified until used on the actual device.
5. **Represent the existing living world.** The web scene does not read
   `shared/ecology/habitats.json` or run the waterside fish/frog/dragonfly
   behaviours, bank planting or spatial audio. Those exist in the core/Unreal
   work described in the preceding handoff; this browser build has not reached
   that experience. Add clients of existing core data before inventing new data.
6. **Make provenance and the older suite reliable.** The 3D stamp displays the
   manifest commit and workload but does not hash fetched bytes or compare
   current sources with generated buffers. Local edits can therefore render
   under `2bad796` without being identified. Reconcile the 11 older test failures
   with the retired field partition and current stamp layout; retain meaningful
   mutation checks instead of weakening assertions just to get green.
7. **Integrate a reproducible checkout.** Review the untracked `scene.html`,
   `src3d/`, `vendor/`, six 3D test files and two `.f32` files, plus existing
   generator/manifest and GLB index-width edits, as a coherent build. Record
   vendor source/checksums/license provenance and verify from a clean checkout.
   Preserve unrelated shared-asset edits and deleted Unreal renders. No new
   dependency is approved by this status note, and none should be added without
   the root approval process. This documentation update does not stage, commit
   or push the implementation.

These next steps are findings and proposed continuation, not new human design
decisions. The core/world charter and the Unreal waterside acceptance gaps
remain in force; see `docs/design/WHAT-THE-WORLD-IS.md` and `docs/HANDOVER.md`.
