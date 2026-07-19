"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  captureElevenLabsGenerationRightsReceipt,
  finalizeElevenLabsGenerationRightsLineage,
  materializeElevenLabsGenerationRightsLineage,
} = require("../../lib/elevenlabs-generation-rights-lineage");
const {
  strictElevenLabsGenerationEvidenceBlockers,
} = require("../../lib/candidate-evidence-reconciliation");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clock(...timestamps) {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

test("strict v3 evidence is GREEN only when generation-time entitlement and full lineage are proven", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-v3-"));
  const rawAudio = Buffer.from("raw provider audio");
  const masteredAudio = Buffer.from("mastered narration audio");
  const finalAudio = Buffer.from("final narration audio");
  const timestamps = Buffer.from('[{"word":"Black","start":0,"end":0.3}]');
  const captions = Buffer.from("1\n00:00:00,000 --> 00:00:00,300\nBlack\n");
  const finalVideo = Buffer.from("decoded final video");
  const secret = "never-persist-this-elevenlabs-key";

  const result = await materializeElevenLabsGenerationRightsLineage({
    artifactDir: root,
    storyId: "flagship-black-flag",
    assetId: "flagship-black-flag_audio_path",
    modelId: "eleven_multilingual_v2",
    voiceId: "private-voice-id",
    requestText: "Black Flag has crossed three million sales.",
    requestSettings: { stability: 0.52, api_key: secret },
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    policyUrls: [
      "https://elevenlabs.io/terms-of-use-eu",
      "https://elevenlabs.io/docs/overview/administration/billing",
    ],
    now: clock(
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:00:01.000Z",
      "2026-07-19T20:00:02.000Z",
      "2026-07-19T20:00:03.000Z",
      "2026-07-19T20:00:04.000Z",
      "2026-07-19T20:00:05.000Z",
      "2026-07-19T20:00:06.000Z",
      "2026-07-19T20:00:07.000Z",
    ),
    fetchSubscription: async () => ({
      tier: "pro",
      status: "active",
      billing_period: "annual_period",
      character_refresh_period: "monthly_period",
      retrieved_at: "1900-01-01T00:00:00.000Z",
      user_id: "private-user",
      api_key: secret,
      open_invoices: [{ amount_due: 9999 }],
    }),
    fetchModelSnapshot: async (modelId) => ({
      model_id: modelId,
      name: "Eleven Multilingual v2",
      can_do_text_to_speech: true,
      requires_alpha_access: false,
      requires_beta_access: false,
      owner_id: "private-owner",
    }),
    fetchPolicyDocument: async (url) =>
      Buffer.from(`<html><body>Official policy: ${url}</body></html>`),
    generateAudio: async ({ modelId, requestText }) => {
      assert.equal(modelId, "eleven_multilingual_v2");
      assert.match(requestText, /three million/);
      return {
        requestId: "req-strict-v3",
        rawAudioBytes: rawAudio,
        generatedAt: "1900-01-01T00:00:00.000Z",
      };
    },
    findHistoryItem: async ({ requestId }) => ({
      history_item_id: "history-strict-v3",
      request_id: requestId,
      date_unix: 1784491203,
      model_id: "eleven_multilingual_v2",
      voice_id_sha256: sha256(Buffer.from("private-voice-id", "utf8")),
      text_sha256: sha256(
        Buffer.from("Black Flag has crossed three million sales.", "utf8"),
      ),
    }),
    downloadHistoryAudio: async () => rawAudio,
    finalizeLineage: async ({ rawAudioBytes }) => {
      assert.equal(sha256(rawAudioBytes), sha256(rawAudio));
      return {
        masteredAudioInputBytes: rawAudio,
        masteredAudioOutputBytes: finalAudio,
        finalAudioBytes: finalAudio,
        wordTimestampsBytes: timestamps,
        captionsBytes: captions,
        finalVideoBytes: finalVideo,
      };
    },
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.evidence.schema, "pulse_elevenlabs_commercial_tts_evidence_v3");
  assert.equal(result.evidence.generation.request_id, "req-strict-v3");
  assert.equal(result.evidence.generation.history_item_id, "history-strict-v3");
  assert.equal(result.evidence.generation.history_date_unix, 1784491203);
  assert.equal(result.evidence.generation.raw_provider_audio_sha256, sha256(rawAudio));
  assert.equal(result.evidence.generation.history_audio_sha256, sha256(rawAudio));
  assert.equal(
    result.evidence.lineage.spoken_script_sha256,
    sha256(Buffer.from("Black Flag has crossed three million sales.", "utf8")),
  );
  assert.equal(result.evidence.lineage.final_audio_sha256, sha256(finalAudio));
  assert.equal(result.evidence.lineage.word_timestamps_sha256, sha256(timestamps));
  assert.equal(result.evidence.lineage.captions_sha256, sha256(captions));
  assert.equal(result.evidence.lineage.final_video_sha256, sha256(finalVideo));
  assert.equal(result.evidence.account_entitlement.paid_at_generation, true);
  assert.equal(
    result.evidence.account_entitlement.pre_generation.retrieved_at,
    "2026-07-19T20:00:03.000Z",
  );
  assert.equal(
    result.evidence.account_entitlement.post_generation.retrieved_at,
    "2026-07-19T20:00:06.000Z",
  );
  assert.equal(
    result.evidence.generation.request_started_at,
    "2026-07-19T20:00:04.000Z",
  );
  assert.equal(
    result.evidence.generation.response_received_at,
    "2026-07-19T20:00:05.000Z",
  );
  assert.equal(
    result.evidence.provider.model_snapshot_path,
    "rights/evidence/model-snapshot.json",
  );
  assert.equal(
    result.evidence.provider.model_evidence.source_endpoint,
    "https://api.elevenlabs.io/v1/models",
  );
  assert.equal(result.evidence.provider.model_evidence.text_to_speech, true);
  assert.equal(result.evidence.provider.model_snapshot.requires_alpha_access, false);
  assert.equal(
    result.evidence.licence_basis,
    "elevenlabs_commercial_tts_generation",
  );
  assert.equal(result.evidence.checks.current_story_and_audio_match, true);
  assert.equal(result.evidence.checks.policy_files_verified, true);
  assert.equal(result.evidence.checks.model_is_production_tts, true);
  assert.equal(result.evidence.checks.every_strict_v3_condition_proven, true);
  assert.deepEqual(result.evidence.blockers, []);

  const stored = await fs.readFile(result.evidencePath, "utf8");
  assert.doesNotMatch(
    stored,
    new RegExp(
      [
        secret,
        "private-user",
        "private-owner",
        "private-voice-id",
        "open_invoices",
        "amount_due",
      ].join("|"),
      "i",
    ),
  );
  assert.match(stored, /sanitised_snapshot_sha256/);
  assert.equal(
    await fs.pathExists(path.join(root, "rights", "evidence", "model-snapshot.json")),
    true,
  );
  assert.equal(
    await fs.pathExists(path.join(root, "rights", "evidence", "subscription-pre.json")),
    true,
  );
  assert.equal(
    await fs.pathExists(path.join(root, "rights", "evidence", "subscription-post.json")),
    true,
  );
  const modelEvidenceBytes = await fs.readFile(
    path.join(root, "rights", "evidence", "model-snapshot.json"),
  );
  assert.equal(
    result.evidence.provider.model_snapshot_sha256,
    sha256(modelEvidenceBytes),
  );
  for (const document of result.evidence.policy_evidence.documents) {
    const documentBytes = await fs.readFile(
      path.join(root, document.materialised_path),
    );
    assert.equal(document.sha256, sha256(documentBytes));
    assert.equal(document.size_bytes, documentBytes.length);
  }

  const gateBlockers = await strictElevenLabsGenerationEvidenceBlockers({
    evidence: result.evidence,
    artifactDir: root,
    storyId: "flagship-black-flag",
    used: { asset_id: "flagship-black-flag_audio_path" },
    targetPlatforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    currentAudioFingerprint: {
      sha256: sha256(finalAudio),
      size_bytes: finalAudio.length,
    },
  });
  assert.deepEqual(gateBlockers, []);
});

test("two-phase generation receipt stays held until exact final media lineage is bound", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-v3-two-phase-"));
  const rawAudio = Buffer.from("two phase raw provider audio");
  const masteredAudio = Buffer.from("two phase mastered narration");
  const timestamps = Buffer.from('[{"word":"Black","start":0,"end":0.3}]');
  const captions = Buffer.from("1\n00:00:00,000 --> 00:00:00,300\nBlack\n");
  const finalVideo = Buffer.from("two phase decoded final video");
  const requestText = "Black Flag crossed three million sales.";
  const now = clock(
    "2026-07-19T22:00:00.000Z",
    "2026-07-19T22:00:01.000Z",
    "2026-07-19T22:00:02.000Z",
    "2026-07-19T22:00:03.000Z",
    "2026-07-19T22:00:04.000Z",
    "2026-07-19T22:00:05.000Z",
    "2026-07-19T22:00:06.000Z",
  );

  const receipt = await captureElevenLabsGenerationRightsReceipt({
    artifactDir: root,
    storyId: "flagship-black-flag-two-phase",
    assetId: "flagship-black-flag-two-phase_audio_path",
    modelId: "eleven_multilingual_v2",
    voiceId: "private-two-phase-voice",
    requestText,
    requestSettings: { stability: 0.52, api_key: "never-persist" },
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    policyUrls: [
      "https://elevenlabs.io/terms-of-use-eu",
      "https://elevenlabs.io/docs/overview/administration/billing",
    ],
    now,
    fetchSubscription: async () => ({
      tier: "pro",
      status: "active",
      billing_period: "annual_period",
      user_id: "private-user",
    }),
    fetchModelSnapshot: async (modelId) => ({
      model_id: modelId,
      name: "Eleven Multilingual v2",
      can_do_text_to_speech: true,
      requires_alpha_access: false,
      requires_beta_access: false,
    }),
    fetchPolicyDocument: async (url) =>
      Buffer.from(`<html><body>Official policy: ${url}</body></html>`),
    generateAudio: async () => ({
      requestId: "request-two-phase",
      rawAudioBytes: rawAudio,
    }),
    findHistoryItem: async ({ requestId }) => ({
      history_item_id: "history-two-phase",
      request_id: requestId,
      date_unix: 1784498403,
      model_id: "eleven_multilingual_v2",
      voice_id: "private-two-phase-voice",
      text: requestText,
    }),
    downloadHistoryAudio: async () => rawAudio,
  });

  assert.equal(receipt.verdict, "AMBER");
  assert.equal(receipt.receipt.generation_verdict, "GREEN");
  assert.equal(receipt.receipt.final_media_lineage_status, "PENDING");
  assert.ok(receipt.receipt.blockers.includes("final_media_lineage_pending"));
  assert.equal(receipt.receipt.commercial_use_allowed, false);
  assert.equal(await fs.pathExists(receipt.receiptPath), true);
  assert.equal(await fs.pathExists(receipt.rawAudioPath), true);
  assert.equal(
    await fs.pathExists(path.join(root, "rights", "elevenlabs-generation-rights-lineage.json")),
    false,
  );
  receipt.receipt.mastering_lineage = {
    raw_provider_audio_sha256: sha256(rawAudio),
    raw_provider_audio_size_bytes: rawAudio.length,
    mastered_audio_sha256: sha256(masteredAudio),
    mastered_audio_size_bytes: masteredAudio.length,
    transform_status: "COMPLETE",
  };
  await fs.outputJson(receipt.receiptPath, receipt.receipt, { spaces: 2 });

  const finalised = await finalizeElevenLabsGenerationRightsLineage({
    artifactDir: root,
    receiptPath: receipt.receiptPath,
    requestText,
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    now,
    finalizeLineage: async ({ rawAudioBytes }) => ({
      masteredAudioInputBytes: rawAudioBytes,
      masteredAudioOutputBytes: masteredAudio,
      finalAudioBytes: masteredAudio,
      wordTimestampsBytes: timestamps,
      captionsBytes: captions,
      finalVideoBytes: finalVideo,
    }),
  });

  assert.equal(finalised.verdict, "GREEN");
  assert.equal(finalised.evidence.generation.request_id, "request-two-phase");
  assert.equal(finalised.evidence.generation.history_item_id, "history-two-phase");
  assert.equal(finalised.evidence.lineage.final_audio_sha256, sha256(masteredAudio));
  assert.equal(finalised.evidence.lineage.final_video_sha256, sha256(finalVideo));
  assert.equal(finalised.evidence.checks.every_strict_v3_condition_proven, true);
  assert.deepEqual(finalised.evidence.blockers, []);
  assert.equal(
    finalised.evidencePath,
    path.join(root, "rights", "elevenlabs-commercial-tts.json"),
  );
  assert.equal(await fs.pathExists(finalised.evidencePath), true);

  const tamperedReceipt = await fs.readJson(receipt.receiptPath);
  tamperedReceipt.mastering_lineage.mastered_audio_sha256 = "f".repeat(64);
  await fs.outputJson(receipt.receiptPath, tamperedReceipt, { spaces: 2 });
  const rejected = await finalizeElevenLabsGenerationRightsLineage({
    artifactDir: root,
    receiptPath: receipt.receiptPath,
    requestText,
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    now,
    finalizeLineage: async ({ rawAudioBytes }) => ({
      masteredAudioInputBytes: rawAudioBytes,
      masteredAudioOutputBytes: masteredAudio,
      finalAudioBytes: masteredAudio,
      wordTimestampsBytes: timestamps,
      captionsBytes: captions,
      finalVideoBytes: finalVideo,
    }),
  });
  assert.equal(rejected.verdict, "AMBER");
  assert.ok(
    rejected.evidence.blockers.includes(
      "generation_receipt_mastered_audio_binding_mismatch",
    ),
  );
});

