"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  assessRightsLedger,
} = require("./publication-evidence-gates");
const {
  findEvergreenMotionCoverageCompletionReference,
  validateEvergreenMotionCoverageCompletion,
} = require("./evergreen-motion-coverage-completion");

const SCHEMA_VERSION = "pulse-evergreen-autonomous-input-adapter-v1";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const RIGHTS_BASIS_MAP = Object.freeze({
  OWNED: "owned_capture",
  LICENSED: "licensed",
  PERMISSION_GRANTED: "licensed",
  PLATFORM_AUTHORISED: "official_publisher_policy",
  TRANSFORMATIVE_EDITORIAL_USE: "bounded_editorial_excerpt",
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseSha256(value) {
  const result = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(result) ? result : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function hashObject(value) {
  return sha256(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean))];
}

function resolveDeclaredPath(value, rootDir) {
  const declared = String(value ?? "").trim();
  if (!declared) return null;
  return path.resolve(path.isAbsolute(declared) ? declared : path.join(rootDir, declared));
}

async function observeFile({
  declaredPath,
  expectedSha256,
  rootDir,
  prefix,
  maximumBytes,
  json = false,
}) {
  const blockers = [];
  const absolutePath = resolveDeclaredPath(declaredPath, rootDir);
  const expected = normaliseSha256(expectedSha256);
  if (!absolutePath) blockers.push(`${prefix}_path_required`);
  if (!expected) blockers.push(`${prefix}_file_sha256_required`);
  if (blockers.length) {
    return { blockers, path: absolutePath, sha256: null, value: null };
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_missing`],
      path: absolutePath,
      sha256: null,
      value: null,
    };
  }
  if (!stat.isFile()) {
    return {
      blockers: [`${prefix}_not_a_file`],
      path: absolutePath,
      sha256: null,
      value: null,
    };
  }
  if (stat.size <= 0 || stat.size > maximumBytes) {
    return {
      blockers: [`${prefix}_file_size_invalid`],
      path: absolutePath,
      sha256: null,
      value: null,
    };
  }
  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_unreadable`],
      path: absolutePath,
      sha256: null,
      value: null,
    };
  }
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expected) {
    blockers.push(`${prefix}_file_sha256_mismatch`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  return {
    blockers,
    path: absolutePath,
    sha256: observedSha256,
    byte_length: bytes.length,
    value,
  };
}

function explicitValue(containers, keys) {
  for (const container of containers) {
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      continue;
    }
    for (const key of keys) {
      if (
        Object.prototype.hasOwnProperty.call(container, key) &&
        container[key] !== undefined &&
        container[key] !== null &&
        String(container[key]).trim() !== ""
      ) {
        return container[key];
      }
    }
  }
  return null;
}

