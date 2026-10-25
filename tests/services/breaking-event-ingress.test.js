"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildBreakingEventEnvelope,
  enqueueBreakingEvent,
} = require("../../lib/services/breaking-event-ingress");
const { runMigrations } = require("../../lib/migrate");
const {
  bind: bindJobs,
} = require("../../lib/repositories/jobs");
const {
  captureBreakingSourceEvidence,
} = require("../../lib/services/breaking-source-evidence");
const { handlers } = require("../../lib/job-handlers");

const NOW = "2026-07-28T14:05:00.000Z";

function story(overrides = {}) {
  return {
    id: "rss-xbox-back-compat",
    title: "Original Xbox games are reportedly being prepared for Game Pass",
    url: "https://example.com/xbox-report",
    article_url: "https://example.com/xbox-report",
    source_type: "rss",
    subreddit: "Example outlet",
    breaking_score: 145,
    breaking_trigger: "rss_threshold",
    timestamp: "2026-07-28T14:03:00.000Z",
    ...overrides,
  };
}

async function confirmedOfficialPacket({
  storyId,
  title,
  url,
  now = NOW,
}) {
  const claim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme.";
  return captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title,
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          owner: "Microsoft Gaming",
          hosts: ["news.xbox.com"],
          subject_ids: ["xbox"],
        },
      ],
      trusted_editorial: [],
    },
    now,
    fetchCapture: async () => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: Buffer.from(`<article>${claim}</article>`),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture-body-extractor", version: "1.0.0" },
      claims: [
        {
          claim_key:
            "microsoft.xbox.adds.original-backcompat-games",
          text: claim,
          location: "body",
        },
      ],
    }),
  });
}

test("breaking ingress captures an urgent discovery without inventing verification or publish authority", () => {
  const envelope = buildBreakingEventEnvelope({
    story: story({
      approved: true,
      auto_approved: true,
      full_script: "Untrusted upstream script",
    }),
    now: NOW,
  });

  assert.equal(
    envelope.schema_version,
    "pulse-breaking-event-envelope-v1",
  );
  assert.equal(envelope.verdict, "DISCOVERY_ONLY");
  assert.equal(envelope.verified_for_production, false);
  assert.equal(envelope.publish_authority, false);
  assert.equal(envelope.auto_approved, false);
  assert.equal("full_script" in envelope.story, false);
  assert.deepEqual(envelope.blockers, [
    "primary_source_verification_required",
  ]);
  assert.match(envelope.fingerprint_sha256, /^[a-f0-9]{64}$/);
});

test("explicit primary-source verification permits production planning but never publishing", () => {
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "CONFIRMED",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example-announcement/",
      source_evidence_sha256: crypto
        .createHash("sha256")
        .update("source evidence")
        .digest("hex"),
    }),
    now: NOW,
  });

  assert.equal(envelope.verdict, "READY_FOR_PLANNING");
  assert.equal(envelope.verified_for_production, true);
  assert.equal(envelope.publish_authority, false);
  assert.deepEqual(envelope.blockers, []);
});

test("enqueue uses one urgent idempotent discovery job and carries no generic publish request", () => {
  const calls = [];
  const jobs = {
    enqueue(input) {
      calls.push(input);
      return { id: 91, ...input };
    },
  };

  const result = enqueueBreakingEvent({
    story: story(),
    jobs,
    now: NOW,
  });

  assert.equal(result.queued, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "breaking_story_discovery");
  assert.equal(calls[0].priority, 5);
  assert.equal(calls[0].requires_gpu, false);
  assert.match(
    calls[0].idempotency_key,
    /^breaking-discovery:rss-xbox-back-compat:[a-f0-9]{64}$/,
  );
  assert.equal(calls[0].payload.publish_authority, false);
  assert.equal(calls[0].payload.requested_action, "verify_and_plan");
  assert.notEqual(calls[0].kind, "publish");
});

