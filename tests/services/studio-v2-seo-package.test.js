"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDescription,
  buildPinnedComment,
} = require("../../lib/studio/v2/seo-package");

const channel = {
  channelId: "pulse-gaming",
  channelName: "Pulse Gaming News",
};

function baseStory(overrides = {}) {
  return {
    id: "seo-story",
    title: "Xbox changes its Game Pass plan",
    full_script:
      "Xbox changed its Game Pass plan. The new terms affect existing members next month.",
    cta: "",
    ...overrides,
  };
}

function packageFor(story) {
  return {
    hook: {
      chosen: {
        text: "Xbox just changed what Game Pass members receive.",
      },
    },
    script: {
      tightened: story.full_script,
    },
  };
}

test("Pulse SEO description omits an audience CTA for an omitted cohort", () => {
  const story = baseStory();
  const description = buildDescription({
    story,
    pkg: packageFor(story),
    channel,
  });

  assert.doesNotMatch(description, /\b(?:follow|subscribe)\b/i);
});

test("Pulse SEO description includes only the selected contextual CTA", () => {
  const cta = "Would this Game Pass change affect what you play next month?";
  const story = baseStory({
    full_script: `${baseStory().full_script} ${cta}`,
    cta,
    cta_policy: {
      policy_version: "pulse-selective-cta-v2",
      scope: "shorts",
      include_cta: true,
      copy_strategy: "story_specific_contextual",
      cohort_bucket: 0,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"b".repeat(64)}`,
    },
  });
  const description = buildDescription({
    story,
    pkg: packageFor(story),
    channel,
  });

  assert.match(description, new RegExp(cta.replace(/[?]/g, "\\?")));
  assert.equal(description.match(/Would this Game Pass change/g)?.length, 1);
  assert.doesNotMatch(description, /never miss the next one|follow for more/i);
});

test("Pulse SEO preparation never generates a public engagement comment", () => {
  const story = baseStory();
  const comment = buildPinnedComment({
    story,
    pkg: packageFor(story),
    scenes: [],
    runtimeS: 30,
    channel,
  });

  assert.equal(comment, null);
});
