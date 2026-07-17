"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  buildRunwaySourceDocuments,
  phaseTimestampForJob,
  writeRunwaySourceEvidence,
} = require("../../lib/ops/publish-runway-job-runtime");

const AT = "2026-07-17T06:00:00.000Z";
const WINDOW_ID = "publish-20260717T090000Z";
const GENERATION_ID = "runway-20260717-0900";

function candidate(index, status = "pass") {
  return {
    id: `story-${index}`,
    title: `Story ${index}`,
    status: status === "pass" ? "auto" : "review",
    preflight_qa: {
      status,
      blockers: status === "pass" ? [] : ["render_not_green"],
    },
  };
}

function action(index, platform = "youtube_shorts") {
  return {
    action_id: `story-${index}:${platform}`,
    story_id: `story-${index}`,
    platform,
    action: "would_publish",
    autonomous_green_lit_by_dry_run: true,
    video_path: `output/story-${index}/${platform}.mp4`,
    captions_path: `output/story-${index}/${platform}.srt`,
    first_frame_source: `output/story-${index}/${platform}.mp4`,
    canonical_manifest_path: `output/story-${index}/canonical.json`,
    platform_publish_manifest_path: `output/story-${index}/publish.json`,
  };
}

function rawEvidence({ candidateCount = 10, dryRunVerdict = "GREEN" } = {}) {
  const candidates = Array.from(
    { length: candidateCount },
    (_, index) => candidate(index + 1),
  );
  const actions = candidates.flatMap((_, index) => [
    action(index + 1),
    action(index + 1, "instagram_reels"),
    action(index + 1, "facebook_reels"),
  ]);
  return {
    candidateReport: {
      generated_at: AT,
      totals: { candidates: candidateCount },
      candidates,
      preflight_qa: {
        enabled: true,
        pass: candidateCount,
        blocked: 0,
      },
    },
    dryRunPlan: {
      generated_at: AT,
      overall_verdict: dryRunVerdict,
      ready_for_unattended_publish: dryRunVerdict === "GREEN",
      actions,
      blocked_actions: [],
    },
    guardedPlan: {
      generated_at: AT,
      ready_for_guarded_dispatch: true,
      dispatch_ready_actions: actions,
      blocked_actions: [],
    },
    executorPlan: {
      generated_at: AT,
      ready_for_live_executor_handoff: true,
      handoff_ready_actions: actions,
      blocked_selected_actions: [],
    },
  };
}

test("phase timestamp is derived from the immutable publish hour, not delayed worker time", () => {
  assert.equal(
    phaseTimestampForJob({
      created_at: "2026-07-17 06:04:58",
      payload: {
        phase: "T-180",
        publish_hour_utc: 9,
      },
    }, {
      now: new Date("2026-07-17T06:27:00.000Z"),
    }),
    AT,
  );
});

test("source evidence binds five immediate and five reserve strict-GREEN stories", () => {
  const documents = buildRunwaySourceDocuments({
    ...rawEvidence(),
    generationId: GENERATION_ID,
    windowId: WINDOW_ID,
  });

  assert.equal(documents.candidate.verdict, "GREEN");
  assert.equal(documents.candidate.candidates.length, 10);
  assert.deepEqual(
    documents.candidate.reserve_stories.map((row) => row.story_id),
    ["story-6", "story-7", "story-8", "story-9", "story-10"],
  );
  assert.deepEqual(
    documents.preflight.executable_actions.map((row) => row.action_id),
    [
      "story-1:youtube_shorts",
      "story-2:youtube_shorts",
      "story-3:youtube_shorts",
      "story-4:youtube_shorts",
      "story-5:youtube_shorts",
    ],
  );
  for (const document of Object.values(documents)) {
    assert.equal(document.generation_id, `source-${GENERATION_ID}`);
    assert.equal(document.window_id, WINDOW_ID);
    assert.equal(document.generated_at, AT);
  }
});

test("source evidence remains RED when the strict buffer or upstream dry-run is non-GREEN", () => {
  const documents = buildRunwaySourceDocuments({
    ...rawEvidence({ candidateCount: 9, dryRunVerdict: "AMBER" }),
    generationId: GENERATION_ID,
    windowId: WINDOW_ID,
  });

  assert.equal(documents.candidate.verdict, "RED");
  assert.ok(documents.candidate.blockers.includes("strict_green_candidate_buffer_below_10:9/10"));
  assert.equal(documents.preflight.verdict, "RED");
  assert.equal(documents.dry_run.verdict, "AMBER");
  assert.equal(documents.guarded.verdict, "GREEN");
  assert.equal(documents.executor.verdict, "GREEN");
});

test("source evidence is materialised as five concrete JSON files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-runway-source-"));
  t.after(() => fs.remove(root));
  const documents = buildRunwaySourceDocuments({
    ...rawEvidence(),
    generationId: GENERATION_ID,
    windowId: WINDOW_ID,
  });

  const paths = await writeRunwaySourceEvidence({
    outputDir: root,
    documents,
  });

  assert.deepEqual(Object.keys(paths).sort(), [
    "candidate",
    "dry_run",
    "executor",
    "guarded",
    "preflight",
  ]);
  for (const filePath of Object.values(paths)) {
    assert.equal(await fs.pathExists(filePath), true);
  }
});
