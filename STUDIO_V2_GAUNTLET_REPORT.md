# Studio V2 Gauntlet Report

Generated locally on `codex/studio-short-engine-v1`.

No merge, deploy, Railway, production publish job or live environment variable
change was performed.

## Scope

This pass adds a rendered-output gauntlet around Studio V2. It does not replace
the renderer. It scans existing MP4/report/ASS artefacts, reruns forensic QA,
measures loudness and builds a browsable dashboard.

## New Local Commands

```bash
npm run studio:v2:gauntlet
npm run studio:v2:compare-variants -- 1sn9xhe canonical nofreeze
npm run studio:v2:audio-master-ab -- 1sn9xhe -16
```

## Outputs

- `test/output/studio_v2_gauntlet_report.json`
- `test/output/studio_v2_gauntlet.md`
- `test/output/studio_v2_gauntlet.html`
- `test/output/studio_v2_1sn9xhe_canonical_vs_nofreeze.mp4`
- `test/output/studio_v2_1sn9xhe_canonical_vs_nofreeze_contact.jpg`
- `test/output/studio_v2_1sn9xhe_canonical_vs_climaxramp.mp4`
- `test/output/studio_v2_1sn9xhe_canonical_vs_climaxramp_contact.jpg`
- `test/output/studio_v2_1sn9xhe_loudnorm16.mp4`
- `test/output/studio_v2_1sn9xhe_loudnorm16_audio_master_report.json`
- `test/output/qa_forensic_1sn9xhe_loudnorm16_report.json`

## Current Matrix

| Candidate | Score | Studio | Forensic | Duration | SFX | LUFS | Notes |
| --- | ---: | --- | --- | ---: | ---: | ---: | --- |
| `1sn9xhe:canonical` | 100 | pass | pass | 55.432 | 1 | -24.3 | Current safest canonical render |
| `1sn9xhe:loudnorm16` | 100 | pass | pass | 55.432 | 1 | -16.7 | Best audio-master benchmark |
| `1sn9xhe:climaxramp` | 98 | pass | pass | 55.432 | 1 | -24.3 | Extra speed-ramp, but source diversity drops |
| `1sn9xhe:nofreeze` | 95 | pass | pass | 55.432 | 1 | -24.3 | Passes, but lacks freeze-frame grammar |
| `1sn9xhe:loudnorm14` | 79 | pass | warn | 55.432 | 1 | -15.4 | Too aggressive; audio recurrence warning |
| `1sn9xhe:snapshot-3954f4c` | 33 | pass | fail | 51.2 | 16 | -24.1 | Repeated SFX and subtitle overrun |
| `1sn9xhe:storyq` | 33 | pass | fail | 51.2 | 16 | -24.1 | Repeated SFX and subtitle overrun |
| `1sn9xhe:snapshot-689decb` | 3 | downgrade | fail | 48.433 | 15 | -23.9 | Repeated SFX and severe truncation |

## Honest Read

The current canonical render is materially safer than the older V2 snapshots:
it removes the recurring SFX pattern, covers the full subtitle/narration
timeline and keeps the production voice path.

The no-freeze comparison is less decisive than the numeric score suggests. The
side-by-side contact sheet shows the canonical and no-freeze renders are still
very similar in sampled frames. The freeze-frame is a reasonable editorial beat,
but it is not a dramatic visible improvement by itself.

The climax-ramp variant is not a material improvement. It passes forensic QA and
adds one more authored motion beat, but the contact sheet still looks very close
to canonical and the automatic source-diversity grade drops from green to amber.
It should remain a local experiment, not the new default.

The `-16 LUFS` audio master is worth reviewing by ear. It raises the mix by
about 7.6 LU while keeping forensic QA green. The `-14 LUFS` master is not safe
enough to adopt from metrics alone because it triggers a cut-synchronous audio
recurrence warning.

## Next Local Step

The next meaningful improvement is not another scoring tweak. It is a visible
scene-variety pass: replace one or two visually similar mid-run frame scenes
with genuinely different clip beats or a more authored card/overlay moment, then
rerun the gauntlet and compare against both canonical and no-freeze.
