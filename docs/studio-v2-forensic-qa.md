# Studio V2 Forensic QA

Local-only validation for Studio Short Engine V2 renders.

This suite is deliberately separate from the render pipeline. It reads the
finished MP4, the ASS subtitle file and the Studio V2 JSON report, then writes
evidence under `test/output/qa_forensic_*`.

## Commands

Run QA on the canonical V2 render:

```bash
npm run studio:v2:qa -- 1sn9xhe
```

Run QA on a pinned render with explicit inputs:

```bash
node tools/studio-v2-forensic-qa.js 1sn9xhe_3954f4c \
  --mp4=test/output/qa_studio_v2_1sn9xhe_3954f4c_snapshot.mp4 \
  --report=test/output/qa_1sn9xhe_studio_v2_3954f4c_report.json \
  --ass=test/output/qa_1sn9xhe_studio_v2_3954f4c.ass
```

Compare two forensic reports:

```bash
npm run studio:v2:qa:compare -- \
  --before=test/output/qa_forensic_1sn9xhe_3954f4c_report.json \
  --after=test/output/qa_forensic_1sn9xhe_report.json \
  --out=qa_forensic_sfx_fix_comparison
```

## What It Checks

- Runtime integrity: MP4 duration versus the Studio V2 report.
- Subtitle integrity: ASS cue count, final cue end time, overrun and gaps over
  two seconds.
- Audio recurrence: declared SFX cue count plus repeated transient-pattern
  detection from the mixed MP4 audio.
- Visual repetition: sampled frame hashes, possible non-adjacent repeats and
  black-frame detection.
- Scene structure: scene type counts, unique source count and heavy source reuse.

## Current 1sn9xhe Result

Current canonical render:

- `test/output/studio_v2_1sn9xhe.mp4`
- `test/output/qa_forensic_1sn9xhe_report.json`
- `test/output/qa_forensic_1sn9xhe.html`
- `test/output/qa_forensic_1sn9xhe_waveform.png`

Current verdict: pass.

The older pinned snapshot at `3954f4c` fails this QA because it had repeated SFX
cues and a shorter render than the subtitle/narration timeline. The generated
comparison report is:

- `test/output/qa_forensic_sfx_fix_comparison.md`
- `test/output/qa_forensic_sfx_fix_comparison.json`
