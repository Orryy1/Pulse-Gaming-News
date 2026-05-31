"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  materializeTiktokCreatorRewardsVariants,
  _testables,
} = require("../../lib/goal-tiktok-creator-rewards-variant-materializer");
const {
  parseArgs,
} = require("../../tools/goal-tiktok-creator-rewards-variant-materializer");
const {
  evaluateGoalPublicCopy,
} = require("../../lib/goal-public-copy-qa");

function wordCount(value = "") {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function charAlignment(text) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.045),
    character_end_times_seconds: characters.map((_, index) => index * 0.045 + 0.035),
  };
}

test("TikTok creator-rewards captions prefer usable alignment words over stale clamped words", () => {
  const staleWords = Array.from({ length: 8 }, (_, index) => ({
    word: `stale${index + 1}`,
    start: index < 3 ? index * 0.4 : 4.44,
    end: index < 3 ? index * 0.4 + 0.2 : 4.48,
  }));
  const alignmentWords = Array.from({ length: 8 }, (_, index) => ({
    word: `aligned${index + 1}`,
    start: Number((index * 0.65).toFixed(3)),
    end: Number((index * 0.65 + 0.32).toFixed(3)),
  }));

  const words = _testables.timestampWords({
    words: staleWords,
    alignment: { words: alignmentWords },
  });

  assert.equal(words.length, alignmentWords.length);
  assert.equal(words[3].word, "aligned4");
  assert.equal(words.at(-1).end, alignmentWords.at(-1).end);
});

async function makePackage(root, storyId = "creator-rewards-story") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const baseVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  await fs.outputFile(baseVideoPath, Buffer.alloc(4096, 1));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    thumbnail_headline: "FORZA'S STEAM BET",
    first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
    narration_script:
      "Forza Horizon 6 just made Xbox's Steam plan harder to ignore. IGN reports the Steam launch is now part of Xbox's PC push. Players now have to compare store access, Game Pass timing and launch polish before the next big reveal. Follow Pulse Gaming so you never miss a beat.",
    primary_source: "IGN",
    confirmed_claims: ["IGN reports the Steam launch is now part of Xbox's PC push."],
    platform_ctas: {
      youtube: "Sources and setup links are on the story page.",
      tiktok: "Sources and setup links are on the story page.",
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [{ kind: "proof_card", label: "STEAM SIGNAL", detail: "Xbox PC push" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output_path: baseVideoPath,
    rendered_duration_s: 44.2,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    publish_status: "GREEN",
    outputs: {
      tiktok: {
        publish_duration_seconds: { min: 15, max: 90 },
        duration_warnings: ["below_creator_rewards_duration"],
        creator_rewards_eligible: false,
        creator_rewards_duration_seconds: { min: 61, max: 90 },
      },
    },
  });
  const rightsRows = [];
  const motionRows = [];
  for (let index = 1; index <= 3; index += 1) {
    const clipPath = path.join(artifactDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 1));
    rightsRows.push({
      asset_id: `${storyId}-clip-${index}`,
      asset_type: "video_clip",
      path: clipPath,
      source_url: `https://store.steampowered.com/forza-${index}`,
      source_type: "steam_storefront",
      licence_basis: "steam_storefront_promotional_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      commercial_use_allowed: true,
      risk_score: 0.08,
      approval_status: "approved_for_transformative_editorial_use",
    });
    motionRows.push({
      id: `${storyId}-clip-${index}`,
      path: clipPath,
      source_url: `https://store.steampowered.com/forza-${index}`,
      source_type: "steam_storefront",
      source_family: `steam_storefront_${index}`,
      rights_basis: "steam_storefront_promotional_editorial_use",
      counts_towards_motion_readiness: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    matched_assets: rightsRows,
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: motionRows,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: motionRows,
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    selected_assets: [],
  });
  return { story_id: storyId, artifact_dir: artifactDir, baseVideoPath };
}

