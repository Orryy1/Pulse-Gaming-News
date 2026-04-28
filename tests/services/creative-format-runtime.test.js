"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  recommendRuntime,
  describeRuntimeRules,
  RUNTIME_PLANS,
} = require("../../lib/creative/runtime-recommender");
const {
  FORMATS,
  getFormat,
  meetsRequirements,
  selectFormatForStory,
  confidenceFromFlair,
} = require("../../lib/creative/format-catalogue");

test("runtime: every classification in RUNTIME_PLANS resolves", () => {
  for (const cls of Object.keys(RUNTIME_PLANS)) {
    const plan = recommendRuntime(cls);
    assert.equal(plan.classification, cls);
    assert.equal(typeof plan.shouldRender, "boolean");
    assert.equal(typeof plan.note, "string");
  }
  // unknown class routes to manual_review without throwing
  const plan = recommendRuntime("not_a_real_class");
  assert.equal(plan.shouldRender, false);
  assert.equal(plan.route, "manual_review");
});

test("runtime: reject_visuals + blog_only do not render", () => {
  for (const cls of ["reject_visuals", "blog_only"]) {
    const plan = recommendRuntime(cls);
    assert.equal(plan.shouldRender, false);
  }
});

test("runtime: short_only is 30-45s, premium_video is 60-75s", () => {
  const sho = recommendRuntime("short_only");
  assert.equal(sho.runtimeSeconds.min, 30);
  assert.equal(sho.runtimeSeconds.max, 45);
  const prem = recommendRuntime("premium_video");
  assert.equal(prem.runtimeSeconds.min, 60);
  assert.equal(prem.runtimeSeconds.max, 75);
});

test("runtime: describeRuntimeRules emits all 6 buckets", () => {
  const rules = describeRuntimeRules();
  const ids = rules.map((r) => r.classification).sort();
  assert.deepEqual(ids, [
    "blog_only",
    "briefing_item",
    "premium_video",
    "reject_visuals",
    "short_only",
    "standard_video",
  ]);
});

test("formats: catalogue contains all 9 ids the prompt requires", () => {
  const expected = [
    "daily_shorts",
    "daily_briefing",
    "weekly_roundup",
    "monthly_release_radar",
    "before_you_download",
    "trailer_breakdown",
    "rumour_radar",
    "blog_only",
    "reject",
  ];
  const ids = FORMATS.map((f) => f.id).sort();
  assert.deepEqual(ids, expected.slice().sort());
});

test("formats: every format declares the required structural fields", () => {
  const requiredKeys = [
    "id",
    "label",
    "viewerPromise",
    "idealRuntimeSeconds",
    "sourceConfidence",
    "mediaInventory",
    "scriptStructure",
    "titlePatterns",
    "seo",
    "shortsRepurposing",
    "analyticsToTrack",
    "monetisation",
    "promotionRules",
    "demotionRules",
    "reviewRequirements",
  ];
  for (const fmt of FORMATS) {
    for (const k of requiredKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(fmt, k),
        `format ${fmt.id} missing field ${k}`,
      );
    }
  }
});

test("formats: meetsRequirements gates by inventory class + confidence", () => {
  const radar = getFormat("monthly_release_radar");
  // Premium inventory + confirmed should pass
  assert.equal(
    meetsRequirements(radar, {
      classification: "premium_video",
      sourceConfidence: "confirmed",
    }),
    true,
  );
  // Premium inventory but only rumour confidence — radar is confirmed-only
  assert.equal(
    meetsRequirements(radar, {
      classification: "premium_video",
      sourceConfidence: "rumour",
    }),
    false,
  );
  // Confirmed but only short_only inventory — radar requires premium
  assert.equal(
    meetsRequirements(radar, {
      classification: "short_only",
      sourceConfidence: "confirmed",
    }),
    false,
  );
});

test("formats: selectFormatForStory routes inventory bands correctly", () => {
  const reject = selectFormatForStory(
    { id: "s1", flair: "Rumour" },
    { classification: "reject_visuals" },
  );
  assert.equal(reject.format.id, "reject");

  const blog = selectFormatForStory(
    { id: "s2", flair: "News" },
    { classification: "blog_only" },
  );
  assert.equal(blog.format.id, "blog_only");

  const shortOnly = selectFormatForStory(
    { id: "s3", flair: "Verified" },
    { classification: "short_only" },
  );
  assert.equal(shortOnly.format.id, "daily_shorts");
});

test("formats: confidenceFromFlair maps the standard flairs", () => {
  assert.equal(confidenceFromFlair("Confirmed"), "confirmed");
  assert.equal(confidenceFromFlair("Verified"), "verified");
  assert.equal(confidenceFromFlair("Highly Likely"), "likely");
  assert.equal(confidenceFromFlair("Rumour"), "rumour");
  assert.equal(confidenceFromFlair(""), "unknown");
});
