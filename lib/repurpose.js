/**
 * lib/repurpose.js — Phase 7 repurposing loop.
 *
 * Every finished roundup (and optionally every top-scoring main story)
 * spawns a fan-out of derivative assets:
 *
 *   teaser_short     — 40-55s vertical short cut from the roundup highlights
 *   community_post   — image + copy for YouTube Community tab / X post
 *   blog_post        — long-form article version of the roundup
 *   story_short      — an individual vertical short for each main story
 *                       (used when the main shorts pipeline didn't produce one)
 *
 * This module is the *orchestration* layer — it writes the derivatives
 * rows and enqueues follow-on jobs, but it doesn't itself generate
 * audio / images / videos. That work happens when the per-kind
 * handler picks the derivative up (Phase 8 for GPU kinds, plain node
 * for text-only kinds).
 *
 * Idempotent: derivatives are UPSERTed on
 * (source_kind, source_id, kind, channel_id). Re-running this for the
 * same roundup just ensures rows exist in the right initial state.
 *
 * Enqueue targets (all gated behind USE_JOB_QUEUE=true):
 *   teaser_short    -> kind="derivative_teaser_short"    (GPU)
 *   community_post  -> kind="derivative_community_post"  (text + 1 image)
 *   blog_post       -> kind="derivative_blog_post"       (text only)
 *   story_short     -> kind="derivative_story_short"     (GPU, per-story)
 */

const PRIMARY_KINDS = ["teaser_short", "community_post", "blog_post"];

function kindToJobKind(kind) {
  return `derivative_${kind}`;
}

function fanoutRoundup({
  repos,
  roundupId,
  channelId = process.env.CHANNEL || "pulse-gaming",
  includeStoryShorts = true,
  log = console,
} = {}) {
  if (!repos) repos = require("./repositories").getRepos();

  const roundup = repos.roundups.get(roundupId);
  if (!roundup) {
    throw new Error(`[repurpose] roundup #${roundupId} not found`);
  }
  if (!["rendered", "published"].includes(roundup.status)) {
    log.log(
      `[repurpose] roundup #${roundupId} not yet rendered (status=${roundup.status}); ` +
        `will still create pending derivative rows so the downstream ` +
        `handlers can run as soon as the roundup is ready`,
    );
  }

  const created = [];
  for (const kind of PRIMARY_KINDS) {
    const row = repos.derivatives.upsert({
      source_kind: "roundup",
      source_id: roundup.id,
      kind,
      channel_id: channelId,
      status: "pending",
    });
    created.push(row);
  }

  // Per-story shorts — only for main slots, not quickfire.
  // Skipped for stories that already have a successful exported_path
  // (the main shorts pipeline got there first).
  let storyShortCount = 0;
  if (includeStoryShorts) {
    const items = repos.roundups.items(roundup.id);
    const mainItems = items.filter((i) => /^main-\d+$/.test(i.slot));
    const storyIds = mainItems.map((i) => i.story_id);
    const stories = storyIds.length ? repos.stories.listByIds(storyIds) : [];
    const storyById = Object.fromEntries(stories.map((s) => [s.id, s]));
    for (const item of mainItems) {
      const story = storyById[item.story_id];
      if (!story) continue;
      if (story.exported_path) continue; // main shorts pipeline produced one
      const row = repos.derivatives.upsert({
        source_kind: "story",
        source_id: hashStoryIdForNumericKey(story.id),
        source_story_id: story.id,
        kind: "story_short",
        channel_id: channelId,
        status: "pending",
      });
      created.push(row);
      storyShortCount++;
    }
  }

  // Enqueue a job per pending derivative. The jobs.enqueue path is
  // idempotent on its key, so re-running the fanout won't double-queue.
  const enqueued = [];
  for (const row of created) {
    if (row.status !== "pending") continue;
    const key = `deriv:${row.source_kind}:${row.source_id}:${row.kind}:${row.channel_id}`;
    const requiresGpu =
      row.kind === "teaser_short" || row.kind === "story_short";
    try {
      repos.jobs.enqueue({
        kind: kindToJobKind(row.kind),
        idempotency_key: key,
        payload: {
          derivative_id: row.id,
          roundup_id: roundup.id,
          source_story_id: row.source_story_id || null,
        },
        channel_id: channelId,
        requires_gpu: requiresGpu,
        priority: requiresGpu ? 60 : 40,
      });
      enqueued.push({ id: row.id, kind: row.kind, gpu: requiresGpu });
    } catch (err) {
      log.error &&
        log.error(
          `[repurpose] enqueue failed for derivative #${row.id}: ${err.message}`,
        );
    }
  }

  log.log(
    `[repurpose] roundup #${roundupId}: ${created.length} derivative rows ` +
      `(${storyShortCount} story shorts), ${enqueued.length} jobs enqueued`,
  );

  return {
    roundup_id: roundupId,
    derivatives: created.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
    })),
    enqueued,
  };
}

