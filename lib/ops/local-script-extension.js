"use strict";

const path = require("node:path");

const {
  classifyShortScriptRuntime,
  countSpokenWords,
  secondsPerWordForTtsProvider,
} = require("../services/short-runtime-planner");
const {
  classifyLocalTtsProofFailure,
} = require("../studio/local-tts-failures");
const { classifyTextHygiene, normaliseText } = require("../text-hygiene");
const { runScriptCoherenceQa } = require("../script-coherence-qa");
const { lintScript } = require("../services/script-lint");
const {
  classifyLocalLiamSafety,
  unsafeVoiceSkip,
} = require("./local-liam-safety");
const {
  generateLocalTtsWithOptionalRecovery,
} = require("./local-tts-batch-recovery");
const { stampLocalVoiceTimestampMeta } = require("./local-voice-metadata");

const REQUIRED_CTA = "Follow Pulse Gaming so you never miss a beat.";
const DEFAULT_LOCAL_EXTENSION_TARGET_WORDS = 166;
const LOCAL_EXTENSION_TARGET_MIN_SECONDS = 64;
const LOCAL_EXTENSION_TARGET_MAX_SECONDS = 70;
const MAX_LOCAL_EXTENSION_SENTENCES = 4;
const PUBLIC_COPY_BLOCKERS = [
  {
    flag: "public_copy_blocked:decision_filter",
    re: /\bdecision filter\b/i,
  },
  {
    flag: "public_copy_blocked:generic_marketing_line",
    re: /\b(?:the useful take is not blind hype|marketing line|if the source is right|cleaner test|the headline is only the entry point|the real value is whether)\b/i,
  },
];
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

function publicCopyBlockerFlags(text = "") {
  return PUBLIC_COPY_BLOCKERS
    .filter((blocker) => blocker.re.test(String(text || "")))
    .map((blocker) => blocker.flag);
}

function sourceBoundRewriteBlockerType(flags = []) {
  if (flags.some((flag) => String(flag).startsWith("public_copy_blocked:"))) {
    return "public_copy_blocked";
  }
  if (flags.includes("insufficient_story_specific_extension_material")) {
    return "insufficient_story_specific_extension_material";
  }
  if (flags.some((flag) => /^runtime_|^script_lint:script_too_(?:short|long)/.test(String(flag)))) {
    return "script_runtime_repair";
  }
  if (flags.some((flag) => /^script_coherence:/.test(String(flag)))) {
    return "script_coherence_repair";
  }
  return "script_review_required";
}

function buildSourceBoundRewriteWorkOrder(story = {}, flags = []) {
  if (!story.id && !story.story_id) return null;
  const storyId = safeStoryId(story.id || story.story_id);
  return {
    story_id: storyId,
    blocker_type: sourceBoundRewriteBlockerType(flags),
    repair_lane: "source_bound_script_rewrite",
    exact_missing_input: [
      "creator-native source-bound public script",
      "64-70 second local Liam-safe narration text",
      "fresh audio and timestamp proof after rewrite approval",
    ],
    blocking_flags: [...new Set(flags.map(String).filter(Boolean))],
    recommended_command:
      `npm run ops:reprocess-script-failures -- --story-id ${storyId} --force-story --source-bound-only --dry-run --json`,
    expected_output: "test/output/script_failure_reprocess.json",
    db_mutation_required: false,
    db_mutation_status: "dry_run_only",
    operator_approval_required: true,
    operator_approval_status: "required_before_apply_or_audio",
    post_repair_validation_command:
      `npm run ops:local-script-extension -- --story-id ${storyId} --dry-run`,
  };
}

function contextSentences(story = {}) {
  return [
    "The next beat is practical: price, timing, platform or patch impact.",
    "Keep unsupported claims out of the public line.",
    "If an official listing, patch note or platform page changes the picture, that becomes the next update.",
    "The strongest angle is the concrete consequence, not vague excitement around the headline.",
    "That keeps the short focused on the thing players can actually act on today.",
    "The decision point is whether this changes what deserves attention right now.",
  ];
}

function compactContextSentences() {
  return [
    "That is the audience consequence.",
    "Lead with the named detail.",
    "Speculation stays out.",
    "Unknowns stay off the headline.",
    "The choice point is clear.",
    "Put the consequence first.",
  ];
}

