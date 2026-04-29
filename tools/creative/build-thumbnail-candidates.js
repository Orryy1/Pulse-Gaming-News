#!/usr/bin/env node
"use strict";

/**
 * tools/creative/build-thumbnail-candidates.js — Session 2 prototype.
 *
 * CLI wrapper around the existing lib/thumbnail-candidate.js
 * generator. Given a fixture set of stories, render each one into
 * test/output/thumbnail-safety/ and emit a per-story safety
 * verdict. Read-only with respect to production state.
 *
 * Usage:
 *   node tools/creative/build-thumbnail-candidates.js
 *
 * Output:
 *   test/output/thumbnail-safety/<id>_thumbnail_candidate.png
 *   test/output/thumbnail-safety/<id>.json (verdict)
 *   test/output/thumbnail-safety/index.md (summary)
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output", "thumbnail-safety");
const ASSET_DIR = path.join(OUT_DIR, "assets");
const { materialiseFixtureStory } = require("./fixture-assets");

const FIXTURE_STORIES = [
  {
    id: "fixture-thumb-game-keyart",
    title: "Aurora Drift Open Beta Confirmed",
    suggested_thumbnail_text: "AURORA DRIFT OPEN BETA",
    flair: "Confirmed",
    subreddit: "gaming",
    company_name: "Beacon Interactive",
    downloaded_images: [
      {
        path: "fixture://aurora-drift/keyart.jpg",
        type: "key_art",
        source: "steam",
        priority: 95,
      },
      {
        path: "fixture://aurora-drift/screenshot-1.jpg",
        type: "screenshot",
        source: "steam",
        priority: 80,
      },
      {
        path: "fixture://aurora-drift/article-hero.jpg",
        type: "article_hero",
        source: "article",
        priority: 60,
      },
    ],
  },
  {
    id: "fixture-thumb-author-portrait",
    title: "Iron Saint Roadmap Detailed",
    suggested_thumbnail_text: "IRON SAINT ROADMAP",
    flair: "Verified",
    subreddit: "GamingLeaksAndRumours",
    company_name: "Halberd Games",
    downloaded_images: [
      {
        path: "fixture://gravatar/byline-jane.jpg",
        type: "article_hero",
        source: "article",
        priority: 60,
        url: "https://gravatar.example/avatar/byline_author_jane",
      },
      {
        path: "fixture://iron-saint/keyart.jpg",
        type: "key_art",
        source: "steam",
        priority: 95,
      },
    ],
  },
  {
    id: "fixture-thumb-stock-people",
    title: "Verdant Ledger Reveals Team",
    suggested_thumbnail_text: "VERDANT LEDGER TEAM",
    flair: "News",
    subreddit: "Games",
    company_name: "Trellis",
    downloaded_images: [
      {
        path: "fixture://pexels/people-team-meeting.jpg",
        type: "screenshot",
        source: "pexels",
        priority: 25,
        stock: true,
        url: "https://pexels.com/people/team-meeting",
      },
      {
        path: "fixture://verdant-ledger/capsule.jpg",
        type: "capsule",
        source: "steam",
        priority: 88,
      },
    ],
  },
  {
    id: "fixture-thumb-platform-only",
    title: "PlayStation Update Adds Cross-Save",
    suggested_thumbnail_text: "PLAYSTATION CROSS-SAVE",
    flair: "Confirmed",
    subreddit: "PS5",
    company_name: "Sony Interactive Entertainment",
    downloaded_images: [
      {
        path: "fixture://playstation/logo.png",
        type: "platform_logo",
        source: "logo",
        priority: 70,
      },
      {
        path: "fixture://playstation/firmware-screenshot.jpg",
        type: "screenshot",
        source: "steam",
        priority: 60,
      },
    ],
  },
  {
    id: "fixture-thumb-named-person",
    title: "Phil Spencer Talks Xbox Roadmap",
    suggested_thumbnail_text: "PHIL SPENCER ON XBOX",
    flair: "Verified",
    subreddit: "xbox",
    company_name: "Microsoft Gaming",
    full_script:
      "Phil Spencer talked about the Xbox roadmap in a recorded interview...",
    downloaded_images: [
      {
        path: "fixture://xbox/phil-spencer-interview.jpg",
        type: "article_hero",
        source: "article",
        priority: 65,
        personName: "Phil Spencer",
        likely_human: true,
      },
      {
        path: "fixture://xbox/console-keyart.jpg",
        type: "key_art",
        source: "steam",
        priority: 90,
      },
    ],
  },
  {
    id: "fixture-thumb-empty",
    title: "Untitled Sequel Rumour",
    suggested_thumbnail_text: "UNTITLED SEQUEL",
    flair: "Rumour",
    subreddit: "GamingLeaksAndRumours",
    downloaded_images: [],
  },
];

function describeVerdict(qa) {
  const lines = [`- result: ${qa.result}`];
  if (qa.failures && qa.failures.length > 0) {
    lines.push(`- failures: ${qa.failures.join(", ")}`);
  }
  if (qa.warnings && qa.warnings.length > 0) {
    lines.push(`- warnings: ${qa.warnings.join(", ")}`);
  }
  if (qa.selected) {
    lines.push(
      `- selected: ${qa.selected.image?.path || "(none)"} score=${qa.selected.score} decision=${qa.selected.decision}`,
    );
  }
  if (qa.rejected && qa.rejected.length > 0) {
    lines.push(
      `- rejected: ${qa.rejected.map((r) => `${r.image?.path}:${r.reasons.join("+")}`).join("; ")}`,
    );
  }
  return lines.join("\n");
}

async function main() {
  await fs.ensureDir(OUT_DIR);
  const {
    runThumbnailPreUploadQa,
    classifyThumbnailImage,
    rankThumbnailCandidates,
  } = require(path.join(ROOT, "lib", "thumbnail-safety"));
  const {
    buildThumbnailCandidatePng,
    buildThumbnailContactSheet,
  } = require(path.join(ROOT, "lib", "thumbnail-candidate"));

  const indexLines = ["# Thumbnail safety fixtures", ""];
  const summary = [];
  const contactSheetImages = [];

  for (const story of FIXTURE_STORIES) {
    const renderedStory = await materialiseFixtureStory(story, ASSET_DIR);
    const qa = await runThumbnailPreUploadQa(story);
    const renderedQa = await runThumbnailPreUploadQa(renderedStory);
    const ranked = rankThumbnailCandidates(story, story.downloaded_images, {
      includeRejected: true,
    });
    const perCandidate = (story.downloaded_images || []).map((img) =>
      classifyThumbnailImage(story, img),
    );
    const thumbnailCandidate = await buildThumbnailCandidatePng({
      story: renderedStory,
      outPath: path.join(OUT_DIR, `${story.id}_thumbnail_candidate.png`),
    });
    contactSheetImages.push(thumbnailCandidate.path);

    const verdictPath = path.join(OUT_DIR, `${story.id}.json`);
    await fs.writeFile(
      verdictPath,
      JSON.stringify(
        {
          story: { id: story.id, title: story.title, flair: story.flair },
          qa,
          renderedQa,
          thumbnailCandidate: {
            path: thumbnailCandidate.path,
            qa: thumbnailCandidate.qa,
            subjectPath: thumbnailCandidate.subject?.path || null,
          },
          ranked: ranked.map((r) => ({
            score: r.score,
            decision: r.decision,
            reasons: r.reasons,
            warnings: r.warnings,
            image: r.image,
          })),
          perCandidate,
        },
        null,
        2,
      ),
    );

    indexLines.push(`## ${story.id} — ${story.title}`);
    indexLines.push("");
    indexLines.push(describeVerdict(qa));
    indexLines.push(`- thumbnail_candidate: ${thumbnailCandidate.path}`);
    indexLines.push("");
    summary.push({ id: story.id, result: qa.result, failures: qa.failures });
  }

  const contactSheetPath = await buildThumbnailContactSheet({
    images: contactSheetImages,
    outPath: path.join(OUT_DIR, "contact_sheet.jpg"),
  });

  await fs.writeFile(path.join(OUT_DIR, "index.md"), indexLines.join("\n"));
  await fs.writeFile(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify({ summary, contactSheetPath }, null, 2),
  );

  return { summary, contactSheetPath };
}

if (require.main === module) {
  main()
    .then(({ summary, contactSheetPath }) => {
      console.log(
        `[thumb-safety] processed ${summary.length} fixture(s): ` +
          summary.map((s) => `${s.id}=${s.result}`).join(", "),
      );
      if (contactSheetPath) {
        console.log(`[thumb-safety] contact sheet: ${contactSheetPath}`);
      }
    })
    .catch((err) => {
      console.error(`[thumb-safety] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main, FIXTURE_STORIES };
