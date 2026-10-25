# Loading journal artwork

`journal-hand-sketch-v1.png` is the exact generated image approved by the human
on 2026-10-24. Keep these pixels: the image generator is not a deterministic
source, and the prompt cannot reproduce the approved image byte for byte.
The page uses a CSS viewport over its landscape (x 162, y 270, 1334 × 490 in
the 1586 × 992 original). Titles, progress, status and retry remain live HTML.
The original approved screen, including its baked text, stays intact for reuse.

`history/original-journal.svg` is the original code-drawn landscape, preserved
as a standalone reusable asset. `history/original-loading-screen.html` preserves
the complete earlier journal layout and opens as a static page. Neither history
file is fetched or required by the game. The inline original sketch is also the
immediate fallback while the approved image downloads.

The exact generation prompt and provenance are saved privately in
`docs/reviews/loading-history/approved-journal-prompt.md`. This is browser UI art;
it does not author world geography, placements or simulation rules.
