"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildReleaseRadarLongformCompilation,
  buildReleaseRadarLongformEvidence,
  buildReleaseRadarLongformQualityReport,
  buildReleaseRadarMotionQa,
  blackEventsPass,
  buildActualReleaseRadarChapters,
  applyCandidateExclusions,
  imageCandidatesForSegment,
  motionSourceUrlsForSegment,
  motionClipStarts,
  motionClipStartCandidates,
  releaseRadarRenderBlockers,
  buildReleaseRadarAudioManifest,
  releaseRadarAudioManifestMatches,
  shouldUploadReleaseRadarLongform,
  cleanTtsText,
  writePulseReleaseRadarArtifacts,
  parseArgs,
  youtubeVideoId,
} = require("../../tools/pulse-release-radar");

function candidate(index) {
  const n = String(index).padStart(2, "0");
  return {
    id: `release-${n}`,
    title: `Release Radar Game ${n}`,
    canonical_game: `Release Radar Game ${n}`,
    release_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    platforms: ["PC", "Xbox Series X/S"],
    source_manifest: [
      {
        type: "official_store",
        label: "Steam",
        url: `https://store.steampowered.com/app/${9000 + index}/release-radar-game-${n}`,
        supports: ["release_date", "platforms"],
      },
      {
        type: "official_trailer",
        label: "Official trailer",
        url: `https://www.youtube.com/watch?v=radar${n}`,
        supports: ["gameplay_motion"],
      },
    ],
    claim_inventory: [
      {
        claim: `Release Radar Game ${n} has a confirmed July 2026 date.`,
        source_url: `https://store.steampowered.com/app/${9000 + index}/release-radar-game-${n}`,
      },
    ],
    official_motion: {
      trailer_url: `https://www.youtube.com/watch?v=radar${n}`,
      clip_count: 3,
      distinct_source_families: 2,
      gameplay_seconds: 80,
    },
    player_impact: `Players get a clear reason to care about game ${n}: the footage shows a concrete loop, the store page names the platform route and the release window is close enough to affect what people buy next.`,
    curiosity_gap: `The question is whether game ${n} is more than a trailer win.`,
    risk_factor: `Risk ${n}: the footage hides one system that needs review, so the smart move is to judge the promise against real mechanics rather than treat the trailer as proof of depth.`,
    payoff: `Viewers know where game ${n} sits on the July shortlist and whether it is a buy-now candidate, a wishlist hold or a wait-for-review release.`,
    verdict: "wishlist",
    debate_prompt: `Would game ${n} make your top five for July?`,
  };
}

test("Pulse Release Radar CLI writes the production artefact set without publish side effects", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-release-radar-"));
  const inputPath = path.join(tmp, "candidates.json");
  const outDir = path.join(tmp, "out");
  await fs.writeJson(inputPath, {
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const result = await writePulseReleaseRadarArtifacts({
    inputPath,
    outDir,
    affiliateTag: "pulsegaming-21",
  });

  assert.equal(result.pack.readiness.verdict, "READY_FOR_OPERATOR_REVIEW");
  assert.equal(result.safety.live_publish_performed, false);
  assert.equal(result.safety.production_db_mutated, false);
  assert.equal(await fs.pathExists(path.join(outDir, "pulse_release_radar_package.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "pulse_release_radar_report.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "longform_script.md")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "source_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "affiliate_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "shorts", "01.md")), true);
});

