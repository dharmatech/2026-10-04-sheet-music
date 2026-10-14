# Sheet Music Note-Name Helper: Project Handoff

Handoff from a design discussion in Claude chat (2026-10-14) to Claude Code for implementation. A fresh session should be able to start from this file alone.

## Goal

Build an interactive sheet-music viewer for piano. The user points at a vertical "column" of notes (everything played at the same moment) and a helper panel shows those notes' names.

This is a learning aid. Eduardo reads treble clef slowly (working out each note from the lines and spaces, then checking the key signature and accidentals). He wants to check himself without every note being labeled. On dense piano music, labeling every note gets cluttered. Revealing names on demand keeps the page clean and lets him read first, then check.

**First test piece:** Debussy, *Clair de Lune* (Suite Bergamasque, L. 75, 3rd movement).

## What already exists (and why we're building anyway)

- **Labeling every note** works but gets crowded in chordal piano writing:
  - MuseScore Studio: pitch-name noteheads (Staff/Part properties → Advanced style properties), or the Note Names plugin.
  - LilyPond: `\easyHeadsOn` (letter only, no ♭/♯) or a `NoteNames` context (text, with accidentals).
- **Newzik's Note Identifier** is the closest to this idea. You tap a note or chord and a popover shows the note names, a piano keyboard and a play button. It is proprietary and requires converting the score to Newzik's "LiveScore" format.
- **MuseScore Studio's status bar** shows one note's name when you click it, but not a whole column.
- No free/open-source tool is known that does hover-a-column → names.

**Preference:** free/open-source stack. (Note: MuseScore Studio itself is open source; only the musescore.com website is the commercial, paywalled part.)

## Design decisions so far

- **Column** = all notes that *start* at the same moment, across **both staves** (right hand and left hand together).
- **Held notes:** also show notes still sounding from an earlier onset, styled differently (e.g., dimmed, labeled "held"). *Clair de Lune* has many long notes held under moving ones, so this matters. Possibly make it a toggle.
- **Hit target:** a vertical strip. Snap to the nearest column by horizontal position within the current system, rather than requiring the pointer to sit exactly on a notehead.
- **Helper panel:**
  - Right hand and left hand listed separately.
  - Each hand ordered low → high.
  - Names include the correct accidental spelling (D♭, not C♯). Octave numbers are probably useful (e.g., D♭4); confirm with Eduardo.
  - A small piano keyboard with the column's keys highlighted (different colors for each hand).
- **Keyboard navigation:** ← / → step column by column, with the current column highlighted on the score. This doubles as a slow practice mode.

## Facts about the test piece (useful for checking output)

- Key: **D♭ major**, five flats: **B♭ E♭ A♭ D♭ G♭**. Time signature **9/8**. Marked *Andante très expressif*, *pp*, *con sordina*.
- **Both staves start in treble clef.** The left hand switches to bass clef around measure 7–8 (verify in the source).
- Measure 2's left hand has a natural sign. That's a good test case for accidental handling.

## Score source

**Mutopia Project**, *Suite Bergamasque: Clair de Lune*:
- Page: https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=1778
- ID: Mutopia-2010/12/21-1778. Maintainer: Keith OHara. Source edition: E. Fromont (1905). **Public domain.**
- Available as LilyPond source, MIDI, A4 PDF and Letter PDF.
- **Typeset with LilyPond 2.12.3 (old).** Run `convert-ly` before compiling with a current LilyPond.
- Mutopia's sources are also kept in a GitHub repository (MutopiaProject). Use it if downloading from ibiblio is awkward; check the exact path.

Keep the original `.ly` untouched as a reference copy. Make changes in a converted copy and/or through `\include` files.

## Phase 1: LilyPond SVG prototype (start here)

Why this first: the source for this piece is free and ready, it needs no format conversion, and LilyPond's engraving is excellent. LilyPond's extension language is Scheme (Guile), and Eduardo has a Racket background.

**Key mechanism:** LilyPond's SVG backend supports an `output-attributes` grob property. It takes an alist (values can be numbers, strings or symbols), and the attributes are written onto the `<g>` element wrapping that grob. For example:

```lilypond
\once \override NoteHead.output-attributes =
  #'((id . 123) (class . "this that") (data-whatever . something))
```

A custom engraver can set this on *every* NoteHead automatically.

### Steps

