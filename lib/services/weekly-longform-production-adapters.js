"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");

const CAPABILITIES_SCHEMA =
  "pulse-weekly-longform-adapter-capabilities-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REAL_ALIGNMENT_PROVIDERS = new Set([
  "elevenlabs",
  "whisper",
  "whisperx",
  "assemblyai",
  "deepgram",
  "google_speech_to_text",
  "aws_transcribe",
  "forced_alignment",
  "provider_alignment",
]);
const REAL_TIMING_BASES = new Set([
  "",
  "provider_word_alignment",
  "forced_alignment",
  "speech_to_text_word_alignment",
]);
const REQUIRED_DECODED_QA_CHECKS = [
  "video_decode",
  "audio_decode",
  "captions",
  "av_sync",
  "black_frames",
  "freeze_frames",
  "blur",
  "repetition",
];

const CAPABILITY_DEFINITIONS = [
  {
    adapter: "narration",
    dependency: "produceNarration",
    blocker: "elevenlabs_narration_producer_unavailable",
  },
  {
    adapter: "alignment",
    dependency: "materializeAlignment",
    blocker: "real_alignment_producer_unavailable",
  },
  {
    adapter: "render",
    dependency: "renderLongform",
    blocker: "hyperframes_or_ffmpeg_renderer_unavailable",
  },
  {
    adapter: "variants",
    dependency: "materializeVariants",
    blocker: "platform_variants_producer_unavailable",
  },
  {
    adapter: "decodedQa",
    dependency: "runDecodedQa",
    blocker: "decoded_qa_producer_unavailable",
  },
];

