# Forest litter v1 — 2026-10-24

`forest-litter-v1.png` is the source bitmap, generated with the built-in ImageGen
tool for this project's first-person forest pass. It is a material input, not an
approval render; no committed script can regenerate the same pixels. Retain it
in Git. No external model/API dependency is needed by the game or build.

- Actual size: 1254 × 1254, 4,741,123 bytes.
- SHA-256: `8cddfb33413d7725931f8ee536de23a3b55ea619de3a1d7836fef6513e1a9382`.
- Interpretation: approximately 1.5 m across; sRGB albedo, repeat wrapping,
  mipmaps and up to 8× anisotropy. Three stochastic samples soften repetition.
- The relief is a small approximation from material luminance, not measured
  height or a scanned PBR material. The fine dark crevices include generated AO.

## Final prompt

Use case: photorealistic-natural. Asset type: seamless square tileable PBR
base-color texture for a first-person redwood forest floor, top-down orthographic
photograph covering approximately 1.5 by 1.5 metres. A rich decomposing redwood
needle mat, small faded brown conifer sprays, dark moist humus, tiny irregular
bark fragments, scattered very small muted olive moss patches. Many small
overlapping real organic textures and subtle natural color variation. Peaceful
temperate forest in late spring. Real-world detail, no stylization. Flat neutral
diffuse lighting, NO baked cast shadows, NO sun patches, NO highlights, NO ambient
vignette, NO perspective or depth of field. Even distribution to all four edges,
perfectly seamless repeating edges, no dominant central object. Palette subdued
neutral umber, faded russet and grey-brown needles, a little muted moss green.
Material albedo only. No rocks larger than 4 cm, no logs, no large leaves or
plants, no trees, no animals, no text or watermark. Output one 1024x1024 square
texture image.
