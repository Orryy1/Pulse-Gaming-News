"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  auditGeneratedTranscripts,
  renderTranscriptAudienceAuditMarkdown,
} = require("../../lib/ops/transcript-audience-audit");

const ROOT = path.resolve(__dirname, "..", "..");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-transcript-audit-"));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

async function writeStory(root, id, title, script, source = "Xbox") {
  const dir = path.join(root, "output", "goal-proof", "batch", id);
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
    story_id: id,
    selected_title: title,
    primary_source: source,
    narration_script: script,
  });
  await fs.writeJson(path.join(dir, "source_manifest.json"), {
    primary_source: { name: source, url: "https://example.test/story" },
  });
}

test("transcript audience audit separates viral-ready scripts from rewrite-required scripts", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "good",
      "The Expanse Shows Real Gameplay",
      "The Expanse: Osiris Reborn finally has real gameplay on screen. Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview, which matters because this is no longer just a logo and a licence. The trade-off is brutal: a famous universe only helps if the gunfights, camera weight and scale hold up outside a trailer cut. The real player question is whether this feels like The Expanse, or just another sci-fi shooter wearing the name. If the mission flow holds, this becomes a licensed game players can judge on play instead of branding. Follow Pulse Gaming so you never miss a beat.",
    );
    await writeStory(
      root,
      "bad",
      "Capturing Has One Player Question",
      "Capturing Has One Player Question. I reports Capturing mewtwo in the office shh pokemon red game boy color og. Follow Pulse Gaming for the gaming stories behind the headline.",
      "IGN",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.pass, 1);
    assert.equal(report.summary.rewrite_required, 1);
    const bad = report.stories.find((story) => story.story_id === "bad");
    assert.ok(bad.blockers.includes("malformed_source_attribution"));
    assert.ok(bad.blockers.includes("missing_exact_cta"));
    const markdown = renderTranscriptAudienceAuditMarkdown(report);
    assert.match(markdown, /Capturing Has One Player Question/);
    assert.match(markdown, /Rewrite Required/);
  });
});

test("transcript audience audit rejects abstract review-score filler", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "forza-review",
      "Forza Horizon 6 Scores 84 On PC Gamer",
      "Forza Horizon 6 just landed a strong PC Gamer review. PC Gamer reports Forza Horizon 6 review (PC Gamer: 84/100). Strong reviews matter here because this is when fence-sitters decide whether another Horizon is enough. Forza Horizon 6 is in verdict territory now, not pre-launch noise. The number is only the opening beat; repeated praise or complaints across outlets matter more. One high score can hide split opinions, but a steady spread says the reception is harder to dismiss. Until players have it, this is a strong signal, not a final verdict. That is what makes the score matter to players instead of becoming chart noise. A score this high changes the launch conversation, but it still has to survive real players. Follow Pulse Gaming so you never miss a beat.",
      "PC Gamer",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "forza-review");
    assert.ok(
      row.blockers.includes("script_coherence:vague_filler:review_score_abstraction"),
      row.blockers.join(", "),
    );
  });
});

test("transcript audience audit rejects generic source-bound padding", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "gta-subscription",
      "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
      "GTA 6 has a new detail players should clock. GameSpot reports a new GTA 6 update with a player-facing detail still worth separating from the noise. The interesting part is not that another update exists. It is whether this changes timing, access, trust or what players should pay attention to next. That gives the story a reason to exist beyond repeating the feed. Until another source adds more, this stays a tight update instead of a hype cycle. The next thing to watch is whether the official follow-up gives players a clear date, platform detail or gameplay proof. That is where a small update either becomes useful or fades into the feed. The stronger short keeps the subject named and the consequence visible from the first line. Follow Pulse Gaming so you never miss a beat.",
      "GameSpot",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "gta-subscription");
    assert.ok(
      row.blockers.includes("script_coherence:vague_filler:generic_source_bound_padding"),
      row.blockers.join(", "),
    );
  });
});

