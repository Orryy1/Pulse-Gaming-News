"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  formatBridgeCandidatePromotionMarkdown,
  parseArgs,
  runCli,
} = require("../../tools/bridge-candidate-promotion");

test("bridge candidate promotion CLI parses guarded apply controls", () => {
  const args = parseArgs([
    "node",
    "tool",
    "--candidate-report",
    "candidate.json",
    "--bridge-candidates",
    "bridge.json",
    "--story-id",
    "story-1",
    "--limit",
    "4",
    "--apply",
    "--operator-confirmed",
    "--json",
  ]);

  assert.equal(args.candidateReportPath, "candidate.json");
  assert.equal(args.bridgeCandidatesPath, "bridge.json");
  assert.equal(args.storyId, "story-1");
  assert.equal(args.limit, 4);
  assert.equal(args.apply, true);
  assert.equal(args.operatorConfirmed, true);
  assert.equal(args.json, true);
});

test("bridge candidate promotion markdown states the safety boundary", () => {
  const markdown = formatBridgeCandidatePromotionMarkdown({
    generated_at: "2026-05-22T08:00:00.000Z",
    status: "ready_for_operator_confirmed_apply",
    summary: {
      bridge_candidates_seen: 2,
      eligible_count: 1,
      blocked_count: 1,
    },
    eligible_promotions: [
      {
        story_id: "story-green",
        title: "Forza Finally Has A Date",
        evidence: {
          preflight_status: "pass",
          exported_path: "render.mp4",
          rights_ledger_records: 12,
        },
      },
    ],
    blocked_candidates: [
      {
        story_id: "story-warn",
        reasons: ["preflight_not_pass:warn"],
      },
    ],
  });

  assert.match(markdown, /Bridge Candidate Promotion/);
  assert.match(markdown, /backup before upsert/);
  assert.match(markdown, /no publishing/);
  assert.match(markdown, /story-green/);
  assert.match(markdown, /preflight_not_pass:warn/);
});

test("bridge candidate promotion CLI writes dry-run artefacts without DB mutation", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-promotion-"));
  const bridgePath = path.join(tmp, "bridge.json");
  const reportPath = path.join(tmp, "report.json");
  const outDir = path.join(tmp, "out");
  const renderPath = path.join(tmp, "render.mp4");
  const captionPath = path.join(tmp, "captions.srt");
  await fs.writeFile(renderPath, Buffer.alloc(2048, 1));
  await fs.writeFile(captionPath, "1\n00:00:00,000 --> 00:00:01,000\nForza finally has a date.\n");
  await fs.writeJson(bridgePath, [
    {
      id: "story-green",
      title: "Forza Finally Has A Date",
      suggested_title: "Forza Finally Has A Date",
      canonical_subject: "Forza",
      first_spoken_line: "Forza finally has a date.",
      description: "Forza finally has a date. Source: Xbox Wire.",
      exported_path: renderPath,
      audio_path: "audio.mp3",
      manual_caption_path: captionPath,
      caption_path: captionPath,
      full_script: "Forza finally has a date. Players now know what to watch next.",
      tts_script: "Forza finally has a date. Players now know what to watch next.",
      approved: true,
      auto_approved: true,
      governance_publish_status: "GREEN",
      rights_ledger: [
        { asset_id: "render", source_type: "internally_generated_motion_graphic" },
        { asset_id: "audio", source_type: "local_tts_voice" },
      ],
    },
  ]);
  await fs.writeJson(reportPath, {
    candidates: [
      {
        id: "story-green",
        status: "publish_ready",
        preflight_qa: {
          status: "pass",
          blockers: [],
          warnings: [],
        },
      },
    ],
  });
  const upserts = [];
  const result = await runCli(
    [
      "node",
      "tool",
      "--bridge-candidates",
      bridgePath,
      "--candidate-report",
      reportPath,
      "--output-dir",
      outDir,
      "--json",
    ],
    {
      liveStories: [],
      db: {
        async getStories() {
          return [];
        },
        async upsertStory(story) {
          upserts.push(story);
        },
      },
    },
  );

  assert.equal(result.plan.summary.eligible_count, 1);
  assert.equal(upserts.length, 0);
  assert.equal(await fs.pathExists(path.join(outDir, "bridge_candidate_promotion_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "bridge_candidate_promotion_plan.md")), true);
});

test("ops:bridge-candidate-promotion command is registered", async () => {
  const pkg = await fs.readJson(path.join(__dirname, "..", "..", "package.json"));
  assert.equal(
    pkg.scripts["ops:bridge-candidate-promotion"],
    "node tools/bridge-candidate-promotion.js",
  );
});