test("timestamp-less breaking observations reuse one real durable discovery across pass times", (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);
  const timestampLess = story({ timestamp: undefined });

  const first = enqueueBreakingEvent({
    story: timestampLess,
    jobs,
    now: NOW,
  });
  const second = enqueueBreakingEvent({
    story: timestampLess,
    jobs,
    now: "2026-07-28T14:06:00.000Z",
  });

  assert.equal(first.queued, true);
  assert.equal(second.queued, false);
  assert.equal(
    second.reason,
    "durable_breaking_discovery_already_enqueued",
  );
  assert.equal(second.job.id, first.job.id);
  assert.equal(
    jobs
      .listPending()
      .filter((job) => job.kind === "breaking_story_discovery")
      .length,
    1,
  );
});

test("breaking discovery preserves a genuine changed source timestamp as a same-key work conflict", (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);

  enqueueBreakingEvent({
    story: story({ timestamp: "2026-07-28T14:03:00.000Z" }),
    jobs,
    now: NOW,
  });

  assert.throws(
    () =>
      enqueueBreakingEvent({
        story: story({
          timestamp: "2026-07-28T14:04:00.000Z",
        }),
        jobs,
        now: "2026-07-28T14:06:00.000Z",
      }),
    /job_idempotency_conflict/,
  );
});

test("breaking discovery dedupe never suppresses a true same-key work conflict", (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);

  enqueueBreakingEvent({
    story: story({ breaking_score: 145 }),
    jobs,
    now: NOW,
  });

  assert.throws(
    () =>
      enqueueBreakingEvent({
        story: story({ breaking_score: 146 }),
        jobs,
        now: "2026-07-28T14:06:00.000Z",
      }),
    /job_idempotency_conflict/,
  );
  assert.equal(
    jobs
      .listPending()
      .filter((job) => job.kind === "breaking_story_discovery")
      .length,
    1,
  );
});

test("invalid and low-value events are held before they enter the durable queue", () => {
  const calls = [];
  const jobs = {
    enqueue(input) {
      calls.push(input);
      return input;
    },
  };
  const result = enqueueBreakingEvent({
    story: story({
      id: "",
      title: "",
      breaking_score: 20,
    }),
    jobs,
    now: NOW,
  });

  assert.equal(result.queued, false);
  assert.equal(result.envelope.verdict, "HOLD");
  assert.deepEqual(
    result.envelope.blockers,
    [
      "story_id_required",
      "story_title_required",
      "breaking_score_below_80",
      "primary_source_verification_required",
    ],
  );
  assert.equal(calls.length, 0);
});

test("discovery handler persists proof and fans an urgent verified event into an immediate governed re-hunt", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-ingress-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "CONFIRMED",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example-announcement/",
      source_evidence_sha256: crypto
        .createHash("sha256")
        .update("source evidence")
        .digest("hex"),
    }),
    now: NOW,
  });
  const confirmedPacket = await confirmedOfficialPacket({
    storyId: envelope.story.id,
    title: envelope.story.title,
    url: envelope.story.primary_source_url,
  });
  const capturedEvidenceHash = confirmedPacket.packet_sha256;

  const result = await handlers.breaking_story_discovery(
    {
      channel_id: "pulse-gaming",
      payload: {
        ...envelope,
        requested_action: "verify_and_plan",
        out_dir: outDir,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            assert.equal(
              fs.existsSync(input.payload.source_evidence_path),
              true,
              "evidence must exist before downstream enqueue",
            );
            queued.push(input);
            return { id: 92, ...input };
          },
        },
      },
      async captureBreakingSourceEvidence({
        story: capturedStory,
        stopAfterOfficialConfirmation,
      }) {
        assert.equal(capturedStory.id, envelope.story.id);
        assert.equal(stopAfterOfficialConfirmation, true);
        return confirmedPacket;
      },
      breakingSourcePolicy: { official_first_party: [] },
      breakingFetchCapture: async () => {
        throw new Error("capture service is injected");
      },
      breakingClaimExtractor: async () => {
        throw new Error("capture service is injected");
      },
      log() {},
    },
  );

  assert.equal(result.no_publish, true);
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(await fs.pathExists(result.report_markdown), true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "hunt");
  assert.equal(queued[0].priority, 4);
  assert.equal(
    queued[0].payload.breaking_story_id,
    envelope.story.id,
  );
  assert.equal(
    queued[0].payload.breaking_event_fingerprint_sha256,
    envelope.fingerprint_sha256,
  );
  assert.equal(
    queued[0].payload.verification_status,
    "CONFIRMED",
  );
  assert.equal(
    queued[0].payload.primary_source_url,
    envelope.story.primary_source_url,
  );
  assert.equal(
    queued[0].payload.source_evidence_sha256,
    capturedEvidenceHash,
  );
  assert.match(
    queued[0].payload.source_evidence_file_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    queued[0].idempotency_key,
    `breaking-rehunt:${envelope.story.id}:${envelope.fingerprint_sha256}`,
  );
  assert.notEqual(queued[0].kind, "publish");
  const report = await fs.readJson(result.report_json);
  assert.equal(report.capture_deadline_ms, 30_000);
});