class WeeklyLongformProductionAdapterError extends Error {
  constructor(codes) {
    const values = [
      ...new Set((Array.isArray(codes) ? codes : [codes]).filter(Boolean)),
    ];
    super(`weekly_longform_production_adapter_invalid: ${values.join(", ")}`);
    this.name = "WeeklyLongformProductionAdapterError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function observeFile(record, prefix, allowedRoot) {
  const blockers = [];
  const filePath = text(record?.path);
  const declaredSha256 = normaliseSha256(record?.sha256);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!declaredSha256) blockers.push(`${prefix}_sha256_required`);
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_output_dir`);
  }
  if (
    resolvedPath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    throw new WeeklyLongformProductionAdapterError(blockers);
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256Buffer(bytes);
  if (!bytes.length) blockers.push(`${prefix}_file_empty`);
  if (observedSha256 !== declaredSha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  if (blockers.length) {
    throw new WeeklyLongformProductionAdapterError(blockers);
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    bytes,
  };
}

function observeJson(record, prefix, allowedRoot) {
  const observed = observeFile(record, prefix, allowedRoot);
  try {
    return {
      ...observed,
      value: JSON.parse(observed.bytes.toString("utf8")),
    };
  } catch {
    throw new WeeklyLongformProductionAdapterError(
      `${prefix}_json_invalid`,
    );
  }
}

function runRootFromOutputDir(outputDir) {
  return path.resolve(outputDir, "..", "..");
}

function validateAdapterContext(context, { scriptRequired = false } = {}) {
  const blockers = [];
  const runId = text(context?.runId);
  const generatedAt = text(context?.generatedAt);
  const outputDir = text(context?.outputDir);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    blockers.push("adapter_run_id_invalid");
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    blockers.push("adapter_generated_at_invalid");
  }
  if (!outputDir) blockers.push("adapter_output_dir_required");
  if (scriptRequired) {
    const scriptText = text(context?.script?.text);
    const scriptSha256 = normaliseSha256(context?.script?.sha256);
    if (!scriptText) blockers.push("adapter_script_text_required");
    if (!text(context?.script?.path)) {
      blockers.push("adapter_script_path_required");
    }
    if (!scriptSha256) {
      blockers.push("adapter_script_sha256_required");
    } else if (
      scriptText &&
      sha256Buffer(Buffer.from(scriptText, "utf8")) !== scriptSha256
    ) {
      blockers.push("adapter_script_sha256_mismatch");
    }
  }
  if (blockers.length) {
    throw new WeeklyLongformProductionAdapterError(blockers);
  }
  const resolvedOutputDir = path.resolve(outputDir);
  let script = null;
  if (scriptRequired) {
    script = observeFile(
      context.script,
      "adapter_script_file",
      runRootFromOutputDir(resolvedOutputDir),
    );
    if (script.bytes.toString("utf8") !== context.script.text) {
      throw new WeeklyLongformProductionAdapterError(
        "adapter_script_file_text_mismatch",
      );
    }
  }
  return {
    runId,
    generatedAt: new Date(generatedAt).toISOString(),
    outputDir: resolvedOutputDir,
    script,
  };
}

function narrationAdapter(produceNarration) {
  return {
    async materialize(context) {
      const base = validateAdapterContext(context, {
        scriptRequired: true,
      });
      const output = await produceNarration({
        run_id: base.runId,
        generated_at: base.generatedAt,
        text: context.script.text,
        script_path: base.script.path,
        script_sha256: base.script.sha256,
        output_dir: base.outputDir,
        work_order: context.workOrder,
      });
      const observed = observeFile(
        output,
        "narration_audio",
        base.outputDir,
      );
      const provider = text(output?.provider).toLowerCase();
      const voiceId = text(output?.voice_id);
      const modelId = text(output?.model_id);
      const blockers = [];
      if (provider !== "elevenlabs") {
        blockers.push("narration_elevenlabs_provider_required");
      }
      if (!voiceId) blockers.push("narration_voice_id_required");
      if (!modelId) blockers.push("narration_model_id_required");
      if (blockers.length) {
        throw new WeeklyLongformProductionAdapterError(blockers);
      }
      return {
        path: observed.path,
        sha256: observed.sha256,
        byte_length: observed.byte_length,
        provider,
        voice_id: voiceId,
        model_id: modelId,
        network_used: output?.network_used === true,
      };
    },
  };
}

function alignmentAdapter(materializeAlignment) {
  return {
    async materialize(context) {
      const base = validateAdapterContext(context, {
        scriptRequired: true,
      });
      const runRoot = runRootFromOutputDir(base.outputDir);
      const narration = observeFile(
        context?.narration,
        "alignment_narration_audio",
        runRoot,
      );
      const output = await materializeAlignment({
        run_id: base.runId,
        generated_at: base.generatedAt,
        script_text: context.script.text,
        script_path: base.script.path,
        script_sha256: base.script.sha256,
        audio_path: narration.path,
        audio_sha256: narration.sha256,
        output_dir: base.outputDir,
        work_order: context.workOrder,
      });
      const observed = observeJson(
        output,
        "word_alignment",
        base.outputDir,
      );
      const value = observed.value;
      const blockers = [];
      if (value?.schema_version !== "pulse-word-timestamps-v1") {
        blockers.push("word_alignment_schema_invalid");
      }
      if (text(value?.run_id) !== base.runId) {
        blockers.push("word_alignment_run_id_mismatch");
      }
      if (
        normaliseSha256(value?.script_sha256) !==
        normaliseSha256(context.script.sha256)
      ) {
        blockers.push("word_alignment_script_sha256_mismatch");
      }
      if (normaliseSha256(value?.audio_sha256) !== narration.sha256) {
        blockers.push("word_alignment_audio_sha256_mismatch");
      }
      if (!normaliseSha256(value?.source_alignment_sha256)) {
        blockers.push("word_alignment_source_sha256_required");
      }
      const provider = text(value?.provider).toLowerCase();
      const timingBasis = text(value?.timing_basis).toLowerCase();
      if (
        !REAL_ALIGNMENT_PROVIDERS.has(provider) ||
        !REAL_TIMING_BASES.has(timingBasis)
      ) {
        blockers.push("real_word_alignment_provider_required");
      }
      const words = Array.isArray(value?.words) ? value.words : [];
      if (!words.length) blockers.push("word_alignment_words_required");
      let previousEnd = 0;
      const normalisedWords = [];
      for (const [index, word] of words.entries()) {
        const wordText = text(word?.text);
        const start = Number(word?.start_seconds);
        const end = Number(word?.end_seconds);
        if (
          !wordText ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end <= start ||
          (index > 0 && start < previousEnd)
        ) {
          blockers.push("word_alignment_timing_invalid");
          break;
        }
        normalisedWords.push(wordText);
        previousEnd = end;
      }
      if (
        Number(value?.word_count) !== words.length ||
        normalisedWords.length !== words.length
      ) {
        blockers.push("word_alignment_word_count_mismatch");
      }
      const alignedText = normalisedWords.join(" ").replace(/\s+/g, " ").trim();
      const scriptText = text(context.script.text)
        .replace(/\s+/g, " ")
        .trim();
      if (alignedText !== scriptText) {
        blockers.push("word_alignment_exact_script_mismatch");
      }
      if (blockers.length) {
        throw new WeeklyLongformProductionAdapterError(blockers);
      }
      return {
        path: observed.path,
        sha256: observed.sha256,
        byte_length: observed.byte_length,
        provider,
        timing_basis:
          timingBasis || "provider_word_alignment",
        network_used: output?.network_used === true,
      };
    },
  };
}

function renderAdapter(renderLongform) {
  return {
    async materialize(context) {
      const base = validateAdapterContext(context, {
        scriptRequired: true,
      });
      const runRoot = runRootFromOutputDir(base.outputDir);
      const narration = observeFile(
        context?.narration,
        "render_narration_audio",
        runRoot,
      );
      const alignment = observeJson(
        context?.alignment,
        "render_word_alignment",
        runRoot,
      );
      const output = await renderLongform({
        run_id: base.runId,
        generated_at: base.generatedAt,
        script_text: context.script.text,
        script_path: base.script.path,
        script_sha256: base.script.sha256,
        audio_path: narration.path,
        audio_sha256: narration.sha256,
        alignment_path: alignment.path,
        alignment_sha256: alignment.sha256,
        alignment: alignment.value,
        visual_beat_plan: context.workOrder?.visual_beat_plan,
        derivative_plan: context.workOrder?.derivative_plan,
        output_dir: base.outputDir,
        work_order: context.workOrder,
      });
      const master = observeFile(
        output?.master,
        "render_master",
        base.outputDir,
      );
      const rights = observeJson(
        output?.rights,
        "render_rights_ledger",
        base.outputDir,
      );
      const rendererManifest = output?.renderer_manifest
        ? observeJson(
            output.renderer_manifest,
            "render_native_renderer_manifest",
            base.outputDir,
          )
        : null;
      const originalityTransformation =
        output?.originality_transformation
          ? observeJson(
              output.originality_transformation,
              "render_originality_transformation",
              base.outputDir,
            )
          : null;
      const renderer = text(output?.renderer).toLowerCase();
      const ledger = rights.value;
      const blockers = [];
      if (
        !renderer ||
        (!renderer.includes("hyperframes") &&
          !renderer.includes("ffmpeg"))
      ) {
        blockers.push("hyperframes_or_ffmpeg_renderer_required");
      }
      if (ledger?.schema_version !== "pulse-longform-rights-ledger-v1") {
        blockers.push("render_rights_ledger_schema_invalid");
      }
      if (text(ledger?.run_id) !== base.runId) {
        blockers.push("render_rights_ledger_run_id_mismatch");
      }
      if (normaliseSha256(ledger?.master_sha256) !== master.sha256) {
        blockers.push("render_rights_ledger_master_sha256_mismatch");
      }
      const rightsAssessment = assessRightsLedger(
        ledger,
        ledger?.ledger_sha256,
      );
      blockers.push(...rightsAssessment.blockers);
      if (blockers.length) {
        throw new WeeklyLongformProductionAdapterError(blockers);
      }
      return {
        master: {
          path: master.path,
          sha256: master.sha256,
          byte_length: master.byte_length,
        },
        rights: {
          path: rights.path,
          sha256: rights.sha256,
          byte_length: rights.byte_length,
        },
        renderer,
        renderer_manifest: rendererManifest
          ? {
              path: rendererManifest.path,
              sha256: rendererManifest.sha256,
              byte_length: rendererManifest.byte_length,
            }
          : null,
        originality_transformation:
          originalityTransformation
            ? {
                path: originalityTransformation.path,
                sha256: originalityTransformation.sha256,
                byte_length:
                  originalityTransformation.byte_length,
              }
            : null,
        rights_decision: rightsAssessment.decision.decision,
        rights_ledger_sha256: rightsAssessment.sha256,
        network_used: output?.network_used === true,
      };
    },
  };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function variantsAdapter(materializeVariants) {
  return {
    async materialize(context) {
      const base = validateAdapterContext(context);
      const runRoot = runRootFromOutputDir(base.outputDir);
      const master = observeFile(
        context?.master,
        "variants_master",
        runRoot,
      );
      const output = await materializeVariants({
        run_id: base.runId,
        generated_at: base.generatedAt,
        master_path: master.path,
        master_sha256: master.sha256,
        derivative_plan: context.workOrder?.derivative_plan,
        output_dir: base.outputDir,
        work_order: context.workOrder,
        renderer_manifest:
          context.renderer_manifest || null,
      });
      const manifest = observeJson(
        output,
        "platform_variants",
        base.outputDir,
      );
      const value = manifest.value;
      const blockers = [];
      if (
        value?.schema_version !==
        "pulse-longform-platform-variants-v1"
      ) {
        blockers.push("platform_variants_schema_invalid");
      }
      if (text(value?.run_id) !== base.runId) {
        blockers.push("platform_variants_run_id_mismatch");
      }
      if (normaliseSha256(value?.master_sha256) !== master.sha256) {
        blockers.push("platform_variants_master_sha256_mismatch");
      }
      const variants = Array.isArray(value?.variants) ? value.variants : [];
      if (!variants.length) {
        blockers.push("platform_variants_items_required");
      }
      const seenIds = new Set();
      for (const variant of variants) {
        const id = text(variant?.id);
        if (!id) {
          blockers.push("platform_variant_id_required");
        } else if (seenIds.has(id)) {
          blockers.push("platform_variant_id_duplicate");
        } else {
          seenIds.add(id);
        }
        if (!text(variant?.platform)) {
          blockers.push("platform_variant_platform_required");
        }
        try {
          observeFile(variant, "platform_variant", runRoot);
        } catch (error) {
          if (error instanceof WeeklyLongformProductionAdapterError) {
            blockers.push(...error.codes);
          } else {
            throw error;
          }
        }
        if (
          !positiveNumber(variant?.width) ||
          !positiveNumber(variant?.height)
        ) {
          blockers.push("platform_variant_geometry_required");
        }
        if (!positiveNumber(variant?.duration_seconds)) {
          blockers.push("platform_variant_duration_required");
        }
        if (
          !text(variant?.container) ||
          !text(variant?.video_codec) ||
          !text(variant?.audio_codec)
        ) {
          blockers.push("platform_variant_codec_metadata_required");
        }
      }
      if (blockers.length) {
        throw new WeeklyLongformProductionAdapterError(blockers);
      }
      return {
        path: manifest.path,
        sha256: manifest.sha256,
        byte_length: manifest.byte_length,
        variant_count: variants.length,
        network_used: output?.network_used === true,
      };
    },
  };
}

function decodedQaAdapter(runDecodedQa) {
  return {
    async materialize(context) {
      const base = validateAdapterContext(context);
      const runRoot = runRootFromOutputDir(base.outputDir);
      const master = observeFile(
        context?.master,
        "decoded_qa_master",
        runRoot,
      );
      const alignment = observeJson(
        context?.alignment,
        "decoded_qa_alignment",
        runRoot,
      );
      const variants = observeJson(
        context?.variants,
        "decoded_qa_variants",
        runRoot,
      );
      const output = await runDecodedQa({
        run_id: base.runId,
        generated_at: base.generatedAt,
        master_path: master.path,
        master_sha256: master.sha256,
        alignment_path: alignment.path,
        alignment_sha256: alignment.sha256,
        variants_path: variants.path,
        variants_sha256: variants.sha256,
        output_dir: base.outputDir,
        work_order: context.workOrder,
        renderer_manifest: context.renderer_manifest || null,
      });
      const report = observeJson(
        output,
        "decoded_qa",
        base.outputDir,
      );
      const value = report.value;
      const nativeRendererQa = output?.native_renderer_qa
        ? observeJson(
            output.native_renderer_qa,
            "native_renderer_qa",
            base.outputDir,
          )
        : null;
      const blockers = [];
      if (value?.schema_version !== "pulse-decoded-qa-v1") {
        blockers.push("decoded_qa_schema_invalid");
      }
      if (text(value?.run_id) !== base.runId) {
        blockers.push("decoded_qa_run_id_mismatch");
      }
      if (normaliseSha256(value?.master_sha256) !== master.sha256) {
        blockers.push("decoded_qa_master_sha256_mismatch");
      }
      const decoder = text(value?.decoder).toLowerCase();
      if (
        !decoder ||
        (!decoder.includes("ffmpeg") && !decoder.includes("ffprobe"))
      ) {
        blockers.push("decoded_qa_real_decoder_required");
      }
      if (value?.complete !== true) blockers.push("decoded_qa_incomplete");
      if (text(value?.verdict).toUpperCase() !== "PASS") {
        blockers.push("decoded_qa_verdict_not_pass");
      }
      const media = value?.decoded_media || {};
      if (
        !positiveNumber(media.width) ||
        !positiveNumber(media.height) ||
        !positiveNumber(media.duration_seconds) ||
        !text(media.container) ||
        !text(media.video_codec) ||
        !text(media.audio_codec)
      ) {
        blockers.push("decoded_qa_media_metadata_incomplete");
      }
      for (const check of REQUIRED_DECODED_QA_CHECKS) {
        if (value?.checks?.[check]?.pass !== true) {
          blockers.push(`decoded_qa_check_failed_${check}`);
        }
      }
      if (blockers.length) {
        throw new WeeklyLongformProductionAdapterError(blockers);
      }
      return {
        path: report.path,
        sha256: report.sha256,
        byte_length: report.byte_length,
        decoder,
        check_count: REQUIRED_DECODED_QA_CHECKS.length,
        native_renderer_qa: nativeRendererQa
          ? {
              path: nativeRendererQa.path,
              sha256: nativeRendererQa.sha256,
              byte_length: nativeRendererQa.byte_length,
            }
          : null,
        network_used: output?.network_used === true,
      };
    },
  };
}

function createWeeklyLongformProductionAdapters(dependencies = {}) {
  const adapters = {};
  const capabilities = {};
  const blockers = [];

  for (const definition of CAPABILITY_DEFINITIONS) {
    const available =
      typeof dependencies?.[definition.dependency] === "function";
    capabilities[definition.adapter] = {
      available,
      dependency: definition.dependency,
      blocker: available ? null : definition.blocker,
    };
    if (!available) blockers.push(definition.blocker);
    if (available && definition.adapter === "narration") {
      adapters.narration = narrationAdapter(
        dependencies.produceNarration,
      );
    }
    if (available && definition.adapter === "alignment") {
      adapters.alignment = alignmentAdapter(
        dependencies.materializeAlignment,
      );
    }
    if (available && definition.adapter === "render") {
      adapters.render = renderAdapter(dependencies.renderLongform);
    }
    if (available && definition.adapter === "variants") {
      adapters.variants = variantsAdapter(
        dependencies.materializeVariants,
      );
    }
    if (available && definition.adapter === "decodedQa") {
      adapters.decodedQa = decodedQaAdapter(
        dependencies.runDecodedQa,
      );
    }
  }

  return {
    capabilities: {
      schema_version: CAPABILITIES_SCHEMA,
      ready: blockers.length === 0,
      blockers,
      adapters: capabilities,
      safety: {
        implicit_network_enabled: false,
        implicit_process_spawn_enabled: false,
        upload_authority: false,
        oauth_mutation_authority: false,
        database_mutation_authority: false,
      },
    },
    adapters,
  };
}

module.exports = {
  CAPABILITIES_SCHEMA,
  WeeklyLongformProductionAdapterError,
  createWeeklyLongformProductionAdapters,
};