function evidenceReferences(entry, rootDir) {
  const story = entry.story;
  const extra = parseObject(story?._extra);
  const manifest = entry.manifest || {};
  const containers = [manifest, story, extra];
  const sourceRecord = parseObject(
    explicitValue(containers, ["source_evidence_ref", "source_evidence"]),
  );
  const rightsRecord = parseObject(
    explicitValue(containers, ["rights_ledger_ref", "rights_ledger"]),
  );
  const advertiserRecord = parseObject(
    explicitValue(containers, [
      "advertiser_safety_report_ref",
      "advertiser_safety_report",
    ]),
  );
  const completionRecord = parseObject(
    explicitValue(containers, [
      "evergreen_motion_completion_ref",
      "motion_completion_ref",
    ]),
  );
  return {
    rootDir,
    source: {
      path: explicitValue(
        [sourceRecord, ...containers],
        ["path", "source_evidence_path"],
      ),
      fileSha256: explicitValue(
        [sourceRecord, ...containers],
        ["file_sha256", "source_evidence_file_sha256"],
      ),
      canonicalSha256: explicitValue(
        [sourceRecord, ...containers],
        ["packet_sha256", "canonical_sha256", "source_evidence_sha256"],
      ),
    },
    rights: {
      path: explicitValue(
        [rightsRecord, ...containers],
        ["path", "rights_ledger_path"],
      ),
      fileSha256: explicitValue(
        [rightsRecord, ...containers],
        ["file_sha256", "sha256", "rights_ledger_file_sha256"],
      ),
      canonicalSha256: explicitValue(
        [rightsRecord, ...containers],
        [
          "canonical_sha256",
          "ledger_sha256",
          "rights_ledger_canonical_sha256",
        ],
      ),
    },
    advertiser: {
      path: explicitValue(
        [advertiserRecord, ...containers],
        ["path", "advertiser_safety_report_path"],
      ),
      fileSha256: explicitValue(
        [advertiserRecord, ...containers],
        ["file_sha256", "sha256", "advertiser_safety_report_sha256"],
      ),
    },
    completion: {
      path: explicitValue(
        [completionRecord, ...containers],
        [
          "path",
          "evergreen_motion_completion_path",
          "motion_completion_path",
        ],
      ),
      fileSha256: explicitValue(
        [completionRecord, ...containers],
        [
          "file_sha256",
          "sha256",
          "evergreen_motion_completion_file_sha256",
          "motion_completion_file_sha256",
        ],
      ),
    },
  };
}

function sourceManifest(packet) {
  return array(packet?.sources)
    .filter(
      (source) =>
        source?.status === "CAPTURED" &&
        /^https:\/\//i.test(text(source?.final_url)),
    )
    .map((source) => ({
      name: text(source.publisher || source.source_id),
      url: text(source.final_url),
      tier:
        text(source.source_class).toUpperCase() === "OFFICIAL_FIRST_PARTY"
          ? "official_publisher"
          : "trusted_press",
      source_id: text(source.source_id),
      provenance_sha256: normaliseSha256(source.provenance_sha256),
    }))
    .filter((source) => source.name && source.source_id)
    .sort(
      (left, right) =>
        left.source_id.localeCompare(right.source_id) ||
        left.url.localeCompare(right.url),
    );
}

function flattenConfirmedClaims(packet, storyId) {
  const sources = new Map(
    array(packet?.sources)
      .filter((source) => source?.status === "CAPTURED")
      .map((source) => [text(source.source_id), source]),
  );
  const blockers = [];
  const claims = [];
  for (const group of array(packet?.confirmed_claims)) {
    const claimKey = text(group?.claim_key);
    if (!claimKey) {
      blockers.push("source_confirmed_claim_key_required");
      continue;
    }
    for (const evidence of array(group?.evidence)) {
      const sourceId = text(evidence?.source_id);
      const source = sources.get(sourceId);
      const quote = String(evidence?.text ?? "");
      const quoteSha256 = sha256(Buffer.from(quote, "utf8"));
      const sourceClaim = array(source?.claims).find(
        (claim) =>
          text(claim?.claim_key) === claimKey &&
          String(claim?.text ?? "") === quote &&
          text(claim?.claim_sha256) === text(evidence?.claim_sha256) &&
          text(claim?.claim_text_sha256) === quoteSha256,
      );
      if (
        !source ||
        !sourceClaim ||
        !quote.trim() ||
        text(evidence?.final_url) !== text(source.final_url) ||
        text(evidence?.claim_text_sha256) !== quoteSha256
      ) {
        blockers.push("source_confirmed_quote_binding_invalid");
        continue;
      }
      const identity = sha256(
        Buffer.from(
          `${storyId}\0${claimKey}\0${sourceId}\0${sourceClaim.claim_sha256}`,
          "utf8",
        ),
      ).slice(0, 20);
      claims.push({
        id: `${storyId}-claim-${identity}`,
        subject: claimKey,
        text: quote,
        source_url: text(source.final_url),
        source_id: sourceId,
        claim_sha256: text(sourceClaim.claim_sha256),
        claim_text_sha256: quoteSha256,
      });
    }
  }
  claims.sort(
    (left, right) =>
      left.subject.localeCompare(right.subject) ||
      left.source_id.localeCompare(right.source_id) ||
      left.id.localeCompare(right.id),
  );
  if (claims.length < 3) blockers.push("verified_claim_inventory_too_thin");
  return { blockers: unique(blockers), claims };
}

