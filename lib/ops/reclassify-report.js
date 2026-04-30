"use strict";

/**
 * lib/ops/reclassify-report.js
 *
 * Per the 2026-04-29 forensic audit (P0 #5): existing local story
 * stores still contain off-brand or weakly relevant items, even
 * though newer topicality + visual gates are present. Operators
 * need a read-only report listing which stories should be
 * quarantined — never a mutation.
 *
 * This module re-runs:
 *   - lib/topicality-gate.evaluatePulseGamingTopicality
 *   - lib/text-hygiene.classifyTextHygiene over title/script
 *   - distinct_visual_count check
 * over every story in the canonical store, and produces a structured
 * report:
 *
 *   {
 *     scanned: number,
 *     quarantine_candidates: [
 *       { id, title, reasons: [...], topicality_decision, severity }
 *     ],
 *     summary: {
 *       reject_topicality: number,
 *       review_topicality: number,
 *       text_hygiene_fail: number,
 *       zero_visuals: number,
 *     },
 *     generated_at: ISOString,
 *   }
 *
 * Pure read-only. Caller writes Markdown / posts to Discord — this
 * module does not touch the DB.
 */

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

const QUARANTINE_REASONS = {
  topicality_reject: "topicality_reject",
  topicality_review: "topicality_review",
  text_hygiene_fail: "text_hygiene_fail",
  zero_visuals: "zero_visuals_used_composite",
  legacy_no_metadata: "legacy_no_metadata",
};

/**
 * Evaluate one story. Returns null when the story passes all gates,
 * else returns a quarantine-candidate row.
 */
function evaluateStoryForQuarantine(story, deps = {}) {
  const topicality =
    deps.topicalityFn ||
    (() => ({ decision: "auto", reasons: [], confidence: 1 }));
  const hygiene = deps.hygieneFn || (() => ({ severity: "clean", issues: [] }));
  const reasons = [];

  if (!story || typeof story !== "object") return null;

  // 1. Topicality
  let topVerdict;
  try {
    topVerdict = topicality(story, { channelId: story.channel_id });
  } catch {
    topVerdict = { decision: "review", reasons: ["evaluation_error"] };
  }
  if (topVerdict.decision === "reject") {
    reasons.push(QUARANTINE_REASONS.topicality_reject);
  } else if (topVerdict.decision === "review") {
    reasons.push(QUARANTINE_REASONS.topicality_review);
  }

  // 2. Text hygiene over public-facing fields
  const fields = [
    ["title", story.title],
    ["full_script", story.full_script],
    ["tts_script", story.tts_script],
  ];
  for (const [name, value] of fields) {
    if (typeof value !== "string" || value.length === 0) continue;
    let v;
    try {
      v = hygiene(value);
    } catch {
      continue;
    }
    if (v.severity === "fail") {
      reasons.push(`${QUARANTINE_REASONS.text_hygiene_fail}:${name}`);
      break; // one is enough — don't spam reasons
    }
  }

  // 3. Visual count
  const vc =
    typeof story.distinct_visual_count === "number"
      ? story.distinct_visual_count
      : typeof story.qa_visual_count === "number"
        ? story.qa_visual_count
        : null;
  if (vc === 0) {
    reasons.push(QUARANTINE_REASONS.zero_visuals);
  }

  if (reasons.length === 0) return null;

  // Severity: any "reject" or "fail" makes it severe; review-only is mild.
  const severe = reasons.some(
    (r) =>
      r.startsWith(QUARANTINE_REASONS.topicality_reject) ||
      r.startsWith(QUARANTINE_REASONS.text_hygiene_fail) ||
      r.startsWith(QUARANTINE_REASONS.zero_visuals),
  );

  return {
    id: story.id,
    title: (story.title || "").slice(0, 120),
    flair: story.flair || null,
    source_type: story.source_type || null,
    reasons,
    topicality_decision: topVerdict.decision,
    severity: severe ? "high" : "review",
    has_been_published: !!(
      story.youtube_post_id ||
      story.tiktok_post_id ||
      story.instagram_media_id ||
      story.facebook_post_id
    ),
  };
}

async function buildReclassifyReport({
  db = require("../db"),
  topicality = null,
  hygiene = null,
} = {}) {
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch {
    stories = [];
  }

  const topicalityFn =
    topicality ||
    (() => {
      const m = safeRequire("../topicality-gate");
      return m && typeof m.evaluatePulseGamingTopicality === "function"
        ? m.evaluatePulseGamingTopicality
        : () => ({ decision: "auto", reasons: [] });
    })();

  const hygieneFn =
    hygiene ||
    (() => {
      const m = safeRequire("../text-hygiene");
      return m && typeof m.classifyTextHygiene === "function"
        ? m.classifyTextHygiene
        : () => ({ severity: "clean", issues: [] });
    })();

  const candidates = [];
  for (const s of stories) {
    const v = evaluateStoryForQuarantine(s, {
      topicalityFn,
      hygieneFn,
    });
    if (v) candidates.push(v);
  }

  const summary = {
    reject_topicality: 0,
    review_topicality: 0,
    text_hygiene_fail: 0,
    zero_visuals: 0,
    already_published: 0,
  };
  for (const c of candidates) {
    if (c.reasons.some((r) => r === QUARANTINE_REASONS.topicality_reject)) {
      summary.reject_topicality++;
    }
    if (c.reasons.some((r) => r === QUARANTINE_REASONS.topicality_review)) {
      summary.review_topicality++;
    }
    if (
      c.reasons.some((r) => r.startsWith(QUARANTINE_REASONS.text_hygiene_fail))
    ) {
      summary.text_hygiene_fail++;
    }
    if (c.reasons.some((r) => r === QUARANTINE_REASONS.zero_visuals)) {
      summary.zero_visuals++;
    }
    if (c.has_been_published) summary.already_published++;
  }

  return {
    scanned: stories.length,
    quarantine_candidates: candidates,
    summary,
    generated_at: new Date().toISOString(),
  };
}

function formatReclassifyMarkdown(report) {
  if (!report) return "";
  const lines = [];
  lines.push("**Pulse Gaming — Reclassification Report**");
  lines.push(
    `Scanned: ${report.scanned} | Quarantine candidates: ${report.quarantine_candidates.length}`,
  );
  lines.push("");
  lines.push(`Reject (topicality):       ${report.summary.reject_topicality}`);
  lines.push(`Review (topicality):       ${report.summary.review_topicality}`);
  lines.push(`Text hygiene fails:        ${report.summary.text_hygiene_fail}`);
  lines.push(`Zero-visual renders:       ${report.summary.zero_visuals}`);
  lines.push(`Already published rows:    ${report.summary.already_published}`);
  if (report.quarantine_candidates.length === 0) {
    lines.push("");
    lines.push("No quarantine candidates. Store looks clean.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("**Top candidates** (by severity, capped at 20)");
  const sorted = [...report.quarantine_candidates].sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "high" ? -1 : 1;
    }
    return 0;
  });
  for (const c of sorted.slice(0, 20)) {
    const marker = c.severity === "high" ? "🔴" : "🟡";
    const pubBit = c.has_been_published ? " (already published)" : "";
    lines.push(
      `${marker} ${c.id}${pubBit} — ${c.title}\n    reasons: ${c.reasons.join(", ")}`,
    );
  }
  return lines.join("\n");
}

module.exports = {
  buildReclassifyReport,
  evaluateStoryForQuarantine,
  formatReclassifyMarkdown,
  QUARANTINE_REASONS,
};
