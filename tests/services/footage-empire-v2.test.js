"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  applyRightsLedgerRepair,
  buildFootageEmpireV2Report,
  buildRightsLedgerRepair,
  collectLocalMotionClips,
  formatFootageEmpireV2Markdown,
  scoreFootageEmpireStory,
} = require("../../lib/ops/footage-empire-v2");
const { parseArgs } = require("../../tools/footage-empire-v2");

function candidate(id, title = "Forza Horizon 6 Scores 84 On PC Gamer") {
  return {
    id,
    title,
    status: "publish_ready",
    source: { source_type: "rss" },
  };
}

function canonical(id) {
  return {
    story_id: id,
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    thumbnail_headline: "FORZA SCORE CHECK",
    first_spoken_line: "Forza Horizon 6 is scoring strongly on PC Gamer.",
    primary_source: "PC Gamer",
  };
}

test("parseArgs captures read-only footage empire operator options", () => {
  const args = parseArgs([
    "node",
    "tools/footage-empire-v2.js",
    "--json",
    "--story-id",
    "story-1",
    "--candidate-report",
    "output/custom-candidates.json",
    "--apply-rights-repair",
    "--out-dir",
    "output/custom-footage",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.storyId, "story-1");
  assert.equal(args.applyRightsRepair, true);
  assert.match(args.candidateReportPath, /custom-candidates\.json$/);
  assert.match(args.outDir, /custom-footage$/);
});

function trustedReport(storyId = "forza-ready") {
  return {
    story_candidates: [
      {
        story_id: storyId,
        entity: "Forza Horizon 6",
        source_id: "steam-forza-trailer",
        display_name: "Steam - Forza Horizon 6 official trailer",
        source_tier: "official",
        source_family: "steam_forza_horizon_6_launch_trailer",
        reference_url: "https://store.steampowered.com/app/forza",
        source_url_kind: "hls_manifest",
        segment_validation_eligible: true,
        autonomous_motion_candidate: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
      },
    ],
  };
}

function segmentReport(storyId = "forza-ready") {
  return {
    accepted_segments: [
      {
        story_id: storyId,
        id: "steam-window-1",
        source_family: "steam_forza_horizon_6_launch_trailer",
        path: "https://video.steamstatic.test/forza/master.m3u8",
        durationS: 3.2,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "steam-window-2",
        source_family: "steam_forza_horizon_6_launch_trailer",
        path: "https://video.steamstatic.test/forza/master.m3u8",
        durationS: 2.8,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "xbox-window-1",
        source_family: "xbox_forza_horizon_6_showcase",
        path: "https://assets.xbox.test/forza.mp4",
        durationS: 4.1,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "pcg-window-1",
        source_family: "pcgamer_forza_horizon_6_gameplay",
        path: "https://cdn.pcgamer.test/forza.mp4",
        durationS: 3.7,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "official-window-4",
        source_family: "forza_official_site_gameplay",
        path: "https://forza.test/gameplay.mp4",
        durationS: 3.9,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "official-window-5",
        source_family: "xbox_wire_gameplay",
        path: "https://news.xbox.test/gameplay.mp4",
        durationS: 3.5,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        story_id: storyId,
        id: "official-window-6",
        source_family: "gamesradar_forza_preview",
        path: "https://gamesradar.test/forza.mp4",
        durationS: 3.3,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  };
}

function rightsLedger() {
  return {
    assets: [
      { asset_id: "steam", source_family: "steam_forza_horizon_6_launch_trailer", approval_status: "approved" },
      { asset_id: "xbox", source_family: "xbox_forza_horizon_6_showcase", approval_status: "approved" },
      { asset_id: "pcg", source_family: "pcgamer_forza_horizon_6_gameplay", approval_status: "approved" },
      { asset_id: "official", source_family: "forza_official_site_gameplay", approval_status: "approved" },
      { asset_id: "wire", source_family: "xbox_wire_gameplay", approval_status: "approved" },
      { asset_id: "gamesradar", source_family: "gamesradar_forza_preview", approval_status: "approved" },
    ],
  };
}

test("collectLocalMotionClips merges footage inventory and validated segment reports", () => {
  const clips = collectLocalMotionClips({
    storyId: "forza-ready",
    footageInventory: {
      clips: [
        {
          id: "local-a",
          source_family: "local_family",
          path: "C:/media/local-a.mp4",
          durationS: 3,
          validated: true,
        },
      ],
    },
    segmentValidationReport: segmentReport("forza-ready"),
  });

  assert.equal(clips.length, 8);
  assert.ok(clips.some((clip) => clip.segmentValidationPassed === true));
});

test("collectLocalMotionClips accepts validator status and segment_validated fields", () => {
  const clips = collectLocalMotionClips({
    storyId: "forza-ready",
    segmentValidationReport: {
      segments: [
        {
          story_id: "forza-ready",
          status: "validated",
          segment_validated: true,
          source_family: "xbox_forza_horizon_6_showcase",
          source_url: "https://assets.xbox.test/forza.mp4",
          duration_s: 5,
        },
      ],
    },
  });

  assert.equal(clips.length, 1);
  assert.equal(clips[0].segmentValidationPassed, true);
});

test("scoreFootageEmpireStory is green with validated motion, source families and rights coverage", () => {
  const row = scoreFootageEmpireStory({
    story: candidate("forza-ready"),
    canonicalManifest: canonical("forza-ready"),
    trustedFootageReport: trustedReport("forza-ready"),
    segmentValidationReport: segmentReport("forza-ready"),
    rightsLedger: rightsLedger(),
  });

  assert.equal(row.verdict, "green");
  assert.equal(row.motion.ready, true);
  assert.equal(row.segment_validation.validated_segment_count, 7);
  assert.equal(row.rights_coverage.verdict, "pass");
  assert.deepEqual(row.blockers, []);
});

test("scoreFootageEmpireStory rejects wrong-video and missing-rights evidence", () => {
  const row = scoreFootageEmpireStory({
    story: candidate("wrong-video", "Steam Controller Date May Have Leaked"),
    canonicalManifest: {
      canonical_subject: "Steam Controller",
      selected_title: "Steam Controller Date May Have Leaked",
      thumbnail_headline: "STEAM CONTROLLER DATE",
    },
    trustedFootageReport: {
      story_candidates: [
        {
          story_id: "wrong-video",
          entity: "Forza Horizon 6",
          display_name: "Forza Horizon 6 official trailer",
          source_family: "forza_horizon_6_official_trailer",
          source_tier: "official",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
        },
      ],
    },
    segmentValidationReport: {
      accepted_segments: [
        {
          story_id: "wrong-video",
          source_family: "forza_horizon_6_official_trailer",
          path: "https://video.test/forza.m3u8",
          durationS: 3,
          validated: true,
          segmentValidationPassed: true,
        },
      ],
    },
    rightsLedger: { assets: [] },
  });

  assert.equal(row.verdict, "red");
  assert.ok(row.blockers.includes("trusted_footage_story_mismatch_or_missing"));
  assert.ok(row.blockers.includes("rights_coverage_missing_for_motion_families"));
});

test("buildRightsLedgerRepair creates records for source-safe direct motion families", () => {
  const repair = buildRightsLedgerRepair({
    storyId: "forza-ready",
    generatedAt: "2026-06-11T10:00:00.000Z",
    footageInventory: {
      clips: [
        {
          id: "clip-1",
          source_family: "steam_forza_horizon_6_launch_trailer",
          source_url: "https://cdn.steam.test/forza.mp4",
          path: "C:/cache/forza.mp4",
          source_type: "platform_storefront",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
          durationS: 5,
        },
        {
          id: "card-1",
          source_family: "generated_card",
          path: "C:/cache/card.mp4",
          media_kind: "owned_explainer_motion",
          durationS: 3,
        },
      ],
    },
    rightsLedger: { records: [] },
  });

  assert.equal(repair.records_to_add.length, 1);
  assert.equal(repair.records_to_add[0].source_family, "steam_forza_horizon_6_launch_trailer");
  assert.equal(repair.records_to_add[0].source_url, "https://cdn.steam.test/forza.mp4");
  assert.equal(repair.records_to_add[0].db_mutation_required, false);
});

test("applyRightsLedgerRepair merges missing records without removing existing evidence", () => {
  const current = {
    verdict: "pass",
    records: [
      {
        asset_id: "existing",
        source_family: "existing_family",
        approval_status: "approved",
      },
    ],
  };
  const repair = buildRightsLedgerRepair({
    storyId: "forza-ready",
    generatedAt: "2026-06-11T10:00:00.000Z",
    footageInventory: {
      clips: [
        {
          id: "clip-1",
          source_family: "xbox_forza_horizon_6_showcase",
          source_url: "https://assets.xbox.test/forza.mp4",
          path: "C:/cache/forza.mp4",
          source_type: "official_game_website_media_page",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
          durationS: 5,
        },
      ],
    },
    rightsLedger: current,
  });
  const repaired = applyRightsLedgerRepair(current, repair);

  assert.equal(repaired.records.length, 2);
  assert.equal(repaired.records.some((record) => record.source_family === "existing_family"), true);
  assert.equal(repaired.records.some((record) => record.source_family === "xbox_forza_horizon_6_showcase"), true);
  assert.equal(repaired.footage_empire_v2_rights_repair.records_added, 1);
});

test("buildFootageEmpireV2Report creates a ranked repair backlog", () => {
  const report = buildFootageEmpireV2Report({
    generatedAt: "2026-06-11T11:30:00.000Z",
    candidates: [
      candidate("forza-ready"),
      candidate("wrong-video", "Steam Controller Date May Have Leaked"),
    ],
    canonicalManifests: {
      "forza-ready": canonical("forza-ready"),
      "wrong-video": {
        canonical_subject: "Steam Controller",
        selected_title: "Steam Controller Date May Have Leaked",
      },
    },
    trustedFootageReport: trustedReport("forza-ready"),
    segmentValidationReport: segmentReport("forza-ready"),
    rightsLedgers: {
      "forza-ready": rightsLedger(),
      "wrong-video": { assets: [] },
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.summary.green_story_count, 1);
  assert.equal(report.summary.red_story_count, 1);
  assert.equal(report.repair_backlog.length, 1);
  assert.match(report.repair_backlog[0].recommended_command, /ops:footage-empire-v2/);

  const md = formatFootageEmpireV2Markdown(report);
  assert.match(md, /Footage Empire v2/);
  assert.match(md, /wrong-video/);
});
