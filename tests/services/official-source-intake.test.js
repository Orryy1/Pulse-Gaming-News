"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  buildOfficialSourceIntakeReport,
  renderOfficialSourceIntakeMarkdown,
} = require("../../lib/official-source-intake");
const {
  buildOfficialTrailerReferencePlan,
  buildOfficialTrailerReferenceReport,
} = require("../../lib/official-trailer-reference-resolver");
const { parseArgs } = require("../../tools/official-source-intake");
const packageJson = require("../../package.json");

function story(overrides = {}) {
  return {
    id: "rss_gap",
    title: "GTA 6 owner passed on a sequel to a legacy franchise",
    full_script: "Take-Two fans are comparing GTA, Red Dead and BioShock after a legacy sequel was passed on.",
    source_type: "rss",
    subreddit: "GameSpot",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-07T12:00:00Z",
    ...overrides,
  };
}

function officialEntry(overrides = {}) {
  return {
    story_id: "rss_gap",
    entity: "Red Dead",
    official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
    source_title: "Red Dead Redemption 2 Official Trailer",
    source_owner: "Rockstar Games",
    source_type: "official_publisher_or_developer_trailer_page",
    source_family: "rockstar_red_dead_media_page",
    evidence_of_officialness: "Rockstar Games official website trailer page.",
    entity_match_notes: "Page title and URL are for Red Dead Redemption 2.",
    ...overrides,
  };
}

test("official source intake accepts entity-matched official references as reference-only", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });

  assert.equal(report.execution_mode, "report_only");
  assert.equal(report.will_download, false);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references.length, 1);

  const reference = report.accepted_references[0];
  assert.equal(reference.story_id, "rss_gap");
  assert.equal(reference.entity, "Red Dead");
  assert.equal(reference.provider, "official_intake");
  assert.equal(reference.source_type, "official_publisher_or_developer_trailer_page");
  assert.equal(reference.downloads_allowed, false);
  assert.equal(reference.allowed_render_use, "reference_only_by_default");
  assert.equal(reference.rights_risk_class, "official_reference_only");
  assert.equal(reference.source_url_kind, "html_or_unknown_page");
  assert.equal(reference.segment_validation_eligible, false);
  assert.equal(reference.segment_validation_ineligible_reason, "segment_source_url_not_direct_media");
  assert.equal(reference.source_verified, true);
  assert.equal(reference.provenance.source, "operator_official_source_intake");
  assert.equal(reference.provenance.source_url_kind, "html_or_unknown_page");
  assert.equal(report.safety.video_downloads, false);
  assert.equal(report.safety.production_db_mutated, false);
});

test("official source intake matches clean operator entries against mojibake story manifests", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "pokemon-go",
        title: "Mega Mewtwo Is Finally Coming To Pok\u00c3\u00a9mon Go",
        canonical_subject: "Pok\u00c3\u00a9mon Go",
        canonical_game: "Pok\u00c3\u00a9mon Go",
        full_script: "Mega Mewtwo is finally coming to Pok\u00c3\u00a9mon Go.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "pokemon-go",
        entity: "Pok\u00e9mon Go",
        official_source_url: "https://pokemongo.com/news/mega-mewtwo-gofest-2026",
        source_title: "Mewtwo Mega Evolves and more exciting GO Fest updates!",
        source_owner: "Pok\u00e9mon GO official website",
        source_type: "official_game_website_media_page",
        source_family: "pokemon_go_mega_mewtwo_gofest_2026_official_news",
        evidence_of_officialness: "Official Pok\u00e9mon GO website news page.",
        entity_match_notes: "Official page names Mega Mewtwo and Pok\u00e9mon GO Fest 2026.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].entity, "Pok\u00e9mon Go");
  assert.doesNotMatch(JSON.stringify(report), /Pok\u00c3|Ã|Â/);
});

test("official source intake rejects generic YouTube URLs without official evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.youtube.com/watch?v=notofficial",
        source_title: "Red Dead trailer upload",
        source_owner: "",
        source_type: "official_youtube_channel_url",
        evidence_of_officialness: "",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.equal(report.rejected_entries[0].reasons[0], "official_evidence_required_for_video_platform");
});

