"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  CONFIRMATION,
  main,
  parseArgs,
  usage,
} = require("../../tools/evergreen-motion-coverage-completion");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-evergreen-motion-cli-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workOrderPath = path.join(
    root,
    "evergreen-motion-coverage-repair-work-order.json",
  );
  fs.writeFileSync(workOrderPath, "{}\n", "utf8");
  const request = {
    generated_at: "2026-07-28T12:00:00.000Z",
    story_id: "story-local-motion",
    candidate_id: "candidate-local-motion",
    repair_work_order: {
      path: workOrderPath,
      file_sha256: "1".repeat(64),
      work_order_sha256: "2".repeat(64),
    },
    materialisation_receipt: {
      path: "evergreen-motion-materialisation-receipt.json",
      file_sha256: "5".repeat(64),
    },
    source_binding: {
      source_evidence_path: "source-evidence.json",
      source_evidence_packet_sha256: "3".repeat(64),
    },
    baseline_rights_ledger: {
      path: "baseline-rights-ledger.json",
      ledger_sha256: "4".repeat(64),
    },
    amended_rights_ledger: {
      path: "amended-rights-ledger.json",
      file_sha256: "6".repeat(64),
      ledger_sha256: "7".repeat(64),
    },
    segments: [],
  };
  const requestPath = path.join(root, "request.json");
  const requestBytes = Buffer.from(
    `${JSON.stringify(request, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(requestPath, requestBytes);
  return {
    root,
    request,
    requestPath,
    requestSha256: sha256(requestBytes),
    workOrderPath,
  };
}

test("parseArgs exposes separate create and validate operator actions", () => {
  const create = parseArgs([
    "create",
    "--request",
    "request.json",
    "--confirm-request-sha256",
    "a".repeat(64),
    "--confirm",
    CONFIRMATION,
  ]);
  assert.equal(create.action, "create");
  assert.equal(create.requestPath, "request.json");
  assert.equal(create.confirmation, CONFIRMATION);

  const validate = parseArgs([
    "validate",
    "--manifest",
    "completion.json",
    "--manifest-file-sha256",
    "b".repeat(64),
    "--expected-story-id",
    "story-1",
    "--expected-source-packet-sha256",
    "c".repeat(64),
    "--expected-baseline-ledger-sha256",
    "d".repeat(64),
  ]);
  assert.equal(validate.action, "validate");
  assert.equal(validate.manifestPath, "completion.json");
});

test("create refuses local mutation without the exact request hash and explicit local-only confirmation", async (t) => {
  const fx = fixture(t);
  let materializeCalls = 0;
  let stdout = "";

  const result = await main(
    ["create", "--request", fx.requestPath],
    {
      stdout: { write: (value) => (stdout += value) },
      async materialize() {
        materializeCalls += 1;
        return { verdict: "READY" };
      },
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(materializeCalls, 0);
  assert.ok(result.blockers.includes("confirmation_phrase_mismatch"));
  assert.ok(result.blockers.includes("request_sha256_confirmation_mismatch"));
  assert.equal(JSON.parse(stdout).safety.publish_authority_created, false);
});

test("create passes a hash-confirmed local request to the immutable completion materialiser", async (t) => {
  const fx = fixture(t);
  let received = null;

  const result = await main(
    [
      "create",
      "--request",
      fx.requestPath,
      "--confirm-request-sha256",
      fx.requestSha256,
      "--confirm",
      CONFIRMATION,
    ],
    {
      stdout: { write() {} },
      async materialize(input) {
        received = input;
        return {
          verdict: "READY",
          blockers: [],
          created: true,
          manifest_sha256: "e".repeat(64),
          output_file_sha256: "f".repeat(64),
          output_path: input.output_path,
          safety: {
            network_used: false,
            publish_authority_created: false,
          },
        };
      },
    },
  );

  assert.equal(result.verdict, "READY");
  assert.equal(received.request.story_id, fx.request.story_id);
  assert.equal(
    received.expected_source_packet_sha256,
    fx.request.source_binding.source_evidence_packet_sha256,
  );
  assert.equal(
    received.expected_baseline_rights_ledger_sha256,
    fx.request.baseline_rights_ledger.ledger_sha256,
  );
  assert.equal(
    received.request.materialisation_receipt.path,
    path.join(
      fx.root,
      "evergreen-motion-materialisation-receipt.json",
    ),
  );
  assert.equal(
    received.request.amended_rights_ledger.path,
    path.join(fx.root, "amended-rights-ledger.json"),
  );
  assert.equal(
    received.output_path,
    path.join(
      path.dirname(fx.workOrderPath),
      "evergreen-motion-coverage-completion.json",
    ),
  );
});

test("validate requires independent manifest, story, source and baseline confirmations", async () => {
  let received = null;
  const result = await main(
    [
      "validate",
      "--manifest",
      "completion.json",
      "--manifest-file-sha256",
      "a".repeat(64),
      "--expected-story-id",
      "story-1",
      "--expected-source-packet-sha256",
      "b".repeat(64),
      "--expected-baseline-ledger-sha256",
      "c".repeat(64),
    ],
    {
      stdout: { write() {} },
      async validate(input) {
        received = input;
        return {
          verdict: "READY",
          blockers: [],
          safety: {
            network_used: false,
            publish_authority_created: false,
          },
        };
      },
    },
  );

  assert.equal(result.verdict, "READY");
  assert.equal(received.expected_story_id, "story-1");
  assert.equal(
    received.reference.file_sha256,
    "a".repeat(64),
  );
});

test("operator help and implementation promise no acquisition, database, OAuth or publishing authority", () => {
  assert.match(usage(), /already-local/i);
  assert.match(usage(), /never downloads/i);
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "tools",
      "evergreen-motion-coverage-completion.js",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /require\([^)]*(?:db|oauth|publisher|upload_)/i,
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch|axios|https?\.request)\s*\(/i,
  );
});

test("package.json exposes the local evergreen motion-completion operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "package.json"),
      "utf8",
    ),
  );
  assert.equal(
    packageJson.scripts["ops:evergreen-motion-completion"],
    "node tools/evergreen-motion-coverage-completion.js",
  );
});
