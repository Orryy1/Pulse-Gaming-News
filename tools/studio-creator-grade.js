"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { discoverLocalStudioMedia } = require("../lib/studio/media-acquisition");
const { buildStoryPackage } = require("../lib/studio/v2/story-package");
const {
  buildCreatorGradePlan,
  loadJsonIfExists,
  renderCreatorGradeMarkdown,
} = require("../lib/studio/creator-grade/orchestrator");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const STORY_ID = process.argv[2] || "1sn9xhe";

function loadStoryRow(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`no story row found for ${storyId}`);
  return row;
}

async function main() {
  console.log("==============================================");
  console.log("  CREATOR-GRADE STUDIO BRAIN");
  console.log(`  story: ${STORY_ID}`);
  console.log("==============================================");
  const story = loadStoryRow(STORY_ID);
  const { pkg } = await buildStoryPackage(STORY_ID, { skipLlm: true });
  const media = await discoverLocalStudioMedia({ root: ROOT, storyId: STORY_ID });
  const renderReport =
    loadJsonIfExists(path.join(TEST_OUT, `${STORY_ID}_studio_v2_report.json`)) ||
    loadJsonIfExists(path.join(TEST_OUT, `${STORY_ID}_studio_v2_v21_report.json`));

  const plan = buildCreatorGradePlan({
    story,
    media,
    packageData: pkg,
    renderReport,
    scenes: renderReport?.sceneList || [],
    runtimeS: renderReport?.runtime?.durationS || null,
  });

  await fs.ensureDir(TEST_OUT);
  const jsonPath = path.join(TEST_OUT, `${STORY_ID}_creator_grade_plan.json`);
  const mdPath = path.join(TEST_OUT, `${STORY_ID}_creator_grade_plan.md`);
  const contactSheet = path.join(
    TEST_OUT,
    `studio_v2_${STORY_ID}_canonical_vs_v21_contact.jpg`,
  );
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(
    mdPath,
    renderCreatorGradeMarkdown(plan, {
      renderPath: renderReport?.outputPath || null,
      contactSheetPath: (await fs.pathExists(contactSheet)) ? contactSheet : null,
    }),
    "utf8",
  );

  console.log(`[creator-grade] verdict: ${plan.verdict}`);
  console.log(`[creator-grade] vault: ${plan.vault.stats.acceptedAssets} accepted assets, ${plan.vault.stats.stockRejected} stock rejected`);
  console.log(`[creator-grade] timeline coverage: ${Math.round(plan.timeline.alignment.coverage * 100)}%`);
  console.log(`[creator-grade] A/B winner: ${plan.abPlan.winner?.id || "none"} (${plan.abPlan.winner?.score ?? 0}/100)`);
  console.log(`[creator-grade] json: ${path.relative(ROOT, jsonPath)}`);
  console.log(`[creator-grade] md:   ${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
