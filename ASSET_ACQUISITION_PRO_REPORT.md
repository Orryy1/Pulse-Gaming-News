# Asset Acquisition Pro Report

Date: 2026-05-01

## What Was Built

Asset Acquisition Pro is a read-only planning layer for Pulse media sourcing.

It answers, before rendering:

- does this story need official trailers?
- does it need Steam or IGDB imagery?
- does it need trailer frames or clip slices?
- does it need an article hero image?
- does it need publisher or press-kit assets?
- is the current thumbnail subject safe?
- should the story be left alone because it is already premium-ready?
- should no asset work be done because the story is off-brand?

## Command

```bash
npm run ops:asset-acquisition
```

Useful forms:

```bash
npm run ops:asset-acquisition -- --fixture
npm run ops:asset-acquisition -- --limit 5
npm run ops:asset-acquisition -- --story-id STORY_ID
npm run ops:asset-acquisition -- --all-approved
```

## Outputs

- `test/output/asset_acquisition_pro.json`
- `test/output/asset_acquisition_pro.md`
- `test/output/asset-acquisition/<storyId>/asset_acquisition_plan.json`
- `test/output/asset-acquisition/<storyId>/asset_acquisition_plan.md`

## Safety Position

This is plan-only.

It does not:

- download assets;
- render videos;
- publish;
- mutate the story database;
- touch OAuth;
- change Railway;
- change environment variables;
- use browser-cookie automation;
- change scheduler behaviour.

Every emitted task is marked:

```json
{
  "will_download": false,
  "mutates": false
}
```

## Real Local Sample

`npm run ops:asset-acquisition -- --limit 5` produced:

- Overall: AMBER
- Stories: 5
- Acquire: 5
- Maintain: 0
- Reject: 0

Key work needed:

- official trailer search;
- Steam store search;
- IGDB lookup;
- article hero fetch;
- publisher press-kit search;
- thumbnail candidate build.

This matches the current strategic problem: the pipeline is not failing because it cannot make videos, it is failing because too many stories enter rendering with thin or poorly targeted media.

## Behaviour Covered By Tests

- off-brand House of the Dragon stories get no acquisition work;
- thin GTA/Xbox stories get Steam, trailer and thumbnail tasks;
- existing trailers produce frame and clip extraction tasks;
- premium-ready stories remain in maintain mode;
- unsafe human/stock visuals require replacement before thumbnail use;
- control-room JSON is serialisable and Markdown is readable.

## Verification

- `node --test tests/services/asset-acquisition-pro.test.js tests/services/creator-studio-os.test.js tests/services/studio-v2-regressions.test.js`: 43/43 pass
- `npm test`: 1,531/1,531 pass
- `npm run build`: pass
- `npm run ops:asset-acquisition -- --fixture`: pass
- `npm run ops:asset-acquisition -- --limit 5`: pass

## What Remains Manual Or Future

- This report does not download assets yet.
- It does not promote any story to Studio V2.
- It does not change publish gates.
- It does not make asset acquisition a hard requirement.
- It does not add dashboard UI yet.

## Recommended Next Build

Build the approved worker for one safe acquisition task at a time, starting with official trailer and Steam/IGDB enrichment in local-only mode. Keep it behind an explicit command and continue writing plan files before any download happens.
