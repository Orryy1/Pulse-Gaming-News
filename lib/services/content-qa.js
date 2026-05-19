/**
 * lib/services/content-qa.js — first-pass creative QA gate.
 *
 * Runs against a story + its on-disk artefacts JUST before publish.
 * Catches the obvious "should not publish" cases (missing MP4,
 * tiny MP4, missing script, glued caption tokens) and surfaces
 * softer problems as warnings so the operator sees them in the
 * Discord summary without blocking the upload.
 *
 * Intentionally conservative: the default hard-fail list is small
 * and high-signal (only things that unambiguously produce a broken
 * public post). Everything else is a warn — the publisher records
 * the warn list but does NOT skip the upload. False positives on
 * hard-fail would silently stop the daily cycle; false positives
 * on warn only add noise to Discord.
 *
 * Pure / sync-where-possible so the unit tests don't need a real
 * filesystem unless they're specifically testing the MP4 stat path.
 */

const fsExtra = require("fs-extra");
const mediaPaths = require("../media-paths");
const { classifyShortDuration } = require("./short-duration-contract");
const { runScriptCoherenceQa } = require("../script-coherence-qa");
const {
  shouldRejectGeneralRedditForNews,
} = require("../community-discussion-gate");
const {
  runPublicOutputCoherenceGate,
} = require("../public-output-manifest");

const DEFAULT_MIN_MP4_BYTES = 200 * 1024; // 200 KB — anything below
// this is a render-failed placeholder, not a real 50s Short.
const DEFAULT_MIN_WORDS = 80;
const DEFAULT_MAX_WORDS = 220;