test("generation receipt accepts different provider containers only when canonical decoded PCM is identical", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-decoded-identity-"),
  );
  const rawAudio = Buffer.from("provider response mp3 container");
  const historyAudio = Buffer.from("history download mp3 container");
  const canonicalPcm = Buffer.from("identical decoded pcm samples");
  const requestText = "Castlevania turns defeated bosses into traversal powers.";
  const decodeCalls = [];

  const result = await captureElevenLabsGenerationRightsReceipt({
    artifactDir: root,
    storyId: "castlevania-decoded-identity",
    assetId: "castlevania-decoded-identity_audio_path",
    modelId: "eleven_multilingual_v2",
    voiceId: "private-castlevania-voice",
    requestText,
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    policyUrls: [
      "https://elevenlabs.io/terms-of-use-eu",
      "https://elevenlabs.io/docs/overview/administration/billing",
    ],
    now: clock(
      "2026-07-19T23:30:00.000Z",
      "2026-07-19T23:30:01.000Z",
      "2026-07-19T23:30:02.000Z",
      "2026-07-19T23:30:03.000Z",
      "2026-07-19T23:30:04.000Z",
      "2026-07-19T23:30:05.000Z",
      "2026-07-19T23:30:06.000Z",
    ),
    fetchSubscription: async () => ({
      tier: "pro",
      status: "active",
      billing_period: "annual_period",
    }),
    fetchModelSnapshot: async (modelId) => ({
      model_id: modelId,
      name: "Eleven Multilingual v2",
      can_do_text_to_speech: true,
      requires_alpha_access: false,
      requires_beta_access: false,
    }),
    fetchPolicyDocument: async (url) =>
      Buffer.from(`<html><body>Official policy: ${url}</body></html>`),
    generateAudio: async () => ({
      requestId: "request-decoded-identity",
      rawAudioBytes: rawAudio,
    }),
    findHistoryItem: async ({ requestId }) => ({
      history_item_id: "history-decoded-identity",
      request_id: requestId,
      date_unix: 1784503803,
      model_id: "eleven_multilingual_v2",
      voice_id: "private-castlevania-voice",
      text: requestText,
    }),
    downloadHistoryAudio: async () => historyAudio,
    decodeAudioToCanonicalPcm: async (audioBytes) => {
      decodeCalls.push(audioBytes);
      return {
        ok: true,
        bytes: canonicalPcm,
        sample_rate_hz: 44100,
        channels: 1,
        sample_format: "s16le",
      };
    },
  });

  assert.equal(result.receipt.generation_verdict, "GREEN");
  assert.deepEqual(result.receipt.generation_blockers, []);
  assert.equal(
    result.receipt.generation_checks.history_audio_matches_raw_response,
    true,
  );
  assert.equal(
    result.receipt.generation.audio_identity_method,
    "decoded_pcm_s16le_44100_mono_sha256",
  );
  assert.equal(result.receipt.generation.compressed_bytes_match, false);
  assert.equal(
    result.receipt.generation.raw_provider_audio_decoded_pcm_sha256,
    sha256(canonicalPcm),
  );
  assert.equal(
    result.receipt.generation.history_audio_decoded_pcm_sha256,
    sha256(canonicalPcm),
  );
  assert.equal(decodeCalls.length, 2);
});

