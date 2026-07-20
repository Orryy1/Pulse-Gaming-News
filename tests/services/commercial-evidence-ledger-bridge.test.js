"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  allocateCommercialEvidenceLedger,
} = require("../../lib/intelligence/commercial-evidence-ledger-bridge");

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

test("commercial evidence bridge binds a materialised platform earning to its published story", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-bridge-"));
  const evidenceContents = "external_id,earnings_gbp\nyt-video-1,12.34\n";
  fs.outputFileSync(
    path.join(root, "evidence", "youtube-earnings.csv"),
    evidenceContents,
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "youtube-earnings-july",
        record_type: "platform_earnings",
        amount_status: "verified",
        amount_gbp: 12.34,
        evidence: [
          {
            evidence_id: "youtube-earnings-export",
            evidence_type: "platform_earnings_statement",
            evidence_class: "primary",
            source_uri: "evidence/youtube-earnings.csv",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 12.34,
            allocation_basis: "statement_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
    generatedAt: "2026-07-20T10:00:00.000Z",
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.allocated_record_count, 1);
  assert.equal(result.ledger.revenue_entries.length, 1);
  assert.equal(result.ledger.cost_entries.length, 0);
  assert.deepEqual(result.ledger.revenue_entries[0].scope, {
    story_id: "story-1",
    platform: "youtube",
    external_id: "yt-video-1",
    cohort_id: "2026-07-13/2026-07-19",
  });
  assert.equal(result.ledger.revenue_entries[0].stage, "platform_receivable");
  assert.equal(result.ledger.revenue_entries[0].amount_gbp, 12.34);
  assert.equal(
    result.ledger.revenue_entries[0].evidence[0].sha256,
    sha256(evidenceContents),
  );
  assert.equal(
    result.report.source_ledger.sha256,
    sha256(fs.readFileSync(sourceLedgerPath)),
  );
});

test("commercial evidence bridge preserves an evidence-backed zero cost", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-zero-"));
  fs.outputFileSync(
    path.join(root, "evidence", "provider-invoice.txt"),
    "Invoice total: GBP 0.00\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "provider-free-tier",
        record_type: "provider_invoice",
        amount_status: "verified",
        amount_gbp: 0,
        evidence: [
          {
            evidence_type: "provider_invoice",
            evidence_class: "primary",
            source_uri: "evidence/provider-invoice.txt",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 0,
            allocation_basis: "invoice_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.ledger.cost_entries.length, 1);
  assert.equal(result.ledger.cost_entries[0].cost_type, "direct_production");
  assert.equal(result.ledger.cost_entries[0].amount_gbp, 0);
  assert.equal(result.report.records[0].amount_status, "verified");
  assert.equal(result.report.records[0].status, "allocated");
});

test("commercial evidence bridge keeps an unknown evidenced amount unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-unknown-"));
  fs.outputFileSync(
    path.join(root, "evidence", "operator-time.csv"),
    "external_id,hours\nyt-video-1,unknown\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "operator-time-unpriced",
        record_type: "operator_time",
        amount_status: "unknown",
        evidence: [
          {
            evidence_type: "operator_time_log",
            evidence_class: "primary",
            source_uri: "evidence/operator-time.csv",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            allocation_basis: "time_log_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "AMBER");
  assert.equal(result.report.unavailable_record_count, 1);
  assert.equal(result.report.rejected_record_count, 0);
  assert.equal(result.ledger.cost_entries.length, 0);
  assert.equal(result.report.records[0].status, "unavailable");
  assert.equal(result.report.records[0].amount_status, "unknown");
  assert.equal(result.report.records[0].claimed_amount_gbp, null);
  assert.deepEqual(result.report.records[0].bindings[0].scope, {
    story_id: "story-1",
    platform: "youtube",
    external_id: "yt-video-1",
    cohort_id: "2026-07-13/2026-07-19",
  });
  assert.deepEqual(result.report.records[0].unavailable_reasons, ["amount_unknown"]);
});

test("commercial evidence bridge classifies every supported revenue and cost evidence family", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-families-"));
  const contracts = [
    ["platform_payout", "platform_payout_statement", "revenue", "cash_received"],
    [
      "affiliate_approved_commission",
      "affiliate_network_approved_commission",
      "revenue",
      "booked_revenue",
    ],
    [
      "affiliate_payment",
      "affiliate_network_payment_statement",
      "revenue",
      "cash_received",
    ],
    ["sponsor_invoice", "issued_invoice", "revenue", "booked_revenue"],
    [
      "sponsor_remittance",
      "sponsor_remittance_advice",
      "revenue",
      "cash_received",
    ],
    ["provider_usage", "provider_usage_statement", "cost", "direct_production"],
  ];
  const evidenceRecords = contracts.map(
    ([recordType, evidenceType], index) => {
      const sourceUri = `evidence/${recordType}.txt`;
      fs.outputFileSync(path.join(root, sourceUri), `${recordType} primary evidence\n`);
      return {
        id: `${recordType}-${index + 1}`,
        record_type: recordType,
        amount_status: "verified",
        amount_gbp: index + 1,
        evidence: [
          {
            evidence_type: evidenceType,
            evidence_class: "primary",
            source_uri: sourceUri,
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: index + 1,
            allocation_basis: "primary_document_line_item",
          },
        ],
      };
    },
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, { evidence_records: evidenceRecords });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.allocated_record_count, contracts.length);
  for (const [recordType, , entryKind, accountingType] of contracts) {
    const entries = entryKind === "revenue"
      ? result.ledger.revenue_entries
      : result.ledger.cost_entries;
    const entry = entries.find((candidate) =>
      candidate.source_record_id.startsWith(`${recordType}-`));
    assert.ok(entry, `${recordType} should create an allocated ${entryKind} entry`);
    if (entryKind === "revenue") assert.equal(entry.stage, accountingType);
    else assert.equal(entry.cost_type, accountingType);
  }
});

test("commercial evidence bridge rejects a materialised file whose claimed hash does not match", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-hash-red-"));
  fs.outputFileSync(
    path.join(root, "evidence", "youtube-earnings.csv"),
    "external_id,earnings_gbp\nyt-video-1,12.34\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "tampered-youtube-earnings",
        record_type: "platform_earnings",
        amount_status: "verified",
        amount_gbp: 12.34,
        evidence: [
          {
            evidence_type: "platform_earnings_statement",
            evidence_class: "primary",
            source_uri: "evidence/youtube-earnings.csv",
            sha256: "0".repeat(64),
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 12.34,
            allocation_basis: "statement_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "RED");
  assert.equal(result.ledger.revenue_entries.length, 0);
  assert.equal(
    result.report.records[0].evidence[0].integrity_status,
    "sha256_mismatch",
  );
  assert.ok(
    result.report.blockers.includes(
      "tampered-youtube-earnings:evidence_sha256_mismatch",
    ),
  );
});

test("commercial evidence bridge rejects a declared story scope that conflicts with publication truth", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-scope-red-"));
  fs.outputFileSync(
    path.join(root, "evidence", "youtube-earnings.csv"),
    "external_id,earnings_gbp\nyt-video-1,12.34\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "wrong-story-allocation",
        record_type: "platform_earnings",
        amount_status: "verified",
        amount_gbp: 12.34,
        evidence: [
          {
            evidence_type: "platform_earnings_statement",
            evidence_class: "primary",
            source_uri: "evidence/youtube-earnings.csv",
          },
        ],
        allocations: [
          {
            story_id: "story-2",
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 12.34,
            allocation_basis: "statement_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "RED");
  assert.equal(result.ledger.revenue_entries.length, 0);
  assert.ok(
    result.report.blockers.includes(
      "wrong-story-allocation:allocation_1_story_id_mismatch",
    ),
  );
});

test("commercial evidence bridge rejects duplicate source record identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-duplicate-red-"));
  for (const suffix of ["a", "b"]) {
    fs.outputFileSync(
      path.join(root, "evidence", `payout-${suffix}.txt`),
      `Payout ${suffix}: GBP 5.00\n`,
    );
  }
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: ["a", "b"].map((suffix) => ({
      id: "duplicate-payout",
      record_type: "platform_payout",
      amount_status: "verified",
      amount_gbp: 5,
      evidence: [
        {
          evidence_type: "platform_payout_statement",
          evidence_class: "primary",
          source_uri: `evidence/payout-${suffix}.txt`,
        },
      ],
      allocations: [
        {
          platform: "youtube",
          external_id: "yt-video-1",
          amount_gbp: 5,
          allocation_basis: "statement_line_item",
        },
      ],
    })),
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "RED");
  assert.equal(result.ledger.revenue_entries.length, 0);
  assert.equal(result.report.rejected_record_count, 2);
  assert.ok(
    result.report.blockers.every((blocker) =>
      blocker === "duplicate-payout:duplicate_record_id"),
  );
});

test("commercial evidence bridge never treats a null claimed amount as verified zero", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-null-red-"));
  fs.outputFileSync(
    path.join(root, "evidence", "provider-invoice.txt"),
    "Invoice amount not provided\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "null-provider-cost",
        record_type: "provider_invoice",
        amount_status: "verified",
        amount_gbp: null,
        evidence: [
          {
            evidence_type: "provider_invoice",
            evidence_class: "primary",
            source_uri: "evidence/provider-invoice.txt",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: null,
            allocation_basis: "invoice_line_item",
          },
        ],
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    evidenceRoot: root,
    platformPosts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  assert.equal(result.report.verdict, "RED");
  assert.equal(result.ledger.cost_entries.length, 0);
  assert.ok(
    result.report.blockers.includes(
      "null-provider-cost:verified_amount_invalid",
    ),
  );
});

test("commercial evidence bridge consumes the existing published reconciliation report shape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-reconcile-shape-"));
  fs.outputFileSync(
    path.join(root, "evidence", "youtube-earnings.csv"),
    "external_id,earnings_gbp\nyt-video-1,12.34\n",
  );
  const sourceLedgerPath = path.join(root, "source-ledger.json");
  fs.writeJsonSync(sourceLedgerPath, {
    evidence_records: [
      {
        id: "youtube-earnings",
        record_type: "platform_earnings",
        amount_status: "verified",
        amount_gbp: 12.34,
        evidence: [
          {
            evidence_type: "platform_earnings_statement",
            evidence_class: "primary",
            source_uri: "evidence/youtube-earnings.csv",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 12.34,
            allocation_basis: "statement_line_item",
          },
        ],
      },
    ],
  });
  const publicationSnapshotPath = path.join(
    root,
    "published_commercial_reconciliation.json",
  );
  fs.writeJsonSync(publicationSnapshotPath, {
    schema_version: 1,
    totals: { published_stories: 1, traced_stories: 1 },
    stories: [
      {
        story_id: "story-1",
        trace_status: "traced",
        platform_evidence: {
          youtube: {
            external_id: "yt-video-1",
            external_url: "https://youtube.com/shorts/yt-video-1",
            published_at: "2026-07-18 18:00:00",
          },
        },
      },
    ],
  });

  const result = allocateCommercialEvidenceLedger({
    sourceLedgerPath,
    publicationSnapshotPath,
    evidenceRoot: root,
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(
    result.report.publication_snapshot.format,
    "published_commercial_reconciliation",
  );
  assert.equal(result.ledger.revenue_entries[0].scope.story_id, "story-1");
  assert.equal(result.ledger.revenue_entries[0].scope.external_id, "yt-video-1");
});