test("transcript audience audit rejects producer scaffold and low-payoff narration", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "v-rising-scaffold",
      "V Rising Studio Is Working On A New Game",
      "V Rising has a new sequel-sized problem. IGN reports Stunlock Studios is working on a new game set in the V Rising universe while the original moves to balance and bug-fix support. Here's what matters now: the support plan becomes part of the next game story. Fans are no longer just asking about the next patch. Follow Pulse Gaming so you never miss a beat.",
      "IGN",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "v-rising-scaffold");
    assert.ok(row.blockers.includes("producer_scaffold_language"), row.blockers.join(", "));
    assert.ok(
      row.blockers.includes("script_coherence:vague_filler:producer_scaffold_language"),
      row.blockers.join(", "),
    );
  });
});

test("transcript audience audit rejects abstract mass-audience confusion", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "beastro-abstract",
      "Beastro Has A Cozy Deckbuilding Test",
      "Beastro has a signal problem. This matters because the update changes the wider conversation around trust, timing and discovery. The useful part is the context, because the detail gives players a cleaner way to judge the direction. That is where the story becomes more than a feed update. If the next beat lands, the conversation shifts again. Follow Pulse Gaming so you never miss a beat.",
      "Xbox Wire",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "beastro-abstract");
    assert.ok(row.blockers.includes("mass_audience:abstract_payoff"), row.blockers.join(", "));
    assert.ok(row.blockers.includes("mass_audience:low_concrete_detail"), row.blockers.join(", "));
    assert.ok(row.blockers.includes("mass_audience:unclear_referents"), row.blockers.join(", "));
  });
});

test("transcript audience audit rejects public safety scaffold padding", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "beastro-scaffold",
      "Beastro Has A Cozy Deckbuilding Test",
      "Beastro is the Game Pass test for players who usually bounce off card games. Xbox Wire says it is out now on Xbox and Game Pass, mixing village care, cooking, farming and card battles around Caretakers defending a wall. The player-facing consequence matters more than stretching the headline beyond the source. Players should watch for a named update from the studio, store page or platform holder. That means the claim still needs official confirmation before players treat it as locked in. Until that appears, the honest angle is what has changed for players today. Follow Pulse Gaming so you never miss a beat.",
      "Xbox Wire",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "beastro-scaffold");
    assert.ok(row.blockers.includes("mass_audience:public_safety_scaffold"), row.blockers.join(", "));
  });
});

test("transcript audience audit rejects generic source-bound player-stakes filler", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "xbox-price-filler");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "xbox-price-filler",
      canonical_subject: "Updated XBOX Console Prices",
      selected_title: "Updated XBOX Console Prices Has A Player-Return Problem",
      primary_source: "Xbox Wire",
      narration_script:
        "Updated XBOX Console Prices is getting a content push that has to prove it is more than maintenance. " +
        "Xbox Wire says Updated XBOX Console Prices has a new player-facing detail to judge. " +
        "Players will judge the practical change first: what feels better, what lasts longer and what gives them a reason to come back now. " +
        "If the update does not change that loop, the headline fades before the patch notes do. " +
        "Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/25/xbox-console-price-update/",
      },
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    const row = report.stories[0];
    assert.equal(row.verdict, "rewrite_required");
    assert.ok(
      row.blockers.includes("script_coherence:vague_filler:generic_source_bound_padding"),
      row.blockers.join(", "),
    );
    assert.ok(
      row.mass_audience.blockers.includes("mass_audience:public_safety_scaffold"),
      row.mass_audience.blockers.join(", "),
    );
  });
});

test("transcript audience audit rejects critic-style figurative payoff", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "gta-figurative",
      "GTA 6 Delay Becomes The First Argument",
      "The GTA 6 delay is now something players can measure. GameSpot says Take-Two is still pointing to November 19, 2026. Rockstar has bought time, but it has also raised the bar for density, performance and polish. If the world feels impossible to fake, the wait becomes part of the legend. If not, the delay becomes the first argument. Follow Pulse Gaming so you never miss a beat.",
      "GameSpot",
    );

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.summary.rewrite_required, 1);
    const row = report.stories.find((story) => story.story_id === "gta-figurative");
    assert.ok(row.blockers.includes("mass_audience:figurative_payoff"), row.blockers.join(", "));
  });
});

