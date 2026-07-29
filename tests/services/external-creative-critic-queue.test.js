"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  enqueueExternalCreativeCriticRequest,
  getExternalCreativeCriticQueueStatus,
  ingestExternalCreativeCriticResponse,
  stageExternalCreativeCriticResponse,
  sweepExternalCreativeCriticQueue,
} = require("../../lib/services/external-creative-critic-queue");
const {
  run: runExternalCreativeCriticQueue,
} = require("../../tools/external-creative-critic-queue");

function validInput() {
  return {
    story: {
      id: "story-queue-1",
      title: "A confirmed game update",
      game: "Example Game",
      platform: "PC",
      principal_claim: "The official update adds a new mode.",
      source_label: "Official publisher announcement",
      source_urls: ["https://example.com/news/update"],
      public_facts: ["The publisher announced the mode on its public site."],
      publish_by: "2026-07-29T12:00:00Z",
      stale_after: "2026-07-29T14:00:00Z",
    },
    brief: {
      format: "Pulse Flash",
      duration_seconds: 30,
      aspect_ratio: "9:16",
      audience: "Gaming-news viewers",
      editorial_goal: "Explain the player consequence quickly.",
      style_direction: "Full-screen exact-subject motion.",
      media_basis: "Official public media.",
      voiceover_locked: true,
      creative_constraints: ["Keep the principal claim exact."],
    },
    storyboard: [
      {
        id: "opening",
        start_seconds: 0,
        end_seconds: 30,
        editorial_purpose: "Prove the update and explain why it matters.",
        visual: "The official update fills the frame.",
        narration: "The official update adds a new mode.",
        on_screen_text: "A NEW MODE",
      },
    ],
    round: {
      kind: "initial_request",
      number: 1,
    },
  };
}

function validResponseMarkdown() {
  return [
    "## Verdict",
    "REVISE",
    "",
    "## Blocking errors",
    "- None",
    "",
    "## Ranked changes",
    "1. Make the player consequence dominant in the first frame.",
    "2. Show the cause-and-effect transition more clearly.",
    "3. Shorten the final instruction sequence.",
    "",
    "## Keep unchanged",
    "1. Keep the exact official claim.",
    "2. Keep the full-screen visual treatment.",
    "3. Keep the current duration.",
    "",
    "## First-three-second assessment",
    "The opening is legible, but the consequence should carry more visual weight.",
    "",
    "## Originality",
    "The authored motion feels specific to the story rather than mass produced.",
  ].join("\n");
}

function validBrokerReceipt({ request, responseBytes }) {
  return {
    schema_version:
      "pulse-external-creative-critic-broker-receipt-v1",
    request_id: request.request_id,
    packet_id: request.packet_id,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    response_raw_sha256: crypto
      .createHash("sha256")
      .update(responseBytes)
      .digest("hex"),
    transport: "codex_cli",
    client: "pulse-critic-broker",
    model_claim: "chatgpt-pro",
    model_claim_verified: false,
    submitted_at: "2026-07-29T09:00:30.000Z",
    network_used: true,
    browser_or_ui_used: false,
    broker_version: "1.0.0",
    host_scope: "isolated_queue_only",
    database_mutation_authority: false,
    oauth_or_token_authority: false,
    scheduler_authority: false,
    publish_authority: false,
  };
}

test("enqueue publishes one immutable hash-bound request and status survives a fresh read", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-queue-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const now = "2026-07-29T09:00:00.000Z";

  const enqueued = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "a".repeat(64),
    now,
    timeoutMs: 300_000,
    allowedRoots: [root],
  });

  assert.equal(enqueued.status, "REQUESTED");
  assert.match(enqueued.request_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(enqueued.created_at, now);
  assert.equal(enqueued.deadline_at, "2026-07-29T09:05:00.000Z");
  assert.equal(enqueued.safety.network_used, false);
  assert.equal(enqueued.safety.browser_or_ui_used, false);
  assert.equal(enqueued.safety.publish_authority, false);

  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: enqueued.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.status, "REQUESTED");
  assert.equal(status.request_id, enqueued.request_id);
  assert.equal(status.packet_id, enqueued.packet_id);
  assert.equal(status.deadline_at, enqueued.deadline_at);

  const repeated = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "a".repeat(64),
    now: "2026-07-29T09:01:00.000Z",
    timeoutMs: 600_000,
    allowedRoots: [root],
  });
  assert.equal(repeated.request_id, enqueued.request_id);
  assert.equal(repeated.created_at, now);
  assert.equal(repeated.deadline_at, enqueued.deadline_at);
  assert.equal(repeated.created, false);
});

