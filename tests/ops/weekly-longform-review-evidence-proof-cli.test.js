"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  run,
} = require("../../tools/weekly-longform-review-evidence-proof");

test("synthetic weekly inputs remain on HOLD without independent renderer QA and measured originality evidence", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-review-proof-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await run({
    outputDir: root,
    generatedAt: "2026-07-28T16:00:00.000Z",
  });

  assert.equal(result.summary.status, "PASS");
  assert.equal(
    result.summary.governed_review_verdict,
    "HOLD",
  );
  assert.equal(result.summary.expected_hold_proven, true);
  assert.ok(result.summary.structural_blocker_count > 0);
  assert.ok(
    result.summary.structural_blockers.includes(
      "renderer_manifest_path_required",
    ),
  );
  assert.ok(
    result.summary.structural_blockers.includes("qa_path_required"),
  );
  assert.ok(
    result.summary.structural_blockers.includes(
      "originality_transformation_path_required",
    ),
  );
  assert.equal(result.summary.network_used, false);
  assert.equal(result.summary.external_publish_authorised, false);
  assert.equal(result.summary.database_mutated, false);
  assert.equal(result.summary.oauth_mutated, false);
  assert.equal(
    Object.keys(result.summary.review_evidence).length,
    8,
  );
  assert.equal(fs.existsSync(result.paths.summary), true);
  assert.equal(fs.existsSync(result.paths.review_packet), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(result.paths.summary, "utf8")),
    result.summary,
  );
});
