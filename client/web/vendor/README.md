# Three.js r180

The web client uses the existing vendored ES modules directly, with no npm
installation or bundler. Both files were compared byte-for-byte with the pinned
upstream r180 build during integration on 2026-10-13; they are unmodified.

| File | Upstream source | SHA-256 |
|---|---|---|
| `three.core.min.js` | <https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.core.min.js> | `61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de` |
| `three.module.min.js` | <https://raw.githubusercontent.com/mrdoob/three.js/r180/build/three.module.min.js> | `e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6` |

[LICENSE.three](LICENSE.three) is the MIT license from the same upstream tag:
<https://raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE>.

An update must replace both modules together, retain the upstream license, update
these checksums and run the focused browser-client checks plus a visual inspection.