// Fuzzy "AI wrote this" tells. Conservative — each entry must be
// specific enough that a legitimate script would never include it.
// Adding here is NOT the same as adding a demonetisation / policy
// word (those live in the existing processor check).
const BANNED_STOCK_PHRASES = [
  /let me know in the comments/i,
  /don'?t forget to (?:smash|hit|click) (?:the|that) like/i,
  /(?:hey|hi),?\s+guys,?\s+welcome back/i,
  /in this video,? i('ll| will)/i,
  /buckle up,? folks/i,
  /today,? we('re| are) going to/i,
];

const UNSUPPORTED_SOURCE_CLAIM_RE =
  /\b(?:industry insiders|insiders|sources?)\s+(?:say|claim|suggest|report|indicate|believe|tell)\b|\b(?:reportedly|allegedly)\b/i;
const SCRIPT_VALIDATION_FAILURE_RE =
  /script validation failed|script_validation_failed|script_review:|manual review required before production/i;

function isGeneralRedditSource(story) {
  const sourceType = String(story?.source_type || "").toLowerCase();
  if (sourceType !== "reddit") return false;
  const subreddit = String(story?.subreddit || story?.source_name || "")
    .toLowerCase()
    .replace(/^r\//, "");
  return subreddit !== "gamingleaksandrumours";
}

// Glued sentence boundary: lowercase letter, period, uppercase letter
// with no space. e.g. "the game.Players rushed in" — a common TTS
// artefact in pre-2026-04 scripts that slipped through to captions.
const GLUED_SENTENCE_RE = /[a-z]\.[A-Z]/;

// AI time-formatting tell: "12:15 PM" / "1:30 am". British-English
// house style uses "12.15pm" or "midday". Not a hard-fail, just a
// tell to warn on.
const AMERICAN_TIME_RE = /\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)\b/;

// Minimum entity overlays expected if any names were extracted.
// Only a warn; missing overlays is a soft quality hit, not a
// publish blocker.
const MIN_ENTITY_OVERLAY_COVERAGE = 0.5; // 50% of detected entities
// should end up with an image.

// Visual-inventory gate (2026-04-29). The renderer's stamp
// (assemble.js: story.qa_visual_count, qa_visual_warning) makes
// the upstream image-pipeline failures observable per-story. This
// gate adds the publish-time check: when the count is below the
// minimum AND the operator hasn't flipped the env flag on, we
// surface a warning. When BLOCK_THIN_VISUALS=true is set in
// Railway env, the same condition becomes a hard failure that
// causes publishNextStory to skip the candidate (qa_skipped:
// thin_visuals_blocked) and try the next one in the candidate
// queue. The story can opt out per-row via allow_thin_visuals=true
// for the eventual breaking-news single-image template; today
// nothing sets that field so no story bypasses.
const MIN_DISTINCT_VISUAL_COUNT = 3;
const MAX_RISKY_ARTICLE_CONTEXT_IMAGES = 3;
const MIN_SAFE_NON_ARTICLE_IMAGES_FOR_RISKY_CONTEXT = 3;

function arrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function imageWarnings(image = {}) {
  return arrayField(image.thumbnail_safety_warnings);
}

function isRiskyArticleContextImage(image = {}) {
  const type = String(image.type || "").toLowerCase();
  const source = String(image.source || "").toLowerCase();
  const warnings = imageWarnings(image).map((warning) =>
    String(warning || "").toLowerCase(),
  );
  return (
    (type.includes("article_inline") || source === "article") &&
    warnings.includes("article_image_relevance_review")
  );
}

function isSafeNonArticleImage(image = {}) {
  if (!image || typeof image !== "object") return false;
  if (isRiskyArticleContextImage(image)) return false;
  const type = String(image.type || "").toLowerCase();
  const source = String(image.source || "").toLowerCase();
  if (!type || type === "company_logo") return false;
  if (source === "article" && type.includes("article")) return false;
  return true;
}

function classifyArticleContextRisk(images = []) {
  const downloadedImages = arrayField(images);
  const risky = downloadedImages.filter(isRiskyArticleContextImage);
  const safeNonArticle = downloadedImages.filter(isSafeNonArticleImage);
  const blocked =
    risky.length > MAX_RISKY_ARTICLE_CONTEXT_IMAGES &&
    safeNonArticle.length < MIN_SAFE_NON_ARTICLE_IMAGES_FOR_RISKY_CONTEXT;
  return {
    blocked,
    risky_count: risky.length,
    safe_non_article_count: safeNonArticle.length,
  };
}

/**
 * Run QA checks against the given story. Returns:
 *
 *   {
 *     result: "pass" | "warn" | "fail",
 *     failures: string[],
 *     warnings: string[]
 *   }
 *
 * Callers decide the severity mapping — this function never blocks
 * publication itself. publisher.js::publishNextStory is the only
 * caller that SHOULD treat `fail` as a skip.
 *
 * @param {object} story  — the story row from db.getStories()
 * @param {object} [opts]
 * @param {number} [opts.minMp4Bytes]
 * @param {number} [opts.minWords]
 * @param {number} [opts.maxWords]
 * @param {object} [opts.fs]  — override for fs-extra (tests)
 */
async function runContentQa(story, opts = {}) {
  const failures = [];
  const warnings = [];
  const fs = opts.fs || fsExtra;
  const minMp4 =
    typeof opts.minMp4Bytes === "number"
      ? opts.minMp4Bytes
      : DEFAULT_MIN_MP4_BYTES;
  const minWords =
    typeof opts.minWords === "number" ? opts.minWords : DEFAULT_MIN_WORDS;
  const maxWords =
    typeof opts.maxWords === "number" ? opts.maxWords : DEFAULT_MAX_WORDS;

  if (!story || typeof story !== "object") {
    return { result: "fail", failures: ["no_story"], warnings: [] };
  }

  if (
    story.script_generation_status === "review_required" ||
    SCRIPT_VALIDATION_FAILURE_RE.test(
      [
        story.hook,
        story.body,
        story.full_script,
        story.tts_script,
        story.script_review_reason,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  ) {
    failures.push("script_validation_review_required");
  }

  // --- 0a. Current topicality re-check ----------------------------
  // Some legacy rows were approved before the Pulse-specific
  // topicality gate existed. Re-evaluate immediately before publish
  // so old entertainment/news rows cannot be recycled into the live
  // queue just because their approved flag is still true.
  try {
    const { evaluatePulseGamingTopicality } = require("../topicality-gate");
    const topicality = evaluatePulseGamingTopicality(story, {
      channelId: story.channel_id,
    });
    if (topicality.decision === "reject") {
      failures.push(`pulse_gaming_${topicality.reason || "topicality_reject"}`);
    } else if (topicality.decision === "review") {
      warnings.push(
        `topicality_review:${topicality.reason || "manual_review_required"}`,
      );
    }
  } catch (err) {
    warnings.push(`topicality_gate_error:${err.code || "unknown"}`);
  }

  // --- 0. Experimental render hold -------------------------------
  // Studio v2.1 is allowed to generate sidecar candidates, but those
  // candidates must not enter the normal publishing path until a
  // human has visually reviewed and approved them. This is a hard
  // safety latch around the new quality layer: legacy remains the
  // default publish engine, while v2.1 output is review-only unless
  // explicitly released by metadata + env.
  try {
    const { humanReviewGateForStory } = require("../render-engine-switch");
    const reviewGate = humanReviewGateForStory(story, opts.env || process.env);
    if (reviewGate.blocked) {
      failures.push(reviewGate.reason);
    }
  } catch (err) {
    warnings.push(`render_engine_switch_error:${err.code || "unknown"}`);
  }

  // --- 1. MP4 existence + sanity size -----------------------------
  // Path resolution goes through lib/media-paths so the check
  // finds the MP4 under MEDIA_ROOT (e.g. /data/media on Railway)
  // when set, and falls back to the repo-root `output/...`
  // location for legacy DB rows.
  if (!story.exported_path) {
    failures.push("exported_mp4_missing");
  } else {
    try {
      const resolved = await mediaPaths.resolveExisting(story.exported_path, {
        fs,
      });
      const exists = resolved ? await fs.pathExists(resolved) : false;
      if (!exists) {
        failures.push("exported_mp4_not_on_disk");
      } else {
        const stat = await fs.stat(resolved);
        if (stat.size < minMp4) {
          failures.push(
            `exported_mp4_too_small (${stat.size} bytes, min ${minMp4})`,
          );
        }
      }
    } catch (err) {
      failures.push(`exported_mp4_stat_failed:${err.code || "unknown"}`);
    }
  }

  // --- 1b. Legacy render stamp gate --------------------------------
  // The 2026-04-29 render stamp is more than reporting metadata:
  // it marks videos generated after the Meta-safe encoder fix
  // (-pix_fmt yuv420p / High@4.0) and the visual-count stamping work.
  // Unstamped MP4s are old enough to carry both the bad local-voice
  // renders and the Meta 2207076 chroma/profile risk. Do not publish
  // them through the normal queue; they need a fresh produce pass.
  const env = opts.env || process.env;
  const legacyAllowed =
    story.allow_legacy_unstamped_render === true ||
    env.ALLOW_LEGACY_UNSTAMPED_RENDERS === "true";
  const hasRenderStamp =
    typeof story.render_lane === "string" &&
    story.render_lane.length > 0 &&
    typeof story.render_quality_class === "string" &&
    story.render_quality_class.length > 0;
  if (story.exported_path && !hasRenderStamp && !legacyAllowed) {
    failures.push("legacy_unstamped_render_requires_rerender");
  }

  // --- 2. Script present + word count ------------------------------
  const script = story.full_script || story.tts_script || "";
  if (!script || typeof script !== "string" || script.trim().length === 0) {
    failures.push("script_missing");
  } else {
    const words = script.trim().split(/\s+/).filter(Boolean).length;
    if (words < minWords) {
      failures.push(`script_too_short (${words} words, min ${minWords})`);
    } else if (words > maxWords) {
      // Soft: a long script means overlong audio, likely already
      // caught by ElevenLabs duration, but worth surfacing.
      warnings.push(`script_long (${words} words, max ${maxWords})`);
    }
  }

  // --- 2b. Runtime contract ---------------------------------------
  const durationQa = classifyShortDuration({
    audioDurationSeconds: story.audio_duration,
    videoDurationSeconds: story.duration_seconds || story.runtime_seconds,
    story,
  });
  if (durationQa.failures.length > 0) failures.push(...durationQa.failures);
  if (durationQa.warnings.length > 0) warnings.push(...durationQa.warnings);

  // --- 2d. Burned subtitle timing --------------------------------
  // Stale local TTS sidecars and synthetic fallback tracks can make
  // captions freeze while narration continues. If assembly already
  // stamped an unusable timing inspection, block the public upload and
  // force a local TTS refresh/rerender rather than shipping broken
  // subtitles.
  const subtitleInspection = story.subtitle_timing_inspection;
  if (
    subtitleInspection &&
    typeof subtitleInspection === "object" &&
    subtitleInspection.usable === false
  ) {
    const reason = String(
      subtitleInspection.reason || story.subtitle_timing_warning || "unusable",
    ).trim();
    failures.push(`subtitle_timing_unusable:${reason || "unusable"}`);
  }

  // --- 2e. Publish voice provenance -------------------------------
  // Local cutover must not publish stale MP4s with the old bad local
  // voice. If a story has an audio path, or the local publisher is
  // running in strict mode, require timestamp sidecar evidence that
  // the narration came from an approved voice path.
  try {
    const { runPublishVoiceQa } = require("./publish-voice-qa");
    const voiceQa = await runPublishVoiceQa(story, { fs, env });
    if (voiceQa.failures && voiceQa.failures.length > 0) {
      failures.push(...voiceQa.failures);
    }
    if (voiceQa.warnings && voiceQa.warnings.length > 0) {
      warnings.push(...voiceQa.warnings);
    }
  } catch (err) {
    warnings.push(`approved_voice_qa_error:${err.code || "unknown"}`);
  }

  // --- 3. Banned stock phrases (hard-fail — these destroy tone) ---
  if (script) {
    const coherenceQa = runScriptCoherenceQa(story, {
      requireCtaField: true,
      requireFullScriptCta: true,
    });
    if (coherenceQa.failures.length > 0) {
      failures.push(...coherenceQa.failures);
    }
    if (coherenceQa.warnings.length > 0) {
      warnings.push(...coherenceQa.warnings);
    }
    for (const re of BANNED_STOCK_PHRASES) {
      if (re.test(script)) {
        failures.push(`banned_phrase:${re.source}`);
      }
    }
    if (isGeneralRedditSource(story) && UNSUPPORTED_SOURCE_CLAIM_RE.test(script)) {
      failures.push("unsupported_source_claim:community_reddit_attribution");
    }

    const publicOutputQa = runPublicOutputCoherenceGate({
      story,
      script,
      publicTitle: story.public_title || story.upload_title || story.suggested_title || story.title,
      thumbnailText: story.suggested_thumbnail_text,
      thumbnailSourceLabel: story.thumbnail_source_label,
      sourceCardLabel: story.source_card_label,
      requireCaptionEvidence: true,
    });
    if (publicOutputQa.failures.length > 0) failures.push(...publicOutputQa.failures);
    if (publicOutputQa.warnings.length > 0) warnings.push(...publicOutputQa.warnings);
  }

  if (shouldRejectGeneralRedditForNews(story)) {
    failures.push("community_reddit_media_not_news");
  }

  // --- 4. Glued sentence token (caption / TTS artefact) -----------
  // Also check tts_script specifically since it's the one ElevenLabs
  // reads, and the glued token can slip in even if full_script is
  // clean.
  const scriptsToCheck = [
    ["full_script", story.full_script],
    ["tts_script", story.tts_script],
  ];
  for (const [field, s] of scriptsToCheck) {
    if (typeof s === "string" && GLUED_SENTENCE_RE.test(s)) {
      failures.push(`glued_sentence_in_${field}`);
    }
  }

  // --- 5. American time format (warn, not fail) --------------------
  if (script && AMERICAN_TIME_RE.test(script)) {
    warnings.push("american_time_format");
  }

  // --- 6. At least one non-logo image source -----------------------
  const downloadedImages = arrayField(story.downloaded_images);
  const nonLogoImages = downloadedImages.filter(
    (i) => i && i.type && i.type !== "company_logo",
  );
  if (downloadedImages.length > 0 && nonLogoImages.length === 0) {
    warnings.push("only_logo_image_available");
  }

  // --- 6a. Article-context contamination --------------------------
  // Some publisher pages include unrelated inline/recirculation media
  // (for example generic tech demos, stock sports clips or off-topic
  // thumbnails). The image pipeline already labels these as
  // article_image_relevance_review. If that risky article-context
  // material dominates the available deck, do not publish it. This is
  // a high-signal blocker for wrong-story visuals and lets the
  // scheduler continue to a safer candidate in the same window.
  const articleContextRisk = classifyArticleContextRisk(downloadedImages);
  if (articleContextRisk.blocked) {
    failures.push(
      `risky_article_context_dominated_deck (${articleContextRisk.risky_count} risky article images, ${articleContextRisk.safe_non_article_count} safe non-article images)`,
    );
  } else if (articleContextRisk.risky_count > 0) {
    warnings.push(
      `risky_article_context_images (${articleContextRisk.risky_count})`,
    );
  }

  // --- 6b. Thumbnail safety ---------------------------------------
  // This guards the final public face of the Short. Unknown people,
  // author headshots and social avatars should not become custom
  // thumbnails or the first render frame unless the story is actually
  // about that named person.
  try {
    const { runThumbnailPreUploadQa } = require("../thumbnail-safety");
    const thumbQa = await runThumbnailPreUploadQa(story);
    if (thumbQa.warnings && thumbQa.warnings.length > 0) {
      warnings.push(...thumbQa.warnings);
    }
    if (thumbQa.failures && thumbQa.failures.length > 0) {
      failures.push(...thumbQa.failures);
    }
  } catch (err) {
    warnings.push(`thumbnail_qa_error:${err.code || "unknown"}`);
  }

  // --- 7. Story card exists when expected --------------------------
  // If the pipeline generated a story_image_path, the file must be
  // on disk — otherwise IG/FB Story fallback will 404 at publish
  // time. Missing path (never generated) is fine; missing FILE
  // when path is set is a warn.
  if (story.story_image_path) {
    try {
      const exists = await mediaPaths.pathExists(story.story_image_path, {
        fs,
      });
      if (!exists) warnings.push("story_card_path_set_but_missing");
    } catch {
      warnings.push("story_card_stat_failed");
    }
  }

  // --- 7b. Outro card presence (warn) -----------------------------
  // assemble.js stamps story.outro_present = true when the OUTRO_CARD
  // asset existed at render time and was attached to the filter
  // graph. If the file was missing on the running container (e.g.
  // a deploy with a broken Docker COPY), the renderer silently
  // drops the outro and the story ships without the brand close.
  // Surface it so an operator sees the problem before the next
  // produce cycle.
  if (story.outro_present === false) {
    warnings.push("outro_card_missing_at_render_time");
  }

  // --- 7c. Text hygiene (mojibake / HTML entity gate) --------------
  // Per the 2026-04-29 forensic audit: public-facing strings (title,
  // suggested_thumbnail_text, full_script) carrying broken encoding
  // make the channel look amateur. Run lib/text-hygiene over every
  // public-facing field; FAIL severities (control chars / undecodable
  // entities) become warnings here so the operator sees them, but we
  // don't block publishing yet — the audit explicitly cautions
  // against burning auto-publish on fragile heuristics.
  try {
    const { classifyTextHygiene } = require("../text-hygiene");
    const fields = [
      ["title", story.title],
      ["suggested_thumbnail_text", story.suggested_thumbnail_text],
      ["full_script", story.full_script],
      ["tts_script", story.tts_script],
    ];
    const failures = [];
    for (const [name, value] of fields) {
      if (typeof value !== "string" || value.length === 0) continue;
      const verdict = classifyTextHygiene(value);
      if (verdict.severity === "fail") {
        failures.push(`${name}:${verdict.issues.join("+")}`);
      }
    }
    if (failures.length > 0) {
      warnings.push(`text_hygiene_fail:${failures.join(",")}`);
    }
  } catch (err) {
    // Module load failure is itself worth surfacing.
    warnings.push(`text_hygiene_module_error:${err.code || "unknown"}`);
  }

  // --- 7d. Protected brand/game-name integrity ---------------------
  // Damaged names such as "Pokmon" are not stylistic nits: they
  // ship into both narration and burned-in captions, so they are
  // hard publish blockers. Non-official spellings are warnings only.
  try {
    const { runBrandNameQa } = require("../brand-name-qa");
    const brandQa = runBrandNameQa({
      title: story.title,
      suggested_thumbnail_text: story.suggested_thumbnail_text,
      full_script: story.full_script,
      tts_script: story.tts_script,
    });
    if (brandQa.failures.length > 0) {
      failures.push(...brandQa.failures.map((f) => `brand_name:${f}`));
    }
    if (brandQa.warnings.length > 0) {
      warnings.push(...brandQa.warnings.map((w) => `brand_name:${w}`));
    }
  } catch (err) {
    warnings.push(`brand_name_qa_error:${err.code || "unknown"}`);
  }

  // --- 8a. Visual-inventory gate ----------------------------------
  // assemble.js stamps story.qa_visual_count (= count of distinct
  // real images used in the render). When that number is below
  // MIN_DISTINCT_VISUAL_COUNT the story is rendering as a near-
  // single-image composite — boring, low-retention, often visibly
  // bad. Default behaviour: warn. Operator-opt-in
  // (BLOCK_THIN_VISUALS=true in Railway env): fail and skip publish.
  // Per-story override: story.allow_thin_visuals === true bypasses.
  if (
    typeof story.qa_visual_count === "number" &&
    story.qa_visual_count < MIN_DISTINCT_VISUAL_COUNT &&
    story.allow_thin_visuals !== true
  ) {
    const blockingEnabled =
      (opts.blockThinVisuals !== undefined
        ? opts.blockThinVisuals
        : process.env.BLOCK_THIN_VISUALS) === true ||
      (opts.blockThinVisuals === undefined &&
        process.env.BLOCK_THIN_VISUALS === "true");
    const reason =
      story.qa_visual_warning ||
      (story.qa_visual_count === 0
        ? "no_real_images_used_composite"
        : "thin_visuals_below_three");
    if (blockingEnabled) {
      failures.push(`thin_visuals_blocked:${reason}`);
    } else {
      warnings.push(`${reason}_warn`);
    }
  }

  // --- 8. Entity overlay coverage (warn) ---------------------------
  // If entity extraction ran but produced zero overlays when it
  // thought it should have, surface that so the operator can
  // retry / fix the Wikipedia hit rate later.
  if (story.mentions_computed && Array.isArray(story.mentions)) {
    const totalMentions = story.mentions.length;
    if (totalMentions === 0) {
      // Not every story has people in it — this could just mean
      // there were no entities. Don't warn.
    } else {
      const withImage = story.mentions.filter((m) => m && m.image_path).length;
      const coverage = withImage / totalMentions;
      if (coverage < MIN_ENTITY_OVERLAY_COVERAGE) {
        warnings.push(
          `entity_overlay_coverage_low (${withImage}/${totalMentions})`,
        );
      }
    }
  }

  let result;
  if (failures.length > 0) {
    result = "fail";
  } else if (warnings.length > 0) {
    result = "warn";
  } else {
    result = "pass";
  }

  return { result, failures, warnings };
}

module.exports = {
  runContentQa,
  DEFAULT_MIN_MP4_BYTES,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
  MIN_DISTINCT_VISUAL_COUNT,
  MAX_RISKY_ARTICLE_CONTEXT_IMAGES,
  MIN_SAFE_NON_ARTICLE_IMAGES_FOR_RISKY_CONTEXT,
  classifyArticleContextRisk,
  BANNED_STOCK_PHRASES,
  GLUED_SENTENCE_RE,
  AMERICAN_TIME_RE,
};
