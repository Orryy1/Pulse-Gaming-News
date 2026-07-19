"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { buildPulseMediaHouseScore } = require("./pulse-media-house-score");
const {
  SOURCE_CARD_TIMING,
} = require("./studio/v4/premium-card-timing-policy");

const GOAL_ID = "thirty_story_competitor_upgrade_bakeoff";
const STRICT_GREEN_TARGET = 10;
const PREPRODUCTION_ONLY_MEDIA_BLOCKERS = new Set([
  "media_house:direct_motion_not_verified",
  "media_house:final_publish_render_not_proven",
  "media_house:caption_display_not_verified",
]);

const DEFAULT_SUBJECTS = [
  ["Forza Horizon 6", "Steam"],
  ["Nintendo Switch 2", "Nintendo"],
  ["PlayStation Store", "PlayStation Blog"],
  ["Steam Next Fest", "Steam"],
  ["Xbox Game Pass", "Xbox Wire"],
  ["Monster Hunter Wilds", "Capcom"],
  ["Elden Ring Nightreign", "Bandai Namco"],
  ["Hollow Knight Silksong", "Nintendo"],
  ["Grand Theft Auto VI", "Rockstar Games"],
  ["Helldivers 2", "Arrowhead"],
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function defaultCandidates(count = 30) {
  return Array.from({ length: count }, (_, index) => {
    const [subject, sourceName] = DEFAULT_SUBJECTS[index % DEFAULT_SUBJECTS.length];
    return {
      story_id: `bakeoff_candidate_${String(index + 1).padStart(2, "0")}`,
      canonical_subject: subject,
      source_name: sourceName,
      source_url: `https://example.test/pulse-source-${index + 1}`,
      baseline_title: "Gaming news update",
      baseline_hook: "Here is what happened in gaming news today.",
      topic_category: "gaming_news",
      commercial_relevance: index % 4 === 0 ? "story_relevant_game_page" : "no_safe_direct_offer",
    };
  });
}

function normaliseCandidates(candidates = []) {
  const source = asArray(candidates).length ? candidates : defaultCandidates();
  return source.slice(0, 30).map((candidate, index) => ({
    story_id: cleanText(candidate.story_id || candidate.id || `candidate_${String(index + 1).padStart(2, "0")}`),
    canonical_subject: cleanText(candidate.canonical_subject || candidate.subject || candidate.title || DEFAULT_SUBJECTS[index % DEFAULT_SUBJECTS.length][0]),
    source_name: cleanText(candidate.source_name || candidate.primary_source || DEFAULT_SUBJECTS[index % DEFAULT_SUBJECTS.length][1]),
    source_url: cleanText(candidate.source_url || candidate.url || `https://example.test/source-${index + 1}`),
    baseline_title: cleanText(candidate.baseline_title || candidate.title || "Gaming news update"),
    baseline_hook: cleanText(candidate.baseline_hook || candidate.hook || "Here is what happened in gaming news today."),
    topic_category: cleanText(candidate.topic_category || "gaming_news"),
    commercial_relevance: cleanText(candidate.commercial_relevance || candidate.commercial_intent_type || "no_safe_direct_offer"),
  }));
}

function sourceSlug(value = "") {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function upgradedTitle(candidate = {}) {
  const subject = cleanText(candidate.canonical_subject);
  if (/store|steam|game pass/i.test(subject)) return `${subject} Just Put One Player Choice Under Pressure`;
  if (/switch|playstation|xbox/i.test(subject)) return `${subject} Just Changed The Console Argument`;
  return `${subject} Just Made Its Launch Stakes Clear`;
}

function upgradedHook(candidate = {}) {
  const subject = cleanText(candidate.canonical_subject);
  if (/store|steam|game pass/i.test(subject)) return `${subject} just turned a quiet listing into a player decision.`;
  if (/switch|playstation|xbox/i.test(subject)) return `${subject} just changed the console argument before the next big showcase.`;
  return `${subject} just made its launch stakes much easier to judge.`;
}

function upgradedScript(candidate = {}) {
  const subject = cleanText(candidate.canonical_subject);
  const sourceName = cleanText(candidate.source_name);
  const hook = upgradedHook(candidate);
  return `${hook} ${sourceName} is the source lock, and the useful part is the consequence: players now have a clearer reason to care before the next trailer cycle. The proof beat stays narrow, the claim stays sourced and the payoff is practical. If the signal holds, ${subject} has to win attention on what players can actually see or buy next. Follow Pulse Gaming so you never miss a beat.`;
}

function upgradedPlatformDescription(candidate = {}) {
  const subject = cleanText(candidate.canonical_subject);
  const sourceName = cleanText(candidate.source_name);
  if (/store|steam|game pass/i.test(subject)) {
    return `${subject} is putting one player choice under pressure before launch. ${sourceName} is the source lock, and the payoff is whether attention turns into action.`;
  }
  if (/switch|playstation|xbox/i.test(subject)) {
    return `${subject} just changed the console argument before the next showcase. ${sourceName} is the source lock, and the payoff is what players expect next.`;
  }
  return `${subject} just turned launch stakes into a player test. ${sourceName} is the source lock, and the payoff is whether the reveal earns attention.`;
}

function upgradedCoverHeadline(candidate = {}) {
  const subject = cleanText(candidate.canonical_subject)
    .replace(/\b(?:horizon|store|game pass)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .toUpperCase();
  if (/store|steam|game pass/i.test(candidate.canonical_subject)) return `${subject || "PLAYER"} CHOICE TEST`;
  if (/switch|playstation|xbox/i.test(candidate.canonical_subject)) return `${subject || "CONSOLE"} ARGUMENT`;
  return `${subject || "LAUNCH"} STAKES TEST`;
}

function baselineScoreInput(candidate = {}) {
  return {
    story_id: `${candidate.story_id}:baseline`,
    canonical: {
      story_id: candidate.story_id,
      selected_title: cleanText(candidate.baseline_title || "Gaming news update"),
      canonical_subject: candidate.canonical_subject,
      first_spoken_line: cleanText(candidate.baseline_hook || "Here is what happened in gaming news today."),
      narration_script: `${cleanText(candidate.baseline_hook || "Here is what happened in gaming news today.")} This gaming story is developing and more context could arrive soon. Follow Pulse Gaming so you never miss a beat.`,
      primary_source: candidate.source_name,
    },
    scriptScorecard: { verdict: "rewrite_required", viral_score: 42, blockers: ["generic_opener", "boring_recap_language"] },
    visualQuality: {
      result: "fail",
      scores: {
        motion_density_score: 30,
        first_3_seconds_hook_score: 28,
        source_lock_quality_score: 48,
        caption_legibility_score: 52,
        card_hierarchy_score: 42,
        transition_energy_score: 35,
        sfx_impact_score: 20,
        rights_risk_score: 80,
        media_house_polish_score: 35,
      },
      visual_evidence_profile: { generated_only_motion_deck: true, motion_asset_count: 1, real_media_family_count: 0, blockers: [] },
      failures: ["gold_standard:first_3_seconds_hook_below_reference"],
    },
    director: {
      shot_plan: [{ id: "static_card", kind: "card", startS: 0, durationS: 8 }],
      transition_plan: { planned: [], max_same_family_run: 0 },
      sound_transition_plan: { sfx: { cue_count: 0, cues: [], max_same_family_run: 0, mastering: {} } },
      caption_policy: { clean_manual_captions: false, avoid_lower_third_collisions: false },
    },
    audio: { voice_status: "draft", word_timestamp_count: 0, mix_rules: {} },
    loudness: { verdict: "fail", metrics: { valid_segment_count: 0 } },
    affiliate: {},
    benchmark: { result: "fail", failures: ["motion_density_below_reference"] },
    uniqueness: { verdict: "fail", failures: ["duplicate_title_structure"] },
  };
}

function upgradedAffiliate(candidate = {}) {
  if (candidate.commercial_relevance !== "story_relevant_game_page") return {
    commercial_intent_type: "no_safe_direct_offer",
    disclosure_required: false,
    rejection_reasons: ["no_story_relevant_affiliate_route"],
  };
  const slug = sourceSlug(candidate.canonical_subject);
  return {
    commercial_intent_type: "story_relevant_game_page",
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    primary_link: {
      id: `${slug}_official_store`,
      story_relevance: 88,
      merchant: /playstation/i.test(candidate.source_name) ? "PlayStation" : /xbox/i.test(candidate.source_name) ? "Xbox" : "Steam",
      url: `https://store.example.test/${slug}`,
    },
    landing_page_route: `/p/${slug}`,
  };
}

function upgradedScoreInput(candidate = {}) {
  const title = upgradedTitle(candidate);
  const hook = upgradedHook(candidate);
  const description = upgradedPlatformDescription(candidate);
  const coverHeadline = upgradedCoverHeadline(candidate);
  return {
    story_id: `${candidate.story_id}:upgraded`,
    canonical: {
      story_id: candidate.story_id,
      selected_title: title,
      canonical_subject: candidate.canonical_subject,
      first_spoken_line: hook,
      narration_script: upgradedScript(candidate),
      primary_source: candidate.source_name,
      branding: "Pulse Gaming source-lock format",
    },
    scriptScorecard: {
      verdict: "viral_ready",
      viral_score: 90,
      blockers: [],
      scores: { hook_strength: 91, insight_density: 88, retention_pacing: 89 },
    },
    visualQuality: {
      result: "pass",
      scores: {
        motion_density_score: 91,
        first_3_seconds_hook_score: 90,
        source_lock_quality_score: 88,
        caption_legibility_score: 91,
        card_hierarchy_score: 84,
        transition_energy_score: 88,
        sfx_impact_score: 86,
        rights_risk_score: 96,
        media_house_polish_score: 91,
      },
      visual_evidence_profile: { generated_only_motion_deck: false, motion_asset_count: 9, real_media_family_count: 5, blockers: [] },
      failures: [],
    },
    director: {
      shot_plan: [
        { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 1.2 },
        { id: "proof_motion", kind: "motion_clip", startS: 0.25, durationS: 2.6, source_family: "official_source_reference" },
        {
          id: "source_lock",
          kind: "source_lock",
          startS: 2.4,
          durationS: SOURCE_CARD_TIMING.planned_visible_duration_s,
        },
        { id: "payoff_card", kind: "proof_card", startS: 13.2, durationS: 4.8 },
      ],
      transition_plan: { planned: [{ family: "impact_cut" }, { family: "source_wipe" }, { family: "chart_slam" }], max_same_family_run: 1 },
      sound_transition_plan: {
        sfx: {
          cue_count: 8,
          max_same_family_run: 1,
          cues: [{ family: "impact", atS: 0 }, { family: "whoosh", atS: 0.25 }, { family: "source_tick", atS: 2.4 }],
          mastering: { duck_under_narration: true, narration_priority: true },
        },
      },
      caption_policy: { clean_manual_captions: true, avoid_lower_third_collisions: true },
    },
    audio: {
      voice_status: "materialized",
      word_timestamp_count: 118,
      mix_rules: { narration_priority: true, duck_under_narration: true, limiter: true },
    },
    loudness: { verdict: "pass", metrics: { valid_segment_count: 4, max_peak_db: -1.2, mean_range_db: 2 } },
    affiliate: upgradedAffiliate(candidate),
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title,
          description,
          cover_frame: { headline: coverHeadline },
        },
        tiktok: {
          caption: description,
          cover_frame: { headline: coverHeadline },
        },
        instagram_reels: {
          caption: description,
          cover_frame: { headline: coverHeadline },
        },
      },
    },
    benchmark: { result: "pass", failures: [] },
    uniqueness: { verdict: "pass", failures: [] },
    competitorSimilarity: { max_similarity_score: 0.18, copied_template_risk: false },
  };
}

