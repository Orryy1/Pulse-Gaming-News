"use strict";

const {
  validateAutonomousWindowEligibilityAttestation,
} = require("./governed-youtube-release-runway");
const {
  validateGovernedFastNewsLaneDecision,
} = require("./governed-fast-news-lane-decision");

const LEGACY_BREAKING_SCORE_FLOOR = 80;
const GOVERNED_AUTO_SCORE_FLOOR = 75;
const GOVERNED_DECISION_LOOKUP_UNAVAILABLE =
  Object.freeze({
    lookup_status: "UNAVAILABLE",
  });

function text(value) {
  return String(value ?? "").trim();
}

function parseHardStops(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normaliseGovernedDecision(value) {
  if (value == null) {
    return { present: false, valid: true, decision: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { present: true, valid: false, decision: null };
  }
  const score = Number(value.total ?? value.score);
  const decision = text(value.decision).toLowerCase();
  const hardStops = parseHardStops(value.hard_stops);
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    !decision ||
    hardStops === null
  ) {
    return { present: true, valid: false, decision: null };
  }
  return {
    present: true,
    valid: true,
    score,
    decision,
    hard_stops: hardStops,
    scored_at: value.scored_at || null,
  };
}

function hasLegacyBreakingSignal(story = {}, extra = {}) {
  return (
    extra.breaking_fast_track === true ||
    extra.breaking === true ||
    Number(story.breaking_score || 0) >=
      LEGACY_BREAKING_SCORE_FLOOR ||
    /\bbreaking\b/i.test(
      `${story.classification || ""} ${story.flair || ""}`,
    )
  );
}

function validateBoundFastNewsLaneDecision({
  validatedAttestation,
  expectedAttestation,
  expectedFastNewsStoryId,
}) {
  const preparation =
    expectedAttestation &&
    typeof expectedAttestation === "object" &&
    !Array.isArray(expectedAttestation)
      ? expectedAttestation.jit_preparation
      : null;
  const supplied =
    preparation &&
    typeof preparation === "object" &&
    !Array.isArray(preparation) &&
    Object.hasOwn(
      preparation,
      "fast_news_lane_decision",
    )
      ? preparation.fast_news_lane_decision
      : null;
  if (!supplied) {
    return {
      present: false,
      valid: false,
      decision: null,
      error: null,
    };
  }
  const expectedStoryId = text(expectedFastNewsStoryId);
  if (!expectedStoryId) {
    return {
      present: true,
      valid: false,
      decision: null,
      error:
        "governed_fast_news_lane_decision_story_binding_required",
    };
  }
  let decision;
  try {
    decision =
      validateGovernedFastNewsLaneDecision(supplied, {
        story_id: expectedStoryId,
        scheduled_for: text(
          validatedAttestation?.scheduled_for,
        ),
        operational_lane_id: "breaking_short",
        public_breaking_claim_authorised: false,
      });
  } catch (error) {
    return {
      present: true,
      valid: false,
      decision: null,
      error:
        text(error?.code || error?.message) ||
        "governed_fast_news_lane_decision_invalid",
    };
  }
  return {
    present: true,
    valid: true,
    decision,
    error: null,
  };
}

function evaluateGovernedBreakingLaneEligibility({
  story = {},
  extra = {},
  latestGovernedDecision = null,
  eligibilityAttestation = null,
  attestationNow = new Date(),
  expectedAttestation = {},
  expectedFastNewsStoryId = null,
} = {}) {
  const legacySignal = hasLegacyBreakingSignal(story, extra);
  const governed =
    normaliseGovernedDecision(latestGovernedDecision);
  const attestationSupplied =
    eligibilityAttestation !== null &&
    eligibilityAttestation !== undefined;
  let validatedAttestation = null;
  let attestationError = null;
  if (attestationSupplied) {
    try {
      validatedAttestation =
        validateAutonomousWindowEligibilityAttestation(
          eligibilityAttestation,
          {
            now: attestationNow,
            expected: expectedAttestation,
          },
        );
    } catch (error) {
      attestationError =
        text(error?.code || error?.message) ||
        "autonomous_window_eligibility_invalid";
    }
  }
  const attestedSignal =
    validatedAttestation?.lane_id === "breaking_short";

  if (governed.present) {
    if (
      !governed.valid ||
      governed.decision !== "auto" ||
      governed.hard_stops.length > 0
    ) {
      return {
        eligible: false,
        basis: null,
        legacy_signal: legacySignal,
        governed_decision: governed,
        blockers: [
          "governed_breaking_lane_current_auto_decision_required",
        ],
      };
    }
  }

  if (attestationSupplied && !attestedSignal) {
    return {
      eligible: false,
      basis: null,
      legacy_signal: legacySignal,
      attested_lane_signal: false,
      attestation_error: attestationError,
      governed_decision: governed,
      blockers: [
        "governed_breaking_lane_window_attestation_invalid",
      ],
    };
  }

  const fastNewsLaneDecision = attestedSignal
    ? validateBoundFastNewsLaneDecision({
        validatedAttestation,
        expectedAttestation,
        expectedFastNewsStoryId,
      })
    : null;
  if (
    fastNewsLaneDecision?.present &&
    !fastNewsLaneDecision.valid
  ) {
    return {
      eligible: false,
      basis: null,
      legacy_signal: legacySignal,
      attested_lane_signal: true,
      fast_news_lane_decision: fastNewsLaneDecision,
      governed_decision: governed,
      blockers: [
        "governed_breaking_lane_fast_news_decision_invalid",
      ],
    };
  }

  if (attestedSignal && legacySignal) {
    return {
      eligible: true,
      basis: "HASH_BOUND_GOVERNED_WINDOW_ATTESTATION",
      legacy_signal: true,
      attested_lane_signal: true,
      attestation_sha256:
        validatedAttestation.attestation_sha256,
      ...(fastNewsLaneDecision?.valid
        ? {
            fast_news_lane_decision_sha256:
              fastNewsLaneDecision.decision
                .decision_sha256,
          }
        : {}),
      governed_decision: governed,
      blockers: [],
    };
  }

  if (attestedSignal) {
    if (
      !governed.present ||
      !governed.valid ||
      governed.decision !== "auto" ||
      governed.score < GOVERNED_AUTO_SCORE_FLOOR
    ) {
      return {
        eligible: false,
        basis: null,
        legacy_signal: legacySignal,
        attested_lane_signal: true,
        governed_decision: governed,
        blockers: [
          "governed_breaking_lane_current_auto_decision_required",
        ],
      };
    }
    if (!fastNewsLaneDecision.valid) {
      return {
        eligible: false,
        basis: null,
        legacy_signal: legacySignal,
        attested_lane_signal: true,
        fast_news_lane_decision:
          fastNewsLaneDecision,
        governed_decision: governed,
        blockers: [
          fastNewsLaneDecision.present
            ? "governed_breaking_lane_fast_news_decision_invalid"
            : "governed_breaking_lane_fast_news_decision_required",
        ],
      };
    }
    return {
      eligible: true,
      basis: "HASH_BOUND_GOVERNED_FAST_NEWS_DECISION",
      legacy_signal: legacySignal,
      attested_lane_signal: true,
      attestation_sha256:
        validatedAttestation.attestation_sha256,
      fast_news_lane_decision_sha256:
        fastNewsLaneDecision.decision.decision_sha256,
      governed_decision: governed,
      blockers: [],
    };
  }

  if (legacySignal) {
    return {
      eligible: true,
      basis: "LEGACY_BREAKING_SIGNAL",
      legacy_signal: true,
      attested_lane_signal: false,
      governed_decision: governed,
      blockers: [],
    };
  }

  return {
    eligible: false,
    basis: null,
    legacy_signal: false,
    attested_lane_signal: false,
    governed_decision: governed,
    blockers: [
      "governed_breaking_lane_eligibility_required",
    ],
  };
}

function latestGovernedDecisionFromRepositories(
  repos,
  storyId,
) {
  const exactStoryId = text(storyId);
  if (!exactStoryId) return null;
  if (typeof repos?.scoring?.latest === "function") {
    try {
      return repos.scoring.latest(exactStoryId) || null;
    } catch {
      return GOVERNED_DECISION_LOOKUP_UNAVAILABLE;
    }
  }
  if (!repos?.db || typeof repos.db.prepare !== "function") {
    return null;
  }
  try {
    return (
      repos.db
        .prepare(
          `SELECT total, decision, hard_stops, scored_at
           FROM story_scores
           WHERE story_id = ?
           ORDER BY scored_at DESC, id DESC
           LIMIT 1`,
        )
        .get(exactStoryId) || null
    );
  } catch {
    return GOVERNED_DECISION_LOOKUP_UNAVAILABLE;
  }
}

module.exports = {
  GOVERNED_AUTO_SCORE_FLOOR,
  LEGACY_BREAKING_SCORE_FLOOR,
  evaluateGovernedBreakingLaneEligibility,
  hasLegacyBreakingSignal,
  latestGovernedDecisionFromRepositories,
  normaliseGovernedDecision,
  validateBoundFastNewsLaneDecision,
};