test("official source intake accepts official YouTube channel references only with evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.youtube.com/watch?v=rockstar-official",
        source_title: "Red Dead Redemption 2: Official Trailer #3",
        source_owner: "Rockstar Games verified YouTube channel",
        source_type: "official_youtube_channel_url",
        evidence_of_officialness: "Official verified Rockstar Games YouTube channel.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.accepted_references[0].provider, "official_intake");
  assert.equal(report.accepted_references[0].downloads_allowed, false);
  assert.equal(report.accepted_references[0].source_url_kind, "youtube_watch");
  assert.equal(report.accepted_references[0].segment_validation_eligible, false);
  assert.equal(
    report.accepted_references[0].segment_validation_ineligible_reason,
    "segment_source_is_youtube_reference",
  );
});

test("official source intake accepts official social direct video only with strict evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "Forza Horizon 6 is available now on Steam",
        full_script: "Forza Horizon 6 is pulling a huge Steam number and Xbox fans are watching closely.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available:
          "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
        source_title: "Lots to see in the lowlands #ForzaHorizon6",
        source_owner: "Official Forza Horizon verified X account",
        source_type: "official_social_media_video",
        source_family: "forza_horizon_official_x_fh6_lowlands_video",
        evidence_of_officialness:
          "Official verified @ForzaHorizon X post with direct media hosted on video-s.twimg.com.",
        entity_match_notes: "The official post and direct media are for Forza Horizon 6.",
        source_duration_s: 12,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].source_type, "official_social_media_video");
  assert.equal(report.accepted_references[0].source_url_kind, "direct_video");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].downloads_allowed, false);
  assert.equal(
    report.accepted_references[0].reference_page_url,
    "https://x.com/ForzaHorizon/status/2021227288788947178",
  );
});

test("official source intake rejects official social video without direct twimg media and evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "Forza Horizon 6 is available now on Steam",
        full_script: "Forza Horizon 6 is pulling a huge Steam number and Xbox fans are watching closely.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/randomfan/status/123",
        source_title: "Forza Horizon 6 clip repost",
        source_owner: "Random fan account",
        source_type: "official_social_media_video",
        source_family: "random_fan_forza_social_clip",
        evidence_of_officialness: "",
        entity_match_notes: "Forza Horizon 6 is mentioned in the post.",
      }),
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available: "https://cdn.example.com/forza-horizon-6-social.mp4",
        source_title: "Lots to see in the lowlands #ForzaHorizon6",
        source_owner: "Official Forza Horizon verified X account",
        source_type: "official_social_media_video",
        source_family: "forza_horizon_official_x_wrong_cdn",
        evidence_of_officialness: "Official verified @ForzaHorizon X post.",
        entity_match_notes: "The official post is for Forza Horizon 6.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 2);
  assert.ok(report.rejected_entries[0].reasons.includes("official_social_direct_media_required"));
  assert.ok(report.rejected_entries[0].reasons.includes("official_evidence_required_for_video_platform"));
  assert.ok(report.rejected_entries[1].reasons.includes("official_social_direct_media_host_not_allowed"));
});

test("official source intake marks direct media URLs as segment-validation eligible", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
        source_type: "platform_storefront_video_reference",
        source_family: "rockstar_red_dead_direct_hls",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.accepted_references[0].source_url_kind, "hls_manifest");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].segment_validation_ineligible_reason, null);
  assert.equal(report.provenance_ledger[0].segment_validation_eligible, true);
});

test("official source intake accepts official product-page direct media", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "PS5 Price Hike Rumour Hits Europe",
        canonical_subject: "PS5",
        full_script: "PS5 pricing is under scrutiny, but the product footage is only visual context.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "PS5",
        official_source_url: "https://www.playstation.com/en-gb/ps5/",
        direct_media_url_if_available:
          "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/hardware/ps5/channel-specific-content/pdc/2025/overview/hero/ps5-overview-evergreen-hero-desktop-video-01-en-16oct25.mp4",
        source_title: "PS5 official product video",
        source_owner: "PlayStation",
        source_type: "official_platform_product_page",
        source_family: "playstation_ps5_product_page",
        evidence_of_officialness: "Official PlayStation product page for PS5.",
        entity_match_notes: "The page and media are for PS5 hardware.",
        source_duration_s: 9.88,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].source_type, "official_platform_product_page");
  assert.equal(report.accepted_references[0].source_url_kind, "direct_video");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].allowed_render_use, "reference_only_by_default");
});

