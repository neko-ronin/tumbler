# Tree studio and feral forest integrated — 2026-10-23

All studio, tree-update and game-integration work is combined for main at the
human's request. The persistent studio retains current settings, notes and
named plans; the game uses species-specific Feral crowns and repaired lighting.
Main's existing sky/shadow repairs remain. Large model delivery is lossless and
fits the host limit. See the [integration receipt](../../docs/reviews/tree-main-integration-2026-10-23.md) for conflict choices,
checks, source identities and publication status. Earlier local-only entries
below describe their original checkpoints.

---

# Repaired Web v0.1.1 release — approved, 2026-10-22

The human authorizes main integration, publication and cleanup of
`codex/web-sky-clouds-next`, superseding the local-only boundaries below.
This release keeps the 30 FPS cap and cloud/sky work, repairs moving and tree
ground shadows, and removes canopy self-shadow reception. The rejected canopy
experiment stays on `codex/canopy-self-shadowing-experiment` at `cf34ddf`.

Final source verification: web **218/218**, packaging **7/7**, integrity **90
scene + 17 map files**. Moving-fabric no-reception and retained ground-shadow
controls pass in all three lights. This does not close physical-controller,
audio/haptics, cross-device/thermal performance or Unreal acceptance.

The [release receipt](../../docs/reviews/web-011-repair-release.md) records integration,
publication and cleanup. All ignored review evidence is preserved in the primary
checkout under `output/playwright/archives/web-sky-clouds-next-20261022/`, with per-file SHA-256 verification;
it remains outside Git and the public package. Older paths and status entries
below describe earlier checkpoints.

---

# Canopy self-shadowing removed — local, 2026-10-22

The human rejects canopy self-shadowing for publication. Preserve the complete
experiment on `codex/canopy-self-shadowing-experiment` at `cf34ddf` (runtime
`711e433`); do not merge that branch wholesale. Its ignored captures remain in
`output/playwright/canopy-banding/` in this worktree. The records below are
historical and do not imply approval of self-shadowing.

`codex/web-sky-clouds-next` removes reception of the moving-actor shadow map
from the wing material, while retaining canopy/Ronin casting onto the world.
Cloud shading, fabric palette, backlighting, normals, toon ramp, Ronin and tree
rendering remain unchanged. The [removal brief](../../docs/reviews/canopy-self-shadow-removal.md) records exact moving-fabric
negative controls and retained ground-shadow checks. Main/production remain
unchanged; this continuation does not authorize deployment.


Verified zero actor-mask contribution on both moving canopies in all three
lights, with ground silhouettes/freshness retained. Web **218/218**, packaging
**7/7**, integrity **90 scene + 17 map files** pass. New local comparison:
<http://127.0.0.1:8021/output/playwright/canopy-self-shadow-removal/review.html>.

# Moving canopy shadow refinement — isolated, 2026-10-22

The human accepts the prior repair's stated tradeoffs and confirms the major
flicker improvement, with remaining moving self-shadow banding. The refinement
uses continuous PCF coverage and a tighter fixed 24 m flight map with 64 m separated-actor fallback at the same
texture size. No palette, base-normal, toon-ramp, core asset or physics change.

Six moving-cloth cases cover both wings and every light preset; shadow coverage
remains complete, the coarse filter-step control passes, and all 30 paired
shadow-disabled frames are byte-identical. The [banding brief](../../docs/reviews/canopy-banding.md)
records controls, retained intermediates, ordinary-play evidence and final
performance. No merge or deployment. Human visual acceptance remains open for
this refinement; the records below describe earlier checkpoints.

Final retained surface/ground/recovery checks pass. Web **218/218**, packaging
**7/7**, integrity **90 scene + 17 map files** pass. The final fixed-1440×900 trace averages 29.92–29.98 FPS across flight,
clouds and forest walking, with 34.1–34.2 ms p95 and isolated longer stalls.
The opened local comparison and raw evidence are recorded in the banding brief.

---

# Visual repair in progress — isolated, 2026-10-21

The human rejected v0.1.1 after live review. Main rollback `f845716` restores
the exact prior v0.1.0 tree; no repair has been merged or deployed. The entries
below record historical publication and do not imply visual acceptance.

Repair branch: `codex/web-sky-clouds-next`. The [repair brief](../../docs/reviews/web-011-repair.md)
preserves before/after temporal failures, causes and performance limits.
Corrected actor depth/receiver/map motion and full-source tree casters are
verified by GPU probes and normal-play recordings. Web **217/217**, packaging
**7/7**, integrity **90 scene + 17 map files** pass. The 225-second trace has
33 ms median and 35–48 ms p95 across phases; frame pacing still needs work. The coarse static
four-metre tree bake has been removed. Human visual acceptance remains open.

