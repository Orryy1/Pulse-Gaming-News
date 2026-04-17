# Phase 5 — Audio Identity Integration Audit

**Mandate:** "integrate audio identity into real rendering."
**Finding:** substantively already done. This doc records the audit
evidence so a future reader doesn't re-do the work.

## Coverage matrix

| Renderer                                     | Audio resolution                                   | Status                                                                                               |
| -------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `assemble.js:84-100`                         | `audioIdentity.resolve({ role: 'bed' / 'sting' })` | **Done** — reads per-channel pack with flair/breaking-aware selection                                |
| `assemble_longform.js:232-234`               | `audioIdentity.resolve({ role: 'bed' })`           | **Done** — weekly roundup uses bed from pack                                                         |
| `server.js:1749`                             | admin/debug route                                  | Debug endpoint, not a render path                                                                    |
| `scripts/generate_identity_stems.js:303`     | sync only, not a renderer                          | Populates DB packs; no hard-coded output paths                                                       |
| `lib/repurpose.js` (derivatives)             | Not referenced                                     | **Intentional** — derivatives (teaser_short, story_short) are narration-only; no music bed by design |
| `tts_server/infer_service.py::compose_short` | Not referenced                                     | **Intentional** — takes narration_path from params, composes video + drawtext overlays only          |

## Hard-coded audio paths in rendering code

Grep summary (`audio/[A-Za-z]|Main Background|Breaking News Sting|intro\.(wav|mp3)|outro\.(wav|mp3)` over `*.js`):

- `lib/audio-identity.js:52-57` — FALLBACK_PACK definition referring to `Main Background Loop 1.wav`, `Breaking News Sting 1.wav`, etc. **Legitimate** — this IS the registry of fallback assets. Any channel without a dedicated pack inherits these via `FALLBACK_PACK.id='pulse-v1'`.
- `assemble.js:258`, `assemble_longform.js:298` — the string `audio/mpeg` in HTTP Accept headers. Not file paths.
- `breaking_queue.js:72` — comment only.

**No hard-coded audio file paths exist in rendering code outside the canonical registry.** Phase A §6's UNVERIFIED flags were precautionary; the actual code is clean.

## What Phase 5 would add if prioritised

Only one gap identified, and it's by design rather than defect:

- **Derivatives have no music bed.** `lib/repurpose.js` renders teaser_shorts and story_shorts by calling `compose_short` with just a narration track. If editorial wants a music bed under derivative shorts, the fix is:
  1. Extend `compose_short` params schema with an optional `bed_path`.
  2. Resolve `audioIdentity.resolve({ channelId, role: 'bed_primary', breaking: breakingFlag })` in `lib/repurpose::runDerivative` before the infer call.
  3. Add `-filter_complex amix` to the ffmpeg command in `compose_short` to blend the bed under narration at ~15% gain.

  This is a feature addition, not a hardening fix — deferred.

## Observability

`lib/audio-identity.js:223-232` already calls `recordIdentityFallback(...)` when a channel's resolved asset comes from `pulse-v1` fallback instead of the channel's own pack. The Phase 1 observability layer surfaces this in the scoring digest. No new observability needed here.

## Tests (Phase G input)

To put a regression bar under the current behaviour, the Phase G verification pack should include:

1. `resolve({ channelId: 'stacked', role: 'bed_primary' })` returns a file under `channels/stacked/audio/` when that pack has an asset.
2. `resolve({ channelId: 'stacked', role: 'bed_primary' })` falls back to `pulse-v1` when `stacked`'s pack lacks `bed_primary`, and records the fallback event.
3. `resolve({ channelId: 'pulse-gaming', role: 'sting', flair: 'Verified' })` returns `sting_verified` → `sting_breaking` → `intro` in that order based on what's present.
4. Flair-specific resolution: `flair='Rumour'` returns `sting_rumour` with fallback to `intro`.

These aren't in the current 39-test pack — slotted for Phase G.

## Conclusion

Phase 5 requires **no code changes today**. The integration is complete. Remaining work (derivative music beds, flair-specific resolver tests) is catalogued above and falls into Phase 5B (features) and Phase G (tests).
