# Three.js r187

The web client serves these vendored ES modules directly. It needs no npm
install, build step, or new runtime package. Both modules come from the official
[Three.js 0.187.0 archive](https://registry.npmjs.org/three/-/three-0.187.0.tgz),
release [r187](https://github.com/mrdoob/three.js/releases/tag/r187), archive
SHA-256 `ff540832ded0cfe919764d24a3d88f3e2a05f23303f876423e4f893841e90728`.

| File | Source and SHA-256 |
|---|---|
| `three.core.min.js` | `package/build/three.core.js` · `486b35224e7068dff435177ca2ab2a063e4a76a8b39a2a364d40efdad2fa702d` |
| `three.module.min.js` | `package/build/three.module.js` · `2ab8c759781e57244580c06006dafa8a5a36490d326c975d4cc220914f094c88` |
| `LICENSE.three` | `package/LICENSE` · `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `meshopt_decoder.module.js` | [meshoptimizer 0.22 from r180](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/libs/meshopt_decoder.module.js) · `784315b6959c85459eab77f51776158cc381d7e7d77b919ff7c4935f088a7c5c` |

The r187 archive no longer ships minified files. The recorded one-off
minification used the already installed Bun 1.4.2. From an extracted archive,
copy `package/build/three.core.js` to `three.core.min.js` as an input and
replace `./three.core.js` with `./three.core.min.js` in the module input to
retain the existing browser URLs. Run `bun build three.core.min.js --minify
--outfile=core.min.js` and `bun build three.module.js --minify --external
'*three.core.min.js' --outfile=module.min.js`. Prepend the upstream five-line
MIT header to both outputs and rename them to the vendored paths. Copy
`package/LICENSE` verbatim. The meshopt decoder is independently pinned to
the existing packed asset pipeline and is unchanged.

Relevant migration changes: r187 offscreen viewports and scissors use physical
pixels, and WebGL PCF now exposes native comparison depth textures. Update
the two Three modules together and verify startup, captures at non-unit scales,
scenery and actor shadows, and the packaged runtime manifest.
