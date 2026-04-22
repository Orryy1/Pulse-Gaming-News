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

  // --- 3. Banned stock phrases (hard-fail — these destroy tone) ---
  if (script) {
    for (const re of BANNED_STOCK_PHRASES) {
      if (re.test(script)) {
        failures.push(`banned_phrase:${re.source}`);
      }
    }
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
  const downloadedImages = Array.isArray(story.downloaded_images)
    ? story.downloaded_images
    : [];
  const nonLogoImages = downloadedImages.filter(
    (i) => i && i.type && i.type !== "company_logo",
  );
  if (downloadedImages.length > 0 && nonLogoImages.length === 0) {
    warnings.push("only_logo_image_available");
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
  BANNED_STOCK_PHRASES,
  GLUED_SENTENCE_RE,
  AMERICAN_TIME_RE,
};
