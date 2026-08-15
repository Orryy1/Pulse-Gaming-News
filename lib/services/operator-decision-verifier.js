"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DECISION_KEYS = Object.freeze([
  "schema_version",
  "decision_id",
  "decision_type",
  "key_id",
  "key_fingerprint_sha256",
  "trust_record_sha256",
  "nonce",
  "issued_at",
  "expires_at",
  "bindings",
  "signature_algorithm",
  "signature_base64",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalSha256(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function signingPayload(decision) {
  const payload = {};
  for (const key of DECISION_KEYS) {
    if (key !== "signature_base64") payload[key] = decision?.[key];
  }
  return Buffer.from(canonicalJson(payload), "utf8");
}

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: "spki", format: "der" });
  return sha256Bytes(der);
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
}

function parsedInstant(value, code) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) fail(code);
  return date;
}

function assertTrustRecord(trustRecord) {
  const allowed = [
    "schema_version",
    "key_id",
    "public_key_pem",
    "public_key_fingerprint_sha256",
    "valid_from",
    "valid_until",
    "revoked_at",
  ];
  assertExactKeys(trustRecord, allowed, "operator_trust_record_shape_invalid");
  if (trustRecord.schema_version !== "pulse-operator-trust-record-v1") {
    fail("operator_trust_record_schema_invalid");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(trustRecord.key_id || ""))) {
    fail("operator_trust_key_id_invalid");
  }
  if (!String(trustRecord.public_key_pem || "").includes("PUBLIC KEY")) {
    fail("operator_trust_public_key_invalid");
  }
  if (/PRIVATE KEY/.test(String(trustRecord.public_key_pem))) {
    fail("operator_trust_private_key_forbidden");
  }
  if (!/^[a-f0-9]{64}$/.test(String(trustRecord.public_key_fingerprint_sha256 || ""))) {
    fail("operator_trust_fingerprint_invalid");
  }
  parsedInstant(trustRecord.valid_from, "operator_trust_valid_from_invalid");
  if (trustRecord.valid_until !== null) {
    parsedInstant(trustRecord.valid_until, "operator_trust_valid_until_invalid");
  }
  if (trustRecord.revoked_at !== null) {
    parsedInstant(trustRecord.revoked_at, "operator_trust_revoked_at_invalid");
  }
}

function assertDecision(decision) {
  assertExactKeys(decision, DECISION_KEYS, "operator_decision_shape_invalid");
  if (decision.schema_version !== "pulse-operator-decision-v1") {
    fail("operator_decision_schema_invalid");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(decision.decision_id || ""))) {
    fail("operator_decision_id_invalid");
  }
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(String(decision.decision_type || ""))) {
    fail("operator_decision_type_invalid");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(decision.key_id || ""))) {
    fail("operator_decision_key_id_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(String(decision.key_fingerprint_sha256 || ""))) {
    fail("operator_decision_key_fingerprint_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(String(decision.trust_record_sha256 || ""))) {
    fail("operator_decision_trust_record_sha_invalid");
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(decision.nonce || ""))) {
    fail("operator_decision_nonce_invalid");
  }
  if (!decision.bindings || typeof decision.bindings !== "object" || Array.isArray(decision.bindings)) {
    fail("operator_decision_bindings_invalid");
  }
  if (decision.signature_algorithm !== "Ed25519") {
    fail("operator_decision_signature_algorithm_invalid");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(String(decision.signature_base64 || ""))) {
    fail("operator_decision_signature_encoding_invalid");
  }
  parsedInstant(decision.issued_at, "operator_decision_issued_at_invalid");
  parsedInstant(decision.expires_at, "operator_decision_expires_at_invalid");
}

function assertCurrentPointer(pointer) {
  const keys = [
    "schema_version",
    "current_key_id",
    "current_trust_record_sha256",
    "updated_at",
  ];
  assertExactKeys(pointer, keys, "operator_trust_pointer_shape_invalid");
  if (pointer.schema_version !== "pulse-operator-trust-pointer-v1") {
    fail("operator_trust_pointer_schema_invalid");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(pointer.current_key_id || ""))) {
    fail("operator_trust_pointer_key_id_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(String(pointer.current_trust_record_sha256 || ""))) {
    fail("operator_trust_pointer_sha_invalid");
  }
  parsedInstant(pointer.updated_at, "operator_trust_pointer_time_invalid");
}

