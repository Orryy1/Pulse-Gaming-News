"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function rel(p) {
  return String(path.relative(ROOT, p || "")).replace(/\\/g, "/");
}

function metricFromReport(report, name) {
  const auto = report?.auto?.[name];
  return auto && Object.prototype.hasOwnProperty.call(auto, "value")
    ? auto.value
    : null;
}

function normaliseGateCandidate({ key, summary = null, report = null } = {}) {
  const studio = summary?.studio || {};
  const forensic = summary?.forensic || {};
  const verdict = report?.verdict || {};
  const runtime = report?.runtime || {};
  const auto = report?.auto || {};
  const premiumLane = report?.premiumLane || {};
  const heroMoments = report?.heroMoments || null;
  const score = Number.isFinite(Number(summary?.score))
    ? Number(summary.score)
    : null;

  return {
    key: key || summary?.key || report?.storyId || "candidate",
    storyId: summary?.storyId || report?.storyId || null,
    variant: summary?.variant || "unknown",
    kind: summary?.kind || "unknown",
    score,
    studioLane: studio.lane || verdict.lane || "unknown",
    forensicVerdict: forensic.verdict || "unknown",
    forensicFailCount: Number(forensic.failCount || 0),
    forensicWarnCount: Number(forensic.warnCount || 0),
    forensicIssues: forensic.issues || [],
    audioRecurrence: forensic.audioRecurrence || "unknown",
    subtitleVerdict: forensic.subtitleVerdict || "unknown",
    visualVerdict: forensic.visualVerdict || "unknown",
    subtitleOverrunS: Number(forensic.subtitleOverrunS || 0),
    redTrips: Number(studio.redTrips ?? verdict.redTrips ?? 0),
    amberTrips: Number(studio.amberTrips ?? verdict.amberTrips ?? 0),
    greenHits: Number(studio.greenHits ?? verdict.greenHits ?? 0),
    redMetrics: studio.redMetrics || [],
    amberMetrics: studio.amberMetrics || [],
    sourceDiversity: round(
      studio.sourceDiversity ?? metricFromReport(report, "sourceDiversity"),
      3,
    ),
    beatAwarenessRatio: round(
      studio.beatAwarenessRatio ?? metricFromReport(report, "beatAwarenessRatio"),
      3,
    ),
    clipDominance: round(
      studio.clipDominance ?? metricFromReport(report, "clipDominance"),
      3,
    ),
    motionDensityPerMin: round(
      studio.motionDensityPerMin ?? metricFromReport(report, "motionDensityPerMin"),
      3,
    ),
    maxStillRepeat: Number(metricFromReport(report, "maxStillRepeat") ?? 0),
    stockFillerCount: Number(metricFromReport(report, "stockFillerCount") ?? 0),
    adjacentSameTypeCards: Number(
      metricFromReport(report, "adjacentSameTypeCards") ?? 0,
    ),
    captionGapsOver2s: Number(metricFromReport(report, "captionGapsOver2s") ?? 0),
    durationIntegrity:
      auto.durationIntegrity?.grade || studio.durationIntegrity || "unknown",
    durationS: round(studio.durationS ?? runtime.durationS, 3),
    hyperframesCardCount:
      studio.hyperframesCardCount ?? premiumLane.hyperframesCardCount ?? 0,
    premiumLaneVerdict: premiumLane.verdict || "unknown",
    sceneVariety: metricFromReport(report, "sceneVariety"),
    sceneTypes: studio.sceneTypes || (report?.sceneList || []).map((s) => s.type),
    heroMomentCount: Number(heroMoments?.momentCount || 0),
    heroMoments: heroMoments?.moments || [],
    heroOverlayApplied: heroMoments?.overlayApplied === true,
    subtitleFallbackUsed:
      report?.subtitles?.alignmentStatus === "fallback" ||
      report?.subtitles?.usedFallback === true ||
      report?.subtitleAlignmentStatus === "fallback",
    slideshowLike:
      report?.slideshowLike === true ||
      report?.human?.slideshowRisk === true ||
      report?.auto?.slideshowRisk?.value === true,
    premiumAssetsMissing:
      premiumLane.verdict && premiumLane.verdict !== "pass",
    paths: {
      mp4: summary?.paths?.mp4 || report?.outputPath || null,
      report: summary?.paths?.studioReport || null,
      forensic: summary?.paths?.forensicReport || null,
      ass: summary?.paths?.ass || report?.subtitles?.assPath || null,
    },
  };
}