/**
 * The derivatives table's source_id is an INTEGER column but our
 * stories.id is TEXT (Reddit post id / rss_hash). For story-backed
 * derivatives we need a stable numeric key so the UNIQUE index works.
 * A simple djb2 hash truncated to 31 bits is plenty — collisions would
 * be astronomically rare across a few thousand rows and only matter
 * within (source_kind='story', kind, channel_id) anyway.
 */
function hashStoryIdForNumericKey(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (h * 33) ^ id.charCodeAt(i);
  }
  return Math.abs(h | 0) % 2_147_483_647;
}

/**
 * Scripted-content handlers. These are intentionally thin — the heavy
 * lifting (image/video) happens in later phases. For now we just
 * generate text and mark the derivative ready.
 */
async function generateCommunityPost({ derivative, repos }) {
  const roundup = repos.roundups.get(derivative.source_id);
  if (!roundup) throw new Error("roundup missing for community post");

  const chapters = Array.isArray(roundup.chapters) ? roundup.chapters : [];
  const mainTitles = chapters
    .filter((c) => /^main-\d+$/.test(c.slot))
    .slice(0, 3)
    .map((c) => `• ${c.chapter_title}`)
    .join("\n");

  const script = [
    `New weekly roundup out now.`,
    ``,
    `This week we covered:`,
    mainTitles || "• (roundup pending)",
    ``,
    `Full video: ${roundup.youtube_url || "[link pending]"}`,
  ].join("\n");

  repos.derivatives.upsert({
    source_kind: derivative.source_kind,
    source_id: derivative.source_id,
    kind: derivative.kind,
    channel_id: derivative.channel_id,
    status: "generated",
    script,
  });
  return { script };
}

