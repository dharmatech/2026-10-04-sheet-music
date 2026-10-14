# Sheet Music Note-Name Helper

Design background, goals and the Phase 1 / Phase 2 plan are in [HANDOFF.md](HANDOFF.md). Read it first.

## Build and run

Needs `lilypond` (Ubuntu package, 2.24.4) and `python3`. Ask before installing anything else.

```
make svg      # tagged SVG pages + manifest → web/svg/ (gitignored)
make pdf      # plain PDF → build/clair-de-lune.pdf
make serve    # builds svg, serves web/ at http://localhost:8000/  (SVGs can't load from file://)
```

## Deployment

Live at https://dharmatech.github.io/2026-10-04-sheet-music/ (repo: github.com/dharmatech/2026-10-04-sheet-music).
`.github/workflows/pages.yml` runs on every push to `master`: it installs LilyPond from apt, runs `make svg` and publishes `web/` to GitHub Pages. Pages is set to "GitHub Actions" as its source. Generated SVGs are never committed.

## Layout

- `scores/original/` — Mutopia files exactly as downloaded (2.12.3 source, PDF, MIDI). Don't edit.
- `scores/clair-de-lune.ly` — `convert-ly` output for 2.24. Otherwise unchanged.
- `lilypond/tag-noteheads.ily` — Scheme engraver that writes `data-*` attributes onto each NoteHead and StaffSymbol in the SVG. It's loaded with `-dinclude-settings`, so the score file stays clean. The header comment lists every attribute.
- `web/` — the whole site: `index.html`, `app.js`, `style.css`, plus the generated `svg/`. No JS build step or dependencies; the only external resource is a Google Fonts subset of Noto Music for the accidental glyphs.

## How it works

- **Column:** all noteheads with the same onset (`data-onset`, plus `data-grace` for grace notes), across both staves.
- **Held at time t:** notes with onset < t < onset + dur, plus tie continuations (`data-tied`) at t.
- **Hit-testing:** each system's vertical band comes from its StaffSymbols (`data-sys`). The pointer snaps to the column with the nearest mean notehead x within that system.
- **Hidden heads:** `data-hidden` (`\hideNotes` placeholders) are dropped. `data-merged` heads (merged into an identical head in another voice) are real notes; they're kept for timing but never drawn.
- **Grouping:** notes are grouped by the staff they're printed on by default. The "hand" option uses the Voice ids instead (`red`/`green` = RH, `blue`/`grey` = LH, set in `SCORE.voiceHand` in `app.js`).
- **Names:** spelling comes from the LilyPond pitch, so B𝄫 stays B𝄫. Octaves are scientific (middle C = C4) and give the sounding pitch; notes under 8va are tagged.

## Corrections to HANDOFF.md facts (checked against the source and render)

- **Measure 2, left hand:** G♭4–**B𝄫4** (a double flat), not a natural sign.
- **Lower staff clef:** switches to bass clef at the end of measure 5 (bass clef from measure 6 on).

## Status (2026-10-14)

Phase 1 Milestone 1 works. Measures 1–2, the duplets in m. 3, the grace note in m. 18, 8va, the C♯ minor section and the merged/hidden heads all check out against the source.

Still open:
- Eduardo to confirm octave numbers and the staff-vs-hand default.
- Sustain pedal isn't modelled ("held" means written duration only).
- No audio.