---

# Rejected Web v0.1.1 release — 2026-10-20

30 FPS presentation, stabilized per-frame wing/Ronin shadows, cached volumetric
sunlight, rounded cloud billows and cloud shade on trees/water/Ronin are complete.
Static tree-ground shade now reuses a lazy bake per fixed sun preset; it preserves
the previous soft crown approximation, with at most 48 MiB of texture memory.
It is not a branch-accurate full-scene lightmap.

Private web **216/216**, packaging **7/7**, integrity **91 scene + 17 map files**.
The three-minute 1440×900 trace measured p50 **33.3 ms**, p95 **34.2 ms** in both
normal flight and cloud traversal, with five rare intervals over 40 ms retained.
Actual actor/terrain pixels, static mask reception, graphics recovery and cloud
bounds/depth/solar negatives pass. See the [v0.1.1 review](../../docs/reviews/web-011.md).
Live at **https://tumbler.catronin.com/**. Initial public release `98d2b2c`
verified manifest `7debee5aa228`; public web **200/200** and packaging **7/7**
pass. The live browser matches all fourteen changed runtime modules, renders
v0.1.1 at the 30 FPS cap and compiles every shader. The publication log holds
the latest receipt. Physical controller, human visual approval, longer thermal
testing and Unreal parity remain separate.

---

# Earlier sky/cloud second-pass checkpoint — 2026-10-20

On `codex/web-sky-clouds-next`: wider shared cloud groups, refined volume light,
cached noise startup and solar-projected terrain/meadow cloud shadows. The
accepted first-pass release below remains the published baseline.

Web **209/209**, packaging **7/7**, shared-world **5/5**; integrity **87 fetched
plus 17 map files**. Browser GPU controls cover shared bounds, opaque depth,
solar/height negatives, evolving density and observer-independent cloud wind.
The [second-pass brief](../../docs/reviews/web-sky-clouds-next.md) records the
three-minute profiles, opened comparisons and limits. The candidate trace has
higher GPU tail cost; a distance-varying sample experiment was rejected and
removed. Human visual acceptance and Unreal rendering are open; the human subsequently merged this checkpoint at `3ff9552`.

---

# Sky/cloud first pass released — 2026-10-20

The accepted runtime `25e8062` is integrated on main and live at
**https://tumbler.catronin.com/**. Initial public release `551853f`, Cloudflare
version `fbbd6dd3-9097-46d4-96cf-4e01313b3785`, passed publication checks and
live verification of manifest `8585c9577005` with compressed model delivery.

Private web **206/206**, public web **190/190**, packaging **7/7**, integrity
**85 fetched plus 17 map files**. The live scene reached Ready; all four sky
modules match main and shaders compile. An external analytics DNS failure is
recorded separately in the release report. Sustained performance, physical
flight and Unreal parity remain open. Further exploration continues on
`codex/web-sky-clouds-next`; the accepted shared cloud bounds remain unchanged.
See the [review brief](../../docs/reviews/web-sky-clouds-2026-10-20.md) and handoff
for evidence, continuation and the publication log's latest receipt.

---

# Flight v3 delivery — 2026-10-18

Source delivery `7ea5a75`, `1efb1ca`, `c5f10a8` and documentation `c993dd3`
are integrated into `main` and published at **https://tumbler.catronin.com/**.
The merge hook pushed initial public release `bfcbd05`, passed public web
**126/126** and packaging **7/7**, deployed Cloudflare version
`2b4c717f-be8b-4951-b467-75496b84420b`, and verified live manifest
`df1d70319a77` with zstd model compression. The live root page reached Ready
and its rendered frame was opened. Documentation-only hook reruns retain the
same game manifest. The [handoff](../../docs/HANDOVER.md) holds the release receipt.

The publisher also isolates Git identity across nested commit hooks. Its
**4/4 publishing checks** include real public-commit identity and unaffected
other-checkout metadata; the hygiene guard remains enabled for every push.

The [flight review](../../docs/reviews/flight-experience-2026-10-18.md) findings
are fixed in the integrated delivery. Air textures use linear filtering
only when the renderer supports it, otherwise nearest filtering. Debris spawns
inside its eviction circle and retains world-space drift. Shared mode
coefficient constraints now use `$defs` with equivalent validation.

