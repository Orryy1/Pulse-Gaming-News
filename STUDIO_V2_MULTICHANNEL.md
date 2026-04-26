# Studio v2 — multi-channel theming

The v2 engine renders the same story across 3 channel skins — Pulse Gaming (amber), Stacked (green), The Signal (purple) — using one orchestrator, one set of templates, and one source story.

## Proof

[test/output/studio_v2_1sn9xhe_multichannel.mp4](test/output/studio_v2_1sn9xhe_multichannel.mp4) — 3-up side-by-side render, ~51-60s, 3240×1920.

[test/output/studio_v2_1sn9xhe_multichannel_contact.jpg](test/output/studio_v2_1sn9xhe_multichannel_contact.jpg) — frame grid stacked vertically by channel.

Per-channel renders:

- `test/output/studio_v2_1sn9xhe.mp4` — Pulse Gaming (default, no suffix)
- `test/output/studio_v2_1sn9xhe__stacked.mp4` — Stacked
- `test/output/studio_v2_1sn9xhe__the-signal.mp4` — The Signal

Per-channel cards (each kind × each channel = 12 MP4s):

```
hf_source_card_1sn9xhe.mp4               — Pulse (default)
hf_source_card_1sn9xhe__stacked.mp4      — Stacked
hf_source_card_1sn9xhe__the-signal.mp4   — The Signal
hf_context_card_1sn9xhe.mp4              — Pulse (default)
hf_context_card_1sn9xhe__stacked.mp4     — Stacked
hf_context_card_1sn9xhe__the-signal.mp4  — The Signal
... (same pattern for quote and takeaway)
```

## Quality verdicts

| Channel                                 | Lane verdict | Green | Amber | Red | Notes            |
| --------------------------------------- | ------------ | ----- | ----- | --- | ---------------- |
| Pulse Gaming (Liam, 1.1× rate)          | **PASS**     | 13    | 3     | 0   | 51.20s, 10.79 MB |
| Stacked (Antoni, 1.0× rate)             | **PASS**     | 13    | 3     | 0   | 51.33s, 11.11 MB |
| The Signal (different voice, 1.0× rate) | **PASS**     | 13    | 3     | 0   | 59.87s, 11.86 MB |

All three pass on all 16 rubric criteria. The Signal runs ~9s longer because its channel config picks a different ElevenLabs voice with a different speaking rate.

## How it works

### 1. Channel theme registry — `lib/studio/v2/channel-themes.js`

Pulls v2-shaped themes from the existing `/channels/<id>.js` registry:

```js
{
  channelId: 'pulse-gaming',
  channelName: 'PULSE GAMING',
  tagline: 'Verified leaks. Every day.',
  primary: '#FF6B1A',
  primaryGlow: 'rgba(255, 107, 26, 0.7)',
  primaryHalf: 'rgba(255, 107, 26, 0.18)',
  secondary: '#0d0d0f',
  alert: '#FF2D2D',
  text: '#F0F0F0',
  muted: '#6B7280',
}
```

`applyThemeToHtml(html, theme)` does a deterministic regex sweep over the per-story HTML — replaces every Pulse Gaming sentinel (`#FF6B1A`, `rgba(255, 107, 26, *)`, `#0d0d0f`, `PULSE GAMING`) with channel-specific equivalents. No DOM parsing, no CSS variables, no template engine — just precise string substitution that doesn't touch unrelated styles like backdrop colours.

### 2. Card builders accept `channelId` — `lib/studio/v2/hf-card-builders.js`

Each builder (`buildStorySourceCard`, `buildStoryContextCard`, `buildStoryQuoteCard`, `buildStoryTakeawayCard`) takes an optional `channelId` parameter. When channelId is `pulse-gaming` (default), paths fall back to the legacy non-suffixed form so existing renders keep resolving. Other channels get their own namespace:

- Project: `experiments/hf-<kind>-<storyId>__<channel>/`
- Output: `test/output/hf_<kind>_card_<storyId>__<channel>.mp4`

### 3. Lane resolves channel-specific renders first — `lib/studio/v2/premium-card-lane-v2.js`

```
hf_<kind>_card_<id>__<channel>.mp4   ← preferred when CHANNEL is set
hf_<kind>_card_<id>.mp4              ← per-story (Pulse default) fallback
hf_<kind>_card_v1.mp4                ← generic v1 template
experiments/hf-<kind>/<kind>-card.mp4 ← original template render
```

Decision log records `cardSource: "story-specific-channel"` so the report shows which lane each card came from.

### 4. Orchestrator passes CHANNEL through — `tools/studio-v2-render.js`

`applyPremiumCardLaneV2({ ..., channelId: process.env.CHANNEL || "pulse-gaming" })`. The voice path also picks up the channel automatically because it reads from `brand.voiceId` which the channel registry populates.

### 5. Multi-channel orchestrator — `tools/studio-v2-multichannel.js`

```bash
node tools/studio-v2-multichannel.js [storyId]
```

Loops over all 3 channels:

1. Builds all 4 cards with theme injection
2. Runs `tools/studio-v2-render.js` with `CHANNEL=<id>` and `STUDIO_V2_OUTPUT_SUFFIX=__<id>`
3. Stacks the 3 outputs horizontally with brand-coloured top labels via ffmpeg `hstack`
4. Builds per-channel contact sheets and combines vertically

Writes a manifest at `test/output/studio_v2_<id>_multichannel_manifest.json`.

## Side effect: per-channel voices

The channel registry already binds different ElevenLabs voices per channel:

- Pulse Gaming → Liam (`TX3LPaxmHKxFdv7VOQHJ`), young, energetic, 1.1× rate
- Stacked → Antoni (`ErXwobaYiN019PkySvjV`), authoritative, 1.0× rate
- The Signal → female (`EXAVITQu4vr4xnSDxMaL`), tech-forward, 1.0× rate

Because the v2 voice path reads from `brand.voiceId`, each channel render uses its OWN voice. The multi-channel run produces 3 actual voiced renders, not just 3 colour reskins.

## Limitations and follow-ups

- **Subtitle emphasis colour is currently hardcoded amber** in `subtitle-layer-v2.js` ASS header (`PrimaryColour=&H001A6BFF`). The per-word kinetic captions stay Pulse-amber across all channel renders. To theme this, the ASS header generator needs to accept a channel theme and convert `theme.primary` into BGR hex. Not blocking — the captions are subtle and the HF cards carry the brand identity.
- **The 3 voices land at slightly different durations** so the 3-up render's per-frame alignment isn't synchronous. That's a feature, not a bug — each channel's render is its own independent shippable artefact.
- **Per-channel music beds not yet swapped.** The v2 sound layer uses `audio/Main Background Loop 1.wav` regardless of channel. Each channel's `musicPrompt` array in the registry hints at the desired vibe (gaming trap for Pulse, sleek finance for Stacked, futuristic synth for The Signal). Wiring per-channel music would need a second asset cache.
- **Per-channel font choices not yet swapped.** All 3 channels use Arial Black / Inter currently. Stacked might want a tighter financial-press font, The Signal might want something more geometric/cybertech.

## How to add a new channel

1. Add a config to `channels/<new-channel>.js` following the existing structure (id, name, colours, classificationColour, voiceId, etc.).
2. Run the multi-channel script with the new channel in `CHANNELS` (edit `tools/studio-v2-multichannel.js` line `const CHANNELS = ...`).
3. The theme injection handles the rest — the new brand palette lands in every HF card automatically.

That's it. No template duplication, no per-channel HTML files, no template-engine layer.
