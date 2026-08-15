const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");

const {
  admitPublication,
} = require("../../lib/services/publication-admission");
const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  createRendererEvidence,
} = require("../../lib/stabilisation/render-manifest");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const governanceFactory = require("../../lib/repositories/publication_governance");
const storiesFactory = require("../../lib/repositories/stories");

// QA-fail deadlock fix (2026-04-21)
//
// Before: publisher.js::_publishNextStoryInner ran content-QA +
// video-QA in a pre-flight block. On hard-fail it returned an
// in-memory { qa_failed: true } result but NEVER wrote that state
// to the story row. Consequence: the selector at the top of the
// function had no way to know the story had been refused, so the
// same story got re-picked at the NEXT publish window (and the
// one after that — three 09/14/19 UTC windows per day wasted on
// one broken story).
//
// Fix: on QA hard-fail, set story.qa_failed=true,
// story.publish_status="failed", story.publish_error,
// story.qa_failed_at, then await db.upsertStory(story) BEFORE
// returning. The publish candidate selector now skips
// qa_failed=true and publish_status="failed" rows.
//
// These tests combine source-scan pins (so the fix can't be
// silently reverted) with integration tests that drive
// publishNextStory() against stubbed content-qa / video-qa /
// db / uploader modules to assert the persistence actually
// happens.

const PUBLISHER_PATH = path.join(__dirname, "..", "..", "publisher.js");
const SRC = fs.readFileSync(PUBLISHER_PATH, "utf8");

// ---------- source-scan pins ----------

