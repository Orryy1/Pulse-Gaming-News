# Competitor Forensics Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only competitor research lab, convert lawful public-pattern findings into original Pulse rules, integrate those rules into production quality gates and run a 30-story local bakeoff.

**Architecture:** Add three isolated CommonJS service modules plus CLI wrappers. The competitor lab reads public RSS/fixture metadata and writes only metadata, structural analysis and Pulse-original rules. The quality gate converts those rules into a Pulse Media-House Score, and Goal 19 reads that score as a hard GREEN requirement. The bakeoff generates local proof variants and keeps only original Pulse-branded candidates.

**Tech Stack:** Node.js CommonJS, `node:test`, `fs-extra`, built-in `fetch`, existing Goal 08/09/10/15/19 artefact contracts.

---

### Task 1: Competitor Lab Tests

**Files:**
- Create: `tests/services/competitor-forensics-lab.test.js`
- Create: `lib/competitor-forensics-lab.js`

- [ ] **Step 1: Write the failing tests**

```js
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCompetitorForensicsLab,
  writeCompetitorForensicsLab,
} = require("../../lib/competitor-forensics-lab");

function fixtureRegistry() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `channel_${index + 1}`,
    group: index < 10 ? "direct_gaming_news" : "social_first_or_reference",
    platform: "YouTube",
    channel_handle: `@fixture${index + 1}`,
    display_name: `Fixture Channel ${index + 1}`,
    source_method: "operator_fixture",
    collection_url: `https://www.youtube.com/@fixture${index + 1}`,
    allowed_use: "metadata_and_pattern_analysis_only",
  }));
}

function fixtureVideos() {
  return Array.from({ length: 100 }, (_, index) => ({
    platform: "YouTube",
    channel_id: `channel_${(index % 20) + 1}`,
    channel_handle: `@fixture${(index % 20) + 1}`,
    video_url: `https://www.youtube.com/watch?v=fixture${index + 1}`,
    title: index % 2 === 0
      ? `Game ${index + 1} Just Changed Its Launch Plan`
      : `Why Game ${index + 1} Is Getting Pushback`,
    description: "Public RSS fixture metadata only. #gaming #shorts",
    hashtags: ["gaming", "shorts"],
    published_at: "2026-05-20T18:00:00.000Z",
    duration_s: index % 3 === 0 ? 58 : null,
    thumbnail_url: `https://img.youtube.com/vi/fixture${index + 1}/hqdefault.jpg`,
    view_count: index % 5 === 0 ? 200000 + index * 1000 : null,
    like_count: null,
    comment_count: null,
    source_method: "operator_fixture",
  }));
}

test("competitor lab reviews 20 channels and 100 videos without copied assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-lab-"));
  const report = await buildCompetitorForensicsLab({
    registry: fixtureRegistry(),
    metadataInventory: fixtureVideos(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.reviewed_channel_count, 20);
  assert.equal(report.summary.assessed_video_count, 100);
  assert.equal(report.safety.no_copied_assets_stored, true);
  assert.equal(report.safety.no_unauthorised_video_downloads, true);
  assert.equal(report.pulse_upgrade_rulebook.rules.length >= 20, true);
  assert.ok(report.competitor_transcript_structure_analysis.structures.every((row) => !row.full_transcript));
  assert.ok(report.hook_forensics.patterns.some((pattern) => pattern.pulse_rule_id));
});

