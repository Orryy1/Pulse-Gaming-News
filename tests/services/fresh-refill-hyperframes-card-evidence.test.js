"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("fs-extra");

const {
  collectFreshRefillHyperframesCardStoryEvidence,
} = require("../../lib/job-handlers");

const ROOT = path.resolve(__dirname, "..", "..");
const CARD_KINDS = ["source", "context", "timeline", "quote", "takeaway", "outro"];

function cardPath(storyId, kind) {
  return path.join(ROOT, "test", "output", `hf_${kind}_card_${storyId}.mp4`);
}

async function writePassingCard(storyId, kind, visibleDurationS = 4.1) {
  const mp4Path = cardPath(storyId, kind);
  await fs.ensureDir(path.dirname(mp4Path));
  await fs.writeFile(mp4Path, `card:${storyId}:${kind}`);
  await fs.writeJson(
    mp4Path.replace(/\.[^.]+$/i, ".shell.json"),
    {
      story_id: storyId,
      card_kind: kind,
      channel_id: "pulse-gaming",
      hyperframes_premium_shell: {
        status: "pass",
        blockers: [],
        readability_contract: {
          status: "pass",
          evidence: {
            readable_text: "XBOX WIRE NEWS SOURCE",
            word_count: 4,
            planned_visible_duration_s: visibleDurationS,
            minimum_visible_duration_s: visibleDurationS,
            min_readable_card_duration_s: 3.6,
            max_readable_card_duration_s: 6.4,
          },
        },
      },
    },
    { spaces: 2 },
  );
}

test("fresh-refill HyperFrames evidence accepts canonical readable short-card dwell", async () => {
  const storyId = `fresh-refill-readable-${Date.now()}`;
  try {
    for (const kind of CARD_KINDS) {
      await writePassingCard(storyId, kind, kind === "timeline" ? 4.3 : 4.1);
    }

    const result = await collectFreshRefillHyperframesCardStoryEvidence({
      storyId,
      channelId: "pulse-gaming",
    });

    assert.equal(result.status, "completed");
    assert.equal(result.passing_card_count, CARD_KINDS.length);
    assert.deepEqual(result.blockers, []);
    assert.equal(
      result.cards.some((card) =>
        card.blockers.includes("hyperframes_readable_hold_below_internal_floor"),
      ),
      false,
    );
  } finally {
    for (const kind of CARD_KINDS) {
      const mp4Path = cardPath(storyId, kind);
      await fs.remove(mp4Path).catch(() => {});
      await fs.remove(mp4Path.replace(/\.[^.]+$/i, ".shell.json")).catch(() => {});
    }
  }
});