function chooseExtensionSentence({
  sentences = [],
  extras = [],
  compactExtras = [],
  extraIndex = 0,
  currentWords = 0,
  minWords = 0,
  maxWords = 0,
  targetWords = 0,
  cleanText = (value) => value,
} = {}) {
  const used = new Set(sentences.map((sentence) => String(sentence || "").trim()).filter(Boolean));
  const closeToMinimum = currentWords >= minWords - 30;
  const ordered = [];
  const pushCandidate = (sentence, source, index = null) => {
    const cleanSentence = String(sentence || "").trim();
    if (!cleanSentence || used.has(cleanSentence)) return;
    ordered.push({ sentence: cleanSentence, source, index });
  };

  const remainingExtras = extras.slice(extraIndex);
  if (closeToMinimum) {
    compactExtras.forEach((sentence, index) => pushCandidate(sentence, "compact", index));
    remainingExtras.forEach((sentence, offset) => pushCandidate(sentence, "context", extraIndex + offset));
  } else {
    if (extras[extraIndex]) pushCandidate(extras[extraIndex], "context", extraIndex);
    compactExtras.forEach((sentence, index) => pushCandidate(sentence, "compact", index));
    remainingExtras.slice(1).forEach((sentence, offset) =>
      pushCandidate(sentence, "context", extraIndex + offset + 1),
    );
  }

  const scored = ordered
    .map((candidate) => ({
      ...candidate,
      words: countSpokenWords(cleanText(`${sentences.concat(candidate.sentence).join(" ")} ${REQUIRED_CTA}`)),
    }))
    .filter((candidate) => candidate.words <= maxWords);

  if (closeToMinimum) {
    const compact = scored
      .filter((candidate) => candidate.source === "compact")
      .sort((a, b) => {
        const aGap = Math.max(0, minWords - a.words);
        const bGap = Math.max(0, minWords - b.words);
        return aGap - bGap || a.words - b.words;
      })[0];
    if (compact) return compact;
  }

  const preferred = scored
    .filter((candidate) => candidate.words >= minWords && candidate.words <= targetWords + 6)
    .sort((a, b) => Math.abs(targetWords - a.words) - Math.abs(targetWords - b.words) || a.words - b.words)[0];
  if (preferred) return preferred;

  if (currentWords < minWords) {
    return scored
      .sort((a, b) => {
        const aOvershoot = Math.max(0, a.words - (targetWords + 6));
        const bOvershoot = Math.max(0, b.words - (targetWords + 6));
        return aOvershoot - bOvershoot || Math.abs(targetWords - a.words) - Math.abs(targetWords - b.words);
      })[0] || null;
  }

  return null;
}

