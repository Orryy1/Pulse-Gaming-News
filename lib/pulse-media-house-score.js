"use strict";

const GOAL_ID = "pulse_media_house_score_v1";

const SCORE_KEYS = [
  "title_strength_score",
  "first_frame_score",
  "first_3_seconds_score",
  "script_punch_score",
  "narration_quality_score",
  "motion_density_score",
  "transition_energy_score",
  "sound_design_score",
  "mobile_readability_score",
  "brand_recognition_score",
  "source_trust_score",
  "commercial_trust_score",
  "ending_payoff_score",
  "competitor_parity_score",
  "competitor_surpass_score",
  "overall_media_house_score",
];

const THRESHOLDS = {
  overall_media_house_score: 78,
  competitor_parity_score: 72,
  competitor_surpass_score: 68,
  first_3_seconds_score: 70,
  title_strength_score: 70,
  script_punch_score: 70,
  motion_density_score: 70,
  sound_design_score: 65,
  mobile_readability_score: 70,
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function average(values = []) {
  const finite = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!finite.length) return 0;
  return clampScore(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function scoreFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clampScore(number) : fallback;
}

function words(value) {
  return cleanText(value).split(/\s+/).filter(Boolean);
}

function normalise(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleText(canonical = {}) {
  return cleanText(canonical.selected_title || canonical.public_title || canonical.canonical_title || canonical.title);
}

function subjectText(canonical = {}) {
  return cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.subject || canonical.game || "");
}

function firstLine(canonical = {}) {
  const explicit = cleanText(canonical.first_spoken_line || canonical.hook);
  if (explicit) return explicit;
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  return script.split(/(?<=[.!?])\s+/)[0] || script;
}

function hasSubject(text = "", subject = "") {
  const haystack = normalise(text);
  const needle = normalise(subject);
  if (!haystack || !needle || needle === "this story") return false;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(/\s+/).filter((token) => token.length >= 4 && !["game", "news", "story", "the", "and", "for"].includes(token));
  return tokens.some((token) => haystack.includes(token));
}

function genericTitle(title = "") {
  return /^(?:gaming news update|new gaming update|this gaming story|this story|gaming update|source-backed update)$/i.test(cleanText(title));
}

function slowOpening(text = "") {
  return /^(?:here'?s|here is|today|so|welcome|in this video|let'?s talk about)\b/i.test(cleanText(text));
}

function internalLanguage(text = "") {
  return /\b(?:source-backed update|not a blank check|invent extra details|named source confirms|wait-and-see column|reddit reaction into evidence|the useful caveat is|the safest public version is|internal qa|qa language)\b/i.test(text);
}

function consequenceLanguage(text = "") {
  return /\b(?:problem|risk|catch|warning|changed|broke|revealed|confirmed|finally|pushback|why|before|after|ceiling|impact|cost|deal|launch|date|proof|payoff)\b/i.test(text);
}

function repeatedSentenceRisk(canonical = {}) {
  const sentences = cleanText(canonical.narration_script || canonical.full_script || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalise(sentence))
    .filter(Boolean);
  return new Set(sentences).size < sentences.length;
}

function titleStrengthScore(canonical = {}, uniqueness = {}) {
  const title = titleText(canonical);
  const subject = subjectText(canonical);
  let score = 35;
  if (title && !genericTitle(title)) score += 18;
  if (hasSubject(title, subject)) score += 24;
  if (consequenceLanguage(title)) score += 18;
  if (words(title).length >= 5 && words(title).length <= 12) score += 8;
  if (asArray(uniqueness.failures).length || asArray(uniqueness.matches).length > 3) score -= 18;
  return clampScore(score);
}

function shotPlan(director = {}) {
  return asArray(director.shot_plan || director.shots || director.beats);
}

function shotStart(shot = {}) {
  const number = Number(shot.startS ?? shot.start_s ?? shot.start ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function transitionPlan(director = {}) {
  return director.transition_plan || director.sound_transition_plan?.transitions || {};
}

function sfxPlan(director = {}) {
  return director.sound_transition_plan?.sfx || director.sfx_plan || {};
}

function firstFrameScore({ visualQuality = {}, director = {} } = {}) {
  const shots = shotPlan(director);
  const visualScore = scoreFrom(visualQuality.scores?.first_3_seconds_hook_score, 55);
  const sourceScore = scoreFrom(visualQuality.scores?.source_lock_quality_score, 55);
  const startsFast = shots.some((shot) => shotStart(shot) <= 0.35);
  const motionBeforeThree = shots.some((shot) => /motion|hook|slam|proof/i.test(cleanText(shot.kind || shot.visual_treatment)) && shotStart(shot) < 3);
  return clampScore(visualScore * 0.45 + sourceScore * 0.2 + (startsFast ? 18 : 0) + (motionBeforeThree ? 17 : 0));
}

function firstThreeScore({ canonical = {}, visualQuality = {}, director = {} } = {}) {
  const subject = subjectText(canonical);
  const line = firstLine(canonical);
  let score = average([
    scoreFrom(visualQuality.scores?.first_3_seconds_hook_score, 55),
    firstFrameScore({ visualQuality, director }),
  ]);
  if (hasSubject(line, subject)) score += 12;
  if (slowOpening(line)) score -= 35;
  if (consequenceLanguage(line)) score += 8;
  if (internalLanguage(line)) score -= 25;
  return clampScore(score);
}

function scriptPunchScore({ canonical = {}, scriptScorecard = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  let score = scoreFrom(scriptScorecard.viral_score, 72);
  if (cleanText(scriptScorecard.verdict) === "viral_ready") score += 8;
  if (cleanText(scriptScorecard.verdict) === "rewrite_required") score -= 35;
  if (asArray(scriptScorecard.blockers).length) score -= Math.min(32, asArray(scriptScorecard.blockers).length * 8);
  if (slowOpening(firstLine(canonical))) score -= 28;
  if (internalLanguage(script)) score -= 35;
  if (repeatedSentenceRisk(canonical)) score -= 20;
  if (!consequenceLanguage(script)) score -= 12;
  return clampScore(score);
}

function narrationQualityScore({ canonical = {}, audio = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  const wordCount = words(script).length;
  let score = 45;
  if (cleanText(audio.voice_status) === "materialized") score += 18;
  if (Number(audio.word_timestamp_count || 0) > 0) score += 18;
  if (audio.mix_rules?.narration_priority === true) score += 8;
  if (wordCount >= 75 && wordCount <= 155) score += 9;
  else if (wordCount >= 35 && wordCount <= 190) score += 4;
  if (internalLanguage(script)) score -= 25;
  return clampScore(score);
}

function transitionEnergyScore({ visualQuality = {}, director = {} } = {}) {
  const plan = transitionPlan(director);
  const transitions = asArray(plan.planned);
  const families = transitions.map((entry) => cleanText(entry.family || entry.transition_family)).filter(Boolean);
  let score = scoreFrom(visualQuality.scores?.transition_energy_score, 55);
  score += Math.min(12, new Set(families).size * 3);
  if (Number(plan.max_same_family_run || plan.max_same_transition_run || 1) <= 2) score += 6;
  return clampScore(score);
}

function soundDesignScore({ visualQuality = {}, director = {}, loudness = {} } = {}) {
  const sfx = sfxPlan(director);
  const cues = asArray(sfx.cues);
  let score = scoreFrom(visualQuality.scores?.sfx_impact_score, 55);
  score += Math.min(16, Number(sfx.cue_count || cues.length || 0) * 2);
  if (cues.some((cue) => /impact|hit|whoosh|riser|slam/i.test(cleanText(cue.family || cue.role)))) score += 8;
  if (Number(sfx.max_same_family_run || 1) > 2) score -= 24;
  if (sfx.mastering?.duck_under_narration === false || sfx.mastering?.narration_priority === false) score -= 24;
  if (!["pass", "passed", "green", "ready", ""].includes(cleanText(loudness.verdict || loudness.status).toLowerCase())) score -= 22;
  if (Number(loudness.metrics?.valid_segment_count || 0) > 0 && Number(loudness.metrics?.valid_segment_count || 0) < 3) score -= 14;
  if (Number(loudness.metrics?.max_peak_db || -99) > -0.8) score -= 14;
  return clampScore(score);
}

function mobileReadabilityScore({ visualQuality = {}, director = {} } = {}) {
  const caption = scoreFrom(visualQuality.scores?.caption_legibility_score, 55);
  const source = scoreFrom(visualQuality.scores?.source_lock_quality_score, 55);
  const card = scoreFrom(visualQuality.scores?.card_hierarchy_score, 55);
  const policy = director.caption_policy || {};
  let score = average([caption, source, card]);
  if (policy.avoid_lower_third_collisions === true) score += 5;
  if (policy.avoid_lower_third_collisions === false) score -= 18;
  return clampScore(score);
}

function commercialTrustScore({ affiliate = {} } = {}) {
  const hasOffer = Boolean(affiliate.primary_link || asArray(affiliate.fallback_links).length);
  if (!hasOffer) return 82;
  const relevance = scoreFrom(affiliate.primary_link?.story_relevance ?? affiliate.relevance_score, 50);
  const disclosureRequired = affiliate.disclosure_required === true;
  const disclosurePresent = objectText(affiliate.disclosure_copy || affiliate.platform_disclosure).length > 0;
  let score = relevance;
  if (!disclosureRequired || disclosurePresent) score += 15;
  else score -= 35;
  if (/\b(?:buy now|must buy|use my link|limited time|grab yours)\b/i.test(objectText(affiliate))) score -= 30;
  if (/\b(?:crypto|forex|casino|betting|adult)\b/i.test(objectText(affiliate.primary_link))) score -= 35;
  return clampScore(score);
}

function endingPayoffScore({ canonical = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  const beforeCta = sentences.filter((sentence) => !/\b(follow|subscribe|comment|like)\b/i.test(sentence)).join(" ");
  let score = 48;
  if (/\b(payoff|means|because|so |that gives|that makes|what matters|players|viewer|before launch|now has to)\b/i.test(beforeCta)) score += 28;
  if (/\b(follow pulse gaming|follow)\b/i.test(script)) score += 10;
  if (/\blet me know in the comments\b/i.test(script)) score -= 26;
  if (sentences.length >= 3) score += 8;
  return clampScore(score);
}

function brandRecognitionScore({ canonical = {}, competitorSimilarity = {} } = {}) {
  let score = 76;
  const text = cleanText(`${canonical.narration_script || ""} ${canonical.branding || ""}`);
  if (/\bpulse gaming\b/i.test(text)) score += 14;
  if (competitorSimilarity.copied_template_risk === true || Number(competitorSimilarity.max_similarity_score || 0) >= 0.88) score -= 45;
  if (competitorSimilarity.photorealistic_fake_presenter_uncertainty === true) score -= 35;
  return clampScore(score);
}

function sourceTrustScore({ canonical = {}, visualQuality = {}, benchmark = {} } = {}) {
  let score = average([
    scoreFrom(visualQuality.scores?.source_lock_quality_score, 65),
    scoreFrom(visualQuality.scores?.rights_risk_score, 70),
  ]);
  if (cleanText(canonical.primary_source || canonical.source_name)) score += 8;
  if (!["pass", "green", "ready", ""].includes(cleanText(benchmark.result || benchmark.verdict || benchmark.status).toLowerCase())) score -= 18;
  return clampScore(score);
}

function buildScores(input = {}) {
  const canonical = input.canonical || {};
  const visualQuality = input.visualQuality || {};
  const director = input.director || {};
  const scores = {
    title_strength_score: titleStrengthScore(canonical, input.uniqueness || {}),
    first_frame_score: firstFrameScore({ visualQuality, director }),
    first_3_seconds_score: firstThreeScore({ canonical, visualQuality, director }),
    script_punch_score: scriptPunchScore({ canonical, scriptScorecard: input.scriptScorecard || {} }),
    narration_quality_score: narrationQualityScore({ canonical, audio: input.audio || {} }),
    motion_density_score: scoreFrom(visualQuality.scores?.motion_density_score, 55),
    transition_energy_score: transitionEnergyScore({ visualQuality, director }),
    sound_design_score: soundDesignScore({ visualQuality, director, loudness: input.loudness || {} }),
    mobile_readability_score: mobileReadabilityScore({ visualQuality, director }),
    brand_recognition_score: brandRecognitionScore({ canonical, competitorSimilarity: input.competitorSimilarity || {} }),
    source_trust_score: sourceTrustScore({ canonical, visualQuality, benchmark: input.benchmark || {} }),
    commercial_trust_score: commercialTrustScore({ affiliate: input.affiliate || {} }),
    ending_payoff_score: endingPayoffScore({ canonical }),
  };
  scores.competitor_parity_score = average([
    scores.title_strength_score,
    scores.first_frame_score,
    scores.first_3_seconds_score,
    scores.script_punch_score,
    scores.motion_density_score,
    scores.transition_energy_score,
    scores.sound_design_score,
    scores.mobile_readability_score,
    scores.source_trust_score,
  ]);
  scores.competitor_surpass_score = average([
    scores.competitor_parity_score,
    scores.brand_recognition_score,
    scores.ending_payoff_score,
    scores.commercial_trust_score,
  ]);
  scores.overall_media_house_score = average([
    scores.title_strength_score,
    scores.first_frame_score,
    scores.first_3_seconds_score,
    scores.script_punch_score,
    scores.narration_quality_score,
    scores.motion_density_score,
    scores.transition_energy_score,
    scores.sound_design_score,
    scores.mobile_readability_score,
    scores.brand_recognition_score,
    scores.source_trust_score,
    scores.commercial_trust_score,
    scores.ending_payoff_score,
    scores.competitor_parity_score,
    scores.competitor_surpass_score,
  ]);
  return scores;
}

function commercialRouteBad(affiliate = {}) {
  const hasOffer = Boolean(affiliate.primary_link || asArray(affiliate.fallback_links).length);
  if (!hasOffer) return false;
  if (scoreFrom(affiliate.primary_link?.story_relevance ?? affiliate.relevance_score, 0) < 40) return true;
  if (affiliate.disclosure_required === true && !objectText(affiliate.disclosure_copy || affiliate.platform_disclosure)) return true;
  return /\b(?:buy now|must buy|use my link|limited time|grab yours)\b/i.test(objectText(affiliate));
}

function hardFailures(input = {}, scores = {}) {
  const canonical = input.canonical || {};
  const visualQuality = input.visualQuality || {};
  const competitorSimilarity = input.competitorSimilarity || {};
  const failures = [];
  const title = titleText(canonical);
  const subject = subjectText(canonical);
  const line = firstLine(canonical);
  const visualProfile = visualQuality.visual_evidence_profile || {};
  if (genericTitle(title)) failures.push("media_house:generic_title");
  if (subject && title && !hasSubject(title, subject)) failures.push("media_house:source_title_mismatch");
  if (scores.overall_media_house_score < THRESHOLDS.overall_media_house_score) failures.push("media_house:overall_score_below_threshold");
  if (scores.competitor_parity_score < THRESHOLDS.competitor_parity_score) failures.push("media_house:competitor_parity_below_threshold");
  if (scores.first_3_seconds_score < THRESHOLDS.first_3_seconds_score || slowOpening(line)) failures.push("media_house:first_3_seconds_weak");
  if (
    visualProfile.generated_only_motion_deck === true ||
    scores.motion_density_score < THRESHOLDS.motion_density_score ||
    scoreFrom(visualQuality.scores?.media_house_polish_score, 80) < 65
  ) failures.push("media_house:visuals_look_templated");
  if (scores.script_punch_score < THRESHOLDS.script_punch_score || slowOpening(line) || internalLanguage(objectText(canonical))) {
    failures.push("media_house:script_sounds_ai_generic");
  }
  if (scores.mobile_readability_score < THRESHOLDS.mobile_readability_score) failures.push("media_house:mobile_text_unreadable");
  if (scores.sound_design_score < THRESHOLDS.sound_design_score) failures.push("media_house:poor_sfx_audio");
  if (scores.transition_energy_score < 55) failures.push("media_house:bad_visual_rhythm");
  if (competitorSimilarity.copied_template_risk === true || Number(competitorSimilarity.max_similarity_score || 0) >= 0.88) {
    failures.push("media_house:competitor_mimicry_risk");
  }
  if (commercialRouteBad(input.affiliate || {})) failures.push("media_house:commercial_route_not_trustworthy");
  return unique(failures);
}

function buildCompetitorParityReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: score.scores?.competitor_parity_score >= THRESHOLDS.competitor_parity_score ? "pass" : "blocked",
    threshold: THRESHOLDS.competitor_parity_score,
    score: score.scores?.competitor_parity_score || 0,
    blockers: asArray(score.hard_failures).filter((failure) => /parity|first_3_seconds|templated|generic|readable|rhythm/.test(failure)),
  };
}

function buildCompetitorSurpassReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: score.scores?.competitor_surpass_score >= THRESHOLDS.competitor_surpass_score ? "pass" : "needs_lift",
    threshold: THRESHOLDS.competitor_surpass_score,
    score: score.scores?.competitor_surpass_score || 0,
    lift_targets: SCORE_KEYS.filter((key) => key.endsWith("_score") && (score.scores?.[key] || 0) < 75),
  };
}

function buildUpdatedControlTowerRules() {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    ruleset: "pulse_media_house_control_tower_rules_v1",
    required_artifact: "pulse_media_house_score.json",
    hard_fail_inputs: [
      "overall_media_house_score below threshold",
      "competitor_parity_score below threshold",
      "first 3 seconds weak",
      "visuals look templated",
      "script sounds AI or generic",
      "mobile text unreadable",
      "source/title mismatch",
      "competitor mimicry risk",
    ],
    no_publish_side_effects: true,
  };
}

function buildUpgradedQualityGateReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    verdict: score.verdict,
    status: score.status,
    hard_failures: score.hard_failures,
    score_summary: score.scores,
    gate_thresholds: score.thresholds,
  };
}

