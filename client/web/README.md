# Cat size, homes and collision — integrated for review, 2026-10-26

The approved character sizing, home proportions and collision changes are
integrated with the released river, mountain and fixed-wind work. Full-size Ronin is the default; C / the size button
retains the half-size visual experiment. Homes are rescaled, trunks are round,
crowns are soft, structures use their triangles, and wing contacts collapse into
a fall with local unhook/rehook/relaunch. Village dwellings are unchanged.

Web **400/400**, package/publisher/transition **16/16**, placement **44/44** and
**158 fetched + 17 map files** verify. Local Chromium exercises startup, toggling,
keyboard jumping and the collapse/harness sequence without application/shader
errors. Source branches and worktrees are retained. The separate city-tower
removal is excluded. Collision feel and the airborne collapsed wing remain for
human review; this is not sustained performance or Unreal acceptance.

[Integration and publication receipt](../../docs/reviews/cat-home-collision-integration-2026-10-26.md).

---

# Fixed-field wind CPU continuation — local candidate, 2026-10-26

The retained mountain branch now reuses immutable terrain/trail heights for the
fixed meadow field while sampling live shared wind. Exact numerical parity,
bounded storage and 352 web checks pass; controlled overview CPU p95 falls from
45.3 ms uncached to 17.1–18.3 ms cached. Frame pacing remains open. This follow-up
is unpublished; [measurements and next gate](../../docs/reviews/mountain-wind-continuation-2026-10-26.md).

---

# Mountain geological structure — approved for integration, 2026-10-26

Shared sparse crest refinements, closed jointed granite slabs, exfoliated roofs
and cliff-foot talus now add mountain structure to the accepted landscape.
The same published surfaces feed movement; the protected cirque, trails,
launches, vegetation, water and settlements retain their places. Original
rasters remain the base. The browser retains the existing terrain LOD/error
contract and adds spatially batched source rock meshes with filtered granite
and quiet runoff weathering.

The human approves integration after the river deployment. Development continues
on the retained `codex/mountain-geology` worktree and branch. [Review, reproduction and limitations](../../docs/reviews/mountain-geology-2026-10-25.md).
Local comparison: <http://127.0.0.1:8061/output/playwright/mountain-geology/review.html>.
This session's visual **Before is v0.1.0 (`3ff9552`)**; After is the current
mountain candidate. The implementation base remains the later accepted landscape.

---

# Downstream granite river — approved for integration, 2026-10-26

The east exit now reads shared granite bed/bank/slab geometry, including wet/dry
surfaces, source-preserving LOD and matching physical water edges. The original
river course, levels and outer tree placements remain. No future hub site is
chosen. Preview query bookmarks: `?view=graniteRiver` and `?view=graniteBank`.
[Research, checks, matched evidence and limits](../../docs/reviews/river-granite-2026-10-25.md).
The human approves main integration. Unreal parity is excluded from this release;
browser performance examination and next steps follow in the release receipt.

---

# Loading journal: sketch, then colour — v0.2.0, 2026-10-25

The loading screen keeps the original line sketch up while the world's 44 asset
files download, then fades the approved coloured journal over it as the last one
lands (1.6 s; instant with reduced motion). The swap is one threshold in
`loading.js` `phase` (progress step 2), so it follows the real file count rather
than a fixed number. The client version is **0.2.0**; viewer provenance is
refreshed for `scene.html`, `loading.js` and `version.js`. Private web
**336/336** and packaging **8/8** pass. Locally the sketch holds through 43/44,
the journal fades in at "Checking every page of the world…", and the scene
reaches Ready as v0.2.0. [Artwork notes](art/loading/README.md).

---

# Natural landscape — accepted for release, 2026-10-25

The human approves the grass, granite/rock LOD and continuous landscape boundary
for main and deployment. Integration retains main's climbing, swimming,
Mario-style jump and sun-only character glints. Private web **328/328**, core
continuation **3/3**, package/publisher **13/13** and integrity **126 runtime +
17 map files** pass. The merged browser verifies all bytes, shows all 12,619
trees and passes a live-input walking jump without application/shader errors.

[Release receipt, deployment confirmation and follow-up scope](../../docs/reviews/natural-landscape-release-2026-10-25.md).
Earlier local-only entries below describe their original checkpoints. Mountain
geological structure and the Yuba-like river reach continue in separate sessions;
the future social hub's site remains undecided.

---

# Continuous landscape boundary — local worktree, 2026-10-25

Grass habitat and existing edge forest stands now continue into the surrounding
terrain, removing the rectangular meadow cutoff. A shared core extension adds
2,802 outer trees while retaining every original placement. The browser uses
one terrain lattice with 1,024 LOD tiles in 64 batches; snow keeps its original
coordinates. Empty forest LOD allocations skip render processing.
[Implementation, paired views and limits](../../docs/reviews/world-boundary-2026-10-25.md).

Web **282/282**, new core continuation **3/3**, package/publisher **13/13**;
integrity **123 fetched + 17 map files**. Final local overview: **33.3 / 34.2 ms
p50 / p95**, last CPU submit **13.3 ms**. The shader seam fixture reproduces the
baseline's 24.6% channel step and reduces it to 1.0%. This remains on
`codex/natural-landscape`, unmerged/unpublished, awaiting human visual review.
Granite structure/silhouettes, Unreal and sustained performance remain open.

---

# Grass habitats and granite LOD — local worktree, 2026-10-25

The other green zones now share the meadow's animated grass/flora. The shared
stamp adds 43,015 suitable forest-soil cells; snow, trails, rock and crown shade
retain their distinct surfaces. Browser terrain has four source-preserving
levels; river stones/gravel have three spatial levels and granite materials.
The shared river-rock source replaces checker moss with irregular patches and
joint-cut volumes. [Implementation, evidence and limits](../../docs/reviews/natural-landscape-2026-10-25.md).

Web **278/278**, shared habitat **31/31**, package/publisher **13/13**, integrity
**122 fetched + 17 map files**. Changed Python checks pass. This remains on
`codex/natural-landscape`, unmerged/unpublished. The existing 8 m terrain still
limits cliff silhouette fidelity; Unreal and sustained performance remain open.