test("Pulse Release Radar builds a longform compilation and quality evidence from the review pack", () => {
  const pack = require("../../lib/formats/pulse-release-radar").buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const evidence = buildReleaseRadarLongformEvidence(pack);
  const compilation = buildReleaseRadarLongformCompilation(pack, {
    outDir: path.join(os.tmpdir(), "pulse-release-radar-longform"),
  });
  const quality = buildReleaseRadarLongformQualityReport({
    pack,
    videoProbe: { width: 1920, height: 1080, videoBitrate: 6500000 },
  });

  assert.equal(compilation.segments.length, 10);
  assert.equal(compilation.duration, pack.longform.estimated_runtime_seconds);
  assert.match(compilation.title, /Best New Games Coming in July 2026/i);
  assert.equal(compilation.privacyStatus, "private");
  assert.equal(evidence.segmentCount, 10);
  assert.equal(evidence.sourcePack[0].confidence, "confirmed");
  assert.equal(evidence.visualPlan.every((item) => item.validated_clips >= 1), true);
  assert.equal(quality.verdict, "pass");
});

test("Pulse Release Radar longform quality uses actual video duration when available", () => {
  const pack = require("../../lib/formats/pulse-release-radar").buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const quality = buildReleaseRadarLongformQualityReport({
    pack,
    videoProbe: { width: 1920, height: 1080, videoBitrate: 6500000, durationSeconds: 653.08 },
  });

  assert.equal(quality.duration_seconds, 653.08);
  assert.equal(quality.verdict, "pass");
});

test("Pulse Release Radar builds publish chapters from actual runtime", () => {
  const pack = require("../../lib/formats/pulse-release-radar").buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  const chapters = buildActualReleaseRadarChapters(pack, 653.083991);

  assert.equal(chapters[0].time, "0:00");
  assert.equal(chapters[1].time, "0:10");
  assert.match(chapters[1].title, /1\. Release Radar Game 01/);
  assert.equal(chapters.at(-1).title, "Final verdict");
  assert.equal(chapters.at(-1).time, "10:23");
});

test("Pulse Release Radar longform upload requires explicit release-radar consent and passing QA", () => {
  assert.equal(
    shouldUploadReleaseRadarLongform({
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
      },
      qualityReport: { verdict: "pass" },
    }),
    false,
  );

  assert.equal(
    shouldUploadReleaseRadarLongform({
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        RELEASE_RADAR_AUTO_PUBLISH: "true",
      },
      qualityReport: { verdict: "fail", blockers: ["duration_under_10_minutes"] },
    }),
    false,
  );

  assert.equal(
    shouldUploadReleaseRadarLongform({
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        RELEASE_RADAR_AUTO_PUBLISH: "true",
      },
      qualityReport: { verdict: "pass" },
    }),
    true,
  );
});

test("Pulse Release Radar render flags and official image candidates are deterministic", () => {
  const args = parseArgs(["--json", "--render-longform", "--publish-youtube", "--operator-confirmed"]);
  assert.equal(args.json, true);
  assert.equal(args.renderLongform, true);
  assert.equal(args.publishYoutube, true);
  assert.equal(args.operatorConfirmed, true);

  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=ZdMwqKiSeEE"), "ZdMwqKiSeEE");
  assert.equal(youtubeVideoId("https://youtu.be/haa9r1pe8Q8"), "haa9r1pe8Q8");

  const urls = imageCandidatesForSegment({
    official_motion: { trailer_url: "https://www.youtube.com/watch?v=ZdMwqKiSeEE" },
    sources: [{ url: "https://store.steampowered.com/app/2209900/Moonlight_Peaks/" }],
  });
  assert.ok(urls.includes("https://i.ytimg.com/vi/ZdMwqKiSeEE/maxresdefault.jpg"));
  assert.ok(urls.includes("https://cdn.akamai.steamstatic.com/steam/apps/2209900/header.jpg"));
});

test("Pulse Release Radar motion QA blocks still-led longform packages", () => {
  assert.deepEqual(motionClipStarts(60, 3, 8).length, 3);
  assert.equal(motionClipStarts(9, 3, 8).length, 1);
  assert.equal(motionClipStarts(55, 3, 24).length, 3);

  const pass = buildReleaseRadarMotionQa(
    Array.from({ length: 10 }, (_, index) => ({
      story_id: `story_${index}`,
      title: `Story ${index}`,
      status: "ready",
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }],
    })),
  );
  assert.equal(pass.verdict, "pass");

  const fail = buildReleaseRadarMotionQa([
    { story_id: "still_only", title: "Still Only", status: "blocked", clips: [] },
  ]);
  assert.equal(fail.verdict, "fail");
  assert.ok(fail.blockers.includes("motion_clip_coverage_incomplete"));
});

