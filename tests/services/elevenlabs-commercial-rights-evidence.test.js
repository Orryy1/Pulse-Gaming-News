"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  OFFICIAL_POLICY_URLS,
  materializeElevenLabsCommercialRightsEvidence,
} = require("../../lib/elevenlabs-commercial-rights-evidence");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("ElevenLabs rights evidence requires retrievable first-party commercial policy documents", () => {
  assert.deepEqual(OFFICIAL_POLICY_URLS, [
    "https://elevenlabs.io/terms-of-use-eu",
    "https://elevenlabs.io/docs/overview/administration/billing",
  ]);
});

test("ElevenLabs current entitlement snapshot stays AMBER without generation-time lineage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-rights-"));
  const artifactDir = path.join(root, "artifact");
  const audioPath = path.join(artifactDir, "flagship", "final_audio.mp3");
  const audioBytes = Buffer.from("current flagship ElevenLabs narration");
  await fs.outputFile(audioPath, audioBytes);
  const secret = "elevenlabs-secret-must-not-leak";

  const result = await materializeElevenLabsCommercialRightsEvidence({
    artifactDir,
    storyId: "flagship-story",
    assetId: "flagship-story_audio_path",
    audioPath,
    modelId: "eleven_multilingual_v2",
    generatedAt: "2026-07-18T20:00:00.000Z",
    now: () => new Date("2026-07-19T20:00:00.000Z"),
    apiKey: secret,
    targetPlatforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.elevenlabs.io/v1/user/subscription");
      assert.equal(options.headers["xi-api-key"], secret);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tier: "pro",
          status: "active",
          billing_period: "annual_period",
          character_refresh_period: "monthly_period",
          user_id: "private-user-id",
          xi_api_key: secret,
          open_invoices: [{ amount_due_cents: 9999 }],
        }),
      };
    },
  });

  assert.equal(result.verdict, "AMBER");
  assert.equal(
    result.evidence.schema,
    "pulse_elevenlabs_commercial_tts_entitlement_snapshot_v1",
  );
  assert.equal(result.evidence.audio_sha256, sha256(audioBytes));
  assert.equal(result.evidence.audio_size_bytes, audioBytes.length);
  assert.equal(result.evidence.subscription_evidence.tier, "pro");
  assert.equal(result.evidence.subscription_evidence.status, "active");
  assert.equal(result.evidence.subscription_evidence.paid_plan, true);
  assert.equal(result.evidence.subscription_evidence.secrets_recorded, false);
  assert.equal(
    result.evidence.subscription_evidence.retrieved_at,
    "2026-07-19T20:00:00.000Z",
  );
  assert.equal(result.evidence.claimed_audio_generated_at, "2026-07-18T20:00:00.000Z");
  assert.equal(result.evidence.commercial_use_allowed, false);
  assert.deepEqual(result.evidence.blockers, [
    "generation_time_entitlement_binding_missing",
    "provider_request_history_binding_missing",
    "raw_to_mastered_audio_lineage_missing",
  ]);
  const storedText = await fs.readFile(result.evidence_path, "utf8");
  assert.doesNotMatch(storedText, new RegExp(secret));
  assert.doesNotMatch(storedText, /private-user-id|open_invoices|amount_due/i);
  assert.deepEqual(
    JSON.parse(storedText).allowed_platforms,
    ["youtube_shorts", "instagram_reels", "facebook_reels"],
  );
});
