"use strict";

const DEFAULT_SCORE_CONFIG = Object.freeze({
  viewsVelocityWeight: 0.35,
  retentionWeight: 0.35,
  likesPerThousandWeight: 0.15,
  commentsPerThousandWeight: 0.1,
  subsPerThousandWeight: 0.05,
  velocityReferenceViewsPerHour: 500,
  retentionReferencePercent: 70,
  likesReferencePerThousand: 35,
  commentsReferencePerThousand: 5,
  subsReferencePerThousand: 1,
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cap01(value) {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function perThousand(count, views) {
  const v = finite(views, 0);
  if (v <= 0) return 0;
  return (finite(count, 0) / v) * 1000;
}

function hoursSincePublish(snapshot = {}) {
  if (Number.isFinite(Number(snapshot.age_hours))) return Number(snapshot.age_hours);
  const published = Date.parse(snapshot.publish_time || "");
  const at = Date.parse(snapshot.snapshot_at || "");
  if (!Number.isFinite(published) || !Number.isFinite(at) || at <= published) return 24;
  return Math.max((at - published) / 36e5, 0.25);
}

function scorePerformanceSnapshot(snapshot = {}, config = DEFAULT_SCORE_CONFIG) {
  const views = finite(snapshot.views, 0);
  const ageHours = hoursSincePublish(snapshot);
  const viewsPerHour = views / Math.max(ageHours, 0.25);
  const likesPt = perThousand(snapshot.likes, views);
  const commentsPt = perThousand(snapshot.comments, views);
  const subsPt = perThousand(snapshot.subscribers_gained, views);
  const retentionPercent = finite(snapshot.average_percentage_viewed, 0);

  const components = {
    views_velocity: cap01(viewsPerHour / config.velocityReferenceViewsPerHour),
    retention: cap01(retentionPercent / config.retentionReferencePercent),
    likes_per_thousand: cap01(likesPt / config.likesReferencePerThousand),
    comments_per_thousand: cap01(commentsPt / config.commentsReferencePerThousand),
    subscribers_per_thousand: cap01(subsPt / config.subsReferencePerThousand),
  };

  const score =
    components.views_velocity * config.viewsVelocityWeight +
    components.retention * config.retentionWeight +
    components.likes_per_thousand * config.likesPerThousandWeight +
    components.comments_per_thousand * config.commentsPerThousandWeight +
    components.subscribers_per_thousand * config.subsPerThousandWeight;

  return {
    score: Math.round(score * 100),
    components,
    derived: {
      age_hours: Number(ageHours.toFixed(2)),
      views_per_hour: Number(viewsPerHour.toFixed(2)),
      likes_per_1000: Number(likesPt.toFixed(2)),
      comments_per_1000: Number(commentsPt.toFixed(2)),
      subscribers_per_1000: Number(subsPt.toFixed(2)),
    },
  };
}

function classifyScore(score) {
  const n = finite(score, 0);
  if (n >= 75) return "strong";
  if (n >= 55) return "promising";
  if (n >= 35) return "watch";
  return "weak";
}

module.exports = {
  DEFAULT_SCORE_CONFIG,
  classifyScore,
  scorePerformanceSnapshot,
};
