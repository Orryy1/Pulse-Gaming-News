"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  auditGeneratedTranscripts,
  renderTranscriptAudienceAuditMarkdown,
} = require("../../lib/ops/transcript-audience-audit");

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
