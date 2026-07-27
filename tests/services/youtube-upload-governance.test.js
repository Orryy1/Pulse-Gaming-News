"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const uploaderPath = path.resolve(__dirname, "..", "..", "upload_youtube.js");
const publisherPath = path.resolve(__dirname, "..", "..", "publisher.js");
const uploaderSource = fs.readFileSync(uploaderPath, "utf8");
const publisherSource = fs.readFileSync(publisherPath, "utf8");
const {
  attachYoutubeRefreshTelemetry,
  buildYoutubeShortRequestBody,
  insertYoutubeVideoOnce,
  loadHashBoundYoutubeMedia,
  refreshYoutubeCredentialsInMemory,
  resolveGovernedYoutubeMetadata,
  resolveContainsSyntheticMedia,
  uploadAll,
  uploadLongform,
  uploadShort,
} = require("../../upload_youtube");

function governedMetadataFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-youtube-metadata-"),
  );
  const metadataPath = path.join(directory, "publication-metadata.json");
  const value = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: "story-1",
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: "The exact operator-approved title",
    description:
      "The exact operator-approved description.\n\nFootage: © SQUARE ENIX\n\n#Shorts",
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(metadataPath, bytes);
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    path: metadataPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

test("the tracked Evercold publication metadata resolves the exact approved YouTube Shorts bytes", () => {
  const metadataPath = path.resolve(
    __dirname,
    "..",
    "..",
    "videos",
    "evercold-bastion-short",
    "publication-metadata.json",
  );
  const bytes = fs.readFileSync(metadataPath);
  const metadata = JSON.parse(bytes.toString("utf8"));
  const approvedSha =
    "94adc0c1d5f04907ffa2a99fa4d6e4debe9ce9c05957010b92af4c953fc3aa85";
  const binding = {
    path: metadataPath,
    sha256: approvedSha,
    platform: "youtube_shorts",
  };

  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    approvedSha,
  );
  assert.equal(binding.sha256, approvedSha);
  assert.equal(binding.platform, "youtube_shorts");

  const resolved = resolveGovernedYoutubeMetadata({
    id: "official_d86953ca92ca",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: binding.sha256,
    governed_publication_metadata: {
      path: metadataPath,
      sha256: binding.sha256,
      platform: binding.platform,
      title: metadata.title,
      description: metadata.description,
    },
  });

  assert.equal(
    resolved.title,
    "Final Fantasy XIV's New Tank Uses TWO Giant Shields",
  );
  assert.equal(resolved.description, metadata.description);
  assert.match(resolved.description, /^Final Fantasy XIV: Evercold/);
  assert.match(resolved.description, /© SQUARE ENIX/);
  assert.match(resolved.description, /#FFXIV #FinalFantasyXIV/);
});

test("governed YouTube metadata resolves the exact hash-bound reviewed title and attributed description", (t) => {
  const approved = governedMetadataFixture(t);
  const resolved = resolveGovernedYoutubeMetadata({
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: approved.value.title,
      description: approved.value.description,
    },
  });

  assert.equal(resolved.title, approved.value.title);
  assert.equal(resolved.description, approved.value.description);
  assert.match(resolved.description, /© SQUARE ENIX/);
  assert.equal(resolved.sha256, approved.sha256);
});

test("governed YouTube metadata fails closed when approval is missing or its file drifts", (t) => {
  assert.throws(
    () =>
      resolveGovernedYoutubeMetadata({
        id: "story-1",
        channel_id: "pulse-gaming",
      }),
    /governed_dispatch_publication_metadata_required/,
  );

  const approved = governedMetadataFixture(t);
  const story = {
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: approved.value.title,
      description: approved.value.description,
    },
  };
  fs.appendFileSync(approved.path, " ");

  assert.throws(
    () => resolveGovernedYoutubeMetadata(story),
    /governed_dispatch_publication_metadata_sha256_mismatch/,
  );
});

