"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const {
  resolveApprovedRuntimeSelection,
} = require("../../lib/ops/approved-runtime-selection");
const {
  canonicalSha256,
  publicKeyFingerprint,
  signingPayload,
} = require("../../lib/services/operator-decision-verifier");

const NOW = new Date("2026-08-15T08:00:00.000Z");
const COMMIT = "a".repeat(40);
const CONFIG = "b".repeat(64);

function fakeFs({ reparse = [] } = {}) {
  const existing = new Set(["c:\\", "c:\\repo", "d:\\", "d:\\pulse-data"]);
  const links = new Set(reparse.map((value) => value.toLowerCase()));
  return {
    exists: (value) => existing.has(String(value).toLowerCase()),
    realpath: (value) => String(value),
    lstat: (value) => ({
      isSymbolicLink: () => links.has(String(value).toLowerCase()),
    }),
    isReparsePoint: (value) => links.has(String(value).toLowerCase()),
  };
}

function authority(bindings) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  const trustRecord = {
    schema_version: "pulse-operator-trust-record-v1",
    key_id: "martin-primary-2026",
    public_key_pem: publicKeyPem,
    public_key_fingerprint_sha256: fingerprint,
    valid_from: "2026-08-01T00:00:00.000Z",
    valid_until: "2027-08-01T00:00:00.000Z",
    revoked_at: null,
  };
  const trustRecordSha256 = canonicalSha256(trustRecord);
  const decision = {
    schema_version: "pulse-operator-decision-v1",
    decision_id: crypto.randomUUID(),
    decision_type: "APPROVE_RUNTIME_SELECTION",
    key_id: trustRecord.key_id,
    key_fingerprint_sha256: fingerprint,
    trust_record_sha256: trustRecordSha256,
    nonce: crypto.randomBytes(32).toString("base64url"),
    issued_at: "2026-08-15T07:55:00.000Z",
    expires_at: "2026-08-15T09:00:00.000Z",
    bindings,
    signature_algorithm: "Ed25519",
    signature_base64: "",
  };
  decision.signature_base64 = crypto
    .sign(null, signingPayload(decision), privateKey)
    .toString("base64");
  const currentPointer = {
    schema_version: "pulse-operator-trust-pointer-v1",
    current_key_id: trustRecord.key_id,
    current_trust_record_sha256: trustRecordSha256,
    updated_at: "2026-08-15T07:00:00.000Z",
  };
  return { decision, trustRecord, trustRecordSha256, currentPointer };
}

function validInput(overrides = {}) {
  const bindings = {
    runtime_commit: COMMIT,
    configuration_sha256: CONFIG,
    checkout_root_realpath: "C:\\repo",
    data_root_realpath: "D:\\pulse-data",
  };
  return {
    env: { PULSE_DATA_ROOT: "D:\\pulse-data" },
    checkoutRoot: "C:\\repo",
    fsApi: fakeFs(),
    gitState: {
      head: COMMIT,
      branch: null,
      detached: true,
      status: "",
    },
    configurationSha256: CONFIG,
    ...authority(bindings),
    now: NOW,
    ...overrides,
  };
}

test("a clean detached exact commit can be approved", () => {
  const result = resolveApprovedRuntimeSelection(validInput());
  assert.equal(result.approved, true);
  assert.equal(result.runtime.commit, COMMIT);
  assert.equal(result.runtime.detached, true);
  assert.equal(result.paths.dataRoot, "D:\\pulse-data");
  assert.equal(result.operator_decision.verified, true);
});

test("untracked or modified files block runtime selection", () => {
  assert.throws(
    () => resolveApprovedRuntimeSelection(validInput({
      gitState: {
        head: COMMIT,
        branch: null,
        detached: true,
        status: "?? unexpected.tmp",
      },
    })),
    /runtime_git_worktree_not_clean/,
  );
});

test("operator trust must be provisioned", () => {
  const input = validInput();
  delete input.decision;
  assert.throws(
    () => resolveApprovedRuntimeSelection(input),
    /operator_trust_not_provisioned/,
  );
});

test("configuration and data-root drift invalidate the signed selection", () => {
  assert.throws(
    () => resolveApprovedRuntimeSelection(validInput({
      configurationSha256: "c".repeat(64),
    })),
    /operator_decision_bindings_mismatch/,
  );
  assert.throws(
    () => resolveApprovedRuntimeSelection(validInput({
      env: { PULSE_DATA_ROOT: "D:\\other-data" },
      fsApi: fakeFs(),
    })),
    /production_data_root_missing|operator_decision_bindings_mismatch/,
  );
});

test("a reparse-backed data root cannot be approved even with a valid signature", () => {
  assert.throws(
    () => resolveApprovedRuntimeSelection(validInput({
      fsApi: fakeFs({ reparse: ["D:\\pulse-data"] }),
    })),
    /production_data_root_reparse_point/,
  );
});

test("a mutable branch name is not required once the commit is exact", () => {
  const result = resolveApprovedRuntimeSelection(validInput({
    gitState: {
      head: COMMIT,
      branch: "temporary-name",
      detached: false,
      status: "",
    },
  }));
  assert.equal(result.runtime.branch, "temporary-name");
  assert.equal(result.runtime.commit, COMMIT);
});