function buildPulseMediaHouseScore(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const scores = buildScores(input);
  const failures = hardFailures(input, scores);
  const verdict = failures.length ? "RED" : scores.overall_media_house_score >= 86 ? "GREEN" : "AMBER";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    story_id: cleanText(input.story_id || input.canonical?.story_id || input.canonical?.id || null) || null,
    verdict,
    status: verdict === "RED" ? "fail" : "pass",
    scores,
    thresholds: THRESHOLDS,
    hard_failures: failures,
    warnings: [],
    source_method: "competitor_informed_pulse_original_quality_rules",
    competitor_similarity: input.competitorSimilarity || {},
    safety: {
      no_live_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_competitor_assets_copied: true,
      internal_research_only: true,
    },
  };
  report.competitor_parity_report = buildCompetitorParityReport(report);
  report.competitor_surpass_report = buildCompetitorSurpassReport(report);
  report.upgraded_quality_gate_report = buildUpgradedQualityGateReport(report);
  report.updated_control_tower_rules = buildUpdatedControlTowerRules();
  return report;
}

module.exports = {
  GOAL_ID,
  SCORE_KEYS,
  THRESHOLDS,
  buildCompetitorParityReport,
  buildCompetitorSurpassReport,
  buildPulseMediaHouseScore,
  buildUpdatedControlTowerRules,
  buildUpgradedQualityGateReport,
  _private: {
    genericTitle,
    hasSubject,
    slowOpening,
    titleStrengthScore,
  },
};