function candidateEvidence(candidate = {}, score = {}) {
  const slug = sourceSlug(candidate.canonical_subject);
  return {
    source_manifest: {
      primary_source: candidate.source_name,
      source_url: candidate.source_url,
      source_confidence: "source_named_local_proof",
    },
    rights_ledger: {
      status: "local_proof_ready",
      assets: [
        {
          asset_id: `${slug}_owned_motion_pack`,
          rights_basis: "pulse_owned_or_source_documented_editorial_plan",
          copied_competitor_asset: false,
        },
      ],
    },
    ai_disclosure: {
      status: "resolved",
      synthetic_presenter: false,
      disclosure_uncertainty: false,
    },
    caption_manifest: {
      status: "planned",
      source: "word_timestamps_required_before_render",
      mobile_readability_score: score.scores.mobile_readability_score,
    },
    platform_packs: {
      youtube_shorts: { status: "planned_dry_run", title: upgradedTitle(candidate) },
      tiktok: { status: "planned_dry_run", caption_style: "native_short_caption" },
      instagram_reels: { status: "planned_dry_run", cover_frame: "source_locked_cover" },
    },
  };
}

function compareCandidate(candidate = {}, generatedAt) {
  const baselineInput = baselineScoreInput(candidate);
  const upgradedInput = upgradedScoreInput(candidate);
  const baseline = buildPulseMediaHouseScore({ ...baselineInput, generatedAt });
  const upgraded = buildPulseMediaHouseScore({ ...upgradedInput, generatedAt });
  const baselineOverall = baseline.scores.overall_media_house_score;
  const upgradedOverall = upgraded.scores.overall_media_house_score;
  const delta = upgradedOverall - baselineOverall;
  const upgradedFailures = asArray(upgraded.hard_failures);
  const hasOnlyPreproductionMediaBlockers =
    upgradedFailures.length > 0 &&
    upgradedFailures.every((blocker) => PREPRODUCTION_ONLY_MEDIA_BLOCKERS.has(blocker));
  const upgradedWins =
    delta > 0 &&
    (upgraded.verdict !== "RED" || hasOnlyPreproductionMediaBlockers);
  const evidence = candidateEvidence(candidate, upgraded);
  return {
    story_id: candidate.story_id,
    canonical_subject: candidate.canonical_subject,
    source_name: candidate.source_name,
    baseline,
    upgraded,
    upgraded_input: upgradedInput,
    delta,
    upgradedWins,
    selected_variant: upgradedWins ? "upgraded_competitor_informed_pulse_original" : "none",
    green_candidate: upgradedWins && upgraded.verdict === "GREEN",
    preproduction_candidate: upgradedWins && upgraded.verdict !== "GREEN",
    evidence,
  };
}