---

# Mario-style jump and sun-only ear glow — released, 2026-10-25

He leaves the ground on the frame that sees Space / A; the 0.12 s crouch is gone.
A fresh press is buffered 0.2 s and accepted during the landing crouch, and
controller A is latched between 30 FPS frames. The jump uses Super Mario 64's
tuning at body scale: tap to hop, hold to float through an eased peak, a running
lift, and a double then a somersaulting triple for presses within 0.25 s of
touchdown (a full-stick walk is enough; measured 2.9 / 4.2 / 5.9 m walking).
Letting go eases the rise instead of stopping it; the chase camera's aim follows
his height on a critically damped spring, so he rises in the frame, and he
stretches and squats. In the air he cannot pass over a collider, since the floor
is terrain only. Ear translucency is 70% dimmer, and it, the fur rim and the
whisker glints now apply the scene sun map, so none shows in shade. The human
approved merge and publication. Web **320/320**, public web **276/276**,
packaging **8/8**, byte verification **122 fetched + 17 map files**. Release
identities are in [PUBLISHING.md](../../docs/PUBLISHING.md).

Remaining work: physical-controller feel, live in-browser startup from the review
browser (its site permissions block the domain; live bytes match main by hash)
and Unreal, which has no jump port. Older entries below describe their original
checkpoints.

---

# Redwood and village repairs — accepted release, 2026-10-24

Canopy and Giant Redwood share redder bark with the refined village bole. All
four forest LODs receive the scenery sun map; tile-isolated mip sampling removes
brown crown-edge squares. The village look-around preset matches the selected
close view and supports looking upward. Occupied structures, sockets, placements
and world bounds remain intact. The human confirms the local fix and authorizes
merge/deployment. Web **274/274**, package/publisher **13/13**, byte verification
**119 fetched + 17 map files**. Current release identities and cleanup are in the
[release receipt](../../docs/reviews/redwood-release-2026-10-24.md).

Remaining work: LOD silhouette continuity, richer close forest floor, researched
stand structure, sustained/cross-device profiling and Unreal validation. The
latest 240-frame local sample is **33.3 / 34.3 ms p50 / p95**; it is not sustained
performance acceptance. Older entries below describe their original checkpoints.

---

# Forest afternoon — approved for main, 2026-10-24

The human approved the forest pass for merge and deployment. It unifies bark/LOD
lighting, restores filtered card color, strengthens thin-leaf transmission, adds
partial-sun shafts and a stamped forest floor, and enables first-person walking
on V / right-stick click. All 9,817 tree placements remain. This integration
retains main's approved journal and cloud optimizations. [Evidence and limits](../../docs/reviews/forest-afternoon-2026-10-24.md).
Next priority: redder Canopy/Giant bark matching the village tree, updated village
tree bodies, and verified inter-tree shadow reception for every representation.
Deployment verification is recorded in the private release receipt.

---

# Cloud performance — 2026-10-24

Above-cloud views skip only sample positions proven to have zero density,
reducing the measured cloud GPU pass by about 15% while retaining 96 occupied
sample positions. Edge and inside views keep the full march. All 84 moving
poses preserve cloud/environment pixels; ordinary-flight stalls remain open.
See the [performance evidence and limits](../../docs/reviews/cloud-performance-2026-10-24.md).

# Approved hand-sketched loading journal — 2026-10-24

The approved generated alpine journal artwork replaces the initial line sketch;
the original SVG and complete earlier page are preserved in `art/loading/history/`.
The scene and controls remain hidden until assets, verification, vegetation,
shader compilation and GPU draws finish. Input/simulation begin after the reveal;
retry and graphics recovery use the same journal. See the [implementation,
history and verification](../../docs/reviews/journal-loading-2026-10-24.md).

# Cloud motion — approved for main, 2026-10-24

Cloud view rays use 96 samples to reduce crawling density bands during flight.
The rejected shadow-accumulation change is excluded; environment shading keeps
the released behavior. The [investigation and review](../../docs/reviews/cloud-regression-2026-10-24.md)
record the visual checks, GPU cost and remaining shadow/performance work.

# Tree studio and feral forest integrated — 2026-10-23

All studio, tree-update and game-integration work is combined for main at the
human's request. The persistent studio retains current settings, notes and
named plans; the game uses species-specific Feral crowns and repaired lighting.
Main's existing sky/shadow repairs remain. Large model delivery is lossless and
fits the host limit. See the [integration receipt](../../docs/reviews/tree-main-integration-2026-10-23.md) for conflict choices,
checks, source identities and publication status. Earlier local-only entries
below describe their original checkpoints.

---

# Connected redwood foliage revision — local review, 2026-10-23

The bulb-like studio adoption was rejected. Giant, Canopy and Village redwoods
now use connected branches, flattened needle sprays and the exact original
per-species bark/foliage palettes. LOD 0 mixes folded leaves and curved sprays;
LOD 1 groups the same contours into detailed bough cards. Original silhouettes,
placements, occupied structures and collision sources remain unchanged.

The [adoption brief](../../shared/geometry/tree-design/ADOPTED-REDWOODS.md)
records the current recipe, costs, six-angle coverage audit, checks and limits.
The original studio study and mutable human settings stay in their own worktree.
This is a local review candidate, not a published release.