test("transcript audience audit includes current trailer repair goal-proof batches", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(
      root,
      "output",
      "autonomous-feedback-monitor",
      "fresh-trailer-repair-20260616",
      "goal-proof-batch",
      "fresh_current_trailer_story",
    );
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "fresh_current_trailer_story",
      selected_title: "Gears E-Day Has A 130GB Problem",
      primary_source: "PC Gamer",
      narration_script:
        "Gears of War E-Day just made its PC version a storage test. PC Gamer says the requirements list a 130 GB SSD install and RTX 2060-era hardware as the minimum floor. That matters because players now know whether launch night starts with a download or a clean-out. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "PC Gamer", url: "https://example.test/story" },
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.ok(report.stories.some((story) => story.story_id === "fresh_current_trailer_story"));
  });
});

test("transcript audience audit includes current fresh proof batch folders", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "old_batch_story",
      "Old Batch Story Has A Real Hook",
      "Old Batch Story gives players one clear thing to judge. Xbox Wire says the demo adds campaign co-op, a new boss and a release date. That matters because players can decide whether to wait or jump in now. Follow Pulse Gaming so you never miss a beat.",
      "Xbox Wire",
    );
    const freshDir = path.join(
      root,
      "output",
      "autonomous-feedback-monitor",
      "fresh-goal-proof",
      "batch",
      "fresh_current_story",
    );
    await fs.ensureDir(freshDir);
    await fs.writeJson(path.join(freshDir, "canonical_story_manifest.json"), {
      story_id: "fresh_current_story",
      selected_title: "Fresh Current Story Has A Real Hook",
      primary_source: "Xbox Wire",
      narration_script:
        "Fresh Current Story gives players one clear thing to judge. Xbox Wire says the demo adds campaign co-op, a new boss and a release date. That matters because players can decide whether to wait or jump in now. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 2);
    assert.ok(report.stories.some((story) => story.story_id === "fresh_current_story"));
  });
});

