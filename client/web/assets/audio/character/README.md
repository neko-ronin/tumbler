# Character charge · Meow Cat #2 — Joseph SARDIN

Human-selected source: [Meow Cat #2, BigSoundBank #1890](https://bigsoundbank.com/meow-cat-2-s1890.html).
The publisher identifies CC0 and permits editing, redistribution and commercial
use without attribution. Credit is retained here voluntarily. Source URL, file
identity, technical inspection and the accepted review are in `provenance.json`.
No library, installer or service is needed by the game.

`source/` preserves the inspected original. `build_charge.py` beside `charge.wav`
is the asset source: edit the recipe and regenerate, never edit the output.
Run `python3 client/web/assets/audio/character/build_charge.py` using the existing
ffmpeg tool to reproduce the compact 0.68 s edit. Pitch/speed are unchanged.
The resulting WAV is byte-identical to the round-03 audition the human accepted.
This is a runtime sound asset, not an approval render. The game fetches only
`charge.wav`, verified by the viewer manifest, and decodes it once per audio
context. It plays at gain 0.5 into the existing character panner on the existing
charge event. Source/recipe/provenance do not add requests to the game.

The rejected round-02 synthetic voice is not used. The untrimmed/natural recording
remains a historical audition, not an alternate runtime random variant.
