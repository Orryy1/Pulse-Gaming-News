"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildStandingAuthority,
  canonical,
  sha256,
  signAuthority,
  verifyAuthority,
} = require("../../lib/runtime/standing-authority");
const {
  buildPublicationPlan,
  nextPublicSlot,
  reservationDocument,
  selectCandidate,
} = require("../../lib/runtime/youtube-green-publisher");
const {
  acceptanceMetrics,
  completedShadowDays,
  transitionPhase,
} = require("../../tools/runtime-phase-controller");
const {
  evidenceCategory,
  parseSrtEnd,
  reportVerdict,
} = require("../../tools/runtime-green-candidate-observer");

const COMMIT = "a".repeat(40);
const CONFIG = "b".repeat(64);

function authorityFixture() {
  const document = buildStandingAuthority({
    authorityId: "authority-1",
    version: 1,
    runtimeCommit: COMMIT,
    configurationSha256: CONFIG,
    operatorIdentity: "DESKTOP\\MORR",
    issuedAt: "2026-08-15T00:00:00.000Z",
  });
  return { document, document_sha256: sha256(Buffer.from(canonical(document))) };
}

test("standing authority is Ed25519 signed and cannot be widened by local AI", () => {
  const pair = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const document = authorityFixture().document;
  const envelope = {
    schema_version: "pulse-green-autopilot-standing-authority-envelope-v1",
    document,
    document_sha256: sha256(Buffer.from(canonical(document))),
    signature: signAuthority(document, pair.privateKey),
  };
  assert.equal(verifyAuthority(envelope, pair.publicKey, { runtimeCommit: COMMIT, configurationSha256: CONFIG }).valid, true);
  assert.equal(document.local_ai_may_modify_policy, false);
  assert.deepEqual(document.platform_scope, ["youtube"]);
  assert.equal(document.policy.other_platforms_enabled, false);
  assert.throws(() => verifyAuthority({ ...envelope, document: { ...document, platform_scope: ["youtube", "tiktok"] } }, pair.publicKey), /hash_mismatch/);
});

