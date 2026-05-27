"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runCli } = require("../../tools/studio-governance");

test("studio governance CLI reads local inputs and writes the required artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-governance-cli-"));
  const storyPath = path.join(tmp, "story.json");
  const rightsPath = path.join(tmp, "rights.json");
  const outDir = path.join(tmp, "out");

  await fs.writeFile(
    storyPath,
    JSON.stringify(
      {
        id: "cli-mixtape",
        canonical_subject: "Mixtape",
        public_title: "Mixtape Just Avoided Gaming's Delisting Trap",
        suggested_title: "Mixtape Just Avoided Gaming's Delisting Trap",
        suggested_thumbnail_text: "MIXTAPE WON'T VANISH",
        source_type: "rss",
        primary_source: "Rock Paper Shotgun",
        article_url: "https://www.rockpapershotgun.com/mixtape",
        full_script:
          "Mixtape just dodged one of gaming's most annoying problems. Rock Paper Shotgun says the developer paid extra for lasting music rights. That matters because soundtrack-heavy games can disappear when rights expire. Follow Pulse Gaming for the gaming stories behind the headline.",
        description:
          "Mixtape paid extra for lasting music rights. Source: Rock Paper Shotgun.",
        manual_caption_generated: true,
        audio_path: "output/audio/cli-mixtape.mp3",
        downloaded_images: [
          {
            id: "cli-mixtape-card",
            path: "output/images/cli-mixtape.jpg",
            source_type: "article_image",
          },
        ],
        platform_disclosures: {
          youtube: { paid_promotion: false, altered_or_synthetic: false },
          tiktok: { ai_generated_content_label: false },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    rightsPath,
    JSON.stringify(
      [
        {
          asset_id: "cli-mixtape-card",
          path: "output/images/cli-mixtape.jpg",
          source_type: "article_image",
          licence_basis: "editorial_source_reference",
          allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
          commercial_use_allowed: true,
          risk_score: 0.2,
        },
        {
          asset_id: "cli-mixtape-audio",
          path: "output/audio/cli-mixtape.mp3",
          source_type: "local_tts_voice",
          licence_basis: "owned_local_voice_model",
          allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
          commercial_use_allowed: true,
          risk_score: 0.05,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  const result = await runCli([
    "node",
    "tools/studio-governance.js",
    "--story-file",
    storyPath,
    "--rights-ledger",
    rightsPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-20T10:00:00.000Z",
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.publish_manifest.publish_status, "GREEN");
  for (const file of [
    "publish_manifest.json",
    "risk_report.json",
    "rejection_reasons.json",
    "correction_plan.json",
    "audit_log.json",
  ]) {
    const parsed = JSON.parse(await fs.readFile(path.join(outDir, file), "utf8"));
    assert.ok(parsed);
  }
});