test("capture failures produce a hash-valid HOLD packet with only the real capture blocker", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-capture-failure-"),
  );
  t.after(() => fs.remove(outDir));
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      repos: {
        jobs: {
          enqueue() {
            throw new Error("a failed capture must not enqueue");
          },
        },
      },
      async captureBreakingSourceEvidence() {
        const error = new Error("fixture capture unavailable");
        error.code = "BREAKING_SOURCE_CAPTURE_UNAVAILABLE";
        throw error;
      },
      log() {},
    },
  );

  const report = await fs.readJson(result.report_json);
  assert.equal(result.verdict, "HOLD");
  assert.equal(
    report.capture_error_code,
    "BREAKING_SOURCE_CAPTURE_UNAVAILABLE",
  );
  assert.equal(report.source_evidence_validation.valid, true);
  assert.deepEqual(report.source_evidence.blockers, [
    "breaking_source_capture_unavailable",
  ]);
  assert.ok(
    !result.blockers.some((blocker) =>
      blocker.includes("sha256_mismatch"),
    ),
    JSON.stringify(result.blockers),
  );
});

test("breaking evidence retry regenerates its envelope with the trusted attempt clock", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pulse-breaking-trusted-retry-time-",
    ),
  );
  t.after(() => fs.remove(outDir));
  const attemptNow = "2026-08-10T14:07:00.000Z";
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      now: () => attemptNow,
      repos: {
        jobs: {
          enqueue() {
            throw new Error(
              "a failed capture must not enqueue",
            );
          },
        },
      },
      async captureBreakingSourceEvidence() {
        const error = new Error("fixture capture unavailable");
        error.code = "BREAKING_SOURCE_CAPTURE_UNAVAILABLE";
        throw error;
      },
      log() {},
    },
  );

  const report = await fs.readJson(result.report_json);
  assert.equal(result.verdict, "HOLD");
  assert.equal(report.generated_at, attemptNow);
  assert.equal(report.attempt_observed_at, attemptNow);
  assert.equal(
    report.source_evidence.generated_at,
    attemptNow,
  );
  assert.equal(
    report.story.discovered_at,
    "2026-07-28T14:03:00.000Z",
  );
});

test("discovery never trusts inbound CONFIRMED fields when fresh source capture is unavailable", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-untrusted-confirmation-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "CONFIRMED",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example-announcement/",
      source_evidence_sha256: "f".repeat(64),
    }),
    now: NOW,
  });
  const heldPacket = await captureBreakingSourceEvidence({
    story: {
      id: envelope.story.id,
      title: envelope.story.title,
      subject_ids: ["xbox"],
      source_candidates: [
        "https://untrusted.example.com/copied-report",
      ],
    },
    sourcePolicy: {
      official_first_party: [],
      trusted_editorial: [],
    },
    now: NOW,
  });

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return input;
          },
        },
      },
      async captureBreakingSourceEvidence() {
        return heldPacket;
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "official_or_corroborated_body_evidence_required",
    ),
  );
  assert.equal(queued.length, 0);
});