test("TikTok creator-rewards materializer writes a separate long variant without mutating the base short", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-"));
  const storyPackage = await makePackage(root);
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const baseRenderManifestPath = path.join(storyPackage.artifact_dir, "render_manifest.json");
  const baseCanonicalBefore = await fs.readJson(canonicalPath);
  const baseRenderBefore = await fs.readJson(baseRenderManifestPath);
  const audioCalls = [];
  const renderCalls = [];

  const report = await materializeTiktokCreatorRewardsVariants({
    workspaceRoot: root,
    generatedAt: "2026-05-27T09:00:00.000Z",
    workOrder: {
      jobs: [
        {
          story_id: storyPackage.story_id,
          title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
          artifact_dir: storyPackage.artifact_dir,
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: 44.2,
          target_duration_seconds: { min: 61, max: 75 },
        },
      ],
    },
    alignmentMode: "off",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 4));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push({ storyJson, output, story });
      await fs.outputFile(output, Buffer.alloc(8192, 5));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 64.4,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.renderer_invoked, true);
  assert.equal(audioCalls.length, 1);
  assert.equal(renderCalls.length, 1);
  assert.ok(
    wordCount(audioCalls[0].text) >= 155,
    `local TikTok creator-rewards narration must clear the 61s floor; got ${wordCount(audioCalls[0].text)} words`,
  );
  assert.ok(
    wordCount(audioCalls[0].text) <= 210,
    `local TikTok creator-rewards narration should stay compact enough for stable local TTS; got ${wordCount(audioCalls[0].text)} words`,
  );

  assert.deepEqual(await fs.readJson(canonicalPath), baseCanonicalBefore);
  assert.deepEqual(await fs.readJson(baseRenderManifestPath), baseRenderBefore);
  assert.equal(await fs.pathExists(storyPackage.baseVideoPath), true);

  const job = report.jobs[0];
  assert.match(job.variant_artifact_dir, /platform_variants[\\/]tiktok_creator_rewards$/);
  assert.equal(await fs.pathExists(path.join(job.variant_artifact_dir, "canonical_story_manifest.json")), true);
  assert.equal(await fs.pathExists(job.output_path), true);
  assert.equal(await fs.pathExists(job.captions_path), true);

  const variantCanonical = await fs.readJson(path.join(job.variant_artifact_dir, "canonical_story_manifest.json"));
  assert.equal(variantCanonical.story_id, `${storyPackage.story_id}__tiktok_creator_rewards`);
  assert.equal(variantCanonical.base_story_id, storyPackage.story_id);
  assert.equal(variantCanonical.platform_variant_type, "tiktok_creator_rewards");
  assert.ok(variantCanonical.word_count > baseCanonicalBefore.word_count || variantCanonical.word_count > 60);
  assert.equal(require("../../audio").cleanForTTS(renderCalls[0].story.full_script), audioCalls[0].text);
  assert.equal(renderCalls[0].story.id, variantCanonical.story_id);

  const platformManifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const tiktok = platformManifest.outputs.tiktok;
  assert.equal(tiktok.creator_rewards_eligible, true);
  assert.equal(tiktok.technical_duration_seconds, 64.4);
  assert.deepEqual(tiktok.duration_warnings, []);
  assert.equal(tiktok.platform_variant_render.variant_type, "tiktok_creator_rewards");
  assert.equal(tiktok.platform_variant_render.base_render_mutated, false);
  assert.match(tiktok.variant_video_path, /visual_v4_render_tiktok_creator_rewards\.mp4$/);
  assert.match(tiktok.variant_captions_path, /captions_tiktok_creator_rewards\.srt$/);
});

