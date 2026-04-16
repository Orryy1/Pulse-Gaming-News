/**
 * story_scores repository.
 *
 * Append-only. Each call to `record()` inserts a new row; `latest(storyId)`
 * returns the most recent. Keeping the history lets us compare rubric
 * weights over time once Phase 6 is tuned against real analytics.
 */

function bind(db) {
  const insert = db.prepare(`
    INSERT INTO story_scores
      (story_id, channel_id, total, decision, decision_reason,
       source_confidence, story_importance, freshness, search_demand,
       visual_viability, originality, duplicate_safety,
       advertiser_safety, roundup_suitability,
       hook_bonus, diversity_bonus, repetition_penalty,
       hard_stops, inputs, scorer_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const latest = db.prepare(`
    SELECT * FROM story_scores
    WHERE story_id = ?
    ORDER BY scored_at DESC
    LIMIT 1
  `);
  const countByDecision = db.prepare(`
    SELECT decision, COUNT(*) as n FROM story_scores
    WHERE scored_at >= datetime('now', ?)
    GROUP BY decision
  `);

  function hydrate(row) {
    if (!row) return null;
    if (row.hard_stops) {
      try {
        row.hard_stops = JSON.parse(row.hard_stops);
      } catch {
        /* keep string */
      }
    }
    if (row.inputs) {
      try {
        row.inputs = JSON.parse(row.inputs);
      } catch {
        /* keep string */
      }
    }
    return row;
  }

  return {
    record(score) {
      insert.run(
        score.story_id,
        score.channel_id || null,
        Math.round(score.total),
        score.decision,
        score.decision_reason || null,
        score.source_confidence || 0,
        score.story_importance || 0,
        score.freshness || 0,
        score.search_demand || 0,
        score.visual_viability || 0,
        score.originality || 0,
        score.duplicate_safety || 0,
        score.advertiser_safety || 0,
        score.roundup_suitability || 0,
        score.hook_bonus || 0,
        score.diversity_bonus || 0,
        score.repetition_penalty || 0,
        score.hard_stops ? JSON.stringify(score.hard_stops) : null,
        score.inputs ? JSON.stringify(score.inputs) : null,
        score.scorer_version || "v1.0",
      );
    },
    latest(storyId) {
      return hydrate(latest.get(storyId));
    },
    countByDecision(sinceExpr = "-7 days") {
      const rows = countByDecision.all(sinceExpr);
      return Object.fromEntries(rows.map((r) => [r.decision, r.n]));
    },
  };
}

module.exports = { bind };
