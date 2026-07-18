"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairFlagshipScriptWorkspace,
  validateFlagshipScriptPatch,
} = require("../../lib/flagship-script-repair");

const STORY_ID = "rss_flagship";
const CTA = "Follow Pulse Gaming so you never miss a beat.";
const SCRIPT = [
  "Ascend to ZERO gives you thirty seconds, and one lethal hit can steal even more.",
  "Instead of draining a normal health bar, lethal damage shaves seconds from the run.",
  "But Time-Stop flips the pressure.",
  "Enemies, projectiles and even the countdown freeze while you keep moving.",
  "You can dodge, grab experience and position a counterattack before your Avatar Skill and gadgets fire when time resumes.",
  "Time is not just a limit.",
  "It is your defence, your setup window and the thing every fatal mistake destroys.",
  "Flyway Games says every Avatar was rebalanced, difficulty options and a play guide were added, while the late game now forces riskier route choices before a final boss.",
  "It is on Game Pass now.",
  "Does that pressure sound brilliant, or would losing seconds after one lethal hit feel brutal?",
  CTA,
].join(" ");

function patch() {
  return {
    story_id: STORY_ID,
    canonical_subject: "Ascend to ZERO",
    canonical_game: "Ascend to ZERO",
    canonical_company: "Flyway Games",
    confirmed_claims: [
      "The first run starts with thirty seconds on the clock.",
      "Taking a lethal hit removes seconds from the clock.",
      "Time-Stop freezes enemies, projectiles and the countdown while the player keeps moving.",
    ],
    title: "Ascend to ZERO Makes Lethal Hits Steal Time",
    first_frame_text: "LETHAL HITS STEAL TIME",
    first_spoken_line: "Ascend to ZERO gives you thirty seconds, and one lethal hit can steal even more.",
    narration_script: SCRIPT,
  };
}

test("flagship script patch rejects universalised claims not supported by lethal-hit evidence", () => {
  const canonical = {
    story_id: STORY_ID,
    canonical_company: "Flyway Games",
    confirmed_claims: ["Taking a lethal hit removes seconds from the clock."],
  };
  assert.throws(
    () => validateFlagshipScriptPatch({
      ...patch(),
      title: "Ascend to ZERO Makes Every Hit Steal Time",
      first_spoken_line: patch().first_spoken_line.replace(
        "one lethal hit can steal even more",
        "every hit steals even more",
      ),
      narration_script: SCRIPT.replace(
        "one lethal hit can steal even more",
        "every hit steals even more",
      ),
    }, canonical),
    /unsupported_universal_hit_claim/,
  );
});

test("flagship script patch rejects viewer-facing editorial scaffold language", () => {
  const canonical = {
    story_id: STORY_ID,
    canonical_company: "Flyway Games",
    confirmed_claims: ["Taking a lethal hit removes seconds from the clock."],
  };
  assert.throws(
    () => validateFlagshipScriptPatch({
      ...patch(),
      narration_script: SCRIPT.replace(
        "Time is not just a limit.",
        "That is the real hook: time is not just a limit.",
      ),
    }, canonical),
    /script_patch_internal_or_scaffold_language/,
  );
});

test("flagship script patch keeps a colonised canonical game title continuous for TTS", () => {
  const narrationScript = SCRIPT.replaceAll("Ascend to ZERO", "Arknights: Endfield");
  const firstSpokenLine = patch().first_spoken_line.replace(
    "Ascend to ZERO",
    "Arknights: Endfield",
  );
  const validated = validateFlagshipScriptPatch({
    ...patch(),
    canonical_subject: "Arknights: Endfield",
    canonical_game: "Arknights: Endfield",
    title: "Arknights: Endfield Puts PS5 Pro To The Test",
    first_spoken_line: firstSpokenLine,
    narration_script: narrationScript,
  }, {
    story_id: STORY_ID,
    canonical_company: "Flyway Games",
    confirmed_claims: patch().confirmed_claims,
  });

  assert.match(validated.ttsScript, /\bArknights End Field\b/);
  assert.doesNotMatch(validated.ttsScript, /\bArknights:\s+Endfield\b/);
});