test("official source intake uses optional direct media URLs while preserving the reference page", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
        direct_media_url_if_available: "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
        source_type: "official_publisher_or_developer_trailer_page",
        source_duration_s: 10,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_entries[0].official_source_url, "https://www.rockstargames.com/reddeadredemption2/videos");
  assert.equal(
    report.accepted_entries[0].direct_media_url_if_available,
    "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
  );
  assert.equal(report.accepted_references[0].source_url, "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8");
  assert.equal(report.accepted_references[0].reference_page_url, "https://www.rockstargames.com/reddeadredemption2/videos");
  assert.equal(report.accepted_references[0].source_url_kind, "hls_manifest");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].source_duration_s, 10);
  assert.equal(report.accepted_references[0].provenance.source_duration_s, 10);
  assert.equal(
    report.accepted_references[0].provenance.reference_page_url,
    "https://www.rockstargames.com/reddeadredemption2/videos",
  );
  assert.equal(
    report.provenance_ledger[0].reference_page_url,
    "https://www.rockstargames.com/reddeadredemption2/videos",
  );
  assert.match(renderOfficialSourceIntakeMarkdown(report), /direct media/);
  assert.match(renderOfficialSourceIntakeMarkdown(report), /gameplay-trailer\.m3u8/);
});

test("official source intake rejects page URLs in the optional direct media field", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        direct_media_url_if_available: "https://www.youtube.com/watch?v=rockstar-official",
        source_owner: "Rockstar Games official YouTube channel",
        evidence_of_officialness: "Official verified Rockstar Games YouTube channel.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.equal(report.rejected_entries[0].direct_media_url_if_available, "https://www.youtube.com/watch?v=rockstar-official");
  assert.ok(report.rejected_entries[0].reasons.includes("direct_media_field_contains_page_url"));
});

test("official source intake rejects raw image URLs as source references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "1tbpzah",
        canonical_subject: "Capturing",
        title: "Capturing mewtwo in the office shh (pokemon red version) game boy color og",
        full_script: "Capturing Mewtwo in Pokemon Red appears in an office photo.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "1tbpzah",
        entity: "Capturing",
        official_source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
        source_title: "Capturing Mewtwo in Pokemon Red",
        source_owner: "Operator supplied image",
        source_type: "official_game_website_media_page",
        source_family: "raw_image_post",
        evidence_of_officialness: "Operator supplied image only.",
        entity_match_notes: "The image title mentions Capturing Mewtwo.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.ok(report.rejected_entries[0].reasons.includes("raw_image_source_not_allowed"));
});

test("official source intake rejects social reposts, reuploads and duplicate URLs", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.tiktok.com/@someone/video/123",
        source_title: "Red Dead trailer repost",
        source_type: "social_media_repost",
        evidence_of_officialness: "TikTok repost.",
      }),
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos?utm_source=x",
      }),
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos#trailer",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 2);
  assert.ok(report.rejected_entries.some((entry) => entry.reasons.includes("social_or_repost_source_forbidden")));
  assert.ok(report.rejected_entries.some((entry) => entry.reasons.includes("duplicate_source_url")));
});

test("official source intake rejects wrong-entity references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        entity: "Red Dead",
        official_source_url: "https://www.rockstargames.com/gta-v/videos",
        source_title: "Grand Theft Auto V Trailer",
        entity_match_notes: "This is a GTA page.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.rejected_entries[0].reasons[0], "entity_evidence_missing_or_wrong");
});

test("official source intake rejects entries that request downloads", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        downloads_allowed: true,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.ok(report.rejected_entries[0].reasons.includes("downloads_requested"));
});

