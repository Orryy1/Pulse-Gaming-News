"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERIES_PATH = path.join(REPO_ROOT, "videos", "system-trace-display-pipeline-series.json");
const BUFFER_PATH = path.join(REPO_ROOT, "videos", "system-trace-display-pipeline-youtube-buffer.json");
const RIGHTS_PATH = path.join(REPO_ROOT, "videos", "system-trace-display-pipeline-buffer-rights-ledger.json");
const OFFICIAL_SOURCE_HOSTS = new Set([
  "developer.apple.com",
  "developer.nvidia.com",
  "dev.epicgames.com",
  "gpuopen.com",
  "learn.microsoft.com",
  "vesa.org",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function srtLastEndSeconds(filePath) {
  const timestamps = [
    ...fs.readFileSync(filePath, "utf8").matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g),
  ];
  const match = timestamps.at(-1);
  assert.ok(match, `${filePath}: at least one caption cue is required`);
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
}

test("display-pipeline campaign is a closed seven-day official-source buffer", () => {
  const series = readJson(SERIES_PATH);
  const buffer = readJson(BUFFER_PATH);

  assert.equal(series.schema, "pulse_system_trace_display_pipeline_series_v1");
  assert.equal(series.episodes.length, 7);
  assert.equal(buffer.schema, "pulse_system_trace_youtube_buffer_v1");
  assert.equal(buffer.channel.id, "UCvgNDjtTezrpxL8oUe6mYwA");
  assert.equal(buffer.episodes.length, 7);
  assert.equal(buffer.initial_privacy_status, "private");
  assert.equal(buffer.notify_subscribers_on_upload, false);
  assert.equal(buffer.synthetic_media_disclosure, true);

  const expectedSlots = Array.from({ length: 7 }, (_, index) =>
    `2026-08-${String(22 + index).padStart(2, "0")}T17:00:00Z`,
  );
  assert.deepEqual(buffer.episodes.map((episode) => episode.publish_at_utc), expectedSlots);
  assert.equal(new Set(buffer.episodes.map((episode) => episode.story_id)).size, 7);
  assert.equal(new Set(buffer.episodes.map((episode) => episode.title)).size, 7);
  assert.deepEqual(
    buffer.episodes.map((episode) => episode.story_id),
    series.episodes.map((episode) => episode.story_id),
  );

  for (const episode of series.episodes) {
    assert.equal(episode.frames.length, 6, `${episode.story_id}: six teaching beats required`);
    assert.ok(episode.frames.every((frame) => frame.trim().split(/\s+/).length >= 12));
    assert.ok(episode.sources.length >= 2, `${episode.story_id}: source plurality required`);
    for (const source of episode.sources) {
      const url = new URL(source);
      assert.ok(OFFICIAL_SOURCE_HOSTS.has(url.hostname), `${episode.story_id}: non-official source ${url.hostname}`);
    }
    const projectDir = path.join(REPO_ROOT, episode.project_dir);
    for (const relativePath of ["BRIEF.md", "SCRIPT.md", "STORYBOARD.md", "frame.md", "hyperframes.json", "package.json"]) {
      assert.ok(fs.existsSync(path.join(projectDir, relativePath)), `${episode.story_id}: missing ${relativePath}`);
    }
  }
});

test("public copy is British, advertiser-safe and free of internal workflow language", () => {
  const buffer = readJson(BUFFER_PATH);
  const forbidden = /\b(?:rumou?r|leak|internal|qa|test fixture|placeholder|codex|chatgpt)\b/i;

  for (const episode of buffer.episodes) {
    assert.doesNotMatch(episode.title, forbidden);
    assert.doesNotMatch(episode.description, forbidden);
    assert.match(episode.description, /Visuals: original Pulse Gaming diagrams\./);
    assert.match(episode.description, /Synthetic media disclosure: Yes\./);
    assert.equal(episode.tags.includes("System Trace"), true);
  }
});

test("campaign compositions stay portrait and resolve assets from the project root", () => {
  const series = readJson(SERIES_PATH);

  for (const episode of series.episodes) {
    const projectDir = path.join(REPO_ROOT, episode.project_dir);
    const storyboard = fs.readFileSync(path.join(projectDir, "STORYBOARD.md"), "utf8");
    assert.match(storyboard, /^format: 1080x1920$/m, `${episode.story_id}: portrait format must be machine-readable`);

    const framesDir = path.join(projectDir, "compositions", "frames");
    assert.ok(fs.existsSync(framesDir), `${episode.story_id}: frame directory is required`);
    const frameFiles = fs
      .readdirSync(framesDir)
      .filter((name) => name.endsWith(".html"));
    assert.equal(frameFiles.length, 6, `${episode.story_id}: exactly six authored frames required`);

    for (const frameFile of frameFiles) {
      const html = fs.readFileSync(path.join(framesDir, frameFile), "utf8");
      assert.match(html, /data-width="1080"/, `${episode.story_id}/${frameFile}: width must be portrait`);
      assert.match(html, /data-height="1920"/, `${episode.story_id}/${frameFile}: height must be portrait`);
      assert.doesNotMatch(
        html,
        /(?:\bsrc\s*=\s*["']|\burl\(["']?)\.\.\//,
        `${episode.story_id}/${frameFile}: assets must use project-root-relative paths`,
      );
    }

    const captionsPath = path.join(projectDir, "compositions", "captions.html");
    const captions = fs.readFileSync(captionsPath, "utf8");
    assert.match(
      captions,
      /<template\b[^>]*data-width="1080"[^>]*data-height="1920"/,
      `${episode.story_id}: caption composition must use the portrait canvas`,
    );
    assert.match(
      captions,
      /id="captions-root"[\s\S]*?data-width="1080"[\s\S]*?data-height="1920"/,
      `${episode.story_id}: caption root must use the portrait canvas`,
    );
  }
});

test("VRR frame selectors are valid and isolated to their composition", () => {
  const framesDir = path.join(
    REPO_ROOT,
    "videos",
    "system-trace-variable-refresh-rate",
    "compositions",
    "frames",
  );
  const frameFiles = fs
    .readdirSync(framesDir)
    .filter((name) => name.endsWith(".html"))
    .sort();

  assert.equal(frameFiles.length, 6, "VRR must have exactly six authored frames");

  for (const frameFile of frameFiles) {
    const stem = path.basename(frameFile, ".html");
    const allowedPrefixes = [`f${stem}-`, `frame-${stem}-`];
    const html = fs.readFileSync(path.join(framesDir, frameFile), "utf8");
    const classTokens = new Set(
      [...html.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gs)]
        .flatMap((match) => match[2].trim().split(/\s+/))
        .filter(Boolean),
    );

    for (const classToken of classTokens) {
      if (classToken === "clip") continue;
      assert.match(
        classToken,
        /^[A-Za-z_][A-Za-z0-9_-]*$/,
        `${frameFile}: ${classToken} is not a valid unescaped class selector`,
      );
      assert.ok(
        allowedPrefixes.some((prefix) => classToken.startsWith(prefix)),
        `${frameFile}: ${classToken} is not isolated to its composition`,
      );
    }

    const elementIds = [...html.matchAll(/<[^>]*\sid\s*=\s*(["'])(.*?)\1[^>]*>/g)].map((match) => match[2]);
    for (const elementId of elementIds) {
      if (elementId === "root") continue;
      assert.ok(
        allowedPrefixes.some((prefix) => elementId.startsWith(prefix)),
        `${frameFile}: ${elementId} is not an assembly-unique element id`,
      );
    }

    for (const match of html.matchAll(/querySelector(?:All)?\(\s*(["'])\.([A-Za-z0-9_-]+)[^"']*\1\s*\)/g)) {
      const queriedClass = match[2];
      assert.ok(
        classTokens.has(queriedClass),
        `${frameFile}: querySelector references missing class ${queriedClass}`,
      );
    }
  }
});

test("VRR captions cover the governed programme through 53.700 seconds", () => {
  const projectDir = path.join(REPO_ROOT, "videos", "system-trace-variable-refresh-rate");
  const srt = fs.readFileSync(path.join(projectDir, "captions.srt"), "utf8");
  const cueEnds = [...srt.matchAll(/-->\s*(\d{2}:\d{2}:\d{2},\d{3})/g)].map((match) => match[1]);
  const groups = readJson(path.join(projectDir, "caption_groups.json"));

  assert.ok(cueEnds.length > 0, "VRR captions must contain at least one SRT cue");
  assert.equal(cueEnds.at(-1), "00:00:53,700");
  assert.equal(groups.total_duration_s, 53.7);
  assert.equal(groups.groups.at(-1).end, 53.7);
});

test("HDR final card gives the title and subline separate explicit zones", () => {
  const framePath = path.join(
    REPO_ROOT,
    "videos",
    "system-trace-hdr-tone-mapping",
    "compositions",
    "frames",
    "06-controlled-compromise.html",
  );
  const html = fs.readFileSync(framePath, "utf8");

  assert.match(
    html,
    /\.f06-controlled-compromise-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:/s,
  );
  assert.match(html, /\.f06-controlled-compromise-card h1\s*\{[^}]*margin:\s*0;/s);
  assert.match(html, /\.f06-controlled-compromise-card p\s*\{[^}]*margin:\s*0;/s);
});

test("campaign rights ledger is GREEN and bound to the exact original audio and font bytes", () => {
  const ledger = readJson(RIGHTS_PATH);
  const musicPath = path.join(REPO_ROOT, "videos", ledger.music.file);
  const fontRoot = path.join(REPO_ROOT, "videos", "system-trace-screen-tearing", "assets", "fonts");

  assert.equal(ledger.schema, "pulse_system_trace_buffer_rights_ledger_v1");
  assert.deepEqual(ledger.scope, {
    series: "SYSTEM TRACE — DISPLAY PIPELINE",
    episode_count: 7,
    platform: "youtube_shorts",
    finished_editorial_video_only: true,
  });
  assert.equal(ledger.visuals.verdict, "GREEN");
  assert.equal(ledger.visuals.third_party_visual_assets_embedded, false);
  assert.equal(ledger.narration.verdict, "GREEN");
  assert.equal(ledger.narration.synthetic_media, true);
  assert.equal(ledger.narration.disclosure_setting, "YES");
  assert.equal(ledger.music.verdict, "GREEN");
  assert.equal(ledger.music.origin, "Pulse Gaming deterministic procedural synthesis generated locally with FFmpeg");
  assert.equal(ledger.music.commercial_use_allowed, true);
  assert.equal(ledger.music.planned_episode_placements, 7);
  assert.equal(ledger.music.reuse_limit_pass, true);
  assert.equal(fs.statSync(musicPath).size, ledger.music.bytes);
  assert.equal(sha256(musicPath), ledger.music.sha256);
  assert.equal(ledger.sound_effects.verdict, "GREEN");
  assert.deepEqual(ledger.sound_effects.assets, []);
  assert.equal(ledger.fonts.verdict, "GREEN");
  for (const font of ledger.fonts.assets) {
    const fontPath = path.join(fontRoot, font.file);
    assert.equal(fs.statSync(fontPath).size, font.bytes, `${font.file}: byte count drift`);
    assert.equal(sha256(fontPath), font.sha256, `${font.file}: SHA-256 drift`);
  }
  assert.equal(ledger.placement_verdict, "GREEN");
  assert.deepEqual(ledger.blockers, []);
  assert.equal(ledger.public_release_scope, "exact rendered seven-episode System Trace buffer only");
});

test("every manual caption track covers its complete assembled programme", () => {
  const series = readJson(SERIES_PATH);

  for (const episode of series.episodes) {
    const projectDir = path.join(REPO_ROOT, episode.project_dir);
    const index = fs.readFileSync(path.join(projectDir, "index.html"), "utf8");
    const durationMatch = index.match(/<div\b[^>]*\bid="root"[^>]*\bdata-duration="([0-9.]+)"/);
    assert.ok(durationMatch, `${episode.story_id}: assembled programme duration is required`);
    assert.equal(
      srtLastEndSeconds(path.join(projectDir, "captions.srt")),
      Number(durationMatch[1]),
      `${episode.story_id}: captions must cover the exact programme end`,
    );
  }
});
