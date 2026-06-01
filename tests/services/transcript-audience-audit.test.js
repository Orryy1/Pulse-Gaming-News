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
      "The Expanse: Osiris Reborn finally has real gameplay on screen. Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview, which matters because this is no longer just a logo and a licence. The catch is why mission flow matters: a famous universe only helps if the gunfights, camera weight and scale hold up outside a trailer cut. The real player question is whether this feels like The Expanse, or just another sci-fi shooter wearing the name. Follow Pulse Gaming so you never miss a beat.",
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
