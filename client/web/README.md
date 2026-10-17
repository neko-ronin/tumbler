# client/web

The browser client. WebGL.

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

That writes `dist/web/` (about 48 MB): `client/web/data/viewer.json`, the 69
files it lists, the three.js licence, and a root `index.html` that redirects to
the scene. Each listed file is checked against the sha256 in `viewer.json`
before anything is written, so a stale file stops the package rather than a
visitor's browser. If you changed a source on purpose, run `make_viewer_data.py`
first. `--check` verifies without writing; `--out DIR` writes elsewhere. The
2D map (`client/web/index.html`) is not included.

The package keeps repository paths, because the scene resolves every file
from the repository root. Upload the **contents** of `dist/web/` to the web
root, or to any folder, since every path is relative. The scene is at
`client/web/scene.html`, and `/` redirects there. Try it locally first:

```sh
python3.11 -m http.server 8090 --bind 127.0.0.1 --directory dist/web
```

Open <http://127.0.0.1:8090/>; Field notes should read "Verified 69 fetched files".

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
