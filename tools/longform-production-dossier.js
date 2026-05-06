#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildLongformCandidateSelector,
  buildLongformProductionDossier,
  renderLongformDossierMarkdown,
  LONGFORM_FORMATS,
} = require("../lib/longform/production-dossier");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "test", "output");
const LONGFORM_DIR = path.join(OUT_DIR, "longform");

const FIXTURE_STORIES = [
  {
    id: "rss_bc0fff7eb82ee4f2",
    title: "Subnautica 2 release times confirmed for PC and Xbox",
    source_type: "rss",
    source_name: "Xbox Wire",
    url: "https://news.xbox.com/example/subnautica-2-release-times",
    flair: "Confirmed",
    breaking_score: 82,
    release_date: "2026-05-09",
    platforms: ["PC", "Xbox"],
    full_script:
      "Subnautica 2 now has confirmed release timings for PC and Xbox. The useful angle is exactly when players can start downloading.",
    media_inventory: {
      classification: "premium_video",
      exact_subject_asset_count: 6,
      validated_clip_count: 2,
      visual_strength_score: 84,
    },
  },
  {
    id: "rss_ad8604277aa2bcd8",
    title: "FF14 director confirms Nintendo Switch 2 is being explored",
    source_type: "rss",
    source_name: "IGN",
    url: "https://ign.com/example/ff14-switch-2",
    flair: "Verified",
    breaking_score: 79,
    platforms: ["Nintendo Switch 2"],
    full_script:
      "The Final Fantasy 14 director has confirmed the team is thinking seriously about Nintendo Switch 2 support.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 4,
      validated_clip_count: 1,
      visual_strength_score: 72,
    },
  },
  {
    id: "rss_gta6_trailer",
    title: "All the evidence that GTA 6's next trailer is nearly here",
    source_type: "rss",
    source_name: "GameSpot",
    url: "https://gamespot.com/example/gta-6-trailer-evidence",
    flair: "Rumour",
    breaking_score: 76,
    full_script:
      "GTA 6 fans think the next trailer could be close, but Rockstar has not confirmed a date.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 3,
      validated_clip_count: 0,
      visual_strength_score: 61,
    },
  },
  {
    id: "rss_outer_worlds_patch",
    title: "The Outer Worlds Spacer's Choice Edition receives performance fixes",
    source_type: "rss",
    source_name: "Eurogamer",
    url: "https://eurogamer.net/example/outer-worlds-patch",
    flair: "News",
    breaking_score: 72,
    platforms: ["PC", "Xbox", "PlayStation"],
    full_script:
      "The Outer Worlds Spacer's Choice Edition has a useful performance patch, which gives players a concrete reason to revisit it.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 4,
      validated_clip_count: 1,
      visual_strength_score: 70,
    },
  },
  {
    id: "rss_xbox_quarter",
    title: "Xbox CEO responds to Xbox being down this quarter",
    source_type: "rss",
    source_name: "The Verge",
    url: "https://theverge.com/example/xbox-ceo-quarter",
    flair: "Verified",
    breaking_score: 78,
    platforms: ["Xbox", "PC"],
    full_script:
      "Xbox leadership has responded to the latest quarter, which gives the story a concrete business consequence rather than loose speculation.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 4,
      validated_clip_count: 1,
      visual_strength_score: 68,
    },
  },
  {
    id: "rss_age_verification",
    title: "New York age verification law puts new pressure on game platforms",
    source_type: "rss",
    source_name: "Polygon",
    url: "https://polygon.com/example/new-york-age-verification-games",
    flair: "News",
    breaking_score: 79,
    platforms: ["PC", "Console"],
    full_script:
      "New age verification rules could affect how platform stores handle accounts, safety checks and access to mature games.",
    media_inventory: {
      classification: "standard_video",
      exact_subject_asset_count: 3,
      validated_clip_count: 1,
      visual_strength_score: 66,
    },
  },
  {
    id: "rss_unsupported_release",
    title: "Mystery horror game may launch next month",
    source_type: "rss",
    source_name: "Unknown Blog",
    url: "https://example.com/mystery-horror-game",
    flair: "Rumour",
    breaking_score: 44,
    release_date: "2026-06-01",
    platforms: ["PC"],
    media_inventory: {
      classification: "blog_only",
      exact_subject_asset_count: 1,
      validated_clip_count: 0,
      visual_strength_score: 24,
    },
  },
];

