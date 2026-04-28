#!/usr/bin/env node
"use strict";

/**
 * tools/intelligence/run-comment-digest.js — Session 3 prototype.
 *
 * Read fixture comments, classify them, build the reply queue
 * (drafts only — never sent), and write artefacts under
 * test/output/comment-digest/.
 *
 * Read-only with respect to YouTube. Never replies, likes, hearts
 * or moderates.
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output", "comment-digest");

const { buildCommentIngestClient } = require(
  path.join(ROOT, "lib", "intelligence", "comment-ingest"),
);
const { classifyMany, summariseVerdicts } = require(
  path.join(ROOT, "lib", "intelligence", "comment-classifier"),
);
const { buildReplyQueue } = require(
  path.join(ROOT, "lib", "intelligence", "reply-drafter"),
);

function viewerSignals(verdicts) {
  // Surface anything operators should act on outside replies.
  const corrections = [];
  const topicSuggestions = [];
  const usefulCriticism = [];
  const moderationFlags = [];
  for (const entry of verdicts) {
    const v = entry.verdict;
    const text = entry.comment?.textOriginal || entry.comment?.text || "";
    if (v.category === "correction")
      corrections.push({ text, comment_id: entry.comment?.id });
    else if (v.category === "topic_suggestion")
      topicSuggestions.push({ text, comment_id: entry.comment?.id });
    else if (v.category === "useful_criticism")
      usefulCriticism.push({ text, comment_id: entry.comment?.id });
    else if (v.decision === "moderation_review")
      moderationFlags.push({
        text,
        comment_id: entry.comment?.id,
        reasons: v.reasons,
      });
  }
  return { corrections, topicSuggestions, usefulCriticism, moderationFlags };
}

function renderCommentDigestMarkdown({ summary, signals, queue }) {
  const lines = [];
  lines.push("# Pulse Gaming — Comment Digest (FIXTURE)");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(`- total: ${summary.total}`);
  for (const [k, v] of Object.entries(summary.counts)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## Decisions");
  lines.push("");
  for (const [k, v] of Object.entries(summary.decisions)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## Reply queue (DRAFTS — never sent)");
  lines.push("");
  if (queue.length === 0) {
    lines.push("- empty for this window");
  }
  for (const entry of queue) {
    lines.push(
      `### ${entry.comment_id || "(no id)"} on ${entry.video_id || "(no video)"}`,
    );
    lines.push("");
    lines.push(`> ${entry.original_text}`);
    lines.push("");
    lines.push(`Suggested draft (operator must review):`);
    lines.push("");
    lines.push(`> ${entry.draft.text}`);
    lines.push("");
    lines.push("- is_draft: true");
    lines.push("- auto_send: false");
    lines.push("");
  }
  lines.push("## Viewer signals (informational only)");
  lines.push("");
  lines.push("### Corrections");
  for (const s of signals.corrections)
    lines.push(`- ${s.comment_id}: ${s.text}`);
  if (signals.corrections.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("### Topic suggestions");
  for (const s of signals.topicSuggestions)
    lines.push(`- ${s.comment_id}: ${s.text}`);
  if (signals.topicSuggestions.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("### Useful criticism");
  for (const s of signals.usefulCriticism)
    lines.push(`- ${s.comment_id}: ${s.text}`);
  if (signals.usefulCriticism.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("### Moderation flags");
  for (const s of signals.moderationFlags)
    lines.push(`- ${s.comment_id} [${s.reasons.join(",")}]: ${s.text}`);
  if (signals.moderationFlags.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push(
    "- replies, likes, hearts and moderation actions are NOT triggered by this tool",
  );
  lines.push(
    "- every reply in the queue is a draft and requires operator review",
  );
  lines.push("- moderation flags require an operator to read and decide");
  return lines.join("\n") + "\n";
}

async function main() {
  await fs.ensureDir(OUT_DIR);
  const client = await buildCommentIngestClient({ mode: "fixture" });
  const all = await client.listForVideo(null);
  const verdicts = classifyMany(all);
  const summary = summariseVerdicts(verdicts);
  const queue = buildReplyQueue(verdicts);
  const signals = viewerSignals(verdicts);

  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `comments-${date}.json`);
  const queuePath = path.join(OUT_DIR, `reply-queue-${date}.json`);
  const summaryPath = path.join(OUT_DIR, `viewer-signals-${date}.json`);
  const mdPath = path.join(OUT_DIR, `comments-${date}.md`);

  await fs.writeFile(jsonPath, JSON.stringify({ summary, verdicts }, null, 2));
  await fs.writeFile(queuePath, JSON.stringify(queue, null, 2));
  await fs.writeFile(summaryPath, JSON.stringify(signals, null, 2));
  await fs.writeFile(
    mdPath,
    renderCommentDigestMarkdown({ summary, signals, queue }),
  );

  return {
    total: summary.total,
    queue: queue.length,
    moderation: signals.moderationFlags.length,
    suggestions: signals.topicSuggestions.length,
    corrections: signals.corrections.length,
    artefacts: {
      json: path.relative(ROOT, jsonPath),
      queue: path.relative(ROOT, queuePath),
      signals: path.relative(ROOT, summaryPath),
      md: path.relative(ROOT, mdPath),
    },
  };
}

if (require.main === module) {
  main()
    .then((r) => {
      console.log(
        `[comment-digest] total=${r.total} queue=${r.queue} moderation=${r.moderation} suggestions=${r.suggestions} corrections=${r.corrections}`,
      );
      for (const [k, v] of Object.entries(r.artefacts)) {
        console.log(`  ${k}: ${v}`);
      }
    })
    .catch((err) => {
      console.error(`[comment-digest] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main };
