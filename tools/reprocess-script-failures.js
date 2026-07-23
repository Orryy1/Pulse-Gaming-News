#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const processStories = require("../processor");
const db = require("../lib/db");
const { fallbackTitleVariants } = require("../ab_titles");
const { runScriptCoherenceQa } = require("../lib/script-coherence-qa");
const { lintScript } = require("../lib/services/script-lint");
const {
  classifyShortScriptRuntime,
  secondsPerWordForTtsProvider,
} = require("../lib/services/short-runtime-planner");
const {
  buildSourceBoundFallbackScript,
  sourceNameFromUrl,
} = require("../lib/source-bound-script-writer");
const {
  buildViralScriptIntelligence,
} = require("../lib/viral-script-intelligence");
const {
  buildScriptFailureReprocessReport,
  formatScriptFailureReprocessMarkdown,
  isAdvertiserSafeRepairCandidate,
  isReprocessableScriptFailureStory,
  selectReprocessableScriptFailureStories,
  storyHasPlatformPost,
} = require("../lib/ops/script-failure-reprocess");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_REPROCESS_LLM_TIMEOUT_MS = 30_000;
const DEFAULT_REPROCESS_MAX_ATTEMPTS = 1;
const DEFAULT_SOURCE_BOUND_LOCAL_SECONDS_PER_WORD = 0.35;

function backupFileName(now = new Date()) {
  return `pulse-pre-script-failure-reprocess-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    applyLocal: false,
    json: false,
    limit: 10,
    llmTimeoutMs: DEFAULT_REPROCESS_LLM_TIMEOUT_MS,
    llmProvider: "",
    maxAttempts: DEFAULT_REPROCESS_MAX_ATTEMPTS,
    skipEditor: true,
    sourceBoundOnly: false,
    forceStory: false,
    storyIds: [],
    outDir: OUT,
    queue: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--dry-run") args.applyLocal = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a story id`);
      }
      args.storyIds.push(value);
    } else if (arg.startsWith("--story=")) {
      args.storyIds.push(arg.slice("--story=".length));
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isFinite(value) && value > 0) args.limit = value;
    } else if (arg === "--llm-timeout-ms") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.llmTimeoutMs = Math.floor(value);
    } else if (arg.startsWith("--llm-timeout-ms=")) {
      const value = Number(arg.slice("--llm-timeout-ms=".length));
      if (Number.isFinite(value) && value > 0) args.llmTimeoutMs = Math.floor(value);
    } else if (arg === "--llm-provider") {
      const value = String(argv[++i] || "").trim().toLowerCase();
      if (value) args.llmProvider = value;
    } else if (arg.startsWith("--llm-provider=")) {
      args.llmProvider = String(arg.slice("--llm-provider=".length) || "")
        .trim()
        .toLowerCase();
    } else if (arg === "--max-attempts") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) args.maxAttempts = Math.floor(value);
    } else if (arg.startsWith("--max-attempts=")) {
      const value = Number(arg.slice("--max-attempts=".length));
      if (Number.isFinite(value) && value > 0) args.maxAttempts = Math.floor(value);
    } else if (arg === "--editor") {
      args.skipEditor = false;
    } else if (arg === "--skip-editor") {
      args.skipEditor = true;
    } else if (arg === "--source-bound-only") {
      args.sourceBoundOnly = true;
    } else if (arg === "--force-story") {
      args.forceStory = true;
    } else if (arg === "--out-dir") {
      const value = String(argv[++i] || "").trim();
      if (value) args.outDir = path.resolve(value);
    } else if (arg.startsWith("--out-dir=")) {
      const value = String(arg.slice("--out-dir=".length) || "").trim();
      if (value) args.outDir = path.resolve(value);
    } else if (arg === "--queue") {
      const value = String(argv[++i] || "").trim();
      if (value) args.queue = path.resolve(value);
    } else if (arg.startsWith("--queue=")) {
      const value = String(arg.slice("--queue=".length) || "").trim();
      if (value) args.queue = path.resolve(value);
    } else if (arg === "--help" || arg === "-?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/reprocess-script-failures.js [--limit N] [--story ID] [--llm-provider local|anthropic] [--llm-timeout-ms N] [--max-attempts N] [--editor|--skip-editor] [--apply-local] [--json]\n" +
      "  Default is dry-run: generates scripts and reports, but does not write DB rows.\n" +
      "  --force-story with --story ID regenerates an explicit unpublished story even if it was not already marked as a script failure.\n" +
      "  --source-bound-only skips the LLM and uses the deterministic source-bound fallback writer for suitable source-backed stories.\n" +
      "  --queue PATH hydrates forced story IDs from local repair queue package manifests when they are not in the DB.\n" +
      `  Local LLM calls are bounded by --llm-timeout-ms (default ${DEFAULT_REPROCESS_LLM_TIMEOUT_MS}ms).\n` +
      `  Repair mode uses --max-attempts ${DEFAULT_REPROCESS_MAX_ATTEMPTS} and --skip-editor by default so one bad story cannot stall the queue.\n` +
      "  --apply-local persists only selected script-review failure rows and never posts to Discord/social.\n",
  );
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