test("phase thresholds require seven days, thirty runs and ten consecutive GREEN candidates", () => {
  const authority = authorityFixture();
  const phase = { phase: "SHADOW", entered_at: "2026-08-08T00:00:00.000Z", shadow_started_at: "2026-08-08T00:00:00.000Z" };
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    story_id: `story-${index}`,
    video_sha256: String(index).padStart(64, "0"),
    envelope_sha256: crypto.createHash("sha256").update(`e-${index}`).digest("hex"),
    verdict: index < 20 ? "AMBER" : "GREEN",
    observed_at: `2026-08-${String(8 + Math.floor(index / 5)).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const shadowObservations = [];
  for (let day = 9; day <= 15; day += 1) {
    if (day === 15) continue;
    for (let hour = 0; hour < 20; hour += 1) {
      shadowObservations.push({
        generated_at: `2026-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:10:00.000Z`,
        verdict: "GREEN_SHADOW",
        safety: { youtube_mutation_count: 0 },
      });
    }
  }
  for (let hour = 0; hour < 20; hour += 1) {
    shadowObservations.push({
      generated_at: `2026-08-15T${String(hour).padStart(2, "0")}:10:00.000Z`,
      verdict: "GREEN_SHADOW",
      safety: { youtube_mutation_count: 0 },
    });
  }
  const metrics = acceptanceMetrics({
    authority,
    phase,
    candidateIndex: { candidates },
    candidateObservations: candidates,
    shadowObservations,
    publisherReceipts: [],
    now: new Date("2026-08-16T12:00:00.000Z"),
  });
  assert.equal(metrics.shadow_acceptance_green, true);
  assert.equal(metrics.distinct_candidate_runs, 30);
  assert.equal(metrics.consecutive_green, 10);
  assert.equal(metrics.shadow_complete_days, 7);
  assert.deepEqual(metrics.shadow_missing_days, []);
  for (const patch of [
    { now: new Date("2026-08-15T12:00:00.000Z") },
    { candidateObservations: candidates.slice(1) },
    { candidateObservations: [...candidates.slice(0, -1), { ...candidates.at(-1), verdict: "RED" }] },
    { shadowObservations: shadowObservations.map((entry, index) => index === 0 ? { ...entry, safety: { youtube_mutation_count: 1 } } : entry) },
    { shadowObservations: shadowObservations.filter((entry) => !entry.generated_at.startsWith("2026-08-12")) },
  ]) {
    const failed = acceptanceMetrics({ authority, phase, candidateIndex: { candidates }, candidateObservations: candidates, shadowObservations, publisherReceipts: [], now: new Date("2026-08-16T12:00:00.000Z"), ...patch });
    assert.equal(failed.shadow_acceptance_green, false);
  }
});

test("phase transitions are hash chained and carry the durable kill-switch version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-phase-"));
  const paths = { phase: path.join(root, "phase.json"), phaseEvents: path.join(root, "events") };
  const authority = authorityFixture();
  const phase = { phase: "SHADOW", phase_version: 1, entered_at: "2026-08-08T00:00:00.000Z", shadow_started_at: "2026-08-08T00:00:00.000Z", sha256: "c".repeat(64) };
  const next = transitionPhase({ paths, phase, nextPhase: "PRIVATE_CANARY", reason: "TEST_GREEN", authorityEnvelope: authority, externalMutationsEnabled: true, killSwitchVersion: 2 });
  assert.equal(next.phase, "PRIVATE_CANARY");
  assert.equal(next.external_mutations_enabled, true);
  assert.equal(next.kill_switch_version, 2);
  assert.equal(next.prior_event_sha256, phase.sha256);
  assert.equal(JSON.parse(fs.readFileSync(paths.phase, "utf8")).sha256, next.sha256);
  fs.rmSync(root, { recursive: true, force: true });
});

test("candidate evidence helpers are strict about RED reports and caption coverage clocks", () => {
  assert.equal(reportVerdict({ status: "PASS", blockers: [] }), "GREEN");
  assert.equal(reportVerdict({ status: "PASS", blockers: ["missing-rights"] }), "RED");
  assert.equal(reportVerdict({}), "UNKNOWN");
  assert.equal(evidenceCategory("rights-attribution-report.json"), "rights");
  assert.equal(evidenceCategory("claim-source-report.json"), "claims");
  assert.equal(evidenceCategory("creative-viewer.json"), "creative");
  assert.equal(evidenceCategory("final-technical-qa.json"), "technical");
  assert.equal(parseSrtEnd("1\n00:00:00,000 --> 00:00:58,600\nDone\n"), 58.6);
});

test("public slot selection is UTC, capped and deterministic", () => {
  const slot = nextPublicSlot({
    now: new Date("2026-08-15T18:00:00.000Z"),
    windowsUtc: ["19:00"],
    receipts: [],
    maxPerUtcDay: 1,
  });
  assert.equal(slot.publish_at, "2026-08-15T19:00:00.000Z");
  const next = nextPublicSlot({
    now: new Date("2026-08-15T18:00:00.000Z"),
    windowsUtc: ["19:00"],
    receipts: [{ action: "PUBLIC_SCHEDULE", publish_at: "2026-08-15T19:00:00.000Z" }],
    maxPerUtcDay: 1,
  });
  assert.equal(next.publish_at, "2026-08-16T19:00:00.000Z");
});

test("SHADOW never creates a publication plan and private/public phases stay distinct", () => {
  const authority = authorityFixture();
  const candidate = { story_id: "story-1" };
  assert.equal(buildPublicationPlan({ phase: { phase: "SHADOW", external_mutations_enabled: false, authority_sha256: authority.document_sha256 }, authority, candidate, receipts: [] }).action, "HOLD");
  assert.equal(buildPublicationPlan({ phase: { phase: "PRIVATE_CANARY", external_mutations_enabled: true, authority_sha256: authority.document_sha256 }, authority, candidate, receipts: [] }).action, "PRIVATE_CANARY_UPLOAD");
  assert.equal(buildPublicationPlan({ phase: { phase: "PUBLIC_RAMP_ONE_DAILY", external_mutations_enabled: true, authority_sha256: authority.document_sha256 }, authority, candidate, receipts: [], now: new Date("2026-08-15T18:00:00Z") }).action, "PUBLIC_SCHEDULE");
});

test("publication reservation binds phase, authority, media and captions", () => {
  const authority = authorityFixture();
  const phase = { phase: "PRIVATE_CANARY", phase_version: 2 };
  const verifiedCandidate = { envelope: { envelope_sha256: "d".repeat(64), video: { sha256: "e".repeat(64) }, captions: { sha256: "f".repeat(64) } } };
  const reservation = reservationDocument({ plan: { action: "PRIVATE_CANARY_UPLOAD" }, authority, phase, verifiedCandidate, now: new Date("2026-08-15T12:00:00Z") });
  assert.match(reservation.sha256, /^[a-f0-9]{64}$/);
  assert.equal(reservation.video_sha256, "e".repeat(64));
  assert.equal(reservation.captions_sha256, "f".repeat(64));
  assert.equal(reservation.phase, "PRIVATE_CANARY");
});

test("isolated publisher source never imports Discord credentials or legacy uploader", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "..", "tools", "runtime-youtube-publisher.js"), "utf8");
  assert.doesNotMatch(source, /runtime-discord-ops|upload_youtube/);
  assert.match(source, /PULSE_PUBLISHER_ISOLATED/);
  assert.match(source, /retry:\s*false/);
  assert.match(source, /reconciliation_required/);
});


test("continuous SHADOW days require twenty distinct hourly observations and no RED", () => {
  const observations = [];
  for (let hour = 0; hour < 20; hour += 1) {
    observations.push({
      generated_at: `2026-08-09T${String(hour).padStart(2, "0")}:05:00.000Z`,
      verdict: "GREEN_SHADOW",
      safety: { youtube_mutation_count: 0 },
    });
  }
  const green = completedShadowDays({
    observations,
    shadowStartedAt: "2026-08-08T12:00:00.000Z",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });
  assert.equal(green.completeDays, 1);
  assert.deepEqual(green.missingDays, []);
  const sparse = completedShadowDays({
    observations: observations.slice(1),
    shadowStartedAt: "2026-08-08T12:00:00.000Z",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });
  assert.equal(sparse.completeDays, 0);
  assert.deepEqual(sparse.missingDays, ["2026-08-09"]);
  const red = completedShadowDays({
    observations: [...observations, { generated_at: "2026-08-09T23:00:00.000Z", verdict: "RED", safety: { youtube_mutation_count: 0 } }],
    shadowStartedAt: "2026-08-08T12:00:00.000Z",
    now: new Date("2026-08-10T12:00:00.000Z"),
  });
  assert.equal(red.completeDays, 0);
});