Web **142/142**, focused Python **19/19**, package integrity **78 fetched files**
plus the map's 17; viewer hashes regenerated. Both new regressions failed before
the fixes. Browser pixel readback passes with float-linear support present or
masked, while forced-linear filtering still fails without the extension.
Schema diagnostics match the old contract across **899 cases**. Root pyright
retains **132 errors / 1 warning** in existing Python. No dependency, geography,
flight tuning or bike/ski rule change. Physical, visual and sustained-performance
acceptance remain open in roadmap R0062; Unreal parity remains separate.
Older local-only records below are historical checkpoints.

---

# Flight second pass — 2026-10-17

Saved locally on `codex/flight-experience`; no merge, push or deployment.
Preview: http://127.0.0.1:8004/client/web/scene.html .

Version-3 shared rules retain dive speed, pay flare height from kinetic energy,
add held B/Shift wingovers/spirals with damped recovery, and model modest
canopy-clearance-based ground drag relief. Rounded cell wings now show inflated
skins, intakes, reinforcement and cascaded risers; the browser adds shared-air
vegetation/debris/water wind cues and a clearer chase view. No new dependency
or geography/other-activity change was made.

Source research and approximations: [flight manuals](../../docs/design/FLIGHT-MANUALS.md).
Controls, opened judgment, exact evidence, reproduction and limits:
[flight experience brief](../../shared/geometry/flight/EXPERIENCE.md).
Web **140/140**, focused Python **19/19**, changed Python **0 errors**.
Three deliberate faults fail their properties and were restored. Startup and
packaging verify **78 fetched files**; static package **96 files / 52.3 MB**.
Root pyright retains the previous **132 errors / 1 warning** in unchanged files.

Opened ordinary-keyboard T5 dive/flare, loaded roll, intake, motor and matched
meadow wind views are saved beside the asset, with sampled motion clips.
A 90.5 s M2/16 GB local flight had three near-60-fps rolling windows at the small
431×977 viewport; this is not a complete trace or target-size sustained guarantee.
Physical pad/haptic/audio feel, repeatable near-ground handling, human visual
acceptance, sustained profiling and Unreal parity remain open. Next: physical-pad
T5 review, then a complete target-resolution frame trace.

---

# Flight simulation upgrade — 2026-10-17

Implemented locally on `codex/flight-experience`; not merged or published.
The browser preview is http://127.0.0.1:8003/client/web/scene.html .

Version-2 shared flight rules add manual-informed polars, bank/load response,
parakite handle semantics, paid dive/flare energy, motor spool/torque and
terrain-sensitive deterministic weather. The browser adds a complete controller
flow, flight instruments, moving inflated fabric, motor detail, first-person
view, adjustable speed effects, antialiasing and a resolution governor that
retains reductions only when frame pacing improves. T5's core launch clears one
pine; other geography, ground/snow stamps and bike/ski tuning are unchanged.
No dependency was added.

Research: [actual manuals](../../docs/design/FLIGHT-MANUALS.md).
Implementation, controls, opened evidence, measurements and explicit limits:
[flight experience brief](../../shared/geometry/flight/EXPERIENCE.md).
Web **133/133**, focused Python **19/19**, changed Python **0 type errors**;
root pyright retains **132 errors/1 warning** in unchanged files. Startup and
packaging verify **77 fetched files**. Static package: **95 files / 51.7 MB**.
Two deliberate physics faults fail the new properties and were restored.

Short early 1280×720 windows were near 60 fps; later windows were near 30 fps,
including at reduced resolution. This does not establish sustained 60 fps.
The final governor preserves sharpness when a scale trial does not help.
Physical controller, haptics and audio acceptance, sustained profiling and
Unreal parity remain open. Next: use a physical pad on T5, tune feel, and profile
that route continuously on a named device. The detailed brief records capture
limits and the stalled browser download.

---

# Cat Ronin integration verification — 2026-10-17

Combined the character work with main's publishing pipeline, west wind and
blimp collections. Regenerated shared outputs from the combined map, then the
browser manifest; terrain and snow bytes are unchanged, and world/placement/
grass differ from main only in their map provenance. Bicycle geometry, rules
and tuning are byte-identical. Both handoff histories are retained.

The combined web suite passes **120/120**, packaging **7/7**, and verification
covers **74 fetched files** plus the 2D map's 17. The package is **92 files /
50.7 MB**. The exact 123-file public source projection passes the existing
hygiene screen; the pinned Wrangler 4.142.0 dry run passes. Selected Python
checking passes. The ordinary local scene reaches Ready and shows the refined
cat in third-person walking. Publication uses the existing main-merge hook;
see `docs/HANDOVER.md` for the delivery record and ordered polish followup.

---

# Earlier Cat Ronin fidelity refinement — 2026-10-17

