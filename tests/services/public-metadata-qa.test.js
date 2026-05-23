"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PublicMetadataQaError,
  assertPublicMetadataSafe,
  collectPublicMetadataFailures,
  safePublicExcerpt,
} = require("../../lib/public-metadata-qa");
const { buildMetadata } = require("../../upload_youtube");

const GOOD_SCRIPT =
  "Forza Horizon 6 just broke a clear Steam record. The early access launch hit one hundred and thirty thousand concurrent players, which puts it ahead of the previous Horizon peak before the full release window even opens. That matters because this is not a vague hype signal. It is a named game, a visible storefront number and a concrete comparison against the last entry. Follow Pulse Gaming so you never miss a beat.";

function goodStory(overrides = {}) {
  return {
    id: "public_meta_good",
    title: "Forza Horizon 6 breaks its predecessor's Steam record",
    source_type: "rss",
    subreddit: "IGN",
    full_script: GOOD_SCRIPT,
    cta: "Follow Pulse Gaming so you never miss a beat",
    subtitle_timing_source: "timestamps",
    subtitle_timing_inspection: { usable: true },
    ...overrides,
  };
}

test("public metadata QA passes clean sourced gaming scripts", () => {
  assert.equal(assertPublicMetadataSafe(goodStory(), { surface: "youtube" }), true);
});

test("public metadata QA blocks review-required script placeholders", () => {
  const story = goodStory({
    script_generation_status: "review_required",
    script_review_reason: "script_validation_failed",
    full_script: "Script validation failed. Manual review required before production.",
  });

  assert.throws(
    () => assertPublicMetadataSafe(story, { surface: "instagram" }),
    (err) =>
      err instanceof PublicMetadataQaError &&
      err.failures.includes("script_validation_review_required"),
  );
});

test("public metadata QA blocks internal Pulse strategy language", () => {
  const failures = collectPublicMetadataFailures(
    goodStory({
      full_script:
        GOOD_SCRIPT +
        " For Pulse, that means the signal is not the headline and we are tracking confirmation.",
    }),
  );

  assert.ok(
    failures.some((failure) =>
      /internal_pulse_framing|abstract_signal_language|internal_tracking_language/.test(failure),
    ),
    failures.join(", "),
  );
});

test("public metadata QA blocks community Reddit media prompts", () => {
  const story = goodStory({
    title: "Came across a much simpler time in gaming today",
    source_type: "reddit",
    subreddit: "gaming",
    article_url: "https://i.redd.it/example.jpeg",
  });

  const failures = collectPublicMetadataFailures(story);
  assert.ok(failures.includes("community_reddit_media_not_news"));
});

test("public metadata QA does not double-count matching full and TTS scripts", () => {
  const story = goodStory({
    full_script: GOOD_SCRIPT,
    tts_script: GOOD_SCRIPT,
  });

  const failures = collectPublicMetadataFailures(story);
  assert.deepEqual(failures, []);
});

test("safePublicExcerpt strips render markers and cuts on a sentence boundary", () => {
  const excerpt = safePublicExcerpt(
    "[VISUAL: steam] Forza hit a new record today. Players noticed the spike immediately. This should be beyond the cutoff because the excerpt is short.",
    75,
  );

  assert.equal(excerpt, "Forza hit a new record today. Players noticed the spike immediately.");
});

test("YouTube metadata builder refuses unsafe public descriptions", () => {
  assert.throws(
    () =>
      buildMetadata(
        goodStory({
          full_script:
            GOOD_SCRIPT +
            " For Pulse, that means the signal is not the headline.",
        }),
      ),
    /public metadata QA failed/i,
  );
});

test("YouTube metadata builder refuses Boltgun-style incident copy before upload", () => {
  assert.throws(
    () =>
      buildMetadata({
        id: "boltgun-incident",
        title: "Boltgun 2 Already Feels Loud",
        suggested_title: "Boltgun 2 Already Feels Loud",
        canonical_subject: "Warhammer 40,000: Boltgun 2",
        canonical_game: "Warhammer 40,000: Boltgun 2",
        source_type: "rss",
        subreddit: "IGN",
        url: "https://www.ign.com/articles/warhammer-40000-boltgun-2-preview-fps-preview",
        suggested_thumbnail_text: "BOLTGUN 2 ALREADY FEELS LOUD",
        full_script:
          "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. IGN reports Warhammer 40,000 Boltgun 2 takes the ultraviolent '90s FPS to the great outdoors. The player angle is simple: check the price, access or platform details before you decide what to play next.",
        subtitle_timing_source: "timestamps",
        subtitle_timing_inspection: { usable: true },
      }),
    (err) =>
      err instanceof PublicMetadataQaError &&
      err.failures.includes("public_copy:weak_title_pattern") &&
      err.failures.includes("public_copy:lazy_player_angle_sentence"),
  );
});

test("YouTube metadata builder repairs placeholder upload titles before publish", () => {
  const metadata = buildMetadata(
    goodStory({
      suggested_title: "This gaming story",
    }),
  );

  assert.notEqual(metadata.title, "This gaming story");
  assert.match(metadata.title, /Forza|Steam/i);
});

test("YouTube metadata builder repairs raw article headline upload titles", () => {
  const metadata = buildMetadata(
    goodStory({
      title:
        "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
      suggested_title: "",
      full_script:
        "Mixtape just dodged one of gaming's most annoying problems. Licensed music can make games disappear later when rights expire. Mixtape's developer says they paid extra so its music licences last. Follow Pulse Gaming so you never miss a beat.",
    }),
  );

  assert.equal(metadata.title, "Mixtape Dodged Gaming's Delisting Trap");
});
