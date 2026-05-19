"use strict";

function storyIsBatchUploadCandidate(story = {}, platformIdField) {
  if (!story || typeof story !== "object") return false;
  if (!story.approved || !story.exported_path) return false;
  if (story.qa_failed === true || story.publish_status === "failed") return false;
  if (platformIdField && story[platformIdField]) return false;
  return true;
}

async function assertBatchUploadPreflight(
  story,
  { platform = "unknown", env = process.env } = {},
) {
  const { runContentQa } = require("./content-qa");
  const qa = await runContentQa(story, { env });
  if (qa.result === "fail") {
    const failures = Array.isArray(qa.failures) ? qa.failures : ["content_qa_failed"];
    const err = new Error(
      `batch_upload_preflight_failed:${platform}:${failures.join(", ")}`,
    );
    err.failures = failures;
    err.warnings = qa.warnings || [];
    throw err;
  }
  const { decideForStory } = require("../render-decision");
  const decision = await decideForStory(story, { env });
  if (!decision.gate || decision.gate.allowed === false) {
    const reason = decision.gate?.reason || "render_contract_blocked";
    const err = new Error(`batch_upload_preflight_failed:${platform}:${reason}`);
    err.failures = [reason];
    err.warnings = qa.warnings || [];
    err.render_contract = decision.verdict;
    throw err;
  }
  return qa;
}

module.exports = {
  assertBatchUploadPreflight,
  storyIsBatchUploadCandidate,
};
