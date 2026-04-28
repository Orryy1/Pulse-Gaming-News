#!/usr/bin/env node
"use strict";

/**
 * tools/creative/run-visual-qa.js — Session 2 prototype.
 *
 * Runs the local visual QA gate against a fixture set of stories.
 * Writes JSON + Markdown verdicts under test/output/visual-qa/.
 * Read-only with respect to production.
 *
 * Usage:
 *   node tools/creative/run-visual-qa.js
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output", "visual-qa");

const { evaluateStoryVisualQa, writeQaArtefacts } = require(
  path.join(ROOT, "lib", "creative", "visual-qa-gate"),
);

const FIXTURES = [
  {
    id: "fixture-qa-premium",
    title: "Iron Saint Console Reveal",
    suggested_thumbnail_text: "IRON SAINT CONSOLE REVEAL",
    flair: "Confirmed",
    subreddit: "gaming",
    company_name: "Halberd Games",
    downloaded_images: [
      {
        path: "fixture://iron-saint/keyart.jpg",
        type: "key_art",
        source: "steam",
        priority: 95,
      },
      {
        path: "fixture://iron-saint/hero.jpg",
        type: "hero",
        source: "steam",
        priority: 92,
      },
      {
        path: "fixture://iron-saint/screenshot-1.jpg",
        type: "screenshot",
        source: "steam",
        priority: 88,
      },
      {
        path: "fixture://iron-saint/screenshot-2.jpg",
        type: "screenshot",
        source: "steam",
        priority: 87,
      },
      {
        path: "fixture://iron-saint/trailerframe-1.jpg",
        type: "trailer_frame",
        source: "trailer",
        priority: 86,
      },
      {
        path: "fixture://iron-saint/trailerframe-2.jpg",
        type: "trailer_frame",
        source: "trailer",
        priority: 85,
      },
      {
        path: "fixture://iron-saint/article-hero.jpg",
        type: "article_hero",
        source: "article",
        priority: 70,
      },
    ],
    video_clips: [
      {
        path: "fixture://iron-saint/announce-trailer.mp4",
        type: "trailer",
        source: "trailer",
      },
      {
        path: "fixture://iron-saint/gameplay.mp4",
        type: "gameplay_clip",
        source: "trailer",
      },
    ],
  },
  {
    id: "fixture-qa-standard",
    title: "Pale Compass Spring Update",
    suggested_thumbnail_text: "PALE COMPASS SPRING UPDATE",
    flair: "Verified",
    subreddit: "Games",
    company_name: "Salt Harbour",
    downloaded_images: [
      {
        path: "fixture://pale-compass/keyart.jpg",
        type: "key_art",
        source: "steam",
        priority: 95,
      },
      {
        path: "fixture://pale-compass/screenshot-1.jpg",
        type: "screenshot",
        source: "steam",
        priority: 88,
      },
      {
        path: "fixture://pale-compass/article-hero.jpg",
        type: "article_hero",
        source: "article",
        priority: 70,
      },
      {
        path: "fixture://pale-compass/article-inline.jpg",
        type: "article_image",
        source: "article",
        priority: 60,
      },
      {
        path: "fixture://pale-compass/dev-blog.jpg",
        type: "company_logo",
        source: "logo",
        priority: 65,
      },
    ],
    video_clips: [],
  },
  {
    id: "fixture-qa-short-only",
    title: "Quiet Engine Patch Notes",
    suggested_thumbnail_text: "QUIET ENGINE PATCH",
    flair: "Verified",
    subreddit: "indiegames",
    downloaded_images: [
      {
        path: "fixture://quiet-engine/capsule.jpg",
        type: "capsule",
        source: "steam",
        priority: 88,
      },
      {
        path: "fixture://quiet-engine/article-hero.jpg",
        type: "article_hero",
        source: "article",
        priority: 60,
      },
      {
        path: "fixture://quiet-engine/reddit-thumb.jpg",
        type: "reddit_thumb",
        source: "reddit",
        priority: 35,
      },
    ],
    video_clips: [],
  },
  {
    id: "fixture-qa-briefing",
    title: "Verdant Ledger Discount Confirmed",
    suggested_thumbnail_text: "VERDANT LEDGER DISCOUNT",
    flair: "News",
    subreddit: "Games",
    downloaded_images: [
      {
        path: "fixture://verdant-ledger/capsule.jpg",
        type: "capsule",
        source: "steam",
        priority: 88,
      },
    ],
    video_clips: [],
  },
  {
    id: "fixture-qa-blog-only",
    title: "Untitled Sequel Whispers",
    suggested_thumbnail_text: "UNTITLED SEQUEL",
    flair: "Rumour",
    subreddit: "GamingLeaksAndRumours",
    downloaded_images: [
      {
        path: "fixture://stock/people-1.jpg",
        type: "screenshot",
        source: "pexels",
        priority: 25,
        stock: true,
      },
      {
        path: "fixture://stock/people-2.jpg",
        type: "screenshot",
        source: "unsplash",
        priority: 20,
        stock: true,
      },
    ],
    video_clips: [],
  },
  {
    id: "fixture-qa-reject",
    title: "Pitchfork Hollow Whispers",
    suggested_thumbnail_text: "PITCHFORK HOLLOW",
    flair: "Rumour",
    subreddit: "GamingLeaksAndRumours",
    downloaded_images: [
      {
        path: "fixture://stock/portrait-headshot-1.jpg",
        type: "screenshot",
        source: "pexels",
        priority: 25,
        stock: true,
        likely_human: true,
        url: "https://pexels.com/portrait-headshot-1",
      },
      {
        path: "fixture://stock/portrait-headshot-2.jpg",
        type: "screenshot",
        source: "unsplash",
        priority: 20,
        stock: true,
        likely_human: true,
        url: "https://unsplash.com/people/headshot-2",
      },
      {
        path: "fixture://stock/byline-author.jpg",
        type: "article_hero",
        source: "article",
        priority: 60,
        role: "author",
        is_author_image: true,
        url: "https://example.com/author/byline-jane.jpg",
      },
    ],
    video_clips: [],
  },
];

async function main() {
  await fs.ensureDir(OUT_DIR);
  const summary = [];
  for (const story of FIXTURES) {
    const qa = evaluateStoryVisualQa(story);
    const { jsonPath, mdPath } = await writeQaArtefacts(qa, OUT_DIR);
    summary.push({
      id: story.id,
      result: qa.result,
      classification: qa.inventory?.classification,
      failures: qa.failures,
      warnings: qa.warnings,
      jsonPath: path.relative(ROOT, jsonPath),
      mdPath: path.relative(ROOT, mdPath),
    });
  }
  await fs.writeFile(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  const indexLines = ["# Visual QA fixtures", ""];
  for (const s of summary) {
    indexLines.push(
      `- ${s.id}: result=**${s.result}** class=${s.classification} (${s.mdPath})`,
    );
  }
  await fs.writeFile(
    path.join(OUT_DIR, "index.md"),
    indexLines.join("\n") + "\n",
  );
  return summary;
}

if (require.main === module) {
  main()
    .then((summary) => {
      console.log(
        `[visual-qa] processed ${summary.length} fixture(s): ` +
          summary
            .map((s) => `${s.id}=${s.result}/${s.classification}`)
            .join(", "),
      );
    })
    .catch((err) => {
      console.error(`[visual-qa] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main, FIXTURES };