test("discovery can promote a discovery-only event from freshly captured official body evidence", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-fresh-official-"),
  );
  t.after(() => fs.remove(outDir));
  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/fresh-official-body/";
  const envelope = buildBreakingEventEnvelope({
    story: story({
      url: officialUrl,
      article_url: officialUrl,
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });
  const queued = [];

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 95, ...input };
          },
        },
      },
      breakingSourcePolicy: {
        official_first_party: [
          {
            source_id: "xbox-wire",
            owner: "Microsoft Gaming",
            hosts: ["news.xbox.com"],
            subject_ids: ["xbox"],
          },
        ],
        trusted_editorial: [],
      },
      async breakingFetchCapture({ url }) {
        return {
          status: 200,
          final_url: url,
          content_type: "text/html",
          bytes: Buffer.from(
            "<article>Microsoft confirmed original Xbox games will join the backwards compatibility programme.</article>",
          ),
        };
      },
      async breakingClaimExtractor({ story: extractionStory }) {
        assert.equal(Object.hasOwn(extractionStory, "title"), false);
        return {
          extractor: {
            id: "fixture-body-extractor",
            version: "1.0.0",
          },
          claims: [
            {
              claim_key:
                "microsoft.xbox.adds.original-backcompat-games",
              text:
                "Microsoft confirmed original Xbox games will join the backwards compatibility programme.",
              location: "body",
            },
          ],
        };
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "READY_FOR_PLANNING");
  assert.equal(result.blockers.length, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "hunt");
  assert.equal(
    queued[0].payload.verification_status,
    "CONFIRMED",
  );
  assert.match(
    queued[0].payload.source_evidence_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(await fs.pathExists(result.source_evidence_json), true);
});

test("discovery expands source candidates from an identified corroborator index before body capture", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-corroborator-index-"),
  );
  t.after(() => fs.remove(outDir));
  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/corroborated-body/";
  const envelope = buildBreakingEventEnvelope({
    story: story({
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });
  const exactClaim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme.";
  const queued = [];
  let searchCalls = 0;

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      breakingCorroboratorSearchIndex: {
        identity: {
          id: "fixture-corroborator-index",
          version: "1.0.0",
        },
        async search() {
          searchCalls += 1;
          return {
            results: [
              {
                url: officialUrl,
                source_id: "xbox-wire",
                title: "Xbox confirms backwards compatibility news",
              },
            ],
          };
        },
      },
      breakingSourcePolicy: {
        official_first_party: [
          {
            source_id: "xbox-wire",
            owner: "Microsoft Gaming",
            hosts: ["news.xbox.com"],
            subject_ids: ["xbox"],
          },
        ],
        trusted_editorial: [],
      },
      async breakingFetchCapture({ url }) {
        assert.equal(url, officialUrl);
        return {
          status: 200,
          final_url: url,
          content_type: "text/html",
          bytes: Buffer.from(`<article>${exactClaim}</article>`),
        };
      },
      async breakingClaimExtractor() {
        return {
          extractor: {
            id: "fixture-body-extractor",
            version: "1.0.0",
          },
          claims: [
            {
              claim_key:
                "microsoft.xbox.adds.original-backcompat-games",
              text: exactClaim,
              location: "body",
            },
          ],
        };
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 97, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(searchCalls, 1);
  assert.equal(result.verdict, "READY_FOR_PLANNING");
  assert.equal(queued.length, 1);
  assert.match(
    queued[0].payload.corroborator_discovery_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    await fs.pathExists(result.corroborator_discovery_json),
    true,
  );
  const report = JSON.parse(
    await fs.readFile(result.report_json, "utf8"),
  );
  assert.deepEqual(
    report.corroborator_discovery.candidate_urls,
    [officialUrl],
  );
});

test("an explicitly enabled injected Anthropic client activates the default evidence path without an environment API key", async (t) => {
  const priorPaidAiEnabled = process.env.PULSE_PAID_AI_ENABLED;
  process.env.PULSE_PAID_AI_ENABLED = "true";
  t.after(() => {
    if (priorPaidAiEnabled === undefined) {
      delete process.env.PULSE_PAID_AI_ENABLED;
    } else {
      process.env.PULSE_PAID_AI_ENABLED = priorPaidAiEnabled;
    }
  });
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-injected-client-"),
  );
  t.after(() => fs.remove(outDir));
  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/injected-client/";
  const exactClaim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme.";
  const envelope = buildBreakingEventEnvelope({
    story: story({
      url: officialUrl,
      article_url: officialUrl,
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });
  const queued = [];
  let modelCalls = 0;
  let captureFactoryCalls = 0;

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      anthropicClient: {
        messages: {
          async create() {
            modelCalls += 1;
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    claims: [
                      {
                        claim_key:
                          "microsoft.xbox.adds.original-backcompat-games",
                        text: exactClaim,
                      },
                    ],
                  }),
                },
              ],
            };
          },
        },
      },
      createBreakingFetchCapture() {
        captureFactoryCalls += 1;
        return async ({ url }) => ({
          status: 200,
          final_url: url,
          content_type: "text/html",
          bytes: Buffer.from(`<article>${exactClaim}</article>`),
        });
      },
      breakingSourcePolicy: {
        official_first_party: [
          {
            source_id: "xbox-wire",
            owner: "Microsoft Gaming",
            hosts: ["news.xbox.com"],
            subject_ids: ["xbox"],
          },
        ],
        trusted_editorial: [],
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 96, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "READY_FOR_PLANNING");
  assert.equal(captureFactoryCalls, 1);
  assert.equal(modelCalls, 1);
  assert.equal(queued.length, 1);
});