test("flagship script repair invalidates stale media and writes a local audio workbench", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-script-repair-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactDir = path.join(root, "artifacts", STORY_ID);
  const workOrderPath = path.join(root, "render_input_work_order.json");
  await fs.mkdir(path.join(artifactDir, "audio"), { recursive: true });
  await fs.mkdir(path.join(artifactDir, "flagship"), { recursive: true });
  await fs.writeFile(path.join(artifactDir, "audio", "narration.mp3"), "stale-audio");
  await fs.writeFile(path.join(artifactDir, "audio", "word_timestamps.json"), "{}");
  await fs.writeFile(path.join(artifactDir, "flagship", "final_audio.mp3"), "stale-audio");
  await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), "stale-video");
  await fs.writeFile(path.join(artifactDir, "render_manifest.json"), "{}");
  await fs.writeFile(path.join(artifactDir, "final_av_review.json"), "{}");
  await fs.writeFile(path.join(artifactDir, "materialised_motion_clips.json"), JSON.stringify({
    story_id: STORY_ID,
    clips: [{ id: "motion-1", path: "motion.mp4" }],
  }));
  await fs.writeFile(path.join(artifactDir, "claim_inventory.json"), JSON.stringify({
    schema_version: 1,
    story_id: STORY_ID,
    confirmed: ["Stale claim."],
    unconfirmed: [],
    prohibited: [],
  }));
  await fs.writeFile(path.join(artifactDir, "rights_ledger.json"), JSON.stringify({
    story_id: STORY_ID,
    assets: [{ asset_id: "motion-1", status: "approved" }],
  }));
  await fs.writeFile(path.join(artifactDir, "canonical_story_manifest.json"), JSON.stringify({
    story_id: STORY_ID,
    canonical_subject: "Ascend",
    canonical_game: "Ascend",
    canonical_company: "",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/example",
    confirmed_claims: [
      "The first run starts with thirty seconds on the clock.",
      "Taking a lethal hit removes seconds from the clock.",
    ],
    narration_script: "Old narration.",
    tts_script: "Old narration.",
  }));
  await fs.writeFile(workOrderPath, JSON.stringify({
    schema_version: 1,
    jobs: [{
      story_id: STORY_ID,
      artifact_dir: artifactDir,
      status: "ready_for_final_render_job",
      blockers: [],
      evidence: {
        narration_ready: true,
        word_timestamps_ready: true,
        narration_audio_path: path.join(artifactDir, "audio", "narration.mp3"),
        narration_audio_sha256: "a".repeat(64),
        narration_audio_size_bytes: 11,
        word_timestamps_path: path.join(artifactDir, "audio", "word_timestamps.json"),
        word_timestamps_sha256: "b".repeat(64),
        word_timestamps_size_bytes: 2,
      },
      actions: [],
    }],
  }));

  const result = await repairFlagshipScriptWorkspace({
    artifactDir,
    workOrderPath,
    patch: patch(),
    generatedAt: "2026-07-17T06:30:00.000Z",
  });

  const canonical = JSON.parse(
    await fs.readFile(path.join(artifactDir, "canonical_story_manifest.json"), "utf8"),
  );
  const workOrder = JSON.parse(await fs.readFile(workOrderPath, "utf8"));
  const workbench = JSON.parse(await fs.readFile(result.audioWorkbenchPath, "utf8"));

  assert.equal(canonical.narration_script, SCRIPT);
  assert.equal(canonical.canonical_subject, "Ascend to ZERO");
  assert.equal(canonical.canonical_game, "Ascend to ZERO");
  assert.equal(canonical.canonical_company, "Flyway Games");
  assert.deepEqual(canonical.confirmed_claims, patch().confirmed_claims);
  assert.deepEqual(canonical.claim_inventory.confirmed, patch().confirmed_claims);
  assert.equal(canonical.selected_title, patch().title);
  assert.equal(canonical.first_frame_text, patch().first_frame_text);
  assert.equal(canonical.tts_script.includes("Follow Pulse Gaming so you never miss a beat."), true);
  assert.equal(await fs.stat(path.join(artifactDir, "materialised_motion_clips.json")).then(() => true), true);
  assert.equal(await fs.stat(path.join(artifactDir, "rights_ledger.json")).then(() => true), true);
  const claimInventory = JSON.parse(
    await fs.readFile(path.join(artifactDir, "claim_inventory.json"), "utf8"),
  );
  assert.deepEqual(claimInventory.confirmed, patch().confirmed_claims);
  await assert.rejects(fs.stat(path.join(artifactDir, "audio", "narration.mp3")), /ENOENT/);
  await assert.rejects(fs.stat(path.join(artifactDir, "visual_v4_render.mp4")), /ENOENT/);
  await assert.rejects(fs.stat(path.join(artifactDir, "final_av_review.json")), /ENOENT/);
  assert.equal(workOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.deepEqual(workOrder.jobs[0].blockers, [
    "narration_audio_missing",
    "word_timestamps_missing",
  ]);
  assert.equal(workOrder.jobs[0].evidence.narration_ready, false);
  assert.equal(workOrder.jobs[0].evidence.narration_audio_sha256, undefined);
  assert.equal(workbench.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(workbench.jobs[0].artifact_dir, artifactDir);
  assert.equal(result.report.status, "READY_FOR_LOCAL_AUDIO_REGENERATION");
  assert.equal(result.report.publish_authorised, false);
});
