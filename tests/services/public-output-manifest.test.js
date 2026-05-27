"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  PublicOutputCoherenceError,
  assertPublicOutputCoherence,
  buildStoryManifest,
  runPublicOutputCoherenceGate,
  writeStoryManifest,
} = require("../../lib/public-output-manifest");

const GOOD_MIXTAPE_SCRIPT =
  "Mixtape just dodged one of gaming's most annoying problems. " +
  "A lot of games with licensed music can disappear later when those rights expire. " +
  "But Mixtape's developer says they paid extra so its music licences last in perpetuity. " +
  "That matters because Mixtape is built around its soundtrack. " +
  "If the music vanished, part of the game's identity would vanish with it. " +
  "So the story is simple: Mixtape is not just using licensed music. " +
  "It may be better protected from the licensing problem that has hurt other games. " +
  "Follow Pulse Gaming so you never miss a beat.";

function mixtapeStory(overrides = {}) {
  return {
    id: "mixtape_rps",
    title:
      "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
    source_type: "reddit",
    subreddit: "Games",
    source_name: "r/Games",
    article_url:
      "https://www.rockpapershotgun.com/mixtape-will-be-safe-from-a-music-licensing-related-delisting-ensured-by-its-developer-paying-extra-for-the-privilege",
    url: "https://www.reddit.com/r/Games/comments/example/mixtape_will_be_safe/",
    suggested_title: "Mixtape Just Avoided Gaming's Delisting Trap",
    suggested_thumbnail_text: "MIXTAPE WON'T VANISH",
    thumbnail_source_label: "Rock Paper Shotgun",
    source_card_label: "Rock Paper Shotgun",
    full_script: GOOD_MIXTAPE_SCRIPT,
    subtitle_timing_source: "timestamps",
    subtitle_timing_inspection: { usable: true },
    ...overrides,
  };
}

test("buildStoryManifest locks Mixtape to the publication source, not Reddit discovery", () => {
  const manifest = buildStoryManifest(mixtapeStory());

  assert.equal(manifest.story_id, "mixtape_rps");
  assert.equal(manifest.canonical_subject, "Mixtape");
  assert.equal(manifest.canonical_game, "Mixtape");
  assert.equal(manifest.short_title, "Mixtape Just Avoided Gaming's Delisting Trap");
  assert.equal(manifest.primary_source, "Rock Paper Shotgun");
  assert.equal(manifest.discovery_source, "r/Games");
  assert.equal(manifest.source_card_label, "Rock Paper Shotgun");
  assert.equal(manifest.thumbnail_text, "MIXTAPE WON'T VANISH");
});

test("buildStoryManifest emits the full canonical story manifest contract", () => {
  const manifest = buildStoryManifest(
    mixtapeStory({
      canonical_company: "Beethoven and Dinosaur",
      canonical_people: ["Annapurna Interactive"],
      secondary_sources: ["VGC", "GamesRadar"],
      confirmed_claims: ["Mixtape music licences were paid for in perpetuity"],
      unconfirmed_claims: ["Future store pricing is unknown"],
      prohibited_claims: ["Mixtape can never be delisted for any reason"],
      allowed_public_wording: ["Mixtape's developer says the music rights were secured in perpetuity."],
      platform_ctas: {
        youtube: "Story links are on the channel page.",
        x: "Sources and setup links are below.",
      },
      affiliate_pack_id: "affiliate_mixtape_rps",
      rights_manifest_id: "rights_mixtape_rps",
      publish_status: "AMBER",
    }),
  );

  const requiredFields = [
    "story_id",
    "canonical_subject",
    "canonical_game",
    "canonical_company",
    "canonical_people",
    "canonical_angle",
    "primary_source",
    "secondary_sources",
    "discovery_source",
    "official_source",
    "source_confidence_score",
    "claim_inventory",
    "confirmed_claims",
    "unconfirmed_claims",
    "prohibited_claims",
    "stale_wording_risks",
    "allowed_public_wording",
    "title_candidates",
    "selected_title",
    "thumbnail_headline",
    "first_spoken_line",
    "narration_script",
    "description",
    "pinned_comment",
    "platform_ctas",
    "affiliate_pack_id",
    "rights_manifest_id",
    "publish_status",
  ];

  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(manifest, field), `missing ${field}`);
  }

  assert.equal(manifest.selected_title, "Mixtape Just Avoided Gaming's Delisting Trap");
  assert.equal(manifest.thumbnail_headline, "MIXTAPE WON'T VANISH");
  assert.equal(manifest.first_spoken_line, "Mixtape just dodged one of gaming's most annoying problems.");
  assert.equal(manifest.official_source, null);
  assert.deepEqual(manifest.secondary_sources, ["VGC", "GamesRadar"]);
  assert.deepEqual(manifest.claim_inventory.confirmed, manifest.confirmed_claims);
  assert.ok(manifest.source_confidence_score >= 0.8);
  assert.equal(manifest.platform_ctas.youtube, "Story links are on the channel page.");
  assert.equal(manifest.affiliate_pack_id, "affiliate_mixtape_rps");
  assert.equal(manifest.rights_manifest_id, "rights_mixtape_rps");
  assert.equal(manifest.publish_status, "AMBER");
});