test("TikTok creator-rewards materializer uses story-specific context instead of generic reveal filler", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-context-"));
  const cases = [
    {
      storyId: "creator-rewards-launch",
      canonical: {
        canonical_subject: "Crimson Desert",
        canonical_game: "Crimson Desert",
        selected_title: "Crimson Desert Is Already Live",
        thumbnail_headline: "CRIMSON DESERT LIVE",
        first_spoken_line: "Crimson Desert is already live after years of glossy showcase footage.",
        narration_script:
          "Crimson Desert is already live after years of glossy showcase footage. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Now the shipped build has to carry the spectacle, combat, performance and scale, not just trailer shots. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "GameSpot",
        confirmed_claims: [
          "GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.",
        ],
      },
      mustMatch: /past the trailer phase|launch build|real hardware/i,
      wordRange: { min: 155, max: 180 },
    },
    {
      storyId: "creator-rewards-job-market",
      canonical: {
        canonical_subject: "Deus Ex",
        canonical_game: "Deus Ex",
        selected_title: "Deus Ex Composer Says The Jobs Vanished",
        thumbnail_headline: "DEUS EX JOBS VANISHED",
        first_spoken_line: "A Deus Ex composer says the games job market has gone brutally quiet.",
        narration_script:
          "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports the Deus Ex and Unreal composer submitted 50 resumes and got one interview in the last year. The story is the talent squeeze behind the games people still recognise years later. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "PC Gamer",
        confirmed_claims: [
          "PC Gamer reports the Deus Ex and Unreal composer submitted 50 resumes and got one interview in the last year.",
        ],
      },
      mustMatch: /specialist craft|audio talent|job market/i,
      wordRange: { min: 185, max: 205 },
    },
    {
      storyId: "creator-rewards-anti-cheat-trust",
      canonical: {
        canonical_subject: "Valorant",
        canonical_game: "Valorant",
        selected_title: "Valorant's Vanguard Trust Problem",
        thumbnail_headline: "VANGUARD TRUST PROBLEM",
        first_spoken_line: "Valorant's Vanguard update has a nasty trust problem.",
        narration_script:
          "Valorant's Vanguard update has a nasty trust problem. PCGamesN reports Valorant's new Vanguard update seems to be bricking cheaters' PCs. Riot's response? \"Congrats on your $6k paperweights\". The catch is what this changes for Valorant players: Riot can dunk on cheaters and still leave normal players asking how much control Vanguard should have. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "PCGamesN",
        confirmed_claims: [
          "PCGamesN reports Valorant's new Vanguard update seems to be bricking cheaters' PCs.",
        ],
      },
      mustMatch: /competitive integrity|player confidence|software staying explainable/i,
      wordRange: { min: 185, max: 205 },
      mustNotMatch: /players have to judge the footage|at phone speed|generic reveal/i,
    },
    {
      storyId: "creator-rewards-hades-console-date",
      canonical: {
        canonical_subject: "Hades II",
        canonical_game: "Hades II",
        selected_title: "Hades II Just Broke PlayStation's Silence",
        thumbnail_headline: "HADES II CONSOLE DATE",
        first_spoken_line: "Hades II just put PlayStation and Xbox players on the same April countdown.",
        narration_script:
          "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. Hades II is no longer just a PC early-access story waiting for a console footnote. PlayStation and Xbox getting the same April date turns it into a launch-day race. The feel is the pressure point: laggy dodges would blunt Hades II. Hades lives on tight dodge timing, clean reads and broken builds spreading fast. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Xbox",
        confirmed_claims: [
          "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
        ],
      },
      mustMatch: /console version angle|repeat attempts|port still has to feel immediate/i,
      wordRange: { min: 178, max: 195 },
      mustSpeak: /Hades two just put PlayStation and Xbox players/i,
    },
    {
      storyId: "creator-rewards-same-world-new-game",
      canonical: {
        canonical_subject: "V Rising",
        canonical_game: "V Rising",
        selected_title: "V Rising Devs Are Making Another Vampire Game",
        thumbnail_headline: "V RISING DEVS ARE MAKING",
        first_spoken_line: "V Rising's developers are already building another vampire game.",
        narration_script:
          "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update. That shifts the fan question from the next patch to how far Stunlock can stretch its vampire world. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Stunlock Studios",
        confirmed_claims: [
          "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
        ],
      },
      mustMatch: /second vampire pitch|roadmap watching|official blog matters/i,
      wordRange: { min: 180, max: 198 },
      thumbnailMustBe: "V RISING'S NEXT GAME",
    },
    {
      storyId: "creator-rewards-leak-dispute",
      canonical: {
        canonical_subject: "Subnautica 2",
        canonical_game: "Subnautica 2",
        selected_title: "Subnautica 2 Reportedly Leaked Early",
        thumbnail_headline: "SUBNAUTICA 2 LEAKED EARLY",
        first_spoken_line: "Subnautica 2 reportedly leaked before launch.",
        narration_script:
          "Subnautica 2 reportedly leaked before launch. Respawnfirst reports Subnautica 2 reportedly appeared online before launch. Rough leaked material can travel faster than the official build, and that is brutal for a sequel still trying to set its own tone. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Respawnfirst",
        confirmed_claims: [
          "Respawnfirst reports Subnautica 2 reportedly appeared online before launch.",
        ],
      },
      mustMatch: /unfinished build|official launch build|spoiler risk/i,
      mustNotMatch: /finally has footage players can judge|clip puts the pitch|one reveal cannot settle|at phone speed/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-date-leak",
      canonical: {
        canonical_subject: "Star Wars: Galactic Racer",
        canonical_game: "Star Wars: Galactic Racer",
        selected_title: "Star Wars Racer Date Leaked Early",
        thumbnail_headline: "STAR WARS DATE LEAK",
        first_spoken_line: "Star Wars: Galactic Racer may have leaked its own release date.",
        narration_script:
          "Star Wars: Galactic Racer may have leaked its own release date. Rock Paper Shotgun reports Star Wars: Galactic Racer's release date has been accidentally revealed early. Now players can see the pace, camera and combat instead of reading another announcement. For now, the story is timing: the reveal may have slipped before the official rollout caught up. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Rock Paper Shotgun",
        confirmed_claims: [
          "Rock Paper Shotgun reports Star Wars: Galactic Racer's release date has been accidentally revealed early.",
        ],
      },
      mustMatch: /date leak is different|official listing|launch timing/i,
      mustNotMatch: /pace, camera and combat|rough footage like a final verdict|wrong slice of the game/i,
      wordRange: { min: 205, max: 230 },
    },
    {
      storyId: "creator-rewards-review-score",
      canonical: {
        canonical_subject: "Forza Horizon 6",
        canonical_game: "Forza Horizon 6",
        selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
        thumbnail_headline: "FORZA SCORES 84",
        first_spoken_line: "Forza Horizon 6 just landed a strong PC Gamer review.",
        narration_script:
          "Forza Horizon 6 just landed a strong PC Gamer review. PC Gamer reports Forza Horizon 6 review: 84 out of 100. Strong reviews matter here because this is when fence-sitters decide whether another Horizon is enough. The number is only the opening beat; outlet agreement matters more. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "PC Gamer",
        confirmed_claims: [
          "PC Gamer reports Forza Horizon 6 review: 84 out of 100.",
        ],
      },
      mustMatch: /score only lands|how it runs|verdict room to breathe/i,
      mustNotMatch: /The number is only the opening beat; outlet agreement matters more|reception is harder to dismiss|combat feel, pacing, performance and platform fit/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-squad-tactics",
      canonical: {
        canonical_subject: "Star Wars Zero Company",
        canonical_game: "Star Wars Zero Company",
        selected_title: "Star Wars Zero Company Is More Than XCOM",
        thumbnail_headline: "STAR WARS TACTICS CATCH",
        first_spoken_line: "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
        narration_script:
          "Star Wars Zero Company is trying to be more than Star Wars XCOM. PC Gamer reports Star Wars Zero Company is more than just 'Star Wars XCOM'—it feels like Mass Effect but with turn-based tactics and permadeath. The catch is what this changes for players after the headline fades. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "PC Gamer",
        confirmed_claims: [
          "PC Gamer reports Star Wars Zero Company is more than just 'Star Wars XCOM'—it feels like Mass Effect but with turn-based tactics and permadeath.",
        ],
      },
      mustMatch: /squad layer|Mass Effect comparison|permadeath matters/i,
      mustNotMatch: /players have to judge the footage|at phone speed|generic reveal|footage has to make it clear/i,
      wordRange: { min: 190, max: 215 },
    },
    {
      storyId: "creator-rewards-corporate-stake",
      canonical: {
        canonical_subject: "Kadokawa",
        canonical_game: "Kadokawa",
        selected_title: "Kadokawa Stake Just Passed Sony",
        thumbnail_headline: "KADOKAWA STAKE PASSED SONY",
        first_spoken_line: "Kadokawa's activist investor now has a bigger stake than Sony.",
        narration_script:
          "Kadokawa's activist investor now has a bigger stake than Sony. Automaton West reported that Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake. Kadokawa now has one concrete change worth remembering after the scroll moves on. That gives the short a clean shape: what changed, who said it and why players should care today. One more direct play segment would show whether the combat rhythm and camera weight match the reveal. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Automaton West",
        confirmed_claims: [
          "Automaton West reported that Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake.",
        ],
      },
      mustMatch: /stake change|Sony being passed|larger investor position/i,
      mustNotMatch: /one concrete change|clean shape|direct play segment|combat rhythm|camera weight/i,
      wordRange: { min: 185, max: 205 },
    },
    {
      storyId: "creator-rewards-accessory-listing",
      canonical: {
        canonical_subject: "Xbox Controller",
        canonical_game: "Xbox Controller",
        selected_title: "Xbox Controller Deal Has One Catch",
        thumbnail_headline: "XBOX CONTROLLER CATCH",
        first_spoken_line: "Xbox controller deals are getting aggressive, but the catch is the retailer.",
        narration_script:
          "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories. Xbox Controller is cheap enough here to change the decision for players who skipped it at full price. For anyone who still wants a physical copy, the current listing is the part to check. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Xbox",
        confirmed_claims: [
          "Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
        ],
      },
      mustMatch: /gear-listing story|controller and headset|Forza tie-in/i,
      mustNotMatch: /cheap enough|physical copy|same hardware costs more|lower entry point/i,
      wordRange: { min: 185, max: 205 },
    },
    {
      storyId: "creator-rewards-retail-discount",
      canonical: {
        canonical_subject: "Super Mario RPG",
        canonical_game: "Super Mario RPG",
        selected_title: "Super Mario RPG Drops To $15",
        thumbnail_headline: "SUPER MARIO RPG $15",
        first_spoken_line: "Super Mario RPG just dropped to $15 at GameStop.",
        narration_script:
          "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price. Super Mario RPG is cheap enough here to change the decision for players who skipped it at full price. Compare the live retailer price, the platform and whether this is finally low enough to jump in. Super Mario RPG now has a clean player-impact angle: the same hardware costs more before a single game is added. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "GameStop",
        confirmed_claims: [
          "GameStop lists Super Mario RPG at $15, 70% off its listed price.",
        ],
      },
      mustMatch: /retailer discount story|physical Switch RPG|listed price|Collectors and late Switch buyers/i,
      mustNotMatch: /same hardware costs more|compare the live retailer price|force a buy|the catch is not drama|a good deal cut should/i,
      mustNotSpeak: /turning a sale into pressure to buy/i,
      wordRange: { min: 190, max: 215 },
    },
    {
      storyId: "creator-rewards-platform-feedback",
      canonical: {
        canonical_subject: "Xbox",
        canonical_game: "Xbox",
        selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
        thumbnail_headline: "XBOX FANS WANT EXCLUSIVES",
        first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
        narration_script:
          "Xbox asked for feedback and immediately got the exclusives argument. IGN reports Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives. Xbox now has one concrete change worth remembering after the scroll moves on. Xbox needs the extra context because players have to judge the footage, not just the announcement. At phone speed, the details are simple: movement, interface pressure and whether the action reads instantly. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "IGN",
        confirmed_claims: [
          "IGN reports Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives.",
        ],
      },
      mustMatch: /feedback portal|exclusives demand|mixed platform signals/i,
      mustNotMatch: /one concrete change|players have to judge the footage|phone speed|movement, interface pressure/i,
      wordRange: { min: 185, max: 205 },
    },
    {
      storyId: "creator-rewards-pokemon-go-event",
      canonical: {
        canonical_subject: "Mega Mewtwo",
        canonical_game: "Pokemon Go",
        selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
        thumbnail_headline: "MEGA MEWTWO COMING",
        first_spoken_line: "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch.",
        narration_script:
          "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch: everyone gets a fair shot, but only if Niantic handles access properly. Eurogamer reports the debut is tied to Go Fest Global, with the event free for all players. Pokemon Go needs the extra context because players have to judge the footage, not just the announcement. At phone speed, the details are simple: movement, interface pressure and whether the action reads instantly. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Eurogamer",
        confirmed_claims: [
          "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free for all players.",
        ],
      },
      mustMatch: /access story|free Go Fest|paid-ticket wall/i,
      mustNotMatch: /players have to judge the footage|phone speed|movement, interface pressure/i,
      wordRange: { min: 205, max: 230 },
    },
    {
      storyId: "creator-rewards-business-bonus",
      canonical: {
        canonical_subject: "Subnautica 2",
        canonical_game: "Subnautica 2",
        selected_title: "Subnautica 2 Bonus Fight Got Bigger",
        thumbnail_headline: "SUBNAUTICA BONUS FIGHT",
        first_spoken_line: "Subnautica 2's bonus fight now looks bigger than the sequel hype.",
        narration_script:
          "Subnautica 2's bonus fight now looks bigger than the sequel hype. Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus. Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier. A confirmed timeline would turn this from business noise into a clearer launch-pressure story. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Aftermath",
        confirmed_claims: [
          "Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus.",
        ],
      },
      mustMatch: /business angle|corporate fight|payout story/i,
      mustNotMatch: /business noise|audience has two questions|phone speed|players have to judge the footage|Krafton now has to sell|legal lecture/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-premium-revenue",
      canonical: {
        canonical_subject: "Forza Horizon 6",
        canonical_game: "Forza Horizon 6",
        selected_title: "Forza Horizon 6 Premium Already Made $140M",
        thumbnail_headline: "FORZA PREMIUM $140M",
        first_spoken_line: "Forza Horizon 6 Premium Edition is already turning early access into the real launch story.",
        narration_script:
          "Forza Horizon 6 Premium Edition is already turning early access into the real launch story. Insider Gaming reports Forza Horizon 6 Premium Edition has made more than $140 million. The awkward part is the business model: early access is becoming the launch window. Retailer deals move quickly, so the current listing is the part to verify before treating it as live. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Insider Gaming",
        confirmed_claims: [
          "Insider Gaming reports Forza Horizon 6 Premium Edition has made more than $140 million.",
        ],
      },
      mustMatch: /paid head start|separate release moments|front-loaded demand/i,
      mustNotMatch: /same hardware costs more|retailer deals|normal discount/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-steam-launch",
      canonical: {
        canonical_subject: "Forza Horizon 6",
        canonical_game: "Forza Horizon 6",
        selected_title: "Forza Horizon 6 Finally Hit Steam",
        thumbnail_headline: "FORZA HIT STEAM",
        first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
        narration_script:
          "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Steam lists Forza Horizon 6 as available now. If Steam is where Forza takes off, Xbox has a different launch story on its hands. Forza Horizon 6 finally has footage players can judge. The clip puts the pitch on screen: pace, camera, combat and whether the world reads clearly in a short. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Steam",
        confirmed_claims: [
          "Steam lists Forza Horizon 6 as available now.",
        ],
      },
      mustMatch: /outside the Xbox-store bubble|wishlists, reviews and discovery|cleaner PC story/i,
      mustNotMatch: /finally has footage players can judge|clip puts the pitch|one reveal cannot settle|at phone speed/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-steam-performance",
      canonical: {
        canonical_subject: "Forza Horizon 6",
        canonical_game: "Forza Horizon 6",
        selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
        thumbnail_headline: "FORZA BROKE STEAM",
        first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
        narration_script:
          "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Xbox reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. If a first-party Xbox racer breaks out on Steam, the platform plan suddenly looks less theoretical. If Microsoft leans into it, this becomes a distribution story as much as a game story. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Xbox",
        confirmed_claims: [
          "Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
        ],
      },
      mustMatch: /Steam spike|platform shift|PC story/i,
      mustNotMatch: /second vampire pitch|bigger creative swing|patch list|roadmap watching/i,
      wordRange: { min: 180, max: 205 },
    },
    {
      storyId: "creator-rewards-five-eras-reveal",
      canonical: {
        canonical_subject: "STRANGER THAN HEAVEN Five Eras",
        canonical_game: "STRANGER THAN HEAVEN Five Eras",
        selected_title: "Stranger Than Heaven Shows Five Eras",
        thumbnail_headline: "STRANGER THAN HEAVEN SHOWS FIVE",
        first_spoken_line: "Stranger Than Heaven just showed its five-era setup.",
        narration_script:
          "Stranger Than Heaven just showed its five-era setup. Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview. STRANGER THAN HEAVEN Five Eras is swinging at more than one period piece. Five eras is a big promise: each one needs its own texture, pace and reason to exist, not just a costume change. Gameplay will decide whether the time jumps change the missions or just the wardrobe. Follow Pulse Gaming so you never miss a beat.",
        primary_source: "Xbox",
        confirmed_claims: [
          "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview.",
        ],
      },
      mustMatch: /different time periods|each era changes missions|design pressure/i,
      wordRange: { min: 180, max: 198 },
      mustSpeak: /Stranger Than Heaven just showed its five era setup/i,
      mustNotSpeak: /\bfive\s+eras\b|\bFive\s+Eras\b/,
      mustNotMatch: /score only lands|review into a victory lap|verdict room to breathe|time jumps|colo(?:u)?r grade|pretending the game is proven/i,
    },
  ];

  for (const item of cases) {
    const storyPackage = await makePackage(root, item.storyId);
    const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
    const baseCanonical = await fs.readJson(canonicalPath);
    await fs.writeJson(canonicalPath, {
      ...baseCanonical,
      ...item.canonical,
      story_id: item.storyId,
    }, { spaces: 2 });

    const audioCalls = [];
    const report = await materializeTiktokCreatorRewardsVariants({
      workspaceRoot: root,
      generatedAt: "2026-05-27T20:05:00.000Z",
      workOrder: {
        jobs: [
          {
            story_id: storyPackage.story_id,
            title: item.canonical.selected_title,
            artifact_dir: storyPackage.artifact_dir,
            status: "needs_tiktok_creator_rewards_variant",
            platform: "tiktok",
            current_duration_s: 42.4,
            target_duration_seconds: { min: 61, max: 75 },
          },
        ],
      },
      alignmentMode: "off",
      generateTtsForStory: async ({ text, outputPath }) => {
        audioCalls.push({ text, outputPath });
        await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 4));
        await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: charAlignment(text),
        });
      },
      renderProof: async ({ storyJson, output }) => {
        const story = await fs.readJson(storyJson);
        await fs.outputFile(output, Buffer.alloc(8192, 5));
        return {
          story_id: story.id,
          output,
          clips: story.video_clips.length,
          rendered_duration_s: 65.4,
          size_bytes: 8192,
        };
      },
    });

    assert.equal(report.summary.materialized_count, 1, JSON.stringify(report.jobs[0]));
    const variantCanonical = await fs.readJson(path.join(report.jobs[0].variant_artifact_dir, "canonical_story_manifest.json"));
    if (item.thumbnailMustBe) assert.equal(variantCanonical.thumbnail_headline, item.thumbnailMustBe);
    assert.match(variantCanonical.narration_script, item.mustMatch);
    assert.doesNotMatch(
      variantCanonical.narration_script,
      /first look is doing two jobs|selling the fantasy|proving the studio can make it move|logo, a licence|logo, a license/i,
    );
    assert.doesNotMatch(
      variantCanonical.narration_script,
      /reports .+ out now after .+ confirmed the launch timing|now has to make the shipped build feel as sharp|showcase hype into a real player verdict/i,
    );
    if (item.mustNotMatch) assert.doesNotMatch(variantCanonical.narration_script, item.mustNotMatch);
    assert.ok(
      wordCount(audioCalls[0].text) >= item.wordRange.min,
      `${item.storyId}: expected enough words for the TikTok 61s floor, got ${wordCount(audioCalls[0].text)} words`,
    );
    assert.ok(
      wordCount(audioCalls[0].text) <= item.wordRange.max,
      `${item.storyId}: expected compact local TTS text, got ${wordCount(audioCalls[0].text)} words`,
    );
    if (item.mustSpeak) assert.match(audioCalls[0].text, item.mustSpeak);
    if (item.mustNotSpeak) assert.doesNotMatch(audioCalls[0].text, item.mustNotSpeak);
  }
});