test("competitor lab writes every required artefact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-lab-write-"));
  const report = await buildCompetitorForensicsLab({
    registry: fixtureRegistry(),
    metadataInventory: fixtureVideos(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });
  const written = await writeCompetitorForensicsLab(report, { outputDir: path.join(root, "out") });

  for (const file of Object.values(written)) {
    assert.equal(await fs.pathExists(file), true, file);
  }
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `node --test tests/services/competitor-forensics-lab.test.js`

Expected: FAIL with `Cannot find module '../../lib/competitor-forensics-lab'`.

- [ ] **Step 3: Implement the lab**

Create `lib/competitor-forensics-lab.js` with:
- default registry covering at least 20 channels across the requested groups
- public RSS metadata collector support with no video download
- structural transcript rows only, never full transcript storage
- required artefact builders:
  `competitor_registry`, `competitor_metadata_inventory`, `competitor_outliers`, `competitor_transcript_structure_analysis`, `title_seo_forensics`, `hook_forensics`, `script_narration_forensics`, `visual_editing_forensics`, `sound_design_forensics`, `branding_forensics`, `commercial_forensics`, `competitor_success_failure_patterns`, `pulse_upgrade_rulebook`, `competitor_research_audit_log`

- [ ] **Step 4: Run the tests to verify GREEN**

Run: `node --test tests/services/competitor-forensics-lab.test.js`

Expected: PASS.

### Task 2: Competitor Lab CLI

**Files:**
- Create: `tools/competitor-forensics-lab.js`
- Modify: `package.json`
- Create: `tests/services/competitor-forensics-lab-cli.test.js`

- [ ] **Step 1: Write the failing CLI tests**

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { parseArgs, usage } = require("../../tools/competitor-forensics-lab");

test("competitor forensics lab CLI parses safe local-proof paths", () => {
  const args = parseArgs([
    "--registry", "test/fixtures/competitors.json",
    "--metadata", "test/fixtures/videos.json",
    "--out-dir", "test/output/competitor-lab",
    "--generated-at", "2026-06-07T12:00:00.000Z",
    "--json",
  ]);

  assert.equal(args.registryPath, "test/fixtures/competitors.json");
  assert.equal(args.metadataPath, "test/fixtures/videos.json");
  assert.equal(args.outDir, "test/output/competitor-lab");
  assert.equal(args.generatedAt, "2026-06-07T12:00:00.000Z");
  assert.equal(args.json, true);
});

test("competitor forensics lab CLI usage documents safety limits", () => {
  assert.match(usage(), /does not download competitor videos/i);
  assert.match(usage(), /does not publish/i);
});
```

- [ ] **Step 2: Run the CLI tests to verify RED**

Run: `node --test tests/services/competitor-forensics-lab-cli.test.js`

Expected: FAIL with missing CLI module.

- [ ] **Step 3: Implement CLI and package script**

Add `tools/competitor-forensics-lab.js` with `parseArgs`, `usage` and `main`. Add script:

```json
"ops:competitor-forensics-lab": "node tools/competitor-forensics-lab.js"
```

- [ ] **Step 4: Run the CLI tests to verify GREEN**

Run: `node --test tests/services/competitor-forensics-lab-cli.test.js`

Expected: PASS.

### Task 3: Pulse Media-House Score Tests

**Files:**
- Create: `tests/services/pulse-media-house-score.test.js`
- Create: `lib/pulse-media-house-score.js`

- [ ] **Step 1: Write failing score tests**

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPulseMediaHouseScore,
} = require("../../lib/pulse-media-house-score");

function strongStory(overrides = {}) {
  return {
    canonical: {
      selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      canonical_subject: "Forza Horizon 6",
      first_spoken_line: "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam.",
      narration_script:
        "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam. Steam interest gives Xbox a cleaner PC story before launch. The payoff is simple: Game Pass messaging now has to compete with where PC players are already paying attention. Follow Pulse Gaming so you never miss a beat.",
    },
    scriptScorecard: { verdict: "viral_ready", viral_score: 88, blockers: [] },
    visualQuality: {
      result: "pass",
      scores: {
        motion_density_score: 91,
        first_3_seconds_hook_score: 89,
        source_lock_quality_score: 86,
        caption_legibility_score: 90,
        card_hierarchy_score: 82,
        transition_energy_score: 87,
        sfx_impact_score: 84,
        rights_risk_score: 95,
        media_house_polish_score: 90,
      },
      visual_evidence_profile: {
        generated_only_motion_deck: false,
        motion_asset_count: 9,
        real_media_family_count: 5,
        blockers: [],
      },
      failures: [],
    },
    director: {
      shot_plan: [
        { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.4 },
        { id: "proof", kind: "motion_clip", startS: 0.3, durationS: 2.7, source_family: "official_a" },
        { id: "source", kind: "source_lock", startS: 2.6, durationS: 1.6 },
      ],
      transition_plan: { planned: [{ family: "impact_cut" }, { family: "source_wipe" }], max_same_family_run: 1 },
      sound_transition_plan: {
        sfx: {
          cue_count: 7,
          max_same_family_run: 1,
          cues: [{ family: "impact", atS: 0 }, { family: "whoosh", atS: 0.4 }],
          mastering: { duck_under_narration: true, narration_priority: true },
        },
      },
      caption_policy: { clean_manual_captions: true, avoid_lower_third_collisions: true },
    },
    audio: {
      voice_status: "materialized",
      word_timestamp_count: 120,
      mix_rules: { narration_priority: true, duck_under_narration: true, limiter: true },
    },
    loudness: { verdict: "pass", metrics: { valid_segment_count: 4, max_peak_db: -1.2, mean_range_db: 2 } },
    affiliate: {
      commercial_intent_type: "story_relevant_game_page",
      disclosure_required: true,
      disclosure_copy: { short: "Affiliate links may earn us a commission." },
      primary_link: { story_relevance: 88, merchant: "Steam", url: "https://store.steampowered.com/app/example" },
    },
    platformManifest: {
      outputs: {
        youtube_shorts: { title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling" },
        tiktok: { caption: "Forza Horizon 6 just changed the Steam argument." },
      },
    },
    uniqueness: { verdict: "pass", failures: [] },
    benchmark: { result: "pass", failures: [] },
    ...overrides,
  };
}

test("strong Pulse-original package passes competitor-informed score", () => {
  const report = buildPulseMediaHouseScore(strongStory());
  assert.equal(report.verdict, "GREEN");
  assert.ok(report.scores.overall_media_house_score >= 85);
  assert.ok(report.scores.competitor_parity_score >= 80);
  assert.ok(report.scores.competitor_surpass_score >= 75);
  assert.deepEqual(report.hard_failures, []);
});

test("generic title fails", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: { ...strongStory().canonical, selected_title: "Gaming news update" },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:generic_title"));
});

test("weak hook fails", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      first_spoken_line: "Here is what happened in gaming news today.",
      narration_script: "Here is what happened in gaming news today. Forza Horizon 6 has some context.",
    },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:first_3_seconds_weak"));
});

test("copied competitor style fails", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    competitorSimilarity: { max_similarity_score: 0.92, closest_channel: "IGN", copied_template_risk: true },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:competitor_mimicry_risk"));
});
```

- [ ] **Step 2: Run score tests to verify RED**

Run: `node --test tests/services/pulse-media-house-score.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement score module**

Implement all requested score keys, hard-fail reasons and helper reports:
- `competitor_parity_report`
- `competitor_surpass_report`
- `upgraded_quality_gate_report`
- `updated_control_tower_rules`

- [ ] **Step 4: Run score tests to verify GREEN**

Run: `node --test tests/services/pulse-media-house-score.test.js`

Expected: PASS.

### Task 4: Production Gate Integration Tests

**Files:**
- Modify: `lib/goal19-autonomy-control-tower.js`
- Modify: `tests/services/goal19-autonomy-control-tower.test.js`

- [ ] **Step 1: Add failing tests**

Add a fixture `pulse_media_house_score.json` to `makeControlStory`. Add a new test that deletes or weakens that file and expects:
- `control:pulse_media_house_score_not_pass`
- final verdict `RED`
- `REQUIRED_CONTROL_INPUTS` includes `pulse_media_house_score`

- [ ] **Step 2: Run Goal 19 test to verify RED**

Run: `node --test tests/services/goal19-autonomy-control-tower.test.js`

Expected: FAIL until Goal 19 reads the new artefact.

- [ ] **Step 3: Implement Goal 19 integration**

Add `pulse_media_house_score` to required inputs. Read `pulse_media_house_score.json`, validate score thresholds and hard failures, and include blockers in direct control blockers.

- [ ] **Step 4: Run Goal 19 test to verify GREEN**

Run: `node --test tests/services/goal19-autonomy-control-tower.test.js`

Expected: PASS.

### Task 5: Quality Gate CLI Tests

**Files:**
- Create: `lib/competitor-informed-quality-gate.js`
- Create: `tools/competitor-informed-quality-gate.js`
- Create: `tests/services/competitor-informed-quality-gate.test.js`
- Create: `tests/services/competitor-informed-quality-gate-cli.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Test that a weak competitor-parity package fails, a strong Pulse-original package passes, poor SFX fails, a story-relevant commercial route passes and all requested integration artefact names are written.

- [ ] **Step 2: Run tests to verify RED**

Run:
`node --test tests/services/competitor-informed-quality-gate.test.js`
`node --test tests/services/competitor-informed-quality-gate-cli.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement service and CLI**

Build story package inspection from existing artefacts and write:
- `pulse_media_house_score.json`
- `competitor_parity_report.json`
- `competitor_surpass_report.json`
- `upgraded_quality_gate_report.json`
- `updated_control_tower_rules.json`
- `integration_test_report.json`

Add script:

```json
"ops:competitor-informed-quality-gate": "node tools/competitor-informed-quality-gate.js"
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:
`node --test tests/services/competitor-informed-quality-gate.test.js`
`node --test tests/services/competitor-informed-quality-gate-cli.test.js`

Expected: PASS.

### Task 6: Bakeoff Tests

**Files:**
- Create: `lib/competitor-upgrade-bakeoff.js`
- Create: `tools/competitor-upgrade-bakeoff.js`
- Create: `tests/services/competitor-upgrade-bakeoff.test.js`
- Create: `tests/services/competitor-upgrade-bakeoff-cli.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing bakeoff tests**

Test that 30 candidates are compared, at least 10 upgraded candidates beat baseline, rejected variants include baseline losers, GREEN candidates carry source/rights/AI disclosure/caption/platform-pack evidence and every required bakeoff artefact is written.

- [ ] **Step 2: Run tests to verify RED**

Run:
`node --test tests/services/competitor-upgrade-bakeoff.test.js`
`node --test tests/services/competitor-upgrade-bakeoff-cli.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement bakeoff service and CLI**

Generate deterministic local-proof baseline and upgraded variants. Do not render, publish, mutate DB, tokens or platform state. Write:
- `competitor_upgrade_bakeoff_report.json`
- `before_after_quality_delta.json`
- `upgraded_green_candidates.json`
- `rejected_variants.json`
- `human_review_upgrade_pack.md`
- `next_render_queue.json`

Add script:

```json
"ops:competitor-upgrade-bakeoff": "node tools/competitor-upgrade-bakeoff.js"
```

- [ ] **Step 4: Run bakeoff tests to verify GREEN**

Run:
`node --test tests/services/competitor-upgrade-bakeoff.test.js`
`node --test tests/services/competitor-upgrade-bakeoff-cli.test.js`

Expected: PASS.

### Task 7: Proof Artefacts

**Files:**
- Output only under `output/competitor-forensics-lab/`, `output/competitor-quality-gate/`, `output/competitor-upgrade-bakeoff/`

- [ ] **Step 1: Run read-only competitor lab**

Run: `npm run ops:competitor-forensics-lab -- --out-dir output/competitor-forensics-lab`

Expected: PASS or PARTIAL with at least 20 channels and 100 videos if public RSS data is available; safety flags all true.

- [ ] **Step 2: Run integration quality gate**

Run: `npm run ops:competitor-informed-quality-gate -- --rulebook output/competitor-forensics-lab/pulse_upgrade_rulebook.json --out-dir output/competitor-quality-gate`

Expected: local-proof reports written; no publish actions.

- [ ] **Step 3: Run bakeoff**

Run: `npm run ops:competitor-upgrade-bakeoff -- --rulebook output/competitor-forensics-lab/pulse_upgrade_rulebook.json --out-dir output/competitor-upgrade-bakeoff`

Expected: 30 candidates assessed, at least 10 upgraded candidates beat baseline, no copied assets.

- [ ] **Step 4: Run focused verification**

Run:
`node --test tests/services/competitor-forensics-lab.test.js tests/services/competitor-forensics-lab-cli.test.js tests/services/pulse-media-house-score.test.js tests/services/competitor-informed-quality-gate.test.js tests/services/competitor-informed-quality-gate-cli.test.js tests/services/competitor-upgrade-bakeoff.test.js tests/services/competitor-upgrade-bakeoff-cli.test.js tests/services/goal19-autonomy-control-tower.test.js`

Expected: PASS.

- [ ] **Step 5: Final proof summary**

Report PASS/PARTIAL/FAIL, files generated, commands run, safety status and the next guarded dispatch or repair command.