function storyIdFromManifest(manifest = {}, fallbackId = "") {
  return String(
    manifest.id ||
      manifest.story_id ||
      manifest.storyId ||
      manifest.canonical_story?.id ||
      manifest.canonical_story?.story_id ||
      fallbackId ||
      "",
  ).trim();
}

function packageDirFromQueueItem(item = {}) {
  const finalPath =
    item.media?.finalPath ||
    item.media?.final_path ||
    item.final_path ||
    item.exported_path ||
    item.render_path;
  if (!finalPath) return null;
  return path.dirname(path.resolve(finalPath));
}

function normalisePackageManifestStory(manifest = {}, item = {}) {
  const nested = manifest.story || manifest.canonical_story || {};
  const source = { ...nested, ...manifest };
  const id = storyIdFromManifest(source, item.story_id);
  if (!id) return null;
  const primarySource =
    source.primary_source ||
    source.discovery_source ||
    source.source_name ||
    source.publisher ||
    item.source ||
    item.source_name ||
    item.subreddit ||
    "";
  const primaryUrl =
    source.primary_source_url ||
    source.source_url ||
    source.article_url ||
    source.url ||
    item.article_url ||
    item.url ||
    "";
  const fullScript =
    source.full_script ||
    source.narration_script ||
    source.tts_script ||
    item.full_script ||
    item.tts_script ||
    "";
  return {
    ...item,
    ...source,
    id,
    story_id: id,
    title:
      source.title ||
      source.public_title ||
      source.selected_title ||
      source.canonical_title ||
      item.title ||
      id,
    source_type: source.source_type || item.source_type || (id.startsWith("rss_") ? "rss" : "reddit"),
    subreddit: source.subreddit || primarySource || item.subreddit || item.source || "",
    source_name: source.source_name || primarySource || item.source_name || "",
    publisher: source.publisher || primarySource || item.publisher || "",
    article_url: primaryUrl,
    source_url: source.source_url || primaryUrl,
    url: source.url || primaryUrl,
    source_published_at:
      source.source_published_at ||
      source.published_at ||
      source.timestamp ||
      item.source_published_at ||
      item.timestamp ||
      "",
    timestamp:
      source.timestamp ||
      source.source_published_at ||
      source.published_at ||
      item.timestamp ||
      item.source_published_at ||
      "",
    full_script: fullScript,
    tts_script: source.tts_script || fullScript,
    description: source.description || item.description || "",
    db_story_present: false,
    package_manifest_hydrated: true,
  };
}

async function loadForcedStoryManifestsFromLocalQueue({
  storyIds = [],
  queuePath,
  outDir = OUT,
} = {}) {
  const wanted = new Set((storyIds || []).map(String).filter(Boolean));
  if (wanted.size === 0) return [];
  const resolvedQueuePath = path.resolve(
    queuePath || path.join(outDir || OUT, "local_media_repair_queue.json"),
  );
  const queue = await readJsonIfExists(resolvedQueuePath);
  if (!queue || !Array.isArray(queue.items)) return [];
  const out = [];
  for (const item of queue.items) {
    const itemId = String(item?.story_id || item?.id || "").trim();
    if (!itemId || !wanted.has(itemId)) continue;
    const packageDir = packageDirFromQueueItem(item);
    if (!packageDir) continue;
    const manifest =
      (await readJsonIfExists(path.join(packageDir, "canonical_story_manifest.json"))) ||
      (await readJsonIfExists(path.join(packageDir, "visual_v4_render_story.json")));
    if (!manifest) continue;
    const story = normalisePackageManifestStory(manifest, item);
    if (story?.id) out.push(story);
  }
  return out;
}

async function buildStoryPoolForReprocess({ stories = [], args = {} } = {}) {
  const pool = [...(stories || [])];
  if (args.forceStory === true && Array.isArray(args.storyIds) && args.storyIds.length > 0) {
    const existing = new Set(pool.map((story) => story?.id).filter(Boolean));
    const missingStoryIds = args.storyIds.filter((id) => id && !existing.has(id));
    if (missingStoryIds.length > 0) {
      const hydrated = await loadForcedStoryManifestsFromLocalQueue({
        storyIds: missingStoryIds,
        queuePath: args.queue,
        outDir: args.outDir || OUT,
      });
      for (const story of hydrated) {
        if (!story?.id || existing.has(story.id)) continue;
        existing.add(story.id);
        pool.push(story);
      }
    }
  }
  return pool;
}

