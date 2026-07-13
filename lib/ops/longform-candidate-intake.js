"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const WEEKLY_FRESHNESS_HOURS = 7 * 24;

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function validHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

function candidateProofDir(candidate = {}) {
  const explicit = candidate.proof_dir || candidate.proofDir;
  if (explicit) return path.resolve(explicit);
  const exportedPath =
    candidate.exported_path ||
    candidate.final_render_path ||
    candidate.source?.exported_path ||
    candidate.source?.final_render_path;
  return exportedPath ? path.dirname(path.resolve(exportedPath)) : null;
}

async function hydrateCandidateFromProof(candidate = {}) {
  const proofDir = candidateProofDir(candidate);
  if (!proofDir || !(await fs.pathExists(proofDir))) return candidate;
  const [canonical, sourceManifest, claimInventory, motionClips] = await Promise.all([
    readJsonIfPresent(path.join(proofDir, "canonical_story_manifest.json")),
    readJsonIfPresent(path.join(proofDir, "source_manifest.json")),
    readJsonIfPresent(path.join(proofDir, "claim_inventory.json")),
    readJsonIfPresent(path.join(proofDir, "materialised_motion_clips.json")),
  ]);
  if (!canonical && !sourceManifest && !claimInventory && !motionClips) return candidate;
  return {
    ...candidate,
    id: canonical?.story_id || candidate.id,
    title:
      canonical?.public_title ||
      canonical?.selected_title ||
      canonical?.canonical_title ||
      candidate.title,
    canonical_game:
      canonical?.canonical_game || canonical?.canonical_subject || candidate.canonical_game,
    source_published_at: canonical?.source_published_at || candidate.source_published_at,
    source_manifest:
      sourceManifest ||
      candidate.source_manifest ||
      (canonical?.primary_source_url
        ? {
            primary_source: {
              name: canonical.primary_source || "Official source",
              url: canonical.primary_source_url,
              type: "official_source",
              published_at: canonical.source_published_at || null,
            },
            blockers: [],
          }
        : undefined),
    claim_inventory:
      claimInventory ||
      candidate.claim_inventory ||
      (canonical?.confirmed_claims
        ? {
            confirmed: canonical.confirmed_claims,
            unconfirmed: canonical.unconfirmed_claims || [],
            prohibited: canonical.prohibited_claims || [],
          }
        : undefined),
    materialised_motion_clips: motionClips || candidate.materialised_motion_clips,
    release_date: canonical?.release_date || candidate.release_date,
    platforms: canonical?.platforms || candidate.platforms,
    player_impact:
      canonical?.player_impact ||
      canonical?.public_description ||
      canonical?.description ||
      candidate.player_impact,
    curiosity_gap: canonical?.curiosity_gap || candidate.curiosity_gap,
    risk_factor: canonical?.risk_factor || candidate.risk_factor,
    payoff: canonical?.payoff || candidate.payoff,
    debate_prompt: canonical?.debate_prompt || candidate.debate_prompt,
    proof_dir: proofDir,
  };
}

function sourceEnvelope(candidate = {}) {
  const manifest = candidate.source_manifest || {};
  if (Array.isArray(manifest)) {
    const primary = manifest.find((source) => validHttpsUrl(source.url)) || {};
    return { manifest, primary, blockers: [] };
  }
  const primary = manifest.primary_source || candidate.primary_source || {};
  return {
    manifest,
    primary,
    blockers: asArray(manifest.blockers),
  };
}

function sourcePublishedAt(candidate, source) {
  return (
    candidate.source_published_at ||
    candidate.published_at ||
    candidate.timestamp ||
    source.primary.published_at ||
    null
  );
}

function sourceType(source = {}) {
  return text(source.type || source.kind || "").toLowerCase();
}

function isOfficialSource(source = {}) {
  return /official|publisher|platform|store|steam|playstation|xbox|nintendo/.test(sourceType(source));
}

function isReliableSource(source = {}) {
  const type = sourceType(source);
  return isOfficialSource(source) || /news|editorial|rss|press/.test(type);
}

function confirmedClaims(candidate = {}) {
  const inventory = candidate.claim_inventory || {};
  if (Array.isArray(inventory)) {
    return inventory
      .map((claim) => text(claim.claim || claim.text || claim))
      .filter(Boolean);
  }
  return asArray(inventory.confirmed).map(text).filter(Boolean);
}