function extendScriptToLocalFlash({
  story = {},
  queueItem = {},
  cleanText = (value) => value,
  env = process.env,
} = {}) {
  const raw = normaliseText(firstText(story));
  const existing = splitSentences(stripRequiredCta(raw));
  const missingBaseScript = raw.length === 0 || existing.length === 0;
  const localSecondsPerWord = secondsPerWordForTtsProvider("local", env);
  // Repair queue rows can carry stale word budgets from an older voice
  // calibration. Recompute the Liam budget here so the proof generator
  // does not under-target 61s+ audio after a calibration update.
  const minWords = Math.ceil(61 / localSecondsPerWord);
  const maxWords = Math.floor(75 / localSecondsPerWord);
  const targetMinWords = Math.ceil(LOCAL_EXTENSION_TARGET_MIN_SECONDS / localSecondsPerWord);
  const targetMaxWords = Math.min(
    Math.floor(LOCAL_EXTENSION_TARGET_MAX_SECONDS / localSecondsPerWord),
    maxWords,
  );
  const configuredTarget = Number(env.LOCAL_SCRIPT_EXTENSION_TARGET_WORDS);
  const preferredTarget =
    Number.isFinite(configuredTarget) && configuredTarget > 0
      ? configuredTarget
      : DEFAULT_LOCAL_EXTENSION_TARGET_WORDS;
  const targetWords =
    targetMaxWords >= targetMinWords
      ? Math.min(Math.max(preferredTarget, targetMinWords), targetMaxWords)
      : Math.min(Math.max(minWords, preferredTarget), maxWords);
  const titleHygiene = classifyTextHygiene(story.title || "");
  const scriptHygiene = classifyTextHygiene(raw);

  const sentences = existing.length ? [...existing] : [];
  const extras = contextSentences(story);
  const compactExtras = compactContextSentences(story);
  let extraIndex = 0;
  let extensionSentencesAdded = 0;

  while (
    countSpokenWords(cleanText(`${sentences.join(" ")} ${REQUIRED_CTA}`)) < targetWords &&
    extraIndex < extras.length &&
    extensionSentencesAdded < MAX_LOCAL_EXTENSION_SENTENCES
  ) {
    const currentWords = countSpokenWords(cleanText(`${sentences.join(" ")} ${REQUIRED_CTA}`));
    const chosen = chooseExtensionSentence({
      sentences,
      extras,
      compactExtras,
      extraIndex,
      currentWords,
      minWords: targetMinWords,
      maxWords,
      targetWords,
      cleanText,
    });
    if (!chosen) {
      break;
    }
    sentences.push(chosen.sentence);
    extensionSentencesAdded += 1;
    if (chosen.source === "context" && chosen.index === extraIndex) {
      extraIndex += 1;
    }
  }

  let proposed = `${sentences.join(" ")} ${REQUIRED_CTA}`.replace(/\s+/g, " ").trim();
  let runtime = classifyShortScriptRuntime({
    text: cleanText(proposed),
    secondsPerWord: localSecondsPerWord,
  });

  while (runtime.wordCount > maxWords && sentences.length > existing.length + 1) {
    sentences.pop();
    proposed = `${sentences.join(" ")} ${REQUIRED_CTA}`.replace(/\s+/g, " ").trim();
    runtime = classifyShortScriptRuntime({
      text: cleanText(proposed),
      secondsPerWord: localSecondsPerWord,
    });
  }

  const ctaMatches = proposed.match(/follow pulse gaming so you never miss a beat/gi) || [];
  const manualReviewFlags = [];
  const coherenceQa = runScriptCoherenceQa(
    {
      ...story,
      cta: story.cta || REQUIRED_CTA,
      full_script: proposed,
      tts_script: proposed,
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  const scriptLint = lintScript(proposed, {
    minWords,
    maxWords,
  });
  if (missingBaseScript) manualReviewFlags.push("missing_base_script");
  if (titleHygiene.severity !== "clean") manualReviewFlags.push(`title_hygiene_${titleHygiene.severity}`);
  if (scriptHygiene.severity === "fail") manualReviewFlags.push("script_hygiene_fail");
  if (
    extensionSentencesAdded >= MAX_LOCAL_EXTENSION_SENTENCES &&
    runtime.wordCount < minWords
  ) {
    manualReviewFlags.push("insufficient_story_specific_extension_material");
  }
  if (LOW_VALUE_PERSONAL_TITLE_RE.test(story.title || "")) {
    manualReviewFlags.push("low_value_personal_post");
  }
  if (ctaMatches.length !== 1) manualReviewFlags.push("cta_not_exactly_once");
  if (runtime.result !== "pass") manualReviewFlags.push(`runtime_${runtime.result}`);
  if (coherenceQa.result === "fail") {
    manualReviewFlags.push(...coherenceQa.failures);
  }
  if (scriptLint.result === "fail") {
    manualReviewFlags.push(...scriptLint.failures.map((failure) => `script_lint:${failure}`));
  }
  for (const flag of publicCopyBlockerFlags(proposed)) {
    if (!manualReviewFlags.includes(flag)) manualReviewFlags.push(flag);
  }

  const action =
    runtime.result === "pass" && manualReviewFlags.length === 0
      ? "ready_for_local_liam_audio"
      : "review_extended_script";
  const sourceBoundRewriteWorkOrder =
    action === "review_extended_script"
      ? buildSourceBoundRewriteWorkOrder(story, manualReviewFlags)
      : null;

  return {
    story_id: story.id || queueItem.story_id || null,
    title: safeTitle(story),
    source: sourceLabel(story),
    action,
    target_seconds: [LOCAL_EXTENSION_TARGET_MIN_SECONDS, LOCAL_EXTENSION_TARGET_MAX_SECONDS],
    target_word_range: {
      min: targetMinWords,
      max: targetMaxWords,
    },
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
    base_script_present: !missingBaseScript,
    script_coherence: coherenceQa,
    script_lint: scriptLint,
    ...(sourceBoundRewriteWorkOrder
      ? { source_bound_rewrite_work_order: sourceBoundRewriteWorkOrder }
      : {}),
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
  let candidates = (queueReport.items || []).filter(
    (item) =>
      item.action === "extend_script_before_local_repair" &&
      (!storyId || item.story_id === storyId),
  );
  if (storyId && candidates.length === 0 && storiesById[storyId]) {
    const story = storiesById[storyId];
    const raw = firstText(story);
    candidates = [
      {
        story_id: storyId,
        title: story.title || storyId,
        action: "extend_script_before_local_repair",
        source: "explicit_story_recovery",
        runtime: {
          wordCount: countSpokenWords(cleanText(raw)),
        },
      },
    ];
  }
  const selected =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? candidates.slice(0, Number(limit))
      : candidates;
  const drafts = [];
  const skipped = [];
  for (const item of selected) {
    try {
      drafts.push(
        extendScriptToLocalFlash({
          story: storiesById[item.story_id] || { id: item.story_id, title: item.title },
          queueItem: item,
          cleanText,
          env,
        }),
      );
    } catch (err) {
      skipped.push({
        story_id: item.story_id || null,
        reason: "script_extension_planning_failed",
        failure_code: "script_extension_planning_failed",
        error: safeErrorMessage(err),
      });
    }
  }
  const counts = drafts.reduce(
    (acc, draft) => {
      if (draft.action === "ready_for_local_liam_audio") acc.ready += 1;
      else acc.review += 1;
      if (draft.source_bound_rewrite_work_order) acc.source_bound_rewrite_work_orders += 1;
      return acc;
    },
    {
      total: selected.length,
      ready: 0,
      review: 0,
      failed: skipped.length,
      source_bound_rewrite_work_orders: 0,
    },
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    dry_run: true,
    local_tts: queueReport.local_tts || null,
    counts,
    drafts,
    skipped,
    failure_counts: countFailureCodes({ skipped }),
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
    if (draft.source_bound_rewrite_work_order?.recommended_command) {
      lines.push(
        `  Source-bound rewrite: \`${draft.source_bound_rewrite_work_order.recommended_command}\``,
      );
    }
  }
  if (!plan.drafts?.length) lines.push("- none");
  if (plan.skipped?.length) {
    lines.push("");
    lines.push("## Skipped");
    for (const item of plan.skipped) {
      lines.push(`- ${item.story_id}: ${item.failure_code || item.reason}${item.error ? ` (${item.error})` : ""}`);
    }
  }
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

function safeErrorMessage(err) {
  return String(err?.message || err || "unknown_error")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function countFailureCodes({ applied = [], skipped = [] } = {}) {
  const counts = {};
  for (const item of [...applied, ...skipped]) {
    if (!item.failure_code) continue;
    counts[item.failure_code] = (counts[item.failure_code] || 0) + 1;
  }
  return counts;
}

function wordsPerMinute(wordCount, durationSeconds) {
  const words = Number(wordCount);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(words) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((words / duration) * 60);
}

function assertTestOutputDir(outputRelDir) {
  const raw = String(outputRelDir || "");
  const normalised = raw.replace(/\\/g, "/");
  const repoTestOutput = path.resolve(process.cwd(), "test", "output");
  const resolved = path.resolve(raw);
  const relativeTestOutput = !path.isAbsolute(raw) && /^test\/output(?:\/|$)/i.test(normalised);
  const absoluteTestOutput =
    path.isAbsolute(raw) &&
    (resolved === repoTestOutput || resolved.startsWith(`${repoTestOutput}${path.sep}`));
  if (!relativeTestOutput && !absoluteTestOutput) {
    throw new Error("local proof audio output must stay under test/output");
  }
}

async function applyLocalScriptExtensionAudio({
  plan = {},
  generateTts,
  measureDuration,
  acousticProbe = null,
  outputRelDir = "test/output/local-script-extension/audio",
  limit = null,
  localTts = null,
  recoverLocalTts = null,
} = {}) {
  if (typeof generateTts !== "function") {
    throw new Error("applyLocalScriptExtensionAudio requires a generateTts function");
  }
  assertTestOutputDir(outputRelDir);
  const candidates = (plan.drafts || []).filter(
    (draft) => draft.action === "ready_for_local_liam_audio",
  );
  const selected =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? candidates.slice(0, Number(limit))
      : candidates;
  const applied = [];
  const skipped = [];
  const localVoiceSafety = classifyLocalLiamSafety(localTts || plan.local_tts || {});

  for (const draft of selected) {
    if (localVoiceSafety.safe !== true) {
      skipped.push(unsafeVoiceSkip(draft.story_id, localVoiceSafety));
      continue;
    }
    if (!draft.proposed_full_script) {
      skipped.push({ story_id: draft.story_id, reason: "missing_script" });
      continue;
    }
    const outputRel = `${outputRelDir}/${safeStoryId(draft.story_id)}_liam_extended.mp3`;
    const ttsAttempt = await generateLocalTtsWithOptionalRecovery({
      storyId: draft.story_id,
      text: draft.proposed_full_script,
      outputRel,
      rate: 1.0,
      generateTts,
      recoverLocalTts,
    });
    if (!ttsAttempt.ok) {
      const failure = ttsAttempt.failure || {};
      skipped.push({
        story_id: draft.story_id,
        reason: "generate_tts_failed",
        failure_code: failure.code,
        server_reset_recorded: failure.requires_server_reset === true,
        attempts: ttsAttempt.attempts,
        server_recovery: ttsAttempt.recovery || null,
        error: ttsAttempt.error,
      });
      continue;
    }
    let voiceMeta;
    try {
      voiceMeta = await stampLocalVoiceTimestampMeta({
        outputAudioPath: outputRel,
        text: draft.proposed_full_script,
        rate: 1.0,
        acousticProbe,
      });
    } catch (err) {
      voiceMeta = {
        stamped: false,
        reason: `timestamps_error:${safeErrorMessage(err)}`,
      };
    }
    let durationSeconds = null;
    let durationMeasureError = null;
    if (typeof measureDuration === "function") {
      try {
        durationSeconds = await measureDuration(outputRel);
      } catch (err) {
        durationMeasureError = safeErrorMessage(err);
      }
    }
    const hasDuration =
      durationSeconds !== null && durationSeconds !== undefined && durationSeconds !== "";
    const numericDuration = Number(durationSeconds);
    const durationVerdict =
      hasDuration &&
      Number.isFinite(numericDuration) &&
      numericDuration >= 61 &&
      numericDuration <= 75
        ? "pass"
        : hasDuration && Number.isFinite(numericDuration)
          ? "reject_duration"
          : "unknown";
    const proofFailure = classifyLocalTtsProofFailure({
      durationSeconds,
      timestampsStamped: voiceMeta.stamped === true,
      localVoiceReference: voiceMeta.local_voice_reference || null,
      acoustic: voiceMeta.acoustic || null,
      transcript: voiceMeta.transcript || draft.proposed_full_script,
      wordCount: draft.proposed_words,
    });
    const wpm = wordsPerMinute(draft.proposed_words, durationSeconds);
    applied.push({
      story_id: draft.story_id,
      output_audio_path: outputRel,
      rate: 1.0,
      tts_attempts: ttsAttempt.attempts,
      server_recovery: ttsAttempt.recovery || null,
      text_word_count: draft.proposed_words,
      estimated_seconds: draft.estimated_seconds,
      duration_seconds: durationSeconds,
      duration_verdict: durationVerdict,
      failure_code: proofFailure.code,
      failure_message: proofFailure.code ? proofFailure.message : null,
      duration_measure_error: durationMeasureError,
      acoustic: voiceMeta.acoustic || null,
      transcript: voiceMeta.transcript || null,
      spoken_outro_present: voiceMeta.spoken_outro_present === true,
      wpm,
      local_pace: {
        wpm,
        min_wpm: 130,
        max_wpm: 220,
        verdict: proofFailure.code === "spoken_pace_too_slow" || proofFailure.code === "spoken_pace_too_fast"
          ? proofFailure.code
          : wpm === null
            ? "unknown"
            : "pass",
      },
      local_voice_reference: voiceMeta.local_voice_reference || null,
      local_voice_metadata: voiceMeta.stamped
        ? "stamped"
        : `not_stamped:${voiceMeta.reason || "unknown"}`,
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    applied,
    skipped,
    failure_counts: countFailureCodes({ applied, skipped }),
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
  DEFAULT_LOCAL_EXTENSION_TARGET_WORDS,
  LOCAL_EXTENSION_TARGET_MIN_SECONDS,
  LOCAL_EXTENSION_TARGET_MAX_SECONDS,
  REQUIRED_CTA,
  applyLocalScriptExtensionAudio,
  buildLocalScriptExtensionPlan,
  extendScriptToLocalFlash,
  renderLocalScriptExtensionMarkdown,
  stripRequiredCta,
};
