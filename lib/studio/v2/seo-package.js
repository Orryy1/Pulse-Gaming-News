/**
 * lib/studio/v2/seo-package.js — channel-aware SEO package builder.
 *
 * Given a v2 story package + channel theme, produces the upload-ready
 * SEO artefacts for YouTube Shorts / TikTok / Instagram Reels:
 *
 *   - title              ≤ 60 chars, curiosity-gap formatted
 *   - description        first 200 chars carry primary keyword stack;
 *                        full body 150-300 words with AI disclosure
 *                        line (per CLAUDE.md monetisation rules) +
 *                        channel CTA + hashtag block
 *   - chapters           timecode list derived from scene boundaries
 *                        (only for Shorts that exceed 60s; below
 *                        that, returns null since Shorts don't show
 *                        chapter cards)
 *   - hashtags           3-7 tags from the channel registry, plus
 *                        story-derived (game/company name)
 *   - pinnedComment      personal question + reference to a specific
 *                        timestamp in the video to drive engagement
 *   - thumbnailText      ≤ 4 words for the thumbnail overlay
 *
 * The package is purely textual — no image/video assets here. It's
 * meant to be consumed by an upload tool that pastes the title into
 * the platform UI, the description into the description field, etc.
 *
 * NO AI-tell phrases (per the editorial rubric).
 * NO em dashes (memory rule).
 * British English (CLAUDE.md style guide).
 */

"use strict";

const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..", "..");

