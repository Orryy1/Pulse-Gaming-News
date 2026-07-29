"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessOriginalityTransformation,
  assessRightsLedger,
  assessSyntheticMediaDisclosure,
} = require("./publication-evidence-gates");

const PACKET_SCHEMA = "pulse-governed-lane-review-packet-v1";
const GENERATOR_ID = "pulse-governed-lane-review-packet-v1";
const LANE_IDS = new Set([
  "breaking_short",
  "evergreen_short",
  "weekly_longform",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

class GovernedLaneReviewPacketError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedLaneReviewPacketError";
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

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

function fingerprintValue(value) {
  return sha256Bytes(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function isSecretPath(filePath) {
  const resolved = path.resolve(filePath);
  const parts = resolved
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const basename = path.basename(resolved).toLowerCase();
  return (
    parts.includes("tokens") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /(?:credential|oauth|access[_-]?token|client[_-]?secret)/i.test(
      basename,
    )
  );
}

function nestedValue(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, value);
}

function declaredHashes(value, paths) {
  return unique(
    paths
      .map((candidatePath) =>
        normaliseSha256(nestedValue(value, candidatePath)),
      )
      .filter(Boolean),
  );
}

function identityValues(value, kind) {
  const paths =
    kind === "story"
      ? [
          "story_id",
          "identity.story_id",
          "bindings.story_id",
          "story.story_id",
          "story.id",
        ]
      : [
          "lane_id",
          "identity.lane_id",
          "bindings.lane_id",
          "format.lane_id",
          "lane.id",
        ];
  return unique(paths.map((item) => text(nestedValue(value, item))).filter(Boolean));
}

async function readHashBoundFile({
  ref,
  name,
  expectedStoryId,
  expectedLaneId,
  json,
}) {
  const blockers = [];
  const supplied = ref && typeof ref === "object" ? ref : {};
  const declaredPath = text(supplied.path);
  const expectedSha256 = normaliseSha256(
    supplied.sha256 || supplied.file_sha256,
  );
  const declaredStoryId = text(supplied.story_id);
  const declaredLaneId = text(supplied.lane_id);
  if (!declaredPath) blockers.push(`${name}_path_required`);
  if (!expectedSha256) blockers.push(`${name}_sha256_required`);
  if (declaredStoryId !== expectedStoryId) {
    blockers.push(`${name}_story_id_mismatch`);
  }
  if (declaredLaneId !== expectedLaneId) {
    blockers.push(`${name}_lane_id_mismatch`);
  }

  const resolvedPath = declaredPath ? path.resolve(declaredPath) : null;
  let safePath = resolvedPath;
  if (resolvedPath && isSecretPath(resolvedPath)) {
    blockers.push(`${name}_secret_path_forbidden`);
    safePath = null;
  }

  let fileHandle = null;
  let observedSha256 = null;
  let byteLength = null;
  let value = null;
  if (resolvedPath && safePath) {
    try {
      const initial = await fsp.lstat(resolvedPath, { bigint: true });
      let canRead = true;
      if (initial.isSymbolicLink()) {
        blockers.push(`${name}_symlink_forbidden`);
        canRead = false;
      } else if (!initial.isFile()) {
        blockers.push(`${name}_regular_file_required`);
        canRead = false;
      } else if (initial.size <= 0n) {
        blockers.push(`${name}_file_empty`);
        canRead = false;
      } else if (json && initial.size > BigInt(MAX_JSON_BYTES)) {
        blockers.push(`${name}_file_too_large`);
        canRead = false;
      }
      if (canRead) {
        const realPath = await fsp.realpath(resolvedPath);
        if (isSecretPath(realPath)) {
          blockers.push(`${name}_realpath_secret_forbidden`);
          safePath = null;
          canRead = false;
        }
      }
      if (safePath && canRead) {
        fileHandle = await fsp.open(resolvedPath, "r");
        const opened = await fileHandle.stat({ bigint: true });
        if (!opened.isFile()) {
          blockers.push(`${name}_regular_file_required`);
        } else {
          if (
            opened.dev !== initial.dev ||
            opened.ino !== initial.ino ||
            opened.size !== initial.size ||
            opened.mtimeNs !== initial.mtimeNs
          ) {
            blockers.push(`${name}_changed_during_read`);
          }
          const hash = crypto.createHash("sha256");
          const chunks = [];
          let offset = 0;
          while (offset < Number(opened.size)) {
            const length = Math.min(
              READ_CHUNK_BYTES,
              Number(opened.size) - offset,
            );
            const chunk = Buffer.allocUnsafe(length);
            const { bytesRead } = await fileHandle.read(
              chunk,
              0,
              length,
              offset,
            );
            if (!bytesRead) break;
            const observed = chunk.subarray(0, bytesRead);
            hash.update(observed);
            if (json) chunks.push(observed);
            offset += bytesRead;
          }
          byteLength = offset;
          observedSha256 = hash.digest("hex");
          const completed = await fileHandle.stat({ bigint: true });
          if (
            completed.size !== opened.size ||
            completed.mtimeNs !== opened.mtimeNs ||
            offset !== Number(opened.size)
          ) {
            blockers.push(`${name}_changed_during_read`);
          }
          const finalPathStat = await fsp.lstat(resolvedPath, {
            bigint: true,
          });
          if (
            finalPathStat.isSymbolicLink() ||
            !finalPathStat.isFile() ||
            finalPathStat.dev !== opened.dev ||
            finalPathStat.ino !== opened.ino ||
            finalPathStat.size !== opened.size ||
            finalPathStat.mtimeNs !== opened.mtimeNs
          ) {
            blockers.push(`${name}_changed_during_read`);
          }
          if (json) {
            try {
              value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (
                !value ||
                typeof value !== "object" ||
                Array.isArray(value)
              ) {
                blockers.push(`${name}_json_object_required`);
                value = null;
              }
            } catch {
              blockers.push(`${name}_json_invalid`);
            }
          }
        }
      }
    } catch (error) {
      blockers.push(`${name}_read_failed:${error.code || "unknown"}`);
    } finally {
      if (fileHandle) await fileHandle.close();
    }
  }

  if (observedSha256 && expectedSha256 !== observedSha256) {
    blockers.push(`${name}_sha256_mismatch`);
  }
  if (value) {
    const storyIds = identityValues(value, "story");
    const laneIds = identityValues(value, "lane");
    if (storyIds.some((storyId) => storyId !== expectedStoryId)) {
      blockers.push(`${name}_embedded_story_id_mismatch`);
    }
    if (laneIds.some((laneId) => laneId !== expectedLaneId)) {
      blockers.push(`${name}_embedded_lane_id_mismatch`);
    }
  }

  return {
    blockers: unique(blockers),
    path: safePath,
    sha256: observedSha256,
    byte_length: byteLength,
    value,
    canonical_sha256: normaliseSha256(supplied.canonical_sha256),
  };
}

function bindingAssessment({
  renderer,
  qa,
  workOrder,
  finalMedia,
}) {
  const blockers = [];
  const derivedRendererCanonicalSha256 = renderer.value
    ? fingerprintValue(renderer.value)
    : null;
  if (
    renderer.canonical_sha256 &&
    renderer.canonical_sha256 !== derivedRendererCanonicalSha256
  ) {
    blockers.push("renderer_manifest_canonical_sha256_mismatch");
  }
  const inFileWorkOrderFingerprints = declaredHashes(workOrder.value, [
    "work_order_sha256",
    "canonical_sha256",
    "fingerprint_sha256",
    "immutable_fingerprint_sha256",
  ]);
  if (
    workOrder.canonical_sha256 &&
    inFileWorkOrderFingerprints.length &&
    (inFileWorkOrderFingerprints.length !== 1 ||
      inFileWorkOrderFingerprints[0] !== workOrder.canonical_sha256)
  ) {
    blockers.push("production_work_order_canonical_sha256_mismatch");
  }
  const workOrderCanonicalSha256 =
    workOrder.canonical_sha256 ||
    (inFileWorkOrderFingerprints.length === 1
      ? inFileWorkOrderFingerprints[0]
      : null);
  const acceptedWorkOrderHashes = new Set(
    [workOrder.sha256, workOrderCanonicalSha256].filter(Boolean),
  );
  const rendererWorkOrder = declaredHashes(renderer.value, [
    "work_order_sha256",
    "production_work_order_sha256",
    "bindings.work_order_sha256",
    "bindings.production_work_order_sha256",
  ]);
  if (!rendererWorkOrder.length) {
    blockers.push("renderer_production_work_order_sha256_required");
  } else if (
    rendererWorkOrder.length !== 1 ||
    !acceptedWorkOrderHashes.has(rendererWorkOrder[0])
  ) {
    blockers.push("renderer_production_work_order_sha256_mismatch");
  }

  const rendererMedia = declaredHashes(renderer.value, [
    "media_sha256",
    "final_media_sha256",
    "master_sha256",
    "output.sha256",
    "output.media_sha256",
    "master.sha256",
    "bindings.media_sha256",
    "bindings.final_media_sha256",
  ]);
  if (!rendererMedia.length) {
    blockers.push("renderer_final_media_sha256_required");
  } else if (
    rendererMedia.length !== 1 ||
    rendererMedia[0] !== finalMedia.sha256
  ) {
    blockers.push("renderer_final_media_sha256_mismatch");
  }

  const qaMedia = declaredHashes(qa.value, [
    "media_sha256",
    "final_media_sha256",
    "output.sha256",
    "bindings.media_sha256",
    "bindings.final_media_sha256",
  ]);
  if (!qaMedia.length) {
    blockers.push("qa_final_media_sha256_required");
  } else if (qaMedia.length !== 1 || qaMedia[0] !== finalMedia.sha256) {
    blockers.push("qa_final_media_sha256_mismatch");
  }

  const qaRenderer = declaredHashes(qa.value, [
    "renderer_manifest_sha256",
    "renderer_manifest_file_sha256",
    "renderer_manifest.sha256",
    "bindings.renderer_manifest_sha256",
    "bindings.renderer_manifest_file_sha256",
  ]);
  const acceptedRendererHashes = new Set(
    [renderer.sha256, derivedRendererCanonicalSha256].filter(Boolean),
  );
  if (!qaRenderer.length) {
    blockers.push("qa_renderer_manifest_sha256_required");
  } else if (
    qaRenderer.length !== 1 ||
    !acceptedRendererHashes.has(qaRenderer[0])
  ) {
    blockers.push("qa_renderer_manifest_sha256_mismatch");
  }

  return {
    blockers,
    production_work_order_file_sha256: workOrder.sha256,
    production_work_order_canonical_sha256:
      workOrderCanonicalSha256,
    renderer_bound_work_order_sha256:
      rendererWorkOrder.length === 1 ? rendererWorkOrder[0] : null,
    renderer_manifest_sha256: renderer.sha256,
    renderer_manifest_canonical_sha256:
      derivedRendererCanonicalSha256,
    final_media_sha256: finalMedia.sha256,
    qa_sha256: qa.sha256,
  };
}

function qaAssessment(qa) {
  const blockers = [];
  const verdict = text(qa.value?.verdict || qa.value?.status).toUpperCase();
  if (!["GREEN", "PASS"].includes(verdict)) {
    blockers.push("qa_green_or_pass_required");
  }
  if (
    qa.value?.ready === false ||
    qa.value?.passed === false ||
    (Array.isArray(qa.value?.blockers) && qa.value.blockers.length)
  ) {
    blockers.push("qa_blockers_present");
  }
  return { blockers, verdict };
}

function workOrderAssessment(workOrder) {
  const blockers = [];
  const state = text(
    workOrder.value?.status || workOrder.value?.verdict,
  ).toUpperCase();
  if (
    state &&
    (["HOLD", "BLOCKED", "FAILED", "REJECTED"].includes(state) ||
      state.startsWith("BLOCKED"))
  ) {
    blockers.push("production_work_order_not_ready");
  }
  if (
    Array.isArray(workOrder.value?.blockers) &&
    workOrder.value.blockers.length
  ) {
    blockers.push("production_work_order_blockers_present");
  }
  return { blockers, status: state || null };
}

function rendererAssessment(renderer) {
  const blockers = [];
  const state = text(
    renderer.value?.verdict || renderer.value?.status,
  ).toUpperCase();
  if (
    state &&
    (["HOLD", "BLOCKED", "FAILED", "REJECTED"].includes(state) ||
      state.startsWith("BLOCKED"))
  ) {
    blockers.push("renderer_manifest_not_ready");
  }
  if (
    Array.isArray(renderer.value?.blockers) &&
    renderer.value.blockers.length
  ) {
    blockers.push("renderer_manifest_blockers_present");
  }
  return { blockers, status: state || null };
}

function record(artifact) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    canonical_sha256: artifact.canonical_sha256,
    byte_length: artifact.byte_length,
    schema_version: text(artifact.value?.schema_version) || null,
  };
}

function renderMarkdown(packet) {
  const artifactRows = Object.entries(packet.artifacts).map(
    ([name, artifact]) =>
      `| ${name} | ${artifact.sha256 || "unavailable"} | ${
        artifact.path || "withheld"
      } |`,
  );
  const blockers = packet.blockers.length
    ? packet.blockers.map((blocker) => `- ${blocker}`)
    : ["- None"];
  return [
    "# Governed lane human-review packet",
    "",
    `- Lane: ${packet.lane_id}`,
    `- Story: ${packet.story_id}`,
    `- Verdict: ${packet.verdict}`,
    `- Immutable fingerprint: ${packet.immutable_fingerprint_sha256}`,
    "",
    "## Exact artefact bindings",
    "",
    "| Artefact | SHA-256 | Local path |",
    "| --- | --- | --- |",
    ...artifactRows,
    "",
    "## Machine blockers",
    "",
    ...blockers,
    "",
    "## Authority boundary",
    "",
    "- This packet creates no human approval, admission or publish authority.",
    "- A human decision remains unset and must bind this exact fingerprint.",
    "- No network, database, OAuth, token or external publish action occurred.",
    "",
  ].join("\n");
}

async function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await fsp.open(temporaryPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close();
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function prepareOutputDirectory(outputDir) {
  if (!text(outputDir)) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_output_dir_required",
    );
  }
  const outputRoot = path.resolve(outputDir);
  if (isSecretPath(outputRoot)) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_secret_output_dir_forbidden",
    );
  }
  await fsp.mkdir(outputRoot, { recursive: true });
  const stat = await fsp.lstat(outputRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_output_dir_invalid",
    );
  }
  const realPath = await fsp.realpath(outputRoot);
  if (isSecretPath(realPath)) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_secret_output_dir_forbidden",
    );
  }
  return outputRoot;
}