async function generateBlogPost({ derivative, repos }) {
  const roundup = repos.roundups.get(derivative.source_id);
  if (!roundup) throw new Error("roundup missing for blog post");
  // Lean on the roundup's own script if we have one; else synthesise
  // from the chapter plan. The Phase 7-lite path is markdown only — the
  // full blog renderer (blog/build.js) can turn this into HTML later.
  const chapters = Array.isArray(roundup.chapters) ? roundup.chapters : [];
  const sections = chapters
    .filter((c) => /^main-\d+|quickfire-\d+$/.test(c.slot))
    .map((c) => `## ${c.chapter_title}\n\n_(Summary pending.)_\n`)
    .join("\n");
  const md = [
    `# ${roundup.title || "Weekly Gaming Roundup"}`,
    ``,
    roundup.description || "A rundown of the week's biggest stories.",
    ``,
    sections,
    ``,
    roundup.youtube_url ? `Watch on YouTube: ${roundup.youtube_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  repos.derivatives.upsert({
    source_kind: derivative.source_kind,
    source_id: derivative.source_id,
    kind: derivative.kind,
    channel_id: derivative.channel_id,
    status: "generated",
    script: md,
  });
  return { word_count: md.split(/\s+/).length };
}

/**
 * Build a ~45s teaser short from the roundup. Runs through the Phase 8
 * inference boundary so the GPU model stays in a single process. The
 * short's script is a distilled version of the roundup's chapter plan:
 * tease 3 headlines, land on a "watch the full video" CTA.
 *
 * Persists the mp3 path first so a failure in the compose step still
 * leaves us with narration to retry on.
 */
async function generateTeaserShort({ derivative, repos }) {
  const roundup = repos.roundups.get(derivative.source_id);
  if (!roundup) throw new Error("roundup missing for teaser short");

  const chapters = Array.isArray(roundup.chapters) ? roundup.chapters : [];
  const mainChapters = chapters
    .filter((c) => /^main-\d+$/.test(c.slot))
    .slice(0, 3);

  const segments = [
    {
      label: "hook",
      text: "This week's biggest gaming stories. In under a minute.",
    },
    ...mainChapters.map((c, i) => ({
      label: `beat-${i + 1}`,
      text: c.chapter_title,
    })),
    {
      label: "cta",
      text: "Full roundup is up now. Link in the description.",
    },
  ];

  const { invoke } = require("./inference-client");
  const narration = await invoke(
    "narrate_script",
    {
      voice_id: process.env.ELEVENLABS_VOICE_ID || "__default__",
      speaking_rate: 1.0,
      segments,
    },
    { jobId: `teaser-${roundup.id}` },
  );

  const script = segments.map((s) => s.text).join(" ");

  const compose = await invoke(
    "compose_short",
    {
      narration_path: narration.narration_path,
      kind: "teaser_short",
      roundup_id: roundup.id,
    },
    { jobId: `teaser-${roundup.id}-compose` },
  );

  repos.derivatives.upsert({
    source_kind: derivative.source_kind,
    source_id: derivative.source_id,
    kind: derivative.kind,
    channel_id: derivative.channel_id,
    status: compose && compose.deferred ? "generated" : "rendered",
    script,
    asset_path: compose && compose.output_path ? compose.output_path : null,
  });

  return {
    segments: narration.segments && narration.segments.length,
    narration_path: narration.narration_path,
    compose,
  };
}

/**
 * Single-story vertical short built from a main-slot story. Mirrors the
 * existing shorts pipeline but runs entirely through the inference
 * boundary. Used only when the main shorts pipeline didn't already
 * produce one for this story (checked at fanout time).
 */
async function generateStoryShort({ derivative, repos }) {
  const story = derivative.source_story_id
    ? repos.stories.get(derivative.source_story_id)
    : null;
  if (!story) {
    throw new Error(
      `story_short derivative #${derivative.id} has no linked story`,
    );
  }

  // Skip cleanly if the main shorts pipeline has since caught up.
  if (story.exported_path) {
    repos.derivatives.upsert({
      source_kind: derivative.source_kind,
      source_id: derivative.source_id,
      source_story_id: derivative.source_story_id,
      kind: derivative.kind,
      channel_id: derivative.channel_id,
      status: "rendered",
      asset_path: story.exported_path,
    });
    return { reused: true, asset_path: story.exported_path };
  }

  const segments = [
    { label: "hook", text: story.hook || story.title },
    { label: "body", text: story.body || story.full_script || story.title },
    { label: "loop", text: story.loop || "More gaming news next drop." },
  ].filter((s) => s.text && s.text.trim());

  if (!segments.length) {
    throw new Error(`story_short derivative #${derivative.id} has no script`);
  }

  const { invoke } = require("./inference-client");
  const narration = await invoke(
    "narrate_script",
    {
      voice_id: process.env.ELEVENLABS_VOICE_ID || "__default__",
      speaking_rate: 1.0,
      segments,
    },
    { jobId: `story-short-${story.id}` },
  );

  const compose = await invoke(
    "compose_short",
    {
      narration_path: narration.narration_path,
      kind: "story_short",
      story_id: story.id,
    },
    { jobId: `story-short-${story.id}-compose` },
  );

  repos.derivatives.upsert({
    source_kind: derivative.source_kind,
    source_id: derivative.source_id,
    source_story_id: derivative.source_story_id,
    kind: derivative.kind,
    channel_id: derivative.channel_id,
    status: compose && compose.deferred ? "generated" : "rendered",
    script: segments.map((s) => s.text).join(" "),
    asset_path: compose && compose.output_path ? compose.output_path : null,
  });

  return {
    story_id: story.id,
    narration_path: narration.narration_path,
    compose,
  };
}

/**
 * Handler for the derivative_* job kinds. Routes to the per-kind worker
 * based on the derivative row. GPU kinds (teaser_short, story_short)
 * throw "requires_gpu" so the jobs runner can route them to the local
 * worker via the Phase 4 bridge.
 */
async function runDerivative(job, ctx) {
  const { repos } = ctx;
  const derivativeId = job.payload && job.payload.derivative_id;
  if (!derivativeId) {
    throw new Error("[repurpose] job missing payload.derivative_id");
  }
  const derivative = repos.derivatives.get(derivativeId);
  if (!derivative) {
    throw new Error(`[repurpose] derivative #${derivativeId} not found`);
  }
  switch (derivative.kind) {
    case "community_post":
      return generateCommunityPost({ derivative, repos });
    case "blog_post":
      return generateBlogPost({ derivative, repos });
    case "teaser_short":
      return generateTeaserShort({ derivative, repos, ctx });
    case "story_short":
      return generateStoryShort({ derivative, repos, ctx });
    default:
      throw new Error(
        `[repurpose] unknown derivative kind: ${derivative.kind}`,
      );
  }
}

module.exports = {
  fanoutRoundup,
  runDerivative,
  generateCommunityPost,
  generateBlogPost,
  generateTeaserShort,
  generateStoryShort,
  PRIMARY_KINDS,
  kindToJobKind,
};
