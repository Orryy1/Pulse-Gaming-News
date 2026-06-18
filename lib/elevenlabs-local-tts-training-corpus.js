"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "elevenlabs_local_tts_training_corpus";
const PROVIDER_ID = "elevenlabs_tts";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

function safeId(value, fallback = "sample") {
  const text = cleanText(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return text || fallback;
}

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values = []) {
  return [...new Set(asArray(values).map(cleanText).filter(Boolean))];
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolvePath({ workspaceRoot, baseDir, value }) {
  const text = cleanText(value);
  if (!text) return null;
  if (path.isAbsolute(text)) return path.resolve(text);
  const fromBase = path.resolve(baseDir || workspaceRoot, text);
  if (fs.existsSync(fromBase)) return fromBase;
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function scanAudioManifests(root, { maxDepth = 9 } = {}) {
  const files = [];
  if (!root || !(await fs.pathExists(root))) return files;
  const stack = [{ dir: path.resolve(root), depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) continue;
    let entries = [];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) stack.push({ dir: fullPath, depth: current.depth + 1 });
      else if (entry.name === "audio_manifest.json") files.push(fullPath);
    }
  }
  return files.sort((a, b) => normalisePath(a).localeCompare(normalisePath(b)));
}

function timestampWords(timestampPayload = {}) {
  if (Array.isArray(timestampPayload.words)) return timestampPayload.words;
  if (Array.isArray(timestampPayload.alignment?.words)) return timestampPayload.alignment.words;
  return [];
}

function timestampDurationS(words = [], timestampPayload = {}) {
  const explicit = numberOrNull(
    timestampPayload.duration_s ||
      timestampPayload.meta?.acoustic?.durationSeconds ||
      timestampPayload.meta?.voiceDiagnostics?.metrics?.duration_s,
  );
  if (explicit && explicit > 0) return explicit;
  const last = asArray(words)
    .map((word) => numberOrNull(word.end ?? word.end_s ?? word.endTime))
    .filter((number) => number !== null)
    .sort((a, b) => b - a)[0];
  return Number.isFinite(last) && last > 0 ? last : null;
}

function providerLooksElevenLabs({ audioManifest = {}, narrationManifest = {}, timestampPayload = {} } = {}) {
  const raw = [
    audioManifest.voice_provider,
    audioManifest.provider,
    narrationManifest.provider,
    narrationManifest.voice_provider,
    timestampPayload.meta?.provider,
    audioManifest.safety?.external_tts_provider_used,
  ]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean);
  if (raw.some((value) => value.includes("local"))) return false;
  if (raw.some((value) => value.includes("elevenlabs"))) return true;
  return false;
}

function corpusSplit(index, { evalEvery = 5 } = {}) {
  const every = Number.isInteger(Number(evalEvery)) && Number(evalEvery) > 1 ? Number(evalEvery) : 5;
  return (index + 1) % every === 0 ? "eval" : "train";
}

function transcriptFrom({
  audioManifest = {},
  narrationManifest = {},
  timestampPayload = {},
} = {}) {
  return cleanText(
    narrationManifest.final_transcript ||
      narrationManifest.transcript ||
      narrationManifest.display_text ||
      timestampPayload.meta?.transcript ||
      timestampPayload.meta?.text ||
      audioManifest.transcript ||
      audioManifest.final_transcript,
  );
}

function displayTextFrom({
  narrationManifest = {},
  timestampPayload = {},
  transcript = "",
} = {}) {
  return cleanText(
    narrationManifest.display_text ||
      narrationManifest.displayText ||
      timestampPayload.meta?.display_text ||
      transcript,
  );
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function isPlatformVariantPath(filePath) {
  return normalisePath(filePath).includes("/platform_variants/");
}

function repeatedSentenceCount(text) {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence).toLowerCase())
    .filter((sentence) => sentence.length >= 18);
  if (sentences.length < 4) return 0;
  const seen = new Set();
  let repeated = 0;
  for (const sentence of sentences) {
    if (seen.has(sentence)) repeated += 1;
    else seen.add(sentence);
  }
  return repeated;
}