test("TikTok creator-rewards materializer keeps handmade art-direction stories above the 61s floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-handmade-art-"));
  const storyPackage = await makePackage(root, "creator-rewards-pragmata-art");
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    canonical_subject: "Pragmata",
    canonical_game: "Pragmata",
    selected_title: "Pragmata's AI-Look Stage Was Handmade",
    thumbnail_headline: "PRAGMATA HANDMADE",
    first_spoken_line: "Pragmata's AI-looking stage was actually handmade by developers.",
    narration_script:
      "Pragmata's AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata's New York stage was handmade by developers to look AI generated. That flips the read: the strange texture is art direction, not a machine shortcut. For a game already fighting a long wait, that craft detail makes the next gameplay showing feel less disposable. Follow Pulse Gaming so you never miss a beat.",
    primary_source: "Automaton Media",
    confirmed_claims: [
      "Automaton Media reports Pragmata's New York stage was handmade by developers to look AI generated.",
    ],
  }, { spaces: 2 });
  const audioCalls = [];

  const report = await materializeTiktokCreatorRewardsVariants({
    workspaceRoot: root,
    generatedAt: "2026-05-27T20:06:00.000Z",
    workOrder: {
      jobs: [
        {
          story_id: storyPackage.story_id,
          title: "Pragmata's AI-Look Stage Was Handmade",
          artifact_dir: storyPackage.artifact_dir,
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: 48.966,
          target_duration_seconds: { min: 61, max: 75 },
        },
      ],
    },
    alignmentMode: "off",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 4));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 5));
      const scriptWords = wordCount(story.full_script);
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: scriptWords >= 165 ? 62.4 : 53.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.materialized_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.failed_count, 0);
  assert.ok(
    wordCount(audioCalls[0].text) >= 165,
    `handmade art-direction TikTok variant must clear the local 61s floor; got ${wordCount(audioCalls[0].text)} words`,
  );
  assert.match(audioCalls[0].text, /handmade weirdness|deliberate aesthetic|machine shortcut/i);
  assert.doesNotMatch(audioCalls[0].text, /players have to judge the footage|at phone speed|direct play segment/i);
});