test("publisher.js: persistQaFail helper writes qa_failed + publish_status=failed and awaits upsertStory", () => {
  // Refactored 2026-04-22 into a reusable helper so the multi-
  // candidate loop can persist every QA-failing candidate it
  // walks past, not just the first one.
  const idx = SRC.indexOf("async function persistQaFail(");
  assert.ok(idx > 0, "persistQaFail helper must exist");
  const block = SRC.slice(idx, idx + 2500);
  assert.match(
    block,
    /story\.qa_failed\s*=\s*true/,
    "persistQaFail must set story.qa_failed = true",
  );
  assert.match(
    block,
    /story\.publish_status\s*=\s*["']failed["']/,
    "persistQaFail must set story.publish_status = 'failed'",
  );
  assert.match(
    block,
    /story\.publish_error\s*=/,
    "persistQaFail must set story.publish_error",
  );
  assert.match(
    block,
    /await\s+db\.upsertStory\(story\)/,
    "persistQaFail must call db.upsertStory",
  );
});

test("publisher.js: runPreflightQa runs content-QA then video-QA and returns structured pass/fail", () => {
  const idx = SRC.indexOf("async function runPreflightQa(");
  assert.ok(idx > 0, "runPreflightQa helper must exist");
  const block = SRC.slice(idx, idx + 8500);
  assert.match(block, /runContentQa/, "runPreflightQa must call content-QA");
  assert.match(block, /runVideoQa/, "runPreflightQa must call video-QA");
  assert.match(
    block,
    /runPlatformVideoQa/,
    "runPreflightQa must call platform-video-QA",
  );
  assert.match(
    block,
    /source:\s*["']content["']/,
    "content-QA fail result must tag source: 'content'",
  );
  assert.match(
    block,
    /source:\s*["']video["']/,
    "video-QA fail result must tag source: 'video'",
  );
  assert.match(
    block,
    /source:\s*["']platform_video["']/,
    "platform-video-QA fail result must tag source: 'platform_video'",
  );
  assert.match(
    block,
    /hasGovernedAutonomousContentQaEvidence/,
    "runPreflightQa must detect persisted autonomous visual-policy evidence",
  );
  assert.match(
    block,
    /resolveGovernedAutonomousContentQaAuthority/,
    "runPreflightQa must independently resolve autonomous authority",
  );
  assert.match(
    block,
    /reconcileGovernedAutonomousContentQa/,
    "runPreflightQa must reconcile only the exact autonomous content-QA exception",
  );
  assert.match(
    block,
    /publicationGovernance:\s*context\.publicationGovernance/,
    "autonomous authority resolution must use the immutable governance repository",
  );
});

test("publisher.js: publishNextStory selector skips qa_failed and publish_status=failed", () => {
  const selectorIdx = SRC.indexOf(
    "Stabilisation has one automated public target",
  );
  assert.ok(selectorIdx > 0, "selector anchor comment must exist");
  const block = SRC.slice(selectorIdx, selectorIdx + 3000);
  assert.match(
    block,
    /if\s*\(\s*s\.qa_failed\s*===\s*true\s*\)\s*return\s+false/,
    "selector must skip stories with qa_failed === true",
  );
  assert.match(
    block,
    /if\s*\(\s*s\.publish_status\s*===\s*["']failed["']\s*\)\s*return\s+false/,
    "selector must skip stories with publish_status === 'failed'",
  );
});

test("publisher.js: multi-candidate loop uses MAX_PUBLISH_CANDIDATES_PER_WINDOW cap and persists failures via persistQaFail", () => {
  // Anchor on the constant declaration to make sure it exists with
  // a concrete number (not inferred). 3 ≤ cap ≤ 10 is a sanity
  // bound — anything smaller and a small backlog of stale stories
  // exhausts the window, anything larger and a truly broken batch
  // could burn the publish window on 20+ QA checks.
  const m = SRC.match(/const\s+MAX_PUBLISH_CANDIDATES_PER_WINDOW\s*=\s*(\d+)/);
  assert.ok(m, "MAX_PUBLISH_CANDIDATES_PER_WINDOW constant must exist");
  const cap = parseInt(m[1], 10);
  assert.ok(cap >= 3 && cap <= 10, `cap out of sensible range: ${cap}`);

  // And the main loop must pull its slice from that constant.
  assert.match(
    SRC,
    /scheduledCandidates\.slice\(\s*0,\s*MAX_PUBLISH_CANDIDATES_PER_WINDOW/,
    "multi-candidate loop must apply the cap after governance scheduling",
  );
  // No-safe-candidate return shape must include the fields the
  // Discord summary consumes.
  assert.match(SRC, /no_safe_candidate:\s*true/);
  assert.match(SRC, /qa_skipped_count:/);
  assert.match(SRC, /top_reason:/);
  assert.match(SRC, /candidates_tried:/);
});

// ---------- integration: publishNextStory end-to-end ----------

const PUBLISHER_RESOLVED = require.resolve("../../publisher.js");
const DB_RESOLVED = require.resolve("../../lib/db.js");
const CQA_RESOLVED = require.resolve("../../lib/services/content-qa.js");
const AUTONOMOUS_CQA_RESOLVED = require.resolve(
  "../../lib/services/governed-autonomous-content-qa.js",
);
const VQA_RESOLVED = require.resolve("../../lib/services/video-qa.js");
const PVQA_RESOLVED = require.resolve("../../lib/services/platform-video-qa.js");
const RENDER_DECISION_RESOLVED = require.resolve("../../lib/render-decision.js");
const NOTIFY_RESOLVED = require.resolve("../../notify.js");
const SENTRY_RESOLVED = require.resolve("../../lib/sentry.js");
const PUBLISH_BLOCK_RESOLVED =
  require.resolve("../../lib/services/publish-block.js");
const ENGAGEMENT_RESOLVED = require.resolve("../../engagement.js");
const BLOG_RESOLVED = require.resolve("../../blog/generator.js");
const DISCORD_AUTO_POST_RESOLVED =
  require.resolve("../../discord/auto_post.js");
const DISCORD_POST_GATE_RESOLVED =
  require.resolve("../../lib/services/discord-post-gate.js");
const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const PUBLISH_NOW = new Date("2026-07-27T09:05:00.000Z");
const TEST_YOUTUBE_OAUTH_CLIENT_SHA256 = "f".repeat(64);

function testOfficialSourceBinding(
  storyId,
  sourceEvidenceSha256 = "1".repeat(64),
) {
  const claimText =
    "The exact official source confirms this release.";
  const claim = {
    claim_key: "release_claim",
    text: claimText,
    claim_text_sha256: sha256(claimText),
  };
  return buildOfficialSourceReleaseBinding({
    storyId,
    sourceEvidenceSha256,
    sourceEvidence: {
      schema_version: "pulse-source-evidence-v1",
      story_id: storyId,
      source_type: "official",
      source_url:
        "https://publisher.example/news/release",
      claims: [claim],
      official_source_snapshot: {
        schema_version:
          "pulse-official-source-snapshot-v1",
        source_url:
          "https://publisher.example/news/release",
        source_id: "publisher-release",
        source_class: "OFFICIAL_FIRST_PARTY",
        canonical_body_algorithm:
          "pulse-readable-body-v1",
        canonical_body_sha256: "9".repeat(64),
        claims: [claim],
      },
    },
  });
}

const SCHEDULED_PUBLICATION_EVIDENCE = Object.freeze({
  schema_version: "pulse-publication-evidence-v1",
  source_evidence_sha256: "1".repeat(64),
  official_source_release_binding:
    testOfficialSourceBinding("scheduled-test-story"),
  qa_report_sha256: "2".repeat(64),
  rights_ledger_sha256: "3".repeat(64),
  renderer_manifest_sha256: "4".repeat(64),
  publication_metadata_sha256: "6".repeat(64),
  publication_metadata: {
    path: "C:\\proof\\reviewed-publication-metadata.json",
    sha256: "6".repeat(64),
    platform: "youtube_shorts",
    title: "The exact approved YouTube title",
    description:
      "The exact approved YouTube description.\n\nFootage: © SQUARE ENIX",
  },
  renderer: {
    id: "studio-v21",
    role: "standard",
    version: "2.1.0",
  },
  originality_transformation: {
    verdict: "STRONG",
    rationale: "Original reporting and motion design transform the references.",
    evidence_ref: "output/qa/transformation.json",
    evidence_sha256: "5".repeat(64),
  },
  synthetic_media_disclosure: {
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale: "Synthetic narration is present.",
    disclosure_text: "Includes AI-generated narration.",
    policy_basis: null,
    youtube_field_value: true,
    reviewed_at: "2026-07-27T08:45:00.000Z",
  },
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function persistedOutsideCadenceAdmission(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publisher-outside-cadence-"),
  );
  const mediaPath = path.join(directory, "reviewed-final.mp4");
  const mediaBytes = Buffer.from("outside-cadence-reviewed-video");
  fs.writeFileSync(mediaPath, mediaBytes);
  const metadataPath = path.join(
    directory,
    "publication-metadata.json",
  );
  const metadataValue = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: "outside-cadence-story",
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: "The exact outside-cadence approved title",
    description:
      "The exact outside-cadence approved description.\n\n© SQUARE ENIX",
  };
  const metadataBytes = Buffer.from(
    `${JSON.stringify(metadataValue, null, 2)}\n`,
  );
  fs.writeFileSync(metadataPath, metadataBytes);

  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  const story = {
    id: "outside-cadence-story",
    title: "Outside-cadence governed story",
    channel_id: "pulse-gaming",
    approved: true,
    auto_approved: false,
    full_script:
      "Final Fantasy XIV reveals a new tank built around two giant shields.",
    exported_path: mediaPath,
    publish_status: null,
    youtube_post_id: null,
  };
  db.prepare(
    `INSERT INTO stories
       (id, title, channel_id, approved, auto_approved, full_script,
        exported_path, publish_status, youtube_post_id)
     VALUES
       (@id, @title, @channel_id, 1, 0, @full_script,
        @exported_path, @publish_status, @youtube_post_id)`,
  ).run(story);
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion",
        source_url: "pulse-owned://outside-cadence-story/motion",
        asset_sha256: "4".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "output/rights/outside-cadence-story.json",
          sha256: "5".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  const rendererManifest = createRendererEvidence({
    story,
    rendererVersion: "2.1.0",
    mediaSha256: sha256(mediaBytes),
    stack: { hyperframes: true, ffmpeg: true },
    platformVideoQa: {
      result: "pass",
      failures: [],
      warnings: [],
      technical: {
        video_codec: "h264",
        video_profile: "High",
        pixel_format: "yuv420p",
        width: 1080,
        height: 1920,
        audio_codec: "aac",
        audio_sample_rate_hz: 48000,
        has_audio: true,
        duration_seconds: 30,
        ffprobe_passed: true,
      },
    },
    timing: {
      first_frame_exact_subject: true,
      first_frame_text: "A TANK WITH TWO SHIELDS",
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 8,
      motion_scene_count: 4,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 1,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    operatingMode: "LIVE_GUARDED",
  }).manifest;
  const publicationMetadata = {
    path: metadataPath,
    sha256: sha256(metadataBytes),
    platform: metadataValue.platform,
    title: metadataValue.title,
    description: metadataValue.description,
  };
  const evidence = {
    source_evidence_sha256: "1".repeat(64),
    official_source_release_binding:
      testOfficialSourceBinding(story.id),
    qa_report_sha256: "2".repeat(64),
    rights_ledger: rightsLedger,
    rights_ledger_sha256: hashRightsLedger(rightsLedger),
    originality_transformation: {
      verdict: "STRONG",
      rationale: "Original reporting and motion treatment.",
      evidence_ref: "output/qa/outside-cadence-transformation.json",
      evidence_sha256: "3".repeat(64),
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T09:54:00.000Z",
    },
    publication_metadata_sha256: publicationMetadata.sha256,
    publication_metadata: publicationMetadata,
    renderer_manifest: rendererManifest,
    renderer_manifest_sha256:
      fingerprintRendererManifest(rendererManifest),
  };
  const repos = {
    db,
    stories: storiesFactory.bind(db),
    publicationGovernance: governanceFactory.bind(db),
  };
  const channel = {
    id: "pulse-gaming",
    name: "Pulse Gaming",
    niche: "gaming",
    tagline: "Fast. Verified. Player-first.",
    cta: "Subscribe for the next confirmed drop.",
    youtubeCategory: "20",
  };
  const scheduledFor = "2026-07-27T10:00:00.000Z";
  const authorisationId = "outside-cadence-publisher-test";
  const admission = await admitPublication({
    repos,
    storyId: story.id,
    channelId: story.channel_id,
    platform: "youtube",
    actorId: "operator-test",
    reason: "Exact one-shot breaking-news release",
    confirmationStoryId: story.id,
    scheduledFor,
    evidence,
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
        TEST_YOUTUBE_OAUTH_CLIENT_SHA256,
    },
    now: new Date("2026-07-27T09:55:00.000Z"),
    channel,
    outsideCadenceAuthorisation: {
      authorisationId,
      confirmAuthorisationId: authorisationId,
      oneShotConfirmed: true,
    },
  });
  assert.equal(admission.admitted, true);
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    admission,
    channel,
    db,
    repos,
    scheduledFor,
    story,
  };
}

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

// Neutralise every downstream module publisher.js loads AFTER a
// successful upload — engagement, blog, discord. Without these
// stubs: engageFirstHour schedules a 5-min setTimeout that keeps
// the Node event loop alive past test completion; Discord post-
// gate + auto-post open real webhook connections; blog generator
// writes files. Tests that go through a successful-publish path
// would otherwise run to the 60s file-level timeout.
function stubDownstreamPublisherDeps() {
  stubModule(ENGAGEMENT_RESOLVED, {
    async engageFirstHour() {},
    async engageRecent() {},
    async generatePollComment() {
      return null;
    },
    async pinComment() {
      return null;
    },
  });
  stubModule(BLOG_RESOLVED, {
    async generateAndSaveBlogPost() {},
  });
  stubModule(DISCORD_AUTO_POST_RESOLVED, {
    async postVideoUpload() {
      return null;
    },
    async postStoryPoll() {
      return null;
    },
  });
  stubModule(DISCORD_POST_GATE_RESOLVED, {
    shouldPostVideoDrop: () => false,
    shouldPostStoryPoll: () => false,
    markVideoDropPosted: () => {},
    markStoryPollPosted: () => {},
  });
}

function clearPublisherCache() {
  // Only drop publisher itself. The stubbed modules we install below
  // live in require.cache and are picked up by publisher's top-level
  // requires on the next load — if we delete them here we'd lose the
  // stubs.
  delete require.cache[PUBLISHER_RESOLVED];
}

let dbState;
let uploaderCalls;
let uploadedStories;
let fingerprintCalls;
let governedDispatchCalls;

function withTestPublisherLease(publisher) {
  const liveGuardedEnv = {
    NODE_ENV: "test",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
      TEST_YOUTUBE_OAUTH_CLIENT_SHA256,
  };
  const leases = {
    acquire({ name, ownerId, now, leaseMs, metadata }) {
      return {
        name,
        owner_id: ownerId,
        acquired_at: new Date(now).toISOString(),
        heartbeat_at: new Date(now).toISOString(),
        expires_at: new Date(new Date(now).getTime() + leaseMs).toISOString(),
        metadata: JSON.stringify(metadata),
        fencing_token: 1,
        acquired: true,
      };
    },
    heartbeat() {
      return true;
    },
    release() {
      return true;
    },
  };
  const publicationRepos = {
    db: {
      pragma(statement, options) {
        assert.equal(statement, "data_version");
        assert.deepEqual(options, { simple: true });
        return 1;
      },
    },
    platformPosts: {},
    publicationGovernance: {
      getLatestLifecycleEvent(storyId, platform, toState) {
        assert.equal(platform, "youtube");
        assert.equal(toState, "SCHEDULED");
        return {
          id: 90,
          story_id: storyId,
          platform,
          to_state: "SCHEDULED",
          evidence_json: JSON.stringify({
            dispatch_idempotency_key: `youtube:${storyId}:test-operation`,
            request_fingerprint: "a".repeat(64),
            scheduled_for: "2026-07-27T09:00:00.000Z",
            publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
          }),
        };
      },
      getPublicationAuthorityDecision() {
        return null;
      },
    },
  };
  const governedDispatch = async (input) => {
    governedDispatchCalls.push(input);
    const uploadResult = await input.upload({
      markCreateAttemptStarted() {},
    });
    if (uploadResult?.blocked) {
      return {
        status: "blocked",
        blocked: true,
        reason: uploadResult.reason || "blocked",
      };
    }
    return {
      status: "published",
      published: true,
      externalId: uploadResult.externalId,
      externalUrl: uploadResult.externalUrl,
    };
  };
  function selectDefaultExactStoryId(channelId = "pulse-gaming") {
    const candidates = dbState.stories
      .filter((story) => (story.channel_id || "pulse-gaming") === channelId)
      .filter(
        (story) =>
          story.approved === true &&
          Boolean(story.exported_path) &&
          story.qa_failed !== true &&
          story.publish_status !== "failed" &&
          !story.youtube_post_id,
      )
      .sort(
        (left, right) =>
          (right.breaking_score || right.score || 0) -
          (left.breaking_score || left.score || 0),
      );
    return candidates[0]?.id || dbState.stories[0]?.id || "test-story";
  }
  function buildExactDispatchBinding({ storyId, repos }) {
    let event = null;
    try {
      event =
        repos?.publicationGovernance?.getLatestLifecycleEvent?.(
          storyId,
          "youtube",
          "SCHEDULED",
        ) || null;
    } catch {
      event = null;
    }
    let evidence = {};
    try {
      evidence = JSON.parse(event?.evidence_json || "{}");
    } catch {
      evidence = {};
    }
    let databaseDataVersion = 1;
    try {
      const value = repos?.db?.pragma?.("data_version", { simple: true });
      if (Number.isSafeInteger(value) && value > 0) {
        databaseDataVersion = value;
      }
    } catch {
      // The publisher will exercise the supplied deterministic fallback DB.
    }
    return {
      storyId,
      platform: "youtube",
      scheduledFor:
        evidence.scheduled_for || "2026-07-27T09:00:00.000Z",
      scheduledEventId: event?.id ?? "test-scheduled-event",
      dispatchIdempotencyKey:
        evidence.dispatch_idempotency_key ||
        `youtube:${storyId}:test-operation`,
      requestFingerprint:
        evidence.request_fingerprint || "a".repeat(64),
      databaseDataVersion,
    };
  }
  return {
    ...publisher,
    publishNextStory(options = {}) {
      const { testExactStoryId, ...callerOptions } = options;
      const requestedRepos = callerOptions.repos || publicationRepos;
      const repos =
        typeof requestedRepos?.db?.pragma === "function"
          ? requestedRepos
          : {
              ...requestedRepos,
              db: {
                ...(requestedRepos?.db || {}),
                pragma(statement, pragmaOptions) {
                  assert.equal(statement, "data_version");
                  assert.deepEqual(pragmaOptions, { simple: true });
                  return 1;
                },
              },
            };
      const hasExplicitBinding = Object.prototype.hasOwnProperty.call(
        callerOptions,
        "exactDispatchBinding",
      );
      const exactDispatchBinding = hasExplicitBinding
        ? callerOptions.exactDispatchBinding
        : buildExactDispatchBinding({
            storyId:
              testExactStoryId ||
              selectDefaultExactStoryId(
                callerOptions.channelId ||
                  callerOptions.env?.CHANNEL ||
                  liveGuardedEnv.CHANNEL ||
                  "pulse-gaming",
              ),
            repos,
          });
      return publisher.publishNextStory({
        env: liveGuardedEnv,
        repos,
        governedDispatch,
        async fingerprintPublicationRequest(story, options) {
          fingerprintCalls.push({ story, options });
          return {
            request_fingerprint:
              story.test_request_fingerprint || "a".repeat(64),
            media_sha256: "d".repeat(64),
            script_sha256: "e".repeat(64),
          };
        },
        now: PUBLISH_NOW,
        cadenceEvaluator: () => ({ allowed: true, reason: null }),
        verifyYoutubePublic: async () => {
          throw new Error("test governed dispatcher owns verification");
        },
        ...callerOptions,
        repos,
        exactDispatchBinding,
        leases,
      });
    },
    publishToAllPlatforms(options = {}) {
      return publisher.publishToAllPlatforms({ ...options, leases });
    },
  };
}

function setupMocks({
  autonomousCqa = null,
  cqaResult,
  useRealContentQa = false,
  vqaResult,
  pvqaResult = { result: "pass", failures: [], warnings: [] },
  renderDecisionError = null,
  renderDecisionResult = null,
  persistStory = null,
  stories,
}) {
  dbState = {
    stories: stories.slice(),
    upsertCalls: [],
  };
  uploaderCalls = [];
  uploadedStories = [];
  fingerprintCalls = [];
  governedDispatchCalls = [];

  // Stub notify + sentry so require('./notify') / require('./lib/sentry')
  // at the top of publisher.js doesn't try to hit Discord.
  stubModule(NOTIFY_RESOLVED, async () => {});
  stubModule(SENTRY_RESOLVED, {
    addBreadcrumb: () => {},
    captureException: () => {},
  });

  stubModule(DB_RESOLVED, {
    async getStories() {
      return dbState.stories.slice();
    },
    async upsertStory(story) {
      dbState.upsertCalls.push({ ...story });
      const idx = dbState.stories.findIndex((s) => s.id === story.id);
      if (idx >= 0) dbState.stories[idx] = { ...story };
      else dbState.stories.push({ ...story });
      if (typeof persistStory === "function") {
        await persistStory(story);
      }
    },
    async saveStories(arr) {
      dbState.stories = arr.slice();
    },
  });

  if (useRealContentQa) {
    delete require.cache[CQA_RESOLVED];
  } else {
    stubModule(CQA_RESOLVED, {
      async runContentQa() {
        if (cqaResult instanceof Error) throw cqaResult;
        return cqaResult;
      },
    });
  }
  if (autonomousCqa) {
    stubModule(AUTONOMOUS_CQA_RESOLVED, autonomousCqa);
  } else {
    delete require.cache[AUTONOMOUS_CQA_RESOLVED];
  }
  stubModule(VQA_RESOLVED, {
    async runVideoQa() {
      if (vqaResult instanceof Error) throw vqaResult;
      return vqaResult;
    },
  });
  stubModule(PVQA_RESOLVED, {
    async runPlatformVideoQa() {
      if (pvqaResult instanceof Error) throw pvqaResult;
      return pvqaResult;
    },
  });
  if (renderDecisionError) {
    stubModule(RENDER_DECISION_RESOLVED, {
      async decideForStory() {
        throw renderDecisionError;
      },
    });
  } else if (renderDecisionResult) {
    stubModule(RENDER_DECISION_RESOLVED, {
      async decideForStory() {
        return renderDecisionResult;
      },
    });
  } else {
    delete require.cache[RENDER_DECISION_RESOLVED];
  }

  // Stub publish-block so the SQLite-gated require doesn't throw.
  stubModule(PUBLISH_BLOCK_RESOLVED, {
    recordPlatformBlock: () => ({ persisted: false }),
    getPlatformStatus: () => null,
  });

  stubDownstreamPublisherDeps();

  // Track uploader calls — if QA-fail works, none of these should
  // ever get invoked. We intercept via require.cache of the module
  // paths the publisher imports lazily inside the function body.
  for (const name of [
    "upload_youtube",
    "upload_tiktok",
    "upload_instagram",
    "upload_facebook",
    "upload_twitter",
  ]) {
    const resolved = require.resolve(`../../${name}.js`);
    stubModule(resolved, {
      async uploadShort(story) {
        uploaderCalls.push(name);
        uploadedStories.push(structuredClone(story));
        return { videoId: "should_not_be_called", url: "x" };
      },
      async uploadAll() {
        uploaderCalls.push(name);
        return [];
      },
      async uploadReelViaUrl() {
        uploaderCalls.push(name);
        return { videoId: "x" };
      },
      async uploadStoryImage() {
        uploaderCalls.push(name);
        return { mediaId: "x", storyId: "x" };
      },
      async postImageTweet() {
        uploaderCalls.push(name);
        return { tweetId: "x" };
      },
    });
  }

  clearPublisherCache();
  return withTestPublisherLease(require("../../publisher.js"));
}

// Variant of setupMocks where content-QA returns a per-story result
// keyed by story.id. Used by multi-candidate tests that need "bad
// story fails QA, next story passes" behaviour in a single test run.
function setupMocksPerStory({
  perStoryCqa,
  vqaResult,
  pvqaResult = { result: "pass", failures: [], warnings: [] },
  stories,
}) {
  dbState = {
    stories: stories.slice(),
    upsertCalls: [],
  };
  uploaderCalls = [];
  uploadedStories = [];
  fingerprintCalls = [];
  governedDispatchCalls = [];
  delete require.cache[RENDER_DECISION_RESOLVED];

  stubModule(NOTIFY_RESOLVED, async () => {});
  stubModule(SENTRY_RESOLVED, {
    addBreadcrumb: () => {},
    captureException: () => {},
  });
  stubModule(DB_RESOLVED, {
    async getStories() {
      return dbState.stories.slice();
    },
    async upsertStory(story) {
      dbState.upsertCalls.push({ ...story });
      const idx = dbState.stories.findIndex((s) => s.id === story.id);
      if (idx >= 0) dbState.stories[idx] = { ...story };
      else dbState.stories.push({ ...story });
    },
    async saveStories(arr) {
      dbState.stories = arr.slice();
    },
  });
  stubModule(CQA_RESOLVED, {
    async runContentQa(story) {
      return (
        perStoryCqa[story.id] || {
          result: "pass",
          failures: [],
          warnings: [],
        }
      );
    },
  });
  stubModule(VQA_RESOLVED, {
    async runVideoQa() {
      return vqaResult;
    },
  });
  stubModule(PVQA_RESOLVED, {
    async runPlatformVideoQa() {
      return pvqaResult;
    },
  });
  stubModule(PUBLISH_BLOCK_RESOLVED, {
    recordPlatformBlock: () => ({ persisted: false }),
    getPlatformStatus: () => null,
  });

  for (const name of [
    "upload_youtube",
    "upload_tiktok",
    "upload_instagram",
    "upload_facebook",
    "upload_twitter",
  ]) {
    const resolved = require.resolve(`../../${name}.js`);
    stubModule(resolved, {
      async uploadShort(story) {
        uploaderCalls.push(name);
        uploadedStories.push(structuredClone(story));
        return { videoId: "should_not_be_called", url: "x" };
      },
      async uploadAll() {
        uploaderCalls.push(name);
        return [];
      },
      async uploadReelViaUrl() {
        uploaderCalls.push(name);
        return { videoId: "x" };
      },
      async uploadStoryImage() {
        uploaderCalls.push(name);
        return { mediaId: "x", storyId: "x" };
      },
      async postImageTweet() {
        uploaderCalls.push(name);
        return { tweetId: "x" };
      },
    });
  }

  clearPublisherCache();
  return withTestPublisherLease(require("../../publisher.js"));
}

beforeEach(() => {
  delete process.env.USE_SQLITE;
  delete process.env.USE_CANONICAL_DEDUPE;
});

afterEach(() => {
  clearPublisherCache();
  delete require.cache[RENDER_DECISION_RESOLVED];
  delete require.cache[AUTONOMOUS_CQA_RESOLVED];
});

test("publishNextStory: content-QA fail persists qa_failed=true + publish_status=failed + publish_error", async () => {
  const story = {
    id: "rss_qa_fail_content",
    title: "Broken content story",
    approved: true,
    exported_path: "/tmp/broken.mp4",
    full_script: "too short", // any content — QA stub decides
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_too_short (12 words, min 80)"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  // Single-candidate QA fail now returns the multi-candidate
  // "no safe candidate" shape (qa_skipped_count=1) because the
  // publisher exhausted its cap without finding a clean story.
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.strictEqual(result.candidates_tried, 1);
  assert.match(result.top_reason, /^content_qa:/);
  assert.strictEqual(result.qa_skipped.length, 1);
  assert.strictEqual(result.qa_skipped[0].source, "content");

  // State was persisted via db.upsertStory at least once.
  assert.ok(
    dbState.upsertCalls.length >= 1,
    "db.upsertStory must be called on QA fail",
  );
  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(
    persisted.qa_failed,
    true,
    "persisted qa_failed must be true",
  );
  assert.strictEqual(
    persisted.publish_status,
    "failed",
    "persisted publish_status must be 'failed'",
  );
  assert.match(
    persisted.publish_error || "",
    /^qa_blocked:/,
    "persisted publish_error must start with 'qa_blocked:'",
  );
  assert.ok(persisted.qa_failed_at, "qa_failed_at timestamp must be set");
  assert.deepStrictEqual(persisted.qa_failures, [
    "script_too_short (12 words, min 80)",
  ]);

  // No uploader called — QA short-circuit must happen before
  // any platform attempt.
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after content-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

test("publishNextStory: LOCAL_PROOF fails closed before candidate selection or upload", async () => {
  const story = {
    id: "rss_local_proof_block",
    title: "Must not leave local proof",
    approved: true,
    exported_path: "/tmp/never-upload.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "live_guarded_mode_required");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: unbound LIVE_GUARDED dispatch fails closed before uploader or create boundary", async () => {
  const story = {
    id: "rss_unbound_live_guarded",
    title: "An unbound caller must never select this story",
    approved: true,
    exported_path: "/tmp/unbound-live-guarded.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({ exactDispatchBinding: null });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "guarded_exact_dispatch_binding_required");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: incomplete LIVE_GUARDED binding fails closed before uploader or create boundary", async () => {
  const story = {
    id: "rss_incomplete_live_guarded",
    title: "An incomplete authority must never select this story",
    approved: true,
    exported_path: "/tmp/incomplete-live-guarded.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "guarded_exact_dispatch_binding_invalid");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: cadence is rechecked inside the durable publisher lease", async () => {
  const story = {
    id: "rss_cadence_block",
    title: "Must wait for the next guarded window",
    approved: true,
    exported_path: "/tmp/cadence-block.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    cadenceEvaluator: ({ excludeJobId }) => {
      assert.equal(excludeJobId, 73);
      return {
        allowed: false,
        reason: "stabilisation_minimum_publish_gap",
        recent_count: 1,
      };
    },
    currentJobId: 73,
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "stabilisation_minimum_publish_gap");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: stabilisation dispatch attempts YouTube only", async () => {
  const story = {
    id: "rss_youtube_only",
    title: "One controlled platform",
    approved: true,
    exported_path: "/tmp/youtube-only.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(
    governedDispatchCalls[0].idempotencyKey,
    "youtube:rss_youtube_only:test-operation",
  );
  assert.equal(governedDispatchCalls[0].requestFingerprint, "a".repeat(64));
  assert.equal(governedDispatchCalls[0].platform, "youtube");
  assert.equal(result.platform_outcomes.youtube, "new_upload");
  for (const platform of [
    "tiktok",
    "instagram",
    "facebook",
    "twitter",
    "facebook_card",
    "instagram_story",
    "twitter_image",
  ]) {
    assert.equal(
      result.platform_outcomes[platform],
      "operator_disabled",
      platform,
    );
  }
  const persisted = dbState.stories.find(
    (entry) => entry.id === story.id,
  );
  assert.equal(persisted.publish_status, "published");
  assert.ok(persisted.youtube_post_id);
  assert.equal(persisted.tiktok_post_id, undefined);
});

test("publishNextStory: exact binding cannot be displaced by a higher-score concurrently scheduled story", async () => {
  const target = {
    id: "rss_exact_target",
    title: "Exact guarded target",
    approved: true,
    exported_path: "/tmp/exact-target.mp4",
    breaking_score: 1,
  };
  const concurrent = {
    id: "rss_concurrent_higher_score",
    title: "Concurrent higher score",
    approved: true,
    exported_path: "/tmp/concurrent.mp4",
    breaking_score: 999,
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [concurrent, target],
  });

  const result = await publishNextStory({
    exactDispatchBinding: {
      storyId: target.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${target.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion: 1,
    },
  });

  assert.equal(result.story_id, target.id);
  assert.equal(uploadedStories.length, 1);
  assert.equal(uploadedStories[0].id, target.id);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, target.id);
  assert.equal(
    dbState.stories.find((story) => story.id === concurrent.id)
      .youtube_post_id,
    undefined,
  );
});

test("publishNextStory: exact binding is re-enforced against the persisted scheduled event", async () => {
  const story = {
    id: "rss_exact_event_mismatch",
    title: "Changed scheduled ticket",
    approved: true,
    exported_path: "/tmp/event-mismatch.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 91,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion: 1,
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(
    result.top_reason,
    "guarded_exact_dispatch_event_mismatch",
  );
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: scheduled ticket drift during request fingerprinting blocks before governed dispatch", async () => {
  const story = {
    id: "rss_ticket_drifts_during_fingerprint",
    title: "Changed ticket during fingerprint",
    approved: true,
    exported_path: "/tmp/ticket-drift.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });
  let changed = false;
  const publicationGovernance = {
    getLatestLifecycleEvent(storyId, platform, toState) {
      assert.equal(storyId, story.id);
      assert.equal(platform, "youtube");
      assert.equal(toState, "SCHEDULED");
      const suffix = changed ? "changed" : "test-operation";
      return {
        id: changed ? 91 : 90,
        story_id: storyId,
        platform,
        to_state: "SCHEDULED",
        evidence_json: JSON.stringify({
          dispatch_idempotency_key:
            `youtube:${storyId}:${suffix}`,
          request_fingerprint: changed
            ? "b".repeat(64)
            : "a".repeat(64),
          scheduled_for: "2026-07-27T09:00:00.000Z",
          publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
        }),
      };
    },
  };
  const repos = {
    db: {
      pragma() {
        return 1;
      },
    },
    platformPosts: {},
    publicationGovernance,
  };

  const result = await publishNextStory({
    repos,
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion: 1,
    },
    async fingerprintPublicationRequest() {
      changed = true;
      return {
        request_fingerprint: "a".repeat(64),
        media_sha256: "d".repeat(64),
        script_sha256: "e".repeat(64),
      };
    },
  });

  assert.equal(
    result.errors.youtube,
    "scheduled_dispatch_ticket_changed_before_dispatch",
  );
  assert.deepEqual(governedDispatchCalls, []);
  assert.deepEqual(uploaderCalls, []);
});

test("publishNextStory: a fresh trusted boundary clock blocks create after the window expires", async () => {
  const story = {
    id: "rss_window_expires_before_create",
    title: "Window expires during preflight",
    approved: true,
    exported_path: "/tmp/window-expiry.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });
  let clockCalls = 0;
  const times = [
    "2026-07-27T09:05:00.000Z",
    "2026-07-27T09:05:00.000Z",
    "2026-07-27T09:16:00.000Z",
  ];
  let createAttempts = 0;
  stubModule(require.resolve("../../upload_youtube.js"), {
    async uploadShort(_story, options = {}) {
      assert.equal(
        typeof options.assertYoutubeCreateBoundary,
        "function",
      );
      await options.assertYoutubeCreateBoundary();
      createAttempts += 1;
      return {
        videoId: "must-not-be-created",
        url: "https://youtu.be/must-not-be-created",
      };
    },
  });

  const result = await publishNextStory({
    now() {
      const value = times[Math.min(clockCalls, times.length - 1)];
      clockCalls += 1;
      return new Date(value);
    },
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion: 1,
    },
  });

  assert.equal(createAttempts, 0);
  assert.ok(clockCalls >= 3);
  assert.equal(result.platform_outcomes.youtube, "governance_blocked");
  assert.equal(
    result.errors.youtube,
    "scheduled_dispatch_window_expired",
  );
});

test("publishNextStory: a separate SQLite connection commit is rejected at the authenticated create boundary", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publisher-data-version-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const primary = new Database(databasePath);
  primary.exec(
    `CREATE TABLE external_writes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       value TEXT NOT NULL
     )`,
  );
  const writer = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    writer.close();
    primary.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const story = {
    id: "rss_external_database_race",
    title: "External database race",
    approved: true,
    exported_path: "/tmp/external-database-race.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });
  const publicationGovernance = {
    getLatestLifecycleEvent(storyId, platform, toState) {
      assert.equal(platform, "youtube");
      assert.equal(toState, "SCHEDULED");
      return {
        id: 90,
        story_id: storyId,
        platform,
        to_state: "SCHEDULED",
        evidence_json: JSON.stringify({
          dispatch_idempotency_key:
            `youtube:${storyId}:test-operation`,
          request_fingerprint: "a".repeat(64),
          scheduled_for: "2026-07-27T09:00:00.000Z",
          publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
        }),
      };
    },
  };
  let createAttempts = 0;
  stubModule(require.resolve("../../upload_youtube.js"), {
    async uploadShort(_story, options = {}) {
      writer
        .prepare(
          "INSERT INTO external_writes (value) VALUES ('racing-commit')",
        )
        .run();
      await options.assertYoutubeCreateBoundary();
      createAttempts += 1;
      return {
        videoId: "must-not-be-created",
        url: "https://youtu.be/must-not-be-created",
      };
    },
  });
  const databaseDataVersion = primary.pragma("data_version", {
    simple: true,
  });

  const result = await publishNextStory({
    repos: {
      db: primary,
      platformPosts: {},
      publicationGovernance,
    },
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion,
    },
  });

  assert.equal(createAttempts, 0);
  assert.equal(result.platform_outcomes.youtube, "governance_blocked");
  assert.equal(
    result.errors.youtube,
    "guarded_database_data_version_changed_before_create",
  );
});

test("publishNextStory: its own persistence does not invalidate the guarded database version before create", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publisher-self-write-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const primary = new Database(databasePath);
  primary.exec(
    `CREATE TABLE publisher_writes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       story_id TEXT NOT NULL,
       publish_status TEXT
     )`,
  );
  const legacyWriter = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    legacyWriter.close();
    primary.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const story = {
    id: "rss_guarded_publisher_self_write",
    title: "Guarded publisher self write",
    approved: true,
    exported_path: "/tmp/guarded-publisher-self-write.mp4",
  };
  const persistedStories = [];
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
    persistStory(value) {
      persistedStories.push(structuredClone(value));
      legacyWriter
        .prepare(
          `INSERT INTO publisher_writes (story_id, publish_status)
           VALUES (?, ?)`,
        )
        .run(value.id, value.publish_status || null);
    },
  });
  const publicationGovernance = {
    getLatestLifecycleEvent(storyId, platform, toState) {
      assert.equal(platform, "youtube");
      assert.equal(toState, "SCHEDULED");
      return {
        id: 90,
        story_id: storyId,
        platform,
        to_state: "SCHEDULED",
        evidence_json: JSON.stringify({
          dispatch_idempotency_key:
            `youtube:${storyId}:test-operation`,
          request_fingerprint: "a".repeat(64),
          scheduled_for: "2026-07-27T09:00:00.000Z",
          publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
        }),
      };
    },
  };
  let createAttempts = 0;
  stubModule(require.resolve("../../upload_youtube.js"), {
    async uploadShort(_story, options = {}) {
      assert.equal(
        options.expectedMediaSha256,
        "d".repeat(64),
        "the uploader must receive the freshly fingerprinted media SHA, not a missing field from immutable publication evidence",
      );
      await options.assertYoutubeCreateBoundary();
      createAttempts += 1;
      return {
        videoId: "guarded-self-write-created",
        url: "https://youtu.be/guarded-self-write-created",
      };
    },
  });
  const databaseDataVersion = primary.pragma("data_version", {
    simple: true,
  });

  const result = await publishNextStory({
    repos: {
      db: primary,
      platformPosts: {},
      publicationGovernance,
    },
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion,
    },
  });

  assert.equal(createAttempts, 1);
  assert.equal(result.platform_outcomes.youtube, "new_upload");
  assert.equal(result.youtube, true);
  assert.equal(persistedStories.length, 1);
  assert.equal(persistedStories[0].render_contract_blocked, false);
  assert.ok(persistedStories[0].render_contract_class);
  assert.equal(
    persistedStories[0].youtube_post_id,
    "guarded-self-write-created",
  );
  assert.equal(
    legacyWriter
      .prepare("SELECT COUNT(*) FROM publisher_writes")
      .pluck()
      .get(),
    1,
    "only post-create outcome persistence should use the legacy writer",
  );
});

test("publishNextStory: a post-guard external commit is rejected at publisher entry", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publisher-entry-data-version-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const primary = new Database(databasePath);
  primary.exec(
    `CREATE TABLE external_writes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       value TEXT NOT NULL
     )`,
  );
  const writer = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    writer.close();
    primary.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const databaseDataVersion = primary.pragma("data_version", {
    simple: true,
  });
  writer
    .prepare(
      "INSERT INTO external_writes (value) VALUES ('after-guard')",
    )
    .run();
  const story = {
    id: "rss_publisher_entry_database_race",
    title: "Publisher entry database race",
    approved: true,
    exported_path: "/tmp/publisher-entry-database-race.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    repos: {
      db: primary,
      platformPosts: {},
      publicationGovernance: {},
    },
    exactDispatchBinding: {
      storyId: story.id,
      platform: "youtube",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      scheduledEventId: 90,
      dispatchIdempotencyKey:
        `youtube:${story.id}:test-operation`,
      requestFingerprint: "a".repeat(64),
      databaseDataVersion,
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(
    result.top_reason,
    "guarded_database_data_version_changed_before_publisher_entry",
  );
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: production ignores a caller-supplied clock", async () => {
  const story = {
    id: "rss_forged_production_clock",
    title: "Forged clock cannot open a window",
    approved: true,
    exported_path: "/tmp/forged-clock.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });
  let forgedClockCalls = 0;

  await publishNextStory({
    env: {
      NODE_ENV: "production",
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "false",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
        TEST_YOUTUBE_OAUTH_CLIENT_SHA256,
    },
    now() {
      forgedClockCalls += 1;
      return new Date("2026-07-27T09:05:00.000Z");
    },
  });

  assert.equal(forgedClockCalls, 0);
});

test("publishNextStory: dispatch fingerprints and uploads the immutable scheduled disclosure decision", async () => {
  const story = {
    id: "rss_reviewed_disclosure",
    title: "The reviewed disclosure cannot drift",
    approved: true,
    exported_path: "/tmp/reviewed-disclosure.mp4",
    synthetic_media_disclosure: {
      contains_synthetic_media: false,
      decision: "NO_DISCLOSURE_REQUIRED",
      rationale: "This mutable row value was not the reviewed decision.",
    },
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  assert.equal(result.platform_outcomes.youtube, "new_upload");
  assert.equal(fingerprintCalls.length, 1);
  assert.deepEqual(
    fingerprintCalls[0].options.publicationEvidence,
    SCHEDULED_PUBLICATION_EVIDENCE,
  );
  assert.equal(uploadedStories.length, 1);
  assert.deepEqual(
    uploadedStories[0].synthetic_media_disclosure,
    SCHEDULED_PUBLICATION_EVIDENCE.synthetic_media_disclosure,
  );
  assert.equal(
    uploadedStories[0].governed_publication_metadata_sha256,
    SCHEDULED_PUBLICATION_EVIDENCE.publication_metadata_sha256,
  );
  assert.deepEqual(
    uploadedStories[0].governed_publication_metadata,
    SCHEDULED_PUBLICATION_EVIDENCE.publication_metadata,
  );
});

test("publishNextStory: YouTube failure telemetry survives while secrets are scrubbed before logs, story persistence and result", async () => {
  const story = {
    id: "rss_safe_youtube_failure",
    title: "Sanitised YouTube failure",
    approved: true,
    exported_path: "/tmp/safe-youtube-failure.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });
  const secret = "bearer-secret-value";
  const refreshSecret = "refresh-secret-value";
  stubModule(require.resolve("../../upload_youtube.js"), {
    async uploadShort(_story, options = {}) {
      options.reportAuthTelemetry({
        schema_version: "pulse-youtube-auth-telemetry-v1",
        durable_oauth_or_token_mutated: false,
        ephemeral_access_token_refresh: {
          attempted: true,
          succeeded: false,
          failed: true,
        },
      });
      throw new Error(
        `Bearer ${secret} rejected refresh_token=${refreshSecret}`,
      );
    },
  });
  const observedTelemetry = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => logs.push(values.join(" "));
  let result;
  try {
    result = await publishNextStory({
      onYoutubeAuthTelemetry(value) {
        observedTelemetry.push(value);
      },
    });
  } finally {
    console.log = originalLog;
  }

  const persisted = dbState.stories.find((row) => row.id === story.id);
  const serialised = JSON.stringify({
    logs,
    persisted,
    result,
    observedTelemetry,
  });
  assert.equal(serialised.includes(secret), false);
  assert.equal(serialised.includes(refreshSecret), false);
  assert.match(result.errors.youtube, /\[REDACTED\]/);
  assert.equal(result.platform_outcomes.youtube, "failed");
  assert.deepEqual(result.safety.youtube_auth, {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: true,
      succeeded: false,
      failed: true,
    },
  });
  assert.deepEqual(observedTelemetry.at(-1), result.safety.youtube_auth);
  assert.equal(persisted.youtube_error, result.errors.youtube);
});

test("publishNextStory: dispatches an exact persisted one-shot outside-cadence admission", async (t) => {
  const persisted = await persistedOutsideCadenceAdmission(t);
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [persisted.story],
  });

  const result = await publishNextStory({
    repos: {
      db: persisted.db,
      platformPosts: {},
      publicationGovernance:
        persisted.repos.publicationGovernance,
    },
    now: new Date("2026-07-27T10:00:30.000Z"),
    channel: persisted.channel,
    async fingerprintPublicationRequest(story, options) {
      return fingerprintPublicationRequest(story, {
        ...options,
        channel: persisted.channel,
        resolveMediaPath: async (storedPath) => storedPath,
      });
    },
  });

  assert.equal(result.youtube, true);
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(
    governedDispatchCalls[0].idempotencyKey,
    persisted.admission.dispatch_idempotency_key,
  );
  assert.equal(
    governedDispatchCalls[0].requestFingerprint,
    persisted.admission.request_fingerprint,
  );
});

test("publishNextStory: an outside-cadence row without its exact immutable authorisation remains held", async (t) => {
  const persisted = await persistedOutsideCadenceAdmission(t);
  const actualGovernance = persisted.repos.publicationGovernance;
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [persisted.story],
  });

  const result = await publishNextStory({
    repos: {
      db: persisted.db,
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent(...args) {
          const event =
            actualGovernance.getLatestLifecycleEvent(...args);
          const evidence = JSON.parse(event.evidence_json);
          delete evidence.outside_cadence_authorisation;
          return {
            ...event,
            evidence_json: JSON.stringify(evidence),
          };
        },
      },
    },
    now: new Date("2026-07-27T10:00:30.000Z"),
    channel: persisted.channel,
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(
    result.top_reason,
    "scheduled_outside_cadence_authorisation_required",
  );
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: changed content is blocked when its current fingerprint differs from admission", async () => {
  const story = {
    id: "rss_changed_after_admission",
    title: "Changed after the operator approved it",
    approved: true,
    exported_path: "/tmp/changed-after-admission.mp4",
    test_request_fingerprint: "f".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.equal(
    result.errors.youtube,
    "scheduled_request_fingerprint_mismatch",
  );
  assert.equal(
    result.platform_outcomes.youtube,
    "governance_blocked",
  );
});

test("publishNextStory: missing scheduled governance evidence blocks before uploader", async () => {
  const story = {
    id: "rss_unscheduled",
    title: "Not yet scheduled",
    approved: true,
    exported_path: "/tmp/unscheduled.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return null;
        },
      },
    },
  });

  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "scheduled_dispatch_evidence_required");
  assert.equal(result.governance_skipped_count, 1);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: legacy schedule without immutable publication evidence is held", async () => {
  const story = {
    id: "rss_schedule_without_review_bundle",
    title: "Old schedule lacks reviewed evidence",
    approved: true,
    exported_path: "/tmp/old-schedule.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return {
            story_id: story.id,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_schedule_without_review_bundle:test-operation",
              request_fingerprint: "a".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
            }),
          };
        },
      },
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "scheduled_publication_evidence_required");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: scheduled evidence without exact approved metadata is held before uploader", async () => {
  const story = {
    id: "rss_schedule_without_approved_metadata",
    title: "Schedule has no approved public metadata",
    approved: true,
    exported_path: "/tmp/schedule-without-approved-metadata.mp4",
  };
  const publicationEvidence = structuredClone(
    SCHEDULED_PUBLICATION_EVIDENCE,
  );
  delete publicationEvidence.publication_metadata_sha256;
  delete publicationEvidence.publication_metadata;
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return {
            id: 20,
            story_id: story.id,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_schedule_without_approved_metadata:test-operation",
              request_fingerprint: "a".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
              publication_evidence: publicationEvidence,
            }),
          };
        },
      },
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(
    result.top_reason,
    "scheduled_publication_metadata_sha256_required",
  );
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: an expired admission ticket cannot catch up in a later window", async () => {
  const story = {
    id: "rss_expired_schedule",
    title: "Missed window must remain held",
    approved: true,
    exported_path: "/tmp/expired-schedule.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    now: new Date("2026-07-27T19:00:00.000Z"),
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return {
            id: 21,
            story_id: story.id,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_expired_schedule:2026-07-27T09:00:00.000Z",
              request_fingerprint: "a".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
              publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
            }),
          };
        },
      },
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "scheduled_dispatch_window_expired");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: skips an unscheduled high-score story and dispatches the scheduled candidate", async () => {
  const unscheduled = {
    id: "rss_unscheduled_first",
    title: "High score but not approved for this window",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/unscheduled-first.mp4",
  };
  const scheduled = {
    id: "rss_scheduled_second",
    title: "Human-approved scheduled candidate",
    approved: true,
    breaking_score: 50,
    exported_path: "/tmp/scheduled-second.mp4",
    test_request_fingerprint: "b".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [unscheduled, scheduled],
  });

  const result = await publishNextStory({
    testExactStoryId: scheduled.id,
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent(storyId) {
          if (storyId !== scheduled.id) return null;
          return {
            id: 22,
            story_id: storyId,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_scheduled_second:test-operation",
              request_fingerprint: "b".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
              publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
            }),
          };
        },
      },
    },
  });

  assert.equal(result.title, scheduled.title);
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, scheduled.id);
  assert.equal(governedDispatchCalls[0].requestFingerprint, "b".repeat(64));
});

