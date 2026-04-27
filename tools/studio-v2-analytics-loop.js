/**
 * tools/studio-v2-analytics-loop.js — daily continuous-improvement loop.
 *
 * Pulls the last 14 days of published stories + their YouTube
 * metrics, hands the payload to Claude Haiku for pattern analysis,
 * and writes findings to data/analytics_findings.md (append-only,
 * dated). The findings file is the feedback signal future story
 * package generation can read into hook variant prompting.
 *
 * What Claude is asked to surface:
 *   1. Best-performing hooks this window (by view-count and
 *      like-to-view ratio).
 *   2. Worst-performing patterns (the ones to stop using).
 *   3. Classification mix that's overperforming vs the channel mean.
 *   4. One concrete suggestion for next-day's content slate.
 *
 * Safety:
 *   - Read-only against the DB.
 *   - No publish triggers, no token reads, no platform writes.
 *   - Anthropic call uses claude-haiku-4-5-20251001 (cheapest tier).
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
 *   ANTHROPIC_API_KEY  — required for live runs
 *   DISCORD_WEBHOOK_URL — required for live runs
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..");
const FINDINGS_PATH = path.join(ROOT, "data", "analytics_findings.md");

function parseArgs(argv) {
  const args = { days: 14, dry: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry") args.dry = true;
    else if (a.startsWith("--days=")) args.days = Number(a.slice(7)) || 14;
  }
  return args;
}

function loadStories(daysWindow) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const Anthropic =
    require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
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

async function appendFindings(findingsText, payload, daysWindow) {
  await fs.ensureDir(path.dirname(FINDINGS_PATH));
  const existing = (await fs.pathExists(FINDINGS_PATH))
    ? await fs.readFile(FINDINGS_PATH, "utf8")
    : "# Pulse Gaming — analytics findings (rolling)\n\nAppended by `tools/studio-v2-analytics-loop.js` once daily. Most recent at top.\n\n";
  const date = new Date().toISOString().slice(0, 10);
  const header = `\n---\n\n# ${date} (${daysWindow}-day window, ${payload.length} stories)\n\n`;
  // Insert new entry directly after the file's title block.
  const titleEnd = existing.indexOf("\n\n");
  const before =
    titleEnd >= 0 ? existing.slice(0, titleEnd + 2) : existing + "\n\n";
  const after = titleEnd >= 0 ? existing.slice(titleEnd + 2) : "";
  const out = before + header + findingsText + "\n" + after;
  await fs.writeFile(FINDINGS_PATH, out);
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(
    `[analytics] window: ${args.days} days · dry=${args.dry ? "yes" : "no"}`,
  );
  const stories = loadStories(args.days);
  console.log(`[analytics] loaded ${stories.length} published stories`);

  if (stories.length === 0) {
    console.log("[analytics] no published stories in window; nothing to do.");
    return;
  }

  const payload = stories.map(summariseStory);
  const prompt = buildPrompt(payload);

  if (args.dry) {
    console.log("[analytics] DRY RUN — payload size:", payload.length);
    console.log(prompt.slice(0, 1200));
    return;
  }

  let findings;
  try {
    findings = await callClaude(prompt);
  } catch (err) {
    console.error("[analytics] Claude call failed:", err.message);
    await postDiscord(
      `⚠️ Analytics loop FAILED: ${err.message.slice(0, 300)}`,
    ).catch(() => {});
    process.exit(1);
  }

  await appendFindings(findings, payload, args.days);
  console.log(`[analytics] findings appended → ${FINDINGS_PATH}`);

  // Discord summary: send a stripped-down version (Tomorrow's
  // recommendation only — the full file is for the operator dashboard).
  const recoMatch = findings.match(
    /## Tomorrow'?s recommendation\s*\n([^\n#]+)/,
  );
  const reco = recoMatch ? recoMatch[1].trim() : "";
  const summary = [
    `📊 **Analytics loop** (${args.days}-day window, ${payload.length} stories)`,
    "",
    reco ? `**Tomorrow:** ${reco}` : "(no actionable recommendation produced)",
    "",
    `Full findings: \`data/analytics_findings.md\``,
  ].join("\n");
  try {
    await postDiscord(summary);
    console.log("[analytics] Discord summary posted");
  } catch (err) {
    console.error("[analytics] Discord post failed:", err.message);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  loadStories,
  summariseStory,
  buildPrompt,
};
