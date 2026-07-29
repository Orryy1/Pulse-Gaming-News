"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalSha256(value) {
  return sha256(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJson(filePath, value) {
  const bytes = jsonBytes(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function breakingSourcePacket(storyId, primarySourceUrl) {
  const base = {
    schema_version: "pulse-breaking-source-evidence-v1",
    generated_at: "2026-07-28T10:00:00.000Z",
    story_id: storyId,
    verdict: "OFFICIAL_CONFIRMED",
    verification_status: "CONFIRMED",
    confirmation_basis: "official_first_party",
    verified_for_planning: true,
    primary_source_url: primarySourceUrl,
    sources: [
      {
        status: "CAPTURED",
        source_id: "xbox-wire",
        source_class: "OFFICIAL_FIRST_PARTY",
        final_url: primarySourceUrl,
      },
    ],
    confirmed_claims: [
      {
        claim_key: "xbox.confirmed.story",
        support_count: 1,
      },
    ],
    blockers: [],
    publish_authority: false,
    safety: {
      headline_is_not_confirmation: true,
      no_external_posting_authority: true,
    },
  };
  const packetSha256 = canonicalSha256(base);
  return {
    ...base,
    packet_sha256: packetSha256,
    source_evidence_sha256: packetSha256,
    planner_evidence: {
      evidence_packet_schema: base.schema_version,
      verification_status: base.verification_status,
      confirmation_basis: base.confirmation_basis,
      primary_source_url: base.primary_source_url,
      source_evidence_sha256: packetSha256,
      verified_for_planning: base.verified_for_planning,
    },
  };
}

function rightsLedger(storyId, ownedMotionPath, ownedMotionSha256) {
  const base = {
    schema_version: "pulse-weekly-longform-rights-ledger-v1",
    story_id: storyId,
    generated_at: "2026-07-28T10:00:00.000Z",
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion-1",
        source_url: `pulse-owned://pulse-gaming/${storyId}/owned-motion-1`,
        local_path: path.join(path.dirname(ownedMotionPath), "asset.png"),
        asset_sha256: "a".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        owner: "Pulse Gaming",
        rights_evidence: {
          reference: ownedMotionPath,
          sha256: ownedMotionSha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
        usage: "owned_motion",
        motion_family: "owned_motion",
        exact_subject_motion_seconds: 12,
      },
    ],
    media_plan: {
      exact_subject_motion_seconds: 12,
      clip_count: 1,
      distinct_motion_families: 1,
      unknown_reuploads: 0,
      third_party_music: false,
      third_party_media: false,
    },
    owned_motion_manifest: {
      path: ownedMotionPath,
      file_sha256: ownedMotionSha256,
    },
    safety: {
      owned_motion_only: true,
      third_party_media_used: false,
      third_party_music_used: false,
      rights_synthesised: false,
    },
  };
  return {
    ...base,
    ledger_sha256: hashRightsLedger(base),
  };
}

function buildReadyInventoryFixture(
  root,
  {
    storyId = "rss_inventory_bridge_1",
    primarySourceUrl =
      "https://news.xbox.com/en-us/2026/07/28/inventory-bridge/",
  } = {},
) {
  const outputRoot = path.join(root, "output");
  const inventoryRoot = path.join(
    outputRoot,
    "editorial-inventory",
  );
  const inventoryDir = path.join(
    inventoryRoot,
    storyId,
    "inventory",
  );
  const evidencePath = path.join(
    outputRoot,
    "editorial-evidence",
    storyId,
    "source-evidence.json",
  );
  const motionPath = path.join(
    inventoryRoot,
    storyId,
    "owned-motion",
    storyId,
    "owned-motion-manifest.json",
  );
  const motionSha256 = writeJson(motionPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: storyId,
    assets: [],
  });
  const sourcePacket = breakingSourcePacket(
    storyId,
    primarySourceUrl,
  );
  const sourceFileSha256 = writeJson(evidencePath, sourcePacket);
  const weeklyPath = path.join(
    inventoryDir,
    "weekly-source-evidence.json",
  );
  const publicationClaim =
    "Xbox confirms a governed inventory bridge.";
  const publicationClaimSha256 = sha256(publicationClaim);
  const weeklySourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: storyId,
    source_url: primarySourceUrl,
    source_type: "official",
    publisher: "Xbox Wire",
    published_at: "2026-07-28T09:30:00.000Z",
    claims: [
      {
        claim_key: "xbox.confirmed.story",
        text: publicationClaim,
        claim_text_sha256: publicationClaimSha256,
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: primarySourceUrl,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: publicationClaimSha256,
      claims: [
        {
          claim_key: "xbox.confirmed.story",
          text: publicationClaim,
          claim_text_sha256: publicationClaimSha256,
        },
      ],
    },
  };
  const weeklyFileSha256 = writeJson(weeklyPath, {
    ...weeklySourceEvidence,
  });
  const rightsPath = path.join(inventoryDir, "rights-ledger.json");
  const ledger = rightsLedger(
    storyId,
    motionPath,
    motionSha256,
  );
  const rightsFileSha256 = writeJson(rightsPath, ledger);
  const advertiserPath = path.join(
    inventoryDir,
    "advertiser-safety-report.json",
  );
  const advertiserFileSha256 = writeJson(advertiserPath, {
    schema_version: "pulse-advertiser-safety-report-v1",
    story_id: storyId,
    verdict: "SAFE",
  });
  const registryPath = path.join(
    inventoryDir,
    "governed-editorial-inventory.json",
  );
  const registryBase = {
    schema_version: "pulse-governed-editorial-inventory-v1",
    generated_at: "2026-07-28T10:00:00.000Z",
    story: {
      id: storyId,
      title: "Xbox confirms a governed inventory bridge",
      franchise: "Xbox",
      platform: "xbox",
      topic_key: "inventory-bridge",
      published_at: "2026-07-28T09:30:00.000Z",
      primary_source_url: primarySourceUrl,
      verification_status: "CONFIRMED",
    },
    breaking_source_evidence: {
      path: evidencePath,
      file_sha256: sourceFileSha256,
      canonical_sha256: sourcePacket.packet_sha256,
    },
    weekly_source_evidence: {
      path: weeklyPath,
      file_sha256: weeklyFileSha256,
    },
    rights_ledger: {
      path: rightsPath,
      file_sha256: rightsFileSha256,
      canonical_sha256: ledger.ledger_sha256,
    },
    owned_motion_manifest: {
      path: motionPath,
      file_sha256: motionSha256,
    },
    advertiser_safety_report: {
      path: advertiserPath,
      file_sha256: advertiserFileSha256,
    },
    verdict: "READY",
    blockers: [],
    safety: {
      mode: "LOCAL_PROOF",
      local_proof: true,
      local_proof_only: true,
      claims_synthesised: false,
      rights_synthesised: false,
      third_party_media_included: false,
      third_party_music_included: false,
      network_used: false,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      scheduler_authority_created: false,
      external_posting_authorised: false,
    },
  };
  const registry = {
    ...registryBase,
    inventory_sha256: canonicalSha256(registryBase),
  };
  const registryFileSha256 = writeJson(registryPath, registry);

  return {
    root,
    outputRoot,
    inventoryRoot,
    inventoryDir,
    storyId,
    primarySourceUrl,
    registry,
    registryPath,
    registryFileSha256,
    sourcePacket,
    sourcePath: evidencePath,
    sourceFileSha256,
    weeklySourceEvidence,
    weeklyPath,
    weeklyFileSha256,
    ledger,
    rightsPath,
    rightsFileSha256,
    motionPath,
    motionSha256,
    writeJson,
    canonicalSha256,
  };
}

module.exports = {
  buildReadyInventoryFixture,
  canonicalSha256,
  writeJson,
};