test("ingest binds the exact raw response bytes to one immutable terminal outcome", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-ingest-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "response.md");
  const responseBytes = Buffer.from(
    `${validResponseMarkdown()}\r\n`,
    "utf8",
  );
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "b".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });

  const outcome = await ingestExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });

  assert.equal(outcome.status, "CRITIQUE_READY");
  assert.equal(outcome.request_id, request.request_id);
  assert.equal(
    outcome.raw_response_sha256,
    crypto.createHash("sha256").update(responseBytes).digest("hex"),
  );
  assert.match(outcome.parsed_response_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(outcome.outcome_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(outcome.safety.network_used, false);
  assert.equal(outcome.safety.browser_or_ui_used, false);
  assert.equal(outcome.safety.publish_authority, false);

  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.status, "CRITIQUE_READY");
  assert.equal(status.raw_response_sha256, outcome.raw_response_sha256);

  const repeated = await ingestExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    now: "2026-07-29T09:02:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(repeated.outcome_sha256, outcome.outcome_sha256);
  assert.equal(repeated.created, false);
});

test("sweep records a bounded timeout fallback and never turns it into a publish gate", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-timeout-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "weekly_longform",
    candidateRevisionSha256: "c".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 60_000,
    allowedRoots: [root],
  });

  const pending = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:00:59.999Z",
    allowedRoots: [root],
  });
  assert.equal(pending.requested, 1);
  assert.equal(pending.timed_out, 0);

  const swept = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(swept.timed_out, 1);
  assert.equal(swept.outcomes[0].status, "TIMED_OUT_FALLBACK");
  assert.equal(
    swept.outcomes[0].fallback_action,
    "CONTINUE_WITH_NORMAL_INTERNAL_QA",
  );
  assert.equal(swept.outcomes[0].publish_gate, false);

  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.status, "TIMED_OUT_FALLBACK");
  assert.equal(status.artifacts.raw_response, null);
  assert.equal(status.safety.database_mutation_authority, false);
  assert.equal(status.safety.oauth_or_token_authority, false);
  assert.equal(status.safety.publish_authority, false);
});

test("an invalid external response becomes an auditable fallback instead of stalling production", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-invalid-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "invalid-response.md");
  const responseBytes = Buffer.from(
    "This response ignores the required contract.\n",
    "utf8",
  );
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "d".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });

  const outcome = await ingestExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    now: "2026-07-29T09:00:30.000Z",
    allowedRoots: [root],
  });

  assert.equal(outcome.status, "INVALID_RESPONSE_FALLBACK");
  assert.equal(
    outcome.raw_response_sha256,
    crypto.createHash("sha256").update(responseBytes).digest("hex"),
  );
  assert.match(outcome.validation_error, /^critic_response_/);
  assert.equal(
    outcome.fallback_action,
    "CONTINUE_WITH_NORMAL_INTERNAL_QA",
  );
  assert.equal(outcome.publish_gate, false);
});

test("a response received at or after the hard deadline is archived as late and cannot replace fallback", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-late-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "late-response.md");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "breaking_short",
    candidateRevisionSha256: "e".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 60_000,
    allowedRoots: [root],
  });

  const late = await ingestExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });

  assert.equal(late.status, "LATE_RESPONSE_IGNORED");
  assert.equal(late.terminal_outcome_status, "TIMED_OUT_FALLBACK");
  assert.equal(
    late.raw_response_sha256,
    crypto.createHash("sha256").update(responseBytes).digest("hex"),
  );
  assert.match(late.late_receipt_sha256, /^sha256:[a-f0-9]{64}$/);

  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.status, "TIMED_OUT_FALLBACK");
  assert.equal(status.raw_response_sha256, null);
});

test("a broker can atomically stage a response file for sweep without gaining any other authority", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-inbox-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  await fs.writeFile(responsePath, validResponseMarkdown(), "utf8");
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "f".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });

  const staged = await stageExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    allowedRoots: [root],
  });
  assert.equal(staged.status, "RESPONSE_READY");
  assert.equal(staged.network_used, false);
  assert.equal(staged.browser_or_ui_used, false);

  const waiting = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(waiting.status, "REQUESTED");
  assert.equal(waiting.response_ready, true);

  const swept = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(swept.critique_ready, 1);
  assert.equal(swept.outcomes[0].status, "CRITIQUE_READY");
});