test("transcript audience audit can target an explicit current artifact dir", async () => {
  await withTempDir(async (root) => {
    await writeStory(
      root,
      "stale_story",
      "Stale Story Needs A Rewrite",
      "Stale Story has a signal problem. This matters because the update changes the wider conversation around trust and timing. Follow Pulse Gaming so you never miss a beat.",
      "Xbox Wire",
    );
    const currentDir = path.join(root, "output", "goal-contract", "current-package", "fresh_story");
    await fs.ensureDir(currentDir);
    await fs.writeJson(path.join(currentDir, "canonical_story_manifest.json"), {
      story_id: "fresh_story",
      selected_title: "Fresh Story Adds A Downloadable Demo",
      primary_source: "Xbox Wire",
      narration_script:
        "Fresh Story just gave players a real download instead of another trailer. Xbox Wire says the demo is live on Xbox and PC, with co-op missions, a boss fight and a July release date. That matters because players can test the combat today instead of waiting for previews. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root, artifactDirs: [currentDir] });

    assert.equal(report.summary.total, 1);
    assert.equal(report.stories[0].story_id, "fresh_story");
    assert.equal(path.resolve(report.stories[0].artifact_dir), path.resolve(currentDir));
  });
});

test("transcript audience audit accepts ASR-spaced outlet names", async () => {
  await withTempDir(async (root) => {
    const currentDir = path.join(root, "output", "goal-contract", "current-package", "gta-free-upgrade");
    await fs.ensureDir(currentDir);
    await fs.writeJson(path.join(currentDir, "canonical_story_manifest.json"), {
      story_id: "gta-free-upgrade",
      selected_title: "GTA 5 Has A Free Upgrade Catch",
      primary_source: "GameSpot",
      narration_script:
        "GTA 5's paid current-gen upgrade is suddenly free for the players most likely to miss it. GameSpot reports digital PS4 and Xbox One owners can claim the PS5 and Xbox Series X and S version from June 18. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(currentDir, "source_manifest.json"), {
      primary_source: { name: "GameSpot", url: "https://www.gamespot.com/articles/example/" },
    });
    await fs.writeJson(path.join(currentDir, "narration_manifest.json"), {
      final_transcript:
        "G T A five's paid current gen upgrade is suddenly free for the players most likely to miss it. Game Spot reports digital PlayStation four and Xbox One owners can claim the PlayStation five and Xbox Series X and S version from June 18. That matters because this is the native version, with better graphics and faster loading, not just backward compatibility. The catch is eligibility: if your old copy is not covered, the free headline does not help. Rockstar is moving old players forward before July's next online heist, and paying twice is exactly the mistake this story should prevent. The argument is obvious: generous upgrade, or a quiet way to refill G T A Online before the next heist? If the free claim brings lapsed owners back, Rockstar turns an old upgrade fee into a retention play instead of a simple gift. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root, artifactDirs: [currentDir] });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 1);
    assert.equal(report.stories[0].verdict, "pass", JSON.stringify(report.stories[0], null, 2));
    assert.equal(report.stories[0].scores.source_safety, 86);
    assert.equal(report.stories[0].mass_audience.warnings.includes("mass_audience:source_not_named"), false);
  });
});

test("transcript audience audit counts kart handling and track details as concrete", async () => {
  await withTempDir(async (root) => {
    const currentDir = path.join(root, "output", "goal-contract", "current-package", "yooka");
    await fs.ensureDir(currentDir);
    await fs.writeJson(path.join(currentDir, "canonical_story_manifest.json"), {
      story_id: "yooka",
      selected_title: "Yooka-Laylee Kart Has A Diddy Kong Risk",
      canonical_subject: "Super Yooka-Laylee Kart",
      primary_source: "IGN",
      narration_script:
        "Super Yooka Laylee Kart is going after one of racing's most dangerous comparisons. IGN says ex Rare developers are aiming to revive the spirit of Diddy Kong Racing. That is bigger than a cute mascot pitch. Diddy Kong Racing worked because it felt like an adventure first and a racer second. The catch is handling. Players have to decide whether to wishlist this as a real kart rival, or wait until the handling proves nostalgia is not doing all the work. That is the pressure on Playtonic now. Tracks, items and character charm have to feel like discovery, not cosplay. If the handling has bite, this becomes a serious nostalgia upset. If it feels floaty, the comparison eats it alive. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(currentDir, "source_manifest.json"), {
      primary_source: { name: "IGN", url: "https://example.test/yooka" },
    });

    const report = await auditGeneratedTranscripts({ root, artifactDirs: [currentDir] });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass");
    assert.equal(row.mass_audience.concrete_detail_count >= 3, true);
    assert.equal(row.mass_audience.warnings.includes("mass_audience:title_subject_not_obvious"), false);
  });
});

test("transcript audience audit counts visual upgrade and image-quality stakes as concrete", async () => {
  await withTempDir(async (root) => {
    const currentDir = path.join(root, "output", "goal-contract", "current-package", "doom");
    await fs.ensureDir(currentDir);
    await fs.writeJson(path.join(currentDir, "canonical_story_manifest.json"), {
      story_id: "doom",
      selected_title: "Doom The Dark Ages PS5 Pro Upgrade Risks Blur",
      canonical_subject: "Doom: The Dark Ages",
      primary_source: "PlayStation Blog",
      narration_script:
        "Doom The Dark Ages has one PlayStation 5 Pro risk players will feel fast. PlayStation Blog says upgraded PSSR is coming to the PlayStation 5 Pro version. The danger is not frame counting. It is readability when fire, steel and demons fill the arena at once. If PSSR holds that chaos together, Sony gets a shooter upgrade players can judge instantly, not another slow beauty shot. If it smears, the Pro badge becomes the thing people mock. That is the argument: sharper fights, or expensive blur? This is the proof fight to watch. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(currentDir, "source_manifest.json"), {
      primary_source: { name: "PlayStation Blog", url: "https://blog.playstation.com/2026/06/24/upgraded-pssr-comes-to-doom-the-dark-ages-on-ps5-pro/" },
    });

    const report = await auditGeneratedTranscripts({ root, artifactDirs: [currentDir] });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", JSON.stringify(row, null, 2));
    assert.equal(row.mass_audience.blockers.includes("mass_audience:low_concrete_detail"), false);
    assert.equal(row.mass_audience.concrete_detail_count >= 3, true);
  });
});

test("transcript audience audit CLI writes explicit current artifact reports", async () => {
  await withTempDir(async (root) => {
    const currentDir = path.join(root, "current-package", "fresh_story");
    const outDir = path.join(root, "audit-out");
    await fs.ensureDir(currentDir);
    await fs.writeJson(path.join(currentDir, "canonical_story_manifest.json"), {
      story_id: "fresh_story",
      selected_title: "Fresh Story Adds A Downloadable Demo",
      primary_source: "Xbox Wire",
      narration_script:
        "Fresh Story just gave players a real download instead of another trailer. Xbox Wire says the demo is live on Xbox and PC, with co-op missions, a boss fight and a July release date. That matters because players can test the combat today instead of waiting for previews. Follow Pulse Gaming so you never miss a beat.",
    });

    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "tools", "transcript-audience-audit.js"),
        "--artifact-dir",
        currentDir,
        "--output-dir",
        outDir,
        "--json",
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env } },
    );

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.total, 1);
    assert.equal(parsed.stories[0].story_id, "fresh_story");
    assert.equal(await fs.pathExists(path.join(outDir, "transcript_audience_audit.json")), true);
  });
});

