"use strict";

/**
 * lib/creative/visual-qa-gate.js — Session 2 (creative pass).
 *
 * Pre-render visual gate that combines:
 *   - the existing thumbnail-safety classifier (lib/thumbnail-safety)
 *   - the new media-inventory scorer (lib/creative/media-inventory-scorer)
 *   - the new runtime recommender (lib/creative/runtime-recommender)
 *
 * Output is a structured verdict: result, failures, warnings,
 * checks, recommendedAction. The gate produces both JSON and
 * Markdown via the writer functions; the run-visual-qa CLI tool
 * persists those artefacts under test/output/visual-qa/.
 *
 * The gate is read-only with respect to production state. It never
 * mutates the story, never touches the database, never sends to a
 * platform. It's an editorial filter that lives in front of the
 * existing produce/publish flow and a future operator dashboard.
 */

const path = require("node:path");
const fs = require("fs-extra");
const { scoreStoryMediaInventory } = require("./media-inventory-scorer");
const { recommendRuntime } = require("./runtime-recommender");
const {
  classifyThumbnailImage,
  rankThumbnailCandidates,
} = require("../thumbnail-safety");

function pickFailure(check) {
  return check.severity === "fail" ? check : null;
}
function pickWarning(check) {
  return check.severity === "warn" ? check : null;
}

function thumbnailCandidateCheck(story, opts) {
  const candidatePath =
    opts.thumbnailCandidatePath || story?.thumbnail_candidate_path || null;
  const exists = candidatePath
    ? fs.existsSync(path.resolve(candidatePath))
    : false;
  return {
    id: "thumbnail_candidate_present",
    severity: exists ? "info" : "warn",
    detail: candidatePath
      ? exists
        ? `present at ${candidatePath}`
        : `path set but file missing: ${candidatePath}`
      : "no thumbnail_candidate_path on story",
  };
}

function titleTextCheck(story) {
  const text = String(
    story?.suggested_thumbnail_text ||
      story?.suggested_title ||
      story?.title ||
      "",
  ).trim();
  if (!text) {
    return {
      id: "title_text_present",
      severity: "fail",
      detail: "no suggested_thumbnail_text or title text on story",
    };
  }
  if (text.length > 72) {
    return {
      id: "title_text_present",
      severity: "warn",
      detail: `title text ${text.length} chars — likely to wrap or clip in thumbnail`,
    };
  }
  if (text.split(/\s+/).some((w) => w.length > 18)) {
    return {
      id: "title_text_present",
      severity: "warn",
      detail: "title contains a >18-char word — readability risk",
    };
  }
  return { id: "title_text_present", severity: "info", detail: "ok" };
}

function blackFrameCheck(story) {
  if (story?.qa_black_frame_seconds && story.qa_black_frame_seconds > 1.5) {
    return {
      id: "black_frame_risk",
      severity: "fail",
      detail: `qa_black_frame_seconds=${story.qa_black_frame_seconds}`,
    };
  }
  return { id: "black_frame_risk", severity: "info", detail: "no flag set" };
}

function unsafeFaceCheck(story, inventory) {
  const unsafe = inventory.counts.unknown_human_portrait_risk;
  if (unsafe === 0) {
    return {
      id: "unsafe_face_risk",
      severity: "info",
      detail: "no unsafe-face candidates in downloaded_images",
    };
  }
  return {
    id: "unsafe_face_risk",
    severity: unsafe >= 2 ? "fail" : "warn",
    detail: `${unsafe} unknown-human-portrait candidate(s) in inventory`,
  };
}

function repeatedStillsCheck(inventory) {
  const r = inventory.counts.repeated_source_risk;
  if (r === 0) {
    return {
      id: "repeated_stills_risk",
      severity: "info",
      detail: "no repeat-source pressure",
    };
  }
  return {
    id: "repeated_stills_risk",
    severity: r >= 4 ? "warn" : "info",
    detail: `${r} repeat-source pressure point(s)`,
  };
}

function stockFillerRatioCheck(inventory) {
  const total = inventory.counts.total_images;
  if (total === 0)
    return {
      id: "stock_filler_ratio",
      severity: "info",
      detail: "no images at all",
    };
  const ratio = inventory.counts.generic_stock / total;
  if (ratio > 0.5) {
    return {
      id: "stock_filler_ratio",
      severity: "fail",
      detail: `${Math.round(ratio * 100)}% of inventory is generic stock`,
    };
  }
  if (ratio > 0.25) {
    return {
      id: "stock_filler_ratio",
      severity: "warn",
      detail: `${Math.round(ratio * 100)}% of inventory is generic stock`,
    };
  }
  return {
    id: "stock_filler_ratio",
    severity: "info",
    detail: `${Math.round(ratio * 100)}%`,
  };
}

function sourceDiversityCheck(inventory) {
  const distinct = inventory.counts.distinct_sources;
  if (distinct >= 3)
    return {
      id: "source_diversity",
      severity: "info",
      detail: `${distinct} distinct sources`,
    };
  if (distinct === 2)
    return {
      id: "source_diversity",
      severity: "info",
      detail: "two distinct sources",
    };
  return {
    id: "source_diversity",
    severity: "warn",
    detail: `only ${distinct} distinct source(s)`,
  };
}