test("publishNextStory: authenticated Pulse dispatch ignores a higher-scored story from another channel", async () => {
  const stacked = {
    id: "stacked_higher_score",
    channel_id: "stacked",
    title: "Finance story must not use the Pulse credential",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/stacked-higher-score.mp4",
  };
  const pulse = {
    id: "pulse_lower_score",
    channel_id: "pulse-gaming",
    title: "Pulse story bound to the authenticated channel",
    approved: true,
    breaking_score: 20,
    exported_path: "/tmp/pulse-lower-score.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [stacked, pulse],
  });

  const result = await publishNextStory();

  assert.equal(result.title, pulse.title);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, pulse.id);
  assert.equal(governedDispatchCalls[0].channelId, "pulse-gaming");
});

test("publishNextStory: requested channel must match the authenticated YouTube channel", async () => {
  const story = {
    id: "stacked_wrong_credential",
    channel_id: "stacked",
    title: "Must not cross the authenticated channel boundary",
    approved: true,
    exported_path: "/tmp/stacked-wrong-credential.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    channelId: "stacked",
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "youtube_authenticated_channel_mismatch");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: title dedupe is recorded through the governed pre-create boundary", async () => {
  const prior = {
    id: "rss_prior_title",
    title: "Four Xbox classics arrive on PC",
    approved: true,
    exported_path: "/tmp/prior.mp4",
    youtube_post_id: "yt-prior",
  };
  const candidate = {
    id: "rss_title_duplicate",
    title: "Four Xbox classics arrive on PC today",
    approved: true,
    exported_path: "/tmp/title-duplicate.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [prior, candidate],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, []);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, candidate.id);
  assert.equal(result.platform_outcomes.youtube, "duplicate_blocked");
  assert.match(result.errors.youtube, /^dupe-blocked: title-skip:/);
});

test("publishNextStory: a canonically blocked row cannot starve the next scheduled candidate", async () => {
  const blocked = {
    id: "rss_blocked_first",
    title: "Previously blocked operation",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/blocked-first.mp4",
  };
  const eligible = {
    id: "rss_eligible_second",
    title: "Next safe operation",
    approved: true,
    breaking_score: 50,
    exported_path: "/tmp/eligible-second.mp4",
    test_request_fingerprint: "c".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [blocked, eligible],
  });
  const result = await publishNextStory({
    testExactStoryId: eligible.id,
    repos: {
      db: {},
      platformPosts: {
        getByStoryPlatform(storyId) {
          return storyId === blocked.id
            ? {
                story_id: storyId,
                platform: "youtube",
                status: "blocked",
                block_reason: "prior governed block",
              }
            : null;
        },
      },
      publicationGovernance: {
        getLatestLifecycleEvent(storyId) {
          return {
            id: storyId === blocked.id ? 31 : 32,
            story_id: storyId,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                `youtube:${storyId}:test-operation`,
              request_fingerprint: "c".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
              publication_evidence: SCHEDULED_PUBLICATION_EVIDENCE,
            }),
          };
        },
      },
    },
  });

  assert.equal(result.title, eligible.title);
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, eligible.id);
});

