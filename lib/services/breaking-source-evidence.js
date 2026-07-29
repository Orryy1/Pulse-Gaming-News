"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const {
  extractReadableBody,
} = require("./breaking-source-adapters");

const SCHEMA_VERSION = "pulse-breaking-source-evidence-v1";
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const BODY_LOCATIONS = new Set([
  "body",
  "official_post_body",
  "press_release_body",
  "transcript",
]);
const PROPOSITION_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "being",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "more",
  "most",
  "news",
  "only",
  "other",
  "over",
  "report",
  "reports",
  "said",
  "says",
  "story",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "under",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

function text(value) {
  return String(value || "").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalPacketBase(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return null;
  }
  const {
    packet_sha256: _packetSha256,
    source_evidence_sha256: _sourceEvidenceSha256,
    planner_evidence: _plannerEvidence,
    ...base
  } = packet;
  return base;
}

function addBlocker(blockers, blocker) {
  if (!blockers.includes(blocker)) blockers.push(blocker);
}

function validateBreakingSourceEvidencePacket(packet) {
  const blockers = [];
  const base = canonicalPacketBase(packet);
  if (!base) {
    return {
      valid: false,
      blockers: ["breaking_source_packet_object_required"],
      packet_sha256: null,
    };
  }

  if (base.schema_version !== SCHEMA_VERSION) {
    addBlocker(blockers, "breaking_source_packet_schema_invalid");
  }
  const expectedPacketSha256 = sha256(stableJson(base));
  if (
    !/^[a-f0-9]{64}$/.test(text(packet.packet_sha256).toLowerCase()) ||
    text(packet.packet_sha256).toLowerCase() !== expectedPacketSha256
  ) {
    addBlocker(blockers, "breaking_source_packet_sha256_mismatch");
  }
  if (
    text(packet.source_evidence_sha256).toLowerCase() !==
    expectedPacketSha256
  ) {
    addBlocker(
      blockers,
      "breaking_source_packet_evidence_sha256_mismatch",
    );
  }

  const planner = packet.planner_evidence;
  if (!planner || typeof planner !== "object" || Array.isArray(planner)) {
    addBlocker(blockers, "breaking_source_planner_evidence_required");
  } else {
    const expectedPlanner = {
      evidence_packet_schema: base.schema_version,
      verification_status: base.verification_status,
      confirmation_basis: base.confirmation_basis,
      primary_source_url: base.primary_source_url,
      source_evidence_sha256: expectedPacketSha256,
      verified_for_planning: base.verified_for_planning,
    };
    if (stableJson(planner) !== stableJson(expectedPlanner)) {
      addBlocker(
        blockers,
        "breaking_source_planner_evidence_mismatch",
      );
    }
  }

  if (base.publish_authority !== false) {
    addBlocker(
      blockers,
      "breaking_source_packet_publish_authority_forbidden",
    );
  }
  if (base.verified_for_planning === true) {
    if (
      base.verification_status !== "CONFIRMED" ||
      !text(base.primary_source_url) ||
      !Array.isArray(base.confirmed_claims) ||
      base.confirmed_claims.length === 0
    ) {
      addBlocker(
        blockers,
        "breaking_source_packet_confirmation_incomplete",
      );
    }
  } else if (base.verified_for_planning !== false) {
    addBlocker(
      blockers,
      "breaking_source_packet_verified_flag_invalid",
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    packet_sha256: expectedPacketSha256,
  };
}

async function verifyPersistedPacket({
  packetPath,
  expectedPacketSha256,
}) {
  const bytes = await fs.readFile(packetPath);
  let packet;
  try {
    packet = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("breaking_source_packet_persisted_json_invalid");
  }
  const validation = validateBreakingSourceEvidencePacket(packet);
  if (
    !validation.valid ||
    validation.packet_sha256 !== expectedPacketSha256
  ) {
    throw new Error("breaking_source_packet_persisted_validation_failed");
  }
  return {
    path: packetPath,
    file_sha256: sha256(bytes),
    packet_sha256: expectedPacketSha256,
    byte_length: bytes.length,
  };
}

async function persistBreakingSourceEvidencePacket({
  packet,
  outputDir,
} = {}) {
  const validation = validateBreakingSourceEvidencePacket(packet);
  if (!validation.valid) {
    const error = new Error(
      `breaking_source_packet_invalid:${validation.blockers.join(",")}`,
    );
    error.code = "BREAKING_SOURCE_PACKET_INVALID";
    error.blockers = validation.blockers;
    throw error;
  }
  if (!text(outputDir)) {
    throw new Error("breaking_source_packet_output_dir_required");
  }

  const root = path.resolve(outputDir);
  await fs.mkdir(root, { recursive: true });
  const packetPath = path.join(
    root,
    `source-evidence-${validation.packet_sha256}.json`,
  );
  const bytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, "utf8");
  const tempPath = path.join(
    root,
    `.source-evidence-${validation.packet_sha256}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    try {
      return await verifyPersistedPacket({
        packetPath,
        expectedPacketSha256: validation.packet_sha256,
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    handle = await fs.open(tempPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.rename(tempPath, packetPath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await verifyPersistedPacket({
        packetPath,
        expectedPacketSha256: validation.packet_sha256,
      });
      await fs.rm(tempPath, { force: true });
    }
    return await verifyPersistedPacket({
      packetPath,
      expectedPacketSha256: validation.packet_sha256,
    });
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

function propositionTokens(value) {
  return text(value)
    .toLowerCase()
    .replace(/back(?:wards?)?[\s_-]*compat(?:ibility)?/g, " compat ")
    .match(/[a-z0-9]{4,}/g)
    ?.filter((token) => !PROPOSITION_STOP_WORDS.has(token)) || [];
}

function tokenRelated(left, right) {
  if (left === right) return true;
  const prefixLength = Math.min(left.length, right.length, 7);
  return (
    prefixLength >= 5 &&
    left.slice(0, prefixLength) === right.slice(0, prefixLength)
  );
}

function claimBoundToDiscoveredProposition(story, claim) {
  const subjectIds = new Set(
    (Array.isArray(story?.subject_ids) ? story.subject_ids : [])
      .flatMap((value) => propositionTokens(value)),
  );
  const proposition = propositionTokens(story?.title).filter(
    (token) => !subjectIds.has(token),
  );
  if (proposition.length === 0) return true;
  const evidence = propositionTokens(
    `${text(claim?.claim_key)} ${String(claim?.text ?? "")}`,
  ).filter((token) => !subjectIds.has(token));
  return proposition.some((target) =>
    evidence.some((candidate) => tokenRelated(target, candidate)),
  );
}

function safeHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    return { ok: false, reason: "source_url_invalid", url: null };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "source_url_https_required", url: null };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "source_url_credentials_forbidden", url: null };
  }
  if (parsed.port && parsed.port !== "443") {
    return {
      ok: false,
      reason: "source_url_nonstandard_port_forbidden",
      url: null,
    };
  }
  if (
    !hostname.includes(".") ||
    net.isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    /\.(?:localhost|local|internal|lan|home)$/i.test(hostname)
  ) {
    return {
      ok: false,
      reason: "source_url_public_hostname_required",
      url: null,
    };
  }
  parsed.hash = "";
  return {
    ok: true,
    reason: null,
    hostname,
    url: parsed.toString(),
  };
}

function hostMatches(hostname, allowedHost) {
  const allowed = text(allowedHost).toLowerCase().replace(/\.$/, "");
  return Boolean(
    allowed &&
      (hostname === allowed || hostname.endsWith(`.${allowed}`)),
  );
}

function sourceSubjectsMatch(story, source) {
  const storySubjects = new Set(
    (Array.isArray(story.subject_ids) ? story.subject_ids : []).map(
      (value) => text(value).toLowerCase(),
    ),
  );
  const sourceSubjects = (
    Array.isArray(source.subject_ids) ? source.subject_ids : []
  ).map((value) => text(value).toLowerCase());
  return (
    sourceSubjects.includes("*") ||
    sourceSubjects.some((subject) => storySubjects.has(subject))
  );
}

function classifySource({ hostname, story, sourcePolicy }) {
  const officialSources = Array.isArray(
    sourcePolicy.official_first_party,
  )
    ? sourcePolicy.official_first_party
    : [];
  const editorialSources = Array.isArray(
    sourcePolicy.trusted_editorial,
  )
    ? sourcePolicy.trusted_editorial
    : [];
  for (const source of officialSources) {
    const sourceId = text(source.source_id);
    const publisher = text(source.owner);
    if (
      sourceId &&
      publisher &&
      (Array.isArray(source.hosts) ? source.hosts : []).some((host) =>
        hostMatches(hostname, host),
      ) &&
      sourceSubjectsMatch(story, source)
    ) {
      return {
        source_id: sourceId,
        source_class: "OFFICIAL_FIRST_PARTY",
        publisher,
      };
    }
  }
  for (const source of editorialSources) {
    const sourceId = text(source.source_id);
    const publisher = text(source.outlet);
    if (
      sourceId &&
      publisher &&
      (Array.isArray(source.hosts) ? source.hosts : []).some((host) =>
        hostMatches(hostname, host),
      )
    ) {
      return {
        source_id: sourceId,
        source_class: "TRUSTED_EDITORIAL",
        publisher,
      };
    }
  }
  return null;
}

function capturedBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function extractorIdentity(extraction) {
  const extractor = extraction?.extractor || {};
  const identity = {
    id: text(extractor.id),
    version: text(extractor.version),
    ...(text(extractor.provider)
      ? { provider: text(extractor.provider) }
      : {}),
    ...(text(extractor.model)
      ? { model: text(extractor.model) }
      : {}),
    ...(text(extractor.adapter)
      ? { adapter: text(extractor.adapter) }
      : {}),
  };
  return identity.id && identity.version ? identity : null;
}

function capturedClaims(extraction) {
  if (
    !extraction ||
    typeof extraction !== "object" ||
    !Array.isArray(extraction.claims)
  ) {
    return null;
  }
  const extractor = extractorIdentity(extraction);
  if (!extractor) return null;
  return extraction.claims
    .map((claim) => {
      const claimText = String(claim?.text ?? "");
      const exact = {
        claim_key: text(claim?.claim_key).toLowerCase(),
        text: claimText,
        location: text(claim?.location).toLowerCase(),
        extractor,
      };
      if (
        !exact.claim_key ||
        !claimText.trim() ||
        !BODY_LOCATIONS.has(exact.location)
      ) {
        return null;
      }
      return {
        ...exact,
        claim_text_sha256: sha256(Buffer.from(claimText, "utf8")),
        claim_sha256: sha256(stableJson(exact)),
      };
    })
    .filter(Boolean);
}

function confirmedClaimGroups(sources, minimumDistinctSources) {
  const byClaimKey = new Map();
  for (const source of sources) {
    for (const claim of source.claims || []) {
      if (!byClaimKey.has(claim.claim_key)) {
        byClaimKey.set(claim.claim_key, new Map());
      }
      const supportBySource = byClaimKey.get(claim.claim_key);
      if (!supportBySource.has(source.source_id)) {
        supportBySource.set(source.source_id, {
          source_id: source.source_id,
          source_class: source.source_class,
          final_url: source.final_url,
          provenance_sha256: source.provenance_sha256,
          text: claim.text,
          location: claim.location,
          claim_text_sha256: claim.claim_text_sha256,
          claim_sha256: claim.claim_sha256,
        });
      }
    }
  }
  return [...byClaimKey.entries()]
    .map(([claimKey, supportBySource]) => {
      const evidence = [...supportBySource.values()].sort((a, b) =>
        a.source_id.localeCompare(b.source_id),
      );
      if (evidence.length < minimumDistinctSources) return null;
      const group = {
        claim_key: claimKey,
        support_count: evidence.length,
        supporting_source_ids: evidence.map(
          (item) => item.source_id,
        ),
        evidence,
      };
      return {
        ...group,
        corroboration_sha256: sha256(stableJson(group)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.claim_key.localeCompare(b.claim_key));
}

function finalisePacket(base) {
  const packetSha256 = sha256(stableJson(base));
  return deepFreeze({
    ...base,
    packet_sha256: packetSha256,
    source_evidence_sha256: packetSha256,
    planner_evidence: Object.freeze({
      evidence_packet_schema: base.schema_version,
      verification_status: base.verification_status,
      confirmation_basis: base.confirmation_basis,
      primary_source_url: base.primary_source_url,
      source_evidence_sha256: packetSha256,
      verified_for_planning: base.verified_for_planning,
    }),
  });
}

function buildFailedBreakingSourceEvidencePacket({
  storyId = "",
  now = new Date().toISOString(),
  blockers = ["breaking_source_evidence_capture_failed"],
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("breaking_source_evidence_time_invalid");
  }
  const exactBlockers = [
    ...new Set(
      (Array.isArray(blockers) ? blockers : [blockers])
        .map((blocker) => text(blocker).toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  return finalisePacket({
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    story_id: text(storyId),
    verdict: "HOLD",
    verification_status: "UNVERIFIED",
    confirmation_basis: null,
    verified_for_planning: false,
    primary_source_url: null,
    sources: [],
    confirmed_claims: [],
    blockers: exactBlockers.length
      ? exactBlockers
      : ["breaking_source_evidence_capture_failed"],
    publish_authority: false,
    safety: {
      headline_is_not_confirmation: true,
      no_external_posting_authority: true,
    },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function captureBreakingSourceEvidence({
  story = {},
  sourcePolicy = {},
  fetchCapture,
  extractClaims,
  now = new Date().toISOString(),
  maxBytes = DEFAULT_MAX_BYTES,
  stopAfterOfficialConfirmation = false,
} = {}) {
  story =
    story && typeof story === "object" && !Array.isArray(story)
      ? story
      : {};
  sourcePolicy =
    sourcePolicy &&
    typeof sourcePolicy === "object" &&
    !Array.isArray(sourcePolicy)
      ? sourcePolicy
      : {};
  const configuredMaxBytes = Number(maxBytes);
  maxBytes =
    Number.isInteger(configuredMaxBytes) && configuredMaxBytes > 0
      ? configuredMaxBytes
      : DEFAULT_MAX_BYTES;
  const capturedAt = new Date(now);
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error("breaking_source_evidence_time_invalid");
  }
  const capturedAtIso = capturedAt.toISOString();
  const explicitCandidates = Array.isArray(story.source_candidates)
    ? story.source_candidates
    : [];
  const sourceCandidates =
    explicitCandidates.length > 0
      ? explicitCandidates
      : [
          story.primary_source_url,
          story.article_url,
          story.url,
        ].filter((value) => text(value));
  const sources = [];

  for (const candidate of sourceCandidates) {
    const safeRequested = safeHttpsUrl(
      typeof candidate === "string" ? candidate : candidate?.url,
    );
    if (!safeRequested.ok) {
      sources.push({
        status: "REJECTED",
        requested_url: text(
          typeof candidate === "string" ? candidate : candidate?.url,
        ),
        blockers: [safeRequested.reason],
      });
      continue;
    }
    const classification = classifySource({
      hostname: safeRequested.hostname,
      story,
      sourcePolicy,
    });
    if (!classification) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        blockers: ["source_not_official_or_trusted_editorial"],
      });
      continue;
    }
    if (typeof fetchCapture !== "function") {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        blockers: ["source_fetch_capture_required"],
      });
      continue;
    }

    let response;
    try {
      response = await fetchCapture({
        url: safeRequested.url,
        redirect: "manual",
        max_bytes: maxBytes,
      });
    } catch {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        blockers: ["source_fetch_failed"],
      });
      continue;
    }
    const safeFinal = safeHttpsUrl(
      response?.final_url || safeRequested.url,
    );
    const finalClassification = safeFinal.ok
      ? classifySource({
          hostname: safeFinal.hostname,
          story,
          sourcePolicy,
        })
      : null;
    const bytes = capturedBytes(response?.bytes);
    const bytesSha256 = bytes ? sha256(bytes) : null;
    const declaredBytesSha256 = text(
      response?.bytes_sha256,
    ).toLowerCase();
    const archiveRef = text(response?.archive_ref).toLowerCase();
    const sourceBlockers = [];
    if (!safeFinal.ok) {
      sourceBlockers.push(safeFinal.reason);
    } else if (
      !finalClassification ||
      finalClassification.source_id !== classification.source_id ||
      finalClassification.source_class !== classification.source_class
    ) {
      sourceBlockers.push("source_redirect_policy_mismatch");
    }
    if (
      !Number.isInteger(Number(response?.status)) ||
      Number(response.status) < 200 ||
      Number(response.status) >= 300
    ) {
      sourceBlockers.push("source_fetch_status_not_success");
    }
    if (!bytes || bytes.length === 0) {
      sourceBlockers.push("source_capture_bytes_required");
    } else if (bytes.length > maxBytes) {
      sourceBlockers.push("source_capture_too_large");
    }
    if (
      declaredBytesSha256 &&
      declaredBytesSha256 !== bytesSha256
    ) {
      sourceBlockers.push("source_capture_hash_mismatch");
    }
    if (
      archiveRef &&
      archiveRef !== `sha256:${bytesSha256}`
    ) {
      sourceBlockers.push("source_archive_ref_mismatch");
    }
    if (typeof extractClaims !== "function") {
      sourceBlockers.push("source_claim_extractor_required");
    }
    if (sourceBlockers.length) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: sourceBlockers,
      });
      continue;
    }

    let extraction;
    try {
      const extractionStory = Object.freeze({
        id: text(story.id),
        subject_ids: Object.freeze(
          (
            Array.isArray(story.subject_ids)
              ? story.subject_ids
              : []
          ).map((value) => text(value).toLowerCase()),
        ),
      });
      extraction = await extractClaims({
        story: extractionStory,
        source: classification,
        url: safeFinal.url,
        content_type: text(response.content_type),
        bytes: Buffer.from(bytes),
      });
    } catch {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: ["source_claim_extraction_failed"],
      });
      continue;
    }
    if (extraction?.prompt_injection_detected === true) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: ["source_prompt_injection_detected"],
      });
      continue;
    }
    const extractedClaims = capturedClaims(extraction);
    if (extractedClaims === null) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: ["source_claim_extraction_invalid"],
      });
      continue;
    }
    if (extractedClaims.length === 0) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: ["source_body_claim_required"],
      });
      continue;
    }
    const canonicalBody = extractReadableBody(
      bytes,
      text(response.content_type),
    );
    const exactBodyClaims = extractedClaims.filter((claim) =>
      canonicalBody.includes(claim.text),
    );
    if (exactBodyClaims.length !== extractedClaims.length) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: ["source_claim_quote_not_in_canonical_body"],
      });
      continue;
    }
    const claims = exactBodyClaims.filter((claim) =>
      claimBoundToDiscoveredProposition(story, claim),
    );
    if (claims.length === 0) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: [
          "source_claim_not_bound_to_discovered_proposition",
        ],
      });
      continue;
    }
    const provenance = {
      captured_at: capturedAtIso,
      requested_url: safeRequested.url,
      final_url: safeFinal.url,
      source_id: classification.source_id,
      source_class: classification.source_class,
      publisher: classification.publisher,
      content_type: text(response.content_type),
      byte_length: bytes.length,
      bytes_sha256: bytesSha256,
      archive_ref: archiveRef || null,
      archive_path: archiveRef
        ? text(response.archive_path) || null
        : null,
      extractor: extractorIdentity(extraction),
    };
    sources.push({
      status: "CAPTURED",
      ...classification,
      requested_url: safeRequested.url,
      final_url: safeFinal.url,
      captured_at: capturedAtIso,
      content_type: text(response.content_type),
      byte_length: bytes.length,
      bytes_sha256: bytesSha256,
      canonical_body: {
        algorithm: "pulse-readable-body-v1",
        sha256: sha256(
          Buffer.from(canonicalBody, "utf8"),
        ),
      },
      claims,
      provenance,
      provenance_sha256: sha256(stableJson(provenance)),
      blockers: [],
    });
    if (
      stopAfterOfficialConfirmation === true &&
      classification.source_class === "OFFICIAL_FIRST_PARTY"
    ) {
      break;
    }
  }

  const officialSources = sources.filter(
    (source) =>
      source.status === "CAPTURED" &&
      source.source_class === "OFFICIAL_FIRST_PARTY",
  );
  const editorialSources = sources.filter(
    (source) =>
      source.status === "CAPTURED" &&
      source.source_class === "TRUSTED_EDITORIAL",
  );
  const officialClaims = confirmedClaimGroups(officialSources, 1);
  const corroboratedClaims = confirmedClaimGroups(editorialSources, 2);
  const officialConfirmed = officialClaims.length > 0;
  const editorialCorroborated =
    !officialConfirmed && corroboratedClaims.length > 0;
  const evidenceConfirmed =
    officialConfirmed || editorialCorroborated;
  const metadataBlockers = [];
  if (!text(story.id)) metadataBlockers.push("story_id_required");
  if (!text(story.title)) metadataBlockers.push("story_title_required");
  if (sourceCandidates.length === 0) {
    metadataBlockers.push("source_candidate_required");
  }
  const confirmed =
    evidenceConfirmed && metadataBlockers.length === 0;
  const evidenceClaims = officialConfirmed
    ? officialClaims
    : corroboratedClaims;
  const base = {
    schema_version: SCHEMA_VERSION,
    generated_at: capturedAtIso,
    story_id: text(story.id),
    verdict: confirmed
      ? officialConfirmed
        ? "OFFICIAL_CONFIRMED"
        : "CORROBORATED"
      : "HOLD",
    verification_status: confirmed ? "CONFIRMED" : "UNVERIFIED",
    confirmation_basis: confirmed
      ? officialConfirmed
        ? "official_first_party"
        : "trusted_editorial_corroboration"
      : null,
    verified_for_planning: confirmed,
    primary_source_url:
      officialSources[0]?.final_url ||
      (editorialCorroborated
        ? editorialSources[0]?.final_url
        : null),
    sources,
    confirmed_claims: confirmed ? evidenceClaims : [],
    blockers: [
      ...metadataBlockers,
      ...(evidenceConfirmed
        ? []
        : ["official_or_corroborated_body_evidence_required"]),
    ],
    publish_authority: false,
    safety: {
      headline_is_not_confirmation: true,
      no_external_posting_authority: true,
    },
  };
  return finalisePacket(base);
}

module.exports = {
  DEFAULT_MAX_BYTES,
  SCHEMA_VERSION,
  buildFailedBreakingSourceEvidencePacket,
  captureBreakingSourceEvidence,
  persistBreakingSourceEvidencePacket,
  validateBreakingSourceEvidencePacket,
};