test("a valid broker receipt is bound to the request and exact response in the terminal outcome", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-receipt-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "9".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  const receipt = validBrokerReceipt({ request, responseBytes });
  const receiptBytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(receiptPath, receiptBytes);

  const staged = await stageExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    brokerReceiptPath: receiptPath,
    allowedRoots: [root],
  });

  assert.equal(staged.status, "RESPONSE_READY");
  assert.equal(
    staged.broker_receipt.raw_sha256,
    crypto.createHash("sha256").update(receiptBytes).digest("hex"),
  );
  assert.equal(staged.broker_receipt.provenance.transport, "codex_cli");
  assert.equal(
    staged.broker_receipt.provenance.model_claim_verified,
    false,
  );

  const swept = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(swept.critique_ready, 1);
  assert.equal(
    swept.outcomes[0].artifacts.broker_receipt.raw_sha256,
    staged.broker_receipt.raw_sha256,
  );
  assert.deepEqual(swept.outcomes[0].broker_provenance, receipt);
  assert.equal(swept.outcomes[0].safety.publish_authority, false);
});

test("a broker receipt with a non-allowlisted field cannot create a response-ready marker", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-fields-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "a1".repeat(32),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify({
      ...validBrokerReceipt({ request, responseBytes }),
      arbitrary_context: "must not cross the trust boundary",
    })}\n`,
    "utf8",
  );

  await assert.rejects(
    stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath,
      brokerReceiptPath: receiptPath,
      allowedRoots: [root],
    }),
    /critic_queue_broker_receipt_fields_invalid/,
  );
  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.response_ready, false);
});

test("the queue CLI can stage an optional validated broker receipt", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-cli-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "a2".repeat(32),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify(
      validBrokerReceipt({ request, responseBytes }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  const staged = await runExternalCreativeCriticQueue([
    "stage",
    "--queue-root",
    queueRoot,
    "--request-id",
    request.request_id,
    "--response",
    responsePath,
    "--broker-receipt",
    receiptPath,
  ]);

  assert.equal(
    staged.broker_receipt.provenance.host_scope,
    "isolated_queue_only",
  );
});

test("mismatched, verified-model or authority-bearing broker receipts fail closed", async (t) => {
  const cases = [
    {
      name: "response hash mismatch",
      mutate: (receipt) => ({
        ...receipt,
        response_raw_sha256: "0".repeat(64),
      }),
      error: /critic_queue_broker_receipt_binding_invalid/,
    },
    {
      name: "model verification claim",
      mutate: (receipt) => ({
        ...receipt,
        model_claim_verified: true,
      }),
      error:
        /critic_queue_broker_receipt_model_claim_verified_forbidden/,
    },
    {
      name: "non-string provenance",
      mutate: (receipt) => ({
        ...receipt,
        client: 42,
      }),
      error: /critic_queue_broker_receipt_client_invalid/,
    },
    ...[
      "database_mutation_authority",
      "oauth_or_token_authority",
      "scheduler_authority",
      "publish_authority",
    ].map((field) => ({
      name: `${field} claim`,
      mutate: (receipt) => ({ ...receipt, [field]: true }),
      error: new RegExp(
        `critic_queue_broker_receipt_authority_forbidden:${field}`,
      ),
    })),
  ];

  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async (t) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "pulse-critic-broker-deny-"),
      );
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const queueRoot = path.join(root, "queue");
      const responsePath = path.join(root, "broker-response.md");
      const receiptPath = path.join(root, "broker-receipt.json");
      const responseBytes = Buffer.from(
        validResponseMarkdown(),
        "utf8",
      );
      await fs.writeFile(responsePath, responseBytes);
      const request = await enqueueExternalCreativeCriticRequest({
        queueRoot,
        input: validInput(),
        laneId: "evergreen_short",
        candidateRevisionSha256: `${index + 1}`.repeat(64),
        now: "2026-07-29T09:00:00.000Z",
        timeoutMs: 300_000,
        allowedRoots: [root],
      });
      await fs.writeFile(
        receiptPath,
        `${JSON.stringify(
          testCase.mutate(
            validBrokerReceipt({ request, responseBytes }),
          ),
        )}\n`,
        "utf8",
      );

      await assert.rejects(
        stageExternalCreativeCriticResponse({
          queueRoot,
          requestId: request.request_id,
          responsePath,
          brokerReceiptPath: receiptPath,
          allowedRoots: [root],
        }),
        testCase.error,
      );
      const status = await getExternalCreativeCriticQueueStatus({
        queueRoot,
        requestId: request.request_id,
        allowedRoots: [root],
      });
      assert.equal(status.response_ready, false);
    });
  }
});

test("broker receipt JSON is size bounded before it reaches the inbox", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-size-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "7".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  const validJson = JSON.stringify(
    validBrokerReceipt({ request, responseBytes }),
  );
  await fs.writeFile(
    receiptPath,
    `${validJson}${" ".repeat(16 * 1024 + 1)}`,
    "utf8",
  );

  await assert.rejects(
    stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath,
      brokerReceiptPath: receiptPath,
      allowedRoots: [root],
    }),
    /critic_queue_file_size_invalid:broker_receipt/,
  );
  const status = await getExternalCreativeCriticQueueStatus({
    queueRoot,
    requestId: request.request_id,
    allowedRoots: [root],
  });
  assert.equal(status.response_ready, false);
});

test("a broker receipt cannot be attached after the response-ready marker already exists", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-order-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "8".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  await stageExternalCreativeCriticResponse({
    queueRoot,
    requestId: request.request_id,
    responsePath,
    allowedRoots: [root],
  });
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify(
      validBrokerReceipt({ request, responseBytes }),
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath,
      brokerReceiptPath: receiptPath,
      allowedRoots: [root],
    }),
    /critic_queue_broker_receipt_after_response_ready_forbidden/,
  );
  const swept = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(swept.critique_ready, 1);
  assert.equal(swept.outcomes[0].artifacts.broker_receipt, null);
});

test("concurrent receipt and receipt-free staging leave one sweepable response with no orphan provenance", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-broker-race-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const responsePath = path.join(root, "broker-response.md");
  const receiptPath = path.join(root, "broker-receipt.json");
  const responseBytes = Buffer.from(validResponseMarkdown(), "utf8");
  await fs.writeFile(responsePath, responseBytes);
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "9a".repeat(32),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify(
      validBrokerReceipt({ request, responseBytes }),
    )}\n`,
    "utf8",
  );

  const staged = await Promise.allSettled([
    stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath,
      allowedRoots: [root],
    }),
    stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath,
      brokerReceiptPath: receiptPath,
      allowedRoots: [root],
    }),
  ]);

  assert.ok(staged.some((entry) => entry.status === "fulfilled"));
  for (const entry of staged) {
    if (entry.status === "rejected") {
      assert.match(
        entry.reason.message,
        /critic_queue_broker_receipt_after_response_ready_forbidden/,
      );
    }
  }
  const swept = await sweepExternalCreativeCriticQueue({
    queueRoot,
    now: "2026-07-29T09:01:00.000Z",
    allowedRoots: [root],
  });
  assert.equal(swept.errors.length, 0);
  assert.equal(swept.critique_ready, 1);
  const outcomeReceipt =
    swept.outcomes[0].artifacts.broker_receipt;
  const inboxReceipt = path.join(
    queueRoot,
    "inbox",
    `${request.request_id.slice("sha256:".length)}.broker-receipt.json`,
  );
  if (outcomeReceipt) {
    assert.equal(
      swept.outcomes[0].broker_provenance.publish_authority,
      false,
    );
    await fs.access(inboxReceipt);
  } else {
    await assert.rejects(fs.access(inboxReceipt), { code: "ENOENT" });
  }
});

