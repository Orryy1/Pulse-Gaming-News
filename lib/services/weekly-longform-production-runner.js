"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  workOrderFingerprint,
} = require("./weekly-longform-work-order");
const {
  materializeLongformSameRunEvidence,
} = require("./longform-same-run-evidence");

const RESULT_SCHEMA = "pulse-weekly-longform-production-result-v1";
const GENERATOR_ID = "pulse-weekly-longform-production-runner-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRE_PRODUCTION_EVIDENCE_BLOCKERS = new Set([
  "final_narration_evidence_required",
  "real_word_alignment_evidence_required",
  "final_master_evidence_required",
]);

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function validateGeneratedAt(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw new Error("weekly_longform_production_generated_at_invalid");
  }
  return new Date(parsed).toISOString();
}

function validateRunId(value) {
  const runId = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    throw new Error("weekly_longform_production_run_id_invalid");
  }
  return runId;
}

function baseResult({ runId, generatedAt, workOrder }) {
  const admission = productionAdmission(workOrder);
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: runId,
    mode: "LOCAL_PROOF",
    status: "BLOCKED",
    phase: "ADMISSION",
    blockers: [],
    work_order: {
      schema_version: text(workOrder?.schema_version) || null,
      status: text(workOrder?.status).toUpperCase() || null,
      production_runner_admission_status: admission.status,
      sha256: text(workOrder?.work_order_sha256).toLowerCase() || null,
    },
    adapter_execution: [],
    artifacts: {},
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_used_by_runner: false,
    network_used_by_adapters: false,
  };
}

function productionAdmission(workOrder) {
  const declared = workOrder?.production_runner_admission;
  if (
    declared &&
    typeof declared === "object" &&
    !Array.isArray(declared)
  ) {
    return {
      status: text(declared.status).toUpperCase(),
      scope: text(declared.scope),
      blockers: Array.isArray(declared.blockers)
        ? declared.blockers.map(text).filter(Boolean)
        : [],
      explicit: true,
    };
  }
  return {
    status: text(workOrder?.status).toUpperCase(),
    scope: null,
    blockers: Array.isArray(workOrder?.blockers)
      ? workOrder.blockers.map(text).filter(Boolean)
      : [],
    explicit: false,
  };
}

