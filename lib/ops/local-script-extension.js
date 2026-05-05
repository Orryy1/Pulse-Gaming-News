"use strict";

const {
  classifyShortScriptRuntime,
  countSpokenWords,
  secondsPerWordForTtsProvider,
} = require("../services/short-runtime-planner");
const { classifyTextHygiene, normaliseText } = require("../text-hygiene");

const REQUIRED_CTA = "Follow Pulse Gaming so you never miss a beat.";
const LOW_VALUE_PERSONAL_TITLE_RE =
  /\b(even tho|my phone|i can[’']?t download you|you will always be on my)\b/i;

function firstText(story = {}) {
  return (
    story.tts_script ||
    story.full_script ||
    [story.hook, story.body, story.loop].filter(Boolean).join(" ") ||
    ""
  );
}

function stripRequiredCta(text) {
  return String(text || "")
    .replace(/follow pulse gaming so you never miss a beat\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function safeTitle(story = {}) {
  return normaliseText(story.title || "").replace(/\s+/g, " ").trim();
}

function sourceLabel(story = {}) {
  return (
    story.publisher ||
    story.source_name ||
    story.sourceName ||
    story.subreddit ||
    story.source_type ||
    "the source pack"
  );
}

function contextSentences(story = {}) {
  const title = safeTitle(story);
  const source = normaliseText(sourceLabel(story));
  const classification = normaliseText(
    story.content_pillar || story.classification || story.story_type || "gaming update",
  );
  const lines = [
    "Here is the useful bit: this is not just headline noise, it changes what players should watch next.",
    `The source context is ${source}, and the safest read is to stick to what has actually been reported.`,
    `The story angle is ${classification}, so Pulse should centre the consequence rather than padding it with speculation.`,
    "For players, the practical question is whether this affects what to buy, download, patch, preorder or ignore.",
    "The next signal to watch is official wording, because that is what separates a hot rumour from something worth acting on.",
    "If this story moves again, the follow-up should be a cleaner source breakdown with the exact quote, date and platform impact.",
    "That is why this belongs in the Flash lane only when the script stays sharp and the visuals can keep changing on every beat.",
  ];
  if (title) {
    lines.unshift(`The clean read on ${title} is simple: the headline matters only if it creates a real player consequence.`);
  }
  return lines;
}

function extendScriptToLocalFlash({
  story = {},
  queueItem = {},
  cleanText = (value) => value,
  env = process.env,
} = {}) {
  const raw = normaliseText(firstText(story));
  const existing = splitSentences(stripRequiredCta(raw));
  const minWords = Number(queueItem.runtime?.minWords || 0) || Math.ceil(61 / secondsPerWordForTtsProvider("local", env));
  const maxWords = Number(queueItem.runtime?.maxWords || 0) || Math.floor(75 / secondsPerWordForTtsProvider("local", env));
  const targetWords = Math.min(maxWords - 6, Math.max(minWords + 10, 232));
  const titleHygiene = classifyTextHygiene(story.title || "");
  const scriptHygiene = classifyTextHygiene(raw);

  const sentences = existing.length ? [...existing] : [safeTitle(story) || "A gaming update is moving fast today."];
  const extras = contextSentences(story);
  let extraIndex = 0;

  while (
    countSpokenWords(cleanText(`${sentences.join(" ")} ${REQUIRED_CTA}`)) < targetWords &&
    extraIndex < extras.length
  ) {
    sentences.push(extras[extraIndex]);
    extraIndex += 1;
  }

  let proposed = `${sentences.join(" ")} ${REQUIRED_CTA}`.replace(/\s+/g, " ").trim();
  let runtime = classifyShortScriptRuntime({
    text: cleanText(proposed),
    secondsPerWord: secondsPerWordForTtsProvider("local", env),
  });

  while (runtime.wordCount > maxWords && sentences.length > existing.length + 1) {
    sentences.pop();
    proposed = `${sentences.join(" ")} ${REQUIRED_CTA}`.replace(/\s+/g, " ").trim();
    runtime = classifyShortScriptRuntime({
      text: cleanText(proposed),
      secondsPerWord: secondsPerWordForTtsProvider("local", env),
    });
  }

  const ctaMatches = proposed.match(/follow pulse gaming so you never miss a beat/gi) || [];
  const manualReviewFlags = [];
  if (titleHygiene.severity !== "clean") manualReviewFlags.push(`title_hygiene_${titleHygiene.severity}`);
  if (scriptHygiene.severity === "fail") manualReviewFlags.push("script_hygiene_fail");
  if (LOW_VALUE_PERSONAL_TITLE_RE.test(story.title || "")) {
    manualReviewFlags.push("low_value_personal_post");
  }
  if (ctaMatches.length !== 1) manualReviewFlags.push("cta_not_exactly_once");
  if (runtime.result !== "pass") manualReviewFlags.push(`runtime_${runtime.result}`);

  return {
    story_id: story.id || queueItem.story_id || null,
    title: safeTitle(story),
    source: sourceLabel(story),
    action: runtime.result === "pass" && manualReviewFlags.length === 0
      ? "ready_for_local_liam_audio"
      : "review_extended_script",
    target_words: targetWords,
    original_words: queueItem.runtime?.wordCount || countSpokenWords(cleanText(raw)),
    proposed_words: runtime.wordCount,
    estimated_seconds: runtime.estimatedSeconds,
    proposed_full_script: proposed,
    runtime,
    cta_exactly_once: ctaMatches.length === 1,
    manual_review_flags: manualReviewFlags,
    hygiene: {
      title: titleHygiene,
      script: scriptHygiene,
    },
  };
}

function buildLocalScriptExtensionPlan({
  queueReport = {},
  storiesById = {},
  cleanText = (value) => value,
  env = process.env,
  limit = null,
  storyId = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const candidates = (queueReport.items || []).filter(
    (item) =>
      item.action === "extend_script_before_local_repair" &&
      (!storyId || item.story_id === storyId),
  );
  const selected =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? candidates.slice(0, Number(limit))
      : candidates;
  const drafts = selected.map((item) =>
    extendScriptToLocalFlash({
      story: storiesById[item.story_id] || { id: item.story_id, title: item.title },
      queueItem: item,
      cleanText,
      env,
    }),
  );
  const counts = drafts.reduce(
    (acc, draft) => {
      acc.total += 1;
      if (draft.action === "ready_for_local_liam_audio") acc.ready += 1;
      else acc.review += 1;
      return acc;
    },
    { total: 0, ready: 0, review: 0 },
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    dry_run: true,
    counts,
    drafts,
    safety: {
      local_only: true,
      dry_run_only: true,
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
    },
  };
}

function renderLocalScriptExtensionMarkdown(plan) {
  const lines = [];
  lines.push("# Local Flash Script Extension Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Counts: total=${plan.counts.total} ready=${plan.counts.ready} review=${plan.counts.review}`);
  lines.push("");
  lines.push("## Drafts");
  for (const draft of (plan.drafts || []).slice(0, 20)) {
    lines.push(
      `- ${draft.story_id}: ${draft.action} | ${draft.proposed_words} words | est=${draft.estimated_seconds}s | flags=${draft.manual_review_flags.join(", ") || "clear"} | ${draft.title}`,
    );
  }
  if (!plan.drafts?.length) lines.push("- none");
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local dry-run only.");
  lines.push("- Does not write story rows, tokens, Railway variables or social posts.");
  lines.push("- Drafts must still pass local Liam audio duration QA before render.");
  return lines.join("\n") + "\n";
}

function safeStoryId(id) {
  return String(id || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96);
}

async function applyLocalScriptExtensionAudio({
  plan = {},
  generateTts,
  measureDuration,
  outputRelDir = "test/output/local-script-extension/audio",
  limit = null,
} = {}) {
  if (typeof generateTts !== "function") {
    throw new Error("applyLocalScriptExtensionAudio requires a generateTts function");
  }
  const candidates = (plan.drafts || []).filter(
    (draft) => draft.action === "ready_for_local_liam_audio",
  );
  const selected =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? candidates.slice(0, Number(limit))
      : candidates;
  const applied = [];
  const skipped = [];

  for (const draft of selected) {
    if (!draft.proposed_full_script) {
      skipped.push({ story_id: draft.story_id, reason: "missing_script" });
      continue;
    }
    const outputRel = `${outputRelDir}/${safeStoryId(draft.story_id)}_liam_extended.mp3`;
    await generateTts(draft.proposed_full_script, outputRel, 1.0);
    const durationSeconds =
      typeof measureDuration === "function"
        ? await measureDuration(outputRel)
        : null;
    const durationVerdict =
      Number.isFinite(Number(durationSeconds)) &&
      Number(durationSeconds) >= 61 &&
      Number(durationSeconds) <= 75
        ? "pass"
        : Number.isFinite(Number(durationSeconds))
          ? "reject_duration"
          : "unknown";
    applied.push({
      story_id: draft.story_id,
      output_audio_path: outputRel,
      rate: 1.0,
      text_word_count: draft.proposed_words,
      estimated_seconds: draft.estimated_seconds,
      duration_seconds: durationSeconds,
      duration_verdict: durationVerdict,
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    applied,
    skipped,
    safety: {
      local_only: true,
      writes_under_output_dir: outputRelDir,
      mutates_media: true,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
    },
  };
}

module.exports = {
  REQUIRED_CTA,
  applyLocalScriptExtensionAudio,
  buildLocalScriptExtensionPlan,
  extendScriptToLocalFlash,
  renderLocalScriptExtensionMarkdown,
  stripRequiredCta,
};