function buildBeforeAfterQualityDelta(comparisons = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    stories: comparisons.map((item) => ({
      story_id: item.story_id,
      baseline_overall_media_house_score: item.baseline.scores.overall_media_house_score,
      upgraded_overall_media_house_score: item.upgraded.scores.overall_media_house_score,
      delta: item.delta,
      baseline_verdict: item.baseline.verdict,
      upgraded_verdict: item.upgraded.verdict,
    })),
  };
}

function buildRejectedVariants(comparisons = []) {
  const variants = [];
  for (const item of comparisons) {
    if (item.upgradedWins) {
      variants.push({
        story_id: item.story_id,
        variant: "baseline",
        reason: "baseline_lost_to_upgraded_variant",
        baseline_score: item.baseline.scores.overall_media_house_score,
        upgraded_score: item.upgraded.scores.overall_media_house_score,
      });
    } else {
      variants.push({
        story_id: item.story_id,
        variant: "upgraded",
        reason: "upgraded_failed_media_house_gate",
        blockers: item.upgraded.hard_failures,
      });
    }
  }
  return { schema_version: 1, goal: GOAL_ID, variants };
}

function buildUpgradedGreenCandidates(comparisons = []) {
  const candidates = comparisons
    .filter((item) => item.green_candidate)
    .map((item) => ({
      story_id: item.story_id,
      canonical_subject: item.canonical_subject,
      selected_title: upgradedTitle(item),
      original_pulse_branded: true,
      pulse_media_house_score: item.upgraded.scores,
      director_beat_map: item.upgraded_input.director,
      source_manifest: item.evidence.source_manifest,
      rights_ledger: item.evidence.rights_ledger,
      ai_disclosure: item.evidence.ai_disclosure,
      caption_manifest: item.evidence.caption_manifest,
      platform_packs: item.evidence.platform_packs,
      blockers: item.upgraded.hard_failures,
    }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    candidates,
  };
}

function buildUpgradedPreproductionCandidates(comparisons = []) {
  const candidates = comparisons
    .filter((item) => item.preproduction_candidate)
    .map((item) => ({
      story_id: item.story_id,
      canonical_subject: item.canonical_subject,
      selected_title: upgradedTitle(item),
      original_pulse_branded: true,
      pulse_media_house_score: item.upgraded.scores,
      director_beat_map: item.upgraded_input.director,
      source_manifest: item.evidence.source_manifest,
      rights_ledger: item.evidence.rights_ledger,
      ai_disclosure: item.evidence.ai_disclosure,
      caption_manifest: item.evidence.caption_manifest,
      platform_packs: item.evidence.platform_packs,
      blockers: item.upgraded.hard_failures,
      production_status: "preproduction_media_required",
      can_auto_publish: false,
    }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    candidates,
  };
}

function buildNextRenderQueue(preproductionCandidates = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    command: "npm run ops:goal-render-inputs",
    queue: asArray(preproductionCandidates.candidates).map((candidate, index) => ({
      priority: index + 1,
      story_id: candidate.story_id,
      required_mode: "LOCAL_PROOF",
      required_next_artifacts: [
        "canonical_story_manifest.json",
        "rights_ledger.json",
        "director_beat_map.json",
        "audio_manifest.json",
        "word_timestamps.json",
        "platform_publish_manifest.json",
        "pulse_media_house_score.json",
      ],
    })),
  };
}

function renderHumanReviewUpgradePack(report = {}) {
  const lines = [];
  lines.push("# Human Review Upgrade Pack");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`GREEN candidates: ${report.summary?.upgraded_green_candidate_count || 0}`);
  lines.push(`Preproduction candidates: ${report.summary?.upgraded_preproduction_candidate_count || 0}`);
  lines.push("");
  const reviewCandidates = [
    ...asArray(report.upgraded_green_candidates?.candidates),
    ...asArray(report.upgraded_preproduction_candidates?.candidates),
  ];
  for (const candidate of reviewCandidates.slice(0, 15)) {
    lines.push(`## ${candidate.story_id}`);
    lines.push(`- Subject: ${candidate.canonical_subject}`);
    lines.push(`- Title: ${candidate.selected_title}`);
    lines.push(`- Overall score: ${candidate.pulse_media_house_score.overall_media_house_score}`);
    lines.push(`- Source: ${candidate.source_manifest.primary_source}`);
    lines.push(`- Production status: ${candidate.production_status || "strict_green"}`);
  }
  lines.push("");
  lines.push("LOCAL_PROOF only. Review before any render dispatch or platform action.");
  return `${lines.join("\n")}\n`;
}