function addReason(list, code, message, evidence = null) {
  list.push({ code, message, evidence });
}

function evaluateStudioRejectionGate({
  candidate,
  canonical = null,
  requireHeroMoments = false,
  minHeroMoments = 1,
} = {}) {
  const hardFails = [];
  const warnings = [];
  const greenSignals = [];
  const comparison = {};

  if (candidate.studioLane === "reject") {
    addReason(hardFails, "studio_lane_reject", "Studio rubric rejected the render.");
  } else if (candidate.studioLane === "downgrade") {
    addReason(warnings, "studio_lane_downgrade", "Studio rubric downgraded the render.");
  } else if (candidate.studioLane === "pass") {
    greenSignals.push("studio_lane_pass");
  }

  if (candidate.redTrips > 0) {
    addReason(warnings, "studio_red_metrics", "Studio rubric has red metrics.", {
      redTrips: candidate.redTrips,
      redMetrics: candidate.redMetrics,
    });
  } else {
    greenSignals.push("no_studio_red_metrics");
  }

  if (candidate.forensicVerdict === "fail" || candidate.forensicFailCount > 0) {
    addReason(hardFails, "forensic_fail", "Forensic QA failed.", {
      issues: candidate.forensicIssues,
    });
  } else if (candidate.forensicVerdict === "warn" || candidate.forensicWarnCount > 0) {
    addReason(warnings, "forensic_warn", "Forensic QA has warnings.", {
      issues: candidate.forensicIssues,
    });
  } else if (candidate.forensicVerdict === "pass") {
    greenSignals.push("forensic_pass");
  }

  if (candidate.audioRecurrence && candidate.audioRecurrence !== "pass") {
    addReason(
      hardFails,
      "audio_recurrence",
      "Audio recurrence is not allowed for a premium Studio V2.1 output.",
      { audioRecurrence: candidate.audioRecurrence },
    );
  } else if (candidate.audioRecurrence === "pass") {
    greenSignals.push("audio_recurrence_pass");
  }

  if (candidate.subtitleFallbackUsed) {
    addReason(
      hardFails,
      "subtitle_fallback",
      "Subtitle fallback/alignment reset was used on a premium output.",
    );
  }
  if (candidate.subtitleVerdict && candidate.subtitleVerdict !== "pass") {
    addReason(hardFails, "subtitle_not_pass", "Subtitle QA did not pass.", {
      subtitleVerdict: candidate.subtitleVerdict,
      subtitleOverrunS: candidate.subtitleOverrunS,
    });
  } else if (candidate.subtitleVerdict === "pass") {
    greenSignals.push("subtitle_pass");
  }
  if (candidate.captionGapsOver2s > 0) {
    addReason(hardFails, "caption_blackout", "Caption blackout gaps are present.", {
      captionGapsOver2s: candidate.captionGapsOver2s,
    });
  }

  if (candidate.durationIntegrity === "red") {
    addReason(
      hardFails,
      "duration_integrity_red",
      "Render duration does not cover narration/subtitles.",
    );
  } else if (candidate.durationIntegrity === "green") {
    greenSignals.push("duration_integrity_green");
  }

  if (candidate.slideshowLike) {
    addReason(hardFails, "slideshow_like", "Render is marked slideshow-like.");
  }
  if (candidate.stockFillerCount > 1) {
    addReason(hardFails, "stock_filler", "Stock filler appears in the slate.", {
      stockFillerCount: candidate.stockFillerCount,
    });
  } else if (candidate.stockFillerCount === 1) {
    addReason(warnings, "stock_filler_single", "One stock filler scene is present.");
  } else {
    greenSignals.push("no_stock_filler");
  }
  if (candidate.maxStillRepeat > 2) {
    addReason(hardFails, "repeated_still_abuse", "A still source repeats too often.", {
      maxStillRepeat: candidate.maxStillRepeat,
    });
  } else if (candidate.maxStillRepeat > 1) {
    addReason(warnings, "still_repeated", "A still source repeats more than once.", {
      maxStillRepeat: candidate.maxStillRepeat,
    });
  } else {
    greenSignals.push("still_repeat_controlled");
  }
  if (candidate.adjacentSameTypeCards > 0) {
    addReason(
      hardFails,
      "adjacent_duplicate_cards",
      "Adjacent same-type cards are present.",
      { adjacentSameTypeCards: candidate.adjacentSameTypeCards },
    );
  } else {
    greenSignals.push("no_adjacent_duplicate_cards");
  }

  if (requireHeroMoments && candidate.heroMomentCount < minHeroMoments) {
    addReason(
      hardFails,
      "missing_hero_moments",
      "V2.1 candidate has no meaningful hero moments.",
      { heroMomentCount: candidate.heroMomentCount, minHeroMoments },
    );
  } else if (requireHeroMoments && candidate.heroMomentCount < 2) {
    addReason(
      warnings,
      "thin_hero_moment_plan",
      "V2.1 hero moment plan is very thin.",
      { heroMomentCount: candidate.heroMomentCount },
    );
  } else if (candidate.heroMomentCount > 0) {
    greenSignals.push("hero_moments_present");
  }
  if (requireHeroMoments && !candidate.heroOverlayApplied) {
    addReason(
      warnings,
      "hero_overlay_not_applied",
      "Hero moment plan exists but no overlay was applied.",
    );
  }

  if (candidate.premiumAssetsMissing) {
    addReason(
      hardFails,
      "premium_assets_missing",
      "Premium card lane did not attach enough HyperFrames assets.",
      { premiumLaneVerdict: candidate.premiumLaneVerdict },
    );
  } else if (candidate.hyperframesCardCount >= 3) {
    greenSignals.push("premium_card_lane_pass");
  }

  if (canonical) {
    const scoreDrop =
      Number.isFinite(candidate.score) && Number.isFinite(canonical.score)
        ? canonical.score - candidate.score
        : null;
    const sourceDelta =
      Number.isFinite(candidate.sourceDiversity) &&
      Number.isFinite(canonical.sourceDiversity)
        ? candidate.sourceDiversity - canonical.sourceDiversity
        : null;
    const beatDelta =
      Number.isFinite(candidate.beatAwarenessRatio) &&
      Number.isFinite(canonical.beatAwarenessRatio)
        ? candidate.beatAwarenessRatio - canonical.beatAwarenessRatio
        : null;
    comparison.scoreDrop = round(scoreDrop, 3);
    comparison.sourceDiversityDelta = round(sourceDelta, 3);
    comparison.beatAwarenessDelta = round(beatDelta, 3);

    if (Number.isFinite(scoreDrop) && scoreDrop >= 15) {
      addReason(hardFails, "major_gauntlet_drop", "Major gauntlet drop versus canonical.", {
        candidateScore: candidate.score,
        canonicalScore: canonical.score,
        scoreDrop,
      });
    } else if (Number.isFinite(scoreDrop) && scoreDrop >= 5) {
      addReason(warnings, "gauntlet_drop", "Gauntlet score dropped versus canonical.", {
        candidateScore: candidate.score,
        canonicalScore: canonical.score,
        scoreDrop,
      });
    } else if (Number.isFinite(scoreDrop)) {
      greenSignals.push("gauntlet_score_preserved");
    }

    if (Number.isFinite(sourceDelta) && sourceDelta <= -0.05) {
      addReason(
        hardFails,
        "source_diversity_drop",
        "Source diversity materially dropped versus canonical.",
        {
          candidate: candidate.sourceDiversity,
          canonical: canonical.sourceDiversity,
          delta: round(sourceDelta, 3),
        },
      );
    } else if (Number.isFinite(sourceDelta) && sourceDelta < -0.02) {
      addReason(
        warnings,
        "source_diversity_soft_drop",
        "Source diversity slipped versus canonical.",
        {
          candidate: candidate.sourceDiversity,
          canonical: canonical.sourceDiversity,
          delta: round(sourceDelta, 3),
        },
      );
    } else if (Number.isFinite(sourceDelta)) {
      greenSignals.push("source_diversity_preserved");
    }

    if (Number.isFinite(beatDelta) && beatDelta <= -0.15) {
      addReason(
        hardFails,
        "beat_awareness_drop",
        "Beat-awareness materially dropped versus canonical.",
        {
          candidate: candidate.beatAwarenessRatio,
          canonical: canonical.beatAwarenessRatio,
          delta: round(beatDelta, 3),
        },
      );
    } else if (Number.isFinite(beatDelta) && beatDelta < -0.08) {
      addReason(
        warnings,
        "beat_awareness_soft_drop",
        "Beat-awareness slipped versus canonical.",
        {
          candidate: candidate.beatAwarenessRatio,
          canonical: canonical.beatAwarenessRatio,
          delta: round(beatDelta, 3),
        },
      );
    } else if (Number.isFinite(beatDelta)) {
      greenSignals.push("beat_awareness_preserved");
    }
  }

  const verdict = hardFails.length ? "reject" : warnings.length ? "review" : "pass";
  const recommendedNextAction =
    verdict === "pass"
      ? "Candidate is eligible for human visual review against canonical."
      : verdict === "review"
        ? "Do not promote automatically; review warnings and rendered proof."
        : "Do not promote. Keep canonical until hard-fail reasons are fixed.";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateKey: candidate.key,
    verdict,
    hardFailReasons: hardFails,
    amberWarnings: warnings,
    greenSignals: [...new Set(greenSignals)].sort(),
    metrics: {
      gauntletScore: candidate.score,
      studioLane: candidate.studioLane,
      forensicVerdict: candidate.forensicVerdict,
      sourceDiversity: candidate.sourceDiversity,
      beatAwarenessRatio: candidate.beatAwarenessRatio,
      clipDominance: candidate.clipDominance,
      motionDensityPerMin: candidate.motionDensityPerMin,
      maxStillRepeat: candidate.maxStillRepeat,
      stockFillerCount: candidate.stockFillerCount,
      adjacentSameTypeCards: candidate.adjacentSameTypeCards,
      captionGapsOver2s: candidate.captionGapsOver2s,
      audioRecurrence: candidate.audioRecurrence,
      subtitleVerdict: candidate.subtitleVerdict,
      visualVerdict: candidate.visualVerdict,
      heroMomentCount: candidate.heroMomentCount,
      hyperframesCardCount: candidate.hyperframesCardCount,
      premiumLaneVerdict: candidate.premiumLaneVerdict,
    },
    comparisonAgainstCanonical: comparison,
    heroMoments: candidate.heroMoments,
    recommendedNextAction,
  };
}

