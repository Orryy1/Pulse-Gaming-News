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
const SUBJECT_ENTITY_NOISE_WORDS = new Set([
  "archive",
  "breaking",
  "exclusive",
  "first",
  "game",
  "games",
  "latest",
  "new",
  "report",
  "reports",
  "rumor",
  "rumour",
  "the",
  "title",
  "titles",
]);
const LEADING_QUANTITY_WORDS = new Set([
  "eight",
  "five",
  "four",
  "nine",
  "one",
  "seven",
  "six",
  "ten",
  "three",
  "two",
]);
const QUANTIFIED_SUBJECT_WORDS = new Set([
  "classic",
  "classics",
  "game",
  "games",
  "nintendo",
  "playstation",
  "steam",
  "switch",
  "title",
  "titles",
  "xbox",
]);
const HEADLINE_SUBJECT_BOUNDARIES = new Set([
  "add",
  "adds",
  "announce",
  "announces",
  "are",
  "arrive",
  "arrives",
  "bring",
  "brings",
  "can",
  "confirm",
  "confirmed",
  "confirms",
  "could",
  "delay",
  "delayed",
  "delays",
  "drop",
  "drops",
  "expose",
  "exposes",
  "face",
  "faces",
  "gain",
  "gains",
  "get",
  "gets",
  "getting",
  "has",
  "have",
  "is",
  "launch",
  "launches",
  "land",
  "landed",
  "lands",
  "lose",
  "loses",
  "make",
  "makes",
  "may",
  "might",
  "move",
  "moves",
  "need",
  "needs",
  "open",
  "opens",
  "receive",
  "receives",
  "release",
  "released",
  "releases",
  "remove",
  "removes",
  "reveal",
  "revealed",
  "reveals",
  "return",
  "returns",
  "run",
  "runs",
  "support",
  "supports",
  "target",
  "targets",
  "use",
  "uses",
  "will",
  "working",
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

function subjectEntityTokens(value) {
  return (
    text(value)
      .replace(/[’']/g, "'")
      .replace(/'s\b/gi, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter(
        (token) =>
          token.length >= 2 &&
          !SUBJECT_ENTITY_NOISE_WORDS.has(token),
      ) || []
  );
}

function leadingHeadlineSubjectTokens(value) {
  const title = text(value);
  if (!title) return [];
  const normaliseSubject = (subjectValue) => {
    const tokens = subjectEntityTokens(subjectValue);
    if (
      LEADING_QUANTITY_WORDS.has(tokens[0]) &&
      QUANTIFIED_SUBJECT_WORDS.has(tokens[1])
    ) {
      return tokens.slice(1);
    }
    return tokens;
  };
  const colonIndex = title.indexOf(":");
  if (colonIndex > 0) {
    return normaliseSubject(title.slice(0, colonIndex));
  }
  const possessiveDescriptor = title.match(
    /^(.+?[’']s)\s+(?:first|latest|new|next)\b/i,
  );
  if (possessiveDescriptor) {
    return normaliseSubject(possessiveDescriptor[1]);
  }

  const words =
    title.match(/[A-Za-z0-9]+(?:[’'][A-Za-z]+)?/g) || [];
  const leading = [];
  for (const word of words) {
    const normalised = subjectEntityTokens(word);
    const token = normalised[0] || "";
    if (HEADLINE_SUBJECT_BOUNDARIES.has(token)) break;
    const startsLikeProperName =
      /^[A-Z0-9]/.test(word) || /^[A-Z0-9]+$/.test(word);
    if (!startsLikeProperName) break;
    leading.push(...normalised);
  }
  return normaliseSubject(leading.join(" "));
}

function containsExactTokenSequence(haystack, needle) {
  if (needle.length === 0 || haystack.length < needle.length) {
    return false;
  }
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (
      needle.every(
        (token, offset) => haystack[index + offset] === token,
      )
    ) {
      return true;
    }
  }
  return false;
}

function officialEvidenceBoundToDiscoveredSubject({
  story,
  claim,
  canonicalBody,
}) {
  const evidenceSegments = [
    text(claim?.claim_key),
    String(claim?.text ?? ""),
    text(canonicalBody),
  ].map((value) => subjectEntityTokens(value));
  const headlineSubject = leadingHeadlineSubjectTokens(story?.title);
  if (headlineSubject.length > 0) {
    return evidenceSegments.some((evidence) =>
      containsExactTokenSequence(evidence, headlineSubject),
    );
  }
  const explicitSubjects = (
    Array.isArray(story?.subject_ids) ? story.subject_ids : []
  )
    .map((value) => subjectEntityTokens(value))
    .filter((tokens) => tokens.length > 0);
  if (explicitSubjects.length === 0) return false;
  return explicitSubjects.some((subject) =>
    evidenceSegments.some((evidence) =>
      containsExactTokenSequence(evidence, subject),
    ),
  );
}

function assessStorySubjectEvidenceBinding({
  story,
  claims = [],
  source_urls: sourceUrls = [],
} = {}) {
  const subjectTokens = leadingHeadlineSubjectTokens(story?.title);
  if (subjectTokens.length === 0) {
    return Object.freeze({
      bound: false,
      claim_bound: false,
      source_url_bound: false,
      subject_tokens: Object.freeze([]),
    });
  }
  const claimSegments = (
    Array.isArray(claims) ? claims : []
  )
    .flatMap((claim) => [
      text(claim?.claim_key),
      String(claim?.text ?? ""),
    ])
    .map((value) => subjectEntityTokens(value));
  const sourceUrlSegments = (
    Array.isArray(sourceUrls) ? sourceUrls : []
  ).map((value) => subjectEntityTokens(text(value)));
  const claimBound = claimSegments.some((evidence) =>
    containsExactTokenSequence(evidence, subjectTokens),
  );
  const sourceUrlBound = sourceUrlSegments.some((evidence) =>
    containsExactTokenSequence(evidence, subjectTokens),
  );
  return Object.freeze({
    // A matching URL is useful corroboration, but it cannot repair
    // cross-story claims. The exact distinctive headline subject must
    // be present in at least one hash-bound claim.
    bound: claimBound,
    claim_bound: claimBound,
    source_url_bound: sourceUrlBound,
    subject_tokens: Object.freeze([...subjectTokens]),
  });
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

function claimIdentityForSource(source, claim) {
  const claimKey = text(claim?.claim_key).toLowerCase();
  const parts = claimKey.split(".");
  const compact = (value) =>
    text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const publisherAliases = new Set(
    [source?.source_id, source?.publisher]
      .map(compact)
      .filter(Boolean),
  );
  const hasPublisherSubjectActionObjectShape =
    parts.length === 4 &&
    parts.every((part) => /^[a-z0-9][a-z0-9_-]*$/.test(part));
  if (
    source?.source_class === "TRUSTED_EDITORIAL" &&
    hasPublisherSubjectActionObjectShape &&
    publisherAliases.has(compact(parts[0]))
  ) {
    return {
      claim_identity: parts.slice(1).join("."),
      claim_identity_basis:
        "configured_publisher_prefix_removed_v1",
    };
  }
  return {
    claim_identity: claimKey,
    claim_identity_basis: "exact_claim_key_v1",
  };
}

function confirmedClaimGroups(sources, minimumDistinctSources) {
  const byClaimIdentity = new Map();
  for (const source of sources) {
    for (const claim of source.claims || []) {
      const identity = claimIdentityForSource(source, claim);
      if (!byClaimIdentity.has(identity.claim_identity)) {
        byClaimIdentity.set(identity.claim_identity, new Map());
      }
      const supportBySource = byClaimIdentity.get(
        identity.claim_identity,
      );
      if (!supportBySource.has(source.source_id)) {
        supportBySource.set(source.source_id, {
          source_id: source.source_id,
          source_class: source.source_class,
          final_url: source.final_url,
          provenance_sha256: source.provenance_sha256,
          claim_key: claim.claim_key,
          ...identity,
          text: claim.text,
          location: claim.location,
          claim_text_sha256: claim.claim_text_sha256,
          claim_sha256: claim.claim_sha256,
        });
      }
    }
  }
  return [...byClaimIdentity.entries()]
    .map(([claimIdentity, supportBySource]) => {
      const evidence = [...supportBySource.values()].sort((a, b) =>
        a.source_id.localeCompare(b.source_id),
      );
      if (evidence.length < minimumDistinctSources) return null;
      const exactClaimKeys = [
        ...new Set(evidence.map((item) => item.claim_key)),
      ];
      const identityBases = [
        ...new Set(
          evidence.map((item) => item.claim_identity_basis),
        ),
      ].sort();
      const group = {
        claim_key:
          exactClaimKeys.length === 1
            ? exactClaimKeys[0]
            : claimIdentity,
        claim_identity: claimIdentity,
        claim_identity_basis:
          identityBases.length === 1
            ? identityBases[0]
            : "mixed_exact_and_configured_publisher_prefix_v1",
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
  stopAfterEvidenceConfirmation = false,
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
    const propositionClaims = exactBodyClaims.filter((claim) =>
      claimBoundToDiscoveredProposition(story, claim),
    );
    if (propositionClaims.length === 0) {
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
    const claims =
      classification.source_class === "OFFICIAL_FIRST_PARTY"
        ? propositionClaims.filter((claim) =>
            officialEvidenceBoundToDiscoveredSubject({
              story,
              claim,
              canonicalBody,
            }),
          )
        : propositionClaims;
    if (claims.length === 0) {
      sources.push({
        status: "REJECTED",
        requested_url: safeRequested.url,
        final_url: safeFinal.url,
        source_id: classification.source_id,
        source_class: classification.source_class,
        blockers: [
          "source_claim_not_bound_to_discovered_subject",
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
    if (stopAfterEvidenceConfirmation === true) {
      const capturedOfficialSources = sources.filter(
        (source) =>
          source.status === "CAPTURED" &&
          source.source_class === "OFFICIAL_FIRST_PARTY",
      );
      const capturedEditorialSources = sources.filter(
        (source) =>
          source.status === "CAPTURED" &&
          source.source_class === "TRUSTED_EDITORIAL",
      );
      if (
        confirmedClaimGroups(capturedOfficialSources, 1).length > 0 ||
        confirmedClaimGroups(capturedEditorialSources, 2).length > 0
      ) {
        break;
      }
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
  assessStorySubjectEvidenceBinding,
  DEFAULT_MAX_BYTES,
  SCHEMA_VERSION,
  buildFailedBreakingSourceEvidencePacket,
  captureBreakingSourceEvidence,
  persistBreakingSourceEvidencePacket,
  validateBreakingSourceEvidencePacket,
};
