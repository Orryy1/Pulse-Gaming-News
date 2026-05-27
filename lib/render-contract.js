"use strict";

/**
 * lib/render-contract.js — the production render contract.
 *
 * Per the 2026-04-29 forensic audit (P0 #2): "Production rendering
 * still appears to use the legacy assemble.js path, while the
 * premium Studio V2 work remains mostly experimental and local."
 * This module defines, in code, what counts as premium-grade output
 * and what counts as a publishable rendering. The contract is the
 * single source of truth used by:
 *
 *   - publisher.js (decides whether to even attempt publish)
 *   - lib/job-handlers.js renderPublishSummary (exposes the verdict)
 *   - tools/ops/render-contract-report.js (operator audit)
 *   - lib/ops/control-room.js (rolls into the green/amber/red verdict)
 *
 * The contract speaks four classes:
 *
 *   premium   — Studio V2 canonical OR legacy_multi_image with
 *               distinct_visual_count >= 6, outro present,
 *               thumbnail candidate present, no quarantine reasons,
 *               text hygiene clean across title + script, at least
 *               one official-source visual (steam/igdb/article_hero).
 *
 *   standard  — multi_image lane, visuals >= 3, outro present,
 *               thumbnail present, no quarantine fails. The current
 *               "publish-safe" floor.
 *
 *   fallback  — single-image lane OR visuals < 3, but no hard
 *               quality stops. Render-warn line in Discord. Default
 *               behaviour: still publishes. Operator can flip
 *               BLOCK_BELOW_CONTRACT=true to refuse.
 *
 *   reject    — fundamental break: no exported MP4, missing script,
 *               topicality reject, zero visuals, text hygiene fail
 *               on title. NEVER published.
 *
 * The contract is env-aware:
 *   - BLOCK_BELOW_CONTRACT (default off) — when "true", anything
 *     below the contract floor (anything not "premium" or "standard")
 *     is blocked from publishing. The audit specifically warned
 *     against burning auto-publish on heuristics, so this is gated.
 *   - CONTRACT_FLOOR (default "standard") — when BLOCK_BELOW_CONTRACT
 *     is on, anything below this level is blocked.
 *
 * Pure: takes a story object, returns a verdict object. No DB writes.
 */

const PREMIUM_SOURCES = new Set([
  "article_hero",
  "steam_capsule",
  "steam_hero",
  "steam_key_art",
  "steam_screenshot",
  "steam_trailer",
  "igdb_cover",
  "igdb_screenshot",
]);

const QUARANTINE_REASONS = new Set([
  "topicality_reject",
  "zero_visuals_used_composite",
]);

const CONTRACT_CLASSES = ["premium", "standard", "fallback", "reject"];
const DEFAULT_PREMIUM_MOTION_DENSITY_FLOOR = 75;
const DEFAULT_PREMIUM_POLISH_FLOOR = 75;
const STUDIO_V4_PREMIUM_LANES = new Set([
  "studio_v4",
  "studio_v4_canonical",
]);

