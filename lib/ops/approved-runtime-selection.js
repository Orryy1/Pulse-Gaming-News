"use strict";

const {
  resolveProductionPaths,
} = require("../runtime/production-paths");
const {
  verifyOperatorDecision,
  verifyOperatorDecisionFromControlRoot,
} = require("../services/operator-decision-verifier");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertGitState(gitState) {
  if (!gitState || !/^[a-f0-9]{40}$/i.test(String(gitState.head || ""))) {
    fail("runtime_git_commit_invalid");
  }
  if (String(gitState.status || "").trim()) {
    fail("runtime_git_worktree_not_clean");
  }
}

function resolveApprovedRuntimeSelection({
  env = process.env,
  checkoutRoot,
  fsApi,
  gitState,
  configurationSha256,
  decision,
  trustRecord = null,
  trustRecordSha256 = null,
  currentPointer = null,
  controlRoot = null,
  now = new Date(),
}) {
  assertGitState(gitState);
  if (!/^[a-f0-9]{64}$/.test(String(configurationSha256 || ""))) {
    fail("runtime_configuration_sha256_invalid");
  }
  const paths = resolveProductionPaths({ env, checkoutRoot, fsApi });
  const expectedBindings = Object.freeze({
    runtime_commit: String(gitState.head).toLowerCase(),
    configuration_sha256: String(configurationSha256).toLowerCase(),
    checkout_root_realpath: paths.checkoutRoot,
    data_root_realpath: paths.dataRoot,
  });
  if (!decision) fail("operator_trust_not_provisioned");

  const verification = trustRecord
    ? verifyOperatorDecision({
        decision,
        trustRecord,
        trustRecordSha256,
        currentPointer,
        requireCurrent: true,
        expectedType: "APPROVE_RUNTIME_SELECTION",
        expectedBindings,
        now,
      })
    : verifyOperatorDecisionFromControlRoot({
        decision,
        controlRoot: controlRoot || paths.control,
        fsApi,
        expectedType: "APPROVE_RUNTIME_SELECTION",
        expectedBindings,
        now,
        requireCurrent: true,
      });

  return Object.freeze({
    approved: true,
    runtime: Object.freeze({
      commit: expectedBindings.runtime_commit,
      configuration_sha256: expectedBindings.configuration_sha256,
      checkout_root_realpath: paths.checkoutRoot,
      detached: gitState.detached === true,
      branch: gitState.branch || null,
    }),
    paths,
    operator_decision: verification,
  });
}

module.exports = { resolveApprovedRuntimeSelection };