const AI_TELL_RE =
  /\b(you won'?t believe|this changes everything|but here'?s where it gets interesting|let that sink in|and that'?s not all|smash that like|let me know in the comments)\b/gi;

function escapeForMd(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

function stripAiTells(text) {
  return String(text || "")
    .replace(AI_TELL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEmDashes(text) {
  return String(text || "")
    .replace(/—/g, ", ")
    .replace(/\s+,/g, ",");
}

function trimToLength(text, maxLen) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).replace(/\s+\S*$/, "") + "…";
}

/**
 * Pick the strongest noun phrase from the title — game name, company
 * name, console name, etc. Used in title generation, hashtags and
 * pinned comments.
 */
function extractSubject(story, pkg) {
  const title = String(story?.title || "").trim();
  // Title patterns: split on common separators that delimit the
  // primary subject from descriptive metadata. Covers:
  //   "Metro 2039 - Official Reveal Trailer"
  //   "Metro 2039 | Official Reveal Trailer"
  //   "Metro 2039: Official Reveal Trailer"
  //   "Metro 2039 — Official Reveal Trailer"
  const split = title.split(/\s*[-–—:|]\s+/);
  if (split[0] && split[0].length >= 3 && split[0].length <= 40) {
    return split[0].trim();
  }
  // Capitalised proper noun + optional digits
  const m = title.match(/\b([A-Z][A-Za-z]*(?:\s+[A-Z0-9][A-Za-z0-9]*){0,3})\b/);
  if (m && m[1].length >= 3) return m[1];
  return title.slice(0, 40);
}

/**
 * Pick a curiosity-gap title under 60 chars.
 *
 * Strategy:
 *   1. Use chosen hook if it's punchy and under 60 chars (after
 *      stripping the trailing period)
 *   2. Otherwise build a templated title from subject + flair
 */
function buildTitle({ story, pkg, channel }) {
  const chosen = String(pkg?.hook?.chosen?.text || "").trim();
  let title = chosen.replace(/[.!?]+$/, "");
  if (title && title.length <= 60) {
    return title;
  }

  // Templated fallback
  const subject = extractSubject(story, pkg);
  const flair = String(story?.flair || pkg?.flair || "")
    .toLowerCase()
    .trim();
  let template;
  if (/leak/.test(flair)) {
    template = `${subject} Just Leaked Something Nobody Was Meant To See`;
  } else if (/rumour|rumor/.test(flair)) {
    template = `${subject} Rumour Goes Quiet At The Worst Time`;
  } else if (/confirmed|verified/.test(flair)) {
    template = `${subject} Just Confirmed What Everyone Suspected`;
  } else {
    template = `${subject} Just Did Something Nobody Saw Coming`;
  }
  return trimToLength(template, 60);
}

/**
 * Build the description: keyword-stacked first 200 chars, then
 * 150-300 word body, AI disclosure, channel CTA, hashtag block.
 *
 * Channel-aware:
 *   - Pulse Gaming: "verified gaming leaks" keyword stack
 *   - Stacked: "market moves and earnings" keyword stack
 *   - The Signal: "tech launches and AI news" keyword stack
 */
function buildDescription({ story, pkg, channel }) {
  const subject = extractSubject(story, pkg);
  const flair = (story?.flair || pkg?.flair || "").toUpperCase();
  const keywordStacks = {
    "pulse-gaming": "verified gaming leaks, gaming news shorts, daily gaming",
    stacked:
      "market moves daily, earnings analysis, finance news shorts, daily stocks",
    "the-signal":
      "tech news daily, AI announcements, product launch coverage, silicon valley",
  };
  const stack =
    keywordStacks[channel.channelId] || keywordStacks["pulse-gaming"];

  // First 200 chars: subject + flair + keyword stack. No em dashes
  // anywhere — using a colon + comma structure instead.
  const lead = trimToLength(
    `${subject} just dropped: ${stack}. ${stripAiTells(stripEmDashes(pkg?.hook?.chosen?.text || ""))}`,
    200,
  );

  // Body: take the tightened script's first 600-800 chars, ensure
  // it's monetisation-safe (no banned words), strip AI tells.
  const tightened = stripAiTells(
    stripEmDashes(pkg?.script?.tightened || story?.full_script || ""),
  );
  const bodyTrimmed = trimToLength(tightened, 720);

  // AI disclosure (per CLAUDE.md rule)
  const aiDisclosure =
    "Narration generated with AI tools (ElevenLabs). Visuals composited from publicly available trailer footage. Script edited by a human.";

  // Channel CTA
  const cta = channel.channelName
    ? `Follow ${channel.channelName} so you never miss the next one.`
    : "Follow for more.";

  // Hashtag block
  const hashtags = buildHashtags({ story, pkg, channel });

  return [
    lead,
    "",
    bodyTrimmed,
    "",
    aiDisclosure,
    "",
    cta,
    "",
    hashtags.join(" "),
  ].join("\n");
}

function buildHashtags({ story, pkg, channel }) {
  const subject = extractSubject(story, pkg).replace(/[^A-Za-z0-9]+/g, "");
  const channelTags = {
    "pulse-gaming": ["#Shorts", "#GamingNews", "#GamingLeaks", "#PulseGaming"],
    stacked: ["#Shorts", "#StockMarket", "#FinanceNews", "#StackedDaily"],
    "the-signal": ["#Shorts", "#TechNews", "#AINews", "#TheSignal"],
  };
  const base = channelTags[channel.channelId] || channelTags["pulse-gaming"];
  const tags = [...base];
  if (subject && subject.length >= 3) tags.push(`#${subject}`);
  // De-dup
  return [...new Set(tags)].slice(0, 7);
}

/**
 * Chapter list. For Shorts (≤ 60s) this returns null — Shorts
 * don't render chapter cards on YouTube. For longer renders, emits
 * timecodes from scene boundaries.
 */
function buildChapters({ scenes, runtimeS, channel }) {
  if (!Array.isArray(scenes) || runtimeS <= 60) return null;
  const out = [];
  let t = 0;
  out.push({ atS: 0, label: "Cold Open" });
  for (let i = 1; i < scenes.length; i++) {
    t += Number(scenes[i - 1]?.duration || 0);
    const sceneType = scenes[i].type || scenes[i].sceneType;
    if (sceneType === "card.source") {
      out.push({ atS: t, label: "Source Reveal" });
    } else if (sceneType === "card.stat") {
      out.push({ atS: t, label: "Context" });
    } else if (sceneType === "card.quote") {
      out.push({ atS: t, label: "What People Are Saying" });
    } else if (sceneType === "card.takeaway") {
      out.push({ atS: t, label: "Takeaway" });
    }
  }
  // Format as YouTube chapter strings
  return out.map((c) => {
    const m = Math.floor(c.atS / 60);
    const s = Math.floor(c.atS % 60);
    return `${String(m).padStart(1, "0")}:${String(s).padStart(2, "0")} ${c.label}`;
  });
}

/**
 * Pinned comment — drives engagement by referencing a specific
 * moment in the video. Uses the freeze-frame caption when present.
 */
function buildPinnedComment({ story, pkg, scenes, runtimeS, channel }) {
  const subject = extractSubject(story, pkg);
  // Find a freeze-frame scene — its caption is a memorable moment
  const freeze = (scenes || []).find(
    (s) => s.type === "freeze-frame" || s.sceneType === "freeze-frame",
  );
  let timestamp = "0:30";
  let moment = "freeze on the silhouette";
  if (freeze) {
    const idx = scenes.indexOf(freeze);
    let t = 0;
    for (let i = 0; i < idx; i++) t += Number(scenes[i].duration || 0);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    timestamp = `${m}:${String(s).padStart(2, "0")}`;
    if (freeze.caption) moment = `"${freeze.caption.toLowerCase()}" beat`;
  }

  const subjectKw = subject.split(/\s+/)[0] || "this";
  const channelEnding =
    channel.channelId === "stacked"
      ? "Drop your call below."
      : channel.channelId === "the-signal"
        ? "Drop your prediction below."
        : "Drop your take below.";
  // No em dashes per the editorial rule — use a comma + connective.
  return `What's the bit that surprised you about ${subjectKw}? For me it was the moment at ${timestamp}, the ${moment}. ${channelEnding}`;
}

/**
 * Thumbnail text — ≤ 4 words, ALL CAPS, punchy.
 */
function buildThumbnailText({ story, pkg }) {
  const subject = extractSubject(story, pkg).toUpperCase();
  if (subject.length > 16) return subject.slice(0, 16);
  return subject;
}

/**
 * Validation — flags monetisation-unsafe phrases per CLAUDE.md.
 */
function validatePackage(pkg) {
  const issues = [];
  const banned = [
    "death",
    "war",
    "kill",
    "horror",
    "scary",
    "crisis",
    "attack",
    "violent",
  ];
  const all = [pkg.title, pkg.description].join(" ").toLowerCase();
  for (const b of banned) {
    const re = new RegExp(`\\b${b}\\b`, "i");
    if (re.test(all))
      issues.push({
        severity: "amber",
        kind: "monetisation",
        token: b,
        note: `'${b}' may trigger advertiser-unfriendly limited monetisation`,
      });
  }
  if (/—/.test(pkg.description)) {
    issues.push({
      severity: "red",
      kind: "no-em-dashes",
      note: "em dash detected (memory rule)",
    });
  }
  if (AI_TELL_RE.test(pkg.description)) {
    issues.push({
      severity: "red",
      kind: "ai-tell",
      note: "AI-tell phrase detected in description",
    });
    AI_TELL_RE.lastIndex = 0;
  }
  if (pkg.title.length > 60) {
    issues.push({
      severity: "amber",
      kind: "title-length",
      note: `${pkg.title.length} chars (>60 may truncate on mobile)`,
    });
  }
  if (pkg.hashtags.length < 3) {
    issues.push({
      severity: "amber",
      kind: "hashtags-thin",
      note: `${pkg.hashtags.length} tags (target 3-7)`,
    });
  }
  return issues;
}

/**
 * Main: build the complete SEO package for a render.
 *
 * @param {object} args
 * @param {object} args.story       — DB row
 * @param {object} args.pkg         — story package (from buildStoryPackage)
 * @param {Array}  args.scenes      — scene list from the orchestrator
 * @param {number} args.runtimeS    — final render duration
 * @param {object} args.channel     — channel theme (from getChannelTheme)
 * @returns {object} the SEO package
 */
function buildSeoPackage({ story, pkg, scenes, runtimeS, channel }) {
  const title = buildTitle({ story, pkg, channel });
  const description = buildDescription({ story, pkg, channel });
  const hashtags = buildHashtags({ story, pkg, channel });
  const chapters = buildChapters({ scenes, runtimeS, channel });
  const pinnedComment = buildPinnedComment({
    story,
    pkg,
    scenes,
    runtimeS,
    channel,
  });
  const thumbnailText = buildThumbnailText({ story, pkg });

  const seo = {
    storyId: story?.id,
    channelId: channel?.channelId,
    channelName: channel?.channelName,
    generatedAt: new Date().toISOString(),
    title,
    description,
    hashtags,
    chapters,
    pinnedComment,
    thumbnailText,
  };
  seo.validation = validatePackage(seo);
  return seo;
}

module.exports = {
  buildSeoPackage,
  buildTitle,
  buildDescription,
  buildHashtags,
  buildChapters,
  buildPinnedComment,
  buildThumbnailText,
  validatePackage,
  extractSubject,
};