function inventoryClassCheck(inventory) {
  const cls = inventory.classification;
  if (cls === "reject_visuals" || cls === "blog_only") {
    return {
      id: "inventory_class",
      severity: "fail",
      detail: `class=${cls} — not eligible for video render`,
    };
  }
  if (cls === "briefing_item") {
    return {
      id: "inventory_class",
      severity: "warn",
      detail: "class=briefing_item — should not stand alone as a Short",
    };
  }
  return {
    id: "inventory_class",
    severity: "info",
    detail: `class=${cls}`,
  };
}

function runtimeReductionCheck(inventory, runtimePlan) {
  if (!runtimePlan.shouldRender) {
    return {
      id: "runtime_recommendation",
      severity: "fail",
      detail: `should not render (route=${runtimePlan.route})`,
    };
  }
  return {
    id: "runtime_recommendation",
    severity: "info",
    detail: `${runtimePlan.runtimeSeconds.min}-${runtimePlan.runtimeSeconds.max}s (target ${runtimePlan.runtimeSeconds.target}s)`,
  };
}

function bestThumbnailCandidate(story) {
  const ranked = rankThumbnailCandidates(
    story,
    Array.isArray(story?.downloaded_images) ? story.downloaded_images : [],
  );
  return ranked[0] || null;
}

function evaluateStoryVisualQa(story, opts = {}) {
  if (!story) {
    return {
      result: "fail",
      failures: ["no_story"],
      warnings: [],
      checks: [],
      inventory: null,
      runtime: null,
      bestThumbnail: null,
    };
  }
  const inventory = scoreStoryMediaInventory(story);
  const runtimePlan = recommendRuntime(inventory);

  const checks = [
    inventoryClassCheck(inventory),
    runtimeReductionCheck(inventory, runtimePlan),
    titleTextCheck(story),
    thumbnailCandidateCheck(story, opts),
    blackFrameCheck(story),
    unsafeFaceCheck(story, inventory),
    repeatedStillsCheck(inventory),
    stockFillerRatioCheck(inventory),
    sourceDiversityCheck(inventory),
  ];

  const failures = checks.filter(pickFailure).map((c) => c.id);
  const warnings = checks.filter(pickWarning).map((c) => c.id);
  const result =
    failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const best = bestThumbnailCandidate(story);

  let recommendedAction;
  if (result === "fail") {
    if (
      inventory.classification === "reject_visuals" ||
      inventory.classification === "blog_only"
    ) {
      recommendedAction = "do_not_render — route to blog/manual review";
    } else {
      recommendedAction = "fix failures and re-run gate before render";
    }
  } else if (result === "warn") {
    recommendedAction = "render allowed; operator should review the warnings";
  } else {
    recommendedAction = `render at ${runtimePlan.runtimeSeconds.target}s target (range ${runtimePlan.runtimeSeconds.min}-${runtimePlan.runtimeSeconds.max}s)`;
  }

  return {
    storyId: story.id || null,
    result,
    failures,
    warnings,
    checks,
    inventory,
    runtime: runtimePlan,
    bestThumbnail: best
      ? {
          path: best.image?.path || null,
          score: best.score,
          decision: best.decision,
          reasons: best.reasons,
        }
      : null,
    recommendedAction,
  };
}

function renderQaMarkdown(report) {
  const lines = [];
  lines.push(`# Visual QA — story ${report.storyId || "(no id)"}`);
  lines.push("");
  lines.push(`- result: **${report.result}**`);
  lines.push(`- recommended action: ${report.recommendedAction}`);
  if (report.runtime) {
    lines.push(
      `- runtime plan: ${report.runtime.shouldRender ? "render" : "no-render"} → ${report.runtime.route}`,
    );
  }
  if (report.inventory) {
    const i = report.inventory;
    lines.push(
      `- inventory class: \`${i.classification}\` (visualStrength=${i.scores.visualStrength}, thumbnailSafety=${i.scores.thumbnailSafety}, premiumSuitability=${i.scores.premiumSuitability})`,
    );
    lines.push(`- inventory reasons: ${i.classificationReasons.join(", ")}`);
  }
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  for (const c of report.checks) {
    const sev = c.severity.toUpperCase();
    lines.push(`- [${sev}] ${c.id}: ${c.detail}`);
  }
  if (report.bestThumbnail) {
    lines.push("");
    lines.push("## Best thumbnail candidate");
    lines.push(`- path: ${report.bestThumbnail.path || "(none)"}`);
    lines.push(`- score: ${report.bestThumbnail.score}`);
    lines.push(`- decision: ${report.bestThumbnail.decision}`);
    if (report.bestThumbnail.reasons?.length) {
      lines.push(`- reasons: ${report.bestThumbnail.reasons.join(", ")}`);
    }
  }
  return lines.join("\n") + "\n";
}

async function writeQaArtefacts(report, outDir) {
  await fs.ensureDir(outDir);
  const id = report.storyId || "no_id";
  const jsonPath = path.join(outDir, `${id}.json`);
  const mdPath = path.join(outDir, `${id}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, renderQaMarkdown(report));
  return { jsonPath, mdPath };
}

module.exports = {
  evaluateStoryVisualQa,
  renderQaMarkdown,
  writeQaArtefacts,
  bestThumbnailCandidate,
};
