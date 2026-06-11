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