function envFlag(env = {}, name) {
  return /^(true|1|yes|on)$/i.test(String(env?.[name] || "").trim());
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function scoreValue(benchmark, key) {
  const n = Number(benchmark?.scores?.[key] ?? benchmark?.[key]);
  return Number.isFinite(n) ? n : null;
}

function premiumRequiredFor(story = {}, opts = {}) {
  const env = opts.env || {};
  return (
    opts.requireStudioV4Premium === true ||
    story.require_studio_v4_premium_publish === true ||
    envFlag(env, "STUDIO_V4_PREMIUM_PUBLISH_GATE")
  );
}

function premiumBenchmarkFor(story = {}, opts = {}) {
  return parseObject(opts.mediaHouseBenchmark || story.media_house_benchmark);
}

function storyMediaSourceTypes(story = {}) {
  return parseArray(story.downloaded_images)
    .map((asset) => asset && (asset.type || asset.source_type || asset.source))
    .filter(Boolean)
    .map((source) => String(source));
}

function studioV4PremiumMissing({ story = {}, lane, premiumRequired, opts = {} }) {
  if (!premiumRequired) return [];
  const missing = [];
  const benchmark = premiumBenchmarkFor(story, opts);
  const motionDensity = scoreValue(benchmark, "motion_density_score");
  const polish = scoreValue(benchmark, "media_house_polish_score");
  const motionFloor =
    Number(opts.motionDensityFloor) || DEFAULT_PREMIUM_MOTION_DENSITY_FLOOR;
  const polishFloor =
    Number(opts.mediaHousePolishFloor) || DEFAULT_PREMIUM_POLISH_FLOOR;

  if (!STUDIO_V4_PREMIUM_LANES.has(lane)) {
    missing.push("studio_v4_render_lane_required");
  }
  if (story.render_quality_class !== "premium") {
    missing.push("render_quality_class_premium_required");
  }
  if (benchmark.result !== "pass") {
    missing.push("media_house_benchmark_pass_required");
  }
  if (motionDensity === null || motionDensity < motionFloor) {
    missing.push("motion_density_below_v4_floor");
  }
  if (polish === null || polish < polishFloor) {
    missing.push("media_house_polish_below_v4_floor");
  }
  return missing;
}

/**
 * @param {object} story  — story row
 * @param {object} [opts]
 * @param {Array} [opts.provenanceRows] — optional list of media_provenance
 *        rows for this story (caller fetches from repo when wanting full
 *        contract evaluation). When absent, the contract degrades to a
 *        legacy-only check.
 * @param {object} [opts.topicalityResult] — optional pre-computed
 *        topicality verdict from lib/topicality-gate.
 * @param {object} [opts.textHygiene] — optional pre-computed text-hygiene
 *        verdict from lib/text-hygiene.classifyTextHygiene over title.
 *
 * @returns {{
 *   class: "premium"|"standard"|"fallback"|"reject",
 *   reasons: string[],
 *   missing: string[],
 *   sources_used: string[],
 *   contract_version: number,
 * }}
 */
function evaluateRenderContract(story, opts = {}) {
  const reasons = [];
  const missing = [];

  if (!story || typeof story !== "object") {
    return {
      class: "reject",
      reasons: ["no_story"],
      missing: [],
      premium_required: false,
      premium_missing: [],
      sources_used: [],
      contract_version: 2,
    };
  }
  const premiumRequired = premiumRequiredFor(story, opts);

  // ── Hard rejects ──
  // Scope: the contract only catches breakage SPECIFIC to render
  // output that would still produce a broken publish if we let it
  // through. Topicality is checked upstream at hunt/auto-approve;
  // script presence is checked in content-qa. By the time we reach
  // the contract, those are decided. Don't double-check.
  //
  // Hard rejects:
  //   - no_exported_mp4: there is literally nothing to upload
  //   - zero_visuals_used_composite: render produced no real visuals
  //   - title_text_hygiene_fail: the public title is gibberish
  if (!story.exported_path) {
    reasons.push("no_exported_mp4");
  }
  if (
    typeof story.distinct_visual_count === "number" &&
    story.distinct_visual_count === 0
  ) {
    reasons.push("zero_visuals_used_composite");
  }
  if (opts.textHygiene && opts.textHygiene.severity === "fail") {
    reasons.push("title_text_hygiene_fail");
  }
  if (reasons.length > 0) {
    return {
      class: "reject",
      reasons,
      missing,
      premium_required: premiumRequired,
      premium_missing: [],
      sources_used: [],
      contract_version: 2,
    };
  }

  // ── Floor checks (standard) ──
  let visuals = null;
  if (typeof story.distinct_visual_count === "number") {
    visuals = story.distinct_visual_count;
  } else if (typeof story.qa_visual_count === "number") {
    visuals = story.qa_visual_count;
  }

  const lane = story.render_lane || "unknown";
  const premiumMissing = studioV4PremiumMissing({
    story,
    lane,
    premiumRequired,
    opts,
  });
  if (lane === "legacy_single_image_fallback") {
    missing.push("multi_image_lane");
  }
  if (visuals != null && visuals < 3) {
    missing.push(`visuals_below_3 (${visuals})`);
  }
  if (story.outro_present === false) {
    missing.push("outro_card_missing");
  }
  if (story.thumbnail_candidate_present === false) {
    missing.push("thumbnail_candidate_missing");
  }

  // ── Premium-extra: official-source visual + clean text + ample visuals ──
  const sourcesUsed = [];
  if (Array.isArray(opts.provenanceRows)) {
    for (const row of opts.provenanceRows) {
      if (row && row.accepted && row.source_type) {
        sourcesUsed.push(row.source_type);
      }
    }
  }
  if (sourcesUsed.length === 0) {
    sourcesUsed.push(...storyMediaSourceTypes(story));
  }
  const hasOfficialSource = sourcesUsed.some((s) => PREMIUM_SOURCES.has(s));
  const ampleVisuals = visuals == null ? null : visuals >= 6;
  const cleanTitleText =
    !opts.textHygiene || opts.textHygiene.severity === "clean";
  const hasOutro = story.outro_present === true;
  const hasThumbCandidate = story.thumbnail_candidate_present === true;
  const noTopicalityRev =
    !opts.topicalityResult || opts.topicalityResult.decision === "auto";

  // Premium classification: every premium box checked
  const isPremium =
    missing.length === 0 &&
    premiumMissing.length === 0 &&
    ampleVisuals === true &&
    hasOfficialSource &&
    cleanTitleText &&
    hasOutro &&
    hasThumbCandidate &&
    noTopicalityRev &&
    (premiumRequired
      ? STUDIO_V4_PREMIUM_LANES.has(lane)
      : lane === "legacy_multi_image" ||
        lane === "studio_v2_canonical" ||
        STUDIO_V4_PREMIUM_LANES.has(lane));

  // Standard classification: floor checks all pass
  const isStandard = missing.length === 0;

  let cls;
  if (isPremium) cls = "premium";
  else if (isStandard) cls = "standard";
  else cls = "fallback";

  return {
    class: cls,
    reasons,
    missing,
    premium_required: premiumRequired,
    premium_missing: premiumMissing,
    sources_used: sourcesUsed,
    contract_version: 2,
  };
}

/**
 * Decide whether the contract verdict permits publishing under the
 * current env. Default behaviour:
 *   - "reject" → never publish
 *   - "fallback" → publish (warn-only) unless BLOCK_BELOW_CONTRACT=true
 *     and CONTRACT_FLOOR is "standard" or "premium"
 *   - "standard" → publish unless BLOCK_BELOW_CONTRACT=true and
 *     CONTRACT_FLOOR is "premium"
 *   - "premium" → always publish
 *
 * Returns { allowed: boolean, reason?: string }.
 */
function decideContractGate(verdict, env = process.env) {
  if (!verdict || verdict.class === "reject") {
    return {
      allowed: false,
      reason:
        "contract_reject:" +
        ((verdict && verdict.reasons) || ["no_verdict"]).join("+"),
    };
  }
  const emergencyFallback =
    envFlag(env, "STUDIO_V4_ALLOW_LEGACY_FALLBACK") ||
    envFlag(env, "ALLOW_EMERGENCY_RENDER_FALLBACK");
  const premiumRequired =
    verdict.premium_required === true ||
    envFlag(env, "STUDIO_V4_PREMIUM_PUBLISH_GATE");
  if (premiumRequired && verdict.class !== "premium" && !emergencyFallback) {
    const missing = Array.isArray(verdict.premium_missing)
      ? verdict.premium_missing.join("+")
      : "unknown";
    return {
      allowed: false,
      reason: `premium_contract_required: got=${verdict.class}, missing=${missing || "unknown"}`,
    };
  }
  const block = String(env.BLOCK_BELOW_CONTRACT || "").toLowerCase() === "true";
  const floor = String(env.CONTRACT_FLOOR || "standard").toLowerCase();
  const order = { fallback: 0, standard: 1, premium: 2 };
  if (block) {
    const required = order[floor] === undefined ? 1 : order[floor];
    const got = order[verdict.class] === undefined ? -1 : order[verdict.class];
    if (got < required) {
      return {
        allowed: false,
        reason: `below_contract_floor: got=${verdict.class}, required=${floor}`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Render a one-line summary of a contract verdict for Discord.
 */
function formatContractLine(verdict) {
  if (!verdict) return "";
  const glyph = {
    premium: "💎",
    standard: "✅",
    fallback: "⚠️",
    reject: "🚫",
  };
  const parts = [
    `${glyph[verdict.class] || "?"} ${verdict.class.toUpperCase()}`,
  ];
  if (verdict.missing && verdict.missing.length > 0) {
    parts.push(`missing=${verdict.missing.join(",")}`);
  }
  if (verdict.reasons && verdict.reasons.length > 0) {
    parts.push(`reject=${verdict.reasons.join(",")}`);
  }
  if (verdict.premium_required && verdict.premium_missing?.length) {
    parts.push(`premium_missing=${verdict.premium_missing.join(",")}`);
  }
  return parts.join(" · ");
}

module.exports = {
  evaluateRenderContract,
  decideContractGate,
  formatContractLine,
  CONTRACT_CLASSES,
  PREMIUM_SOURCES,
  QUARANTINE_REASONS,
};
