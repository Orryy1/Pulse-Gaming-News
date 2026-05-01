"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  resolveRenderEngine,
  buildStudioV21ReviewMetadata,
} = require("../../render-engine-switch");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function platformCount(story) {
  return [
    story.youtube_post_id,
    story.tiktok_post_id,
    story.instagram_media_id,
    story.facebook_post_id,
    story.twitter_post_id,
  ].filter(Boolean).length;
}

function selectStudioV21Candidates(stories, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5, 5));
  return (stories || [])
    .filter((story) => {
      if (!story || typeof story !== "object") return false;
      if (!(story.approved === true || story.approved === 1)) return false;
      if (!story.exported_path || !story.audio_path) return false;
      if (story.qa_failed === true || story.publish_status === "failed") {
        return false;
      }
      if (story.render_engine === "studio-v21") {
        const status = String(story.render_review_status || "").toLowerCase();
        if (status === "approved" || status === "pending") return false;
      }
      return platformCount(story) < 5;
    })
    .slice(0, limit);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function defaultPathsForStory(storyId) {
  return {
    candidatePath: rel(path.join(TEST_OUT, `studio_v2_${storyId}_v21.mp4`)),
    reportPath: rel(path.join(TEST_OUT, `${storyId}_studio_v2_v21_report.json`)),
    gatePath: rel(path.join(TEST_OUT, `${storyId}_studio_v21_gate.json`)),
  };
}

function buildReviewHoldUpdate(story, metadata = {}) {
  return {
    ...story,
    ...buildStudioV21ReviewMetadata(metadata),
  };
}

function runNodeScript(script, args, env) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      RENDER_ENGINE: "studio-v21",
      STUDIO_V21_HERO: "true",
      STUDIO_V2_OUTPUT_SUFFIX: "_v21",
      STUDIO_V2_SKIP_LLM: env.STUDIO_V2_SKIP_LLM || "true",
      STUDIO_V2_ALLOW_VOICE_FALLBACK:
        env.STUDIO_V2_ALLOW_VOICE_FALLBACK || "true",
    },
  });
}

async function runStudioV21ReviewBatch({
  db,
  stories,
  env = process.env,
  limit = 5,
  dryRun = false,
  logger = console,
  renderOne,
  runGauntlet,
  gateOne,
} = {}) {
  const cfg = resolveRenderEngine(env);
  if (!cfg.useStudioV21) {
    return {
      skipped: "render_engine_not_studio_v21",
      engine: cfg.engine,
      candidates: [],
      results: [],
    };
  }

  const activeDb = db || require("../../db");
  const allStories = stories || (await activeDb.getStories());
  const candidates = selectStudioV21Candidates(allStories, { limit });
  const results = [];
  const rendered = [];

  const runRender =
    renderOne ||
    ((storyId) => runNodeScript("tools/studio-v21-render.js", [storyId], env));
  const runGate =
    gateOne ||
    ((storyId) =>
      runNodeScript("tools/studio-v21-gate.js", [storyId, "--variant", "v21"], env));
  const runGauntletOnce =
    runGauntlet ||
    (() => runNodeScript("tools/studio-v2-gauntlet.js", [], env));

  for (const story of candidates) {
    const paths = defaultPathsForStory(story.id);
    if (dryRun) {
      results.push({ id: story.id, dryRun: true, ...paths });
      continue;
    }

    const renderResult = runRender(story.id, { env, paths });
    if (renderResult && renderResult.status !== 0) {
      const status = renderResult.status || 1;
      logger.warn(`[studio-v21] render failed for ${story.id} (exit ${status})`);
      results.push({ id: story.id, ok: false, stage: "render", status });
      continue;
    }
    rendered.push({ story, paths });
  }

  if (!dryRun && rendered.length > 0) {
    const gauntletResult = runGauntletOnce({ env });
    if (gauntletResult && gauntletResult.status !== 0) {
      const status = gauntletResult.status || 1;
      logger.warn(`[studio-v21] gauntlet failed (exit ${status})`);
      for (const { story } of rendered) {
        results.push({ id: story.id, ok: false, stage: "gauntlet", status });
      }
      return {
        engine: cfg.engine,
        candidates: candidates.map((s) => s.id),
        results,
      };
    }
  }

  for (const { story, paths } of rendered) {
    const gateResult = runGate(story.id, { env, paths });
    if (gateResult && gateResult.status !== 0) {
      const status = gateResult.status || 1;
      logger.warn(`[studio-v21] gate failed for ${story.id} (exit ${status})`);
      results.push({ id: story.id, ok: false, stage: "gate", status });
      continue;
    }

    let gateVerdict = null;
    try {
      const fs = require("fs-extra");
      const gateJson = await fs.readJson(path.join(ROOT, paths.gatePath));
      gateVerdict = gateJson.verdict || null;
    } catch {
      gateVerdict = null;
    }

    const updated = buildReviewHoldUpdate(story, {
      ...paths,
      gateVerdict,
    });
    await activeDb.upsertStory(updated);
    results.push({
      id: story.id,
      ok: true,
      gateVerdict,
      humanReviewRequired: true,
      ...paths,
    });
  }

  return {
    engine: cfg.engine,
    candidates: candidates.map((s) => s.id),
    results,
  };
}

function isStudioV21BatchEnabled(env = process.env) {
  const cfg = resolveRenderEngine(env);
  return cfg.useStudioV21 && !truthy(env.STUDIO_V21_BATCH_DISABLED);
}

module.exports = {
  selectStudioV21Candidates,
  buildReviewHoldUpdate,
  runStudioV21ReviewBatch,
  isStudioV21BatchEnabled,
  defaultPathsForStory,
};