test("transcript audience audit includes current goal-contract proof batches", async () => {
  await withTempDir(async (root) => {
    const staleDir = path.join(
      root,
      "output",
      "candidate-supply",
      "fresh-production-refill",
      "stale",
      "goal-proof-batch",
      "sea-story",
    );
    await fs.ensureDir(staleDir);
    await fs.writeJson(path.join(staleDir, "canonical_story_manifest.json"), {
      story_id: "sea-story",
      selected_title: "Sea Of Thieves Just Got A New Signal",
      primary_source: "Xbox Wire",
      narration_script:
        "Sea of Thieves has a signal problem. This matters because the update changes the wider conversation around trust. Follow Pulse Gaming so you never miss a beat.",
    });

    const activeDir = path.join(
      root,
      "output",
      "goal-contract",
      "fresh-refill-copyfix",
      "goal-proof-batch",
      "sea-story",
    );
    await fs.ensureDir(activeDir);
    await fs.writeJson(path.join(activeDir, "canonical_story_manifest.json"), {
      story_id: "sea-story",
      selected_title: "Sea of Thieves Custom Seas Could Split Crews",
      primary_source: "Xbox Wire",
      narration_script:
        "Sea of Thieves just made its biggest social gamble in years. Xbox Wire says Season 20's Custom Seas lets crews build private sessions, set rules, spawn treasure and enemies, change loadouts and assign up to 24 players. That sounds perfect for streamers, training runs and players who hate being ambushed. But it cuts into what makes Sea of Thieves electric: strangers can ruin your plan at any second. If the best nights go private, public servers could feel quieter and less dangerous. Players get control, but the shared ocean loses chaos. That is the trade-off. That risk turns Rare's best creator tool into Sea of Thieves' biggest community split. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(activeDir, "source_manifest.json"), {
      primary_source: { name: "Xbox Wire", url: "https://example.test/sea-of-thieves" },
    });

    const report = await auditGeneratedTranscripts({ root });
    const active = report.stories.find((story) =>
      story.story_id === "sea-story" &&
      story.artifact_dir.replace(/\\/g, "/").includes("output/goal-contract/fresh-refill-copyfix"),
    );

    assert.ok(active, "expected active goal-contract transcript row");
    assert.equal(active.verdict, "pass");
  });
});

