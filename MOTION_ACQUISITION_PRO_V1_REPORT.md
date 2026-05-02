# Motion Acquisition Pro v1

Date: 2026-05-01

## Purpose

Motion Acquisition Pro v1 turns the existing trailer/frame planning inside Asset Acquisition Pro into a clear operator report.

It answers:

- does this story already have an official trailer or gameplay reference?
- does it need official trailer search?
- does it need local frame extraction?
- does it need clip slicing?
- is it ready for a local Studio V2 motion proof?

This is report-only. It does not download videos, extract frames, slice clips, run yt-dlp, scrape browsers, mutate Railway, touch OAuth, mutate the production DB or post anywhere.

## Command

```bash
npm run media:plan-motion
npm run media:plan-motion -- --fixture
npm run media:plan-motion -- --limit 5
npm run media:plan-motion -- --story-id STORY_ID
```

Alias:

```bash
npm run ops:motion-acquisition
```

Outputs:

```text
test/output/motion_acquisition_v1.json
test/output/motion_acquisition_v1.md
```

## What Was Built

- `lib/motion-acquisition-pro.js`
- `tools/motion-acquisition-pro.js`
- `tests/services/motion-acquisition-pro.test.js`
- package scripts:
  - `media:plan-motion`
  - `ops:motion-acquisition`

## Latest Local Sample

Command:

```bash
npm run media:plan-motion -- --limit 5
```

Result:

```text
Stories scanned: 5
Local motion proof ready: 0
Reference ready for local frame plan: 0
Official trailer search required: 5
```

Meaning: the next bottleneck is not still-image coverage any more. The next bottleneck is safe official motion references.

## Safety

- Report-only.
- No downloads.
- No frame extraction.
- No clip slicing.
- No yt-dlp.
- No browser scraping.
- No production DB mutation.
- No production renderer changes.
- No social posting.

## Next Phase

Build **Official Trailer Reference Resolver v1**.

That should still be local/report-only first:

1. gather official Steam movie references where store app ids are verified;
2. gather IGDB video references where title/slug is verified;
3. record YouTube/platform/publisher official-channel search queries without downloading;
4. produce a motion provenance ledger;
5. only after that, build a controlled local frame-extraction worker for already-approved official references.