function admissionBlockers(workOrder) {
  const blockers = [];
  const admission = productionAdmission(workOrder);
  if (
    workOrder?.schema_version !==
    "pulse-weekly-longform-work-order-v1"
  ) {
    blockers.push("weekly_work_order_schema_invalid");
  }
  if (workOrder?.mode !== "LOCAL_PROOF") {
    blockers.push("weekly_work_order_local_proof_required");
  }
  if (admission.status !== "READY") {
    blockers.push("weekly_work_order_ready_required");
  }
  if (
    admission.explicit &&
    admission.scope !== "LOCAL_PROOF_PRODUCTION_RUNNER"
  ) {
    blockers.push("weekly_work_order_admission_scope_invalid");
  }
  if (admission.blockers.length > 0) {
    blockers.push("weekly_work_order_has_blockers");
  }
  const topLevelBlockers = Array.isArray(workOrder?.blockers)
    ? workOrder.blockers.map(text).filter(Boolean)
    : [];
  if (
    admission.explicit &&
    topLevelBlockers.some(
      (blocker) => !PRE_PRODUCTION_EVIDENCE_BLOCKERS.has(blocker),
    )
  ) {
    blockers.push("weekly_work_order_has_non_production_blockers");
  } else if (!admission.explicit && topLevelBlockers.length > 0) {
    blockers.push("weekly_work_order_has_blockers");
  }
  const declaredFingerprint = text(
    workOrder?.work_order_sha256,
  ).toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(declaredFingerprint) ||
    workOrderFingerprint(workOrder) !== declaredFingerprint
  ) {
    blockers.push("weekly_work_order_fingerprint_invalid");
  }
  if (workOrder?.safety?.external_publish_authorised !== false) {
    blockers.push("weekly_work_order_publish_authority_forbidden");
  }
  const selected = Array.isArray(workOrder?.selection?.selected)
    ? workOrder.selection.selected
    : [];
  if (selected.length < 4 || selected.length > 6) {
    blockers.push("weekly_work_order_story_set_invalid");
  }
  const admittedAssetsByStory = new Map();
  let visualAdmissionInvalid = false;
  for (const story of selected) {
    const visualAdmission = story?.visual_asset_admission;
    const admittedAssetIds = Array.isArray(
      visualAdmission?.admitted_asset_ids,
    )
      ? visualAdmission.admitted_asset_ids.map(text).filter(Boolean)
      : [];
    if (
      visualAdmission?.schema_version !==
        "pulse-weekly-longform-visual-admission-v1" ||
      text(visualAdmission?.status).toUpperCase() !== "READY" ||
      (Array.isArray(visualAdmission?.blockers) &&
        visualAdmission.blockers.length > 0) ||
      new Set(admittedAssetIds).size < 3 ||
      Number(
        visualAdmission?.landscape_exact_subject_asset_count,
      ) < 3 ||
      Number(
        visualAdmission?.landscape_exact_subject_motion_count,
      ) < 1
    ) {
      visualAdmissionInvalid = true;
    }
    admittedAssetsByStory.set(
      text(story?.story_id),
      new Set(admittedAssetIds),
    );
  }
  if (visualAdmissionInvalid) {
    blockers.push("weekly_work_order_visual_admission_required");
  }
  if (
    workOrder?.dossier?.schema_version !==
      "pulse-weekly-editorial-dossier-v1" ||
    Number(workOrder?.dossier?.story_count) !== selected.length
  ) {
    blockers.push("weekly_work_order_dossier_invalid");
  }
  const scriptText = text(workOrder?.script?.full_script);
  const scriptSha256 = normaliseSha256(workOrder?.script?.sha256);
  if (
    workOrder?.script?.schema_version !==
      "pulse-weekly-longform-script-v1" ||
    !scriptText ||
    !scriptSha256 ||
    sha256Buffer(Buffer.from(scriptText, "utf8")) !== scriptSha256 ||
    Number(workOrder?.script?.estimated_duration_seconds) < 480 ||
    Number(workOrder?.script?.estimated_duration_seconds) > 720
  ) {
    blockers.push("weekly_work_order_script_invalid");
  }
  if (
    workOrder?.visual_beat_plan?.schema_version !==
      "pulse-weekly-visual-beat-plan-v1" ||
    !Array.isArray(workOrder?.visual_beat_plan?.beats) ||
    workOrder.visual_beat_plan.beats.length === 0
  ) {
    blockers.push("weekly_work_order_visual_plan_invalid");
  } else {
    const usedAssetsByStory = new Map();
    const visualPlanMismatch =
      workOrder.visual_beat_plan.beats.some((beat) => {
        const storyId = text(beat?.story_id);
        const assetItemId = text(beat?.asset_item_id);
        const admittedAssets = admittedAssetsByStory.get(storyId);
        if (
          !storyId ||
          !assetItemId ||
          !admittedAssets?.has(assetItemId)
        ) {
          return true;
        }
        if (!usedAssetsByStory.has(storyId)) {
          usedAssetsByStory.set(storyId, new Set());
        }
        const usedAssets = usedAssetsByStory.get(storyId);
        if (usedAssets.has(assetItemId)) return true;
        usedAssets.add(assetItemId);
        return false;
      }) ||
      selected.some(
        (story) =>
          (usedAssetsByStory.get(text(story?.story_id))?.size ||
            0) < 3,
      );
    if (visualPlanMismatch) {
      blockers.push(
        "weekly_work_order_visual_plan_admission_mismatch",
      );
    }
  }
  if (
    workOrder?.derivative_plan?.schema_version !==
      "pulse-weekly-derivative-plan-v1" ||
    !Array.isArray(workOrder?.derivative_plan?.items) ||
    workOrder.derivative_plan.items.length === 0
  ) {
    blockers.push("weekly_work_order_derivative_plan_invalid");
  }
  return unique(blockers);
}