test("transcript audience audit normalises recoverable spoken title aliases before subject checks", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "beastro-drift");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "beastro-drift",
      canonical_subject: "Beastro",
      selected_title: "Beastro Has A Cozy Deckbuilding Test",
      primary_source: "Xbox Wire",
      narration_script:
        "Beastro is the Game Pass test for players who usually bounce off card games. Xbox Wire says the demo mixes cooking, farming and card battles. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript:
        "Beastrow is the Game Pass test for players who usually bounce off card games. Xbox Wire says the demo mixes cooking, farming and card battles. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.first_line.startsWith("Beastro"), true);
    assert.match(row.raw_transcript, /^Beastrow/);
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts canonical game aliases in viewer narration", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "black-ops-price");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "black-ops-price",
      canonical_subject: "Call of Duty: Black Ops",
      selected_title: "Black Ops Classics Face A Price Test",
      primary_source: "IGN",
      narration_script:
        "Black Ops 1 and 2 just turned nostalgia into a price test. IGN reports PlayStation listings for the two classic Black Ops games have fans watching for whether these ports land as sensible re-releases or expensive nostalgia. That matters because older Call of Duty campaigns are not just museum pieces; they are games people still want accessible without paying modern premium prices again. The split is direct: are these convenient classics, or another reminder that preservation can become a storefront upsell? Listings do not prove final price, performance, release timing or whether multiplayer support will be meaningful. Watch the price and feature list first, because nostalgia only carries this if the package respects what players are actually buying. The uncomfortable part is that these campaigns carry emotional value, but the storefront still has to justify the price. Players will forgive a paid port faster if the package is clear: campaign access, stable performance and honest multiplayer expectations. If Activision prices this cleanly, it gets an easy goodwill win; if not, the backlash writes itself before launch. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "IGN", url: "https://example.test/black-ops" },
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts MARVEL Tokon Fighting Souls spoken without colon pause", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "marvel-tokon-roster");
    await fs.ensureDir(dir);
    const script =
      "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch. " +
      "GameSpot shows Blade, Loki and Deadpool in new gameplay for Arc System Works' 4v4 tag fighter, and the roster reveal is really a team-building test. " +
      "Blade has to bring pressure. Loki has to bend reads. Deadpool has to create chaos without turning every match into visual noise. " +
      "That matters on PlayStation 5 and PC because tag fighters rise or die on what the assists do after the trailer ends. " +
      "If these clips show real combo paths, players will be testing team plans before release. " +
      "If they only show expensive super moves, the hype becomes famous skins with health bars. " +
      "Watch the assists, not just the faces: this reveal either makes the whole game look deeper, or exposes the exact thing it still has to prove. " +
      "Follow Pulse Gaming so you never miss a beat.";
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "marvel-tokon-roster",
      canonical_subject: "MARVEL Tokon: Fighting Souls",
      selected_title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
      primary_source: "GameSpot",
      narration_script: script,
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: {
        name: "GameSpot",
        url: "https://www.gamespot.com/videos/marvel-tokon-fighting-souls-blade-loki-and-deadpool-gameplay-reveal-trailer-team-samurai-outriders/",
      },
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript: script,
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
    assert.equal(row.mass_audience.concrete_detail_count >= 3, true);
  });
});

