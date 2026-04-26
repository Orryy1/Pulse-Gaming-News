/**
 * tools/studio-v2-build-cards.js — CLI to build all story-specific
 * HF cards for a given storyId.
 *
 * Usage:
 *   node tools/studio-v2-build-cards.js <storyId>
 *   node tools/studio-v2-build-cards.js 1sn9xhe
 *
 * Reads the DB row for storyId, builds the story package (offline
 * mode — no LLM call), derives content for source/context/quote/
 * takeaway via deriveCardContent(), then builds all 4 HF cards and
 * writes a manifest to test/output/<id>_studio_v2_cards.json.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const { buildStoryPackage } = require("../lib/studio/v2/story-package");
const {
  buildAllStoryCards,
  deriveCardContent,
} = require("../lib/studio/v2/hf-card-builders");

function loadStoryRow(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment, article_image
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`no story row found for ${storyId}`);
  return row;
}

async function main() {
  const storyId = process.argv[2] || "1sn9xhe";
  await fs.ensureDir(TEST_OUT);

  console.log("");
  console.log(`[v2-cards] building all HF cards for ${storyId}…`);
  console.log("");

  const story = loadStoryRow(storyId);
  const { pkg } = await buildStoryPackage(storyId, { skipLlm: true });

  // Print derived content first so the user can see what's about to render.
  const content = deriveCardContent({ story, pkg });
  console.log(`[v2-cards] derived content for ${storyId}:`);
  console.log(JSON.stringify(content, null, 2));
  console.log("");

  const manifest = await buildAllStoryCards({ story, pkg });

  const manifestPath = path.join(TEST_OUT, `${storyId}_studio_v2_cards.json`);
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  console.log("");
  console.log("[v2-cards] DONE");
  console.log(`  manifest: ${path.relative(ROOT, manifestPath)}`);
  for (const [kind, card] of Object.entries(manifest.cards)) {
    console.log(
      `    · ${kind.padEnd(10)} → ${path.relative(ROOT, card.outPath)}`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