test("a partially injected breaking evidence pair fails closed without creating an implicit network fetcher", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-partial-injection-"),
  );
  t.after(() => fs.remove(outDir));
  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/partial-injection/";
  const envelope = buildBreakingEventEnvelope({
    story: story({
      url: officialUrl,
      article_url: officialUrl,
      verification_status: "",
      primary_source_url: "",
      source_evidence_sha256: "",
    }),
    now: NOW,
  });
  let factoryCalls = 0;
  const queued = [];

  const result = await handlers.breaking_story_discovery(
    {
      payload: {
        ...envelope,
        out_dir: outDir,
      },
    },
    {
      breakingClaimExtractor: async () => {
        throw new Error("must_not_extract_without_capture");
      },
      createBreakingFetchCapture() {
        factoryCalls += 1;
        throw new Error("implicit_network_fetch_forbidden");
      },
      breakingSourcePolicy: {
        official_first_party: [
          {
            source_id: "xbox-wire",
            owner: "Microsoft Gaming",
            hosts: ["news.xbox.com"],
            subject_ids: ["xbox"],
          },
        ],
        trusted_editorial: [],
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return input;
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(factoryCalls, 0);
  assert.equal(queued.length, 0);
  const report = JSON.parse(
    await fs.readFile(result.report_json, "utf8"),
  );
  assert.ok(
    report.source_evidence.sources[0].blockers.includes(
      "source_fetch_capture_required",
    ),
  );
});

test("an urgent re-hunt immediately schedules lane planning after verification and scripting complete", async () => {
  const queued = [];
  const fingerprint = crypto
    .createHash("sha256")
    .update("breaking ingress")
    .digest("hex");
  const result = await handlers.hunt(
    {
      id: 93,
      channel_id: "pulse-gaming",
      idempotency_key: `breaking-rehunt:${fingerprint}`,
      payload: {
        reason: "governed_breaking_event",
        breaking_story_id: "breaking-after-hunt",
        breaking_event_fingerprint_sha256: fingerprint,
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/example/",
        source_evidence_sha256: "e".repeat(64),
      },
    },
    {
      async hunter() {
        return [{ id: "breaking-after-hunt" }];
      },
      async processStories() {
        return [{ id: "breaking-after-hunt", full_script: "Ready" }];
      },
      async autoApprove() {
        return { scored: 1, review: 1 };
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 94, ...input };
          },
        },
      },
    },
  );

  assert.equal(result.fetched, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "governed_multi_lane_plan");
  assert.equal(queued[0].priority, 7);
  assert.equal(
    queued[0].payload.breaking_story_id,
    "breaking-after-hunt",
  );
  assert.equal(queued[0].payload.live_publish_enabled, false);
  assert.equal(
    queued[0].payload.verification_status,
    "CONFIRMED",
  );
  assert.equal(
    queued[0].payload.primary_source_url,
    "https://news.xbox.com/en-us/2026/07/28/example/",
  );
  assert.equal(
    queued[0].payload.source_evidence_sha256,
    "e".repeat(64),
  );
});
