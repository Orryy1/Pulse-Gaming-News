"use strict";

/**
 * media_provenance + visual_content_signals repository.
 *
 * Append-only ledger for every downloaded media asset, plus a
 * deduped pixel-level signal cache keyed by content_hash so the
 * same image only gets scanned once even when it's referenced by
 * multiple stories.
 *
 * Caller responsibility: compute content_hash (sha256 hex) and pass
 * it in. This repo never opens files; it only writes/reads SQL.
 */

function bind(db) {
  const insertProvenance = db.prepare(`
    INSERT INTO media_provenance
      (story_id, channel_id, source_url, source_type,
       file_path, file_size_bytes, mime_type, content_hash,
       detected_content_type, licence_class, story_relevance_score,
       thumbnail_safety_verdict, thumbnail_safety_reasons_json,
       accepted, reject_reason, raw_meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertVisualSignals = db.prepare(`
    INSERT INTO visual_content_signals
      (content_hash, width, height, aspect_ratio, is_animated,
       skin_tone_ratio, central_luminance_oval, edge_density,
       saturation_mean, text_overlay_likelihood,
       likely_has_face, likely_is_logo, likely_is_screenshot,
       likely_is_stock_person, raw_json)
    VALUES (@content_hash, @width, @height, @aspect_ratio, @is_animated,
            @skin_tone_ratio, @central_luminance_oval, @edge_density,
            @saturation_mean, @text_overlay_likelihood,
            @likely_has_face, @likely_is_logo, @likely_is_screenshot,
            @likely_is_stock_person, @raw_json)
    ON CONFLICT (content_hash) DO UPDATE SET
      width = excluded.width,
      height = excluded.height,
      aspect_ratio = excluded.aspect_ratio,
      is_animated = excluded.is_animated,
      skin_tone_ratio = excluded.skin_tone_ratio,
      central_luminance_oval = excluded.central_luminance_oval,
      edge_density = excluded.edge_density,
      saturation_mean = excluded.saturation_mean,
      text_overlay_likelihood = excluded.text_overlay_likelihood,
      likely_has_face = excluded.likely_has_face,
      likely_is_logo = excluded.likely_is_logo,
      likely_is_screenshot = excluded.likely_is_screenshot,
      likely_is_stock_person = excluded.likely_is_stock_person,
      raw_json = excluded.raw_json,
      scanned_at = datetime('now')
  `);

  const getVisualSignals = db.prepare(
    `SELECT * FROM visual_content_signals WHERE content_hash = ?`,
  );

  const listProvenanceByStory = db.prepare(
    `SELECT * FROM media_provenance WHERE story_id = ? ORDER BY recorded_at DESC, id DESC`,
  );

  const countBySourceType = db.prepare(
    `SELECT source_type, COUNT(*) as n FROM media_provenance
     WHERE recorded_at >= datetime('now', ?)
     GROUP BY source_type ORDER BY n DESC`,
  );

  const countByAcceptance = db.prepare(
    `SELECT accepted, reject_reason, COUNT(*) as n FROM media_provenance
     WHERE recorded_at >= datetime('now', ?)
     GROUP BY accepted, reject_reason ORDER BY n DESC`,
  );

  const countByLicence = db.prepare(
    `SELECT licence_class, COUNT(*) as n FROM media_provenance
     WHERE recorded_at >= datetime('now', ?)
     GROUP BY licence_class ORDER BY n DESC`,
  );

  const facePhotosLast = db.prepare(
    `SELECT mp.*, vcs.likely_has_face, vcs.likely_is_stock_person
     FROM media_provenance mp
     LEFT JOIN visual_content_signals vcs ON vcs.content_hash = mp.content_hash
     WHERE mp.recorded_at >= datetime('now', ?)
       AND vcs.likely_has_face = 1
     ORDER BY mp.recorded_at DESC
     LIMIT 50`,
  );

  /**
   * Record a single asset download. All fields except story_id and
   * source_url are optional — the caller can supplement later.
   */
  function recordAsset(row) {
    if (!row || !row.story_id || !row.source_url) {
      throw new Error(
        "media_provenance.recordAsset: story_id + source_url required",
      );
    }
    const info = insertProvenance.run(
      row.story_id,
      row.channel_id || "pulse-gaming",
      row.source_url,
      row.source_type || "other",
      row.file_path || null,
      row.file_size_bytes || null,
      row.mime_type || null,
      row.content_hash || null,
      row.detected_content_type || null,
      row.licence_class || null,
      row.story_relevance_score == null
        ? null
        : Number(row.story_relevance_score),
      row.thumbnail_safety_verdict || null,
      row.thumbnail_safety_reasons_json
        ? typeof row.thumbnail_safety_reasons_json === "string"
          ? row.thumbnail_safety_reasons_json
          : JSON.stringify(row.thumbnail_safety_reasons_json)
        : null,
      row.accepted === false ? 0 : 1,
      row.reject_reason || null,
      row.raw_meta_json
        ? typeof row.raw_meta_json === "string"
          ? row.raw_meta_json
          : JSON.stringify(row.raw_meta_json)
        : null,
    );
    return { id: info.lastInsertRowid };
  }

  /**
   * Upsert pixel-level signals for one content_hash.
   */
  function recordVisualSignals(signals) {
    if (!signals || !signals.content_hash) {
      throw new Error(
        "media_provenance.recordVisualSignals: content_hash required",
      );
    }
    upsertVisualSignals.run({
      content_hash: signals.content_hash,
      width: signals.width || null,
      height: signals.height || null,
      aspect_ratio:
        signals.aspect_ratio == null ? null : Number(signals.aspect_ratio),
      is_animated: signals.is_animated ? 1 : 0,
      skin_tone_ratio:
        signals.skin_tone_ratio == null
          ? null
          : Number(signals.skin_tone_ratio),
      central_luminance_oval:
        signals.central_luminance_oval == null
          ? null
          : Number(signals.central_luminance_oval),
      edge_density:
        signals.edge_density == null ? null : Number(signals.edge_density),
      saturation_mean:
        signals.saturation_mean == null
          ? null
          : Number(signals.saturation_mean),
      text_overlay_likelihood:
        signals.text_overlay_likelihood == null
          ? null
          : Number(signals.text_overlay_likelihood),
      likely_has_face: signals.likely_has_face ? 1 : 0,
      likely_is_logo: signals.likely_is_logo ? 1 : 0,
      likely_is_screenshot: signals.likely_is_screenshot ? 1 : 0,
      likely_is_stock_person: signals.likely_is_stock_person ? 1 : 0,
      raw_json: signals.raw_json
        ? typeof signals.raw_json === "string"
          ? signals.raw_json
          : JSON.stringify(signals.raw_json)
        : null,
    });
  }

  function getSignalsForHash(contentHash) {
    if (!contentHash) return null;
    return getVisualSignals.get(contentHash) || null;
  }

  function listForStory(storyId) {
    return listProvenanceByStory.all(storyId);
  }

  /**
   * Aggregate counters used by the operator provenance report.
   * Window in SQLite "datetime modifier" form, e.g. "-7 days".
   */
  function summary(window = "-7 days") {
    return {
      window,
      by_source: countBySourceType.all(window),
      by_acceptance: countByAcceptance.all(window),
      by_licence: countByLicence.all(window),
      face_photos: facePhotosLast.all(window),
    };
  }

  return {
    recordAsset,
    recordVisualSignals,
    getSignalsForHash,
    listForStory,
    summary,
  };
}

module.exports = { bind };
