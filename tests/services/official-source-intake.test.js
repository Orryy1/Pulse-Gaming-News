"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
