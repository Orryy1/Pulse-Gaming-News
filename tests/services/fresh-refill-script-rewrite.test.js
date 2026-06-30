"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs-extra");
const path = require("node:path");

const {
  assertSafeArtifactDir,
  buildFreshRefillViewerScript,
  runFreshRefillScriptRewrite,
} = require("../../lib/ops/fresh-refill-script-rewrite");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_ROOT = path.join(ROOT, "test", "output", "fresh-refill-script-rewrite");
const GENERIC_SCRIPT =
  "Tekken 8 has a new source detail, but the real question is still what players can do with it. Eurogamer says Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles. If it changes when people buy, download, wishlist or return, the update matters. If it only repeats a headline, it needs stronger proof before it deserves attention. The next official detail has to make that choice clear: play now, wait, skip or watch for gameplay. Follow Pulse Gaming so you never miss a beat.";

function tekkenBobJob(artifactDir) {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    title: "Tekken 8 Finally Shows Real Gameplay",
    artifact_dir: artifactDir,
    source: {
      name: "Eurogamer",
      url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
      type: "rss",
      published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    },
    current_script: GENERIC_SCRIPT,
    scorecard_verdict: "rewrite_required",
    scorecard_blockers: [
      "generic_title_template",
      "persuasive_authority_trope",
      "internal_audience_scaffold",
    ],
  };
}

function canonicalManifest() {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    canonical_subject: "Tekken 8",
    canonical_game: "Tekken 8",
    canonical_title: "Tekken 8 Finally Shows Real Gameplay",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
    source_published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    confirmed_claims: [
      "Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles",
    ],
    selected_title: "Tekken 8 Finally Shows Real Gameplay",
    short_title: "Tekken 8 Just Got A New Signal",
    narration_hook:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    first_spoken_line:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    narration_script: GENERIC_SCRIPT,
    tts_script: GENERIC_SCRIPT,
    spoken_narration_script: GENERIC_SCRIPT,
    description: "Source: Eurogamer.",
    title: "Tekken 8 Finally Shows Real Gameplay",
    public_title: "Tekken 8 Finally Shows Real Gameplay",
  };
}

function platformManifest() {
  return {
    schema_version: 1,
    story_id: "rss_4a07e21d3192fd7c",
    operating_mode: "LOCAL_PROOF",
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Tekken 8 Finally Shows Real Gameplay",
        description: "Generic description.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      instagram_reels: {
        caption: "Generic caption.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      facebook_reels: {
        page_caption: "Generic page caption.",
      },
      x: {
        hot_take_post: "Generic X post.",
        thread_posts: ["Generic thread."],
      },
    },
  };
}

async function writeFixture(name = "case") {
  const artifactDir = path.join(TEST_ROOT, name, "artifact");
  await fs.remove(path.join(TEST_ROOT, name));
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), canonicalManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), platformManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    blockers: ["internal_audience_scaffold"],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    result: "fail",
    failures: ["script_coherence:vague_filler:internal_audience_scaffold"],
  }, { spaces: 2 });

  const workOrderPath = path.join(TEST_ROOT, name, "work_order.json");
  await fs.writeJson(workOrderPath, {
    schema_version: 1,
    source: "test",
    jobs: [tekkenBobJob(artifactDir)],
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    },
  }, { spaces: 2 });

  return { artifactDir, workOrderPath };
}

test("fresh refill viewer script turns a generic Bob script into viral-ready narration", () => {
  const script = buildFreshRefillViewerScript({
    job: tekkenBobJob(path.join(TEST_ROOT, "unused")),
    manifest: canonicalManifest(),
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /^Tekken 8 bringing Bob back\b/);
  assert.match(script.full_script, /Bob|roster|matchups|lapsed players/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /new source detail|real question|play now, wait, skip|source-backed update|the player impact is/i,
  );
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script keeps Marvel Tokon roster gameplay copy concrete early", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_228f6f28b62f8426",
      title: "Blade, Loki, Deadpool Announced For MARVEL Tokon Finally Shows Real Gameplay",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/28/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Blade, Loki, Deadpool announced for MARVEL Tokon: Fighting Souls.",
    },
    manifest: {
      story_id: "rss_228f6f28b62f8426",
      confirmed_claims: [
        "Blade, Loki and Deadpool were announced for MARVEL Tokon: Fighting Souls",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /combat styles|movement problem/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill script rewrite dry-run leaves local proof files unchanged", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("dry-run");
  const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  const before = await fs.readFile(manifestPath, "utf8");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "dry-run", "report"),
    applyLocal: false,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 0);
  assert.equal(report.summary.would_apply_count, 1);
  assert.equal(report.output_dir, path.join(TEST_ROOT, "dry-run", "report"));
  assert.equal(await fs.readFile(manifestPath, "utf8"), before);
});

test("fresh refill script rewrite apply updates only local proof artefacts", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("apply");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "apply", "report"),
    applyLocal: true,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 1);

  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.match(manifest.narration_script, /^Tekken 8 bringing Bob back\b/);
  assert.doesNotMatch(manifest.narration_script, /new source detail|real question|play now, wait, skip/i);
  assert.equal(manifest.script_repair.local_only, true);
  assert.equal(manifest.script_repair.no_db_mutation, true);

  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.deepEqual(scorecard.blockers, []);

  const coherence = await fs.readJson(path.join(artifactDir, "coherence_report.json"));
  assert.equal(coherence.result, "pass", JSON.stringify(coherence, null, 2));

  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.match(platform.outputs.youtube_shorts.description, /Bob|Eurogamer/i);
  assert.doesNotMatch(platform.outputs.instagram_reels.caption, /new source detail|real question/i);
});

test("fresh refill script rewrite refuses artifact directories outside local output roots", () => {
  assert.throws(
    () => assertSafeArtifactDir(path.resolve(ROOT, "..", "outside-artifact"), ROOT),
    /unsafe_artifact_dir/,
  );
});
