"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  selectStudioV21Candidates,
  buildReviewHoldUpdate,
  runStudioV21ReviewBatch,
} = require("../../lib/studio/v2/studio-v21-review-batch");

function story(id, overrides = {}) {
  return {
    id,
    title: id,
    approved: true,
    exported_path: `output/final/${id}.mp4`,
    audio_path: `output/audio/${id}.mp3`,
    ...overrides,
  };
}

test("selectStudioV21Candidates: chooses approved produced unpublished stories", () => {
  const selected = selectStudioV21Candidates(
    [
      story("ready-a"),
      story("ready-b", { youtube_post_id: "yt", instagram_media_id: "ig" }),
      story("unapproved", { approved: false }),
      story("no-audio", { audio_path: null }),
      story("qa-failed", { qa_failed: true }),
      story("already-approved", {
        render_engine: "studio-v21",
        render_review_status: "approved",
      }),
      story("ready-c"),
    ],
    { limit: 2 },
  );
  assert.deepEqual(
    selected.map((s) => s.id),
    ["ready-a", "ready-b"],
  );
});

test("buildReviewHoldUpdate: stores v2.1 sidecar paths without replacing exported_path", () => {
  const update = buildReviewHoldUpdate(story("candidate"), {
    candidatePath: "test/output/studio_v2_candidate_v21.mp4",
    reportPath: "test/output/candidate_studio_v2_v21_report.json",
    gatePath: "test/output/candidate_studio_v21_gate.json",
    gateVerdict: "pass",
  });
  assert.equal(update.exported_path, "output/final/candidate.mp4");
  assert.equal(update.render_engine, "studio-v21");
  assert.equal(update.studio_v21_candidate_path, "test/output/studio_v2_candidate_v21.mp4");
  assert.equal(update.human_visual_review_required, true);
  assert.equal(update.render_review_status, "pending");
  assert.equal(update.publish_hold_reason, "studio_v21_human_visual_review_required");
});

test("publisher produce path only runs the v2.1 review batch behind the engine switch", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  assert.match(src, /isStudioV21BatchEnabled\(process\.env\)/);
  assert.match(src, /runStudioV21ReviewBatch\(\{/);
});

test("runStudioV21ReviewBatch: renders all candidates, gauntlet once, then gates", async () => {
  const calls = [];
  const updates = [];
  const db = {
    async getStories() {
      return [story("a"), story("b")];
    },
    async upsertStory(update) {
      updates.push(update);
    },
  };

  const result = await runStudioV21ReviewBatch({
    db,
    env: { RENDER_ENGINE: "studio-v21" },
    limit: 2,
    renderOne(storyId) {
      calls.push(`render:${storyId}`);
      return { status: 0 };
    },
    runGauntlet() {
      calls.push("gauntlet");
      return { status: 0 };
    },
    gateOne(storyId) {
      calls.push(`gate:${storyId}`);
      return { status: 0 };
    },
  });

  assert.deepEqual(calls, ["render:a", "render:b", "gauntlet", "gate:a", "gate:b"]);
  assert.deepEqual(result.candidates, ["a", "b"]);
  assert.equal(updates.length, 2);
  assert.ok(updates.every((u) => u.human_visual_review_required === true));
});

test("v2.1 review batch keeps voice fallback disabled unless explicitly opted in", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "studio", "v2", "studio-v21-review-batch.js"),
    "utf8",
  );
  assert.match(src, /STUDIO_V2_ALLOW_VOICE_FALLBACK:\s*\n\s*env\.STUDIO_V2_ALLOW_VOICE_FALLBACK \|\| "false"/);
});

test("studio-v21 wrapper keeps voice fallback disabled by default", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v21-render.js"),
    "utf8",
  );
  assert.match(src, /STUDIO_V2_ALLOW_VOICE_FALLBACK:\s*\n\s*process\.env\.STUDIO_V2_ALLOW_VOICE_FALLBACK \|\| "false"/);
});
