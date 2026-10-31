# Three.js r180

The web client uses the existing vendored ES modules directly, with no npm
installation or bundler. Both files were compared byte-for-byte with the pinned
upstream r180 build during integration on 2026-10-13; they are unmodified.

| File | Upstream source | SHA-256 |
|---|---|---|
| `three.core.min.js` | <https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.core.min.js> | `61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de` |
| `three.module.min.js` | <https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.module.min.js> | `e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6` |
| `meshopt_decoder.module.js` | <https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/libs/meshopt_decoder.module.js> (meshoptimizer 0.22, MIT, WASM inlined) | `784315b6959c85459eab77f51776158cc381d7e7d77b919ff7c4935f088a7c5c` |

[LICENSE.three](LICENSE.three) is the MIT license from the same upstream tag:
<https://raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE>.

`glb.js` uses the meshopt decoder for the packed cinematic cat folk. An update must replace the three modules together, retain the upstream license, update
these checksums and run the focused browser-client checks plus a visual inspection.