test("public output gate passes a viewer-facing Mixtape pack", () => {
  const story = mixtapeStory();
  const manifest = buildStoryManifest(story);
  const gate = runPublicOutputCoherenceGate({
    story,
    manifest,
    publicTitle: story.suggested_title,
    script: story.full_script,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: true,
  });

  assert.equal(gate.result, "pass", gate.failures.join(", "));
  assert.deepEqual(gate.failures, []);
});

// goal-test:generic_title_rejection
// goal-test:this_gaming_story_rejection
// goal-test:internal_qa_language_rejection
// goal-test:source_mismatch_rejection
// goal-test:missing_canonical_subject_rejection
// goal-test:excessive_caveat_ratio_rejection
// goal-test:unreadable_mobile_text_rejection
test("public output gate blocks the leaked internal Mixtape template", () => {
  const badScript =
    "This gaming story just got a source backed update. " +
    "Rock Paper Shotgun reports the core detail plainly. " +
    "The useful caveat is that this is one sourced update, not a blank check to invent extra details. " +
    "Treat the headline as confirmed only where the named source confirms it. " +
    "Everything else stays in the wait-and-see column until an official post, store page, or platform listing backs it up. " +
    "That keeps the story useful without turning Reddit reaction into evidence. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const story = mixtapeStory({
    suggested_title: "This gaming story",
    suggested_thumbnail_text:
      "MIXTAPE WILL BE SAFE FROM A MUSIC LICENSING RELATED DELISTING",
    thumbnail_source_label: "r/Games",
    source_card_label: "r/Games",
    full_script: badScript,
    subtitle_timing_source: "synthetic_fallback",
    subtitle_timing_inspection: { usable: false, reason: "no_word_timestamps" },
  });

  const gate = runPublicOutputCoherenceGate({
    story,
    publicTitle: story.suggested_title,
    script: badScript,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: false,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:placeholder_title"));
  assert.ok(gate.failures.includes("public_output:title_missing_canonical_subject"));
  assert.ok(gate.failures.includes("public_output:first_five_seconds_missing_subject"));
  assert.ok(gate.failures.includes("public_output:internal_qa_phrase:source_backed_update"));
  assert.ok(gate.failures.includes("public_output:internal_qa_phrase:not_a_blank_check"));
  assert.ok(gate.failures.includes("public_output:reddit_primary_source_conflict"));
  assert.ok(gate.failures.includes("public_output:thumbnail_source_mismatch"));
  assert.ok(gate.failures.includes("public_output:thumbnail_text_too_long"));
  assert.ok(gate.failures.includes("public_output:caveat_density_high"));
  assert.ok(gate.failures.includes("public_output:manual_captions_missing"));
});

