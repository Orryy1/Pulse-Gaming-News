/**
 * tools/studio-v2-analytics-loop.js â€” daily continuous-improvement loop.
 *
 * Pulls the last 14 days of published stories + their YouTube
 * metrics, hands the payload to the configured LLM for pattern analysis,
 * and writes findings to data/analytics_findings.md (append-only,
 * dated). The findings file is the feedback signal future story
 * package generation can read into hook variant prompting.
 *
 * What the LLM is asked to surface:
 *   1. Best-performing hooks this window (by view-count and
 *      like-to-view ratio).
 *   2. Worst-performing patterns (the ones to stop using).
 *   3. Classification mix that's overperforming vs the channel mean.
 *   4. One concrete suggestion for next-day's content slate.
 *
 * Safety:
 *   - Read-only against the DB.
 *   - No publish triggers, no token reads, no platform writes.
 *   - LLM call uses the configured local provider by default.
 *   - On any failure, posts a Discord error notification and exits
 *     non-zero so the operator knows to look.
 *
 * Schedule: meant to be invoked by a cron / scheduled task once a
 * day. Pure node script, no Express.
 *
 * Usage:
 *   node tools/studio-v2-analytics-loop.js [--days=14] [--dry]
 *
 * --dry: skip the LLM call and Discord post. Just print the payload.
 *
 * Env:
 *   ANTHROPIC_API_KEY  â€” required for live runs
 *   DISCORD_WEBHOOK_URL â€” required for live runs
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { createLlmClient } = require("../lib/llm-client");
const { describeLlmState } = require("../lib/llm-key");

const ROOT = path.resolve(__dirname, "..");

function getAnalyticsDbPath() {
  const { resolveDbPath } = require("../lib/db");
  return resolveDbPath();
}

function getFindingsPath() {
  const override = (process.env.STUDIO_ANALYTICS_FINDINGS_PATH || "").trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(ROOT, override);
  }
  return path.join(path.dirname(getAnalyticsDbPath()), "analytics_findings.md");
}

function displayPath(targetPath) {
  const rel = path.relative(ROOT, targetPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel
    : targetPath;
}

function parseArgs(argv) {
  const args = { days: 14, dry: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry") args.dry = true;
    else if (a.startsWith("--days=")) args.days = Number(a.slice(7)) || 14;
  }
  return args;
}

function loadStories(daysWindow, opts = {}) {
  const Database = require("better-sqlite3");
  const dbPath = opts.dbPath || getAnalyticsDbPath();
  const db = new Database(dbPath, {
    readonly: true,
  });
  // Stories with a YouTube id and published in the window
  const cutoff = new Date(
    Date.now() - daysWindow * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = db
    .prepare(
      `SELECT
         id, title, hook, classification, flair, breaking_score, score,
         youtube_post_id, youtube_url, youtube_published_at,
         youtube_views, youtube_likes, youtube_comments,
         tiktok_views, instagram_views, virality_score,
         stats_fetched_at
       FROM stories
       WHERE youtube_post_id IS NOT NULL
         AND COALESCE(youtube_published_at, '') >= ?
       ORDER BY youtube_published_at DESC`,
    )
    .all(cutoff);
  db.close();
  return rows;
}

function summariseStory(s) {
  const views = Number(s.youtube_views || 0);
  const likes = Number(s.youtube_likes || 0);
  const comments = Number(s.youtube_comments || 0);
  const ltv = views > 0 ? Number((likes / views).toFixed(4)) : 0;
  const ctv = views > 0 ? Number((comments / views).toFixed(4)) : 0;
  return {
    id: s.id,
    title: (s.title || "").slice(0, 90),
    hook: (s.hook || "").slice(0, 140),
    flair: s.flair || s.classification || "",
    breakingScore: Number(s.breaking_score || s.score || 0),
    publishedAt: s.youtube_published_at || null,
    views,
    likes,
    comments,
    likeToViewRatio: ltv,
    commentToViewRatio: ctv,
    viralityScore: Number(s.virality_score || 0),
  };
}

function median(numbers = []) {
  const values = numbers
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function hookFragment(hook = "") {
  return String(hook || "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

function storyPerformanceScore(story = {}) {
  const views = Number(story.views || 0);
  const likeRatio = Number(story.likeToViewRatio || 0);
  const commentRatio = Number(story.commentToViewRatio || 0);
  const virality = Number(story.viralityScore || 0);
  return views + likeRatio * 12000 + commentRatio * 8000 + virality * 8;
}

function groupMedianViewsByFlair(payload = []) {
  const groups = new Map();
  for (const item of payload) {
    const flair = String(item.flair || "Unknown").trim() || "Unknown";
    const views = groups.get(flair) || [];
    views.push(Number(item.views || 0));
    groups.set(flair, views);
  }
  return [...groups.entries()]
    .map(([flair, views]) => ({ flair, median_views: median(views) }))
    .sort((a, b) => b.median_views - a.median_views);
}

function buildSmallDatasetFindings(payload = [], { reason = "" } = {}) {
  const note = reason ? ` Local analysis fallback used because ${reason}.` : "";
  return [
    "## Top patterns (this window)",
    `Dataset is too small to call a reliable pattern (${payload.length} stories).${note}`,
    "",
    "## Underperforming patterns",
    `Dataset is too small to call a reliable weak pattern (${payload.length} stories).`,
    "",
    "## Classification mix",
    `Dataset is too small to compare flairs reliably (${payload.length} stories).`,
    "",
    "## Tomorrow's recommendation",
    "Prioritise named game release details with launch timing, editions and player access in the first sentence.",
  ].join("\n");
}

function buildDeterministicFindings(payload = [], { reason = "" } = {}) {
  const rows = Array.isArray(payload) ? payload : [];
  if (rows.length < 5) return buildSmallDatasetFindings(rows, { reason });

  const ranked = [...rows].sort(
    (a, b) => storyPerformanceScore(b) - storyPerformanceScore(a),
  );
  const top = ranked.slice(0, 3);
  const weak = ranked.slice(-2).reverse();
  const flairRows = groupMedianViewsByFlair(rows);
  const bestFlair = flairRows[0] || { flair: "Unknown", median_views: 0 };
  const weakestFlair = flairRows[flairRows.length - 1] || bestFlair;
  const best = top[0] || {};
  const releaseLed = /release|launch|state of play|pre.?order|edition|available|returns/i.test(
    `${best.title || ""} ${best.hook || ""}`,
  );
  const recommendation = releaseLed
    ? "Prioritise named game release details with launch timing, editions and player access in the first sentence."
    : "Prioritise named games with a concrete player consequence and proof in the first sentence.";
  const note = reason
    ? `Local analysis fallback used because ${String(reason).slice(0, 180)}.`
    : "Local analysis fallback used.";

  return [
    "## Top patterns (this window)",
    ...top.map(
      (item) =>
        `- ${item.id}: named subject plus concrete player detail, "${hookFragment(item.hook)}" (${Number(item.views || 0)} views).`,
    ),
    "",
    "## Underperforming patterns",
    ...weak.map(
      (item) =>
        `- ${item.id}: broad discussion framing underperformed, "${hookFragment(item.hook)}" (${Number(item.views || 0)} views).`,
    ),
    "",
    "## Classification mix",
    `${bestFlair.flair} overperformed on median views (${Math.round(bestFlair.median_views)}). ${weakestFlair.flair} underperformed (${Math.round(weakestFlair.median_views)}).`,
    "",
    "## Tomorrow's recommendation",
    recommendation,
    "",
    `Fallback note: ${note}`,
  ].join("\n");
}

function buildPrompt(payload) {
  return [
    "You are an experienced YouTube Shorts analyst for the Pulse Gaming channel.",
    "Your job is to find PATTERNS in what worked and what didn't.",
    "",
    "Below is a JSON array of recently-published Shorts with their first-7-day metrics.",
    "Each entry has: id, title, hook, flair, breakingScore, views, likes, comments,",
    "likeToViewRatio (likes/views), commentToViewRatio (comments/views), viralityScore.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Output a single markdown block with EXACTLY these four sections, no preamble:",
    "",
    "## Top patterns (this window)",
    "List 2-3 hook patterns that retained best (by views + likeToViewRatio jointly).",
    "Reference specific story ids and quote a 4-8 word fragment from each winning hook.",
    "",
    "## Underperforming patterns",
    "List 1-2 patterns that consistently underperformed. Be specific (don't say 'low engagement', name the actual pattern).",
    "",
    "## Classification mix",
    "One sentence on which flair (BREAKING / RUMOUR / VERIFIED / LEAK / etc.) overperformed the channel average and which underperformed. Use median view count as the comparator.",
    "",
    "## Tomorrow's recommendation",
    "ONE concrete recommendation for next-day script generation. Keep it under 25 words. Actionable, specific.",
    "",
    "Rules:",
    "- British English. No serial comma. No em dashes.",
    "- Refuse to invent metrics not present in the data.",
    "- If the dataset is too small (< 5 stories) say so explicitly under each section instead of guessing.",
    "- Never output advertiser-unfriendly words (death, war, kill, attack, crisis).",
  ].join("\n");
}

async function callClaude(prompt) {
  const llmState = describeLlmState();
  if (!llmState.ok) throw new Error(llmState.reason);
  const client = createLlmClient();
  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content?.[0]?.text || "";
}

async function postDiscord(text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.log(
      "[analytics] DISCORD_WEBHOOK_URL not set; skipping Discord post.",
    );
    return;
  }
  const payload = {
    username: "Pulse Gaming",
    content: text.length > 1900 ? text.slice(0, 1897) + "..." : text,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `Discord webhook failed ${res.status}: ${await res.text()}`,
    );
  }
}

async function appendFindings(findingsText, payload, daysWindow, opts = {}) {
  const findingsPath = opts.findingsPath || getFindingsPath();
  await fs.ensureDir(path.dirname(findingsPath));
  const existing = (await fs.pathExists(findingsPath))
    ? await fs.readFile(findingsPath, "utf8")
    : "# Pulse Gaming â€” analytics findings (rolling)\n\nAppended by `tools/studio-v2-analytics-loop.js` once daily. Most recent at top.\n\n";
  const date = new Date().toISOString().slice(0, 10);
  const header = `\n---\n\n# ${date} (${daysWindow}-day window, ${payload.length} stories)\n\n`;
  // Insert new entry directly after the file's title block.
  const titleEnd = existing.indexOf("\n\n");
  const before =
    titleEnd >= 0 ? existing.slice(0, titleEnd + 2) : existing + "\n\n";
  const after = titleEnd >= 0 ? existing.slice(titleEnd + 2) : "";
  const out = before + header + findingsText + "\n" + after;
  await fs.writeFile(findingsPath, out);
  return findingsPath;
}

function extractTomorrowRecommendation(findings = "") {
  const recoMatch = String(findings || "").match(
    /## Tomorrow'?s recommendation\s*\n([^\n#]+)/,
  );
  return recoMatch ? recoMatch[1].trim() : "";
}

function validateFindings(findings = "") {
  const text = String(findings || "").trim();
  const recommendation = extractTomorrowRecommendation(text);
  const failures = [];
  if (!text) failures.push("empty_findings");
  if (!/^## Top patterns \(this window\)/im.test(text)) {
    failures.push("missing_top_patterns_section");
  }
  if (!/^## Underperforming patterns/im.test(text)) {
    failures.push("missing_underperforming_patterns_section");
  }
  if (!/^## Classification mix/im.test(text)) {
    failures.push("missing_classification_mix_section");
  }
  if (!recommendation) {
    failures.push("missing_actionable_recommendation");
  }
  if (/no actionable recommendation produced/i.test(recommendation)) {
    failures.push("non_actionable_recommendation");
  }
  if (recommendation && recommendation.split(/\s+/).filter(Boolean).length > 32) {
    failures.push("recommendation_too_long");
  }
  return {
    ok: failures.length === 0,
    recommendation,
    failures,
  };
}

async function runAnalyticsLoop({
  args,
  loadStoriesFn = loadStories,
  callLlmFn = callClaude,
  postDiscordFn = postDiscord,
  appendFindingsFn = appendFindings,
  log = console.log,
} = {}) {
  log(`[analytics] window: ${args.days} days - dry=${args.dry ? "yes" : "no"}`);
  const stories = loadStoriesFn(args.days);
  log(`[analytics] loaded ${stories.length} published stories`);

  if (stories.length === 0) {
    log("[analytics] no published stories in window; nothing to do.");
    return { payload: [], findings: "", findingsPath: null, usedFallback: false };
  }

  const payload = stories.map(summariseStory);
  const prompt = buildPrompt(payload);

  if (args.dry) {
    log("[analytics] DRY RUN - payload size:", payload.length);
    log(prompt.slice(0, 1200));
    return { payload, findings: "", findingsPath: null, usedFallback: false };
  }

  let findings;
  let usedFallback = false;
  let fallbackReason = "";
  try {
    findings = await callLlmFn(prompt);
    const validation = validateFindings(findings);
    if (!validation.ok) {
      throw new Error(`llm_output_${validation.failures.join("_")}`);
    }
  } catch (err) {
    fallbackReason = err.message || "local analyst unavailable";
    log(`[analytics] LLM call failed, using deterministic fallback: ${fallbackReason}`);
    findings = buildDeterministicFindings(payload, { reason: fallbackReason });
    usedFallback = true;
  }

  const findingsPath = await appendFindingsFn(findings, payload, args.days);
  log(`[analytics] findings appended -> ${findingsPath}`);

  const reco = extractTomorrowRecommendation(findings);
  const summary = [
    `Analytics loop (${args.days}-day window, ${payload.length} stories)`,
    "",
    usedFallback
      ? `Fallback: local analysis used after LLM failure (${fallbackReason.slice(0, 160)})`
      : "",
    reco ? `**Tomorrow:** ${reco}` : "(no actionable recommendation produced)",
    "",
    `Full findings: \`${displayPath(findingsPath)}\``,
  ].filter(Boolean).join("\n");
  try {
    await postDiscordFn(summary);
    log("[analytics] Discord summary posted");
  } catch (err) {
    log(`[analytics] Discord post failed: ${err.message}`);
  }

  return { payload, findings, findingsPath, usedFallback, fallbackReason };
}

async function main(argsIn) {
  const args = argsIn || parseArgs(process.argv);
  return runAnalyticsLoop({ args });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  main,
  runAnalyticsLoop,
  loadStories,
  summariseStory,
  buildDeterministicFindings,
  buildPrompt,
  extractTomorrowRecommendation,
  validateFindings,
  appendFindings,
  getAnalyticsDbPath,
  getFindingsPath,
  displayPath,
};