test("publishNextStory: video-QA fail persists qa_failed=true + publish_status=failed + no uploaders fire", async () => {
  const story = {
    id: "rss_qa_fail_video",
    title: "Broken video story",
    approved: true,
    exported_path: "/tmp/broken.mp4",
    full_script:
      "A fully-formed script that passes content-QA fine. It has plenty of words and no banned phrases. " +
      "The producer generated it correctly. It's the mp4 itself that turned out broken — long black " +
      "segment at the start, or duration way off. Video-QA catches that. " +
      "That's what this test is exercising. More filler to keep the word count up because the " +
      "content QA stub passes unconditionally here anyway.",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: {
      result: "fail",
      failures: ["long_black_segment: 4.2s"],
      warnings: [],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.match(result.top_reason, /^video_qa:/);
  assert.strictEqual(result.qa_skipped[0].source, "video");

  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(persisted.qa_failed, true);
  assert.strictEqual(persisted.publish_status, "failed");
  assert.match(persisted.publish_error || "", /^qa_blocked:/);
  assert.deepStrictEqual(persisted.qa_failures, ["long_black_segment: 4.2s"]);
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after video-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

test("publishNextStory: platform-video-QA fail persists before any uploader fires", async () => {
  const story = {
    id: "rss_qa_fail_platform_video",
    title: "Bad MP4 metadata",
    approved: true,
    exported_path: "/tmp/bad-meta.mp4",
    full_script:
      "A healthy script and duration should still be refused if the MP4 stream metadata is not safe for social platforms. " +
      "This protects Meta uploads from old chroma or profile renders that would otherwise fail only after the platform accepts the file.",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    pvqaResult: {
      result: "fail",
      failures: ["video_pixel_format_not_yuv420p (yuv444p)"],
      warnings: [],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.match(result.top_reason, /^platform_video_qa:/);
  assert.strictEqual(result.qa_skipped[0].source, "platform_video");

  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(persisted.qa_failed, true);
  assert.strictEqual(persisted.publish_status, "failed");
  assert.deepStrictEqual(persisted.qa_failures, [
    "video_pixel_format_not_yuv420p (yuv444p)",
  ]);
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after platform-video-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

test("publishNextStory: unavailable QA systems fail closed before any uploader fires", async () => {
  const scenarios = [
    {
      label: "content",
      cqaResult: new Error("content QA crashed"),
      vqaResult: { result: "pass", failures: [], warnings: [] },
      pvqaResult: { result: "pass", failures: [], warnings: [] },
      topReason: "content_qa: content_qa_unavailable",
    },
    {
      label: "video",
      cqaResult: { result: "pass", failures: [], warnings: [] },
      vqaResult: new Error("video QA crashed"),
      pvqaResult: { result: "pass", failures: [], warnings: [] },
      topReason: "video_qa: video_qa_unavailable",
    },
    {
      label: "platform-video",
      cqaResult: { result: "pass", failures: [], warnings: [] },
      vqaResult: { result: "pass", failures: [], warnings: [] },
      pvqaResult: new Error("platform video QA crashed"),
      topReason: "platform_video_qa: platform_video_qa_unavailable",
    },
  ];

  for (const scenario of scenarios) {
    const story = {
      id: `rss_qa_unavailable_${scenario.label}`,
      title: `QA unavailable ${scenario.label}`,
      approved: true,
      exported_path: `/tmp/${scenario.label}.mp4`,
    };
    const { publishNextStory } = setupMocks({
      cqaResult: scenario.cqaResult,
      vqaResult: scenario.vqaResult,
      pvqaResult: scenario.pvqaResult,
      stories: [story],
    });

    const result = await publishNextStory();
    assert.strictEqual(result.no_safe_candidate, true, scenario.label);
    assert.strictEqual(result.top_reason, scenario.topReason, scenario.label);
    assert.deepStrictEqual(uploaderCalls, [], scenario.label);
    const persisted = dbState.stories.find((row) => row.id === story.id);
    assert.strictEqual(persisted.qa_failed, true, scenario.label);
    assert.strictEqual(persisted.publish_status, "failed", scenario.label);
  }
});

test("publishNextStory: unavailable render contract fails closed and preserves the YouTube-only freeze", async () => {
  const story = {
    id: "rss_render_contract_unavailable",
    title: "Render contract unavailable",
    approved: true,
    exported_path: "/tmp/render-contract.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    pvqaResult: { result: "pass", failures: [], warnings: [] },
    renderDecisionError: new Error("render contract crashed"),
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.publish_scope, "stabilisation_youtube_only");
  assert.strictEqual(
    result.platform_outcomes.youtube,
    "governance_blocked",
  );
  assert.strictEqual(result.platform_outcomes.tiktok, "operator_disabled");
  assert.strictEqual(result.platform_outcomes.instagram, "operator_disabled");
  assert.strictEqual(result.platform_outcomes.facebook, "operator_disabled");
  assert.strictEqual(
    result.errors.contract,
    "render_contract_evaluation_unavailable",
  );
  assert.deepStrictEqual(uploaderCalls, []);
  const persisted = dbState.stories.find((row) => row.id === story.id);
  assert.strictEqual(persisted.render_contract_blocked, true);
  assert.strictEqual(persisted.publish_status, "held");
});

// ---------- exact guarded candidate tests ----------
//
// LIVE_GUARDED dispatch carries one immutable story authority. A QA failure
// must stop that operation and must never fall through to another story.

function buildGovernedReviewedShort({
  storyId = "official_governed_reviewed_short",
  mediaPath,
  mediaSha256,
  fullScript,
  scriptSha256,
}) {
  const rendererManifestSha256 = "4".repeat(64);
  return {
    id: storyId,
    title: "Final Fantasy XIV's New Tank Uses TWO Giant Shields",
    channel_id: "pulse-gaming",
    approved: true,
    auto_approved: false,
    full_script: fullScript,
    exported_path: mediaPath,
    render_engine: "studio-v21",
    render_review_status: "approved",
    operator_review_status: "script_approved",
    script_sha256: scriptSha256,
    script_approved_sha256: scriptSha256,
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_short_25_32",
    hook_type: "direct",
    preflight_evidence: {
      schema_version: "pulse-publication-review-evidence-v1",
      story_id: storyId,
      channel_id: "pulse-gaming",
      source_evidence_sha256: "1".repeat(64),
      qa_report_sha256: "2".repeat(64),
      rights_ledger_sha256: "3".repeat(64),
      renderer_manifest_sha256: rendererManifestSha256,
      publication_metadata_sha256: "6".repeat(64),
      media_sha256: mediaSha256,
      script_sha256: scriptSha256,
      artifact_evidence: {
        final_mp4_exists: true,
        narration_audio_exists: true,
        word_timestamps_exist: true,
        motion_materialised: true,
        hashes_verified: true,
      },
      renderer_manifest: {
        schema_version: "pulse-render-manifest-v1",
        story_id: storyId,
        channel_id: "pulse-gaming",
        renderer: {
          id: "studio-v21",
          role: "standard",
          version: "2.1.0",
        },
        output: {
          sha256: mediaSha256,
          duration_seconds: 25,
          platform_video_qa_result: "pass",
        },
      },
    },
    final_publication_review: {
      schema_version: "pulse-final-publication-review-v1",
      story_id: storyId,
      channel_id: "pulse-gaming",
      review_manifest_sha256: "b".repeat(64),
      script_sha256: scriptSha256,
      media_sha256: mediaSha256,
      qa_report: {
        sha256: "2".repeat(64),
        verdict: "PASS",
      },
      renderer_manifest: {
        canonical_sha256: rendererManifestSha256,
        verdict: "PASS",
        publishable_under_human_review: true,
      },
      final_mp4: {
        path: mediaPath,
        sha256: mediaSha256,
      },
      reviewed_by: "user:MORR",
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
}

function createGovernedReviewedShortFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-reviewed-content-qa-"),
  );
  const mediaPath = path.join(directory, "official_studio-v21.mp4");
  const mediaBytes = Buffer.alloc(220 * 1024, 0x5a);
  fs.writeFileSync(mediaPath, mediaBytes);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const fullScript =
    "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode. The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid. The MMO hits Switch 2 on August fourth.";
  assert.equal(fullScript.trim().split(/\s+/).length, 47);
  const scriptSha256 = sha256(Buffer.from(fullScript));
  const mediaSha256 = sha256(mediaBytes);
  return {
    fullScript,
    mediaPath,
    mediaSha256,
    scriptSha256,
    story: buildGovernedReviewedShort({
      mediaPath,
      mediaSha256,
      fullScript,
      scriptSha256,
    }),
  };
}

test("exact autonomous candidate: only the hash-bound visual-policy content exception is reconciled", async (t) => {
  async function runScenario(
    child,
    {
      vqaResult,
      pvqaResult,
      expectedSource,
      expectedFailure,
    },
  ) {
    const story = {
      id: `autonomous_content_qa_${expectedSource}`,
      title: "Exact autonomous official-source candidate",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      approved: true,
      auto_approved: true,
      exported_path: "/tmp/autonomous-governed.mp4",
      autonomous_publication_approval: {
        approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      },
    };
    const authority = Object.freeze({
      type: "test-autonomous-content-qa-authority",
    });
    let resolveCalls = 0;
    let reconcileCalls = 0;
    const autonomousCqa = {
      hasGovernedAutonomousContentQaEvidence(candidate, scheduled) {
        assert.equal(candidate, story);
        assert.equal(scheduled.event.id, 90);
        return true;
      },
      async resolveGovernedAutonomousContentQaAuthority(input) {
        resolveCalls += 1;
        assert.equal(input.story, story);
        assert.equal(input.scheduledDispatch.event.id, 90);
        assert.equal(input.exactDispatchBinding.storyId, story.id);
        assert.equal(
          typeof input.publicationGovernance
            .getLatestLifecycleEvent,
          "function",
        );
        assert.equal(
          typeof input.publicationGovernance
            .getPublicationAuthorityDecision,
          "function",
        );
        return authority;
      },
      reconcileGovernedAutonomousContentQa(result, suppliedAuthority) {
        reconcileCalls += 1;
        assert.equal(suppliedAuthority, authority);
        assert.deepEqual(result.failures, [
          "human_visual_review_required:studio-v21",
        ]);
        return {
          result: "warn",
          failures: [],
          warnings: [
            "governed_autonomous_visual_policy_resolved:human_visual_review_required:studio-v21",
          ],
        };
      },
    };
    const { publishNextStory } = setupMocks({
      autonomousCqa,
      cqaResult: {
        result: "fail",
        failures: [
          "human_visual_review_required:studio-v21",
        ],
        warnings: [],
      },
      vqaResult,
      pvqaResult,
      stories: [story],
    });

    const result = await publishNextStory();

    assert.equal(result.no_safe_candidate, true);
    assert.equal(result.qa_skipped[0].source, expectedSource);
    assert.deepEqual(result.qa_skipped[0].failures, [
      expectedFailure,
    ]);
    assert.ok(
      dbState.stories
        .find((row) => row.id === story.id)
        .qa_warnings.includes(
          "governed_autonomous_visual_policy_resolved:human_visual_review_required:studio-v21",
        ),
    );
    assert.equal(resolveCalls, 1);
    assert.equal(reconcileCalls, 1);
    assert.deepEqual(uploaderCalls, []);
    assert.deepEqual(governedDispatchCalls, []);
  }

  await t.test(
    "video QA remains independently blocking",
    async (child) => {
      await runScenario(child, {
        vqaResult: {
          result: "fail",
          failures: [
            "black_segment_too_long (4.20s @ 0.00s)",
          ],
          warnings: [],
        },
        pvqaResult: {
          result: "pass",
          failures: [],
          warnings: [],
        },
        expectedSource: "video",
        expectedFailure:
          "black_segment_too_long (4.20s @ 0.00s)",
      });
    },
  );

  await t.test(
    "platform video QA remains independently blocking",
    async (child) => {
      await runScenario(child, {
        vqaResult: {
          result: "pass",
          failures: [],
          warnings: [],
        },
        pvqaResult: {
          result: "fail",
          failures: ["pixel_format_not_yuv420p"],
          warnings: [],
        },
        expectedSource: "platform_video",
        expectedFailure: "pixel_format_not_yuv420p",
      });
    },
  );
});

test("exact guarded candidate: a hash-bound governed 25-second Short uses its reviewed editorial and renderer contracts", async (t) => {
  const { mediaSha256, scriptSha256, story } =
    createGovernedReviewedShortFixture(t);
  const { publishNextStory } = setupMocks({
    useRealContentQa: true,
    vqaResult: {
      result: "fail",
      failures: ["duration_too_short (25.00s)"],
      warnings: [],
    },
    renderDecisionResult: {
      verdict: {
        class: "standard",
        missing: [],
        reasons: [],
        sources_used: ["governed-review"],
      },
      gate: { allowed: true, reason: null },
      inputs: {},
    },
    stories: [story],
  });

  const result = await publishNextStory({
    async fingerprintPublicationRequest() {
      return {
        request_fingerprint: "a".repeat(64),
        media_sha256: mediaSha256,
        script_sha256: scriptSha256,
      };
    },
  });

  assert.equal(result.no_safe_candidate, undefined);
  assert.equal(result.story_id, story.id);
  assert.equal(result.platform_outcomes.youtube, "new_upload");
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.ok(
    result.qa_warnings.includes(
      "governed_review_resolved:duration_too_short (25.00s)",
    ),
  );
  assert.notEqual(
    dbState.stories.find((row) => row.id === story.id)?.qa_failed,
    true,
  );
});

test("exact guarded candidate: governed video-QA reconciliation fails closed on authority or render mismatches", async (t) => {
  async function runScenario(
    child,
    {
      mutateStory = () => {},
      failures = ["duration_too_short (25.00s)"],
    } = {},
  ) {
    const { mediaSha256, scriptSha256, story } =
      createGovernedReviewedShortFixture(child);
    mutateStory(story);
    const { publishNextStory } = setupMocks({
      useRealContentQa: true,
      vqaResult: {
        result: "fail",
        failures,
        warnings: [],
      },
      renderDecisionResult: {
        verdict: {
          class: "standard",
          missing: [],
          reasons: [],
          sources_used: ["governed-review"],
        },
        gate: { allowed: true, reason: null },
        inputs: {},
      },
      stories: [story],
    });
    const result = await publishNextStory({
      async fingerprintPublicationRequest() {
        return {
          request_fingerprint: "a".repeat(64),
          media_sha256: mediaSha256,
          script_sha256: scriptSha256,
        };
      },
    });
    assert.equal(result.no_safe_candidate, true);
    assert.deepEqual(
      uploaderCalls,
      [],
      "an authority or duration mismatch must stop before the uploader",
    );
    assert.deepEqual(
      governedDispatchCalls,
      [],
      "an authority or duration mismatch must stop before governed dispatch",
    );
    return result;
  }

  await t.test("wrong reviewed story identity is blocked", async (child) => {
    const result = await runScenario(child, {
      mutateStory(story) {
        story.preflight_evidence.renderer_manifest.story_id =
          "another_story";
      },
    });
    assert.equal(result.qa_skipped[0].source, "governed_review");
    assert.ok(
      result.qa_skipped[0].failures.includes(
        "governed_review_renderer_story_mismatch",
      ),
    );
  });

  await t.test("wrong reviewed media hash is blocked", async (child) => {
    const result = await runScenario(child, {
      mutateStory(story) {
        story.preflight_evidence.media_sha256 = "f".repeat(64);
      },
    });
    assert.equal(result.qa_skipped[0].source, "governed_review");
    assert.ok(
      result.qa_skipped[0].failures.includes(
        "governed_review_current_media_hash_mismatch",
      ),
    );
  });

  await t.test("different probed duration remains a video-QA failure", async (child) => {
    const result = await runScenario(child, {
      failures: ["duration_too_short (24.99s)"],
    });
    assert.equal(result.qa_skipped[0].source, "video");
    assert.deepEqual(result.qa_skipped[0].failures, [
      "duration_too_short (24.99s)",
    ]);
  });

  await t.test("different reviewed renderer duration remains blocked", async (child) => {
    const result = await runScenario(child, {
      mutateStory(story) {
        story.preflight_evidence.renderer_manifest.output.duration_seconds =
          26;
      },
    });
    assert.equal(result.qa_skipped[0].source, "video");
    assert.deepEqual(result.qa_skipped[0].failures, [
      "duration_too_short (25.00s)",
    ]);
  });

  await t.test("a second video failure is retained", async (child) => {
    const result = await runScenario(child, {
      failures: [
        "duration_too_short (25.00s)",
        "black_segment_too_long (4.20s @ 0.00s)",
      ],
    });
    assert.equal(result.qa_skipped[0].source, "video");
    assert.deepEqual(result.qa_skipped[0].failures, [
      "black_segment_too_long (4.20s @ 0.00s)",
    ]);
    const persisted = dbState.stories.find(
      (row) => row.id === "official_governed_reviewed_short",
    );
    assert.ok(
      persisted.qa_warnings.includes(
        "governed_review_resolved:duration_too_short (25.00s)",
      ),
    );
  });
});

test("exact guarded candidate: bound QA failure never falls through to another ready story", async () => {
  const bad = {
    id: "rss_bad",
    title: "Stale mp4",
    approved: true,
    exported_path: "/tmp/bad.mp4",
  };
  const good = {
    id: "rss_good",
    title: "Healthy mp4",
    approved: true,
    exported_path: "/tmp/good.mp4",
  };
  // Stub content-QA: fail for `bad.id`, pass for `good.id`.
  const { publishNextStory } = setupMocksPerStory({
    perStoryCqa: {
      rss_bad: {
        result: "fail",
        failures: ["exported_mp4_not_on_disk"],
        warnings: [],
      },
      rss_good: { result: "pass", failures: [], warnings: [] },
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [bad, good],
  });

  const result = await publishNextStory();

  // Bad story got persisted qa_failed=true
  const badRow = dbState.stories.find((s) => s.id === "rss_bad");
  assert.strictEqual(badRow.qa_failed, true);
  assert.strictEqual(badRow.publish_status, "failed");

  // Only the bound bad story is evaluated.
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.ok(result.qa_skipped && result.qa_skipped.length === 1);
  assert.strictEqual(result.qa_skipped[0].id, "rss_bad");

  // The ready good story stays untouched and no create path is reached.
  const goodRow = dbState.stories.find((s) => s.id === "rss_good");
  assert.notStrictEqual(goodRow.qa_failed, true);
  assert.deepStrictEqual(uploaderCalls, []);
  assert.deepStrictEqual(governedDispatchCalls, []);
});

test("exact guarded candidate: only the bound story is evaluated when several would fail QA", async () => {
  const stories = [
    {
      id: "rss_a",
      title: "A",
      approved: true,
      exported_path: "/tmp/a.mp4",
    },
    {
      id: "rss_b",
      title: "B",
      approved: true,
      exported_path: "/tmp/b.mp4",
    },
    {
      id: "rss_c",
      title: "C",
      approved: true,
      exported_path: "/tmp/c.mp4",
    },
  ];
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["exported_mp4_not_on_disk"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories,
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.strictEqual(result.candidates_tried, 1);

  const bound = dbState.stories.find((s) => s.id === "rss_a");
  assert.strictEqual(bound.qa_failed, true);
  assert.strictEqual(bound.publish_status, "failed");
  for (const id of ["rss_b", "rss_c"]) {
    assert.notStrictEqual(
      dbState.stories.find((s) => s.id === id).qa_failed,
      true,
      `${id} must remain untouched by another story's authority`,
    );
  }
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    "no uploader should fire when all candidates fail QA",
  );
});

test("exact guarded candidate: a large backlog cannot expand one authority into a batch", async () => {
  // Seven candidates all fail, but one exact authority can evaluate only one.
  const stories = Array.from({ length: 7 }, (_, i) => ({
    id: `rss_cap_${i}`,
    title: `Cap ${i}`,
    approved: true,
    exported_path: `/tmp/c${i}.mp4`,
  }));
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_missing"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories,
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(
    result.candidates_tried,
    1,
    "one exact authority must evaluate one story",
  );
  assert.strictEqual(result.qa_skipped_count, 1);

  // Every story outside the exact authority remains untouched.
  for (const story of dbState.stories.slice(1)) {
    assert.notStrictEqual(story.qa_failed, true);
  }
});

test("exact guarded candidate: a YouTube-complete bound row fails closed as not ready", async () => {
  // Legacy partial row: YouTube is already public while secondary
  // platforms are missing. QA remains skipped, but the secondary freeze
  // means no uploader is allowed to fire.
  const partial = {
    id: "rss_partial_retry",
    title: "Retry me",
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: "yt_real",
    tiktok_post_id: null,
    instagram_media_id: null,
    facebook_post_id: null,
  };
  // Even if QA stub would fail, the retry path must not run it.
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["WOULD_BLOCK_IF_CALLED"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [partial],
  });

  const result = await publishNextStory();
  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "guarded_exact_story_not_ready");
  assert.equal(result.story_id, partial.id);
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);

  // The partial story was NOT persisted as qa_failed — QA wasn't run.
  const row = dbState.stories.find((s) => s.id === "rss_partial_retry");
  assert.notStrictEqual(
    row.qa_failed,
    true,
    "retry candidate must not be qa_failed",
  );
});

test("multi-candidate: soft warnings on passing candidate do not block publish (classification audit)", async () => {
  // Content-QA returns result="warn" (warnings but zero hard-fails).
  // Publisher must treat this as pass and upload — the warnings
  // get attached to result.qa_warnings for the Discord summary.
  const story = {
    id: "rss_warnings",
    title: "Warn but ship",
    approved: true,
    exported_path: "/tmp/w.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "warn",
      failures: [],
      warnings: [
        "story_card_path_set_but_missing",
        "entity_overlay_coverage_low",
      ],
    },
    vqaResult: {
      result: "warn",
      failures: [],
      warnings: ["opening_black (0.8s)"],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, undefined);
  assert.ok(uploaderCalls.length > 0, "soft warnings must NOT block publish");
  // Warnings from both QA passes are preserved for summary rendering.
  assert.ok(Array.isArray(result.qa_warnings));
  assert.ok(result.qa_warnings.length >= 2);
});

test("publishNextStory: QA-failed story is NOT re-selected on subsequent calls (deadlock fixed)", async () => {
  // Two stories approved. The first one fails QA. On second call,
  // the selector must skip it and pick the second.
  const bad = {
    id: "rss_broken",
    title: "Broken",
    approved: true,
    exported_path: "/tmp/a.mp4",
  };
  const good = {
    id: "rss_good",
    title: "Good",
    approved: true,
    exported_path: "/tmp/b.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "fail", failures: ["script_missing"], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [bad, good],
  });

  // The first exact operation can mutate only the bound bad story.
  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);

  const badRow = dbState.stories.find((s) => s.id === "rss_broken");
  assert.strictEqual(
    badRow.qa_failed,
    true,
    "bad story should be persisted qa_failed=true",
  );
  assert.strictEqual(badRow.publish_status, "failed");

  const goodRow = dbState.stories.find((s) => s.id === "rss_good");
  assert.notStrictEqual(goodRow.qa_failed, true);

  // A separately bound subsequent operation skips the failed row and
  // evaluates the next story. A third operation finds no ready target.
  const result2 = await publishNextStory();
  assert.strictEqual(result2.no_safe_candidate, true);
  assert.strictEqual(
    dbState.stories.find((s) => s.id === "rss_good").qa_failed,
    true,
  );

  const result3 = await publishNextStory();
  assert.equal(result3.publish_dispatch_blocked, true);
  assert.equal(result3.top_reason, "guarded_exact_story_not_ready");
});

test("publishNextStory: selector skips publish_status='failed' stories (all-core upload-fail case)", async () => {
  // Pre-failed story shouldn't be re-selected. This covers the
  // case where prior publish attempted all 4 core platforms and
  // they all failed — publish_status got set to "failed" and we
  // must not come back for another round.
  const failed = {
    id: "rss_upload_fail",
    title: "All uploads failed",
    approved: true,
    exported_path: "/tmp/x.mp4",
    publish_status: "failed",
    publish_error: "prior: all 4 core uploads failed",
  };
  const fresh = {
    id: "rss_fresh",
    title: "Fresh candidate",
    approved: true,
    exported_path: "/tmp/y.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "fail", failures: ["script_missing"], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [failed, fresh],
  });

  await publishNextStory();

  // Only fresh should have been touched — failed was pre-filtered.
  assert.ok(
    dbState.upsertCalls.find((c) => c.id === "rss_fresh"),
    "fresh story should have been selected and QA-failed",
  );
  assert.strictEqual(
    dbState.upsertCalls.find((c) => c.id === "rss_upload_fail"),
    undefined,
    "pre-failed story must NOT be selected",
  );
});

// Pure replica of the publishNextStory selector filter. Intentionally
// mirrors the live code — if publisher.js drifts, these branches
// will stop matching reality and the source-scan pin above will
// flag it. Keeping this replica lets us test the filter exhaustively
// without having to boot the whole publish pipeline (which fans out
// into engagement / blog / discord network paths even on retries).
function selectorFilter(s) {
  if (!s.approved || !s.exported_path) return false;
  if (s.qa_failed === true) return false;
  if (s.publish_status === "failed") return false;
  return !isRealPlatformPostIdForTest(s.youtube_post_id);
}

function isRealPlatformPostIdForTest(id) {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    !id.startsWith("DUPE_")
  );
}

test("selector: YouTube-complete partial stories are ineligible during stabilisation", () => {
  const partial = {
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: "yt_real",
    instagram_media_id: "ig_real",
    tiktok_post_id: null,
    facebook_post_id: null,
  };
  assert.strictEqual(
    selectorFilter(partial),
    false,
    "frozen secondary gaps must not consume a YouTube publish window",
  );
});

test("selector: a secondary-only legacy story remains eligible for governed YouTube dispatch", () => {
  const partial = {
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: null,
    instagram_media_id: "ig_real",
  };
  assert.strictEqual(selectorFilter(partial), true);
});

test("selector: fully-published story is skipped (platformsDone === 5)", () => {
  const fullyDone = {
    approved: true,
    exported_path: "/tmp/x.mp4",
    publish_status: "published",
    youtube_post_id: "yt",
    tiktok_post_id: "tt",
    instagram_media_id: "ig",
    facebook_post_id: "fb",
    twitter_post_id: "tw",
  };
  assert.strictEqual(selectorFilter(fullyDone), false);
});

test("publishNextStory: no-safe-candidate return shape carries top_reason + qa_skipped for callers", async () => {
  // The scheduled job handler / Discord renderer inspects this
  // shape. Pin the contract — if any of these fields are renamed,
  // the Discord summary will break.
  const story = {
    id: "rss_shape",
    title: "Return shape",
    approved: true,
    exported_path: "/tmp/x.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_missing"],
      warnings: ["minor"],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.strictEqual(result.candidates_tried, 1);
  assert.match(result.top_reason, /^content_qa:\s*script_missing$/);
  assert.ok(Array.isArray(result.qa_skipped));
  assert.strictEqual(result.qa_skipped[0].id, "rss_shape");
  assert.strictEqual(result.qa_skipped[0].source, "content");
  assert.strictEqual(result.qa_skipped[0].reason, "script_missing");
});
