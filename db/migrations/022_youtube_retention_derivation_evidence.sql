-- 022_youtube_retention_derivation_evidence.sql
-- Records how persisted retention metrics were derived from observed evidence.
-- This migration is local persistence only and performs no platform operation.

ALTER TABLE youtube_analytics_experiment_snapshots
  ADD COLUMN metric_derivations_json TEXT NOT NULL DEFAULT '{}';
