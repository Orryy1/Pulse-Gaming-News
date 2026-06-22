"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyCanonicalEntityRepairs,
  parseArgs,
} = require("../../tools/studio-v4-apply-canonical-entity-repairs");
const packageJson = require("../../package.json");

test("Studio V4 canonical entity repair apply updates package manifests locally", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-canonical-repair-"));
  try {
    const artifactDir = path.join(tempDir, "packages", "black-ops");
    await fs.ensureDir(artifactDir);
    const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
    await fs.writeJson(
      manifestPath,
      {
        story_id: "black-ops",
        selected_title: "Black Ops Classics Face A Price Test Just Got More Expensive",
        canonical_subject: "Black Ops Classics Face A Price Test",
        canonical_game: "Black Ops Classics Face A Price Test",
      },
      { spaces: 2 },
    );
    const storyPackagesPath = path.join(tempDir, "production_cutover_story_packages.json");
    await fs.writeJson(
      storyPackagesPath,
      [
        {
          story_id: "black-ops",
          title: "Black Ops Classics Face A Price Test Just Got More Expensive",
          artifact_dir: artifactDir,
          canonical_subject: "Black Ops Classics Face A Price Test",
          canonical_game: "Black Ops Classics Face A Price Test",
        },
      ],
      { spaces: 2 },
    );
    const repairTemplatePath = path.join(tempDir, "canonical_repair.json");
    await fs.writeJson(
      repairTemplatePath,
      [
        {
          story_id: "black-ops",
          repair_lane: "canonical_entity_repair",
          current_primary_entity: "Black Ops Classics Face A Price Test",
          suggested_repaired_entity: "Call of Duty: Black Ops",
          blockers: ["title_shaped_primary_entity"],
        },
      ],
      { spaces: 2 },
    );

    const report = await applyCanonicalEntityRepairs({
      root: tempDir,
      storyPackagesPath,
      repairTemplatePath,
      outDir: tempDir,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });
    const manifest = await fs.readJson(manifestPath);
    const packages = await fs.readJson(storyPackagesPath);
    const writtenReport = await fs.readJson(path.join(tempDir, "canonical_entity_repair_apply_report.json"));

    assert.equal(report.summary.changed_count, 1);
    assert.equal(report.summary.blocked_count, 0);
    assert.equal(manifest.canonical_subject, "Call of Duty: Black Ops");
    assert.equal(manifest.canonical_game, "Call of Duty: Black Ops");
    assert.equal(manifest.canonical_entity_repair.previous_canonical_subject, "Black Ops Classics Face A Price Test");
    assert.equal(packages[0].canonical_subject, "Call of Duty: Black Ops");
    assert.equal(writtenReport.safety.no_publish_triggered, true);
    assert.equal(writtenReport.safety.no_db_mutation, true);
  } finally {
    await fs.remove(tempDir);
  }
});

test("Studio V4 canonical entity repair apply CLI args and script are registered", () => {
  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--repair-template",
    "repairs.json",
    "--story-id",
    "a",
    "--story-ids",
    "b,c",
    "--out-dir",
    "out",
    "--json",
  ]);

  assert.equal(args.storyPackages, "packages.json");
  assert.equal(args.repairTemplate, "repairs.json");
  assert.deepEqual(args.storyIds, ["a", "b", "c"]);
  assert.equal(args.outDir, "out");
  assert.equal(args.json, true);
  assert.match(
    packageJson.scripts["ops:v4-apply-canonical-entity-repairs"],
    /studio-v4-apply-canonical-entity-repairs\.js/,
  );
});