// goal-test:thumbnail_title_script_mismatch_rejection
// goal-test:weak_first_frame_rejection
test("public output gate blocks thumbnail/title/script subject drift", () => {
  const story = mixtapeStory({
    suggested_title: "Mixtape Just Avoided Gaming's Delisting Trap",
    suggested_thumbnail_text: "STEAM HIT HARD",
  });

  const gate = runPublicOutputCoherenceGate({
    story,
    publicTitle: story.suggested_title,
    script: story.full_script,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: true,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:thumbnail_missing_canonical_subject"));
});

test("public output gate treats subject thumbnails without leading articles as aligned", () => {
  const gate = runPublicOutputCoherenceGate({
    story: {
      id: "expanse-thumb",
      canonical_subject: "The Expanse",
      public_title: "The Expanse Game Finally Looks Real",
      suggested_thumbnail_text: "EXPANSE GAMEPLAY",
      source_name: "Xbox",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      full_script:
        "The Expanse: Osiris Reborn finally has real gameplay. Xbox showed the game in motion. Follow Pulse Gaming so you never miss a beat.",
      manual_caption_generated: true,
    },
  });

  assert.equal(gate.result, "pass");
});

test("public output gate blocks raw article-style upload titles", () => {
  const story = mixtapeStory({
    suggested_title: "",
    public_title: "",
  });
  const gate = runPublicOutputCoherenceGate({
    story,
    publicTitle: story.title,
    script: story.full_script,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: true,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:raw_article_title_shape"));
});

test("public output gate blocks empty narration and raw image posts from passing coherence", () => {
  const gate = runPublicOutputCoherenceGate({
    story: {
      id: "1tbpzah",
      canonical_subject: "Capturing",
      canonical_subject_confidence: "explicit",
      selected_title: "Capturing Just Changed The Watchlist",
      short_title: "Capturing Just Changed The Watchlist",
      suggested_thumbnail_text: "CAPTURING",
      primary_source: "I",
      source_card_label: "I",
      primary_source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
      description: "Capturing mewtwo in the office shh. Source: I.",
      full_script: "",
      narration_script: "",
      manual_caption_generated: true,
      commercial_intelligence: {
        disclosure_required: true,
        primary_link: {
          label: "Mobile power bank",
          tracking_url: "/go/1tbpzah/mobile-accessory-portable-power-bank-phone",
        },
      },
    },
    captionFileExists: true,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:narration_script_missing"));
  assert.ok(gate.failures.includes("public_output:first_five_seconds_missing_subject"));
  assert.ok(gate.failures.includes("public_output:non_news_image_post_source"));
  assert.ok(gate.failures.includes("public_output:affiliate_on_non_news_image_post"));
});

test("assertPublicOutputCoherence throws a structured pre-upload error", () => {
  assert.throws(
    () =>
      assertPublicOutputCoherence({
        story: mixtapeStory({ suggested_title: "This gaming story" }),
        publicTitle: "This gaming story",
        captionFileExists: true,
      }),
    (err) =>
      err instanceof PublicOutputCoherenceError &&
      err.code === "public_output_coherence_failed" &&
      err.failures.includes("public_output:placeholder_title"),
  );
});

test("writeStoryManifest stores a locked per-video manifest JSON", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-manifest-"));
  const story = mixtapeStory();

  const result = await writeStoryManifest(story, {
    outputDir: tmp,
    publicTitle: story.suggested_title,
  });
  const raw = await fs.readFile(result.path, "utf8");
  const parsed = JSON.parse(raw);

  assert.equal(path.basename(result.path), "mixtape_rps_story_manifest.json");
  assert.equal(parsed.story_id, "mixtape_rps");
  assert.equal(parsed.primary_source, "Rock Paper Shotgun");
  assert.equal(parsed.short_title, "Mixtape Just Avoided Gaming's Delisting Trap");
});

test("story manifest preserves the media-house benchmark payload", () => {
  const manifest = buildStoryManifest(
    mixtapeStory({
      media_house_benchmark: {
        reference_pack_used: ["Gaming News Core"],
        scores: { media_house_polish_score: 88 },
      },
    }),
  );

  assert.deepEqual(manifest.reference_benchmark.reference_pack_used, [
    "Gaming News Core",
  ]);
  assert.equal(manifest.reference_benchmark.scores.media_house_polish_score, 88);
});

test("story manifest preserves commercial intelligence payload", () => {
  const manifest = buildStoryManifest(
    mixtapeStory({
      affiliate_link_manifest: {
        story_id: "mixtape_rps",
        vertical: "gaming",
        commercial_intent_type: "no_safe_commercial_intent",
        landing_page_route: "/p/mixtape-rps",
        disclosure_required: false,
      },
    }),
  );

  assert.equal(manifest.commercial_intelligence.story_id, "mixtape_rps");
  assert.equal(manifest.commercial_intelligence.landing_page_route, "/p/mixtape-rps");
});

test("story manifest strips advertiser-unfriendly source excerpts from public descriptions", () => {
  const manifest = buildStoryManifest(
    mixtapeStory({
      canonical_subject: "Xbox",
      suggested_title: "Xbox Now Has A Player-Facing Catch",
      description:
        "Xbox hired an analyst who said games were losing the attention war to gambling, porn and crypto. Read more",
      full_script:
        "Xbox just made a leadership move players should notice. The source points to a bigger attention fight around games. Follow Pulse Gaming for the gaming stories behind the headline.",
    }),
  );

  assert.equal(manifest.description.includes("gambling"), false);
  assert.equal(manifest.description.includes("porn"), false);
  assert.match(manifest.description, /^Xbox: /);
  assert.match(manifest.description, /Source: Rock Paper Shotgun\.$/);
});

test("public output gate blocks advertiser-unfriendly public descriptions", () => {
  const story = mixtapeStory();
  const manifest = {
    ...buildStoryManifest(story),
    description: "Mixtape source links mention gambling and porn in the public description.",
  };

  const gate = runPublicOutputCoherenceGate({
    story,
    manifest,
    publicTitle: story.suggested_title,
    script: story.full_script,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: true,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:advertiser_unfriendly_description"));
});

test("public output gate blocks advertiser-unfriendly narration and caption text", () => {
  const story = mixtapeStory();
  const gate = runPublicOutputCoherenceGate({
    story,
    publicTitle: story.suggested_title,
    script:
      "Mixtape just dodged a preservation problem. The source compares games against gambling and porn for attention. Follow Pulse Gaming so you never miss a beat.",
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    captionFileExists: true,
  });

  assert.equal(gate.result, "fail");
  assert.ok(gate.failures.includes("public_output:advertiser_unfriendly_narration"));
});