function prohibitedClaims(candidate = {}) {
  const inventory = candidate.claim_inventory || {};
  return Array.isArray(inventory) ? [] : asArray(inventory.prohibited).map(text).filter(Boolean);
}

function motionClips(candidate = {}) {
  const materialised = candidate.materialised_motion_clips || candidate.materialized_motion_clips || {};
  if (Array.isArray(materialised)) return materialised;
  if (asArray(materialised.clips).length) return materialised.clips;
  return asArray(candidate.motion_clips);
}

function governedMotion(candidate = {}) {
  const clips = motionClips(candidate).filter(
    (clip) =>
      clip.materialized !== false &&
      validHttpsUrl(clip.source_url) &&
      (/official|store|steam|licensed_direct_media/.test(
        `${text(clip.source_type)} ${text(clip.rights_basis)}`.toLowerCase(),
      )),
  );
  const explicit = candidate.official_motion || {};
  const trailerUrl = text(
    explicit.trailer_url ||
      candidate.trailer_url ||
      clips[0]?.source_url ||
      "",
  );
  const families = new Set(
    clips.map((clip) => text(clip.base_source_family || clip.source_family || clip.source_url)),
  );
  return {
    trailer_url: trailerUrl,
    clip_count: Math.max(Number(explicit.clip_count || 0), clips.length),
    distinct_source_families: Math.max(
      Number(explicit.distinct_source_families || 0),
      families.size,
    ),
    gameplay_seconds: Math.max(
      Number(explicit.gameplay_seconds || 0),
      clips.reduce((sum, clip) => sum + Number(clip.durationS || clip.duration_seconds || 0), 0),
    ),
  };
}