test("transcript audience audit accepts GTA VI caption and spoken-title aliases", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "gta-vi-preorder");
    await fs.ensureDir(dir);
    const spokenScript =
      "Grand Theft Auto six just turned cover art into a real buying argument. " +
      "Rockstar Newswire says preorders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. " +
      "That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. " +
      "The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. " +
      "Wait for the edition details unless the bonuses are actually worth locking in early. " +
      "Follow Pulse Gaming so you never miss a beat.";
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "gta-vi-preorder",
      canonical_subject: "Grand Theft Auto VI",
      selected_title: "GTA VI Starts The Preorder Fight",
      primary_source: "Rockstar Newswire",
      narration_script:
        "GTA VI just turned cover art into a real buying argument. Rockstar Newswire says preorders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. Wait for the edition details unless the bonuses are actually worth locking in early. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "Rockstar Newswire", url: "https://www.rockstargames.com/newswire" },
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript: spokenScript,
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.first_line.startsWith("GTA VI"), true);
    assert.match(row.raw_transcript, /^Grand Theft Auto six/);
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts safe GTA VI narration that avoids spoken six", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "gta-vi-safe-spoken-form");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "gta-vi-safe-spoken-form",
      canonical_subject: "Grand Theft Auto VI",
      selected_title: "GTA VI Starts The Preorder Fight",
      primary_source: "Xbox Wire",
      narration_script:
        "Rockstar's next Grand Theft Auto just turned cover art into a real buying argument. Xbox Wire says pre-orders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. Wait for the edition details unless the bonuses are actually worth locking in early. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "Xbox Wire", url: "https://example.test/gta-vi" },
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript:
        "Rockstar's next Grand Theft Auto just turned cover art into a real buying argument. Xbox Wire says pre orders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. Wait for the edition details unless the bonuses are actually worth locking in early. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts GTA VI V I spoken form as the same subject", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "gta-vi-v-i-spoken-form");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "gta-vi-v-i-spoken-form",
      canonical_subject: "Grand Theft Auto VI",
      selected_title: "GTA VI Starts The Preorder Fight",
      primary_source: "Xbox Wire",
      narration_script:
        "Grand Theft Auto V I just turned cover art into a real buying argument. Xbox Wire says pre-orders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "Xbox Wire", url: "https://example.test/gta-vi" },
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript:
        "Grand Theft Auto V I just turned cover art into a real buying argument. Xbox Wire says pre orders open on June 25 after Jason, Lucia and Vice City moved onto the official artwork. That matters because players can finally judge price, editions and whether buying early makes sense before the next gameplay trailer. The risk is simple: if Rockstar asks for money before fresh gameplay proof, the cover art becomes the first trust test. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.first_line.startsWith("GTA VI"), true);
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts Call of Duty Black Ops 7 spoken in separated natural phrases", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "black-ops-7-separated-subject");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "black-ops-7-separated-subject",
      canonical_subject: "Call of Duty: Black Ops 7",
      selected_title: "Black Ops 7's June 25 Update Has One Reinstall Catch",
      primary_source: "Call of Duty",
      narration_script:
        "Black Ops 7 has a retention problem hiding inside its June 25 update. The official Call of Duty page lists new and remastered multiplayer maps, Endgame content and Zombies content, but patch size is not the real story. The brutal test is whether lapsed players see one clear reason to reinstall. A map can win one evening; progression and weapon prestige decide the second week. That is why the official clips matter: Activision is selling systems, not just explosions. If those systems make every match feel like progress, Black Ops 7 gets momentum back. If they feel like another checklist, players will call it padding before the weekend is over. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "Call of Duty", url: "https://example.test/black-ops-7" },
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
  });
});

test("transcript audience audit accepts Star Wars Monopoly as a reordered public alias with concrete board-game stakes", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "star-wars-monopoly-reordered");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "star-wars-monopoly-reordered",
      canonical_subject: "Monopoly Star Wars",
      selected_title: "Star Wars Monopoly Could Ruin Game Night",
      primary_source: "Xbox Wire",
      narration_script:
        "Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. " +
        "Xbox Wire says Heroes versus Villains gives characters unique abilities, so every turn becomes a choice about rent, revenge and who gets the comeback. " +
        "That is the real player test: do the powers make families replay the board, or does it become one bored match after dinner? " +
        "If Darth Vader can flip momentum and heroes can save a doomed turn, this is a licensed board game people will actually argue to replay. " +
        "Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "source_manifest.json"), {
      primary_source: { name: "Xbox Wire", url: "https://example.test/star-wars-monopoly" },
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    const row = report.stories[0];
    assert.equal(row.verdict, "pass", row.blockers.join(", "));
    assert.equal(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), false);
    assert.equal(row.blockers.includes("mass_audience:low_concrete_detail"), false);
    assert.equal(row.mass_audience.concrete_detail_count >= 3, true);
  });
});

test("transcript audience audit still fails unrecoverable subject drift", async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, "output", "goal-proof", "batch", "beastro-wrong-subject");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
      story_id: "beastro-wrong-subject",
      canonical_subject: "Beastro",
      selected_title: "Beastro Has A Cozy Deckbuilding Test",
      primary_source: "Xbox Wire",
      narration_script:
        "Beastro is the Game Pass test for players who usually bounce off card games. Xbox Wire says the demo mixes cooking, farming and card battles. Follow Pulse Gaming so you never miss a beat.",
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      final_transcript:
        "Bistro is the Game Pass test for players who usually bounce off card games. Xbox Wire says the demo mixes cooking, farming and card battles. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await auditGeneratedTranscripts({ root });

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.pass, 0);
    const row = report.stories[0];
    assert.equal(row.first_line.startsWith("Bistro"), true);
    assert.ok(row.blockers.includes("mass_audience:tts_transcript_subject_drift"), row.blockers.join(", "));
  });
});
