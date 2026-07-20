"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  bindEvidenceIntegrity,
} = require("../weekly-commercial-scorecard");

const RECORD_TYPE_CONTRACTS = Object.freeze({
  platform_earnings: Object.freeze({
    entry_kind: "revenue",
    stage: "platform_receivable",
    revenue_type: "variable",
    evidence_types: Object.freeze(["platform_earnings_statement"]),
  }),
  platform_payout: Object.freeze({
    entry_kind: "revenue",
    stage: "cash_received",
    revenue_type: "variable",
    evidence_types: Object.freeze(["platform_payout_statement"]),
  }),
  affiliate_approved_commission: Object.freeze({
    entry_kind: "revenue",
    stage: "booked_revenue",
    revenue_type: "variable",
    evidence_types: Object.freeze(["affiliate_network_approved_commission"]),
  }),
  affiliate_payment: Object.freeze({
    entry_kind: "revenue",
    stage: "cash_received",
    revenue_type: "variable",
    evidence_types: Object.freeze(["affiliate_network_payment_statement"]),
  }),
  sponsor_invoice: Object.freeze({
    entry_kind: "revenue",
    stage: "booked_revenue",
    revenue_type: "variable",
    evidence_types: Object.freeze(["issued_invoice"]),
  }),
  sponsor_remittance: Object.freeze({
    entry_kind: "revenue",
    stage: "cash_received",
    revenue_type: "variable",
    evidence_types: Object.freeze(["sponsor_remittance_advice"]),
  }),
  provider_invoice: Object.freeze({
    entry_kind: "cost",
    cost_type: "direct_production",
    evidence_types: Object.freeze(["provider_invoice"]),
  }),
  provider_usage: Object.freeze({
    entry_kind: "cost",
    cost_type: "direct_production",
    evidence_types: Object.freeze(["provider_usage_statement"]),
  }),
  operator_time: Object.freeze({
    entry_kind: "cost",
    cost_type: "labour_replacement",
    evidence_types: Object.freeze(["operator_time_log"]),
  }),
});

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function money(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalisePlatform(value) {
  const platform = clean(value).toLowerCase();
  const aliases = {
    youtube_shorts: "youtube",
    instagram_reels: "instagram_reel",
    facebook_reels: "facebook_reel",
  };
  return aliases[platform] || platform;
}

function utcDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateText(date) {
  return date.toISOString().slice(0, 10);
}

function publishedWeekCohort(publishedAt) {
  const date = utcDate(publishedAt);
  if (!date) return null;
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${dateText(start)}/${dateText(end)}`;
}

function readSourceLedger(sourceLedgerPath) {
  if (!sourceLedgerPath) throw new Error("sourceLedgerPath is required");
  const resolved = path.resolve(sourceLedgerPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("sourceLedgerPath must reference a non-empty file");
  }
  const bytes = fs.readFileSync(resolved);
  return {
    path: resolved,
    bytes,
    payload: JSON.parse(bytes.toString("utf8")),
    sha256: sha256(bytes),
    size_bytes: stat.size,
  };
}

function readPublicationSnapshot(publicationSnapshotPath) {
  if (!publicationSnapshotPath) return null;
  const resolved = path.resolve(publicationSnapshotPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("publicationSnapshotPath must reference a non-empty file");
  }
  const bytes = fs.readFileSync(resolved);
  const payload = JSON.parse(bytes.toString("utf8"));
  return {
    path: resolved,
    bytes,
    payload,
    sha256: sha256(bytes),
    size_bytes: stat.size,
  };
}

function publishedIndex(platformPosts = []) {
  const index = new Map();
  for (const row of asArray(platformPosts)) {
    if (clean(row?.status).toLowerCase() !== "published") continue;
    const platform = normalisePlatform(row?.platform);
    const externalId = clean(row?.external_id);
    const storyId = clean(row?.story_id);
    if (!platform || !externalId || !storyId) continue;
    const key = `${platform}:${externalId}`;
    const rows = index.get(key) || [];
    rows.push(row);
    index.set(key, rows);
  }
  return index;
}

function publicationRowsFromPayload(payload = {}) {
  const directRows = asArray(payload.platform_posts || payload.platformPosts);
  if (directRows.length) {
    return {
      format: "platform_posts_snapshot",
      rows: directRows,
    };
  }
  const rows = [];
  for (const story of asArray(payload.stories)) {
    const storyId = clean(story.story_id || story.id);
    for (const [platform, evidence] of Object.entries(story.platform_evidence || {})) {
      const externalId = clean(evidence?.external_id);
      if (!storyId || !externalId) continue;
      rows.push({
        story_id: storyId,
        platform,
        status: "published",
        external_id: externalId,
        external_url: clean(evidence?.external_url) || null,
        published_at: clean(evidence?.published_at) || null,
      });
    }
  }
  return {
    format: "published_commercial_reconciliation",
    rows,
  };
}

function allocationEntryId(recordId, allocation, index) {
  return [
    recordId,
    normalisePlatform(allocation.platform),
    clean(allocation.external_id),
    index + 1,
  ].filter(Boolean).join(":");
}

function allocateCommercialEvidenceLedger({
  sourceLedgerPath,
  evidenceRoot = null,
  platformPosts = [],
  publicationSnapshotPath = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const sourceLedger = readSourceLedger(sourceLedgerPath);
  const publicationSnapshot = readPublicationSnapshot(publicationSnapshotPath);
  const publicationMaterial = publicationSnapshot
    ? publicationRowsFromPayload(publicationSnapshot.payload)
    : {
        format: "in_memory_platform_posts",
        rows: platformPosts,
      };
  const publicationRows = publicationMaterial.rows;
  const root = path.resolve(evidenceRoot || path.dirname(sourceLedger.path));
  const records = asArray(
    sourceLedger.payload.evidence_records || sourceLedger.payload.evidenceRecords,
  );
  const recordIdCounts = new Map();
  records.forEach((record, index) => {
    const recordId = clean(record?.id) || `record-${index + 1}`;
    recordIdCounts.set(recordId, (recordIdCounts.get(recordId) || 0) + 1);
  });
  const publications = publishedIndex(publicationRows);
  const revenueEntries = [];
  const costEntries = [];
  const recordReports = [];
  const blockers = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const recordId = clean(record.id) || `record-${recordIndex + 1}`;
    const contract = RECORD_TYPE_CONTRACTS[clean(record.record_type).toLowerCase()];
    const amountStatus = clean(record.amount_status).toLowerCase() || "not_provided";
    const amount = money(record.amount_gbp);
    const evidence = asArray(record.evidence).map((item) =>
      bindEvidenceIntegrity(item, {
        evidenceRoot: root,
        inputLedgerBound: true,
      }));
    const allocations = asArray(record.allocations);
    const recordBlockers = [];
    const unavailableReasons = [];
    const amountUnavailable = amountStatus === "unknown" || amountStatus === "not_provided";

    if (recordIdCounts.get(recordId) > 1) recordBlockers.push("duplicate_record_id");
    if (!contract) recordBlockers.push("unsupported_record_type");
    if (amountUnavailable) unavailableReasons.push(`amount_${amountStatus}`);
    else if (amountStatus !== "verified") recordBlockers.push("amount_status_invalid");
    if (amountStatus === "verified" && amount === null) {
      recordBlockers.push("verified_amount_invalid");
    }
    if (!allocations.length) recordBlockers.push("allocations_missing");
    if (!evidence.length) recordBlockers.push("evidence_missing");
    for (const item of evidence) {
      if (!item.integrity_verified) {
        recordBlockers.push(`evidence_${item.integrity_status}`);
      }
    }
    if (
      contract &&
      !evidence.some((item) =>
        item.evidence_class === "primary" &&
        contract.evidence_types.includes(item.evidence_type))
    ) {
      recordBlockers.push("qualified_primary_evidence_missing");
    }

    const resolvedAllocations = [];
    for (let allocationIndex = 0; allocationIndex < allocations.length; allocationIndex += 1) {
      const allocation = allocations[allocationIndex];
      const platform = normalisePlatform(allocation.platform);
      const externalId = clean(allocation.external_id);
      const allocationAmount = money(allocation.amount_gbp);
      const allocationBasis = clean(allocation.allocation_basis);
      const matches = publications.get(`${platform}:${externalId}`) || [];
      if (!platform || !externalId) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_publication_identity_missing`);
        continue;
      }
      if (matches.length !== 1) {
        recordBlockers.push(
          `allocation_${allocationIndex + 1}_${matches.length ? "publication_ambiguous" : "publication_not_found"}`,
        );
        continue;
      }
      if (!amountUnavailable && allocationAmount === null) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_amount_invalid`);
        continue;
      }
      if (!allocationBasis) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_basis_missing`);
        continue;
      }
      const publication = matches[0];
      const cohortId = publishedWeekCohort(publication.published_at);
      if (!cohortId) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_published_at_invalid`);
        continue;
      }
      const declaredStoryId = clean(allocation.story_id);
      if (
        declaredStoryId &&
        declaredStoryId !== clean(publication.story_id)
      ) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_story_id_mismatch`);
        continue;
      }
      const declaredCohortId = clean(allocation.cohort_id);
      if (declaredCohortId && declaredCohortId !== cohortId) {
        recordBlockers.push(`allocation_${allocationIndex + 1}_cohort_id_mismatch`);
        continue;
      }
      resolvedAllocations.push({
        index: allocationIndex,
        amount_gbp: allocationAmount,
        allocation_basis: allocationBasis,
        scope: {
          story_id: clean(publication.story_id),
          platform,
          external_id: externalId,
          cohort_id: cohortId,
        },
      });
    }

    const allocatedAmount = amountUnavailable
      ? null
      : money(
        resolvedAllocations.reduce((total, allocation) => total + allocation.amount_gbp, 0),
      );
    if (
      amountStatus === "verified" &&
      amount !== null &&
      allocatedAmount !== amount
    ) {
      recordBlockers.push("allocation_total_mismatch");
    }

    const recordAccepted = recordBlockers.length === 0 && !amountUnavailable;
    const recordUnavailable = recordBlockers.length === 0 && amountUnavailable;
    if (recordAccepted) {
      for (const allocation of resolvedAllocations) {
        const entry = {
          id: allocationEntryId(recordId, allocation.scope, allocation.index),
          source_record_id: recordId,
          amount_gbp: allocation.amount_gbp,
          confidence: clean(record.confidence).toLowerCase() || "low",
          allocation_basis: allocation.allocation_basis,
          scope: allocation.scope,
          evidence: evidence.map((item) => ({
            evidence_id: item.evidence_id,
            evidence_type: item.evidence_type,
            evidence_class: item.evidence_class,
            source_uri: item.source_uri,
            confidence: item.confidence,
            sha256: item.sha256,
            size_bytes: item.size_bytes,
          })),
        };
        if (contract.entry_kind === "revenue") {
          revenueEntries.push({
            ...entry,
            stage: contract.stage,
            revenue_type: contract.revenue_type,
          });
        } else {
          costEntries.push({
            ...entry,
            cost_type: contract.cost_type,
            basis: clean(record.basis).toLowerCase() || "allocated_primary_evidence",
          });
        }
      }
    } else {
      if (!recordUnavailable) {
        blockers.push(...recordBlockers.map((blocker) => `${recordId}:${blocker}`));
      }
    }

    recordReports.push({
      id: recordId,
      record_type: clean(record.record_type).toLowerCase() || null,
      amount_status: amountStatus,
      claimed_amount_gbp: amount,
      allocated_amount_gbp: allocatedAmount,
      allocation_count: resolvedAllocations.length,
      status: recordAccepted
        ? "allocated"
        : recordUnavailable
          ? "unavailable"
          : "rejected",
      blockers: [...new Set(recordBlockers)],
      unavailable_reasons: unavailableReasons,
      bindings: resolvedAllocations.map((allocation) => ({
        allocation_basis: allocation.allocation_basis,
        amount_gbp: allocation.amount_gbp,
        scope: allocation.scope,
      })),
      evidence: evidence.map((item) => ({
        evidence_id: item.evidence_id,
        source_uri: item.source_uri,
        integrity_status: item.integrity_status,
        sha256: item.sha256,
        size_bytes: item.size_bytes,
      })),
    });
  }

  const allocatedRecordCount = recordReports.filter((record) => record.status === "allocated").length;
  const unavailableRecordCount = recordReports.filter(
    (record) => record.status === "unavailable",
  ).length;
  const rejectedRecordCount = recordReports.filter((record) => record.status === "rejected").length;
  const verdict = rejectedRecordCount
    ? "RED"
    : unavailableRecordCount || !records.length
      ? "AMBER"
      : "GREEN";

  return {
    ledger: {
      schema_version: 1,
      generated_at: generatedAt,
      revenue_entries: revenueEntries,
      cost_entries: costEntries,
      source_context: [],
    },
    report: {
      schema_version: 1,
      report_type: "commercial_evidence_allocation_report",
      generated_at: generatedAt,
      mode: "LOCAL_PROOF_READ_ONLY",
      verdict,
      source_ledger: {
        path: sourceLedger.path,
        sha256: sourceLedger.sha256,
        size_bytes: sourceLedger.size_bytes,
      },
      publication_snapshot: publicationSnapshot
        ? {
            status: "verified",
            format: publicationMaterial.format,
            path: publicationSnapshot.path,
            sha256: publicationSnapshot.sha256,
            size_bytes: publicationSnapshot.size_bytes,
          }
        : {
            status: "in_memory_unbound",
            format: publicationMaterial.format,
            path: null,
            sha256: null,
            size_bytes: 0,
          },
      evidence_root: root,
      source_record_count: records.length,
      allocated_record_count: allocatedRecordCount,
      unavailable_record_count: unavailableRecordCount,
      rejected_record_count: rejectedRecordCount,
      revenue_entry_count: revenueEntries.length,
      cost_entry_count: costEntries.length,
      supported_record_types: Object.keys(RECORD_TYPE_CONTRACTS),
      records: recordReports,
      blockers: [...new Set(blockers)],
      safety: {
        external_requests_made: false,
        production_db_mutated: false,
        publishing_performed: false,
        credentials_changed: false,
        values_fabricated: false,
      },
    },
  };
}

async function writeCommercialEvidenceAllocation(result = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeCommercialEvidenceAllocation requires outputDir");
  const resolvedOutputDir = path.resolve(outputDir);
  const ledgerPath = path.join(resolvedOutputDir, "allocated_commercial_ledger.json");
  const reportPath = path.join(
    resolvedOutputDir,
    "commercial_evidence_allocation_report.json",
  );
  await fs.ensureDir(resolvedOutputDir);
  await fs.writeJson(ledgerPath, result.ledger || {}, { spaces: 2 });
  const ledgerBytes = await fs.readFile(ledgerPath);
  const report = {
    ...(result.report || {}),
    allocated_ledger: {
      path: ledgerPath,
      sha256: sha256(ledgerBytes),
      size_bytes: ledgerBytes.length,
    },
  };
  await fs.writeJson(reportPath, report, { spaces: 2 });
  return {
    ledger_path: ledgerPath,
    report_path: reportPath,
    report,
  };
}

module.exports = {
  RECORD_TYPE_CONTRACTS,
  allocateCommercialEvidenceLedger,
  writeCommercialEvidenceAllocation,
};