function adapterPreflightBlockers(
  adapters,
  materializeDerivatives,
) {
  const blockers = [
    ["narration", "narration_adapter_required"],
    ["alignment", "alignment_adapter_required"],
    ["render", "render_adapter_required"],
    ["variants", "variants_adapter_required"],
    ["decodedQa", "decoded_qa_adapter_required"],
  ]
    .filter(
      ([name]) =>
        !adapters?.[name] ||
        typeof adapters[name].materialize !== "function",
    )
    .map(([, code]) => code);
  if (typeof materializeDerivatives !== "function") {
    blockers.push("derivative_materializer_required");
  }
  return blockers;
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function observeArtifact(
  record,
  prefix,
  { allowedRoot, json = false } = {},
) {
  const blockers = [];
  const filePath = text(record?.path);
  const declaredSha256 = normaliseSha256(record?.sha256);
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!declaredSha256) blockers.push(`${prefix}_sha256_required`);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_run_root`);
  }
  if (
    resolvedPath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    return {
      blockers: unique(blockers),
      path: resolvedPath,
      sha256: null,
      byte_length: 0,
      value: null,
    };
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256Buffer(bytes);
  if (!bytes.length) blockers.push(`${prefix}_file_empty`);
  if (observedSha256 !== declaredSha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
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
    blockers: unique(blockers),
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    value,
  };
}

function artifactRecord(observed) {
  return {
    path: observed.path,
    sha256: observed.sha256,
    byte_length: observed.byte_length,
  };
}

async function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeResult({ result, outputDir, runId }) {
  const runRoot = path.join(path.resolve(outputDir), runId);
  await fsp.mkdir(runRoot, { recursive: true });
  const resultPath = path.join(
    runRoot,
    "weekly-longform-production-result.json",
  );
  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeAtomic(resultPath, bytes);
  return {
    ...result,
    result_path: resultPath,
    result_sha256: sha256Buffer(bytes),
  };
}

async function runGovernedWeeklyLongformProduction({
  workOrder,
  outputDir,
  generatedAt = new Date().toISOString(),
  adapters = {},
  materializeDerivatives,
} = {}) {
  if (!text(outputDir)) {
    throw new Error("weekly_longform_production_output_dir_required");
  }
  const exactGeneratedAt = validateGeneratedAt(generatedAt);
  const runId = validateRunId(workOrder?.run_id);
  const result = baseResult({
    runId,
    generatedAt: exactGeneratedAt,
    workOrder,
  });
  const admission = productionAdmission(workOrder);

  if (admission.status === "HOLD") {
    result.blockers = unique([
      "weekly_work_order_hold",
      ...admission.blockers,
      ...(!admission.explicit && Array.isArray(workOrder?.blockers)
        ? workOrder.blockers.map(text)
        : []),
    ]);
    return writeResult({
      result,
      outputDir,
      runId,
    });
  }

  result.blockers = admissionBlockers(workOrder);
  if (result.blockers.length) {
    return writeResult({ result, outputDir, runId });
  }

  result.phase = "ADAPTER_PREFLIGHT";
  result.blockers = adapterPreflightBlockers(
    adapters,
    materializeDerivatives,
  );
  if (result.blockers.length) {
    return writeResult({ result, outputDir, runId });
  }

  const runRoot = path.join(path.resolve(outputDir), runId);
  await fsp.mkdir(runRoot, { recursive: true });
  const fail = async (phase, blockers, error = null) => {
    result.status = "BLOCKED";
    result.phase = phase;
    result.blockers = unique(blockers);
    result.network_used_by_adapters = result.adapter_execution.some(
      (entry) => entry.network_used === true,
    );
    if (error) {
      result.failure = {
        name: text(error.name) || "Error",
        code: text(error.code) || null,
        message: text(error.message).slice(0, 500) || "adapter_failed",
      };
    }
    return writeResult({ result, outputDir, runId });
  };
  const adapterContext = (name, extra = {}) => {
    const adapterOutputDir = path.join(runRoot, "adapters", name);
    fs.mkdirSync(adapterOutputDir, { recursive: true });
    return {
      runId,
      generatedAt: exactGeneratedAt,
      workOrder,
      outputDir: adapterOutputDir,
      ...extra,
    };
  };
  const invokeAdapter = async (name, context) => {
    try {
      return {
        output: await adapters[name].materialize(context),
        error: null,
      };
    } catch (error) {
      result.adapter_execution.push({
        adapter: name,
        status: "FAILED",
        network_used: false,
      });
      return { output: null, error };
    }
  };
  const recordAdapter = (name, output, status = "MATERIALISED") => {
    result.adapter_execution.push({
      adapter: name,
      status,
      network_used: output?.network_used === true,
    });
  };

  result.phase = "SCRIPT";
  const scriptPath = path.join(runRoot, "script.txt");
  const scriptBytes = Buffer.from(workOrder.script.full_script, "utf8");
  await writeAtomic(scriptPath, scriptBytes);
  const script = {
    path: scriptPath,
    sha256: sha256Buffer(scriptBytes),
    byte_length: scriptBytes.length,
    text: workOrder.script.full_script,
  };
  if (script.sha256 !== workOrder.script.sha256) {
    return fail("SCRIPT", ["weekly_work_order_script_sha256_mismatch"]);
  }
  result.artifacts.script = artifactRecord(script);

  result.phase = "NARRATION";
  const narrationRun = await invokeAdapter(
    "narration",
    adapterContext("narration", { script }),
  );
  if (narrationRun.error) {
    return fail(
      "NARRATION",
      ["narration_adapter_failed"],
      narrationRun.error,
    );
  }
  const narration = observeArtifact(
    narrationRun.output,
    "narration_audio",
    { allowedRoot: runRoot },
  );
  if (narration.blockers.length) {
    recordAdapter("narration", narrationRun.output, "INVALID_ARTIFACT");
    return fail("NARRATION", narration.blockers);
  }
  recordAdapter("narration", narrationRun.output);
  result.artifacts.narration = artifactRecord(narration);

  result.phase = "ALIGNMENT";
  const alignmentRun = await invokeAdapter(
    "alignment",
    adapterContext("alignment", {
      script,
      narration: artifactRecord(narration),
    }),
  );
  if (alignmentRun.error) {
    return fail(
      "ALIGNMENT",
      ["alignment_adapter_failed"],
      alignmentRun.error,
    );
  }
  const alignment = observeArtifact(
    alignmentRun.output,
    "word_alignment",
    { allowedRoot: runRoot, json: true },
  );
  const alignmentValue = alignment.value || {};
  const alignmentBlockers = [...alignment.blockers];
  if (
    alignmentValue.schema_version !== "pulse-word-timestamps-v1" ||
    text(alignmentValue.run_id) !== runId ||
    normaliseSha256(alignmentValue.script_sha256) !== script.sha256 ||
    normaliseSha256(alignmentValue.audio_sha256) !== narration.sha256 ||
    !normaliseSha256(alignmentValue.source_alignment_sha256) ||
    !text(alignmentValue.provider) ||
    !Array.isArray(alignmentValue.words) ||
    alignmentValue.words.length === 0
  ) {
    alignmentBlockers.push("real_word_alignment_invalid");
  }
  if (alignmentBlockers.length) {
    recordAdapter("alignment", alignmentRun.output, "INVALID_ARTIFACT");
    return fail("ALIGNMENT", alignmentBlockers);
  }
  recordAdapter("alignment", alignmentRun.output);
  result.artifacts.word_alignment = artifactRecord(alignment);

  result.phase = "RENDER";
  const renderRun = await invokeAdapter(
    "render",
    adapterContext("render", {
      script,
      narration: artifactRecord(narration),
      alignment: {
        ...artifactRecord(alignment),
        value: alignmentValue,
      },
    }),
  );
  if (renderRun.error) {
    return fail("RENDER", ["render_adapter_failed"], renderRun.error);
  }
  const master = observeArtifact(
    renderRun.output?.master,
    "render_master",
    { allowedRoot: runRoot },
  );
  const rights = observeArtifact(
    renderRun.output?.rights,
    "render_rights_lineage",
    { allowedRoot: runRoot, json: true },
  );
  const renderBlockers = [...master.blockers, ...rights.blockers];
  if (renderBlockers.length) {
    recordAdapter("render", renderRun.output, "INVALID_ARTIFACT");
    return fail("RENDER", renderBlockers);
  }
  recordAdapter("render", renderRun.output);
  result.artifacts.master = artifactRecord(master);
  result.artifacts.rights_lineage_input = artifactRecord(rights);

  result.phase = "VARIANTS";
  const variantsRun = await invokeAdapter(
    "variants",
    adapterContext("variants", {
      master: artifactRecord(master),
    }),
  );
  if (variantsRun.error) {
    return fail(
      "VARIANTS",
      ["variants_adapter_failed"],
      variantsRun.error,
    );
  }
  const variants = observeArtifact(
    variantsRun.output,
    "platform_variants",
    { allowedRoot: runRoot, json: true },
  );
  if (variants.blockers.length) {
    recordAdapter("variants", variantsRun.output, "INVALID_ARTIFACT");
    return fail("VARIANTS", variants.blockers);
  }
  recordAdapter("variants", variantsRun.output);
  result.artifacts.platform_variants_input = artifactRecord(variants);

  result.phase = "DECODED_QA";
  const decodedQaRun = await invokeAdapter(
    "decodedQa",
    adapterContext("decoded-qa", {
      master: artifactRecord(master),
      alignment: artifactRecord(alignment),
      variants: artifactRecord(variants),
      renderer_manifest:
        renderRun.output?.renderer_manifest || null,
    }),
  );
  if (decodedQaRun.error) {
    return fail(
      "DECODED_QA",
      ["decoded_qa_adapter_failed"],
      decodedQaRun.error,
    );
  }
  const decodedQa = observeArtifact(
    decodedQaRun.output,
    "decoded_qa",
    { allowedRoot: runRoot, json: true },
  );
  if (decodedQa.blockers.length) {
    recordAdapter(
      "decodedQa",
      decodedQaRun.output,
      "INVALID_ARTIFACT",
    );
    return fail("DECODED_QA", decodedQa.blockers);
  }
  recordAdapter("decodedQa", decodedQaRun.output);
  result.artifacts.decoded_qa_input = artifactRecord(decodedQa);

  result.phase = "PACKAGE";
  const productionPackage = {
    schema_version: "pulse-longform-production-package-v1",
    generated_at: exactGeneratedAt,
    run_id: runId,
    work_order_sha256: workOrder.work_order_sha256,
    assets: {
      script: {
        path: script.path,
        sha256: script.sha256,
      },
      narration_audio: {
        path: narration.path,
        sha256: narration.sha256,
      },
      master: {
        path: master.path,
        sha256: master.sha256,
      },
    },
    evidence_inputs: {
      word_alignment: {
        path: alignment.path,
        sha256: alignment.sha256,
      },
      rights_lineage: {
        path: rights.path,
        sha256: rights.sha256,
      },
      platform_variants: {
        path: variants.path,
        sha256: variants.sha256,
      },
      decoded_qa: {
        path: decodedQa.path,
        sha256: decodedQa.sha256,
      },
    },
    adapter_provenance: result.adapter_execution.map((entry) => ({
      adapter: entry.adapter,
      status: entry.status,
      network_used: entry.network_used,
    })),
    controls: {
      local_proof_only: true,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  const packagePath = path.join(runRoot, "production-package.json");
  const packageBytes = Buffer.from(
    `${JSON.stringify(productionPackage, null, 2)}\n`,
    "utf8",
  );
  await writeAtomic(packagePath, packageBytes);
  result.artifacts.production_package = {
    path: packagePath,
    sha256: sha256Buffer(packageBytes),
    byte_length: packageBytes.length,
  };

  result.phase = "EVIDENCE_BINDING";
  let evidence;
  try {
    evidence = await materializeLongformSameRunEvidence({
      runId,
      generatedAt: exactGeneratedAt,
      packagePath,
      scriptPath: script.path,
      audioPath: narration.path,
      masterPath: master.path,
      timestampsPath: alignment.path,
      rightsPath: rights.path,
      platformVariantsPath: variants.path,
      decodedQaPath: decodedQa.path,
      outputDir: path.join(runRoot, "same-run-evidence"),
    });
  } catch (error) {
    return fail(
      "EVIDENCE_BINDING",
      ["same_run_evidence_binder_failed"],
      error,
    );
  }

  result.artifacts.same_run_manifest = {
    path: evidence.paths.manifest,
    sha256: sha256Buffer(fs.readFileSync(evidence.paths.manifest)),
  };
  result.artifacts.same_run_report = {
    path: evidence.paths.report,
    sha256: sha256Buffer(fs.readFileSync(evidence.paths.report)),
  };
  result.artifacts.caption_manifest = {
    path: evidence.paths.captionManifest,
    sha256: sha256Buffer(
      fs.readFileSync(evidence.paths.captionManifest),
    ),
  };
  result.artifacts.human_review_packet = {
    path: evidence.paths.humanReviewPacket,
    sha256: sha256Buffer(
      fs.readFileSync(evidence.paths.humanReviewPacket),
    ),
  };
  if (
    evidence.report?.machine_evidence_complete !== true ||
    evidence.manifest?.machine_evidence_complete !== true
  ) {
    return fail(
      "EVIDENCE_BINDING",
      evidence.report?.blockers?.length
        ? evidence.report.blockers
        : ["same_run_evidence_incomplete"],
    );
  }

  result.phase = "DERIVATIVES";
  let derivativeOutput;
  try {
    derivativeOutput = await materializeDerivatives({
      workOrder,
      sameRunEvidence: {
        manifest: result.artifacts.same_run_manifest,
        report: result.artifacts.same_run_report,
        caption_manifest: result.artifacts.caption_manifest,
        rights_lineage: {
          path: evidence.paths.rightsLineage,
          sha256: sha256Buffer(
            fs.readFileSync(evidence.paths.rightsLineage),
          ),
        },
      },
      outputDir: path.join(
        runRoot,
        "adapters",
        "derivatives",
      ),
      generatedAt: exactGeneratedAt,
    });
  } catch (error) {
    result.adapter_execution.push({
      adapter: "derivatives",
      status: "FAILED",
      network_used: false,
    });
    return fail(
      "DERIVATIVES",
      ["derivative_materializer_failed"],
      error,
    );
  }
  const derivatives = observeArtifact(
    {
      path: derivativeOutput?.manifest_path,
      sha256: derivativeOutput?.manifest_sha256,
    },
    "longform_derivatives_manifest",
    { allowedRoot: runRoot, json: true },
  );
  const derivativeManifest = derivatives.value || {};
  const derivativeBlockers = [...derivatives.blockers];
  if (
    derivativeManifest.schema_version !==
      "pulse-weekly-longform-derivative-manifest-v1" ||
    text(derivativeManifest.run_id) !== runId ||
    derivativeManifest.mode !== "LOCAL_PROOF" ||
    derivativeManifest.status !==
      "AWAITING_HUMAN_AV_REVIEW" ||
    !Array.isArray(derivativeManifest.clips) ||
    derivativeManifest.clips.length === 0 ||
    Number(derivativeManifest.clip_count) !==
      derivativeManifest.clips.length
  ) {
    derivativeBlockers.push(
      "longform_derivatives_manifest_invalid",
    );
  }
  if (
    derivativeManifest.controls
      ?.external_publish_authorised !== false ||
    derivativeManifest.controls
      ?.database_mutation_authorised !== false ||
    derivativeManifest.controls
      ?.oauth_mutation_authorised !== false ||
    derivativeManifest.controls?.network_used !== false ||
    derivativeOutput?.external_publish_authorised !== false ||
    derivativeOutput?.database_mutation_authorised !== false ||
    derivativeOutput?.oauth_mutation_authorised !== false
  ) {
    derivativeBlockers.push(
      "longform_derivatives_authority_invalid",
    );
  }
  if (derivativeBlockers.length) {
    result.adapter_execution.push({
      adapter: "derivatives",
      status: "INVALID_ARTIFACT",
      network_used:
        derivativeOutput?.network_used === true,
    });
    return fail("DERIVATIVES", derivativeBlockers);
  }
  result.adapter_execution.push({
    adapter: "derivatives",
    status: "MATERIALISED",
    network_used:
      derivativeOutput?.network_used === true,
  });
  result.artifacts.derivatives_manifest =
    artifactRecord(derivatives);

  result.phase = "REVIEW_EVIDENCE";
  let reviewEvidence;
  try {
    const {
      materializeWeeklyLongformReviewEvidence,
    } = require("./weekly-longform-review-evidence");
    reviewEvidence =
      await materializeWeeklyLongformReviewEvidence({
        runId,
        generatedAt: exactGeneratedAt,
        outputDir: path.join(
          runRoot,
          "governed-review-evidence",
        ),
        runRoot,
        workOrder,
        finalMedia: artifactRecord(master),
        rightsLedger: {
          ...artifactRecord(rights),
          canonical_sha256:
            normaliseSha256(rights.value?.ledger_sha256),
        },
        decodedQa: artifactRecord(decodedQa),
        rendererManifest:
          renderRun.output?.renderer_manifest || null,
        nativeRendererQa:
          decodedQaRun.output?.native_renderer_qa || null,
        originalityTransformation:
          renderRun.output?.originality_transformation || null,
        sameRunManifest:
          result.artifacts.same_run_manifest,
        sameRunReport: result.artifacts.same_run_report,
        derivativesManifest:
          result.artifacts.derivatives_manifest,
        productionAdapterNetworkUsed:
          result.adapter_execution.some(
            (entry) => entry.network_used === true,
          ),
      });
  } catch (error) {
    return fail(
      "REVIEW_EVIDENCE",
      error?.codes?.length
        ? error.codes
        : ["weekly_longform_review_evidence_failed"],
      error,
    );
  }
  result.review_evidence =
    reviewEvidence.review_evidence;
  result.artifacts.review_evidence_manifest =
    reviewEvidence.manifest_ref;

  if (
    reviewEvidence.manifest?.status !==
    "READY_FOR_HUMAN_AV_REVIEW"
  ) {
    result.status = "HOLD";
    result.phase = "REVIEW_EVIDENCE_PENDING";
    result.blockers = unique(
      reviewEvidence.manifest?.blockers?.length
        ? reviewEvidence.manifest.blockers
        : ["weekly_longform_review_evidence_pending"],
    );
  } else {
    result.status = "AWAITING_HUMAN_AV_REVIEW";
    result.phase = "DERIVATIVES_BOUND";
    result.blockers = ["human_av_review_pending"];
  }
  result.network_used_by_adapters = result.adapter_execution.some(
    (entry) => entry.network_used === true,
  );
  return writeResult({ result, outputDir, runId });
}

module.exports = {
  GENERATOR_ID,
  RESULT_SCHEMA,
  runGovernedWeeklyLongformProduction,
  sha256Buffer,
};
