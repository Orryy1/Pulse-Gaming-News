"use strict";

/**
 * lib/media-provenance.js — high-level API for the asset provenance
 * ledger.
 *
 * Wraps the lib/repositories/media_provenance bind output plus the
 * lib/visual-content-prescan helper. Every successful image download
 * should call recordDownload() with the asset metadata; this module
 * handles content-hashing + visual prescan + DB write so the caller
 * doesn't need to know the schema.
 *
 * Defensive design:
 *   - Failures here NEVER throw to the caller. Callers (especially
 *     images_download.js in a hot loop) need to keep going on partial
 *     errors. recordDownload() returns { ok, provenance_id, signals }
 *     and logs warnings via the optional log option.
 *   - When SQLite isn't available (USE_SQLITE != true) we skip the
 *     DB write but still run prescan and return signals — caller can
 *     surface them in-memory.
 *
 * Companion to lib/thumbnail-safety.js (URL-string heuristics) — this
 * adds the pixel-level layer.
 */

const path = require("node:path");
const {
  prescanImage,
  computeContentHash,
} = require("./visual-content-prescan");

function safeGetRepos() {
  try {
    return require("./repositories").getRepos();
  } catch {
    return null;
  }
}

function tryStringify(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Record one downloaded asset with full provenance.
 *
 * @param {object} input
 *   - story_id              required
 *   - source_url            required
 *   - source_type           required (e.g. "article_hero", "steam_capsule")
 *   - file_path             on-disk path of the cached asset (string or null)
 *   - mime_type             optional
 *   - story_relevance_score 0..1 optional
 *   - thumbnail_safety_verdict optional ("pass"|"warn"|"fail")
 *   - thumbnail_safety_reasons optional (array or string)
 *   - accepted              boolean (default true)
 *   - reject_reason         when accepted=false
 *   - raw_meta              optional object payload to persist
 *   - skipPrescan           boolean (default false). True for assets
 *                           we know are non-image (e.g. video clips)
 *                           or for tests.
 *   - log                   optional logger
 *
 * @returns { ok, provenance_id, content_hash, signals }
 */
async function recordDownload(input = {}) {
  const log = input.log || (() => {});
  const out = {
    ok: false,
    provenance_id: null,
    content_hash: null,
    signals: null,
    error: null,
  };
  if (!input.story_id || !input.source_url) {
    out.error = "missing_story_id_or_source_url";
    return out;
  }

  // Step 1: content hash + visual prescan (when we have a file)
  let signals = null;
  if (!input.skipPrescan && input.file_path) {
    try {
      out.content_hash = await computeContentHash(input.file_path);
    } catch (err) {
      log(`[provenance] hash failed: ${err.message}`);
    }
    try {
      signals = await prescanImage(input.file_path, {
        sourceTypeHint: input.source_type || null,
      });
    } catch (err) {
      log(`[provenance] prescan failed: ${err.message}`);
      signals = { error: err.message };
    }
  }
  out.signals = signals;

  // Step 2: detected_content_type composite
  let detectedContentType = null;
  if (signals) {
    if (signals.likely_is_logo) detectedContentType = "logo";
    else if (signals.likely_has_face) {
      detectedContentType = signals.likely_is_stock_person
        ? "stock"
        : "portrait";
    } else if (signals.likely_is_screenshot) {
      detectedContentType = "screenshot";
    } else if (signals.is_animated) {
      detectedContentType = "illustration";
    }
  }

  // Step 3: licence/risk class derived from source_type. Conservative
  // mapping — operator can refine via licence_class override.
  const LICENCE_BY_SOURCE = {
    article_hero: "editorial_use",
    article_inline: "editorial_use",
    steam_capsule: "store_metadata",
    steam_hero: "store_metadata",
    steam_key_art: "store_metadata",
    steam_screenshot: "store_metadata",
    steam_trailer: "store_metadata",
    igdb_cover: "store_metadata",
    igdb_screenshot: "store_metadata",
    company_logo: "store_metadata",
    reddit_thumb: "scraped_unknown",
    pexels: "royalty_free",
    unsplash: "royalty_free",
    bing: "scraped_unknown",
    youtube_broll: "fair_use_review",
  };
  const licenceClass =
    input.licence_class ||
    LICENCE_BY_SOURCE[input.source_type] ||
    "scraped_unknown";

  // Step 4: file size if we have a path
  let fileSize = null;
  if (input.file_path) {
    try {
      const fs = require("fs-extra");
      const stat = await fs.stat(input.file_path);
      fileSize = stat.size;
    } catch {
      /* leave null */
    }
  }

  // Step 5: persist via repository (SQLite-only). When SQLite is off
  // we still return the signals so the caller can keep going.
  const repos = safeGetRepos();
  if (!repos || !repos.mediaProvenance) {
    out.ok = true; // signals are still valid even if we couldn't persist
    out.error = "repos_unavailable";
    return out;
  }

  try {
    const result = repos.mediaProvenance.recordAsset({
      story_id: input.story_id,
      channel_id: input.channel_id || null,
      source_url: input.source_url,
      source_type: input.source_type || "other",
      file_path: input.file_path || null,
      file_size_bytes: fileSize,
      mime_type: input.mime_type || null,
      content_hash: out.content_hash,
      detected_content_type: detectedContentType,
      licence_class: licenceClass,
      story_relevance_score:
        typeof input.story_relevance_score === "number"
          ? input.story_relevance_score
          : null,
      thumbnail_safety_verdict: input.thumbnail_safety_verdict || null,
      thumbnail_safety_reasons_json: tryStringify(
        input.thumbnail_safety_reasons,
      ),
      accepted: input.accepted === false ? false : true,
      reject_reason: input.reject_reason || null,
      raw_meta_json: tryStringify(input.raw_meta),
    });
    out.provenance_id = result.id;
  } catch (err) {
    log(`[provenance] recordAsset failed: ${err.message}`);
    out.error = `record_asset:${err.message}`;
    return out;
  }

  // Step 6: persist signals (deduped by content_hash)
  if (out.content_hash && signals && !signals.error) {
    try {
      repos.mediaProvenance.recordVisualSignals({
        content_hash: out.content_hash,
        width: signals.width,
        height: signals.height,
        aspect_ratio: signals.aspect_ratio,
        is_animated: signals.is_animated,
        skin_tone_ratio: signals.skin_tone_ratio,
        central_luminance_oval: signals.central_luminance_oval,
        edge_density: signals.edge_density,
        saturation_mean: signals.saturation_mean,
        text_overlay_likelihood: signals.text_overlay_likelihood,
        likely_has_face: signals.likely_has_face,
        likely_is_logo: signals.likely_is_logo,
        likely_is_screenshot: signals.likely_is_screenshot,
        likely_is_stock_person: signals.likely_is_stock_person,
        raw_json: tryStringify({
          file_basename: path.basename(input.file_path || ""),
        }),
      });
    } catch (err) {
      log(`[provenance] recordVisualSignals failed: ${err.message}`);
    }
  }

  out.ok = true;
  return out;
}

/**
 * Read-only summary used by tools/ops/provenance-report.js. Falls
 * back to an empty summary if SQLite is unavailable.
 */
function summary({ window = "-7 days" } = {}) {
  const repos = safeGetRepos();
  if (!repos || !repos.mediaProvenance) {
    return {
      window,
      by_source: [],
      by_acceptance: [],
      by_licence: [],
      face_photos: [],
      unavailable: true,
    };
  }
  return repos.mediaProvenance.summary(window);
}

function listForStory(storyId) {
  const repos = safeGetRepos();
  if (!repos || !repos.mediaProvenance) return [];
  return repos.mediaProvenance.listForStory(storyId);
}

module.exports = {
  recordDownload,
  summary,
  listForStory,
};
