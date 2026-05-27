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
} = require("../lib/source-bound-script-writer");
const {
  buildScriptFailureReprocessReport,
  formatScriptFailureReprocessMarkdown,
  selectReprocessableScriptFailureStories,
} = require("../lib/ops/script-failure-reprocess");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_REPROCESS_LLM_TIMEOUT_MS = 30_000;
const DEFAULT_REPROCESS_MAX_ATTEMPTS = 1;

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
      `  Local LLM calls are bounded by --llm-timeout-ms (default ${DEFAULT_REPROCESS_LLM_TIMEOUT_MS}ms).\n` +
      `  Repair mode uses --max-attempts ${DEFAULT_REPROCESS_MAX_ATTEMPTS} and --skip-editor by default so one bad story cannot stall the queue.\n` +
      "  --apply-local persists only selected script-review failure rows and never posts to Discord/social.\n",
  );
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
  const runtime = classifyShortScriptRuntime({
    text: scriptText,
    story: row,
    secondsPerWord: secondsPerWordForTtsProvider(provider, env),
  });
  if (runtime.result !== "pass" || runtime.shouldGenerateShortAudio === false) {
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
  return coherence.failures.length === 0;
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

  const stories =
    typeof db.getStoriesSync === "function"
      ? db.getStoriesSync()
      : await db.getStories();
  const candidates = selectReprocessableScriptFailureStories({
    stories,
    limit: args.limit,
    storyIds: args.storyIds,
    forceStoryIds: args.forceStory,
  });

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
  isPersistableScriptReady,
  parseArgs,
  prepareScriptRepairRow,
  reprocessCandidate,
};