test("TikTok creator-rewards materializer preserves audio failure diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-audio-fail-"));
  const storyPackage = await makePackage(root, "creator-rewards-audio-fail");

  const report = await materializeTiktokCreatorRewardsVariants({
    workspaceRoot: root,
    generatedAt: "2026-05-27T19:45:00.000Z",
    workOrder: {
      jobs: [
        {
          story_id: storyPackage.story_id,
          title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
          artifact_dir: storyPackage.artifact_dir,
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: 44.2,
          target_duration_seconds: { min: 61, max: 75 },
        },
      ],
    },
    alignmentMode: "off",
    generateTtsForStory: async () => {
      throw new Error("local_tts_generation_failed:voice_qa_all_candidates_rejected");
    },
  });

  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /tiktok_creator_rewards_audio_failed/);
  assert.equal(report.jobs[0].audio_job.status, "failed");
  assert.match(report.jobs[0].audio_job.error, /voice_qa_all_candidates_rejected/);
  assert.equal(report.safety.renderer_invoked, false);
});

test("TikTok creator-rewards materializer keeps display copy separate from local TTS pronunciation text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-display-copy-"));
  const storyPackage = await makePackage(root, "creator-rewards-ps5-price");
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    canonical_subject: "PS5",
    canonical_game: "PS5",
    selected_title: "PS5 Prices Went Up In Europe",
    thumbnail_headline: "PS5 PRICES WENT UP EUROPE",
    first_spoken_line: "PS5 prices went up across Europe and the UK.",
    narration_script:
      "PS5 prices went up across Europe and the UK. PlayStation Blog says Sony changed recommended retail prices for PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal. For new players, PS5 just became harder to buy. Follow Pulse Gaming so you never miss a beat.",
    primary_source: "PlayStation Blog",
    confirmed_claims: [
      "Sony changed recommended retail prices for PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal.",
    ],
  }, { spaces: 2 });
  const audioCalls = [];
  const renderCalls = [];

  const report = await materializeTiktokCreatorRewardsVariants({
    workspaceRoot: root,
    generatedAt: "2026-05-27T09:05:00.000Z",
    workOrder: {
      jobs: [
        {
          story_id: storyPackage.story_id,
          title: "PS5 Prices Went Up In Europe",
          artifact_dir: storyPackage.artifact_dir,
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: 46.7,
          target_duration_seconds: { min: 61, max: 75 },
        },
      ],
    },
    alignmentMode: "off",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 4));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(8192, 5));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 66.2,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.materialized_count, 1, JSON.stringify(report.jobs[0]));
  const variantCanonical = await fs.readJson(path.join(report.jobs[0].variant_artifact_dir, "canonical_story_manifest.json"));
  assert.match(variantCanonical.first_spoken_line, /^PS5 prices/i);
  assert.match(variantCanonical.narration_script, /^PS5 prices/i);
  assert.doesNotMatch(variantCanonical.narration_script, /direct play segment|combat rhythm|camera weight|stronger cut/i);
  assert.doesNotMatch(
    variantCanonical.narration_script,
    /cheap enough|discount|offer itself|timed discount|price drop|price cut|lower entry point|deal is live|savings?/i,
  );
  const qa = evaluateGoalPublicCopy(variantCanonical);
  assert.equal(qa.verdict, "pass", JSON.stringify(qa.failures));
  assert.match(audioCalls[0].text, /^PlayStation five prices/i);
  assert.match(renderCalls[0].full_script, /^PS5 prices/i);
  assert.notEqual(renderCalls[0].full_script, audioCalls[0].text);
});

test("TikTok creator-rewards materializer CLI parses safe local options", () => {
  const args = parseArgs([
    "--work-order",
    "output/goal-contract/tiktok_creator_rewards_variant_work_order.json",
    "--out-dir",
    "output/goal-contract",
    "--workspace",
    ".",
    "--provider",
    "local",
    "--alignment",
    "whisper",
    "--limit",
    "2",
    "--json",
  ]);

  assert.equal(args.provider, "local");
  assert.equal(args.alignmentMode, "whisper");
  assert.equal(args.limit, 2);
  assert.equal(args.json, true);
  assert.equal(packageJson.scripts["ops:goal-tiktok-creator-rewards-variant"], "node tools/goal-tiktok-creator-rewards-variant-materializer.js");
});