test("queue paths, response size and filesystem links fail closed", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-guards-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "1".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  const oversized = path.join(root, "oversized-response.md");
  await fs.writeFile(oversized, Buffer.alloc(64 * 1024 + 1, 65));
  await assert.rejects(
    ingestExternalCreativeCriticResponse({
      queueRoot,
      requestId: request.request_id,
      responsePath: oversized,
      now: "2026-07-29T09:01:00.000Z",
      allowedRoots: [root],
    }),
    /critic_queue_file_size_invalid:response/,
  );

  const target = path.join(root, "response-target.md");
  const linked = path.join(root, "response-link.md");
  await fs.writeFile(target, validResponseMarkdown(), "utf8");
  let fileLinkCreated = false;
  try {
    await fs.symlink(target, linked, "file");
    fileLinkCreated = true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.diagnostic(`symlink check unavailable: ${error.code}`);
    } else {
      throw error;
    }
  }
  if (fileLinkCreated) {
    await assert.rejects(
      ingestExternalCreativeCriticResponse({
        queueRoot,
        requestId: request.request_id,
        responsePath: linked,
        now: "2026-07-29T09:01:00.000Z",
        allowedRoots: [root],
      }),
      /critic_queue_path_link_forbidden:response/,
    );
  }

  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-outside-"),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await assert.rejects(
    enqueueExternalCreativeCriticRequest({
      queueRoot: path.join(outside, "queue"),
      input: validInput(),
      laneId: "evergreen_short",
      candidateRevisionSha256: "2".repeat(64),
      now: "2026-07-29T09:00:00.000Z",
      timeoutMs: 300_000,
      allowedRoots: [root],
    }),
    /critic_queue_path_outside_allowed_roots:queue_root/,
  );
});