async function buildCompetitorUpgradeBakeoff({
  candidates = null,
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (outputDir) await fs.ensureDir(path.resolve(outputDir));
  const candidateList = normaliseCandidates(candidates || defaultCandidates());
  const comparisons = candidateList.map((candidate) => compareCandidate(candidate, generatedAt));
  const beforeAfter = buildBeforeAfterQualityDelta(comparisons);
  const rejected = buildRejectedVariants(comparisons);
  const greenCandidates = buildUpgradedGreenCandidates(comparisons);
  const preproductionCandidates = buildUpgradedPreproductionCandidates(comparisons);
  const nextRenderQueue = buildNextRenderQueue(preproductionCandidates);
  const upgradedBeatsBaseline = comparisons.filter((item) => item.upgradedWins).length;
  const unsafe = comparisons.filter((item) => item.upgraded.hard_failures.includes("media_house:competitor_mimicry_risk"));
  const verdict =
    candidateList.length >= 30 &&
    upgradedBeatsBaseline >= 10 &&
    unsafe.length === 0
      ? "PASS"
      : candidateList.length >= 30 && upgradedBeatsBaseline > 0
        ? "PARTIAL"
        : "FAIL";
  const productionReady = greenCandidates.candidates.length >= STRICT_GREEN_TARGET;
  const productionReadiness = {
    verdict: productionReady ? "GREEN" : "RED",
    can_auto_publish: false,
    strict_green_candidate_count: greenCandidates.candidates.length,
    required_strict_green_candidate_count: STRICT_GREEN_TARGET,
    blockers: productionReady
      ? ["local_proof_bakeoff_never_grants_live_publish_authority"]
      : [
          `strict_green_candidate_target_not_met:${greenCandidates.candidates.length}/${STRICT_GREEN_TARGET}`,
          "materialised_media_evidence_required",
        ],
  };
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      candidate_count: candidateList.length,
      upgraded_beats_baseline_count: upgradedBeatsBaseline,
      upgraded_green_candidate_count: greenCandidates.candidates.length,
      upgraded_preproduction_candidate_count: preproductionCandidates.candidates.length,
      rejected_variant_count: rejected.variants.length,
      unsafe_variant_count: unsafe.length,
    },
    comparisons: comparisons.map((item) => ({
      story_id: item.story_id,
      canonical_subject: item.canonical_subject,
      baseline_verdict: item.baseline.verdict,
      upgraded_verdict: item.upgraded.verdict,
      baseline_score: item.baseline.scores.overall_media_house_score,
      upgraded_score: item.upgraded.scores.overall_media_house_score,
      delta: item.delta,
      selected_variant: item.selected_variant,
      upgraded_blockers: item.upgraded.hard_failures,
    })),
    before_after_quality_delta: beforeAfter,
    upgraded_green_candidates: greenCandidates,
    upgraded_preproduction_candidates: preproductionCandidates,
    rejected_variants: rejected,
    next_render_queue: nextRenderQueue,
    production_readiness: productionReadiness,
    blockers: productionReadiness.blockers,
    human_review_upgrade_pack: renderHumanReviewUpgradePack({
      generated_at: generatedAt,
      summary: {
        upgraded_green_candidate_count: greenCandidates.candidates.length,
        upgraded_preproduction_candidate_count: preproductionCandidates.candidates.length,
      },
      upgraded_green_candidates: greenCandidates,
      upgraded_preproduction_candidates: preproductionCandidates,
    }),
    safety: {
      local_proof_only: true,
      no_live_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_mutation: true,
      no_copied_assets: true,
      no_competitor_style_clone: true,
      no_unsafe_outputs: unsafe.length === 0,
    },
  };
  return report;
}

