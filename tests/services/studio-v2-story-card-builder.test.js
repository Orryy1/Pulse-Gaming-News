"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildStoryCardSpecs,
  outputNameForCard,
  pickStoryBackdrop,
} = require("../../tools/studio-v2-build-story-cards");
const { deriveCardContent } = require("../../lib/studio/v2/hf-card-builders");
const { CTA_POLICY } = require("../../lib/services/pulse-editorial-contract");

const CONTEXTUAL_CTA = "Which version would you install first?";
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

test("story card specs are topical and do not reuse generic Metro copy", () => {
  const story = {
    storyId: "rss_ca673f22ddbbbdfc",
    title:
      "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free for all players",
    subreddit: "Eurogamer",
    source_type: "rss",
    top_comment:
      "Mega Mewtwo X and Y will debut in Pok&eacute;mon Go during Go Fest 2026.",
    script: {
      tightened:
        "No premium ticket. No paywall. Every player gets access to the Special Research quest.",
    },
  };

  const specs = buildStoryCardSpecs(story);
  const serialised = JSON.stringify(specs);

  assert.equal(specs.source.label, "EUROGAMER");
  assert.equal(specs.source.sublabel, "POK\u00c9MON GO");
  assert.equal(specs.context.number, "FREE");
  assert.match(specs.context.micro, /Mega Mewtwo/i);
  assert.match(specs.timeline.heading, /MEGA MEWTWO/i);
  assert.equal(
    specs.quote.quoteText,
    "No premium ticket. No paywall. Every player gets access.",
  );
  assert.deepEqual(specs.takeaway.headlineWords, ["FREE", "MEGA", "MEWTWO"]);
  assert.equal(specs.takeaway.cta, "");
  assert.deepEqual(specs.outro.headlineWords, ["PULSE", "GAMING", "NEWS"]);
  assert.equal(specs.outro.kicker, "FAST. CHECKED. EXPLAINED.");
  assert.equal(specs.outro.cta, "");
  assert.doesNotMatch(serialised, /METRO 2039/i);
  assert.doesNotMatch(serialised, /FOLLOW FOR MORE|NEVER MISS A BEAT/i);
});

test("story card specs apply only an authenticated selected CTA decision", () => {
  const base = {
    id: "selected-card-cta",
    title: "Xbox confirms a new backwards compatibility update",
    subreddit: "Xbox Wire",
    source_type: "rss",
  };
  const selected = buildStoryCardSpecs({
    ...base,
    cta: CONTEXTUAL_CTA,
    full_script: `Achievements are now confirmed. ${CONTEXTUAL_CTA}`,
    cta_policy: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: true,
      copy_strategy: CTA_POLICY.copy_strategy,
      cohort_bucket: 0,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: AUDIT_HASH,
    },
  });
  assert.equal(selected.takeaway.cta, CONTEXTUAL_CTA);
  assert.equal(selected.outro.cta, CONTEXTUAL_CTA);

  const tampered = buildStoryCardSpecs({
    ...base,
    cta_policy: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: true,
      copy_strategy: CTA_POLICY.copy_strategy,
      cohort_bucket: 0,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: AUDIT_HASH,
    },
  });
  assert.equal(tampered.takeaway.cta, "");
  assert.equal(tampered.outro.cta, "");
});

test("HyperFrames derived takeaway content follows the same CTA contract", () => {
  const base = {
    id: "hf-card-cta",
    title: "Publisher confirms a major service update",
    source_type: "rss",
    subreddit: "IGN",
  };
  const omitted = deriveCardContent({ story: base });
  assert.equal(omitted.takeaway.cta, "");
  assert.notDeepEqual(omitted.takeaway.headlineWords, [
    "FOLLOW",
    "FOR",
    "MORE",
  ]);

  const selected = deriveCardContent({
    story: {
      ...base,
      cta: CONTEXTUAL_CTA,
      full_script: `Achievements are now confirmed. ${CONTEXTUAL_CTA}`,
      cta_policy: {
        policy_version: CTA_POLICY.version,
        scope: "shorts",
        include_cta: true,
        copy_strategy: CTA_POLICY.copy_strategy,
        cohort_bucket: 0,
        cohort_numerator: 1,
        cohort_denominator: 3,
        audit_hash: AUDIT_HASH,
      },
    },
  });
  assert.equal(selected.takeaway.cta, CONTEXTUAL_CTA);
});

test("story card builder uses story-specific output names", () => {
  assert.equal(
    outputNameForCard("source", "rss_ca673f22ddbbbdfc", "pulse-gaming"),
    "hf_source_card_rss_ca673f22ddbbbdfc.mp4",
  );
  assert.equal(
    outputNameForCard("source", "rss_ca673f22ddbbbdfc", "stacked"),
    "hf_source_card_rss_ca673f22ddbbbdfc__stacked.mp4",
  );
  assert.equal(
    outputNameForCard("outro", "rss_ca673f22ddbbbdfc", "pulse-gaming"),
    "hf_outro_card_rss_ca673f22ddbbbdfc.mp4",
  );
});

test("story card builder prefers smart-cropped story backdrops", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-backdrop-"));
  try {
    const imageDir = path.join(root, "images");
    await fs.ensureDir(imageDir);
    const raw = path.join(imageDir, "story_trailerframe_1.jpg");
    const smart = path.join(imageDir, "story_trailerframe_1_smartcrop_v2.jpg");
    await fs.writeFile(raw, "raw");
    await fs.writeFile(smart, "smart");

    const picked = pickStoryBackdrop({
      mediaInventory: {
        trailerFrames: [{ path: raw, source: "trailer-frame" }],
      },
    });

    assert.equal(picked, smart);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});