test("governed YouTube metadata rejects a snapshot that differs from the approved file", (t) => {
  const approved = governedMetadataFixture(t);
  const story = {
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: "A mutable replacement title",
      description: approved.value.description,
    },
  };

  assert.throws(
    () => resolveGovernedYoutubeMetadata(story),
    /governed_dispatch_publication_metadata_binding_mismatch/,
  );
});

test("governed YouTube metadata rejects a CWD-relative binding at the final upload boundary", (t) => {
  const approved = governedMetadataFixture(t);

  assert.throws(
    () =>
      resolveGovernedYoutubeMetadata({
        id: "story-1",
        channel_id: "pulse-gaming",
        governed_publication_metadata_sha256: approved.sha256,
        governed_publication_metadata: {
          path: path.relative(process.cwd(), approved.path),
          sha256: approved.sha256,
          platform: approved.value.platform,
          title: approved.value.title,
          description: approved.value.description,
        },
      }),
    /governed_dispatch_publication_metadata_canonical_absolute_path_required/,
  );
});

test("YouTube create mutation is attempted exactly once when its response is ambiguous", async () => {
  let attempts = 0;
  const responseLost = new Error("response lost after request body sent");
  const youtube = {
    videos: {
      async insert() {
        attempts += 1;
        throw responseLost;
      },
    },
  };

  await assert.rejects(
    insertYoutubeVideoOnce(youtube, { requestBody: {} }),
    (error) => error === responseLost,
  );
  assert.equal(attempts, 1);
});

test("governed YouTube request carries the reviewed altered-content decision", () => {
  const disclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
  const notDisclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: false,
      decision: "NO_DISCLOSURE_REQUIRED",
      rationale: "The final edit contains no realistic altered content.",
      disclosure_text: null,
      youtube_field_value: false,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };

  assert.equal(resolveContainsSyntheticMedia(disclosed), true);
  assert.equal(resolveContainsSyntheticMedia(notDisclosed), false);
  assert.equal(
    buildYoutubeShortRequestBody(disclosed, {
      title: "Reviewed title",
      description: "Reviewed description",
      tags: ["Pulse Gaming News"],
      categoryId: "20",
    }).status.containsSyntheticMedia,
    true,
  );
  assert.throws(
    () => resolveContainsSyntheticMedia({}),
    /youtube_synthetic_disclosure_decision_required/,
  );
  assert.throws(
    () =>
      resolveContainsSyntheticMedia({
        synthetic_media_disclosure: {
          ...disclosed.synthetic_media_disclosure,
          youtube_field_value: false,
        },
      }),
    /youtube_synthetic_disclosure_field_mismatch/,
  );
});

test("YouTube adapter refuses direct Short and legacy batch mutation paths", async () => {
  await assert.rejects(
    uploadShort({ id: "story-1", title: "Direct call" }),
    /governed_youtube_dispatch_required/,
  );
  await assert.rejects(
    uploadAll(),
    /legacy_youtube_batch_publish_disabled_use_governed_queue/,
  );
});

test("governed Short upload validates approved metadata before OAuth or the create boundary", async () => {
  let createBoundaryStarted = false;

  await assert.rejects(
    uploadShort(
      {
        id: "story-1",
        channel_id: "pulse-gaming",
        title: "Mutable database title",
      },
      {
        governedDispatch: true,
        markCreateAttemptStarted() {
          createBoundaryStarted = true;
        },
      },
    ),
    /governed_dispatch_publication_metadata_required/,
  );
  assert.equal(createBoundaryStarted, false);
});