async function inspectAudioManifest(
  manifestPath,
  {
    workspaceRoot = process.cwd(),
    operatorTrainingPermission = false,
    minWords = 20,
    includePlatformVariants = false,
    generatedAt = new Date().toISOString(),
  } = {},
) {
  const resolvedManifestPath = path.resolve(workspaceRoot, manifestPath);
  const artifactDir = path.dirname(resolvedManifestPath);
  const audioManifest = await readJsonIfPresent(resolvedManifestPath, null);
  if (!audioManifest || typeof audioManifest !== "object" || Array.isArray(audioManifest)) {
    return {
      manifest_path: resolvedManifestPath,
      status: "blocked",
      blockers: ["elevenlabs_tts_corpus:audio_manifest_unreadable"],
    };
  }

  const narrationManifestPath = path.join(artifactDir, "narration_manifest.json");
  const narrationManifest = await readJsonIfPresent(narrationManifestPath, {});
  const audioPath = resolvePath({
    workspaceRoot,
    baseDir: artifactDir,
    value: audioManifest.resolved_narration_audio_path ||
      narrationManifest.resolved_audio_path ||
      audioManifest.narration_audio_path ||
      narrationManifest.audio_path,
  });
  const timestampPath = resolvePath({
    workspaceRoot,
    baseDir: artifactDir,
    value: audioManifest.resolved_word_timestamps_path ||
      narrationManifest.resolved_word_timestamps_path ||
      audioManifest.word_timestamps_path ||
      narrationManifest.word_timestamps_path,
  });
  const timestampPayload = await readJsonIfPresent(timestampPath, {});
  const words = timestampWords(timestampPayload);
  const transcript = transcriptFrom({ audioManifest, narrationManifest, timestampPayload });
  const displayText = displayTextFrom({ narrationManifest, timestampPayload, transcript });
  const blockers = [];
  const add = (blocker) => {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };

  if (!operatorTrainingPermission) add("elevenlabs_tts_corpus:operator_training_permission_missing");
  if (!includePlatformVariants && isPlatformVariantPath(resolvedManifestPath)) {
    add("elevenlabs_tts_corpus:platform_variant_excluded");
  }
  if (!providerLooksElevenLabs({ audioManifest, narrationManifest, timestampPayload })) {
    add("elevenlabs_tts_corpus:not_elevenlabs_provider");
  }
  if (!audioPath) add("elevenlabs_tts_corpus:audio_path_missing");
  else if (!(await fs.pathExists(audioPath))) add("elevenlabs_tts_corpus:audio_file_missing");
  if (!timestampPath) add("elevenlabs_tts_corpus:timestamp_path_missing");
  else if (!(await fs.pathExists(timestampPath))) add("elevenlabs_tts_corpus:timestamp_file_missing");
  if (!words.length) add("elevenlabs_tts_corpus:word_timestamps_missing");
  if (!transcript) add("elevenlabs_tts_corpus:transcript_missing");
  if (wordCount(transcript) < Number(minWords || 0)) add("elevenlabs_tts_corpus:transcript_too_short");
  if (repeatedSentenceCount(transcript) > 0) add("elevenlabs_tts_corpus:transcript_repetition_detected");

  let sha256 = null;
  let bytes = null;
  if (audioPath && (await fs.pathExists(audioPath))) {
    sha256 = await sha256File(audioPath);
    const stat = await fs.stat(audioPath);
    bytes = stat.size;
  }
  const durationS = timestampDurationS(words, timestampPayload);
  if (!durationS) add("elevenlabs_tts_corpus:duration_missing");

  const status = blockers.length ? "blocked" : "accepted";
  const storyId = safeId(audioManifest.story_id || narrationManifest.story_id || path.basename(artifactDir));
  return {
    sample_id: `${storyId}_${sha256 ? sha256.slice(0, 12) : "unhashed"}`,
    story_id: storyId,
    title: cleanText(audioManifest.title || narrationManifest.title),
    provider: "elevenlabs",
    voice_id: cleanText(timestampPayload.meta?.elevenlabs?.voiceId || audioManifest.voice_id || narrationManifest.voice_id) || null,
    model_id: cleanText(timestampPayload.meta?.elevenlabs?.modelId || audioManifest.model_id || narrationManifest.model_id) || null,
    speaking_rate: numberOrNull(timestampPayload.meta?.elevenlabs?.speakingRate),
    transcript,
    display_text: displayText,
    spoken_text: cleanText(timestampPayload.meta?.text || timestampPayload.meta?.transcript || transcript),
    word_count: wordCount(transcript),
    timestamp_word_count: words.length,
    duration_s: durationS ? Number(durationS.toFixed(3)) : null,
    sha256,
    bytes,
    manifest_path: resolvedManifestPath,
    narration_manifest_path: (await fs.pathExists(narrationManifestPath)) ? narrationManifestPath : null,
    audio_path: audioPath,
    timestamp_path: timestampPath,
    word_timestamp_source: cleanText(audioManifest.word_timestamp_source || narrationManifest.word_timestamp_source || timestampPayload.meta?.wordTimestampSource) || null,
    generated_at: generatedAt,
    status,
    blockers,
    training_permission: {
      operator_confirmed: operatorTrainingPermission === true,
      permission_basis: operatorTrainingPermission
        ? "operator_confirmed_permission_to_train_local_model_on_elevenlabs_outputs"
        : null,
    },
  };
}