async function assessSourceEvidence({ references, storyId }) {
  const observed = await observeFile({
    declaredPath: references.source.path,
    expectedSha256: references.source.fileSha256,
    rootDir: references.rootDir,
    prefix: "source_evidence",
    maximumBytes: MAXIMUM_EVIDENCE_BYTES,
    json: true,
  });
  const blockers = [...observed.blockers];
  const packet = observed.value || {};
  const validation = validateBreakingSourceEvidencePacket(packet);
  blockers.push(...validation.blockers);
  const declaredCanonicalSha256 = normaliseSha256(
    references.source.canonicalSha256,
  );
  if (!declaredCanonicalSha256) {
    blockers.push("source_evidence_canonical_sha256_required");
  } else if (
    declaredCanonicalSha256 !== validation.packet_sha256 ||
    declaredCanonicalSha256 !== normaliseSha256(packet.packet_sha256)
  ) {
    blockers.push("source_evidence_canonical_sha256_mismatch");
  }
  if (
    packet.verification_status !== "CONFIRMED" ||
    packet.verified_for_planning !== true
  ) {
    blockers.push("source_evidence_not_confirmed");
  }
  if (text(packet.story_id) !== storyId) {
    blockers.push("source_evidence_story_id_mismatch");
  }
  const manifest = sourceManifest(packet);
  if (manifest.length < 2) blockers.push("source_manifest_too_thin");
  if (!manifest.some((source) => source.tier === "official_publisher")) {
    blockers.push("source_manifest_official_source_required");
  }
  const flattened = flattenConfirmedClaims(packet, storyId);
  blockers.push(...flattened.blockers);
  return {
    blockers: unique(blockers).sort(),
    observed,
    packet,
    output: {
      schema_version: "pulse-evergreen-source-evidence-v1",
      verification_status: "CONFIRMED",
      verified_for_planning: true,
      packet_sha256: declaredCanonicalSha256,
      claims: flattened.claims,
      source_manifest: manifest.map(
        ({ source_id: _sourceId, provenance_sha256: _provenance, ...source }) =>
          source,
      ),
    },
  };
}

function assetPath(item, ledgerPath) {
  const declared = explicitValue([item], [
    "local_path",
    "asset_path",
    "materialised_path",
    "path",
  ]);
  if (!declared) return null;
  return path.resolve(
    path.isAbsolute(String(declared))
      ? String(declared)
      : path.join(path.dirname(ledgerPath), String(declared)),
  );
}