test("YouTube create streams the approved bytes even if the source path is replaced after binding", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-bound-media-"),
  );
  const mediaPath = path.join(directory, "approved.mp4");
  const approvedBytes = Buffer.alloc(24 * 1024, 0x2a);
  const replacementBytes = Buffer.alloc(24 * 1024, 0x7f);
  const approvedSha256 = crypto
    .createHash("sha256")
    .update(approvedBytes)
    .digest("hex");
  fs.writeFileSync(mediaPath, approvedBytes);
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const bound = await loadHashBoundYoutubeMedia(
    { exported_path: mediaPath },
    approvedSha256,
  );
  fs.writeFileSync(mediaPath, replacementBytes);

  const chunks = [];
  for await (const chunk of bound.createReadStream()) {
    chunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(chunks), approvedBytes);
  assert.equal(bound.sha256, approvedSha256);
  assert.equal(bound.byteLength, approvedBytes.length);
  assert.throws(
    () => bound.createReadStream(),
    /youtube_bound_media_stream_already_consumed/,
  );
});

test("YouTube media binding rejects bytes that do not match the approved SHA before create", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-media-mismatch-"),
  );
  const mediaPath = path.join(directory, "drifted.mp4");
  fs.writeFileSync(mediaPath, Buffer.alloc(24 * 1024, 0x55));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    loadHashBoundYoutubeMedia(
      { exported_path: mediaPath },
      "a".repeat(64),
    ),
    /youtube_media_sha256_mismatch/,
  );
});

test("expired YouTube credentials refresh in memory without a token-file write", async () => {
  const original = {
    access_token: "expired-access-token",
    refresh_token: "durable-refresh-token",
    expiry_date: 1,
  };
  const applied = [];
  let refreshes = 0;
  const oauth2Client = {
    setCredentials(credentials) {
      applied.push(credentials);
    },
    async refreshAccessToken() {
      refreshes += 1;
      return {
        credentials: {
          access_token: "fresh-access-token",
          expiry_date: 9_999_999,
        },
      };
    },
  };

  const result = await refreshYoutubeCredentialsInMemory(
    oauth2Client,
    original,
    {
      nowMs: 100_000,
      telemetry: {
        schema_version: "pulse-youtube-auth-telemetry-v1",
        durable_oauth_or_token_mutated: false,
        ephemeral_access_token_refresh: {
          attempted: false,
          succeeded: false,
          failed: false,
        },
      },
    },
  );

  assert.equal(refreshes, 1);
  assert.equal(result.refreshed, true);
  assert.deepEqual(result.credentials, {
    access_token: "fresh-access-token",
    refresh_token: "durable-refresh-token",
    expiry_date: 9_999_999,
  });
  assert.deepEqual(applied, [result.credentials]);
  assert.deepEqual(result.telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: true,
    failed: false,
  });
});

test("failed in-memory refresh reports ephemeral failure and emits no secret", async () => {
  const secret = "refresh-secret-value";
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };

  await assert.rejects(
    refreshYoutubeCredentialsInMemory(
      {
        async refreshAccessToken() {
          throw new Error(`Bearer ${secret} was rejected`);
        },
      },
      {
        access_token: "expired",
        refresh_token: "durable-refresh",
        expiry_date: 1,
      },
      { nowMs: 100_000, telemetry },
    ),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: false,
    failed: true,
  });
});

test("google-auth automatic refresh telemetry observes tokens events without retaining credentials", async () => {
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };
  const observed = [];
  const oauth2Client = new EventEmitter();
  oauth2Client.refreshToken = async function refreshToken() {
    this.emit("tokens", {
      access_token: "access-secret-that-must-not-survive",
    });
    return { tokens: { access_token: "another-secret" } };
  };
  attachYoutubeRefreshTelemetry(
    oauth2Client,
    telemetry,
    (value) => observed.push(value),
  );

  await oauth2Client.refreshToken("refresh-secret-that-must-not-survive");

  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: true,
    failed: false,
  });
  assert.equal(
    JSON.stringify(observed).includes("secret-that-must-not-survive"),
    false,
  );
});

test("google-auth automatic refresh failures are observed and sanitised", async () => {
  const secret = "automatic-refresh-secret";
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };
  const oauth2Client = new EventEmitter();
  oauth2Client.refreshToken = async () => {
    throw new Error(`refresh_token=${secret}`);
  };
  attachYoutubeRefreshTelemetry(oauth2Client, telemetry);

  await assert.rejects(
    oauth2Client.refreshToken("durable-refresh-secret"),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: false,
    failed: true,
  });
});