test("Pulse Release Radar refuses to render an incomplete candidate pack", () => {
  const blocked = require("../../lib/formats/pulse-release-radar").buildPulseReleaseRadarPack({
    monthLabel: "August 2026",
    candidates: [candidate(1)],
  });
  const ready = require("../../lib/formats/pulse-release-radar").buildPulseReleaseRadarPack({
    monthLabel: "July 2026",
    candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
  });

  assert.ok(releaseRadarRenderBlockers(blocked).includes("insufficient_ready_candidates"));
  assert.deepEqual(releaseRadarRenderBlockers(ready), []);
});

test("Pulse Release Radar can replace a motion-blocked top-ten entry with a verified reserve", () => {
  const input = {
    month_label: "August 2026",
    candidates: Array.from({ length: 12 }, (_, index) => candidate(index + 1)),
  };

  const filtered = applyCandidateExclusions(input, ["release-05"]);

  assert.equal(filtered.candidates.length, 11);
  assert.ok(!filtered.candidates.some((item) => item.id === "release-05"));
  assert.equal(filtered.excluded_candidate_ids[0], "release-05");
});

test("Pulse Release Radar keeps fallback motion sources for longform acquisition", () => {
  const urls = motionSourceUrlsForSegment({
    official_motion: { trailer_url: "https://official.example/short-teaser" },
    sources: [
      { url: "https://official.example/short-teaser" },
      { url: "https://store.steampowered.com/app/123456/Real_Game/" },
      { url: "https://www.youtube.com/watch?v=usableOfficialTrailer" },
    ],
  });

  assert.deepEqual(urls, [
    "https://official.example/short-teaser",
    "https://store.steampowered.com/app/123456/Real_Game/",
    "https://www.youtube.com/watch?v=usableOfficialTrailer",
  ]);
});

test("Pulse Release Radar tries bounded alternate clip starts when a trailer window is black", () => {
  assert.deepEqual(motionClipStartCandidates(60, 24, 100), [60, 66, 54, 72, 48]);
  assert.deepEqual(motionClipStartCandidates(2, 24, 30), [2, 6]);
});

test("Pulse Release Radar rejects sustained black trailer windows", () => {
  assert.equal(blackEventsPass([{ duration_seconds: 0.4 }]), true);
  assert.equal(blackEventsPass([{ duration_seconds: 0.8 }]), false);
  assert.equal(blackEventsPass([{ duration_seconds: 0.4 }, { duration_seconds: 0.4 }]), false);
});

test("Pulse Release Radar TTS preserves accented title letters while removing title punctuation pauses", () => {
  assert.equal(
    cleanTtsText("MARVEL Tōkon: Fighting Souls arrives in August.", {
      protectedTitles: ["MARVEL Tōkon: Fighting Souls"],
    }),
    "MARVEL Tokon Fighting Souls arrives in August.",
  );
});

test("Pulse Release Radar audio manifests invalidate stale narration after script changes", () => {
  const options = { protectedTitles: ["Halo: Campaign Evolved"] };
  const manifest = buildReleaseRadarAudioManifest(
    "Halo: Campaign Evolved is the headline.",
    options,
  );

  assert.equal(
    releaseRadarAudioManifestMatches(
      manifest,
      "Halo: Campaign Evolved is the headline.",
      options,
    ),
    true,
  );
  assert.equal(
    releaseRadarAudioManifestMatches(
      manifest,
      "Halo: Campaign Evolved now has a release date.",
      options,
    ),
    false,
  );
  assert.equal(releaseRadarAudioManifestMatches(null, "anything", options), false);
});