Start with `python3.11 client/web/tools/serve.py --port 8005`:
- [Game canopy](http://127.0.0.1:8005/client/web/scene.html?view=canopy)
- [Species / LOD angle inspector](http://127.0.0.1:8005/client/web/tree-review/)

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

# client/web

## Canopy self-shadow refinement — local, 2026-10-22

The human accepts the repair's documented tradeoffs and confirms the flicker
improvement, while reporting crawling self-shadow bands. Continuous shadow
coverage replaces the coarse binary-tap average. Coupled actors use fixed 24 m coverage at the same 1024² map size and memory;
separated parked actors retain the prior 64 m coverage. Fabric palette,
geometry, normal smoothing, toon ramp and shadow bias are unchanged.

Both wing types pass controlled moving-cloth checks in all three sun presets;
all 30 paired shadow-disabled frames are byte-identical. Ordinary flight,
retained ground shadows and production pacing have separate checks in the
[banding brief](../../docs/reviews/canopy-banding.md). This remains local and
unpublished. Preview: <http://127.0.0.1:8021/client/web/scene.html>.

Final retained surface/ground/recovery checks pass. Web **218/218**, packaging
**7/7**, integrity **90 scene + 17 map files** pass. The final fixed-1440×900 trace averages 29.92–29.98 FPS across flight,
clouds and forest walking, with 34.1–34.2 ms p95 and isolated longer stalls.
The opened local comparison and raw evidence are recorded in the banding brief.

## Visual regression repair — isolated, 2026-10-21

The human rejected v0.1.1 for flickering canopy/hat lighting, tree-shadow popping
and reduced shadow quality. Main was reverted in `f845716` to the prior v0.1.0
tree; the repair stays on `codex/web-sky-clouds-next` and is not approved for
integration or deployment. The release entries below are historical.

The candidate corrects actor depth decoding, receiver-plane filtering and map
motion, preserves source tree casters through visual LOD changes, and removes
the coarse tree-ground bake. Temporal GPU probes pass in all three sun presets; web **217/217**, packaging
**7/7** and integrity **90 scene + 17 map files** pass. The 225-second trace
measures 33 ms median, with 35–48 ms p95 across flight/clouds/walking; slow
frames remain. Normal-play comparisons are captured for human review. See the [repair brief](../../docs/reviews/web-011-repair.md).
Local preview: <http://127.0.0.1:8021/client/web/scene.html>.

## Rejected Web v0.1.1 — 2026-10-20

The web renderer targets 30 FPS while shared simulation retains elapsed time.
Moving wing/Ronin shadows update every rendered frame through a stabilized
actor map. Cached volumetric sunlight reduces repeated cloud work; rounder
billows and cloud shade on trees, water and Ronin keep the scene coherent.
Distant tree-ground shade is baked lazily per fixed sun preset, preserving its
soft crown approximation. Full branch-accurate scene lightmaps are not claimed.

Web **216/216**, packaging **7/7**, integrity **91 scene plus 17 map files**.
The three-minute fixed-1440×900 trace measured 33.3 ms p50 / 34.2 ms p95,
including two minutes of normal flight; rare stalls remain in the record.
See the [v0.1.1 review](../../docs/reviews/web-011.md) for paired GPU evidence,
static-bake tradeoffs, reproduction and limits. Publication status is recorded
in [BUILD-STATUS.md](BUILD-STATUS.md).

## Earlier sky/cloud second-pass checkpoint — 2026-10-20

The continuation adds broader shared cloud groups, refined sunlight and moving
density shadows on terrain/meadow. Cached lattice calculations preserve the
noise texture while reducing its CPU build cost. Preview and matched comparisons
run on port 8021, in `codex/web-sky-clouds-next`. See the
[second-pass brief](../../docs/reviews/web-sky-clouds-next.md) for measurements
and limits. The human subsequently merged this checkpoint at `3ff9552`; v0.1.1 builds on it.

## Sky/cloud first pass approved — 2026-10-20

The accepted first pass adds fuller billows, periodic detail, directional
self-shadowing and coordinated sky/cloud haze while retaining the shared cell
bounds. The human requested main integration and deployment, with further
exploration continuing separately. Publication receipts live in the handoff;
sustained profiling and Unreal parity remain separate followups.
See [BUILD-STATUS.md](BUILD-STATUS.md).

## Current flight delivery — 2026-10-18

Wind rendering now falls back to nearest air samples when linear float texture
filtering is unavailable. Debris spawns within its eviction circle and keeps
drifting in world space as the camera moves. The shared schema's repeated mode
coefficient constraints use common `$defs` with the same validation behavior.
Web **142/142**, focused Python **19/19**; the
[review resolution](../../docs/reviews/flight-experience-2026-10-18.md#resolution-and-fresh-verification)
records regression failures, browser fallback proof and schema equivalence.
The delivery contains both flight passes and their review fixes. See
[BUILD-STATUS.md](BUILD-STATUS.md) for current publication status. Physical
acceptance and sustained profiling remain open in roadmap R0062. The dated
local-only entries below describe earlier checkpoints.

## Flight second pass — 2026-10-17

Version-3 shared flight adds retained dive/flare energy, held B/Shift maneuver
rolls/spirals and bounded ground drag relief. Wind cues in vegetation, drifting
material and water sample the same local air field as the aircraft. Rebuilt
rounded cells, intakes, reinforcement and riser cascades are visible in the
opened roll and front views. Flight moves explains controls in the scene.

Current preview: http://127.0.0.1:8004/client/web/scene.html . Local only.
Web 140/140; see the [flight brief](../../shared/geometry/flight/EXPERIENCE.md)
for opened evidence, approximations and limits. Physical pad/audio/haptics,
human visual acceptance and sustained target-size performance remain open.

## First flight upgrade — 2026-10-17

Paragliding, parakiting and paramotoring now use version-2 shared flight/weather
rules researched from actual manuals. Fly with a controller: left stick shifts
weight and changes speed demand, LT/RT pull independent handles, LB/RB adjust
held motor power, right stick looks, A launches/retries, Y changes view, D-pad
changes wing/ridge, and X cycles weather. Keyboard flight retains A/D, W/S,
R/F, drag look and adds V view switching.

Inflated cell wings flex with brake, pressure and load. Speed FOV, peripheral
blur, first-person view, vario/wind audio and motor detail improve feedback.
Field notes offers reduced effects, haptics, adaptive resolution and Save view.
Preview: http://127.0.0.1:8003/client/web/scene.html .

Read the [flight brief](../../shared/geometry/flight/EXPERIENCE.md) for source
manuals, controls, reproducible geometry, tests, opened evidence and limits.
The flight work is local on `codex/flight-experience`; it has not been deployed.
Physical-controller feel and sustained performance remain unaccepted. The
records below describe previous integrations.

The browser client. WebGL.

## Current status — 2026-10-17, Cat Ronin fidelity

The playable cat now has mustard rib knit, a silver-gray tabby coat, fuller
cheek fur, an alert blinking eye, pleated hakama and a continuously bending
ringed tail. Fifteen contextual tail loops vary idle, walking, running and
flight motion. The shared GLB carries shape, markings, cloth texture and rig;
the browser adds short fibre shells. Bicycle behavior is unchanged.

Inspect details and movement in the local
[character studio](character-lab/README.md) (`python3.11 client/web/tools/character_lab_server.py --port 8032`),
or use the ordinary game scene. See the
[asset brief](../../shared/geometry/cat-ronin/FIDELITY.md) for opened evidence,
regeneration and limits. Further pose, surface and performance improvements are
recorded as a followup task in `docs/HANDOVER.md`.

## Earlier status — 2026-10-16, Cat Ronin

Walk the meadow is now third person, playing the rigged Cat Ronin imported from
the human's `catronin` project. WASD/left stick moves relative to the camera;
drag/right stick orbits it; Shift/L3 runs. Idle, walk and run clips crossfade.
Since 2026-10-24 he also climbs and swims (shared rules in `shared/activities/`):
push into any tree at least 0.6 m across, or jump onto it, to climb; W/S climb,
A/D circle, Shift climbs faster, Space jumps off. The climb ends in a perch below
the crown (no launching from trees yet). High falls bounce and tumble. Walk into
a lake or river to wade and swim; the stick paddles, Shift dives along the
camera's pitch, letting go bobs him up, and below the surface the view tints.
The same character sits in the harness for paragliding, parakiting and
paramotoring, with a chase camera. Bicycle and ski models, rules, controls and
V/Y view switching retain their previous behavior.

The GLB, Blender generator and clip source live in
`shared/geometry/cat-ronin/`; `worldmap.json:activities.character` selects
`shared/characters/player.json`. Ground movement runs in
`shared/activities/walk.js`. The web client adds no dependency and retains its
existing WebGL toon rendering. Run from the worktree root:

```sh
python3.11 client/web/tools/serve.py --port 8002
# http://127.0.0.1:8002/client/web/scene.html
```

See [BUILD-STATUS.md](BUILD-STATUS.md) for validation and limitations.

This is the fast test bed. It is a real product and a real second engine, and it
exists to try ideas quickly and to catch anything in `shared/` that has quietly
become Unreal-specific.

## Current status — 2026-10-16, skiing and mountain biking

Explore now also offers Skiing (Drop in at the Granite Cirque) and Mountain
biking (Ride a graded trail, T5 or T6, from where it melts out). A chase camera
follows; V or gamepad Y switches to first person. Keys: A/D steer or carve,
W pedals or poles, S brakes or snowploughs, Shift tucks or crouches, Space hops.
Gamepad: left stick steers, RT drives, LT brakes, A hops, B tucks. The rules are
`shared/activities/ride.js`; the terrain shader draws the core snow stamp on the
grass stamp's grid, and graded treads are drawn at their core profile. Physical
gamepad feel is unverified.

## Earlier status — 2026-10-13, alpine flight pass

The shared world now has mountainous forest, giant redwoods and a generator
blimp per dwelling. The browser supports walking, paragliding, free-flight
parakiting and paramotoring. Choose an activity and ridge, then Launch. WASD
walks or steers; drag looks; R/F adjusts motor throttle. Gamepad left stick moves
or steers, right stick looks, and triggers adjust motor throttle. Use a place
button to return to orbit inspection. Sound is optional and procedurally generated.

```sh
python3.11 client/web/tools/serve.py
# http://127.0.0.1:8000/client/web/scene.html
```

The current review server is on **8001**. The server tool has a larger connection
backlog for ES module loading. No npm install or new build dependency is needed.

Core geometry supplies full nearby trees and source-baked side/overhead distant
canopies. Bank plants use the same approach. The scene retains every published
tree and bank placement, and interprets grass from its stamp with dense local
blades. Shared habitats supply fish/frogs/dragonflies; meadow habitat populations
supply butterflies, bees and windborne material. Cumulus uses depth-clipped 3D
raymarching at half resolution and is enterable. Water uses depth absorption,
reflected sky/sun and ripples aligned to the shared river polyline.

Regenerate with `python3.11 client/web/tools/make_viewer_data.py` after changing
source, assets or data. Startup verifies **64 fetched files**, including both
float buffers and the actual source/asset bytes, and names any drift. The Git
label is only a generation label. See [BUILD-STATUS.md](BUILD-STATUS.md) for
opened evidence, checks, current limitations and the next work.

## Earlier status — 2026-10-13, toon and lighting pass

`scene.html` is a read-only Three.js r180 countryside client. Its presentation now
uses four-band toon materials, warm directional sunlight, cool hemisphere fill,
soft cached sun shadows, a procedural sky, animated depth-coloured water and
wind-driven grass/flowers. Choose golden hour, morning or evening; visit the
homestead, river and valley with the buttons or keys 1–3. Orbit uses left drag;
right/middle drag pans; the wheel approaches. It remains an inspection client,
without first-person/controller movement or the Unreal ecology/audio systems.

```sh
# Serve from the repository root; no dependency install or build step.
python3 -m http.server 8000 --bind 127.0.0.1
```

- 3D scene: <http://127.0.0.1:8000/client/web/scene.html>
- Existing 2D map: <http://127.0.0.1:8000/client/web/>

Use a hard refresh after updating source if the browser retains old modules.
The scene reports context-creation errors, pauses on loss/hidden tabs, and resumes
on restoration. Field notes expose frame intervals, CPU submission cost, draw
counts and pixel scale. The generation label describes the height-grid manifest;
it does not certify current fetched bytes or a committed build.

The forest retains every published transform and uses one **uniform source-envelope
stylization**, 528 triangles/tree, in 192 m spatial batches. It never switches
geometry by distance or cuts off trees at a fixed radius. This is a stylized
crown hull, not the full needle-level source mesh. All 140,323 stamped meadow
cells remain represented, in 128 m batches, with one 42-triangle animated kit.
Terrain still uses every exported height sample; world-space water parts draw once.

**Checked:** 54 focused 3D tests and seven stamp-layout checks; 240 uninterrupted browser intervals per view at
1440×900, with p50 16.7 ms and p95 17.4–17.6 ms; opened screenshots of all three
views. These are short local Chromium observations, not GPU timings or sustained
cross-device guarantees. The final full web suite passes 83/93; its 10 remaining partition failures
also occur on baseline main (which failed 12/39). The source, vendored modules
and height buffers are now committed on main. Integration includes the earlier
shared GLB index-format fix and existing Unreal render deletions in separate
commits. Regenerable browser captures remain ignored; nothing was pushed. See [BUILD-STATUS.md](BUILD-STATUS.md) and
[the handoff](../../docs/HANDOVER.md) for evidence and remaining visual limits.

## Deploying as static files

The 3D scene is static: HTML, ES modules and data, with no server code and no
build step. Package it with:

```sh
python3.11 client/web/tools/package_web.py
```

That writes `dist/web/` (87 files, about 48.5 MB): `client/web/data/viewer.json`,
the 69 files it fetches, the core outputs it lists as `sources`, the three.js
licence, and the 2D map the scene links to ("Open the map"). Every fetched file
and source is checked against the digest in `viewer.json` before anything is
written, so a stale file stops the package rather than a visitor's browser. If
you changed a source on purpose, run `make_viewer_data.py` first. `--check`
verifies without writing; `--out DIR` writes elsewhere.

The package keeps repository paths, because the scene resolves every file
from the repository root. Upload the **contents** of `dist/web/` to the web
root, or to any folder, since every path is relative. The root `index.html` **is
the scene**: the packager generates it from `scene.html` with one
`<base href="client/web/">` line, so the site's address is the game and
`client/web/scene.html` keeps working. The map is at `client/web/`. Try it
locally first:

```sh
python3.11 -m http.server 8090 --bind 127.0.0.1 --directory dist/web
```

Open <http://127.0.0.1:8090/>; Field notes should read "Verified 69 fetched files",
and "Open the map" should draw the 2D map with no digest warning in its header.

What the host has to do:

- **Serve `.js` as JavaScript** (`text/javascript`); browsers refuse ES modules
  served as anything else. `.glb`, `.f32` and `.json` are read as bytes or JSON,
  so the usual defaults are fine.
- **Deploy every file together.** The scene checks each fetched file against
  `viewer.json` and stops at the first mismatch, so a half-finished upload or a
  CDN still caching last release's files fails loudly. Upload atomically where
  the host allows, and purge or give `viewer.json` a short cache lifetime on
  each release.
- **Compress** (gzip or brotli) where the host offers it; most of the 48 MB is
  glTF and JSON. The largest single file is `shared/world/out/placement.json`
  at 6.3 MB.
- `.tumbler-web-package` is only the script's marker for a folder it may
  replace. It's harmless to upload, and fine to leave out.
- `_headers` sets the caching policy for hosts that read it (Cloudflare Pages
  and Workers static assets): every file is revalidated before use. File names
  carry no content hash and the scene refuses mixed versions, so long or
  `immutable` caching would break visitors after a release; revalidation is a
  cheap 304. Other hosts ignore the file; give them the same policy.

### On Cloudflare (tumbler.catronin.com)

The live site is <https://tumbler.catronin.com>, served by Cloudflare Workers
static assets: `wrangler.jsonc` at the root of the public repository points
Wrangler at `dist/web`, with the custom domain as its route. Each deployment
goes live in one switch, which suits the startup check, and `_headers` keeps
every file revalidating.

Cloudflare compresses JSON, JavaScript and HTML on its own (Zstandard, then
Brotli, then Gzip), but its default list leaves out `model/gltf-binary` and
`application/octet-stream`, so the `.glb` models (37.3 MB) and the `.f32`
height grids (1.1 MB) need one compression rule on the zone (Rules →
Compression Rules), scoped to this site:

- **When incoming requests match:** custom filter expression
  `(http.host eq "tumbler.catronin.com" and http.request.uri.path.extension in {"glb" "f32"})`
- **Then:** Compression options *Custom*, order `Zstandard`, `Brotli`, `Gzip`

With it, a first visit downloads 12.1 MB instead of 47.8 MB, all of it
zstd-encoded (measured 2026-10-17); browsers decode it before the startup
check, which still verifies all 69 files.

Do not add Cache Rules for the site; a longer edge cache can serve last
release's files. Workers static assets redirect `scene.html` to `scene` (307);
both the page and its startup check follow it. To check the headers:

```sh
curl -sI -H 'Accept-Encoding: gzip, deflate, br, zstd' https://tumbler.catronin.com/shared/geometry/redwood/giant_redwood.glb | grep -iE '^(content-encoding|cache-control|content-type):'
```

Expect `content-encoding: zstd` and
`cache-control: public, max-age=0, must-revalidate`. Field notes in the scene
should read "Verified 69 fetched files".

## What this is, stated plainly

**The browser runs no Python.** It draws the core's *output*, not the core. That
is a weaker claim than "two clients share one core", and this file should not be
quoted for the stronger one until something runs `shared/` in a browser.

| | |
|---|---|
| it reads | Shared world/placement/ground-cover JSON and GLBs; the 3D page also reads generated block/far-field height buffers and the manifest. The 2D page reads the published albedo/water rasters and hillshade |
| it computes | Client presentation: terrain meshes, shading, transforms, batches, visibility and camera controls. The older 2D partition-digest experiment is described below |
| it does not compute | World geography, field layout or placement decisions; height samples and water geometry arrive exported from the core |
| it writes | Neither page edits shared files; presentation updates the canvas and page status/stamp |

## Generated client data

`tools/make_viewer_data.py` writes four files in `data/`: `hillshade.png`,
`heightmap.f32`, `farfield.f32` and `viewer.json`. The browser cannot recover
16-bit height samples from PNG canvas pixels, so the generator uses the core's
readers to export float32 heights; it also computes the 2D hillshade. World
geography and placement decisions still belong to the core.

Regenerate from the repository root with
`python3.11 client/web/tools/make_viewer_data.py`. Review the buffers and
manifest together when integrating. The 3D stamp currently displays the
manifest's commit label without verifying fetched bytes; it does not certify
freshness or identify uncommitted edits.

## 3D checks

```sh
node --test client/web/tests/assets.test.mjs \
  client/web/tests/controls.test.mjs client/web/tests/glb.test.mjs \
  client/web/tests/heights.test.mjs client/web/tests/placements.test.mjs \
  client/web/tests/world.test.mjs client/web/tests/rendering.test.mjs
```

The toon pass passed all 54 focused checks. `node --test client/web/tests/*.test.mjs`
also includes the older 2D suite; its last full run had 11 failures, documented
in [BUILD-STATUS.md](BUILD-STATUS.md). Do not describe the whole web suite as green.

## Historical 2D development notes — 2026-10-02

The sections below, through the discussion of the second-client experiment,
record the earlier 2D work. Figures such as 1,422 placements and 119 crop cells,
and the quoted test totals, describe that date. The current world has retired
the crop partition and publishes 17,283 placements. Use the current status above
and `docs/design/WHAT-THE-WORLD-IS.md` for the present build and world.

## A finding worth more than the viewer: the albedo's orientation

`shared/geometry/structures/REPORT.md` records that `fields_albedo.png` is
**stored south-up** and that "a client that samples it the obvious way gets the
partition mirrored north–south" — several clients have been caught by it. Neither
`world.json` nor `fields_albedo.png` declares a row order for it.

So the viewer does not believe the prose. At load time it samples the raster at
the seed position of each of the 119 cells in `world.json:fields_status.cells`
and asks which orientation puts each cell's own declared crop hex under it.

**Measured 2026-10-02 against the current file: 105 of 119 agree unflipped, 2
agree flipped — the bytes are north-up as stored, and the "south-up" note does
not describe them.** The stamp prints this verdict and the counts every time the
page renders, so a future change of the core's mind shows up as a changed number
rather than as a quietly mirrored world.

## What increment 2 actually requires

The brief for increment 2 was "turn a viewer into a second client". Measuring
that turned up four options and one uncomfortable number.

| option | what it is | cost, measured |
|---|---|---|
| **run the Python core in the browser** | Pyodide: CPython compiled to WASM, fetched at runtime | a few MB of runtime, plus **2,690 lines of `shared/`** mounted — the measured closure of `lay_out_fields` is 8 modules. **Cannot be verified without a browser**, so building it now would be an unverified claim |
| **a WebAssembly build of the core** | the same thing: the core is Python, so a WASM build of Python *is* Pyodide | identical, and it adds a build step, which the proposal declines |
| **reimplement an operation in JavaScript** | a second implementation, and a drift risk nothing in Python can see | **measured below: 758% of the original, and 82% of that is not the algorithm** |
| **export more computed output** | the browser keeps drawing, and asks the core for less | one more artefact per operation, already paid for, already digest-stamped |

**Recommended: the fourth, and the measurement is why.** Not because duplication
is impossible — it was made to work here — but because of what it cost and what
it risks.

## The duplicated operation, and what it really cost

`shared/terrain/field_layout.digest_partition` is the smallest pure operation in
the core. It builds a payload and hashes it. The browser now recomputes it, and
the stamp prints whether the two agree.

**Measured, 2026-10-02, on this repository's real partition of 119 cells and 310
edges:**

| | python | javascript |
|---|---|---|
| the operation | 12 lines | 26 lines |
| reproducing Python's serialisation | 0 lines | **65 lines** |
| total | 12 lines | **91 lines (758%)** |

**The interesting failure is not the algorithm.** `JSON.stringify` produces a
24,768-byte payload where Python's `json.dumps` produces 24,982, because Python
writes `-400.0` where JavaScript writes `-400` — 214 bytes, and digests that
have nothing to do with each other. A second cost: JSON erases the int/float
distinction, so the port has to be *told* which fields are which, and **nothing
in the data files says**. `src/pyjson.js` handles both, and it **throws** on any
number it cannot prove it renders like Python, rather than diverging quietly.

**Would I maintain it?** For one operation, yes — the comparison is 18 tests
and 60 ms, and the failure mode is a red stamp on the picture. For
`lay_out_fields` — 1.16 s, 2,690 lines of closure, Voronoi plus two Lloyd
passes plus noise — **no.** The same discipline would have to hold across
thousands of lines of arithmetic, and the check would be a test suite
duplicating the core's own. That is a second implementation of the world,
maintained by hand, and it is not the seam; it is a fork of it.

So the honest conclusion: **the next step is one more exported artefact, not
another duplicated operation.** And "increment 2" is really two increments —
export-more is nearly free and needs no approval; running the core is Pyodide,
which needs its own decision and cannot be verified here.

## The encoding, decided

The duplication experiment said the cost was the wire format, not the logic, so
the wire format is what got attacked. Three ways to make two languages agree
were considered, and all three buy agreement by giving up sensitivity:

| answer | what it costs in sensitivity |
|---|---|
| round the values at the boundary | a tolerance, plus an unverified claim that differences below it do not matter — the move `session-lessons` §4 records being withdrawn |
| quantise to integers | the same tolerance with a unit attached |
| hash something coarser than exact doubles — a per-cell ordinal, crop plus neighbours | **blind to meaning**: two partitions with the same adjacency and moved seeds collide |

**A digest that is robust to formatting and blind to meaning is worse than the
float disagreement, because it cannot be argued with.** So none of them.

**Chosen: a binary partition identity** (`src/partition_id.js`). A double's
identity *is* its eight bytes, so the format writes IEEE-754 big-endian at fixed
widths, with an explicit field order and an explicit int/float tag per field.
There is no rendering step left for two languages to disagree about — no
shortest-round-trip rule, no locale, no `repr`, no JSON number grammar — so two
implementations written from the specification agree by construction.

**What it costs: nothing.** Bit-exact. Two partitions collide only if every
double is bit-identical and every integer equal. A one-ULP move of a seed
changes the id; a re-spelling of the same value does not. Checked in both
directions: `BLIND TO SPELLING` re-writes every `-400.0` in `world.json` as
`-400` and requires the id to hold; `SENSITIVE` moves one seed by one ULP, one
boundary by a millimetre, reorders the cells, and rewires an adjacency, and
requires the id to break each time.

### Why the core's digest needs replacing, not just matching

Because the measurement above is not a JavaScript problem. On the core, the
same partition and the same geometry digest differently depending only on how
`world.json` spells a number:

    coordinates as floats (as world.json spells them)  fcbf5f3e81efb77d
    the same geometry spelled as ints                  430e5e9b5c02a350

`digest_partition` answers *what are these numbers, written down*, not *what is
this partition*. Any consumer in any language is affected, including the core's
own. **The fix is one function** — `struct.pack` instead of `json.dumps` inside
`shared/terrain/field_layout.digest_partition` — and it is a change to
`shared/`, which is under test and not this lane's to make. It is recorded here
as a proposal with the shape of the patch, not landed.

### Both checks, on purpose

`digest_core` (the core's text digest, compared as before) and `id_agreed` (the
binary identity, compared as new) are both stamped. The first catches a change
in the core immediately and is the thing that would go red if
`digest_partition` were edited. The second is stable under formatting and is
what a form should compare. Keeping both is cheap and each covers a failure the
other cannot.

## Which operations could become forms once the encoding is agreed

`docs/design/HUMAN-SURFACE.md` §3 splits the verbs into data and visual. Taking
its data half, in the order the encoding unblocks them:

1. **`field_layout.lay_out_fields(worldmap, heightfield, params, ArrangementConstraints)`.**
   This *is* a form already: the constraints are exactly cell size, jitter,
   Lloyd passes and seed, and its own design says `None` means "the map's
   value". It returns a partition. Given an agreed identity the loop is: browser
   sends constraints → a Python process runs the core → returns a partition and
   its id → browser draws and stamps. **No second implementation is needed.**
2. **study / adopt / revert** over the existing files. Buttons, not logic.
3. **Water body numbers once placed** — surface, bed, bank — already numbers on
   `worldmap.water.bodies`.

So the browser needs two things beyond what it has: **a transport to a Python
process** (Pyodide, or a local server), and **the agreed id** to tell whether a
result changed. The id now exists on both sides. The transport is the decision
that is still open, and it is the whole of the remaining gap — not a fork of
the core, which the 758% measurement argues against.

## What the next increment would be, and why it is not this one

It would be a **form panel and click-to-coordinate over the existing viewer**:
the four field knobs as a form that writes the same keys the CLIs write, and a
click on the map that yields a world coordinate. Per `HUMAN-SURFACE.md` §4 those
are the two highest-leverage additions and they are viewport work, not JSON
work.

**Not started here, deliberately.** The finding from this lane is about
serialisation; an editor is about a person's attention. Building one on the
strength of a passing digest test would be exactly the move the record warns
about — turning a measurement into a milestone. Note also that another lane has
started `client/web/study.html`, `study_server.py` and friends in this tree;
those files are not this lane's and were left untouched.

## Tests

    node --test client/web/tests/scene.test.mjs \
               client/web/tests/partition_digest.test.mjs \
               client/web/tests/partition_id.test.mjs \
               client/web/tests/stamp_layout.test.mjs

Thirty-five tests, ~200 ms, **against the committed data rather than fixtures.**
Twelve of them exist for one purpose: proving a check can fail. Plain
`JSON.stringify` does not reproduce the core's digest, dropping the int/float
tags does not, a moved boundary does change it, the encoder refuses numbers it
cannot prove it renders like Python, re-spelling every number does *not* move
the agreed id, one ULP does, the stamp's verdict is wrong on drift **and** on a
check that did not run — and the sizing this lane replaced really was illegible,
so that regression cannot return unnoticed.

**Proved by mutation, not by reading.** Flipping one argument in the agreed
encoder — `setFloat64(…, false)` to `true`, big-endian to little-endian — made
exactly one test fail, with both ids named:

    AssertionError: python wrote 9260fad7d5d9b617, javascript wrote
    8249ab3e8f3e0251. The format has no rendering step, so a difference is a bug
    in one of the two encoders, not a disagreement about how to write a number.

The other seven stayed green, which is what makes that a useful failure: it is
localised to the encoding rather than to the data.

Two things are **not** covered and are stated rather than implied. The check
fires only when the page is opened — a check nobody opens does not run — so it
is backed by these tests, not by the stamp alone. And it has a **stated
half-life**: the manifest's value is the core's, so if the core changed and
nobody re-ran `tools/make_viewer_data.py`, the browser would not notice on its
own. (It did notice once, during development, when another lane's edit to
`worldmap.json` moved under a manifest that had been built a minute earlier.)

`draw.js` and `main.js` need a canvas and a browser; they are exercised by
opening the page. `stamp.js` is covered only through `partitionVerdict`, which
was extracted out of `drawStamp` for exactly that reason.

## The stamp was invisible, and why

Reported by a reader looking at the bottom-right corner and finding nothing.
The cause was **none of the four obvious ones**, and ruling those out mattered
more than the fix:

| candidate | ruled out how |
|---|---|
| overdrawn by a later layer | `main.js` draws the stamp last; call order read from source |
| drawn to a canvas the DOM hides | `index.html` has exactly one `<canvas id="map">` |
| no contrast | the panel is `rgba(20,24,20,0.86)` with `#e7e5e4` text, and turns `#fca5a5` on failure |
| the cross-check silently skipped | the map only draws *after* the check, and the map drew |
| **assumed a canvas size, not a viewport** | **this one** |

`index.html` lays the 2048px canvas out at `width: min(96vw, 96vh)`, so the canvas
is **downscaled** — and the font was derived from `size`, the 2048, not from what
the reader sees. The stamp drew correctly at 17 canvas pixels. On a 1440×900
screen that is **6.9 CSS pixels**. The scale bar was legible and the stamp was
not, purely because its divisor was 118 against the furniture's 58.

**The fix, and what it costs:** the font is now chosen in *display* terms —
`max(size / 118, minCss / displayScale)` — converted back into canvas units, and
the panel **wraps** rather than shrinking, because shrinking below the floor is
the bug. Measured with the shipped code:

| viewport | canvas shown | was | now | panel |
|---|---|---|---|---|
| 1280×800 | 736 px | 6.1 px | **12.2 px** | 1251×1124 |
| 1440×900 | 832 px | 6.9 px | **12.2 px** | 1266×963 |
| 1920×1080 | 1005 px | 8.3 px | **12.3 px** | 1265×626 |
| 2560×1440 | 1350 px | 11.2 px | **12.5 px** | 961×470 |
| 900×600 | 544 px | 4.5 px | **9.6 px** | 1260×1194 |

The floor is two-tier and the lower tier is honest: at 544px a bigger font buys
more wrapping and a taller box, and below about 9 CSS pixels it stops
improving. **The stamp prints its own displayed width**, so a reader on a small
window can see they are getting the small version rather than being told they
are.

The stamp also **moved to the bottom-right**, which is where a person looks for
provenance and is the one corner the legend (top right) and the scale bar
(bottom left) do not occupy. Its content is unchanged: same words, same
verdicts, same red-on-failure. `tests/stamp_layout.test.mjs` walks five
viewports and requires legibility and on-canvas placement at every one, plus a
test that the sizing being replaced really was illegible — so the regression
cannot come back unnoticed.

## What this viewer actually draws

Asked, and worth stating exactly rather than leaving to be guessed at:

**All 1,422 instances in `placement.json`, in 13 kinds, with none dropped.**
Nothing is filtered — `scene.js` groups every instance by kind, and the only
filter it applies is dropping an instance with no position, of which there are
currently zero.

**The dark blobs and the lollipops are drawn.** `blob` (120) and `orchard_tree`
(192, the lollipops) are both in the legend with their counts. But they are drawn
at a 2.28 canvas-pixel radius, which at an 832px-wide canvas is **0.92 CSS
pixels** — they read as texture on the parcels, not as objects you can pick out.
Only the landmarks (turbines, towers, the blimp, the masts, hardstanding,
greenhouses) get three times the radius, and even those are ~2.8 CSS pixels.

So the picture is **complete but not legible at instance level**, and the legend
is what makes that visible rather than implied. Anyone judging whether the blob
asset is the right size — `R0006`'s question — cannot answer it from this
viewer, and should not be invited to.

## Has this client caught anything in `shared/` that went Unreal-specific?

**No.** Not yet, and the reason is the sentence at the top of this file: the
browser runs no Python, so it cannot observe the core, only its output. Every
Unreal-specific import would be caught by
`tools/tests/test_engine_neutrality.py`, which reads the AST — better than a
browser would, and it has been there all along.

What the client *has* caught is a **documentation** error: `REPORT.md` and
`fields.py` both say `fields_albedo.png` is stored south-up, and the bytes say
north-up. That is a real finding and it is not the one this client exists for.

For the answer to become **yes**, two things would have to be true, and only the
second is new work:

1. a core operation must **execute** in the browser, so a change that broke it
   would be observable from a client that has never run Unreal — that is
   Pyodide, increment 2, and it needs its own approval;
2. the client must compute something the engine *could* have got wrong — a unit
   test running in Unreal would catch the same thing, and has the advantage of
   testing the path that actually ships.

So the honest summary is that the value of a second client here is not yet
demonstrated, and the measurement above is the reason: the seam is real and
cheap to read, expensive to fork, and the fork buys less than running the
original.

## Rules

- Reads `shared/`. Never writes it.
- No engine-agnostic logic here. If a rule belongs to two clients, it goes in
  `shared/`.
- Shaders are its own business. Web uses GLSL. Unreal uses HLSL. The two do not
  share shader code, and that is accepted rather than solved.

## Dependencies and remaining decisions

The 3D client uses vendored Three.js r180 modules; the original 2D proposal
deferred that renderer decision and is historical. [Vendor provenance](vendor/README.md)
records the pinned upstream files, verified SHA-256 values and MIT license. A
fresh local checkout passes the focused checks, reproduces viewer data and loads
in Chromium without local generated terrain assets. Unreal LFS assets were left
as pointers for that web-only check; no Unreal build was verified. Pyodide/core
execution in the browser remains deferred.

## Before building here

A new npm package is a build dependency and needs approval — see the approval
gate in the root `AGENTS.md`, which covers a C++ module, a library in the core
and a new npm package. This client is held to it in full. Do not infer approval
for additional packages from the existence of this working-tree build.

The measured foundation is worth knowing before anyone starts: the core is
stdlib-only and a test says so; the design operations are pure functions of
data and seed; and the only things standing between `shared/` and a browser are
five modules that derive their data directory from `Path(__file__)`, which is a
core refactor worth doing on its own merits and not a browser concession.
Those are enumerated in the proposal's §11.

## Feral forest preview (2026-10-23)

The isolated forest lane now includes pine and fir, irregular crowns for both
redwoods and village trees, and repaired foliage lighting. Original core
placements, palette values and maximum crown envelopes remain unchanged.
See [source, cost and visual evidence](../../docs/reviews/feral-forest-2026-10-23.md).
Run `python3.11 client/web/tools/serve.py --port 8032`; inspect
`/client/web/tree-review/` and `/client/web/tree-review/lighting.html`.
Regenerate assets with `node shared/geometry/tree-design/build-forest-sprays.mjs`,
then run `python3.11 client/web/tools/make_viewer_data.py` before packaging.
This branch is local and has not been merged or published.

## Tree leaf/branch studies — local, 2026-10-21

The tree studio now has separate Spiral leaf fans, Feathered branchlets and
Leaf-cloud volumes approaches. The original study and saved adjustments are
preserved. Each approach has independent controls, lighting, camera and notes,
with leaf close-ups, backlit sun-shaft inspection and named proposal images.
See the [studio guide](tree-lab/README.md) and
[verification](../../docs/reviews/tree-leaf-studies-2026-10-21.md).

## Tree design studio — local, 2026-10-21

The isolated [tree studio](tree-lab/README.md) compares the current game trees
with editable 3D designs. It saves manual recipes, camera/light settings and
named image/JSON looks in the worktree. Run
`python3.11 client/web/tools/tree_lab_server.py --port 8031`, then open
<http://127.0.0.1:8031/client/web/tree-lab/>. This is the design sandbox before
forest adoption; no current species or world placements are changed.