function buildReprocessExclusions({ stories = [], candidates = [], args = {} } = {}) {
  const requested = new Set((args.storyIds || []).map(String).filter(Boolean));
  if (requested.size === 0) return [];
  const candidateIds = new Set((candidates || []).map((candidate) => candidate?.id).filter(Boolean));
  const storiesById = new Map((stories || []).filter((story) => story?.id).map((story) => [story.id, story]));
  const excluded = [];
  for (const storyId of requested) {
    if (candidateIds.has(storyId)) continue;
    const story = storiesById.get(storyId);
    let reason = "not_selected";
    if (!story) reason = "missing_from_db_or_queue_package";
    else if (storyHasPlatformPost(story)) reason = "already_public_platform_post";
    else if (!isAdvertiserSafeRepairCandidate(story)) reason = "advertiser_unsafe";
    else if (args.forceStory !== true && !isReprocessableScriptFailureStory(story)) {
      reason = "not_reprocessable_script_failure";
    }
    excluded.push({
      story_id: storyId,
      title: story?.title || "",
      reason,
      db_story_present: story ? story.db_story_present !== false : false,
      package_manifest_hydrated: story?.package_manifest_hydrated === true,
    });
  }
  return excluded;
}

function sourceMaterialForFallback(story = {}) {
  return [
    story.source_title,
    story.article_title,
    story.description,
    story.source_text,
    story.top_comment,
  ]
    .filter(Boolean)
    .join("\n");
}

