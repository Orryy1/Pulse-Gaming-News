#!/usr/bin/env node
"use strict";

const path = require("node:path");

const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const mediaPaths = require("../lib/media-paths");
const {
  applyLocalTtsPublishRefresh,
  buildLocalTtsPublishRefreshPlan,
  renderLocalTtsPublishRefreshMarkdown,
} = require("../lib/ops/local-tts-publish-refresh");
const {
  applyLocalProofTtsLimits,
} = require("../lib/ops/local-proof-tts-limits");
const {
  createLocalTtsBatchRecovery,
} = require("../lib/ops/local-tts-batch-recovery");
const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
} = require("../lib/studio/local-tts-readiness");
const {
  classifyLocalLiamSafety,
} = require("../lib/ops/local-liam-safety");

function parseArgs(argv) {
  const args = {
    storyIds: [],
    limit: null,
    applyLocal: false,
    rerender: false,
    allowPublishedRepair: false,
    outDir: OUT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story" || arg === "--story-id") {
      args.storyIds.push(
        ...String(argv[++i] || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--story=")) {
      args.storyIds.push(
        ...arg
          .slice("--story=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i] || args.outDir;
    } else if (arg === "--apply-local") {
      args.applyLocal = true;
    } else if (arg === "--dry-run") {
      args.applyLocal = false;
    } else if (arg === "--rerender") {
      args.rerender = true;
    } else if (arg === "--allow-published-repair") {
      args.allowPublishedRepair = true;
    }
  }
  args.storyIds = [...new Set(args.storyIds.filter(Boolean))];
  return args;
}

async function ffprobeDuration(file) {
  const cp = require("node:child_process");
  const outputAbs = await mediaPaths.resolveExisting(file);
  if (!outputAbs || !(await fs.pathExists(outputAbs))) return null;
  try {
    const raw = cp.execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputAbs,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const parsed = Number(String(raw || "").trim());
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  } catch (_) {
    return null;
  }
}

async function writeReport(outDir, name, report) {
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, `${name}.json`);
  const mdPath = path.join(outDir, `${name}.md`);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderLocalTtsPublishRefreshMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = require("../lib/db");
  const outDir = path.resolve(args.outDir || OUT);
  const stories = await db.getStories();
  const selected = args.storyIds.length
    ? stories.filter((story) => args.storyIds.includes(String(story.id)))
    : Number.isFinite(args.limit) && args.limit > 0
      ? stories.slice(0, args.limit)
      : stories;
  const plan = buildLocalTtsPublishRefreshPlan({
    stories,
    storyIds: args.storyIds.length ? args.storyIds : selected.map((story) => story.id),
    allowPublishedRepair: args.allowPublishedRepair,
    dryRun: !args.applyLocal,
  });
  const planPaths = await writeReport(outDir, "local_tts_publish_refresh_plan", plan);
  console.log(
    `[local-tts-publish-refresh] plan refreshable=${plan.counts.refreshable} blocked=${plan.counts.blocked}`,
  );
  console.log(`[local-tts-publish-refresh] plan_md=${path.relative(ROOT, planPaths.mdPath)}`);

  if (!args.applyLocal) return;
  if (!args.storyIds.length) {
    throw new Error("--apply-local requires explicit --story id(s)");
  }

  process.env.TTS_PROVIDER = "local";
  process.env.PULSE_SKIP_DOTENV = "true";
  const audio = require("../audio");
  const brand = require("../brand");
  const ttsLimits = applyLocalProofTtsLimits();
  console.log(
    `[local-tts-publish-refresh] local_tts_timeout_ms=${ttsLimits.local_tts_timeout_ms} attempts=${ttsLimits.local_tts_request_attempts}`,
  );
  const localTts = await fetchLocalTtsHealth({
    baseUrl: process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
    voiceId: brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default",
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });
  const voiceSafety = classifyLocalLiamSafety(localTts);
  if (voiceSafety.safe !== true) {
    throw new Error(`local Liam voice is not safe: ${voiceSafety.code || "unsafe_voice"}`);
  }

  const storiesById = Object.fromEntries(stories.map((story) => [story.id, story]));
  const applyReport = await applyLocalTtsPublishRefresh({
    plan,
    storiesById,
    generateTtsForStory: audio.generateTtsForStory,
    cleanText: audio.cleanForTTS,
    selectRawTtsScript: audio.selectRawTtsScript,
    getAudioDuration: audio.getAudioDuration,
    recoverLocalTts: createLocalTtsBatchRecovery({
      root: ROOT,
      voiceId: brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default",
      baseUrl: process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
    }),
    persistStory: (story) => db.upsertStory(story),
    backupRoot: path.join(outDir, "local-tts-publish-refresh", "backups"),
  });
  const applyPaths = await writeReport(outDir, "local_tts_publish_refresh_apply", applyReport);
  console.log(
    `[local-tts-publish-refresh] applied=${applyReport.applied.length} skipped=${applyReport.skipped.length}`,
  );
  console.log(`[local-tts-publish-refresh] apply_md=${path.relative(ROOT, applyPaths.mdPath)}`);

  if (args.rerender && applyReport.applied.length) {
    const ids = applyReport.applied.map((item) => item.story_id).join(",");
    const previousIds = process.env.PRODUCE_STORY_IDS;
    const previousLimit = process.env.PRODUCE_STORY_LIMIT;
    process.env.PRODUCE_STORY_IDS = ids;
    delete process.env.PRODUCE_STORY_LIMIT;
    console.log(`[local-tts-publish-refresh] rerendering selected stories: ${ids}`);
    const assemble = require("../assemble");
    await assemble();
    if (previousIds === undefined) delete process.env.PRODUCE_STORY_IDS;
    else process.env.PRODUCE_STORY_IDS = previousIds;
    if (previousLimit === undefined) delete process.env.PRODUCE_STORY_LIMIT;
    else process.env.PRODUCE_STORY_LIMIT = previousLimit;

    const afterStories = await db.getStories();
    const rerenderRows = [];
    for (const item of applyReport.applied) {
      const story = afterStories.find((row) => row.id === item.story_id);
      rerenderRows.push({
        story_id: item.story_id,
        exported_path: story?.exported_path || null,
        final_duration_seconds: story?.duration_seconds ?? null,
        audio_duration_seconds: story?.audio_duration ?? null,
        final_exists: story?.exported_path
          ? Boolean(await mediaPaths.resolveExisting(story.exported_path))
          : false,
        final_probe_seconds: story?.exported_path ? await ffprobeDuration(story.exported_path) : null,
        qa_failed: story?.qa_failed === true,
        publish_status: story?.publish_status || null,
        publish_error: story?.publish_error || null,
      });
    }
    const rerenderReport = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      rows: rerenderRows,
      safety: {
        local_only: true,
        posts_to_platforms: false,
        mutates_tokens: false,
        mutates_railway_env: false,
        clears_platform_ids: false,
      },
    };
    const rerenderPaths = await writeReport(outDir, "local_tts_publish_refresh_rerender", rerenderReport);
    console.log(`[local-tts-publish-refresh] rerender_md=${path.relative(ROOT, rerenderPaths.mdPath)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-tts-publish-refresh] ${err.stack || err.message}`);
    process.exit(1);
  });
}