function buildGateMarkdown(report) {
  const lines = [
    "# Studio V2.1 Rejection Gate",
    "",
    `Generated: ${report.generatedAt}`,
    `Candidate: ${report.candidateKey}`,
    `Final verdict: ${report.verdict}`,
    `Recommended next action: ${report.recommendedNextAction}`,
    "",
    "## Hard Fail Reasons",
    "",
  ];
  if (!report.hardFailReasons.length) {
    lines.push("- None.");
  } else {
    for (const reason of report.hardFailReasons) {
      lines.push(`- ${reason.code}: ${reason.message}`);
    }
  }
  lines.push("", "## Amber Warnings", "");
  if (!report.amberWarnings.length) {
    lines.push("- None.");
  } else {
    for (const warning of report.amberWarnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }
  lines.push("", "## Green Signals", "");
  for (const signal of report.greenSignals) lines.push(`- ${signal}`);
  lines.push("", "## Key Metrics", "");
  for (const [key, value] of Object.entries(report.metrics)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Canonical Comparison", "");
  for (const [key, value] of Object.entries(report.comparisonAgainstCanonical)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Hero Moments", "");
  if (!report.heroMoments.length) {
    lines.push("- None.");
  } else {
    for (const moment of report.heroMoments) {
      lines.push(
        `- ${moment.type} @ ${moment.targetTimestampS}s: ${moment.editorialReason}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function loadGateInputFromGauntlet({
  storyId = "1sn9xhe",
  variant = "v21",
  outputDir = TEST_OUT,
} = {}) {
  const gauntletPath = path.join(outputDir, "studio_v2_gauntlet_report.json");
  const gauntlet = await fs.readJson(gauntletPath);
  const find = (key) => gauntlet.candidates.find((candidate) => candidate.key === key);
  const candidateSummary = find(`${storyId}:${variant}`);
  const canonicalSummary = find(`${storyId}:canonical`);
  if (!candidateSummary) {
    throw new Error(`candidate not found in gauntlet: ${storyId}:${variant}`);
  }
  if (!canonicalSummary) {
    throw new Error(`canonical not found in gauntlet: ${storyId}:canonical`);
  }
  const candidateReport = await fs.readJson(
    path.join(ROOT, candidateSummary.paths.studioReport),
  );
  const canonicalReport = await fs.readJson(
    path.join(ROOT, canonicalSummary.paths.studioReport),
  );
  return {
    gauntlet,
    candidate: normaliseGateCandidate({
      key: candidateSummary.key,
      summary: candidateSummary,
      report: candidateReport,
    }),
    canonical: normaliseGateCandidate({
      key: canonicalSummary.key,
      summary: canonicalSummary,
      report: canonicalReport,
    }),
    calibration: gauntlet.candidates
      .filter((candidate) =>
        [`${storyId}:canonical`, `${storyId}:authored`].includes(candidate.key),
      )
      .map((summary) => ({
        summary,
        reportPath: path.join(ROOT, summary.paths.studioReport),
      })),
  };
}

async function runStudioGateV21({
  storyId = "1sn9xhe",
  variant = "v21",
  outputDir = TEST_OUT,
} = {}) {
  const input = await loadGateInputFromGauntlet({ storyId, variant, outputDir });
  const candidateGate = evaluateStudioRejectionGate({
    candidate: input.candidate,
    canonical: input.canonical,
    requireHeroMoments: true,
  });
  const calibration = [];
  for (const entry of input.calibration) {
    const report = await fs.readJson(entry.reportPath);
    const normalised = normaliseGateCandidate({
      key: entry.summary.key,
      summary: entry.summary,
      report,
    });
    calibration.push(
      evaluateStudioRejectionGate({
        candidate: normalised,
        canonical: input.canonical,
        requireHeroMoments: false,
      }),
    );
  }

  const fullReport = {
    ...candidateGate,
    storyId,
    variant,
    canonicalKey: input.canonical.key,
    calibration: calibration.map((entry) => ({
      candidateKey: entry.candidateKey,
      verdict: entry.verdict,
      hardFailCodes: entry.hardFailReasons.map((reason) => reason.code),
      warningCodes: entry.amberWarnings.map((warning) => warning.code),
    })),
  };

  const jsonPath = path.join(outputDir, `${storyId}_studio_v21_gate.json`);
  const mdOutputPath = path.join(outputDir, `${storyId}_studio_v21_gate.md`);
  const rootMdPath = path.join(ROOT, "STUDIO_V21_GATE_REPORT.md");
  const markdown = buildGateMarkdown(fullReport);
  await fs.writeJson(jsonPath, fullReport, { spaces: 2 });
  await fs.writeFile(mdOutputPath, markdown);
  await fs.writeFile(rootMdPath, markdown);
  fullReport.outputs = {
    json: rel(jsonPath),
    markdown: rel(mdOutputPath),
    rootMarkdown: rel(rootMdPath),
  };
  await fs.writeJson(jsonPath, fullReport, { spaces: 2 });
  return fullReport;
}

module.exports = {
  ROOT,
  TEST_OUT,
  normaliseGateCandidate,
  evaluateStudioRejectionGate,
  buildGateMarkdown,
  loadGateInputFromGauntlet,
  runStudioGateV21,
};