Continues `codex/cat-ronin-player` in the same managed worktree. The model now
deliberately diverges from the `catronin` source: mustard rib knit, silver-gray
tabby markings, fuller cheek fur, an open green eye with blinks, continuous
pleated hakama and a seven-joint ringed tail. Fifteen tail loops cycle through
idle, walking, running, each flight mode, banking and landing contexts.

The GLB carries the geometry, vertex colours, skin weights, animations and
embedded shirt texture. The web reader now supports skins/colours and texture
wrapping. Character-only WebGL materials add four displaced fibre shells and
fine cloth relief. No dependency was added. The bicycle model/rules and world
map are byte-identical to the preceding character commit.

Web **119/119**, package tests **5/5**, **74 fetched files verified**. Static
package: 76 files / 50.1 MB. Selected Python checking passes; whole-worktree
pyright retains the same 74 errors/1 warning in unchanged files. Opened exported
Blender renders and live WebGL studio/game captures are documented in
[`FIDELITY.md`](../../shared/geometry/cat-ronin/FIDELITY.md).

[Character studio](http://127.0.0.1:8002/client/web/tools/character-lab.html)
offers close-up views and movement selection. It is a local authoring tool and
is not packaged with the game. [Game preview](http://127.0.0.1:8002/client/web/scene.html).
Functional integration and deployment are authorized. The ordered polish
followup is recorded in `docs/HANDOVER.md`; human visual/physical-controller
acceptance, sustained profiling and Unreal fur/pawn integration remain open.

---

# Earlier Cat Ronin web character — 2026-10-16

Implemented in the managed `codex/cat-ronin-player` worktree, starting at `b903fc4`.
The original checkout's publishing work is separate. This branch is not merged
or pushed. Review: <http://127.0.0.1:8002/client/web/scene.html>.

Walking now has a third-person Cat Ronin, camera-relative keyboard/gamepad
movement, drag/right-stick camera orbit, Shift/L3 running and blended
idle/walk/run clips. The same rig uses a seated harness clip in paragliding,
parakiting and paramotoring with a chase camera; terrain contact returns it to
idle. The wings have a fitted seat/back panel, with the old proxy pilot removed.
The paramotor cage sits behind the cat. A soft contact footprint follows on
foot rather than writing the moving character into the world's cached shadows.

The imported Blender generator, clip source and regenerated GLB are together
at `shared/geometry/cat-ronin/`. `activities.character` selects a versioned,
schema-checked `shared/characters/player.json` contract. Ground movement lives
in the engine-neutral `shared/activities/walk.js`. The existing GLB reader now
retains rigid node animation (LINEAR/STEP); weighted skins remain unsupported.
No new dependency was added. The browser keeps its existing WebGL toon style,
with a generated buffalo-check shirt texture; the source website's WebGPU
shell-fur and ink shaders are not included.

Validation:

- Web suite: **118/118**, including actual animated-paw motion, grounded soles,
  diagonal-speed normalization, analogue input, collision/step refusal,
  camera-relative facing and independent camera/avatar positions, activity
  visibility, and preserved bike/ski view switching.
- Static-package tests: **5/5**. Startup/package verification covers **73 fetched
  files**. `package_web.py` produced **75 files, 48.9 MB** in ignored `dist/web/`.
- Shared authority, ground-cover, placement and world-data checks: **168/168**.
- Changed Python files: pyright **0 errors, 0 warnings**. Whole-worktree pyright
  reports **74 errors and 1 warning** in unchanged files, including absent
  Unreal-generated stubs and existing core/test typing diagnostics.
- Headed local Chromium at 1440×900, 1×: keyboard walking/running, pointer camera
  orbit, all three flights and banked turns, forced terrain contact, bike/ski
  mode switching, bike V view, and walking with a stand-in gamepad. No page or
  console errors. The 390×844 layout has no document overflow.
- Opened captures: `output/playwright/cat-ronin/` (`walk-idle`, `walk-moving`,
  `walk-running`, `walk-front`, flight rear/side/front views, `landed`, `bike`,
  `ski`, `walk-mobile`; `.png`). `review.json` records states and errors.
  Verification logs are alongside them as `web-tests.log`, `core-tests.log`,
  `package-tests.log` and `pyright.log`.
- Bicycle rules/config and its GLB are byte-identical to the base. The ride
  navigation function is unchanged. Regenerated world, placement and grass
  documents differ only in the world-map SHA; geography is unchanged.

These are implementation and short local verification. Physical controller
feel, human visual acceptance and sustained performance have not been accepted.
Walking uses a simple puppet cycle without foot IK; tall meadow vegetation
partly covers the lower legs. Flights have a looping seated pose rather than
control-specific hand motion or detailed takeoff/touchdown animation. Unreal's
playable pawn is unchanged.

---

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
