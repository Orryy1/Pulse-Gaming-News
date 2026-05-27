"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const CONTENT_QA = require.resolve("../../lib/services/content-qa");
const RENDER_DECISION = require.resolve("../../lib/render-decision");
const GOVERNANCE = require.resolve("../../lib/services/studio-governance-preflight");

function stubContentQa(result) {
  require.cache[CONTENT_QA] = {
    id: CONTENT_QA,
    filename: CONTENT_QA,
    loaded: true,
    exports: {
      async runContentQa() {
        return result;
      },
    },
  };
}

function stubRenderDecision(decision) {
  require.cache[RENDER_DECISION] = {
    id: RENDER_DECISION,
    filename: RENDER_DECISION,
    loaded: true,
    exports: {
      async decideForStory() {
        return decision;
      },
    },
  };
}

function stubGovernance(result) {
  require.cache[GOVERNANCE] = {
    id: GOVERNANCE,
    filename: GOVERNANCE,
    loaded: true,
    exports: {
      async assertStudioGovernancePreflight() {
        if (result.publish_manifest.publish_status !== "GREEN") {
          const err = new Error(
            `studio_governance_blocked:${result.rejection_reasons.reason_codes.join(",")}`,
          );
          err.report = result;
          err.failures = result.rejection_reasons.reason_codes;
          throw err;
        }
        return result;
      },
    },
  };
}

afterEach(() => {
  for (const mod of [
    CONTENT_QA,
    RENDER_DECISION,
    GOVERNANCE,
    require.resolve("../../lib/services/batch-upload-preflight"),
  ]) {
    delete require.cache[mod];
  }
});

test("batch upload preflight refuses upload when Studio Governance is RED", async () => {
  stubContentQa({ result: "pass", failures: [], warnings: [] });
  stubRenderDecision({ gate: { allowed: true }, verdict: { class: "premium" } });
  stubGovernance({
    publish_manifest: { publish_status: "RED" },
    rejection_reasons: { reason_codes: ["rights:no_rights_record"] },
  });

  const {
    assertBatchUploadPreflight,
  } = require("../../lib/services/batch-upload-preflight");

  await assert.rejects(
    assertBatchUploadPreflight(
      { id: "governance-red", approved: true, exported_path: "x.mp4" },
      { platform: "youtube" },
    ),
    /studio_governance_blocked:rights:no_rights_record/,
  );
});

test("batch upload preflight allows upload only after Studio Governance returns GREEN", async () => {
  stubContentQa({ result: "pass", failures: [], warnings: ["minor"] });
  stubRenderDecision({ gate: { allowed: true }, verdict: { class: "premium" } });
  stubGovernance({
    publish_manifest: { publish_status: "GREEN" },
    rejection_reasons: { reason_codes: [] },
  });

  const {
    assertBatchUploadPreflight,
  } = require("../../lib/services/batch-upload-preflight");

  const result = await assertBatchUploadPreflight(
    { id: "governance-green", approved: true, exported_path: "x.mp4" },
    { platform: "youtube" },
  );
  assert.equal(result.result, "pass");
});

test("live publisher and operator candidate paths are wired to Studio Governance", () => {
  const root = path.join(__dirname, "..", "..");
  const publisher = fs.readFileSync(path.join(root, "publisher.js"), "utf8");
  const batch = fs.readFileSync(
    path.join(root, "lib", "services", "batch-upload-preflight.js"),
    "utf8",
  );
  const candidates = fs.readFileSync(
    path.join(root, "tools", "next-publish-candidates.js"),
    "utf8",
  );

  assert.match(publisher, /assertStudioGovernancePreflight/);
  assert.match(batch, /assertStudioGovernancePreflight/);
  assert.match(candidates, /runStudioGovernancePreflight/);
});
