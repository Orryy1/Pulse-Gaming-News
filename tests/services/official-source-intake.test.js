"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

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
  assert.equal(reference.source_verified, true);
  assert.equal(reference.provenance.source, "operator_official_source_intake");
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
  assert.match(packageJson.scripts["media:intake-official-sources"], /official-source-intake\.js/);
});