function blockerCounts(samples = [], extraBlockers = []) {
  const counts = {};
  for (const sample of asArray(samples)) {
    for (const blocker of asArray(sample.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  for (const blocker of asArray(extraBlockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  return counts;
}

function buildTrainingWorkOrder(report = {}, { trainerCommand = "" } = {}) {
  const corpusReady = Number(report.summary?.accepted_sample_count || 0) > 0;
  const configuredTrainer = cleanText(trainerCommand || process.env.LOCAL_TTS_TRAINER_COMMAND);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    status: !corpusReady
      ? "blocked_no_corpus"
      : configuredTrainer
        ? "ready_for_operator_trainer_run"
        : "blocked_no_trainer_configured",
    corpus_ready: corpusReady,
    accepted_sample_count: Number(report.summary?.accepted_sample_count || 0),
    train_sample_count: Number(report.summary?.train_sample_count || 0),
    eval_sample_count: Number(report.summary?.eval_sample_count || 0),
    trainer_command: configuredTrainer || null,
    trainer_command_not_run: true,
    intended_output_dir: "tts_server/training/elevenlabs-liam-consented-local-model",
    blocked_reason: corpusReady && !configuredTrainer
      ? "No LOCAL_TTS_TRAINER_COMMAND is configured for a governed local model training run."
      : !corpusReady
        ? "No accepted consented ElevenLabs samples are available."
        : null,
    next_action: corpusReady && !configuredTrainer
      ? "Configure a repo-approved local trainer target, then run this work order under LOCAL_PROOF with no external uploads."
      : corpusReady
        ? "Run the configured trainer only after confirming it writes local weights and does not upload audio or model files."
        : "Generate or retain consented ElevenLabs narration samples first.",
    safety: {
      local_training_only: true,
      no_external_uploads: true,
      no_api_call: true,
      no_secret_or_token_read: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
      raw_elevenlabs_audio_redistribution_allowed: false,
    },
  };
}

function buildRightsLedger(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    records: asArray(report.samples).map((sample) => ({
      asset_id: sample.sample_id,
      story_id: sample.story_id,
      provider_id: PROVIDER_ID,
      source_type: "elevenlabs_tts_voice_output",
      source_url: sample.story_id ? `elevenlabs://pulse-gaming/${sample.story_id}` : "elevenlabs://pulse-gaming/sample",
      audio_path: sample.audio_path,
      timestamp_path: sample.timestamp_path,
      sha256: sample.sha256,
      voice_id: sample.voice_id,
      model_id: sample.model_id,
      rights_basis: "operator_authorised_elevenlabs_output_for_local_tts_training",
      permission_basis: sample.training_permission?.permission_basis || null,
      allowed_use: "local_pulse_tts_training_and_evaluation",
      commercial_use_allowed: true,
      raw_redistribution_allowed: false,
      model_redistribution_allowed: false,
      status: "rights_recorded",
    })),
  };
}

function buildCorpusRows(samples = []) {
  return asArray(samples).map((sample, index) => ({
    sample_id: sample.sample_id,
    story_id: sample.story_id,
    split: sample.split || corpusSplit(index),
    transcript: sample.transcript,
    spoken_text: sample.spoken_text,
    display_text: sample.display_text,
    audio_path: sample.audio_path,
    timestamp_path: sample.timestamp_path,
    duration_s: sample.duration_s,
    word_count: sample.word_count,
    timestamp_word_count: sample.timestamp_word_count,
    sha256: sample.sha256,
    provider: sample.provider,
    voice_id: sample.voice_id,
    model_id: sample.model_id,
    speaking_rate: sample.speaking_rate,
    rights_basis: "operator_authorised_elevenlabs_output_for_local_tts_training",
  }));
}

async function buildElevenLabsLocalTtsTrainingCorpus({
  workspaceRoot = process.cwd(),
  roots = [path.join(workspaceRoot, "output")],
  manifestPaths = [],
  operatorTrainingPermission = truthy(process.env.ELEVENLABS_TTS_TRAINING_PERMISSION),
  generatedAt = new Date().toISOString(),
  minAcceptedSamples = 10,
  minWords = 20,
  evalEvery = 5,
  trainerCommand = "",
  includePlatformVariants = false,
} = {}) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const explicit = asArray(manifestPaths).map((filePath) => path.resolve(resolvedWorkspace, filePath));
  const scanned = explicit.length
    ? []
    : (await Promise.all(asArray(roots).map((root) => scanAudioManifests(path.resolve(resolvedWorkspace, root))))).flat();
  const allManifestPaths = unique([...explicit, ...scanned]);
  const inspected = [];
  for (const manifestPath of allManifestPaths) {
    inspected.push(await inspectAudioManifest(manifestPath, {
      workspaceRoot: resolvedWorkspace,
      operatorTrainingPermission: operatorTrainingPermission === true,
      minWords,
      includePlatformVariants,
      generatedAt,
    }));
  }
  const accepted = inspected.filter((sample) => sample.status === "accepted");
  const blockedSamples = inspected.filter((sample) => sample.status !== "accepted");
  const samples = accepted.map((sample, index) => ({
    ...sample,
    split: corpusSplit(index, { evalEvery }),
  }));
  const extraBlockers = [];
  if (accepted.length < Number(minAcceptedSamples || 0)) {
    extraBlockers.push("elevenlabs_tts_corpus:accepted_samples_below_target");
  }
  if (!allManifestPaths.length) extraBlockers.push("elevenlabs_tts_corpus:no_audio_manifests_found");
  const counts = blockerCounts(blockedSamples, extraBlockers);
  const verdict = accepted.length >= Number(minAcceptedSamples || 0)
    ? "PASS"
    : accepted.length > 0
      ? "PARTIAL"
      : "BLOCKED";
  const corpusRows = buildCorpusRows(samples);
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_CORPUS_BUILD",
    verdict,
    provider_id: PROVIDER_ID,
    permission: {
      operator_training_permission: operatorTrainingPermission === true,
      permission_basis: operatorTrainingPermission
        ? "operator_confirmed_permission_to_train_local_model_on_elevenlabs_outputs"
        : null,
    },
    summary: {
      manifest_count: allManifestPaths.length,
      inspected_sample_count: inspected.length,
      accepted_sample_count: samples.length,
      blocked_sample_count: blockedSamples.length,
      train_sample_count: corpusRows.filter((row) => row.split === "train").length,
      eval_sample_count: corpusRows.filter((row) => row.split === "eval").length,
      total_duration_s: Number(samples.reduce((sum, sample) => sum + Number(sample.duration_s || 0), 0).toFixed(3)),
      total_word_count: samples.reduce((sum, sample) => sum + Number(sample.word_count || 0), 0),
      min_accepted_samples: Number(minAcceptedSamples || 0),
    },
    blocker_counts: counts,
    samples,
    blocked_samples: blockedSamples,
    corpus_rows: corpusRows,
    safety: {
      local_proof_only: true,
      no_external_uploads: true,
      no_api_call: true,
      no_secret_or_token_read: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
      trainer_not_run: true,
      raw_elevenlabs_audio_redistribution_allowed: false,
    },
  };
  report.training_work_order = buildTrainingWorkOrder(report, { trainerCommand });
  report.rights_ledger = buildRightsLedger(report);
  return report;
}

function renderElevenLabsLocalTtsTrainingCorpusMarkdown(report = {}) {
  const lines = [];
  lines.push("# ElevenLabs Local TTS Training Corpus");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Manifests inspected: ${Number(report.summary?.manifest_count || 0)}`);
  lines.push(`Accepted samples: ${Number(report.summary?.accepted_sample_count || 0)}`);
  lines.push(`Blocked samples: ${Number(report.summary?.blocked_sample_count || 0)}`);
  lines.push(`Train/eval: ${Number(report.summary?.train_sample_count || 0)} / ${Number(report.summary?.eval_sample_count || 0)}`);
  lines.push(`Duration: ${Number(report.summary?.total_duration_s || 0).toFixed(3)}s`);
  lines.push("");
  lines.push("## Training Work Order");
  lines.push(`- status: ${report.training_work_order?.status || "unknown"}`);
  lines.push(`- next: ${report.training_work_order?.next_action || "none"}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("Safety: local corpus proof only. No ElevenLabs call, external upload, database mutation, OAuth/token change or platform post was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeElevenLabsLocalTtsTrainingCorpus(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeElevenLabsLocalTtsTrainingCorpus requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportJson = path.join(outDir, "elevenlabs_local_tts_training_corpus_report.json");
  const reportMarkdown = path.join(outDir, "elevenlabs_local_tts_training_corpus_report.md");
  const corpusJson = path.join(outDir, "elevenlabs_local_tts_training_corpus.json");
  const corpusJsonl = path.join(outDir, "elevenlabs_local_tts_training_corpus.jsonl");
  const trainingWorkOrder = path.join(outDir, "elevenlabs_local_tts_training_work_order.json");
  const rightsLedger = path.join(outDir, "elevenlabs_local_tts_training_rights_ledger.json");
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(reportMarkdown, renderElevenLabsLocalTtsTrainingCorpusMarkdown(report), "utf8");
  await fs.writeJson(corpusJson, report.corpus_rows || [], { spaces: 2 });
  await fs.writeFile(
    corpusJsonl,
    asArray(report.corpus_rows).map((row) => JSON.stringify(row)).join("\n") +
      (asArray(report.corpus_rows).length ? "\n" : ""),
    "utf8",
  );
  await fs.writeJson(trainingWorkOrder, report.training_work_order || buildTrainingWorkOrder(report), { spaces: 2 });
  await fs.writeJson(rightsLedger, report.rights_ledger || buildRightsLedger(report), { spaces: 2 });
  return {
    reportJson,
    reportMarkdown,
    corpusJson,
    corpusJsonl,
    trainingWorkOrder,
    rightsLedger,
  };
}

module.exports = {
  GOAL_ID,
  PROVIDER_ID,
  buildElevenLabsLocalTtsTrainingCorpus,
  buildTrainingWorkOrder,
  inspectAudioManifest,
  renderElevenLabsLocalTtsTrainingCorpusMarkdown,
  scanAudioManifests,
  writeElevenLabsLocalTtsTrainingCorpus,
};