test("CLI exposes enqueue, status, ingest and sweep without contacting an external service", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-cli-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const inputPath = path.join(root, "input.json");
  const responsePath = path.join(root, "response.md");
  await Promise.all([
    fs.writeFile(
      inputPath,
      `${JSON.stringify(validInput(), null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(responsePath, validResponseMarkdown(), "utf8"),
  ]);

  const enqueued = await runExternalCreativeCriticQueue([
    "enqueue",
    "--queue-root",
    queueRoot,
    "--input",
    inputPath,
    "--lane-id",
    "evergreen_short",
    "--candidate-revision-sha256",
    "3".repeat(64),
    "--timeout-seconds",
    "300",
    "--now",
    "2026-07-29T09:00:00.000Z",
  ]);
  assert.equal(enqueued.status, "REQUESTED");

  const status = await runExternalCreativeCriticQueue([
    "status",
    "--queue-root",
    queueRoot,
    "--request-id",
    enqueued.request_id,
  ]);
  assert.equal(status.status, "REQUESTED");

  const ingested = await runExternalCreativeCriticQueue([
    "ingest",
    "--queue-root",
    queueRoot,
    "--request-id",
    enqueued.request_id,
    "--response",
    responsePath,
    "--now",
    "2026-07-29T09:01:00.000Z",
  ]);
  assert.equal(ingested.status, "CRITIQUE_READY");
  assert.equal(ingested.safety.network_used, false);
  assert.equal(ingested.safety.publish_authority, false);

  const swept = await runExternalCreativeCriticQueue([
    "sweep",
    "--queue-root",
    queueRoot,
    "--now",
    "2026-07-29T09:02:00.000Z",
  ]);
  assert.equal(swept.already_terminal, 1);
  assert.equal(swept.safety.network_used, false);
});

test("CLI can explicitly bind a queue beneath the configured Pulse state root", async (t) => {
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-state-root-"),
  );
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const inputRoot = path.join(stateRoot, "input");
  await fs.mkdir(inputRoot, { recursive: true });
  const queueRoot = path.join(stateRoot, "external-creative-critic");
  const inputPath = path.join(inputRoot, "input.json");
  await fs.writeFile(
    inputPath,
    `${JSON.stringify(validInput(), null, 2)}\n`,
    "utf8",
  );

  const enqueued = await runExternalCreativeCriticQueue([
    "enqueue",
    "--state-root",
    stateRoot,
    "--queue-root",
    queueRoot,
    "--input",
    inputPath,
    "--lane-id",
    "evergreen_short",
    "--candidate-revision-sha256",
    "8".repeat(64),
    "--timeout-seconds",
    "300",
    "--now",
    "2026-07-29T09:00:00.000Z",
  ]);

  assert.equal(enqueued.status, "REQUESTED");
  assert.equal(
    enqueued.request_manifest_path.startsWith(queueRoot),
    true,
  );
});

test("status refuses a junction inserted inside the queue after enqueue", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-critic-junction-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queueRoot = path.join(root, "queue");
  const request = await enqueueExternalCreativeCriticRequest({
    queueRoot,
    input: validInput(),
    laneId: "evergreen_short",
    candidateRevisionSha256: "4".repeat(64),
    now: "2026-07-29T09:00:00.000Z",
    timeoutMs: 300_000,
    allowedRoots: [root],
  });
  const requestKey = request.request_id.slice("sha256:".length);
  const requestDir = path.join(queueRoot, "requests", requestKey);
  const targetDir = path.join(root, "junction-target");
  await fs.cp(requestDir, targetDir, { recursive: true });
  await fs.rm(requestDir, { recursive: true, force: true });
  try {
    await fs.symlink(targetDir, requestDir, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`junction creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    getExternalCreativeCriticQueueStatus({
      queueRoot,
      requestId: request.request_id,
      allowedRoots: [root],
    }),
    /critic_queue_path_link_forbidden:request/,
  );
});
