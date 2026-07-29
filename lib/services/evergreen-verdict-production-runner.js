"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessOriginalityTransformation,
  assessRightsLedger,
  assessSyntheticMediaDisclosure,
} = require("./publication-evidence-gates");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  validatePlatformSafeZoneAudit,
} = require("./platform-safe-zones");

const RESULT_SCHEMA = "pulse-evergreen-production-result-v1";
const PACKAGE_SCHEMA = "pulse-evergreen-production-package-v1";
const RENDERER_SCHEMA = "pulse-evergreen-renderer-manifest-v1";
const GENERATOR_ID = "pulse-evergreen-production-runner-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function stableFingerprint(value) {
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

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function inspectBoundFile({
  ref,
  prefix,
  storyId,
  laneId,
  json = false,
  allowedRoot = null,
}) {
  const blockers = [];
  const filePath = text(ref?.path);
  const expectedSha256 = normaliseSha256(
    ref?.sha256 || ref?.file_sha256,
  );
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!expectedSha256) blockers.push(`${prefix}_sha256_required`);
  if (text(ref?.story_id) !== storyId) {
    blockers.push(`${prefix}_story_id_mismatch`);
  }
  if (text(ref?.lane_id) !== laneId) {
    blockers.push(`${prefix}_lane_id_mismatch`);
  }
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (resolvedPath && isSecretPath(resolvedPath)) {
    blockers.push(`${prefix}_secret_path_forbidden`);
  }
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_output_root`);
  }
  let bytes = null;
  let value = null;
  let observedSha256 = null;
  if (resolvedPath && !blockers.length) {
    try {
      const before = await fsp.lstat(resolvedPath, { bigint: true });
      if (before.isSymbolicLink()) {
        blockers.push(`${prefix}_symlink_forbidden`);
      } else if (!before.isFile()) {
        blockers.push(`${prefix}_regular_file_required`);
      } else if (before.size <= 0n) {
        blockers.push(`${prefix}_file_empty`);
      } else {
        bytes = await fsp.readFile(resolvedPath);
        const after = await fsp.lstat(resolvedPath, { bigint: true });
        if (
          after.isSymbolicLink() ||
          !after.isFile() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          Number(after.size) !== bytes.length
        ) {
          blockers.push(`${prefix}_changed_during_read`);
        }
        observedSha256 = sha256Bytes(bytes);
        if (observedSha256 !== expectedSha256) {
          blockers.push(`${prefix}_sha256_mismatch`);
        }
        if (json) {
          try {
            value = JSON.parse(bytes.toString("utf8"));
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value)
            ) {
              blockers.push(`${prefix}_json_object_required`);
              value = null;
            }
          } catch {
            blockers.push(`${prefix}_json_invalid`);
          }
        }
      }
    } catch (error) {
      blockers.push(`${prefix}_read_failed:${error.code || "unknown"}`);
    }
  }
  if (value) {
    if (text(value.story_id) !== storyId) {
      blockers.push(`${prefix}_embedded_story_id_mismatch`);
    }
    if (text(value.lane_id) !== laneId) {
      blockers.push(`${prefix}_embedded_lane_id_mismatch`);
    }
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes?.length || 0,
    value,
    blockers: unique(blockers),
    canonical_sha256: normaliseSha256(ref?.canonical_sha256),
  };
}

function artifactRecord(value) {
  return {
    path: value.path,
    sha256: value.sha256,
    byte_length: value.byte_length,
  };
}

function reviewRef(value, storyId, laneId, extra = {}) {
  return {
    path: value.path,
    sha256: value.sha256,
    story_id: storyId,
    lane_id: laneId,
    ...extra,
  };
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

async function writeJson(filePath, value) {
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await writeAtomic(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
    value,
  };
}

async function writeResult(result, outputRoot) {
  const resultArtifact = await writeJson(
    path.join(outputRoot, "evergreen-production-result.json"),
    result,
  );
  return {
    ...result,
    result_path: resultArtifact.path,
    result_sha256: resultArtifact.sha256,
  };
}

function baseResult({ generatedAt, storyId }) {
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    mode: "LOCAL_PROOF",
    lane_id: "evergreen_short",
    story_id: storyId,
    status: "BLOCKED",
    phase: "ADMISSION",
    blockers: [],
    artifacts: {},
    dependency_execution: [],
    governed_lane_review_evidence: null,
    network_used_by_runner: false,
    network_used_by_dependencies: false,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
  };
}

function productionInputRefs(workOrder) {
  const refs =
    workOrder?.production_input_refs &&
    typeof workOrder.production_input_refs === "object" &&
    !Array.isArray(workOrder.production_input_refs)
      ? workOrder.production_input_refs
      : {};
  return {
    source_evidence_ref: refs.source_evidence_ref || null,
    rights_ledger_ref: refs.rights_ledger_ref || null,
    originality_transformation_ref:
      refs.originality_transformation_ref || null,
    synthetic_disclosure_proposal_ref:
      refs.synthetic_disclosure_proposal_ref || null,
  };
}

function adapterBlockers(adapters) {
  return [
    ["materializeNarration", "evergreen_narration_adapter_required"],
    ["renderEvergreen", "evergreen_render_adapter_required"],
    ["runDecodedQa", "evergreen_decoded_qa_adapter_required"],
  ]
    .filter(([name]) => typeof adapters?.[name] !== "function")
    .map(([, blocker]) => blocker);
}

function rightsEvidenceMatchesWorkOrder(rightsLedger, workOrder) {
  const declared = Array.isArray(
    workOrder?.evergreen_governance?.work_order?.evidence?.rights_records,
  )
    ? workOrder.evergreen_governance.work_order.evidence.rights_records
    : [];
  const actual = Array.isArray(rightsLedger?.items)
    ? rightsLedger.items
    : [];
  const declaredById = new Map(
    declared.map((record) => [text(record?.asset_id), record]),
  );
  if (
    !declared.length ||
    actual.length !== declared.length ||
    actual.some(
      (item) =>
        !declaredById.has(text(item?.item_id)) ||
        text(declaredById.get(text(item?.item_id))?.source_url) !==
          text(item?.source_url),
    )
  ) {
    return ["evergreen_rights_work_order_binding_mismatch"];
  }
  return [];
}

function sourceEvidenceMatchesWorkOrder(sourceEvidence, workOrder) {
  const expected =
    workOrder?.evergreen_governance?.work_order?.evidence || {};
  const sourceMatches =
    stableFingerprint(sourceEvidence?.source_manifest || []) ===
    stableFingerprint(expected.source_manifest || []);
  const claimsMatch =
    stableFingerprint(sourceEvidence?.claims || []) ===
    stableFingerprint(expected.claims || []);
  return sourceMatches && claimsMatch
    ? []
    : ["evergreen_source_work_order_binding_mismatch"];
}

async function runGovernedEvergreenVerdictProduction({
  productionWorkOrderRef,
  outputDir,
  generatedAt = new Date().toISOString(),
  adapters = {},
} = {}) {
  const parsedGeneratedAt = Date.parse(text(generatedAt));
  if (!Number.isFinite(parsedGeneratedAt)) {
    throw new Error("evergreen_production_generated_at_invalid");
  }
  const exactGeneratedAt = new Date(parsedGeneratedAt).toISOString();
  const storyId = text(productionWorkOrderRef?.story_id);
  if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(storyId)) {
    throw new Error("evergreen_production_story_id_invalid");
  }
  if (!text(outputDir)) {
    throw new Error("evergreen_production_output_dir_required");
  }
  const outputRoot = path.resolve(outputDir);
  if (isSecretPath(outputRoot)) {
    throw new Error("evergreen_production_secret_output_dir_forbidden");
  }
  await fsp.mkdir(outputRoot, { recursive: true });
  const result = baseResult({
    generatedAt: exactGeneratedAt,
    storyId,
  });
  const fail = async (phase, blockers, error = null) => {
    result.phase = phase;
    result.status = "BLOCKED";
    result.blockers = unique(blockers);
    result.network_used_by_dependencies =
      result.dependency_execution.some(
        (entry) => entry.network_used === true,
      );
    if (error) {
      result.retryable = true;
      result.retry_after_seconds = 60;
      result.failure = {
        name: text(error.name) || "Error",
        code: text(error.code) || null,
        message: text(error.message).slice(0, 500) || "dependency_failed",
      };
    }
    return writeResult(result, outputRoot);
  };

  const workOrder = await inspectBoundFile({
    ref: productionWorkOrderRef,
    prefix: "evergreen_production_work_order",
    storyId,
    laneId: "evergreen_short",
    json: true,
  });
  result.artifacts.production_work_order = artifactRecord(workOrder);
  if (workOrder.blockers.length) {
    return fail("ADMISSION", workOrder.blockers);
  }
  const workOrderValue = workOrder.value;
  const admissionBlockers = [];
  if (
    workOrderValue?.schema_version !==
    "pulse-exact-short-work-order-v1"
  ) {
    admissionBlockers.push("evergreen_work_order_schema_invalid");
  }
  if (
    workOrderValue?.mode !== "LOCAL_PROOF" ||
    workOrderValue?.status !== "READY_FOR_EXACT_PRODUCTION" ||
    workOrderValue?.lane_id !== "evergreen_short" ||
    workOrderValue?.format_family !== "evergreen_verdict_short" ||
    workOrderValue?.story_id !== storyId ||
    !Array.isArray(workOrderValue?.exact_story_scope) ||
    workOrderValue.exact_story_scope.length !== 1 ||
    workOrderValue.exact_story_scope[0] !== storyId
  ) {
    admissionBlockers.push("evergreen_work_order_identity_invalid");
  }
  if (
    workOrderValue?.publish_authority !== false ||
    workOrderValue?.external_posting_authorised !== false ||
    workOrderValue?.oauth_mutation_authorised !== false ||
    workOrderValue?.database_mutation_authorised !== false
  ) {
    admissionBlockers.push(
      "evergreen_work_order_authority_forbidden",
    );
  }
  if (
    workOrderValue?.evergreen_governance?.verdict !==
      "READY_FOR_LOCAL_PRODUCTION" ||
    workOrderValue?.evergreen_governance?.work_order
      ?.schema_version !==
      "pulse-evergreen-production-work-order-v1"
  ) {
    admissionBlockers.push(
      "evergreen_governed_work_order_required",
    );
  }
  const scriptText = text(
    workOrderValue?.evergreen_governance?.work_order
      ?.script_contract?.full_script,
  );
  const scriptSha256 = scriptText
    ? sha256Bytes(Buffer.from(scriptText, "utf8"))
    : null;
  if (
    !scriptText ||
    scriptSha256 !== normaliseSha256(workOrderValue?.script_sha256)
  ) {
    admissionBlockers.push("evergreen_work_order_script_invalid");
  }
  if (
    Array.isArray(workOrderValue?.blockers) &&
    workOrderValue.blockers.length
  ) {
    admissionBlockers.push("evergreen_work_order_has_blockers");
  }
  if (admissionBlockers.length) {
    return fail("ADMISSION", admissionBlockers);
  }

  result.phase = "INPUT_EVIDENCE";
  const refs = productionInputRefs(workOrderValue);
  const [
    sourceEvidence,
    rightsLedger,
    originality,
    disclosure,
  ] = await Promise.all([
    inspectBoundFile({
      ref: refs.source_evidence_ref,
      prefix: "evergreen_source_evidence",
      storyId,
      laneId: "evergreen_short",
      json: true,
    }),
    inspectBoundFile({
      ref: refs.rights_ledger_ref,
      prefix: "evergreen_rights_ledger",
      storyId,
      laneId: "evergreen_short",
      json: true,
    }),
    inspectBoundFile({
      ref: refs.originality_transformation_ref,
      prefix: "evergreen_originality_transformation",
      storyId,
      laneId: "evergreen_short",
      json: true,
    }),
    inspectBoundFile({
      ref: refs.synthetic_disclosure_proposal_ref,
      prefix: "evergreen_synthetic_disclosure_proposal",
      storyId,
      laneId: "evergreen_short",
      json: true,
    }),
  ]);
  result.artifacts.source_evidence = artifactRecord(sourceEvidence);
  result.artifacts.rights_ledger = artifactRecord(rightsLedger);
  result.artifacts.originality_transformation =
    artifactRecord(originality);
  result.artifacts.synthetic_disclosure_proposal =
    artifactRecord(disclosure);
  const inputBlockers = [
    ...sourceEvidence.blockers,
    ...rightsLedger.blockers,
    ...originality.blockers,
    ...disclosure.blockers,
  ];
  if (!inputBlockers.length) {
    inputBlockers.push(
      ...sourceEvidenceMatchesWorkOrder(
        sourceEvidence.value,
        workOrderValue,
      ),
      ...rightsEvidenceMatchesWorkOrder(
        rightsLedger.value,
        workOrderValue,
      ),
    );
    const rights = assessRightsLedger(
      rightsLedger.value,
      rightsLedger.canonical_sha256 ||
        normaliseSha256(rightsLedger.value?.ledger_sha256),
    );
    inputBlockers.push(
      ...rights.blockers.map((blocker) => `rights:${blocker}`),
    );
    const originalityDecision = assessOriginalityTransformation({
      ...(originality.value?.originality_transformation ||
        originality.value ||
        {}),
      evidence_ref: originality.path,
      evidence_sha256: originality.sha256,
    });
    inputBlockers.push(
      ...originalityDecision.blockers.map(
        (blocker) => `originality:${blocker}`,
      ),
    );
    const disclosureDecision = assessSyntheticMediaDisclosure(
      disclosure.value?.proposal ||
        disclosure.value?.synthetic_media_disclosure ||
        disclosure.value ||
        {},
    );
    inputBlockers.push(
      ...disclosureDecision.blockers.map(
        (blocker) => `synthetic_disclosure_proposal:${blocker}`,
      ),
    );
  }
  if (inputBlockers.length) {
    return fail("INPUT_EVIDENCE", inputBlockers);
  }

  result.phase = "DEPENDENCY_PREFLIGHT";
  const missingAdapters = adapterBlockers(adapters);
  if (missingAdapters.length) {
    return fail("DEPENDENCY_PREFLIGHT", missingAdapters);
  }

  const scriptArtifact = await (async () => {
    const scriptPath = path.join(outputRoot, "script.txt");
    const bytes = Buffer.from(scriptText, "utf8");
    await writeAtomic(scriptPath, bytes);
    return {
      path: scriptPath,
      sha256: sha256Bytes(bytes),
      byte_length: bytes.length,
      text: scriptText,
    };
  })();
  result.artifacts.script = artifactRecord(scriptArtifact);

  const invoke = async (name, args) => {
    try {
      const output = await adapters[name](args);
      result.dependency_execution.push({
        dependency: name,
        status: "MATERIALISED",
        network_used: output?.network_used === true,
      });
      return { output, error: null };
    } catch (error) {
      result.dependency_execution.push({
        dependency: name,
        status: "FAILED",
        network_used: false,
      });
      return { output: null, error };
    }
  };

  result.phase = "NARRATION";
  const narrationDir = path.join(outputRoot, "narration");
  await fsp.mkdir(narrationDir, { recursive: true });
  const narrationRun = await invoke("materializeNarration", {
    story_id: storyId,
    lane_id: "evergreen_short",
    generated_at: exactGeneratedAt,
    output_dir: narrationDir,
    script: {
      path: scriptArtifact.path,
      sha256: scriptArtifact.sha256,
      text: scriptArtifact.text,
    },
    work_order: workOrderValue,
  });
  if (narrationRun.error) {
    return fail(
      "NARRATION",
      ["evergreen_narration_adapter_failed"],
      narrationRun.error,
    );
  }
  const narration = await inspectBoundFile({
    ref: {
      ...narrationRun.output,
      story_id: storyId,
      lane_id: "evergreen_short",
    },
    prefix: "evergreen_narration",
    storyId,
    laneId: "evergreen_short",
    allowedRoot: outputRoot,
  });
  if (narration.blockers.length) {
    return fail("NARRATION", narration.blockers);
  }
  result.artifacts.narration = artifactRecord(narration);

  result.phase = "RENDER";
  const renderDir = path.join(outputRoot, "render");
  await fsp.mkdir(renderDir, { recursive: true });
  const renderRun = await invoke("renderEvergreen", {
    story_id: storyId,
    lane_id: "evergreen_short",
    generated_at: exactGeneratedAt,
    output_dir: renderDir,
    work_order: workOrderValue,
    production_work_order: artifactRecord(workOrder),
    script: artifactRecord(scriptArtifact),
    narration: artifactRecord(narration),
    source_evidence: {
      ...artifactRecord(sourceEvidence),
      value: sourceEvidence.value,
    },
    rights_ledger: {
      ...artifactRecord(rightsLedger),
      canonical_sha256:
        rightsLedger.canonical_sha256 ||
        normaliseSha256(rightsLedger.value?.ledger_sha256),
      value: rightsLedger.value,
    },
  });
  if (renderRun.error) {
    return fail(
      "RENDER",
      [
        "evergreen_render_adapter_failed",
        /^[a-z0-9_:-]+$/i.test(text(renderRun.error.code))
          ? text(renderRun.error.code)
          : null,
      ],
      renderRun.error,
    );
  }
  const finalMedia = await inspectBoundFile({
    ref: {
      ...renderRun.output,
      story_id: storyId,
      lane_id: "evergreen_short",
    },
    prefix: "evergreen_final_media",
    storyId,
    laneId: "evergreen_short",
    allowedRoot: outputRoot,
  });
  if (finalMedia.blockers.length) {
    return fail("RENDER", finalMedia.blockers);
  }
  const declaredRenderAssets = Array.isArray(
    renderRun.output?.exact_subject_assets,
  )
    ? renderRun.output.exact_subject_assets
    : [];
  const expectedAssetIds = new Set(
    (
      workOrderValue?.evergreen_governance?.work_order
        ?.visual_beat_plan?.beats || []
    )
      .map((beat) =>
        text(beat?.background?.asset_id || beat?.asset_id),
      )
      .filter(Boolean),
  );
  const rightsItems = new Map(
    (rightsLedger.value?.items || []).map((item) => [
      text(item?.item_id),
      item,
    ]),
  );
  const renderAssetBlockers = [];
  const observedRenderAssets = [];
  for (const asset of declaredRenderAssets) {
    const assetId = text(asset?.asset_id);
    const rightsItem = rightsItems.get(assetId);
    if (
      !assetId ||
      !expectedAssetIds.has(assetId) ||
      !rightsItem ||
      rightsItem.included_in_final !== true ||
      text(rightsItem.rights_decision).toUpperCase() !==
        "CLEARED" ||
      normaliseSha256(rightsItem.asset_sha256) !==
        normaliseSha256(asset?.sha256)
    ) {
      renderAssetBlockers.push(
        "evergreen_render_exact_subject_asset_binding_invalid",
      );
      continue;
    }
    const observedAsset = await inspectBoundFile({
      ref: {
        ...asset,
        story_id: storyId,
        lane_id: "evergreen_short",
      },
      prefix: `evergreen_render_asset:${assetId}`,
      storyId,
      laneId: "evergreen_short",
      allowedRoot: outputRoot,
    });
    renderAssetBlockers.push(...observedAsset.blockers);
    observedRenderAssets.push({
      asset_id: assetId,
      media_type: text(asset.media_type),
      ...artifactRecord(observedAsset),
    });
  }
  if (
    declaredRenderAssets.length === 0 ||
    observedRenderAssets.length !== expectedAssetIds.size ||
    new Set(observedRenderAssets.map((asset) => asset.asset_id))
      .size !== expectedAssetIds.size
  ) {
    renderAssetBlockers.push(
      "evergreen_render_exact_subject_assets_required",
    );
  }
  if (renderAssetBlockers.length) {
    return fail("RENDER", renderAssetBlockers);
  }
  const composition = renderRun.output?.composition || {};
  const compositionBlockers = [];
  if (composition.background_full_bleed !== true) {
    compositionBlockers.push(
      "evergreen_render_background_full_bleed_required",
    );
  }
  if (composition.text_inside_platform_safe_zone !== true) {
    compositionBlockers.push(
      "evergreen_render_safe_zone_compliance_required",
    );
  }
  if (composition.cards_replace_subject_media !== false) {
    compositionBlockers.push(
      "evergreen_render_card_first_composition_forbidden",
    );
  }
  if (
    text(composition.overlay_profile) !==
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID
  ) {
    compositionBlockers.push(
      "evergreen_render_safe_zone_profile_invalid",
    );
  }
  if (
    observedRenderAssets.some(
      (asset) => text(asset.media_type).toLowerCase() === "video",
    ) &&
    composition.video_motion_preserved !== true
  ) {
    compositionBlockers.push(
      "evergreen_render_native_video_motion_required",
    );
  }
  const safeZoneAudit = await inspectBoundFile({
    ref: {
      ...renderRun.output?.safe_zone_audit,
      story_id: storyId,
      lane_id: "evergreen_short",
    },
    prefix: "evergreen_render_safe_zone_audit",
    storyId,
    laneId: "evergreen_short",
    json: true,
    allowedRoot: outputRoot,
  });
  compositionBlockers.push(...safeZoneAudit.blockers);
  if (safeZoneAudit.value) {
    try {
      const safeZoneVerdict = validatePlatformSafeZoneAudit({
        audit: safeZoneAudit.value,
      });
      if (
        safeZoneVerdict.verdict !== "GREEN" ||
        safeZoneVerdict.profile_id !==
          CROSS_PLATFORM_PORTRAIT_PROFILE_ID
      ) {
        compositionBlockers.push(
          "evergreen_render_safe_zone_audit_invalid",
        );
      }
    } catch (error) {
      compositionBlockers.push(
        "evergreen_render_safe_zone_audit_invalid",
        ...(Array.isArray(error?.codes) ? error.codes : []),
      );
    }
  }
  if (compositionBlockers.length) {
    return fail("RENDER", compositionBlockers);
  }
  result.artifacts.final_media = artifactRecord(finalMedia);
  result.artifacts.exact_subject_assets =
    observedRenderAssets;
  result.artifacts.safe_zone_audit =
    artifactRecord(safeZoneAudit);
  const rendererManifestValue = {
    schema_version: RENDERER_SCHEMA,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    mode: "LOCAL_PROOF",
    status: "READY_FOR_QA",
    blockers: [],
    story_id: storyId,
    lane_id: "evergreen_short",
    work_order_sha256: workOrder.sha256,
    source_evidence_sha256: sourceEvidence.sha256,
    rights_ledger_sha256: rightsLedger.sha256,
    script_sha256: scriptArtifact.sha256,
    narration_sha256: narration.sha256,
    final_media_sha256: finalMedia.sha256,
    exact_subject_assets: observedRenderAssets,
    safe_zone_audit: artifactRecord(safeZoneAudit),
    composition: {
      background_full_bleed:
        renderRun.output?.composition?.background_full_bleed ===
        true,
      video_motion_preserved:
        renderRun.output?.composition?.video_motion_preserved ===
        true,
      still_motion:
        text(renderRun.output?.composition?.still_motion) ||
        null,
      overlay_profile:
        text(renderRun.output?.composition?.overlay_profile) ||
        null,
      text_inside_platform_safe_zone:
        renderRun.output?.composition
          ?.text_inside_platform_safe_zone === true,
      cards_replace_subject_media:
        renderRun.output?.composition
          ?.cards_replace_subject_media === true,
    },
    output: {
      path: finalMedia.path,
      sha256: finalMedia.sha256,
    },
    adapter_provenance: {
      dependency: "renderEvergreen",
      network_used: renderRun.output?.network_used === true,
    },
    authority: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  const rendererManifest = await writeJson(
    path.join(outputRoot, "renderer-manifest.json"),
    rendererManifestValue,
  );
  result.artifacts.renderer_manifest =
    artifactRecord(rendererManifest);

  result.phase = "DECODED_QA";
  const qaDir = path.join(outputRoot, "decoded-qa");
  await fsp.mkdir(qaDir, { recursive: true });
  const qaRun = await invoke("runDecodedQa", {
    story_id: storyId,
    lane_id: "evergreen_short",
    generated_at: exactGeneratedAt,
    output_dir: qaDir,
    work_order: workOrderValue,
    final_media: artifactRecord(finalMedia),
    renderer_manifest: artifactRecord(rendererManifest),
  });
  if (qaRun.error) {
    return fail(
      "DECODED_QA",
      ["evergreen_decoded_qa_adapter_failed"],
      qaRun.error,
    );
  }
  const qa = await inspectBoundFile({
    ref: {
      ...qaRun.output,
      story_id: storyId,
      lane_id: "evergreen_short",
    },
    prefix: "evergreen_decoded_qa",
    storyId,
    laneId: "evergreen_short",
    json: true,
    allowedRoot: outputRoot,
  });
  const qaBlockers = [...qa.blockers];
  if (
    qa.value?.schema_version !== "pulse-evergreen-decoded-qa-v1" ||
    !["PASS", "GREEN"].includes(
      text(qa.value?.verdict || qa.value?.status).toUpperCase(),
    ) ||
    qa.value?.passed === false ||
    (Array.isArray(qa.value?.blockers) &&
      qa.value.blockers.length > 0) ||
    normaliseSha256(qa.value?.media_sha256) !== finalMedia.sha256 ||
    normaliseSha256(qa.value?.renderer_manifest_sha256) !==
      rendererManifest.sha256
  ) {
    qaBlockers.push("evergreen_decoded_qa_invalid");
  }
  if (qaBlockers.length) {
    return fail("DECODED_QA", qaBlockers);
  }
  result.artifacts.qa = artifactRecord(qa);

  result.phase = "PACKAGE";
  const governedLaneReviewEvidence = {
    production_work_order_ref: reviewRef(
      workOrder,
      storyId,
      "evergreen_short",
    ),
    final_media_ref: reviewRef(
      finalMedia,
      storyId,
      "evergreen_short",
    ),
    renderer_manifest_ref: reviewRef(
      rendererManifest,
      storyId,
      "evergreen_short",
    ),
    qa_ref: reviewRef(qa, storyId, "evergreen_short"),
    source_evidence_ref: reviewRef(
      sourceEvidence,
      storyId,
      "evergreen_short",
    ),
    rights_ledger_ref: reviewRef(
      rightsLedger,
      storyId,
      "evergreen_short",
      {
        canonical_sha256:
          rightsLedger.canonical_sha256 ||
          normaliseSha256(rightsLedger.value?.ledger_sha256),
      },
    ),
    originality_transformation_ref: reviewRef(
      originality,
      storyId,
      "evergreen_short",
    ),
    synthetic_disclosure_proposal_ref: reviewRef(
      disclosure,
      storyId,
      "evergreen_short",
    ),
  };
  const productionPackage = {
    schema_version: PACKAGE_SCHEMA,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    mode: "LOCAL_PROOF",
    status: "AWAITING_HUMAN_REVIEW",
    story_id: storyId,
    lane_id: "evergreen_short",
    exact_bindings: governedLaneReviewEvidence,
    dependency_execution: result.dependency_execution,
    authority: {
      human_approval_created: false,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  const productionPackageArtifact = await writeJson(
    path.join(outputRoot, "evergreen-production-package.json"),
    productionPackage,
  );
  result.artifacts.production_package =
    artifactRecord(productionPackageArtifact);
  result.status = "AWAITING_HUMAN_REVIEW";
  result.phase = "REVIEW_HANDOFF";
  result.blockers = ["human_review_pending"];
  result.governed_lane_review_evidence =
    governedLaneReviewEvidence;
  result.network_used_by_dependencies =
    result.dependency_execution.some(
      (entry) => entry.network_used === true,
    );
  return writeResult(result, outputRoot);
}

module.exports = {
  GENERATOR_ID,
  PACKAGE_SCHEMA,
  RENDERER_SCHEMA,
  RESULT_SCHEMA,
  runGovernedEvergreenVerdictProduction,
  sha256Bytes,
};
