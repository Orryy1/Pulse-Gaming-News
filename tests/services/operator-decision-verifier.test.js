"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  canonicalSha256,
  publicKeyFingerprint,
  signingPayload,
  verifyOperatorDecision,
  verifyOperatorDecisionFromControlRoot,
} = require("../../lib/services/operator-decision-verifier");

const NOW = new Date("2026-08-15T08:00:00.000Z");
const BINDINGS = Object.freeze({
  runtime_commit: "a".repeat(40),
  configuration_sha256: "b".repeat(64),
  checkout_root_realpath: "D:\\pulse-runtime\\approved",
  data_root_realpath: "D:\\pulse-data",
});

function createFixture(overrides = {}) {
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
    ...overrides.trustRecord,
  };
  const trustRecordSha256 = overrides.trustRecordSha256
    || canonicalSha256(trustRecord);
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
    bindings: BINDINGS,
    signature_algorithm: "Ed25519",
    signature_base64: "",
    ...overrides.decision,
  };
  decision.signature_base64 = crypto
    .sign(null, signingPayload(decision), privateKey)
    .toString("base64");
  const currentPointer = {
    schema_version: "pulse-operator-trust-pointer-v1",
    current_key_id: trustRecord.key_id,
    current_trust_record_sha256: trustRecordSha256,
    updated_at: "2026-08-15T07:00:00.000Z",
    ...overrides.currentPointer,
  };
  return {
    publicKey,
    privateKey,
    trustRecord,
    trustRecordSha256,
    decision,
    currentPointer,
  };
}

function verify(fixture, overrides = {}) {
  return verifyOperatorDecision({
    decision: fixture.decision,
    trustRecord: fixture.trustRecord,
    trustRecordSha256: fixture.trustRecordSha256,
    currentPointer: fixture.currentPointer,
    requireCurrent: true,
    expectedType: "APPROVE_RUNTIME_SELECTION",
    expectedBindings: BINDINGS,
    now: NOW,
    ...overrides,
  });
}

test("a current Ed25519 operator decision verifies exact bindings", () => {
  const fixture = createFixture();
  const result = verify(fixture);
  assert.equal(result.verified, true);
  assert.equal(result.decision_id, fixture.decision.decision_id);
  assert.equal(result.key_id, fixture.trustRecord.key_id);
  assert.equal(result.bindings_sha256, canonicalSha256(BINDINGS));
});

test("a forged signature fails closed", () => {
  const fixture = createFixture();
  fixture.decision.nonce = crypto.randomBytes(32).toString("base64url");
  assert.throws(() => verify(fixture), /operator_decision_signature_invalid/);
});

test("wrong type and incomplete bindings fail before signature authority", () => {
  const wrongType = createFixture({
    decision: { decision_type: "CLEAR_KILL_SWITCH" },
  });
  assert.throws(() => verify(wrongType), /operator_decision_type_mismatch/);
  const fixture = createFixture();
  assert.throws(
    () => verify(fixture, { expectedBindings: { ...BINDINGS, extra: "x" } }),
    /operator_decision_bindings_mismatch/,
  );
});

test("expired and excessively long decisions fail closed", () => {
  const expired = createFixture({
    decision: {
      issued_at: "2026-08-15T06:00:00.000Z",
      expires_at: "2026-08-15T07:00:00.000Z",
    },
  });
  assert.throws(() => verify(expired), /operator_decision_expired/);
  const excessive = createFixture({
    decision: {
      issued_at: "2026-08-15T07:55:00.000Z",
      expires_at: "2026-08-17T07:55:00.000Z",
    },
  });
  assert.throws(() => verify(excessive), /operator_decision_lifetime_excessive/);
});

test("a rotated current pointer rejects a new decision from the old key", () => {
  const fixture = createFixture({
    currentPointer: {
      current_key_id: "rotated-key",
      current_trust_record_sha256: "c".repeat(64),
    },
  });
  assert.throws(() => verify(fixture), /operator_decision_not_current_key/);
});

test("trust record hash and fingerprint mismatches fail closed", () => {
  const hashMismatch = createFixture();
  hashMismatch.decision.trust_record_sha256 = "d".repeat(64);
  assert.throws(() => verify(hashMismatch), /operator_decision_trust_record_mismatch/);
  const fingerprintMismatch = createFixture();
  fingerprintMismatch.trustRecord.public_key_fingerprint_sha256 = "e".repeat(64);
  assert.throws(() => verify(fingerprintMismatch), /operator_decision_key_fingerprint_mismatch/);
});

test("historical trust is loaded by exact file hash from the control root", () => {
  const fixture = createFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-operator-trust-"));
  try {
    const history = path.join(root, "operator-trust", "history");
    fs.mkdirSync(history, { recursive: true });
    const historyPath = path.join(history, `${fixture.trustRecord.key_id}.json`);
    const historyBytes = Buffer.from(`${JSON.stringify(fixture.trustRecord, null, 2)}\n`);
    fs.writeFileSync(historyPath, historyBytes);
    const fileSha = crypto.createHash("sha256").update(historyBytes).digest("hex");
    fixture.decision.trust_record_sha256 = fileSha;
    fixture.decision.signature_base64 = crypto
      .sign(null, signingPayload(fixture.decision), fixture.privateKey)
      .toString("base64");
    fs.writeFileSync(
      path.join(root, "operator-trust", "current.json"),
      `${JSON.stringify({
        ...fixture.currentPointer,
        current_trust_record_sha256: fileSha,
      }, null, 2)}\n`,
    );
    const result = verifyOperatorDecisionFromControlRoot({
      decision: fixture.decision,
      controlRoot: root,
      expectedType: "APPROVE_RUNTIME_SELECTION",
      expectedBindings: BINDINGS,
      now: NOW,
    });
    assert.equal(result.trust_record_sha256, fileSha);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an active decision cannot outlive or survive revocation of its trust record", () => {
  const outlives = createFixture({
    trustRecord: { valid_until: "2026-08-15T08:30:00.000Z" },
    decision: { expires_at: "2026-08-15T09:00:00.000Z" },
  });
  assert.throws(() => verify(outlives), /operator_decision_outlives_trust_record/);
  const revoked = createFixture({
    trustRecord: { revoked_at: "2026-08-15T07:58:00.000Z" },
    decision: {
      issued_at: "2026-08-15T07:55:00.000Z",
      expires_at: "2026-08-15T08:30:00.000Z",
    },
  });
  assert.throws(() => verify(revoked), /operator_decision_key_revoked/);
});