function parseArgs(argv) {
  const args = { format: "weekly_roundup", fixture: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--format") args.format = argv[++i] || args.format;
  }
  return args;
}

function renderArchitectureReport({ dossier, selector }) {
  const lines = [];
  lines.push("# Longform Overnight Architecture Report");
  lines.push("");
  lines.push(`Generated: ${dossier.generated_at}`);
  lines.push(`Selected format: ${dossier.format.label}`);
  lines.push(`Status: ${dossier.status}`);
  lines.push("");
  lines.push("## What Was Built");
  lines.push("");
  lines.push("- A local-only longform candidate selector.");
  lines.push("- A production dossier with segments, source pack, chapter plan, visual plan, shot list, SEO package and Shorts spin-off plan.");
  lines.push("- A fixture prototype that does not upload, schedule or write production DB rows.");
  lines.push("");
  lines.push("## Lane Strategy");
  lines.push("");
  lines.push("- Pulse Flash Lane: 61-75s high-energy Shorts, punch captions, rapid topic cards and game-footage backbone.");
  lines.push("- Pulse Briefing Lane: weekly and monthly formats with mini-documentary rhythm, chapter cards, calmer narration, source timelines and richer context.");
  lines.push("- Shared intelligence layer: research, fact-checking, media inventory and analytics stay common, while script rules, render rules and QA gates differ per format.");
  lines.push("");
  lines.push("## Format Ladder");
  lines.push("");
  for (const format of LONGFORM_FORMATS) {
    lines.push(`- ${format.label}: ${format.target_runtime} - ${format.purpose}`);
  }
  lines.push("");
  lines.push("## Candidate Selector");
  lines.push("");
  for (const candidate of selector.candidates.slice(0, 8)) {
    lines.push(
      `- ${candidate.scores.total}: ${candidate.title} -> ${candidate.recommended_format} (${candidate.source_confidence}, media=${candidate.media_class})`,
    );
  }
  lines.push("");
  lines.push("## Fact Safety");
  lines.push("");
  if (dossier.fact_check_flags.length) {
    for (const flag of dossier.fact_check_flags) lines.push(`- ${flag}`);
  } else {
    lines.push("- No fixture fact flags.");
  }
  lines.push("");
  lines.push("## Promotion Notes");
  lines.push("");
  lines.push("- This is architecture and a local prototype only.");
  lines.push("- No longform upload was made.");
  lines.push("- No scheduler changes were made.");
  lines.push("- Monthly Release Radar still needs official date and platform verification before public use.");
  lines.push("- Weekly Roundup is the safest first longform format once enough visual coverage exists.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stories = FIXTURE_STORIES;
  const selector = buildLongformCandidateSelector(stories);
  const dossier = buildLongformProductionDossier({
    formatId: args.format,
    stories,
  });
  const markdown = renderLongformDossierMarkdown(dossier);
  const architecture = renderArchitectureReport({ dossier, selector });

  await fs.ensureDir(LONGFORM_DIR);
  await fs.writeJson(path.join(OUT_DIR, "longform_dossier.json"), dossier, { spaces: 2 });
  await fs.writeFile(path.join(OUT_DIR, "longform_dossier.md"), markdown, "utf8");
  await fs.writeJson(path.join(LONGFORM_DIR, "longform_candidate_selector.json"), selector, { spaces: 2 });
  await fs.writeJson(path.join(LONGFORM_DIR, "longform_fixture_outline.json"), dossier, { spaces: 2 });
  await fs.writeFile(path.join(LONGFORM_DIR, "longform_fixture_outline.md"), markdown, "utf8");
  await fs.writeFile(path.join(ROOT, "LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md"), architecture, "utf8");

  console.log(`[longform] format=${dossier.format.id} status=${dossier.status}`);
  console.log(`[longform] dossier=${path.relative(ROOT, path.join(OUT_DIR, "longform_dossier.md"))}`);
  console.log("[longform] no upload, no scheduler change, no production DB write");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[longform] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  FIXTURE_STORIES,
  parseArgs,
  renderArchitectureReport,
};
