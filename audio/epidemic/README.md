# Epidemic Sound Intake

This folder is for a retained Epidemic Sound pack. Pulse can still run on the existing owned beds, bespoke SFX and Sonniss assets without it, but a paid Epidemic subscription is useful if we keep the assets organised and rights-backed.

Use it when an active Epidemic subscription is worth keeping for better production polish:

- put music beds under `audio/epidemic/music/bed_primary/` and `audio/epidemic/music/bed_breaking/`
- put short stings under `audio/epidemic/stings/sting_verified/`, `audio/epidemic/stings/sting_rumour/` and `audio/epidemic/stings/sting_breaking/`
- put downloaded SFX under `audio/epidemic/sfx/`
- put stems under `audio/epidemic/stems/` only when a human wants manual mix control
- keep music-bed use tied to generated audio-pack candidates and rights ledger records
- keep channel or video safelisting evidence in the relevant proof package
- do not store account screenshots, billing data, OAuth tokens or personal details here
- do not use Epidemic assets in new published videos after the subscription ends unless a separate licence covers that use

Run the full local Epidemic intake proof with:

```powershell
npm run ops:epidemic-sound-intake -- --root audio/epidemic --out-dir output/epidemic-sound-intake --safelist-evidence <path-or-url>
```

After downloading files in the browser, run a dry-run intake from Downloads:

```powershell
npm run ops:epidemic-download-intake -- --source "$env:USERPROFILE\Downloads"
```

If the planned copy report looks right, apply it:

```powershell
npm run ops:epidemic-download-intake -- --source "$env:USERPROFILE\Downloads" --apply
```

The default download intake only plans files with an `epidemic_<role>_` prefix, for example `epidemic_bed_primary_neon-loop.wav` or `epidemic_transition_fast-whoosh.wav`. This prevents old Downloads audio from being copied into the Epidemic pack by mistake. Use `--allow-unprefixed` only for a deliberately isolated download folder that contains Epidemic files and nothing else.

Run the SFX-only source plan with:

```powershell
npm run ops:v4-sfx-library-ingest -- --root audio/epidemic --out-dir output/epidemic-sound-intake
```

When the intake report is `pass`, materialise channel packs and the SFX runtime manifest with:

```powershell
npm run ops:epidemic-audio-pack-materialize -- --intake-report output/epidemic-sound-intake/epidemic_sound_intake_report.json --out-dir output/epidemic-implementation
```

Add `--apply` only after the implementation report is `ready`. A blocked report will not write `channels/<channel>/audio/pack.json`.

These commands are local-only. They do not download assets, post externally, mutate database rows, mutate OAuth tokens or publish anything.