async function materializeGovernedLaneReviewPacket(input = {}) {
  const laneId = text(input.lane_id);
  const storyId = text(input.story_id);
  if (!LANE_IDS.has(laneId)) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_lane_id_invalid",
    );
  }
  if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(storyId)) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_story_id_invalid",
    );
  }
  const generated = new Date(input.generated_at);
  if (!input.generated_at || Number.isNaN(generated.getTime())) {
    throw new GovernedLaneReviewPacketError(
      "governed_lane_review_packet_generated_at_invalid",
    );
  }
  const generatedAt = generated.toISOString();
  const outputRoot = await prepareOutputDirectory(input.output_dir);
  const definitions = [
    ["production_work_order", input.production_work_order_ref, true],
    ["final_media", input.final_media_ref, false],
    ["renderer_manifest", input.renderer_manifest_ref, true],
    ["qa", input.qa_ref, true],
    ["source_evidence", input.source_evidence_ref, true],
    ["rights_ledger", input.rights_ledger_ref, true],
    [
      "originality_transformation",
      input.originality_transformation_ref,
      true,
    ],
    [
      "synthetic_disclosure_proposal",
      input.synthetic_disclosure_proposal_ref,
      true,
    ],
  ];
  const inspectedEntries = await Promise.all(
    definitions.map(async ([name, ref, json]) => [
      name,
      await readHashBoundFile({
        ref,
        name,
        expectedStoryId: storyId,
        expectedLaneId: laneId,
        json,
      }),
    ]),
  );
  const inspected = Object.fromEntries(inspectedEntries);
  const blockers = inspectedEntries.flatMap(([, value]) => value.blockers);
  const artifactBindingsMatch = inspectedEntries.every(
    ([, value]) => value.blockers.length === 0,
  );

  const workOrder = workOrderAssessment(inspected.production_work_order);
  const renderer = rendererAssessment(inspected.renderer_manifest);
  const qa = qaAssessment(inspected.qa);
  blockers.push(...workOrder.blockers, ...renderer.blockers, ...qa.blockers);

  const bindings = bindingAssessment({
    renderer: inspected.renderer_manifest,
    qa: inspected.qa,
    workOrder: inspected.production_work_order,
    finalMedia: inspected.final_media,
  });
  blockers.push(...bindings.blockers);

  const rightsExpectedSha256 =
    inspected.rights_ledger.canonical_sha256 ||
    normaliseSha256(inspected.rights_ledger.value?.ledger_sha256);
  const rights = assessRightsLedger(
    inspected.rights_ledger.value,
    rightsExpectedSha256,
  );
  blockers.push(...rights.blockers.map((blocker) => `rights:${blocker}`));

  const originalityValue =
    inspected.originality_transformation.value?.originality_transformation ||
    inspected.originality_transformation.value ||
    {};
  const originality = assessOriginalityTransformation({
    ...originalityValue,
    evidence_ref: inspected.originality_transformation.path,
    evidence_sha256: inspected.originality_transformation.sha256,
  });
  blockers.push(
    ...originality.blockers.map(
      (blocker) => `originality:${blocker}`,
    ),
  );

  const proposalValue =
    inspected.synthetic_disclosure_proposal.value?.proposal ||
    inspected.synthetic_disclosure_proposal.value
      ?.synthetic_media_disclosure ||
    inspected.synthetic_disclosure_proposal.value ||
    {};
  const synthetic = assessSyntheticMediaDisclosure({
    ...proposalValue,
    reviewed_at: proposalValue.reviewed_at || proposalValue.proposed_at,
  });
  blockers.push(
    ...synthetic.blockers.map(
      (blocker) => `synthetic_disclosure_proposal:${blocker}`,
    ),
  );
  const normalisedSyntheticProposal = {
    contains_synthetic_media:
      synthetic.decision.contains_synthetic_media,
    synthetic_disclosure_required:
      synthetic.decision.synthetic_disclosure_required,
    proposed_decision: synthetic.decision.decision,
    rationale: synthetic.decision.rationale,
    disclosure_text: synthetic.decision.disclosure_text,
    policy_basis: synthetic.decision.policy_basis,
    youtube_field_value: synthetic.decision.youtube_field_value,
    proposed_at: synthetic.decision.reviewed_at,
  };

  const exactBlockers = unique(blockers).sort();
  const packetWithoutFingerprint = {
    schema_version: PACKET_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    mode: "HUMAN_REVIEW",
    lane_id: laneId,
    story_id: storyId,
    verdict: exactBlockers.length ? "HOLD" : "READY_FOR_HUMAN_REVIEW",
    blockers: exactBlockers,
    artifacts: Object.fromEntries(
      inspectedEntries.map(([name, artifact]) => [name, record(artifact)]),
    ),
    exact_bindings: {
      production_work_order_sha256:
        bindings.production_work_order_file_sha256,
      production_work_order_file_sha256:
        bindings.production_work_order_file_sha256,
      production_work_order_canonical_sha256:
        bindings.production_work_order_canonical_sha256,
      renderer_bound_work_order_sha256:
        bindings.renderer_bound_work_order_sha256,
      renderer_manifest_sha256: bindings.renderer_manifest_sha256,
      renderer_manifest_canonical_sha256:
        bindings.renderer_manifest_canonical_sha256,
      final_media_sha256: bindings.final_media_sha256,
      qa_sha256: bindings.qa_sha256,
      files_and_identities_match: artifactBindingsMatch,
      all_match:
        artifactBindingsMatch && bindings.blockers.length === 0,
    },
    assessments: {
      production_work_order: {
        status: workOrder.status,
        ready: workOrder.blockers.length === 0,
      },
      renderer_manifest: {
        status: renderer.status,
        ready: renderer.blockers.length === 0,
      },
      qa: {
        verdict: qa.verdict,
        green_or_pass: qa.blockers.length === 0,
      },
      rights: {
        cleared: rights.blockers.length === 0,
        canonical_sha256: rights.sha256,
        decision: rights.decision.decision,
      },
      originality_transformation: {
        accepted: originality.blockers.length === 0,
        decision: originality.decision,
      },
      synthetic_disclosure_proposal: {
        complete: synthetic.blockers.length === 0,
        proposal: normalisedSyntheticProposal,
        proposal_only: true,
      },
    },
    human_review: {
      required: true,
      status: exactBlockers.length ? "BLOCKED_BY_MACHINE_EVIDENCE" : "PENDING",
      decision: null,
      approval_inferred: false,
      approval_recorded: false,
    },
    authority: {
      approval_created: false,
      admission_created: false,
      scheduler_created: false,
      publish_created: false,
      external_publish_authorised: false,
    },
    safety: {
      local_files_only: true,
      files_rehashed: true,
      regular_non_symlink_files_required: true,
      network_used: false,
      database_mutated: false,
      oauth_mutated: false,
      tokens_mutated: false,
      external_posting_attempted: false,
    },
  };
  const packet = {
    ...packetWithoutFingerprint,
    immutable_fingerprint_sha256: fingerprintValue(
      packetWithoutFingerprint,
    ),
  };
  const jsonPath = path.join(outputRoot, "governed-lane-review-packet.json");
  const markdownPath = path.join(
    outputRoot,
    "governed-lane-review-packet.md",
  );
  const jsonBytes = Buffer.from(
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
  const markdownBytes = Buffer.from(renderMarkdown(packet), "utf8");
  await writeAtomic(markdownPath, markdownBytes);
  // JSON is the machine-readable commit marker, so expose it only after the
  // human-readable companion has been durably replaced.
  await writeAtomic(jsonPath, jsonBytes);
  return {
    packet,
    paths: {
      json: jsonPath,
      markdown: markdownPath,
    },
    sha256: {
      json: sha256Bytes(jsonBytes),
      markdown: sha256Bytes(markdownBytes),
    },
  };
}

module.exports = {
  GENERATOR_ID,
  GovernedLaneReviewPacketError,
  PACKET_SCHEMA,
  fingerprintValue,
  materializeGovernedLaneReviewPacket,
  renderMarkdown,
};
