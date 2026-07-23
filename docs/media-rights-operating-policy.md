# Pulse Gaming media-rights operating policy

This policy keeps the rights process proportionate without pretending that a credit creates permission.

## Practical routes

Every third-party media asset must use exactly one documented route:

1. **Owned or directly licensed** — Pulse Gaming owns the asset or has a direct commercial licence covering every target platform.
2. **Publisher policy** — the material is from the publisher's official source, the publisher owns it and the exact policy permits commercial use on every target platform. Required notices and links are carried into the public copy.
3. **Bounded editorial excerpt** — a short, publicly released extract from the official source is necessary for criticism, review or quotation, is used under original commentary and does not substitute for the source.

Attribution without one of those routes is RED.

## Editorial excerpt controls

The automated low-risk lane requires all of the following:

- a direct official source URL and named owner
- lawfully accessed, publicly released material
- no leaks, third-party reposts or unlicensed music
- source audio removed from motion extracts
- an exact source time range and exact placement in the Pulse edit
- original commentary plus a written transformation and necessity note
- confirmation that the use is non-substitutive
- a small time-bound on-screen credit and a fuller description source line
- one recorded owner acceptance of this editorial-exception operating policy

Pulse uses internal risk guardrails of no more than six seconds for one continuous motion extract, no more than twenty seconds of third-party media in one video and no more than six seconds for one still. These are conservative production controls, not statutory duration rules.

A photograph is not auto-approved solely under the UK current-events reporting exception. It needs another defensible basis, such as criticism, review or quotation assessed on its facts, a publisher policy or a licence.

## Renderer contract

`npm run ops:media-rights-assess` produces:

- `media_rights_assessment.json`
- `media_rights_records.json` with current asset and evidence hashes
- `media_attribution_manifest.json`
- `description_attribution.txt`
- an optional `render_story_with_media_rights.json`

Studio V4 reads `media_attribution_manifest` from the render story and burns each approved credit into the video only for the time that the credited media is visible.

Example:

```powershell
npm run ops:media-rights-assess -- --input input/media-rights-request.json --out-dir output/media-rights/story-id --story-json output/story-id/story.json
```

The command is local proof only. It does not publish, mutate production database rows or touch OAuth tokens.

## Legal position

UK fair dealing is fact-specific. Sufficient acknowledgement can be required, but the amount copied must be reasonable and necessary and the use must not replace the original. Platform claims can still occur even where an exception may ultimately apply. This operating policy is a risk-control system, not legal advice.

Primary references:

- UK Intellectual Property Office: <https://www.gov.uk/guidance/exceptions-to-copyright>
- YouTube fair use guidance: <https://support.google.com/youtube/answer/9783148?hl=en>
- Xbox Game Content Usage Rules: <https://www.xbox.com/en-US/developers/rules>
- Nintendo Game Content Guidelines: <https://www.nintendo.co.jp/networkservice_guideline/en/index.html>
