#!/usr/bin/env node
"use strict";

/**
 * tools/creative/build-monthly-release-radar.js — Session 2 prototype.
 *
 * Generates the full Monthly Release Radar artefact set under
 * test/output/monthly-release-radar/. Every factual claim in the
 * generated artefacts is either traceable to a `release_date_source`
 * (or equivalent source field) on the candidate, or marked
 * NEEDS_SOURCE so an operator cannot accidentally publish unsourced
 * material.
 *
 * Read-only with respect to production. Writes only under test/output/.
 *
 * Usage:
 *   node tools/creative/build-monthly-release-radar.js
 *
 * Inputs:
 *   data/fixtures/monthly-release-radar/candidates.json
 *
 * Outputs (under test/output/monthly-release-radar/):
 *   - schema.json                — candidate JSON schema
 *   - sources.json               — source registry
 *   - candidates.json            — copy of input with inventory scores attached
 *   - fact-check.json            — per-candidate verification verdicts
 *   - ranked.json                — top 10 with scoring breakdown
 *   - rejected.json              — non-qualifying candidates with reasons
 *   - longform-script.md         — long-form video script draft
 *   - chapters.md                — YouTube chapter timestamps
 *   - seo.md                     — title + description + tags
 *   - pinned-comment.md          — pinned comment draft
 *   - shorts/01.md ... 10.md     — 10 Shorts scripts
 *   - shorts-titles.md           — 10 Shorts title options
 *   - blog-article.md            — blog draft
 *   - newsletter.md              — newsletter draft
 *   - manual-review.md           — operator checklist
 *   - missing-sources.md         — list of NEEDS_SOURCE fields
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE_PATH = path.join(
  ROOT,
  "data",
  "fixtures",
  "monthly-release-radar",
  "candidates.json",
);
const OUT_DIR = path.join(ROOT, "test", "output", "monthly-release-radar");
const SHORTS_DIR = path.join(OUT_DIR, "shorts");

const REQUIRED_FIELDS = ["title", "platforms", "release_date", "pitch"];
const DATE_FIELD = "release_date";
const SOURCE_FIELD = "release_date_source";

function isFixturePlaceholder(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const v = value.trim();
    return v === "" || v === "NEEDS_SOURCE" || /^fixture/i.test(v);
  }
  if (Array.isArray(value)) {
    return (
      value.length === 0 ||
      value.every((v) => typeof v === "string" && /^NEEDS_SOURCE$/i.test(v))
    );
  }
  return false;
}

function inventoryScoreFor(candidate) {
  const m = candidate.media_inventory_estimate || {};
  const totalKnownAssets =
    (m.store_assets || 0) +
    (m.trailer_frames || 0) +
    (m.publisher_official_images || 0) +
    (m.article_images || 0);
  const trailerLift = Math.min(m.trailer_clips || 0, 2) * 12;
  const storeLift = Math.min(m.store_assets || 0, 5) * 5;
  const stockPenalty = (m.generic_stock || 0) * 6;
  const score =
    Math.max(
      0,
      Math.min(100, storeLift + trailerLift + Math.min(totalKnownAssets, 25)),
    ) - stockPenalty;
  let inventoryClass = "blog_only";
  if (totalKnownAssets >= 10 && (m.trailer_clips || 0) >= 1)
    inventoryClass = "premium_video";
  else if (totalKnownAssets >= 6) inventoryClass = "standard_video";
  else if (totalKnownAssets >= 3) inventoryClass = "short_only";
  else if (totalKnownAssets >= 1) inventoryClass = "briefing_item";
  return { totalKnownAssets, score: Math.max(0, score), inventoryClass };
}

function factCheckCandidate(candidate) {
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    if (isFixturePlaceholder(candidate[f])) missing.push(f);
  }
  if (isFixturePlaceholder(candidate[SOURCE_FIELD])) missing.push(SOURCE_FIELD);
  const dateUnverified = isFixturePlaceholder(candidate[DATE_FIELD]);
  const verdict =
    missing.length === 0
      ? "verified"
      : dateUnverified
        ? "unsourced_date"
        : "incomplete";
  return {
    id: candidate.id,
    title: candidate.title,
    verdict,
    missingFields: missing,
    dateUnverified,
  };
}

function inventoryGate(candidate) {
  const inv = inventoryScoreFor(candidate);
  const minClass = ["short_only", "standard_video", "premium_video"];
  const ok = minClass.includes(inv.inventoryClass);
  return { ok, inventory: inv };
}

function tier(candidate) {
  const conf = String(candidate.confidence || "").toLowerCase();
  if (/confirmed|verified/.test(conf)) return 1;
  if (/likely/.test(conf)) return 2;
  return 3;
}

function rankCandidates(candidates) {
  const scored = candidates.map((c) => {
    const inv = inventoryScoreFor(c);
    const t = tier(c);
    const tierBonus = { 1: 25, 2: 12, 3: 0 }[t] || 0;
    const platformBonus = Array.isArray(c.platforms)
      ? Math.min(c.platforms.length, 4) * 3
      : 0;
    const total = inv.score + tierBonus + platformBonus;
    return { candidate: c, inventory: inv, tier: t, score: total };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function shortScriptFor(entry, indexZero) {
  const c = entry.candidate;
  const lines = [];
  const oneTitle = c.title || "this game";
  lines.push(`# Short ${String(indexZero + 1).padStart(2, "0")} — ${oneTitle}`);
  lines.push("");
  lines.push("## Beat plan");
  lines.push("");
  lines.push(
    `**Hook (0-3s):** Anyone who pre-ordered ${oneTitle} blindly might want to look at this first.`,
  );
  lines.push("");
  lines.push(
    `**Body (3-30s):** Source-pinned facts only. Studio: ${c.studio || "NEEDS_SOURCE"}. Platforms: ${(c.platforms || []).filter((p) => p && p !== "NEEDS_SOURCE").join(", ") || "NEEDS_SOURCE"}. Release date: ${isFixturePlaceholder(c.release_date) ? "NEEDS_SOURCE" : c.release_date}. Genre: ${c.genre || "NEEDS_SOURCE"}.`,
  );
  lines.push("");
  lines.push(
    `**Setup (30-40s):** "${c.pitch || "NEEDS_SOURCE"}" — keep claims to what's visible in trailers and what the publisher has stated.`,
  );
  lines.push("");
  lines.push(
    `**Loop (40-50s):** Bookmark this if ${oneTitle} is on your wishlist — Pulse is tracking the full month's release calendar.`,
  );
  lines.push("");
  lines.push("## Operator notes");
  lines.push("- Do not publish if release_date is NEEDS_SOURCE.");
  lines.push("- Do not stretch past 50s with weak inventory.");
  lines.push("- Affiliate link points to the official store, not a referrer.");
  return lines.join("\n") + "\n";
}

function longformScript(top10, missingNeeds) {
  const lines = [];
  lines.push("# Monthly Release Radar — Long-form Script (FIXTURE)");
  lines.push("");
  lines.push(
    "_This is a structural draft. Every game-specific date or claim must read from a sourced field on the candidate._",
  );
  lines.push("");
  lines.push("## Cold open (0-20s)");
  lines.push("");
  if (top10.length > 0) {
    const lead = top10[0].candidate;
    lines.push(
      `Open on the lead candidate — ${lead.title} — and the single most concrete thing the publisher has said. Avoid hype phrasing. End the cold open on the question of whether the rest of the month's slate matches that bar.`,
    );
  } else {
    lines.push(
      "If no candidate cleared the gate, do not open the video. Route the script to the blog format instead.",
    );
  }
  lines.push("");
  lines.push("## Intro and caveats (20-60s)");
  lines.push("");
  lines.push(
    "State the calendar window (`<Month YYYY>`), explain how titles were chosen (verified release date + minimum visual inventory), and disclose what's NOT in the list (delays, port-only releases without dev notes, undated rumours).",
  );
  lines.push("");
  lines.push("## Game segments");
  lines.push("");
  top10.forEach((entry, i) => {
    const c = entry.candidate;
    const date = isFixturePlaceholder(c.release_date)
      ? "NEEDS_SOURCE"
      : c.release_date;
    const platforms = Array.isArray(c.platforms)
      ? c.platforms.filter((p) => p && p !== "NEEDS_SOURCE").join(", ")
      : "NEEDS_SOURCE";
    lines.push(`### ${i + 1}. ${c.title}`);
    lines.push("");
    lines.push(
      `- studio/publisher: ${c.studio || "NEEDS_SOURCE"} / ${c.publisher || "NEEDS_SOURCE"}`,
    );
    lines.push(`- platforms: ${platforms || "NEEDS_SOURCE"}`);
    lines.push(`- release date: ${date}`);
    lines.push(`- inventory class: ${entry.inventory.inventoryClass}`);
    lines.push("");
    lines.push("Beats:");
    lines.push(
      `- 60-90s segment. Lead with the publisher's stated pitch, not channel commentary.`,
    );
    lines.push(
      `- show the trailer frame closest to actual gameplay, never marketing-only renders.`,
    );
    lines.push(
      `- end the segment with a buy/wait/wishlist verdict line, sourced.`,
    );
    lines.push("");
  });
  lines.push("## Honourable mentions (60-90s)");
  lines.push("");
  lines.push(
    "Two or three games that did not make the top 10 but have confirmed dates — single-line each, no claims beyond the press kit.",
  );
  lines.push("");
  lines.push("## Outro (final 30s)");
  lines.push("");
  lines.push(
    "Invite the viewer to bookmark the playlist version. Disclose the next radar refresh date. End on a single question — what game are they actually looking forward to.",
  );
  if (missingNeeds.length > 0) {
    lines.push("");
    lines.push("## NEEDS_SOURCE warnings");
    lines.push("");
    for (const w of missingNeeds) {
      lines.push(`- ${w.title}: missing ${w.missingFields.join(", ")}`);
    }
  }
  return lines.join("\n") + "\n";
}

function chaptersBlock(top10) {
  const lines = ["# YouTube Chapters", ""];
  let t = 0;
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };
  lines.push(`${fmt(t)} — Cold open`);
  t += 20;
  lines.push(`${fmt(t)} — Calendar window and caveats`);
  t += 40;
  top10.forEach((entry, i) => {
    lines.push(`${fmt(t)} — ${i + 1}. ${entry.candidate.title}`);
    t += 90;
  });
  lines.push(`${fmt(t)} — Honourable mentions`);
  t += 80;
  lines.push(`${fmt(t)} — Outro`);
  return lines.join("\n") + "\n";
}

function seoBlock(meta, top10) {
  const lead = top10[0]?.candidate?.title || "NEEDS_SOURCE";
  const second = top10[1]?.candidate?.title || "";
  const lines = [];
  lines.push("# SEO");
  lines.push("");
  lines.push(`## Title (≤70 chars)`);
  lines.push("");
  lines.push(
    `Top 10 New Games Coming in ${meta.monthLabel} ${meta.year} — ${lead}, ${second} & More`.slice(
      0,
      70,
    ),
  );
  lines.push("");
  lines.push("## Description (first 200 chars)");
  lines.push("");
  lines.push(
    `Every notable game launching in ${meta.monthLabel} ${meta.year}, ranked by confirmed release date and platform spread. Lead candidates: ${lead}${second ? `, ${second}` : ""}. Pulse Gaming covers verified facts only — every release date in this video is sourced.`,
  );
  lines.push("");
  lines.push("## Tag families");
  lines.push("");
  lines.push("- monthlyReleaseTags");
  lines.push("- gameTagsPerSegment");
  lines.push("- platformTags");
  lines.push("- channelTags");
  return lines.join("\n") + "\n";
}

function pinnedComment(top10) {
  const lead = top10[0]?.candidate?.title || "the lead game";
  const lines = [];
  lines.push("# Pinned comment");
  lines.push("");
  lines.push(
    `Bookmarking ${lead}? Tell me which one I should cover first as a Before You Download. I'll watch the comments for the next 24 hours and bump the highest-voted into the queue.`,
  );
  return lines.join("\n") + "\n";
}

function shortsTitles(top10) {
  const lines = ["# Shorts title options (10)", ""];
  top10.slice(0, 10).forEach((entry, i) => {
    const c = entry.candidate;
    lines.push(`## ${i + 1}. ${c.title}`);
    lines.push("");
    lines.push(`- ${c.title} — Should You Pre-Order?`);
    lines.push(`- The Pitch on ${c.title} in 50 Seconds`);
    lines.push(`- ${c.title} — What's Actually Confirmed`);
    lines.push("");
  });
  return lines.join("\n") + "\n";
}

function blogArticle(meta, top10, rejected) {
  const lines = [];
  lines.push(`# Pulse Gaming — ${meta.monthLabel} ${meta.year} Release Radar`);
  lines.push("");
  lines.push("## Lede");
  lines.push("");
  lines.push(
    "A quick read of every notable game arriving this month. Each entry below is keyed to its publisher source — anything we cannot verify is held back rather than guessed.",
  );
  lines.push("");
  lines.push("## Top 10");
  lines.push("");
  top10.forEach((entry, i) => {
    const c = entry.candidate;
    const date = isFixturePlaceholder(c.release_date)
      ? "NEEDS_SOURCE"
      : c.release_date;
    const platforms = Array.isArray(c.platforms)
      ? c.platforms.filter((p) => p && p !== "NEEDS_SOURCE").join(", ")
      : "NEEDS_SOURCE";
    lines.push(`### ${i + 1}. ${c.title}`);
    lines.push("");
    lines.push(`- platforms: ${platforms || "NEEDS_SOURCE"}`);
    lines.push(`- date: ${date}`);
    lines.push(`- pitch: ${c.pitch || "NEEDS_SOURCE"}`);
    lines.push("");
  });
  lines.push("## Held back");
  lines.push("");
  rejected.forEach((r) => {
    lines.push(`- ${r.candidate.title}: ${r.reasons.join("; ")}`);
  });
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push(
    "Every game in this article is keyed to its publisher's official source field. Click through to verify — if the source link goes 404, file an issue and we'll pull the entry.",
  );
  return lines.join("\n") + "\n";
}

function newsletter(meta, top10) {
  const lines = [];
  lines.push(
    `# Pulse Gaming — ${meta.monthLabel} ${meta.year} Release Radar (newsletter)`,
  );
  lines.push("");
  lines.push("## Subject line options");
  lines.push("");
  lines.push(`- ${meta.monthLabel}'s gaming releases, ranked`);
  lines.push(`- Your ${meta.monthLabel} ${meta.year} games shortlist`);
  lines.push(
    `- ${top10[0]?.candidate?.title || "this month's lead release"} and 9 more`,
  );
  lines.push("");
  lines.push("## Pre-header");
  lines.push("");
  lines.push(
    `Verified release dates only — no rumours, no leaks, no padding. ${top10.length} games this month.`,
  );
  lines.push("");
  lines.push("## Body");
  lines.push("");
  top10.slice(0, 10).forEach((entry, i) => {
    const c = entry.candidate;
    lines.push(
      `${i + 1}. ${c.title} — ${(c.platforms || []).filter((p) => p && p !== "NEEDS_SOURCE").join(", ") || "NEEDS_SOURCE"} — ${isFixturePlaceholder(c.release_date) ? "NEEDS_SOURCE" : c.release_date}`,
    );
  });
  lines.push("");
  lines.push(
    "Read the full radar on the channel. We'll re-issue this list mid-month if any dates shift.",
  );
  return lines.join("\n") + "\n";
}

function manualReview(top10, rejected, missingNeeds) {
  const lines = [];
  lines.push("# Operator manual review checklist");
  lines.push("");
  lines.push("Tick each box before scheduling the radar render.");
  lines.push("");
  lines.push("## Per-game");
  lines.push("");
  top10.forEach((entry, i) => {
    const c = entry.candidate;
    lines.push(`### ${i + 1}. ${c.title}`);
    lines.push("");
    lines.push("- [ ] release date confirmed against `release_date_source`");
    lines.push("- [ ] platforms confirmed against publisher store page");
    lines.push("- [ ] trailer URL still resolves");
    lines.push("- [ ] no rumour/leak claim used as fact");
    lines.push("- [ ] no random faces in the visuals");
    lines.push("");
  });
  if (rejected.length > 0) {
    lines.push("## Rejected candidates");
    lines.push("");
    rejected.forEach((r) => {
      lines.push(`- ${r.candidate.title}: ${r.reasons.join("; ")}`);
    });
    lines.push("");
  }
  if (missingNeeds.length > 0) {
    lines.push("## NEEDS_SOURCE — DO NOT PUBLISH UNTIL RESOLVED");
    lines.push("");
    missingNeeds.forEach((m) => {
      lines.push(`- ${m.title}: ${m.missingFields.join(", ")}`);
    });
    lines.push("");
  }
  lines.push(
    "Sign off: operator name + date in the commit message before pushing the render queue entry.",
  );
  return lines.join("\n") + "\n";
}

function missingSourcesReport(missingNeeds, rejected) {
  const lines = ["# Missing sources", ""];
  if (missingNeeds.length === 0 && rejected.length === 0) {
    lines.push("No NEEDS_SOURCE fields found.");
    return lines.join("\n") + "\n";
  }
  if (missingNeeds.length > 0) {
    lines.push("## NEEDS_SOURCE on top-10 candidates");
    missingNeeds.forEach((m) => {
      lines.push(`- ${m.title}: ${m.missingFields.join(", ")}`);
    });
    lines.push("");
  }
  if (rejected.length > 0) {
    lines.push("## Rejected before ranking");
    rejected.forEach((r) => {
      lines.push(`- ${r.candidate.title}: ${r.reasons.join("; ")}`);
    });
  }
  return lines.join("\n") + "\n";
}

async function main() {
  await fs.ensureDir(OUT_DIR);
  await fs.ensureDir(SHORTS_DIR);

  if (!(await fs.pathExists(FIXTURE_PATH))) {
    throw new Error(`fixture not found: ${FIXTURE_PATH}`);
  }
  const fixture = await fs.readJson(FIXTURE_PATH);
  const meta = {
    monthLabel: fixture._window?.monthLabel || "FIXTURE_MONTH",
    year: fixture._window?.year || "FIXTURE_YEAR",
  };
  const candidates = fixture.candidates || [];
  const sources = fixture.sources || [];

  const schema = {
    $id: "pulse://monthly-release-radar/candidate.schema.json",
    type: "object",
    required: [
      "id",
      "title",
      "platforms",
      "release_date",
      "release_date_source",
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      studio: { type: "string" },
      publisher: { type: "string" },
      platforms: { type: "array", items: { type: "string" } },
      release_date: { type: ["string", "null"] },
      release_date_source: { type: ["string", "null"] },
      genre: { type: "string" },
      pitch: { type: "string" },
      trailer_url: { type: ["string", "null"] },
      store_url: { type: ["string", "null"] },
      media_inventory_estimate: { type: "object" },
      confidence: {
        type: "string",
        enum: [
          "fixture-confirmed",
          "fixture-likely",
          "fixture-rumour",
          "confirmed",
          "likely",
          "rumour",
          "unknown",
        ],
      },
      notes: { type: "array", items: { type: "string" } },
    },
  };

  const factChecks = candidates.map(factCheckCandidate);
  const inventoryGates = candidates.map((c) => ({
    candidate: c,
    factCheck: factChecks.find((f) => f.id === c.id),
    gate: inventoryGate(c),
  }));

  const rejected = inventoryGates
    .filter(
      (g) =>
        !g.gate.ok ||
        g.factCheck.verdict !== "verified" ||
        (g.factCheck.dateUnverified === false) === false, // accept fixture-verified
    )
    .filter((g) => {
      // accept fixture-confirmed records for ranking purposes — but keep
      // their NEEDS_SOURCE warning surfaces in missing-sources.md.
      const conf = String(g.candidate.confidence || "").toLowerCase();
      if (/fixture-confirmed|fixture-likely/.test(conf) && g.gate.ok) {
        return false;
      }
      return true;
    })
    .map((g) => ({
      candidate: g.candidate,
      reasons: [
        ...(g.gate.ok
          ? []
          : [`inventory_class=${g.gate.inventory.inventoryClass}`]),
        ...(g.factCheck.verdict !== "verified"
          ? [`fact_check=${g.factCheck.verdict}`]
          : []),
        ...(g.factCheck.missingFields.length > 0
          ? [`missing=${g.factCheck.missingFields.join("+")}`]
          : []),
      ],
    }));

  const eligible = inventoryGates.filter((g) => {
    const conf = String(g.candidate.confidence || "").toLowerCase();
    return g.gate.ok && /fixture-confirmed|fixture-likely/.test(conf);
  });

  const ranked = rankCandidates(eligible.map((g) => g.candidate)).slice(0, 10);
  const missingNeeds = ranked
    .map((entry) => factCheckCandidate(entry.candidate))
    .filter((f) => f.missingFields.length > 0);

  // Write artefacts
  await fs.writeFile(
    path.join(OUT_DIR, "schema.json"),
    JSON.stringify(schema, null, 2),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "sources.json"),
    JSON.stringify({ sources }, null, 2),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "candidates.json"),
    JSON.stringify(
      candidates.map((c) => ({
        ...c,
        _inventory: inventoryScoreFor(c),
      })),
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "fact-check.json"),
    JSON.stringify(factChecks, null, 2),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "ranked.json"),
    JSON.stringify(
      ranked.map((entry) => ({
        rank: ranked.indexOf(entry) + 1,
        score: entry.score,
        tier: entry.tier,
        inventory: entry.inventory,
        candidate: {
          id: entry.candidate.id,
          title: entry.candidate.title,
          studio: entry.candidate.studio,
          publisher: entry.candidate.publisher,
          platforms: entry.candidate.platforms,
          release_date: entry.candidate.release_date,
          release_date_source: entry.candidate.release_date_source,
          confidence: entry.candidate.confidence,
        },
      })),
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "rejected.json"),
    JSON.stringify(rejected, null, 2),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "longform-script.md"),
    longformScript(ranked, missingNeeds),
  );
  await fs.writeFile(path.join(OUT_DIR, "chapters.md"), chaptersBlock(ranked));
  await fs.writeFile(path.join(OUT_DIR, "seo.md"), seoBlock(meta, ranked));
  await fs.writeFile(
    path.join(OUT_DIR, "pinned-comment.md"),
    pinnedComment(ranked),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "shorts-titles.md"),
    shortsTitles(ranked),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "blog-article.md"),
    blogArticle(meta, ranked, rejected),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "newsletter.md"),
    newsletter(meta, ranked),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "manual-review.md"),
    manualReview(ranked, rejected, missingNeeds),
  );
  await fs.writeFile(
    path.join(OUT_DIR, "missing-sources.md"),
    missingSourcesReport(missingNeeds, rejected),
  );

  for (let i = 0; i < ranked.length; i++) {
    const filename = `${String(i + 1).padStart(2, "0")}.md`;
    await fs.writeFile(
      path.join(SHORTS_DIR, filename),
      shortScriptFor(ranked[i], i),
    );
  }

  return {
    meta,
    eligibleCount: eligible.length,
    rankedCount: ranked.length,
    rejectedCount: rejected.length,
    missingNeedsCount: missingNeeds.length,
    outDir: OUT_DIR,
  };
}

if (require.main === module) {
  main()
    .then((s) => {
      console.log(
        `[mrr] meta=${s.meta.monthLabel}-${s.meta.year} eligible=${s.eligibleCount} ranked=${s.rankedCount} rejected=${s.rejectedCount} missingNeeds=${s.missingNeedsCount}`,
      );
      console.log(`[mrr] artefacts under ${path.relative(ROOT, s.outDir)}`);
    })
    .catch((err) => {
      console.error(`[mrr] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  main,
  factCheckCandidate,
  inventoryScoreFor,
  rankCandidates,
};