function prepareScriptRepairRow(row = {}) {
  const fullScript = String(row.full_script || "").trim();
  const titleVariants = fallbackTitleVariants(row, row.suggested_title || row.title);
  const allTitleVariants = [
    row.suggested_title || row.title,
    ...titleVariants,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return {
    ...row,
    ...(fullScript ? { tts_script: fullScript } : {}),
    ...(titleVariants.length >= 2
      ? { title_variants: [...new Set(allTitleVariants)] }
      : {}),
    active_title_index: 0,
    audio_path: null,
    exported_path: null,
    publish_status: null,
    publish_error: null,
    script_review_reason: "",
    script_validation_errors: [],
  };
}

function isPersistableScriptReady(row = {}, env = process.env) {
  if (!row || row.script_generation_status === "review_required") return false;
  const scriptText =
    typeof row.tts_script === "string" && row.tts_script.trim()
      ? row.tts_script
      : row.full_script;
  if (typeof scriptText !== "string" || scriptText.trim().length === 0) {
    return false;
  }
  if (Number(row.word_count || 0) <= 0) return false;

  const provider = String(env.TTS_PROVIDER || "elevenlabs").trim().toLowerCase();
  const secondsPerWord = sourceBoundPersistSecondsPerWord(row, provider, env);
  const runtime = classifyShortScriptRuntime({
    text: scriptText,
    story: row,
    secondsPerWord,
  });
  const governedBreakingMeasurement =
    runtime.result === "measurement_required" &&
    runtime.durationLane === "breaking_news" &&
    runtime.shouldGenerateShortAudio === true &&
    row.audio_duration_verification_required === true;
  if (
    (runtime.result !== "pass" && !governedBreakingMeasurement) ||
    runtime.shouldGenerateShortAudio === false
  ) {
    return false;
  }

  const lint = lintScript(scriptText, {
    minWords: runtime.minWords,
    maxWords: runtime.maxWords,
  });
  if (lint.result === "fail") return false;

  const requirePulseCta = !row.channel_id || row.channel_id === "pulse-gaming";
  const coherence = runScriptCoherenceQa(
    { ...row, full_script: scriptText },
    {
      requireCtaField: requirePulseCta,
      requireFullScriptCta: requirePulseCta,
    },
  );
  if (coherence.failures.length > 0) return false;

  const transcriptQuality = buildViralScriptIntelligence({
    story: {
      ...row,
      source_name:
        row.source_name ||
        row.primary_source ||
        sourceNameFromUrl(row.article_url || row.source_url || row.url) ||
        row.subreddit ||
        row.source,
    },
    script: scriptText,
  });
  return transcriptQuality.verdict === "viral_ready";
}

function sourceBoundPersistSecondsPerWord(row = {}, provider = "", env = process.env) {
  const isLocal = /^(local|voxcpm|voicebox)$/i.test(String(provider || ""));
  const isSourceBound = /source_bound/i.test(String(row.script_source || ""));
  if (!isLocal || !isSourceBound) return secondsPerWordForTtsProvider(provider, env);
  const override = Number(
    env.SOURCE_BOUND_SECONDS_PER_WORD ||
      env.SOURCE_BOUND_LOCAL_SECONDS_PER_WORD ||
      env.LOCAL_SCRIPT_EXTENSION_SECONDS_PER_WORD,
  );
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_SOURCE_BOUND_LOCAL_SECONDS_PER_WORD;
}

async function reprocessCandidate(candidate, args) {
  try {
    let resultRows = null;
    if (args.sourceBoundOnly) {
      const fallback = buildSourceBoundFallbackScript(candidate, {
        sourceMaterial: sourceMaterialForFallback(candidate),
      });
      if (!fallback) {
        resultRows = [
          {
            ...candidate,
            script_generation_status: "review_required",
            script_review_reason: "source_bound_fallback_unavailable",
            script_validation_errors: ["source_bound_fallback_unavailable"],
          },
        ];
      } else {
        resultRows = [
          prepareScriptRepairRow({ ...candidate, ...fallback, quality_score: 7 }),
        ];
      }
    }

    if (!resultRows) {
      const rows = await processStories({
        storiesOverride: [candidate],
        skipDedupIds: [candidate.id],
        postDiscord: false,
        persist: false,
        maxScriptAttempts: args.maxAttempts,
        skipEditorPass: args.skipEditor,
      });
      resultRows = Array.isArray(rows) && rows.length > 0
        ? rows
        : [
            {
              ...candidate,
              script_generation_status: "review_required",
              script_review_reason: "reprocess_returned_no_rows",
              script_validation_errors: ["reprocess_returned_no_rows"],
            },
          ];
    }
    if (args.applyLocal) {
      for (const row of resultRows) {
        const prepared = prepareScriptRepairRow(row);
        if (isPersistableScriptReady(prepared)) {
          await db.upsertStory(prepared);
          Object.assign(row, prepared);
          row.reprocess_persisted = true;
        } else {
          row.reprocess_persisted = false;
          row.reprocess_persist_skip_reason = "not_script_ready";
        }
      }
    }
    return resultRows;
  } catch (err) {
    return [
      {
        ...candidate,
        script_generation_status: "review_required",
        script_review_reason: `reprocess_exception:${String(
          err.message || err,
        ).slice(0, 180)}`,
        script_validation_errors: [
          `reprocess_exception:${String(err.message || err).slice(0, 180)}`,
        ],
      },
    ];
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  if (args.forceStory && args.storyIds.length === 0) {
    throw new Error("--force-story requires --story ID");
  }
  if (!process.env.LLM_REQUEST_TIMEOUT_MS) {
    process.env.LLM_REQUEST_TIMEOUT_MS = String(args.llmTimeoutMs);
  }
  if (args.llmProvider) {
    if (!["local", "ollama", "openai-compatible", "anthropic", "claude"].includes(args.llmProvider)) {
      throw new Error(`Unsupported --llm-provider: ${args.llmProvider}`);
    }
    process.env.LLM_PROVIDER = args.llmProvider;
  }

  const dbStories =
    typeof db.getStoriesSync === "function"
      ? db.getStoriesSync()
      : await db.getStories();
  const stories = await buildStoryPoolForReprocess({
    stories: dbStories,
    args,
  });
  const candidates = selectReprocessableScriptFailureStories({
    stories,
    limit: args.limit,
    storyIds: args.storyIds,
    forceStoryIds: args.forceStory,
  });
  const excluded = buildReprocessExclusions({ stories, candidates, args });

  let results = [];
  let backupPath = null;
  if (args.applyLocal && candidates.length > 0) {
    const backupDir = path.join(path.dirname(db.DB_PATH), "backups");
    await fs.ensureDir(backupDir);
    backupPath = path.join(backupDir, backupFileName());
    await db.getDb().backup(backupPath);
  }

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      const rows = await reprocessCandidate(candidate, args);
      results.push(...rows);
    }
  }

  const report = buildScriptFailureReprocessReport({
    mode: args.applyLocal ? "apply_local" : "dry_run",
    candidates,
    results,
    excluded,
  });
  if (backupPath) {
    report.backup_path = backupPath;
  }
  const markdown = formatScriptFailureReprocessMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "script_failure_reprocess.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "script_failure_reprocess.md"),
    markdown,
    "utf-8",
  );

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[script-failure-reprocess] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_REPROCESS_LLM_TIMEOUT_MS,
  DEFAULT_REPROCESS_MAX_ATTEMPTS,
  buildReprocessExclusions,
  buildStoryPoolForReprocess,
  isPersistableScriptReady,
  loadForcedStoryManifestsFromLocalQueue,
  parseArgs,
  prepareScriptRepairRow,
  reprocessCandidate,
};