function ageHours(value, now) {
  const timestamp = Date.parse(value || "");
  const current = Date.parse(now || "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return null;
  return Math.max(0, (current - timestamp) / 3600000);
}

function targetMonthKey(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function releaseRadarSources(source) {
  if (!validHttpsUrl(source.primary.url)) return [];
  return [
    {
      type: text(source.primary.type || "official_source"),
      label: text(source.primary.name || source.primary.label || "Official source"),
      url: text(source.primary.url),
      supports: ["release_date", "platforms", "player_impact"],
    },
  ];
}

function releaseRadarClaims(candidate, source, claims) {
  if (!validHttpsUrl(source.primary.url)) return [];
  return claims.map((claim) => ({ claim, source_url: text(source.primary.url) }));
}

function normaliseCandidate(candidate = {}, { now, targetMonth } = {}) {
  const source = sourceEnvelope(candidate);
  const claims = confirmedClaims(candidate);
  const motion = governedMotion(candidate);
  const publishedAt = sourcePublishedAt(candidate, source);
  const age = ageHours(publishedAt, now);
  const canonicalGame = text(
    candidate.canonical_game || candidate.canonical_subject || candidate.title,
  );
  const sharedBlockers = [];
  if (!text(candidate.id)) sharedBlockers.push("story_id_missing");
  if (!canonicalGame) sharedBlockers.push("canonical_game_missing");
  if (!text(candidate.title || candidate.canonical_title)) sharedBlockers.push("title_missing");
  if (!validHttpsUrl(source.primary.url) || !isReliableSource(source.primary)) {
    sharedBlockers.push("reliable_source_missing");
  }
  if (source.blockers.length) sharedBlockers.push("source_manifest_blocked");
  if (!claims.length) sharedBlockers.push("confirmed_claims_missing");
  if (prohibitedClaims(candidate).length) sharedBlockers.push("prohibited_claims_present");
  if (!validHttpsUrl(motion.trailer_url) || motion.clip_count < 1) {
    sharedBlockers.push("official_direct_motion_missing");
  }
  if (!text(candidate.player_impact)) sharedBlockers.push("player_impact_missing");

  const weeklyBlockers = [...sharedBlockers];
  if (age === null) weeklyBlockers.push("source_date_missing");
  else if (age > WEEKLY_FRESHNESS_HOURS) weeklyBlockers.push("source_older_than_7_days");

  const releaseBlockers = [...sharedBlockers];
  const releaseDate = text(candidate.release_date);
  if (!releaseDate) releaseBlockers.push("release_date_missing");
  else if (targetMonthKey(releaseDate) !== targetMonth) releaseBlockers.push("outside_target_month");
  if (!asArray(candidate.platforms).length) releaseBlockers.push("platforms_missing");
  if (!isOfficialSource(source.primary)) releaseBlockers.push("official_release_source_missing");
  if (!text(candidate.curiosity_gap)) releaseBlockers.push("curiosity_gap_missing");
  if (!text(candidate.payoff)) releaseBlockers.push("payoff_missing");
  if (!text(candidate.debate_prompt)) releaseBlockers.push("debate_prompt_missing");

  return {
    id: text(candidate.id),
    title: text(candidate.title || candidate.canonical_title),
    canonical_game: canonicalGame,
    source_published_at: publishedAt,
    source_age_hours: age === null ? null : Number(age.toFixed(2)),
    release_date: releaseDate,
    platforms: asArray(candidate.platforms).map(text),
    player_impact: text(candidate.player_impact),
    curiosity_gap: text(candidate.curiosity_gap),
    risk_factor: text(candidate.risk_factor || candidate.risk || "The launch build must prove the trailer promise."),
    payoff: text(candidate.payoff),
    debate_prompt: text(candidate.debate_prompt),
    search_demand: text(candidate.search_demand || "medium"),
    verdict: text(candidate.verdict || "wishlist"),
    affiliate_angle: text(candidate.affiliate_angle),
    source_manifest: releaseRadarSources(source),
    claim_inventory: releaseRadarClaims(candidate, source, claims),
    official_motion: motion,
    shared_blockers: [...new Set(sharedBlockers)],
    weekly_blockers: [...new Set(weeklyBlockers)],
    release_radar_blockers: [...new Set(releaseBlockers)],
  };
}

function candidateStrength(candidate) {
  return (
    (candidate.shared_blockers.length === 0 ? 100 : 0) +
    candidate.claim_inventory.length * 4 +
    candidate.official_motion.clip_count * 3 -
    Number(candidate.source_age_hours || 0) / 24
  );
}

function deduplicate(candidates) {
  const selected = new Map();
  for (const candidate of candidates) {
    const key = candidate.canonical_game.toLowerCase();
    if (!key) continue;
    const existing = selected.get(key);
    if (!existing || candidateStrength(candidate) > candidateStrength(existing)) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()];
}

function buildLongformCandidateIntake({
  candidates = [],
  now = new Date().toISOString(),
  targetMonth,
} = {}) {
  const resolvedMonth = targetMonth || targetMonthKey(new Date(now).toISOString()) || "unknown";
  const normalised = candidates.map((candidate) =>
    normaliseCandidate(candidate, { now, targetMonth: resolvedMonth }),
  );
  const unique = deduplicate(normalised);
  const weeklyCandidates = unique.filter((candidate) => candidate.weekly_blockers.length === 0);
  const releaseCandidates = unique.filter(
    (candidate) => candidate.release_radar_blockers.length === 0,
  );
  const blocked = unique.filter(
    (candidate) =>
      candidate.weekly_blockers.length > 0 || candidate.release_radar_blockers.length > 0,
  );
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    evaluated_at: now,
    target_month: resolvedMonth,
    verdict:
      weeklyCandidates.length >= 8 && releaseCandidates.length >= 10
        ? "READY"
        : weeklyCandidates.length > 0 || releaseCandidates.length > 0
          ? "PARTIAL"
          : "BLOCKED",
    totals: {
      input: candidates.length,
      deduplicated: unique.length,
      duplicates_removed: Math.max(0, candidates.length - unique.length),
      weekly_ready: weeklyCandidates.length,
      release_radar_ready: releaseCandidates.length,
      blocked: blocked.length,
    },
    evaluated_candidates: unique,
    weekly: {
      minimum_candidates: 8,
      candidates: weeklyCandidates,
    },
    release_radar: {
      minimum_candidates: 10,
      candidates: releaseCandidates,
    },
    blocked,
    safety: {
      live_publish_attempted: false,
      production_db_mutation: false,
      oauth_or_token_mutation: false,
    },
  };
}

module.exports = {
  WEEKLY_FRESHNESS_HOURS,
  buildLongformCandidateIntake,
  candidateProofDir,
  hydrateCandidateFromProof,
  normaliseCandidate,
};