test("only the separately invoked OAuth exchange flow may persist the YouTube token", () => {
  const tokenWrites =
    uploaderSource.match(/\bfs\.writeJson\(TOKEN_PATH\b/g) || [];
  const authClientSource = uploaderSource.slice(
    uploaderSource.indexOf("async function getAuthClient"),
    uploaderSource.indexOf("// --- Generate auth URL"),
  );

  assert.equal(tokenWrites.length, 1);
  assert.match(
    uploaderSource,
    /async function exchangeCode\(code\)[\s\S]*?fs\.writeJson\(TOKEN_PATH,\s*tokens,/,
  );
  assert.doesNotMatch(
    authClientSource,
    /\bfs\.writeJson\(TOKEN_PATH,/,
  );
});

test("long-form YouTube mutation is frozen by the default stabilisation profile", async (t) => {
  const previous = process.env.PULSE_SCHEDULER_PROFILE;
  delete process.env.PULSE_SCHEDULER_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.PULSE_SCHEDULER_PROFILE;
    else process.env.PULSE_SCHEDULER_PROFILE = previous;
  });

  await assert.rejects(
    uploadLongform({}),
    /stabilisation_longform_upload_disabled/,
  );
});

test("publisher is the governed Short caller and the adapter has no generic mutation retry", () => {
  assert.doesNotMatch(uploaderSource, /\bwithRetry\b/);
  assert.match(
    publisherSource,
    /uploadShort\(uploadStory,\s*\{\s*governedDispatch:\s*true,\s*markCreateAttemptStarted,\s*assertYoutubeCreateBoundary,\s*reportAuthTelemetry:\s*reportYoutubeAuthTelemetry,\s*expectedMediaSha256:\s*currentFingerprint\.media_sha256,\s*\}\)/,
  );
  assert.match(
    publisherSource,
    /synthetic_media_disclosure:\s*scheduled\.publicationEvidence\.synthetic_media_disclosure/,
  );
  assert.match(
    uploaderSource,
    /const governedMetadata = resolveGovernedYoutubeMetadata\(story\);[\s\S]*const \{ tags \} = buildMetadata\(story\);[\s\S]*title: governedMetadata\.title,[\s\S]*description: governedMetadata\.description/,
  );
  assert.match(
    uploaderSource,
    /async function uploadShort\(\s*story,\s*\{\s*governedDispatch\s*=\s*false,\s*markCreateAttemptStarted\s*=\s*null,\s*assertYoutubeCreateBoundary\s*=\s*null,\s*reportAuthTelemetry\s*=\s*null,\s*expectedMediaSha256\s*=\s*null,\s*\}\s*=\s*\{\},?\s*\)/,
  );
  assert.match(
    uploaderSource,
    /const boundMedia = await loadHashBoundYoutubeMedia\(\s*story,\s*expectedMediaSha256,\s*\);[\s\S]*invokeTrustedYoutubeCreateBoundaryGate\([\s\S]*media:\s*\{\s*body:\s*boundMedia\.createReadStream\(\),\s*\}/,
  );
  assert.match(
    uploaderSource,
    /invokeTrustedYoutubeCreateBoundaryGate\(\s*assertYoutubeCreateBoundary,\s*\);\s*markCreateAttemptStarted\(\);\s*const response = await insertYoutubeVideoOnce/,
  );
  assert.match(publisherSource, /trustedYoutubeCreateBoundaryGates = new WeakSet/);
  assert.match(
    publisherSource,
    /function issueTrustedYoutubeCreateBoundaryGate\(/,
  );
  assert.doesNotMatch(
    publisherSource,
    /module\.exports\s*=\s*\{[\s\S]*issueTrustedYoutubeCreateBoundaryGate/,
  );
});