1. **Environment.** Install a current stable LilyPond (check the version). Frescobaldi, a free LilyPond editor with click-to-source in its preview, is optional but handy.
2. **Get and update the source.** Download the Mutopia `.ly`, copy it, run `convert-ly -e` on the copy, and compile to PDF to confirm it builds. Fix anything `convert-ly` couldn't handle.
3. **Tagging engraver** (in its own include file, e.g. `lilypond/tag-noteheads.ily`). For each NoteHead, set `output-attributes` with something like:
   - `data-onset`: the note's onset as a rational (e.g. `"27/8"`), from the context's current moment.
   - `data-pitch`: a display name with accidental and octave, and/or `data-midi` (semitones + 60).
   - `data-dur`: the duration length (needed to work out which notes are held).
   - `data-staff` / `data-hand`: right-hand vs left-hand.
   - A unique `id`.

   Hints to verify against the LilyPond docs: the engraver pattern is `make-engraver` with an `acknowledgers` entry for `note-head-interface`. The event comes from `(event-cause grob)`, and `ly:event-property` gives its `'pitch` / `'duration`. Pitch details come from `ly:pitch-notename`, `ly:pitch-alteration`, `ly:pitch-octave` and `ly:pitch-semitones`. The onset comes from `ly:context-current-moment` and `ly:moment-main`.
4. **Render SVG.** Use `lilypond -dbackend=svg …`. Multi-page scores produce one SVG per page. Inspect the SVG to confirm the `data-*` attributes landed on the notehead `<g>` elements.
5. **Web page** (`web/index.html` + JS):
   - Load the SVG(s) inline and index noteheads by onset.
   - Build columns (same onset) and held sets (onset < t < onset + duration).
   - Map pointer x → nearest column within the current system, using `getBBox()` / bounding rects.
   - Show the panel (RH / LH, low → high, mini keyboard). Highlight the column on the score. Add arrow-key stepping.
6. **Serve locally** with e.g. `python3 -m http.server`, since loading SVGs from `file://` may be blocked.

### Milestone 1

Hovering over each column in **measure 1** shows the correct notes for both hands. Check this by hand against the printed score.

### Risks to check early

- **convert-ly** on a 2.12-era file may need manual fixes.
- **Ties:** a tied continuation notehead should count as *held*, not a new onset.
- **Notes that cross between staves** (`\change Staff`): decide whether "hand" means the staff a note is printed on or the hand that plays it.
- **Grace notes and tuplets:** onsets are stored differently for these (moments have a grace part).
- **Multiple voices per staff:** each voice's noteheads must still merge into one column per onset.
- **Getting staff identity inside the engraver:** how this works depends on how the Mutopia file names its staves.
- **Pagination:** columns are per system; the x-position lookup must stay within one system.

## Phase 2: generalize so it works on any score

Most free scores online are MusicXML, so a general tool should read MusicXML.

- **Verovio** (open source; JS/WASM in the browser, plus Python). It renders MEI, MusicXML, Humdrum, ABC and other formats to SVG with element IDs. Toolkit methods match this project directly:
  - `getElementsAtTime(ms)`: the notes sounding at a given time, i.e. the column plus held notes.
  - `getTimeForElement(id)`, `getElementAttr(id)`, `getMIDIValuesForElement(id)`.
  - Docs: https://book.verovio.org/toolkit-reference/toolkit-methods.html
- **OpenSheetMusicDisplay (OSMD)** (BSD-3; MusicXML rendered with VexFlow) is an alternative. Its cursor steps through the score one timestamp at a time and can return the notes under it, which matches the column and arrow-key idea.
- **Open question:** Mutopia doesn't provide MusicXML for *Clair de Lune*. Options include finding a free MusicXML version elsewhere or converting from LilyPond (python-ly has an experimental MusicXML export; quality unknown).

## Suggested folder layout

```
2026-10-04-sheet-music/
  HANDOFF.md          ← this file
  scores/             ← original Mutopia .ly (untouched) + converted copy
  lilypond/           ← include files (tagging engraver, etc.)
  build/              ← generated PDF/SVG (could be gitignored)
  web/                ← index.html, app.js, style.css
  experiments/        ← scratch work (Verovio/OSMD trials, etc.)
```

Consider `git init` from the start. A short `CLAUDE.md` pointing to this file will make each new Claude Code session load the context automatically.

## References

- Mutopia, *Clair de Lune*: https://www.ibiblio.org/mutopia/cgibin/piece-info.cgi?id=1778
- The Mutopia Project: https://www.ibiblio.org/mutopia/
- LilyPond, SVG output and `output-attributes`: https://lilypond.org/doc/latest/Documentation/notation/svg-output
- LilyPond, note names (`NoteNames` context): https://lilypond.org/doc/v2.25/Documentation/notation/note-names
- Verovio toolkit methods: https://book.verovio.org/toolkit-reference/toolkit-methods.html
- OSMD (cursor usage): https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/wiki/Exploring-the-Demo
- Newzik Note Identifier (prior art): https://support.newzik.com/en/support/solutions/articles/77000595614