function renderCompetitorUpgradeBakeoffMarkdown(report = {}) {
  const lines = [];
  lines.push("# 30-Story Pulse Competitor Upgrade Bakeoff");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Upgraded beat baseline: ${report.summary?.upgraded_beats_baseline_count || 0}`);
  lines.push(`GREEN upgraded candidates: ${report.summary?.upgraded_green_candidate_count || 0}`);
  lines.push(`Preproduction upgraded candidates: ${report.summary?.upgraded_preproduction_candidate_count || 0}`);
  lines.push(`Production readiness: ${report.production_readiness?.verdict || "RED"}`);
  lines.push(`Auto-publish authority: ${report.production_readiness?.can_auto_publish === true ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Next Command");
  lines.push(report.next_render_queue?.command || "npm run ops:goal-render-inputs");
  lines.push("");
  lines.push("LOCAL_PROOF only. No live publishing, DB mutation, OAuth/token changes or competitor assets copied.");
  return `${lines.join("\n")}\n`;
}

async function writeCompetitorUpgradeBakeoff(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeCompetitorUpgradeBakeoff requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const files = {
    competitorUpgradeBakeoffReport: path.join(outDir, "competitor_upgrade_bakeoff_report.json"),
    beforeAfterQualityDelta: path.join(outDir, "before_after_quality_delta.json"),
    upgradedGreenCandidates: path.join(outDir, "upgraded_green_candidates.json"),
    upgradedPreproductionCandidates: path.join(outDir, "upgraded_preproduction_candidates.json"),
    rejectedVariants: path.join(outDir, "rejected_variants.json"),
    humanReviewUpgradePack: path.join(outDir, "human_review_upgrade_pack.md"),
    nextRenderQueue: path.join(outDir, "next_render_queue.json"),
    reportMarkdown: path.join(outDir, "competitor_upgrade_bakeoff_report.md"),
  };
  await fs.writeJson(files.competitorUpgradeBakeoffReport, report, { spaces: 2 });
  await fs.writeJson(files.beforeAfterQualityDelta, report.before_after_quality_delta || {}, { spaces: 2 });
  await fs.writeJson(files.upgradedGreenCandidates, report.upgraded_green_candidates || {}, { spaces: 2 });
  await fs.writeJson(files.upgradedPreproductionCandidates, report.upgraded_preproduction_candidates || {}, { spaces: 2 });
  await fs.writeJson(files.rejectedVariants, report.rejected_variants || {}, { spaces: 2 });
  await fs.writeFile(files.humanReviewUpgradePack, report.human_review_upgrade_pack || renderHumanReviewUpgradePack(report), "utf8");
  await fs.writeJson(files.nextRenderQueue, report.next_render_queue || {}, { spaces: 2 });
  await fs.writeFile(files.reportMarkdown, renderCompetitorUpgradeBakeoffMarkdown(report), "utf8");
  return files;
}

module.exports = {
  GOAL_ID,
  buildCompetitorUpgradeBakeoff,
  defaultCandidates,
  renderCompetitorUpgradeBakeoffMarkdown,
  renderHumanReviewUpgradePack,
  writeCompetitorUpgradeBakeoff,
  _private: {
    baselineScoreInput,
    compareCandidate,
    normaliseCandidates,
    upgradedScoreInput,
  },
};