async function runStrictScenario(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-v3-edge-"));
  const rawAudio = Buffer.from("strict raw audio");
  const defaultSubscription = {
    tier: "pro",
    status: "active",
    billing_period: "annual_period",
    user_id: "must-not-persist",
    open_invoices: [{ total: 100 }],
  };
  const subscriptions = overrides.subscriptions || [
    defaultSubscription,
    defaultSubscription,
  ];
  let subscriptionIndex = 0;
  const result = await materializeElevenLabsGenerationRightsLineage({
    artifactDir: root,
    storyId: "strict-edge-story",
    assetId: "strict-edge-story_audio_path",
    modelId: "eleven_multilingual_v2",
    voiceId: "strict-private-voice",
    requestText: "A strict generation-time rights test.",
    requestSettings: { stability: 0.5, token: "must-not-persist" },
    targetPlatforms: ["youtube_shorts"],
    policyUrls:
      overrides.policyUrls || ["https://elevenlabs.io/terms-of-use-eu"],
    now:
      overrides.now ||
      clock(
        "2026-07-19T21:00:00.000Z",
        "2026-07-19T21:00:01.000Z",
        "2026-07-19T21:00:02.000Z",
        "2026-07-19T21:00:03.000Z",
        "2026-07-19T21:00:04.000Z",
        "2026-07-19T21:00:05.000Z",
      ),
    fetchSubscription:
      overrides.fetchSubscription ||
      (async () =>
        subscriptions[Math.min(subscriptionIndex++, subscriptions.length - 1)]),
    fetchModelSnapshot:
      overrides.fetchModelSnapshot ||
      (async () => ({
        model_id: "eleven_multilingual_v2",
        name: "Eleven Multilingual v2",
        can_do_text_to_speech: true,
        requires_alpha_access: false,
        requires_beta_access: false,
      })),
    fetchPolicyDocument:
      overrides.fetchPolicyDocument ||
      (async () => Buffer.from("official policy evidence")),
    generateAudio:
      overrides.generateAudio ||
      (async () => ({
        requestId: "request-edge",
        rawAudioBytes: rawAudio,
      })),
    findHistoryItem:
      overrides.findHistoryItem ||
      (async () => ({
        history_item_id: "history-edge",
        request_id: "request-edge",
        date_unix: 1784494803,
        model_id: "eleven_multilingual_v2",
        voice_id: "strict-private-voice",
        text: "A strict generation-time rights test.",
      })),
    downloadHistoryAudio:
      overrides.downloadHistoryAudio || (async () => rawAudio),
    finalizeLineage:
      overrides.finalizeLineage ||
      (async () => ({
        masteredAudioInputBytes: rawAudio,
        masteredAudioOutputBytes: Buffer.from("mastered"),
        finalAudioBytes: Buffer.from("final"),
        wordTimestampsBytes: Buffer.from("timestamps"),
        captionsBytes: Buffer.from("captions"),
        finalVideoBytes: Buffer.from("video"),
      })),
  });
  return { root, result };
}

