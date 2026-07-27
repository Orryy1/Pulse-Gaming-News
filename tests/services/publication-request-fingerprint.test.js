"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mediaFixture(t, contents = "governed-video-v1") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publication-fingerprint-"),
  );
  const mediaPath = path.join(directory, "final.mp4");
  fs.writeFileSync(mediaPath, contents);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return mediaPath;
}

function story(mediaPath) {
  return {
    id: "story-fingerprint-1",
    exported_path: mediaPath,
    title: "Xbox preservation gets a major upgrade",
    full_script: "The original Xbox catalogue is coming back.",
    classification: {
      confidence: "verified",
      lane: "confirmed_drop",
    },
  };
}

test("publication request fingerprint is stable for equivalent governed input", async (t) => {
  const mediaPath = mediaFixture(t);
  const firstStory = story(mediaPath);
  const equivalentStory = {
    ...firstStory,
    classification: {
      lane: "confirmed_drop",
      confidence: "verified",
    },
  };
  const options = {
    channelId: "pulse-gaming",
    channel: {
      id: "pulse-gaming",
      name: "Pulse Gaming",
      youtubeCategory: "20",
    },
  };

  const first = await fingerprintPublicationRequest(firstStory, options);
  const replay = await fingerprintPublicationRequest(equivalentStory, options);

  assert.equal(replay.request_fingerprint, first.request_fingerprint);
  assert.equal(replay.canonical_json, first.canonical_json);
  assert.equal(first.media_sha256, sha256("governed-video-v1"));
  assert.equal(first.script_sha256, sha256(firstStory.full_script));
  assert.match(first.request_fingerprint, /^[a-f0-9]{64}$/);
});

test("relocating identical media does not change the governed request fingerprint", async (t) => {
  const firstPath = mediaFixture(t);
  const relocatedPath = path.join(
    path.dirname(firstPath),
    "relocated-final.mp4",
  );
  fs.copyFileSync(firstPath, relocatedPath);
  const options = { channelId: "pulse-gaming" };

  const first = await fingerprintPublicationRequest(story(firstPath), options);
  const relocated = await fingerprintPublicationRequest(
    story(relocatedPath),
    options,
  );

  assert.equal(relocated.media_sha256, first.media_sha256);
  assert.equal(relocated.request_fingerprint, first.request_fingerprint);
});

test("reviewed publication evidence is immutable fingerprint input", async (t) => {
  const mediaPath = mediaFixture(t);
  const original = story(mediaPath);
  const publicationEvidence = {
    renderer_manifest_sha256: "a".repeat(64),
    rights_ledger_sha256: "b".repeat(64),
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
  const options = {
    channelId: "pulse-gaming",
    publicationEvidence,
  };

  const baseline = await fingerprintPublicationRequest(original, options);
  const keyReordered = await fingerprintPublicationRequest(original, {
    ...options,
    publicationEvidence: {
      synthetic_media_disclosure: {
        disclosure_text: "Includes AI-generated narration.",
        rationale: "Synthetic narration is present.",
        decision: "DISCLOSE",
        contains_synthetic_media: true,
        reviewed_at: "2026-07-27T08:45:00.000Z",
        youtube_field_value: true,
      },
      rights_ledger_sha256: "b".repeat(64),
      renderer_manifest_sha256: "a".repeat(64),
    },
  });
  const changedDecision = await fingerprintPublicationRequest(original, {
    ...options,
    publicationEvidence: {
      ...publicationEvidence,
      synthetic_media_disclosure: {
        contains_synthetic_media: true,
        decision: "NO_DISCLOSURE_REQUIRED",
        rationale: "Gameplay-only synthetic production assistance.",
        disclosure_text: null,
        policy_basis: "youtube_altered_content_policy_reviewed",
        youtube_field_value: false,
        reviewed_at: "2026-07-27T08:45:00.000Z",
      },
    },
  });

  assert.equal(
    baseline.request.publication_evidence.synthetic_media_disclosure.decision,
    "DISCLOSE",
  );
  assert.equal(keyReordered.request_fingerprint, baseline.request_fingerprint);
  assert.notEqual(
    changedDecision.request_fingerprint,
    baseline.request_fingerprint,
  );
});

test("script, title, media content and channel identity each change the request fingerprint", async (t) => {
  const mediaPath = mediaFixture(t);
  const original = story(mediaPath);
  const options = {
    channelId: "pulse-gaming",
    channel: { id: "pulse-gaming", name: "Pulse Gaming" },
  };
  const baseline = await fingerprintPublicationRequest(original, options);

  const scriptChanged = await fingerprintPublicationRequest(
    {
      ...original,
      full_script: `${original.full_script} Achievement support too.`,
    },
    options,
  );
  const titleChanged = await fingerprintPublicationRequest(
    { ...original, title: "Original Xbox games return with achievements" },
    options,
  );
  const channelChanged = await fingerprintPublicationRequest(original, {
    ...options,
    channelId: "pulse-gaming-alt",
    channel: { id: "pulse-gaming-alt", name: "Pulse Gaming Alt" },
  });
  fs.writeFileSync(mediaPath, "governed-video-v2");
  const mediaChanged = await fingerprintPublicationRequest(original, options);

  for (const changed of [
    scriptChanged,
    titleChanged,
    channelChanged,
    mediaChanged,
  ]) {
    assert.notEqual(changed.request_fingerprint, baseline.request_fingerprint);
  }
  assert.notEqual(scriptChanged.script_sha256, baseline.script_sha256);
  assert.equal(titleChanged.script_sha256, baseline.script_sha256);
  assert.notEqual(mediaChanged.media_sha256, baseline.media_sha256);
});