test("official source intake rejects logo/title-only video references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos/logo-loop",
        source_title: "Red Dead Redemption 2 Official Logo Loop",
        evidence_of_officialness: "Official Rockstar Games video page.",
        entity_match_notes: "Red Dead Redemption 2 title appears on the page.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.ok(report.rejected_entries[0].reasons.includes("logo_or_title_only_reference"));
});

test("official source intake integrates with trailer resolver without enabling downloads", async () => {
  const intakeReport = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });

  const plan = await buildOfficialTrailerReferencePlan(story(), {
    officialSourceIntakeReport: intakeReport,
  });

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].provider, "official_intake");
  assert.equal(plan.references[0].entity, "Red Dead");
  assert.equal(plan.references[0].downloads_allowed, false);
  assert.equal(plan.references[0].segment_validation_eligible, false);
  assert.equal(plan.segment_validation_reference_counts.eligible, 0);
  assert.equal(plan.segment_validation_reference_counts.ineligible, 1);
  assert.equal(plan.summary_accepted_official_intake_references, 1);
  assert.equal(plan.safety.video_downloads, false);
  assert.ok(plan.provenance_ledger.some((item) => item.provider === "official_intake"));
});

test("official source intake contributes to resolver report counts and Markdown", async () => {
  const intakeReport = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });
  const report = await buildOfficialTrailerReferenceReport([story()], {
    officialSourceIntakeReport: intakeReport,
  });
  const markdown = renderOfficialSourceIntakeMarkdown(intakeReport);

  assert.equal(report.summary.official_intake_references, 1);
  assert.match(markdown, /Official Source Intake/);
  assert.match(markdown, /Report-only/);
  assert.match(markdown, /Red Dead/);
});

test("official source intake CLI and package script are available", () => {
  const args = parseArgs([
    "node",
    "tools/official-source-intake.js",
    "--input",
    "test/input/official_sources.json",
    "--story-id",
    "rss_gap",
    "--json",
  ]);

  assert.equal(args.input, "test/input/official_sources.json");
  assert.equal(args.storyId, "rss_gap");
  assert.equal(args.json, true);
  const toolSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "official-source-intake.js"),
    "utf8",
  );
  assert.match(toolSource, /dotenv.*config/s);
  assert.match(packageJson.scripts["media:intake-official-sources"], /official-source-intake\.js/);
});

test("official source intake CLI accepts governed package story JSON overrides", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-story-json-"));
  const storyPath = path.join(dir, "story.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      id: "package_story_red_dead",
      title: "Red Dead Redemption 2 trailer update",
      full_script: "Red Dead Redemption 2 has a new official trailer reference for a visual repair pass.",
      source_type: "rss",
      subreddit: "Rockstar",
      flair: "Verified",
      timestamp: "2026-05-07T12:00:00Z",
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "package_story_red_dead",
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "package_story_red_dead");
  assert.match(result.stdout, /package_story_red_dead/);
});

test("official source intake CLI accepts governed story_id without legacy id", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-story-id-json-"));
  const storyPath = path.join(dir, "story.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      story_id: "package_story_ps5",
      canonical_subject: "PS5",
      title: "PS5 Price Hike Rumour Hits Europe",
      full_script: "PS5 pricing is under scrutiny, with official product footage used only as visual context.",
      source_type: "rss",
      subreddit: "Eurogamer",
      flair: "Verified",
      timestamp: "2026-05-07T12:00:00Z",
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "package_story_ps5",
        entity: "PS5",
        official_source_url: "https://www.playstation.com/en-gb/ps5/",
        direct_media_url_if_available:
          "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/hardware/ps5/channel-specific-content/pdc/2025/overview/hero/ps5-overview-evergreen-hero-desktop-video-01-en-16oct25.mp4",
        source_type: "official_platform_product_page",
        source_family: "playstation_ps5_product_page",
        source_owner: "PlayStation",
        evidence_of_officialness: "Official PlayStation product page for PS5.",
        entity_match_notes: "The page and media are for PS5 hardware.",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "package_story_ps5");
});