function verifyOperatorDecision({
  decision,
  trustRecord,
  trustRecordSha256,
  currentPointer = null,
  requireCurrent = false,
  expectedType,
  expectedBindings,
  now = new Date(),
  maxLifetimeMs = 24 * 60 * 60 * 1000,
}) {
  assertDecision(decision);
  assertTrustRecord(trustRecord);
  if (!expectedType) fail("operator_decision_expected_type_required");
  if (!expectedBindings || typeof expectedBindings !== "object") {
    fail("operator_decision_expected_bindings_required");
  }
  if (decision.decision_type !== expectedType) {
    fail("operator_decision_type_mismatch");
  }
  if (canonicalJson(decision.bindings) !== canonicalJson(expectedBindings)) {
    fail("operator_decision_bindings_mismatch");
  }
  const issuedAt = parsedInstant(decision.issued_at, "operator_decision_issued_at_invalid");
  const expiresAt = parsedInstant(decision.expires_at, "operator_decision_expires_at_invalid");
  const effectiveNow = now instanceof Date ? now : parsedInstant(now, "operator_decision_now_invalid");
  if (issuedAt.getTime() > effectiveNow.getTime() + 30000) {
    fail("operator_decision_issued_in_future");
  }
  if (expiresAt.getTime() <= effectiveNow.getTime()) {
    fail("operator_decision_expired");
  }
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    fail("operator_decision_expiry_invalid");
  }
  if (expiresAt.getTime() - issuedAt.getTime() > maxLifetimeMs) {
    fail("operator_decision_lifetime_excessive");
  }

  if (decision.key_id !== trustRecord.key_id) {
    fail("operator_decision_key_id_mismatch");
  }
  const fingerprint = publicKeyFingerprint(trustRecord.public_key_pem);
  if (
    trustRecord.public_key_fingerprint_sha256 !== fingerprint
    || decision.key_fingerprint_sha256 !== fingerprint
  ) {
    fail("operator_decision_key_fingerprint_mismatch");
  }
  const effectiveTrustSha = trustRecordSha256 || canonicalSha256(trustRecord);
  if (!/^[a-f0-9]{64}$/.test(effectiveTrustSha)) {
    fail("operator_trust_record_sha_invalid");
  }
  if (decision.trust_record_sha256 !== effectiveTrustSha) {
    fail("operator_decision_trust_record_mismatch");
  }
  const trustFrom = parsedInstant(trustRecord.valid_from, "operator_trust_valid_from_invalid");
  const trustUntil = trustRecord.valid_until === null
    ? null
    : parsedInstant(trustRecord.valid_until, "operator_trust_valid_until_invalid");
  if (issuedAt.getTime() < trustFrom.getTime()) {
    fail("operator_decision_before_trust_validity");
  }
  if (trustUntil && issuedAt.getTime() > trustUntil.getTime()) {
    fail("operator_decision_after_trust_validity");
  }
  if (trustUntil && expiresAt.getTime() > trustUntil.getTime()) {
    fail("operator_decision_outlives_trust_record");
  }
  if (trustRecord.revoked_at !== null) {
    const revokedAt = parsedInstant(trustRecord.revoked_at, "operator_trust_revoked_at_invalid");
    if (
      issuedAt.getTime() >= revokedAt.getTime()
      || (requireCurrent && effectiveNow.getTime() >= revokedAt.getTime())
    ) {
      fail("operator_decision_key_revoked");
    }
  }

  if (requireCurrent) {
    if (!currentPointer) fail("operator_trust_current_pointer_required");
    assertCurrentPointer(currentPointer);
    if (
      currentPointer.current_key_id !== decision.key_id
      || currentPointer.current_trust_record_sha256 !== effectiveTrustSha
    ) {
      fail("operator_decision_not_current_key");
    }
  }
  let signature;
  try {
    signature = Buffer.from(decision.signature_base64, "base64");
  } catch {
    fail("operator_decision_signature_encoding_invalid");
  }
  if (signature.length !== 64) {
    fail("operator_decision_signature_length_invalid");
  }
  const verified = crypto.verify(
    null,
    signingPayload(decision),
    crypto.createPublicKey(trustRecord.public_key_pem),
    signature,
  );
  if (!verified) fail("operator_decision_signature_invalid");
  return Object.freeze({
    verified: true,
    decision_id: decision.decision_id,
    decision_type: decision.decision_type,
    key_id: decision.key_id,
    key_fingerprint_sha256: fingerprint,
    trust_record_sha256: effectiveTrustSha,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    bindings_sha256: canonicalSha256(decision.bindings),
  });
}

function assertPlainTrustPath(fsApi, value, code) {
  if (!fsApi.existsSync(value)) fail(code);
  const stat = fsApi.lstatSync(value);
  if (stat.isSymbolicLink()) fail(code);
}

function readTrustMaterial({ controlRoot, keyId, fsApi = fs }) {
  if (!controlRoot) fail("operator_control_root_required");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(keyId || ""))) {
    fail("operator_trust_key_id_invalid");
  }
  const trustRoot = path.join(controlRoot, "operator-trust");
  const historyPath = path.join(trustRoot, "history", `${keyId}.json`);
  const currentPath = path.join(trustRoot, "current.json");
  if (!fsApi.existsSync(historyPath)) fail("operator_trust_not_provisioned");
  assertPlainTrustPath(fsApi, controlRoot, "operator_control_root_reparse_point");
  assertPlainTrustPath(fsApi, trustRoot, "operator_trust_root_reparse_point");
  assertPlainTrustPath(fsApi, path.dirname(historyPath), "operator_trust_history_reparse_point");
  assertPlainTrustPath(fsApi, historyPath, "operator_trust_record_reparse_point");
  const historyBytes = fsApi.readFileSync(historyPath);
  let trustRecord;
  try {
    trustRecord = JSON.parse(historyBytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("operator_trust_record_json_invalid");
  }
  let currentPointer = null;
  if (fsApi.existsSync(currentPath)) {
    assertPlainTrustPath(fsApi, currentPath, "operator_trust_pointer_reparse_point");
    try {
      currentPointer = JSON.parse(
        fsApi.readFileSync(currentPath, "utf8").replace(/^\uFEFF/, ""),
      );
    } catch {
      fail("operator_trust_pointer_json_invalid");
    }
  }
  return {
    trustRecord,
    trustRecordSha256: sha256Bytes(historyBytes),
    currentPointer,
    historyPath,
    currentPath,
  };
}

function verifyOperatorDecisionFromControlRoot(options) {
  const material = readTrustMaterial({
    controlRoot: options.controlRoot,
    keyId: options.decision?.key_id,
    fsApi: options.fsApi || fs,
  });
  return verifyOperatorDecision({
    ...options,
    ...material,
    requireCurrent: options.requireCurrent !== false,
  });
}

module.exports = {
  DECISION_KEYS,
  canonicalJson,
  canonicalSha256,
  publicKeyFingerprint,
  readTrustMaterial,
  signingPayload,
  verifyOperatorDecision,
  verifyOperatorDecisionFromControlRoot,
};