function validRightsSourceUrl(item, storyId) {
  const sourceUrl = text(item?.source_url);
  if (/^https:\/\//i.test(sourceUrl)) return true;
  if (
    text(item?.rights_basis).toUpperCase() !== "OWNED" ||
    text(item?.owner) !== "Pulse Gaming"
  ) {
    return false;
  }
  try {
    const parsed = new URL(sourceUrl);
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    return (
      parsed.protocol === "pulse-owned:" &&
      parsed.hostname === "pulse-gaming" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      segments.length === 2 &&
      segments[0] === storyId &&
      segments[1] === text(item?.item_id)
    );
  } catch {
    return false;
  }
}

async function assessRightsEvidence({ references, storyId }) {
  const observed = await observeFile({
    declaredPath: references.rights.path,
    expectedSha256: references.rights.fileSha256,
    rootDir: references.rootDir,
    prefix: "rights_ledger",
    maximumBytes: MAXIMUM_EVIDENCE_BYTES,
    json: true,
  });
  const blockers = [...observed.blockers];
  const ledger = observed.value || {};
  const declaredCanonicalSha256 = normaliseSha256(
    references.rights.canonicalSha256,
  );
  if (!declaredCanonicalSha256) {
    blockers.push("rights_ledger_canonical_sha256_required");
  }
  const assessment = assessRightsLedger(ledger, declaredCanonicalSha256);
  blockers.push(...assessment.blockers);
  if (text(ledger.story_id) !== storyId) {
    blockers.push("rights_ledger_story_id_mismatch");
  }
  if (
    declaredCanonicalSha256 &&
    normaliseSha256(ledger.ledger_sha256) !== declaredCanonicalSha256
  ) {
    blockers.push("rights_ledger_declared_canonical_sha256_mismatch");
  }
  const declaredMediaPlan = parseObject(ledger.media_plan);
  if (declaredMediaPlan.unknown_reuploads !== 0) {
    blockers.push(
      "rights_unknown_reuploads_zero_declaration_required",
    );
  }
  if (declaredMediaPlan.third_party_music !== false) {
    blockers.push(
      "rights_third_party_music_false_declaration_required",
    );
  }
  const records = [];
  const assetProvenance = [];
  const motionFamilies = new Set();
  let exactSubjectMotionSeconds = 0;
  for (const item of array(ledger.items).filter(
    (candidate) => candidate?.included_in_final === true,
  )) {
    const itemId = text(item?.item_id);
    const rightsBasis =
      RIGHTS_BASIS_MAP[text(item?.rights_basis).toUpperCase()] || null;
    const owner = text(item?.owner);
    const usage = text(item?.usage);
    const motionFamily = text(item?.motion_family);
    const motionSeconds = Number(item?.exact_subject_motion_seconds);
    if (!rightsBasis) blockers.push("rights_asset_basis_not_supported");
    if (!owner) blockers.push("rights_asset_owner_required");
    if (!usage) blockers.push("rights_asset_usage_required");
    if (!motionFamily) blockers.push("rights_asset_motion_family_required");
    if (!Number.isFinite(motionSeconds) || motionSeconds < 0) {
      blockers.push("rights_asset_exact_subject_motion_seconds_required");
    }
    const localPath = assetPath(item, observed.path || references.rootDir);
    const assetObserved = await observeFile({
      declaredPath: localPath,
      expectedSha256: item?.asset_sha256,
      rootDir: references.rootDir,
      prefix: "rights_asset",
      maximumBytes: MAXIMUM_ASSET_BYTES,
      json: false,
    });
    blockers.push(...assetObserved.blockers);
    if (
      !itemId ||
      !validRightsSourceUrl(item, storyId) ||
      text(item?.rights_decision).toUpperCase() !== "CLEARED"
    ) {
      blockers.push("rights_asset_record_invalid");
    }
    if (
      rightsBasis &&
      owner &&
      usage &&
      motionFamily &&
      Number.isFinite(motionSeconds) &&
      motionSeconds >= 0 &&
      assetObserved.blockers.length === 0
    ) {
      motionFamilies.add(motionFamily);
      exactSubjectMotionSeconds += motionSeconds;
      records.push({
        asset_id: itemId,
        owner,
        source_url: text(item.source_url),
        rights_basis: rightsBasis,
        usage,
        materialised_path: assetObserved.path,
        asset_sha256: assetObserved.sha256,
        motion_family: motionFamily,
        exact_subject_motion_seconds: motionSeconds,
      });
      assetProvenance.push({
        asset_id: itemId,
        path: assetObserved.path,
        sha256: assetObserved.sha256,
        byte_length: assetObserved.byte_length,
      });
    }
  }
  if (records.length < 5) blockers.push("rights_materialised_clip_inventory_too_thin");
  if (motionFamilies.size < 2) blockers.push("rights_motion_diversity_too_low");
  return {
    blockers: unique(blockers).sort(),
    observed,
    ledger,
    assessment,
    assetProvenance,
    output: {
      schema_version: "pulse-evergreen-rights-evidence-v1",
      decision: "CLEARED",
      ledger_sha256: declaredCanonicalSha256,
      media_plan: {
        exact_subject_motion_seconds: exactSubjectMotionSeconds,
        clip_count: records.length,
        distinct_motion_families: motionFamilies.size,
        unknown_reuploads: declaredMediaPlan.unknown_reuploads,
        third_party_music: declaredMediaPlan.third_party_music,
        rights_records: records,
      },
    },
  };
}

async function assessAdvertiserSafety({
  references,
  storyId,
  scores,
}) {
  if (!references.advertiser.path && !references.advertiser.fileSha256) {
    const exactScores = array(scores).filter(
      (score) => text(score?.story_id) === storyId,
    );
    const blockers = [];
    if (exactScores.length !== 1) {
      blockers.push(
        exactScores.length
          ? "advertiser_safety_score_ambiguous"
          : "advertiser_safety_green_score_or_report_required",
      );
    }
    const score = exactScores[0] || {};
    const hardStops = Array.isArray(score.hard_stops)
      ? score.hard_stops
      : (() => {
          try {
            const parsed = JSON.parse(String(score.hard_stops || ""));
            return Array.isArray(parsed) ? parsed : null;
          } catch {
            return null;
          }
        })();
    if (Number(score.advertiser_safety) !== 5) {
      blockers.push("advertiser_safety_not_explicitly_green");
    }
    if (!hardStops || hardStops.length > 0) {
      blockers.push("advertiser_safety_hard_stops_not_clear");
    }
    const policyVersion = text(score.scorer_version);
    if (!policyVersion) {
      blockers.push("advertiser_safety_policy_version_required");
    }
    if (!Number.isFinite(Date.parse(text(score.scored_at)))) {
      blockers.push("advertiser_safety_scored_at_required");
    }
    const evidenceSha256 = exactScores.length === 1
      ? hashObject(score)
      : null;
    return {
      blockers: unique(blockers).sort(),
      observed: {
        kind: "story_score",
        path: null,
        sha256: evidenceSha256,
        byte_length: Buffer.byteLength(
          JSON.stringify(stableValue(score)),
          "utf8",
        ),
      },
      output: {
        decision: "SAFE",
        policy_version: policyVersion,
        evidence_sha256: evidenceSha256,
        score: Number(score.advertiser_safety),
        maximum_score: 5,
        scored_at: text(score.scored_at) || null,
      },
    };
  }
  const observed = await observeFile({
    declaredPath: references.advertiser.path,
    expectedSha256: references.advertiser.fileSha256,
    rootDir: references.rootDir,
    prefix: "advertiser_safety_report",
    maximumBytes: MAXIMUM_EVIDENCE_BYTES,
    json: true,
  });
  const blockers = [...observed.blockers];
  const report = observed.value || {};
  if (
    text(report.schema_version) !==
    "pulse-advertiser-safety-report-v1"
  ) {
    blockers.push("advertiser_safety_report_schema_invalid");
  }
  if (text(report.story_id) !== storyId) {
    blockers.push("advertiser_safety_story_id_mismatch");
  }
  const decision = text(report.decision || report.verdict).toUpperCase();
  const score = Number(report.advertiser_safety);
  const maximum = Number(report.maximum_score ?? 5);
  if (
    !["SAFE", "GREEN"].includes(decision) ||
    score !== 5 ||
    maximum !== 5
  ) {
    blockers.push("advertiser_safety_not_explicitly_green");
  }
  const hardStops = parseObject(report.hard_stops);
  const normalisedHardStops = Array.isArray(report.hard_stops)
    ? report.hard_stops
    : Array.isArray(hardStops)
      ? hardStops
      : null;
  if (!normalisedHardStops || normalisedHardStops.length > 0) {
    blockers.push("advertiser_safety_hard_stops_not_clear");
  }
  const policyVersion = text(report.policy_version || report.scorer_version);
  if (!policyVersion) {
    blockers.push("advertiser_safety_policy_version_required");
  }
  return {
    blockers: unique(blockers).sort(),
    observed: {
      ...observed,
      kind: "report_file",
    },
    output: {
      decision: "SAFE",
      policy_version: policyVersion,
      evidence_sha256: observed.sha256,
      score,
      maximum_score: maximum,
    },
  };
}

function inputEntries(stories, manifests) {
  return [
    ...array(stories).map((story) => ({
      story,
      manifest: null,
      origin: {
        kind: "story",
        story_id: text(story?.id || story?.story_id),
      },
    })),
    ...array(manifests).map((manifest) => ({
      story: manifest?.story || {},
      manifest,
      origin: {
        kind: "manifest",
        manifest_id: text(manifest?.manifest_id || manifest?.id),
        story_id: text(
          manifest?.story?.id ||
            manifest?.story?.story_id ||
            manifest?.story_id,
        ),
      },
    })),
  ];
}

function explicitStoryIdentity(entry) {
  const story = entry.story || {};
  const extra = parseObject(story._extra);
  const manifest = entry.manifest || {};
  const containers = [story, extra, manifest];
  return {
    id: text(
      explicitValue(containers, ["id", "story_id"]) || entry.origin.story_id,
    ),
    title: text(explicitValue(containers, ["title"])),
    franchise: text(explicitValue(containers, ["franchise"])),
    platform: text(explicitValue(containers, ["platform"])),
    topic_key: text(explicitValue(containers, ["topic_key"])),
  };
}

function completionOutput(completion) {
  if (!completion || completion.verdict !== "READY") return null;
  return {
    schema_version: completion.schema_version,
    candidate_id: completion.candidate_id,
    work_order_sha256: completion.work_order_sha256,
    manifest_sha256: completion.manifest_sha256,
    baseline_rights_ledger_sha256:
      completion.baseline_rights_ledger_sha256,
    amended_rights_ledger_path:
      completion.amended_rights_ledger_path,
    amended_rights_ledger_file_sha256:
      completion.amended_rights_ledger_file_sha256,
    amended_rights_ledger_sha256:
      completion.amended_rights_ledger_sha256,
    materialisation_receipt_path:
      completion.materialisation_receipt_path,
    materialisation_receipt_file_sha256:
      completion.materialisation_receipt_file_sha256,
    materialisation_source_path:
      completion.materialisation_source_path,
    materialisation_source_sha256:
      completion.materialisation_source_sha256,
    materialisation_source_media_url:
      completion.materialisation_source_media_url,
    verified_exact_subject_motion_seconds:
      completion.verified_exact_subject_motion_seconds,
    local_proof_only: true,
    publish_authority: false,
    scheduler_authority: false,
    external_posting_authorised: false,
  };
}

async function assessEntry(
  entry,
  rootDir,
  advertiserSafetyScores,
  {
    probeVideo,
    ffprobePath,
  } = {},
) {
  const identity = explicitStoryIdentity(entry);
  const blockers = [];
  if (!identity.id) blockers.push("story_id_required");
  if (!identity.title) blockers.push("story_title_required");
  if (!identity.franchise) blockers.push("story_franchise_required");
  if (!identity.platform) blockers.push("story_platform_required");
  if (!identity.topic_key) blockers.push("story_topic_key_required");
  const references = evidenceReferences(entry, rootDir);
  const [source, rights, advertiser] = await Promise.all([
    assessSourceEvidence({ references, storyId: identity.id }),
    assessRightsEvidence({ references, storyId: identity.id }),
    assessAdvertiserSafety({
      references,
      storyId: identity.id,
      scores: advertiserSafetyScores,
    }),
  ]);
  blockers.push(
    ...source.blockers,
    ...rights.blockers,
    ...advertiser.blockers,
  );
  const completionLookup =
    await findEvergreenMotionCoverageCompletionReference({
      story_id: identity.id,
      root_dir: rootDir,
      explicit_reference:
        references.completion.path || references.completion.fileSha256
          ? {
              path: references.completion.path,
              file_sha256: references.completion.fileSha256,
            }
          : null,
    });
  blockers.push(...completionLookup.blockers);
  let completion = null;
  if (
    completionLookup.blockers.length === 0 &&
    completionLookup.reference
  ) {
    completion =
      await validateEvergreenMotionCoverageCompletion({
        reference: completionLookup.reference,
        expected_story_id: identity.id,
        expected_source_packet_sha256:
          source.output.packet_sha256,
        expected_baseline_rights_ledger_sha256:
          rights.output.ledger_sha256,
        root_dir: rootDir,
        ...(ffprobePath ? { ffprobe_path: ffprobePath } : {}),
        ...(probeVideo ? { probe_video: probeVideo } : {}),
      });
    blockers.push(...completion.blockers);
  }
  let effectiveRights = rights;
  if (completion?.verdict === "READY") {
    effectiveRights = await assessRightsEvidence({
      references: {
        ...references,
        rights: {
          path: completion.amended_rights_ledger_path,
          fileSha256:
            completion.amended_rights_ledger_file_sha256,
          canonicalSha256:
            completion.amended_rights_ledger_sha256,
        },
      },
      storyId: identity.id,
    });
    blockers.push(...effectiveRights.blockers);
  }
  const adaptedRights = clone(effectiveRights.output);
  if (completion?.verdict === "READY") {
    adaptedRights.media_plan.motion_completion_manifest_sha256 =
      completion.manifest_sha256;
  }
  const adaptedCompletion = completionOutput(completion);
  const adaptedStory = {
    ...identity,
    source_evidence: source.output,
    rights_evidence: adaptedRights,
    advertiser_safety: advertiser.output,
    ...(adaptedCompletion
      ? { motion_completion: adaptedCompletion }
      : {}),
  };
  const adaptedInput =
    entry.origin.kind === "manifest"
      ? {
          manifest_id: entry.origin.manifest_id,
          story: adaptedStory,
        }
      : adaptedStory;
  return {
    origin: entry.origin,
    blockers: unique(blockers).sort(),
    adaptedInput,
    provenance: {
      story_id: identity.id || null,
      source_evidence: {
        path: source.observed.path,
        file_sha256: source.observed.sha256,
        packet_sha256: source.output.packet_sha256,
      },
      rights_ledger: {
        path: effectiveRights.observed.path,
        file_sha256: effectiveRights.observed.sha256,
        canonical_sha256: effectiveRights.output.ledger_sha256,
      },
      assets: effectiveRights.assetProvenance,
      motion_completion: completion
        ? {
            discovery_mode: completionLookup.mode,
            path: completion.manifest_path,
            file_sha256: completion.manifest_file_sha256,
            manifest_sha256: completion.manifest_sha256,
            work_order_path: completion.work_order_path,
            work_order_file_sha256:
              completion.work_order_file_sha256,
            work_order_sha256: completion.work_order_sha256,
            candidate_id: completion.candidate_id,
            materialisation_receipt_path:
              completion.materialisation_receipt_path,
            materialisation_receipt_file_sha256:
              completion.materialisation_receipt_file_sha256,
            materialisation_source_path:
              completion.materialisation_source_path,
            materialisation_source_sha256:
              completion.materialisation_source_sha256,
            materialisation_source_media_url:
              completion.materialisation_source_media_url,
            baseline_rights_ledger_path:
              completion.baseline_rights_ledger_path,
            baseline_rights_ledger_file_sha256:
              completion.baseline_rights_ledger_file_sha256,
            baseline_rights_ledger_sha256:
              completion.baseline_rights_ledger_sha256,
            amended_rights_ledger_path:
              completion.amended_rights_ledger_path,
            amended_rights_ledger_file_sha256:
              completion.amended_rights_ledger_file_sha256,
            amended_rights_ledger_sha256:
              completion.amended_rights_ledger_sha256,
            verified_exact_subject_motion_seconds:
              completion.verified_exact_subject_motion_seconds,
          }
        : null,
      advertiser_safety: {
        kind: advertiser.observed.kind,
        path: advertiser.observed.path,
        file_sha256: advertiser.observed.sha256,
      },
    },
  };
}

function safety() {
  return {
    read_only: true,
    network_used: false,
    database_mutated: false,
    oauth_mutated: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting_authorised: false,
  };
}

/**
 * Read-only bridge from canonical story rows/source manifests to the exact
 * `stories`/`manifests` arguments accepted by
 * `discoverEvergreenVerdictPitches`.
 *
 * Evidence references may live on the row/manifest or in `story._extra`.
 * Source and rights references require path, exact file SHA-256 and canonical
 * packet/ledger SHA-256. Advertiser safety requires either a hash-bound report
 * reference or exactly one supplied canonical `story_scores` row.
 */
async function buildEvergreenAutonomousDiscoveryInputs({
  stories = [],
  manifests = [],
  advertiser_safety_scores: advertiserSafetyScores = [],
  root_dir: rootDir = process.cwd(),
  now = new Date().toISOString(),
  ffprobe_path: ffprobePath,
  probe_video: probeVideo,
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("evergreen_autonomous_input_time_invalid");
  }
  const resolvedRoot = path.resolve(rootDir);
  const entries = inputEntries(stories, manifests);
  const identityCounts = new Map();
  for (const entry of entries) {
    const storyId = explicitStoryIdentity(entry).id;
    if (storyId) {
      identityCounts.set(storyId, (identityCounts.get(storyId) || 0) + 1);
    }
  }
  const duplicateStoryIds = new Set(
    [...identityCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([storyId]) => storyId),
  );
  const assessed = [];
  for (const entry of entries) {
    const result = await assessEntry(
      entry,
      resolvedRoot,
      advertiserSafetyScores,
      {
        ffprobePath,
        probeVideo,
      },
    );
    const storyId = explicitStoryIdentity(entry).id;
    if (duplicateStoryIds.has(storyId)) {
      result.blockers = unique([
        ...result.blockers,
        `duplicate_story_input:${storyId}`,
      ]).sort();
    }
    assessed.push(result);
  }
  const accepted = assessed.filter((entry) => entry.blockers.length === 0);
  const rejected = assessed
    .filter((entry) => entry.blockers.length > 0)
    .map((entry) => ({
      origin: entry.origin,
      blockers: entry.blockers,
    }));
  const discoveryStories = accepted
    .filter((entry) => entry.origin.kind === "story")
    .map((entry) => clone(entry.adaptedInput));
  const discoveryManifests = accepted
    .filter((entry) => entry.origin.kind === "manifest")
    .map((entry) => clone(entry.adaptedInput));
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    verdict: accepted.length ? "READY_FOR_DISCOVERY" : "HOLD",
    blockers: accepted.length
      ? []
      : ["no_governed_evergreen_discovery_inputs"],
    discovery_inputs: {
      stories: discoveryStories,
      manifests: discoveryManifests,
    },
    accepted_inputs: accepted.map((entry) => ({
      origin: entry.origin,
      evidence_provenance: entry.provenance,
    })),
    rejected_inputs: rejected,
    summary: {
      input_count: assessed.length,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
    },
    safety: safety(),
  };
}

module.exports = {
  MODE,
  SCHEMA_VERSION,
  buildEvergreenAutonomousDiscoveryInputs,
};