test("any strict v3 evidence break remains AMBER with a precise blocker", async (t) => {
  const scenarios = [
    {
      name: "post-generation entitlement is not paid",
      overrides: {
        subscriptions: [
          { tier: "pro", status: "active" },
          { tier: "free", status: "active" },
        ],
      },
      blocker: "post_generation_paid_entitlement_missing",
    },
    {
      name: "official model is beta-only",
      overrides: {
        fetchModelSnapshot: async () => ({
          model_id: "eleven_multilingual_v2",
          can_do_text_to_speech: true,
          requires_alpha_access: false,
          requires_beta_access: true,
        }),
      },
      blocker: "official_model_snapshot_not_production_safe",
    },
    {
      name: "history item does not bind the request id",
      overrides: {
        findHistoryItem: async () => ({
          history_item_id: "history-edge",
          request_id: "different-request",
          date_unix: 1784494803,
          model_id: "eleven_multilingual_v2",
          voice_id: "strict-private-voice",
          text: "A strict generation-time rights test.",
        }),
      },
      blocker: "request_id_history_item_mismatch",
    },
    {
      name: "history download does not match raw response bytes",
      overrides: {
        downloadHistoryAudio: async () => Buffer.from("different audio"),
      },
      blocker: "history_audio_does_not_match_raw_response",
    },
    {
      name: "final video lineage is absent",
      overrides: {
        finalizeLineage: async ({ rawAudioBytes }) => ({
          masteredAudioInputBytes: rawAudioBytes,
          masteredAudioOutputBytes: Buffer.from("mastered"),
          finalAudioBytes: Buffer.from("final"),
          wordTimestampsBytes: Buffer.from("timestamps"),
          captionsBytes: Buffer.from("captions"),
          finalVideoBytes: Buffer.alloc(0),
        }),
      },
      blocker: "raw_to_final_media_lineage_incomplete",
    },
    {
      name: "policy source is not an official ElevenLabs domain",
      overrides: {
        policyUrls: ["https://example.com/copied-policy"],
      },
      blocker: "policy_url_not_official:1",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { root, result } = await runStrictScenario(scenario.overrides);
      assert.equal(result.verdict, "AMBER");
      assert.equal(result.evidence.commercial_use_allowed, false);
      assert.equal(
        result.evidence.checks.every_strict_v3_condition_proven,
        false,
      );
      assert.ok(result.evidence.blockers.includes(scenario.blocker));
      const storedRights = await fs.readFile(result.evidencePath, "utf8");
      const persistedFiles = await fs.readdir(
        path.join(root, "rights", "evidence"),
      );
      const persistedEvidence = await Promise.all(
        persistedFiles.map((file) =>
          fs.readFile(path.join(root, "rights", "evidence", file), "utf8"),
        ),
      );
      const allStored = [storedRights, ...persistedEvidence].join("\n");
      assert.doesNotMatch(
        allStored,
        /must-not-persist|strict-private-voice|open_invoices|amount_due|"token"\s*:/i,
      );
    });
  }
});
