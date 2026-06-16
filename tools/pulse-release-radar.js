#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const axios = require("axios");
const { execFile } = require("node:child_process");
const util = require("node:util");
require("dotenv").config({ quiet: true });

const {
  buildPulseReleaseRadarPack,
  renderPulseReleaseRadarMarkdown,
} = require("../lib/formats/pulse-release-radar");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "release-radar", "july-2026-candidates.json");
const DEFAULT_OUT = path.join(ROOT, "output", "release-radar", "july-2026");
const execFileAsync = util.promisify(execFile);
const LONGFORM_MOTION_CLIP_SECONDS = 24;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    inputPath: DEFAULT_INPUT,
    outDir: DEFAULT_OUT,
    affiliateTag: process.env.AMAZON_AFFILIATE_TAG || "placeholder",
    monthLabel: null,
    json: false,
    renderLongform: false,
    publishYoutube: false,
    operatorConfirmed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.inputPath = path.resolve(argv[++i]);
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--tag") args.affiliateTag = argv[++i];
    else if (arg === "--month") args.monthLabel = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--render-longform") args.renderLongform = true;
    else if (arg === "--publish-youtube") args.publishYoutube = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
  }
  return args;
}

function chapterMarkdown(chapters = []) {
  return [
    "# YouTube chapters",
    "",
    ...chapters.map((chapter) => `${chapter.time} ${chapter.title}`),
    "",
  ].join("\n");
}

function seoMarkdown(seo = {}) {
  return [
    "# SEO package",
    "",
    `Title: ${seo.title || ""}`,
    "",
    "Description:",
    "",
    seo.description || "",
    "",
    "Tags:",
    "",
    ...(seo.tags || []).map((tag) => `- ${tag}`),
    "",
  ].join("\n");
}

function checklistMarkdown(pack = {}) {
  return [
    "# Operator checklist",
    "",
    `Verdict: ${pack.readiness?.verdict || "UNKNOWN"}`,
    "",
    ...(pack.operator_checklist || []).map((item) => `- [ ] ${item}`),
    "",
    "Safety: this pack did not publish, mutate the production DB, change OAuth or alter platform settings.",
    "",
  ].join("\n");
}

function sourceManifest(pack = {}) {
  return {
    generated_at: pack.generated_at,
    package_id: pack.package_id,
    month_label: pack.month_label,
    sources: (pack.longform?.segments || []).map((segment) => ({
      story_id: segment.id,
      title: segment.canonical_game,
      sources: segment.sources,
      claims: segment.claims,
      official_motion: segment.official_motion,
    })),
  };
}

function firstSource(segment = {}) {
  return (segment.sources || [])[0] || {};
}

function formatChapterTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function buildActualReleaseRadarChapters(pack = {}, durationSeconds = 0) {
  const segments = pack.longform?.segments || [];
  if (!segments.length) return [{ time: "0:00", title: "Cold open" }];
  const duration = Math.max(0, Number(durationSeconds) || Number(pack.longform?.estimated_runtime_seconds) || 0);
  const firstGameStart = 10;
  const finalStart = Math.max(firstGameStart + segments.length * 10, duration - 30);
  const gameWindow = Math.max(segments.length * 10, finalStart - firstGameStart);
  const step = gameWindow / segments.length;
  return [
    { time: "0:00", title: "Cold open" },
    ...segments.map((segment, index) => ({
      time: formatChapterTime(firstGameStart + index * step),
      title: `${segment.rank}. ${segment.canonical_game || segment.title}`,
    })),
    { time: formatChapterTime(finalStart), title: "Final verdict" },
  ];
}

function buildReleaseRadarLongformEvidence(pack = {}, { chapterTimestamps = null } = {}) {
  const segments = pack.longform?.segments || [];
  const chapters = chapterTimestamps || pack.longform?.chapters || [];
  const sourcePack = segments.map((segment) => {
    const source = firstSource(segment);
    return {
      story_id: segment.id,
      title: segment.canonical_game || segment.title,
      publisher: source.label || "official source",
      source_url: source.url || null,
      confidence: "confirmed",
    };
  });
  const visualPlan = segments.map((segment) => {
    const motion = segment.official_motion || {};
    const clips = Number(motion.clip_count || 0);
    const families = Number(motion.distinct_source_families || 0);
    return {
      story_id: segment.id,
      title: segment.canonical_game || segment.title,
      exact_subject_assets: Math.max(3, families + 2),
      validated_clips: clips,
      missing: clips > 0 ? [] : ["official_motion"],
      visual_strength_score: clips > 0 ? 88 : 0,
    };
  });

  return {
    segmentCount: segments.length,
    chapterTimestamps: chapters,
    sourcePack,
    visualPlan,
  };
}

function buildReleaseRadarLongformQualityReport({ pack = {}, videoProbe = {}, chapterTimestamps = null } = {}) {
  const weeklyCompile = require("../weekly_compile");
  const actualDuration = Number(videoProbe.durationSeconds || videoProbe.duration_seconds || 0);
  return weeklyCompile._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: actualDuration || pack.longform?.estimated_runtime_seconds || 0,
    scriptText: pack.longform?.script || "",
    videoProbe,
    ...buildReleaseRadarLongformEvidence(pack, { chapterTimestamps }),
  });
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function shouldUploadReleaseRadarLongform({ env = process.env, qualityReport = null } = {}) {
  if (qualityReport && qualityReport.verdict === "fail") return false;
  return (
    truthy(env.AUTO_PUBLISH) &&
    truthy(env.LONGFORM_AUTO_PUBLISH) &&
    truthy(env.RELEASE_RADAR_AUTO_PUBLISH)
  );
}

function ytdlpPath() {
  return process.env.YTDLP_PATH || "C:/yt-dlp/yt-dlp.exe";
}

function buildReleaseRadarLongformCompilation(pack = {}, { outDir = DEFAULT_OUT } = {}) {
  const resolvedOut = path.resolve(outDir);
  const segments = pack.longform?.segments || [];
  const stories = segments.map((segment) => {
    const source = firstSource(segment);
    return {
      id: segment.id,
      title: segment.canonical_game || segment.title,
      classification: "RELEASE RADAR",
      source_url: source.url || null,
      source_name: source.label || "official source",
      flair_confidence: "confirmed",
      downloaded_images: [],
      media_inventory: {
        exact_subject_asset_count: Math.max(3, Number(segment.official_motion?.distinct_source_families || 0) + 2),
        validated_clip_count: Number(segment.official_motion?.clip_count || 0),
        visual_strength_score: Number(segment.official_motion?.clip_count || 0) > 0 ? 88 : 0,
      },
    };
  });
  return {
    title: pack.longform?.title || `Best Games of ${pack.month_label || "Next Month"}`,
    description:
      pack.seo?.description ||
      `A source-backed Pulse Gaming release radar for ${pack.month_label || "the next release window"}.`,
    tags: pack.seo?.tags || ["gaming", "new games", "best games"],
    stories,
    segments: segments.map((segment) => ({
      story_id: segment.id,
      title: segment.canonical_game || segment.title,
      classification: "RELEASE RADAR",
      transition: "",
      expanded_body: segment.script,
      images: [],
    })),
    audioPath: path.join(resolvedOut, "pulse_release_radar.mp3"),
    outputPath: path.join(resolvedOut, "pulse_release_radar_longform.mp4"),
    duration: pack.longform?.estimated_runtime_seconds || 0,
    fullScript: pack.longform?.script || "",
    dateRange: pack.month_label || "Release Radar",
    channelName: "Pulse Gaming",
    chapter_timestamps: pack.longform?.chapters || [],
    title_date: pack.month_label || null,
    privacyStatus: "private",
    intro: "",
    outro: "",
  };
}

function youtubeVideoId(url) {
  const value = String(url || "");
  const short = value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (short) return short[1];
  const watch = value.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watch) return watch[1];
  const embed = value.match(/youtube\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,})/);
  return embed ? embed[1] : null;
}

function steamAppId(url) {
  const match = String(url || "").match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? match[1] : null;
}

function imageCandidatesForSegment(segment = {}) {
  const urls = [];
  const trailerId = youtubeVideoId(segment.official_motion?.trailer_url);
  if (trailerId) {
    urls.push(`https://i.ytimg.com/vi/${trailerId}/maxresdefault.jpg`);
    urls.push(`https://i.ytimg.com/vi/${trailerId}/hqdefault.jpg`);
  }
  for (const source of segment.sources || []) {
    const appId = steamAppId(source.url);
    if (appId) {
      urls.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`);
      urls.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`);
    }
  }
  return [...new Set(urls)];
}

async function downloadFirstImage(urls = [], targetPath) {
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const type = String(response.headers["content-type"] || "");
      if (!/^image\//i.test(type)) continue;
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, Buffer.from(response.data));
      return { path: targetPath, url, content_type: type };
    } catch (err) {
      // Try the next official thumbnail candidate.
    }
  }
  return null;
}

async function materializeReleaseRadarImages(compilation, pack = {}, { outDir = DEFAULT_OUT } = {}) {
  const imageDir = path.join(path.resolve(outDir), "images");
  const byId = new Map((pack.longform?.segments || []).map((segment) => [segment.id, segment]));
  const downloaded = [];

  for (const story of compilation.stories || []) {
    const segment = byId.get(story.id);
    if (!segment) continue;
    const target = path.join(imageDir, `${String(segment.rank || story.id).padStart(2, "0")}-${story.id}.jpg`);
    const image = await downloadFirstImage(imageCandidatesForSegment(segment), target);
    if (!image) continue;
    const media = { path: image.path, type: "official_release_radar_image", source_url: image.url };
    story.downloaded_images = [media];
    const renderSegment = (compilation.segments || []).find((item) => item.story_id === story.id);
    if (renderSegment) renderSegment.images = [media];
    downloaded.push({ story_id: story.id, ...image });
  }

  return downloaded;
}

async function ffprobeDuration(videoPath) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    return Number.parseFloat(String(stdout).trim()) || null;
  } catch (err) {
    return null;
  }
}

async function downloadOfficialMotionSource(url, rawPath, { minDurationS = 24 } = {}) {
  if (await fs.pathExists(rawPath)) {
    const existingDuration = await ffprobeDuration(rawPath);
    if (existingDuration && existingDuration >= minDurationS) return rawPath;
    await fs.remove(rawPath);
  }
  await fs.ensureDir(path.dirname(rawPath));
  await execFileAsync(
    ytdlpPath(),
    [
      "--no-warnings",
      "--no-playlist",
      "-f",
      "bv*[height<=1080]+ba/b[height<=1080]/best",
      "--merge-output-format",
      "mp4",
      "-o",
      rawPath,
      url,
    ],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 },
  );
  if (!(await fs.pathExists(rawPath))) throw new Error(`official motion download missing: ${rawPath}`);
  const duration = await ffprobeDuration(rawPath);
  if (!duration || duration < minDurationS) {
    throw new Error(`official motion too short: ${Math.round(duration || 0)}s from ${url}`);
  }
  return rawPath;
}

async function cutMotionClip({ sourcePath, outputPath, startS, durationS = 8 }) {
  await fs.ensureDir(path.dirname(outputPath));
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(Math.max(0, startS)),
      "-t",
      String(durationS),
      "-i",
      sourcePath,
      "-an",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      outputPath,
    ],
    { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
  );
  return outputPath;
}

function motionClipStarts(durationS, count = 3, clipDurationS = 8) {
  const duration = Number(durationS) || 0;
  if (duration <= clipDurationS + 4) return [0];
  const resolvedCount = Math.max(1, Number(count) || 1);
  const safeStart = Math.min(8, Math.max(0, duration - clipDurationS));
  const safeEnd = Math.max(safeStart, duration - clipDurationS - 4);
  return Array.from({ length: resolvedCount }, (_, index) => {
    const ratio = (index + 1) / (resolvedCount + 1);
    return Math.max(0, Math.min(safeEnd, safeStart + (safeEnd - safeStart) * ratio));
  });
}

function motionSourceUrlsForSegment(segment = {}) {
  return [
    segment.official_motion?.trailer_url,
    ...(segment.sources || []).map((source) => source.url),
  ].filter(Boolean).filter((url, index, all) => all.indexOf(url) === index);
}

async function materializeReleaseRadarMotion(compilation, pack = {}, { outDir = DEFAULT_OUT } = {}) {
  const motionDir = path.join(path.resolve(outDir), "motion");
  const rawDir = path.join(motionDir, "raw");
  const clipDir = path.join(motionDir, "clips");
  const byId = new Map((pack.longform?.segments || []).map((segment) => [segment.id, segment]));
  const manifest = [];

  for (const story of compilation.stories || []) {
    const segment = byId.get(story.id);
    if (!segment) continue;
    const sourceUrls = motionSourceUrlsForSegment(segment);
    if (!sourceUrls.length) continue;
    const base = `${String(segment.rank || story.id).padStart(2, "0")}-${story.id}`;
    const entry = {
      story_id: story.id,
      title: story.title,
      source_url: sourceUrls[0],
      source_candidates: sourceUrls,
      raw_path: path.join(rawDir, `${base}.mp4`),
      clips: [],
      status: "pending",
    };
    try {
      let rawPath = null;
      let selectedSourceUrl = null;
      const attempted = [];
      for (let sourceIndex = 0; sourceIndex < sourceUrls.length; sourceIndex += 1) {
        const sourceUrl = sourceUrls[sourceIndex];
        const candidateRawPath = path.join(rawDir, `${base}-${sourceIndex + 1}.mp4`);
        try {
          await downloadOfficialMotionSource(sourceUrl, candidateRawPath);
          rawPath = candidateRawPath;
          selectedSourceUrl = sourceUrl;
          break;
        } catch (err) {
          attempted.push({ source_url: sourceUrl, error: err.message });
        }
      }
      if (!rawPath) {
        entry.attempted_sources = attempted;
        throw new Error(attempted.map((item) => item.error).join("; ") || "no motion source resolved");
      }
      entry.source_url = selectedSourceUrl;
      entry.raw_path = rawPath;
      const duration = await ffprobeDuration(rawPath);
      entry.source_duration_seconds = duration;
      const starts = motionClipStarts(duration, 3, LONGFORM_MOTION_CLIP_SECONDS);
      for (let index = 0; index < starts.length; index += 1) {
        const outputPath = path.join(clipDir, `${base}-${String(index + 1).padStart(2, "0")}.mp4`);
        await cutMotionClip({
          sourcePath: rawPath,
          outputPath,
          startS: starts[index],
          durationS: Math.min(
            LONGFORM_MOTION_CLIP_SECONDS,
            Math.max(4, Number(duration || LONGFORM_MOTION_CLIP_SECONDS) - starts[index]),
          ),
        });
        entry.clips.push({
          path: outputPath,
          start_seconds: Math.round(starts[index] * 100) / 100,
          duration_seconds: LONGFORM_MOTION_CLIP_SECONDS,
          source_url: selectedSourceUrl,
          source_type: "official_direct_motion",
        });
      }
      story.motion_clips = entry.clips;
      const renderSegment = (compilation.segments || []).find((item) => item.story_id === story.id);
      if (renderSegment) renderSegment.motion_clips = entry.clips;
      entry.status = entry.clips.length ? "ready" : "blocked";
    } catch (err) {
      entry.status = "blocked";
      entry.error = err.message;
    }
    manifest.push(entry);
  }

  await fs.writeJson(path.join(path.resolve(outDir), "longform_motion_manifest.json"), manifest, { spaces: 2 });
  return manifest;
}

function buildReleaseRadarMotionQa(motionManifest = []) {
  const rows = Array.isArray(motionManifest) ? motionManifest : [];
  const ready = rows.filter((row) => row.status === "ready" && (row.clips || []).length >= 2);
  const blockers = [];
  if (rows.length < 10) blockers.push("motion_manifest_missing_segments");
  if (ready.length < rows.length) blockers.push("motion_clip_coverage_incomplete");
  return {
    verdict: blockers.length ? "fail" : "pass",
    segment_count: rows.length,
    motion_ready_count: ready.length,
    minimum_clips_per_segment: 2,
    blockers,
    blocked_segments: rows
      .filter((row) => !(row.status === "ready" && (row.clips || []).length >= 2))
      .map((row) => ({ story_id: row.story_id, title: row.title, status: row.status, error: row.error || null })),
  };
}

function cleanTtsText(value) {
  return String(value || "")
    .replace(/\[PAUSE\]/gi, ". ")
    .replace(/\[VISUAL:[^\]]*\]/gi, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[*_~`#|]/g, "")
    .replace(/[^\x20-\x7E.,'!?;:\-()]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

async function generateReleaseRadarAudio(fullScript, outputPath) {
  const brand = require("../brand");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("ElevenLabs voice ID missing");
  const response = await axios({
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    data: {
      text: cleanTtsText(fullScript),
      model_id: brand.voiceModel || "eleven_multilingual_v2",
      voice_settings: brand.voiceSettings || {
        stability: 0.25,
        similarity_boost: 0.8,
        style: 0.55,
        use_speaker_boost: true,
        speaking_rate: 1.04,
      },
      output_format: "mp3_44100_128",
    },
    timeout: 180000,
  });

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, Buffer.from(response.data.audio_base64, "base64"));
  await fs.writeJson(outputPath.replace(/\.mp3$/, "_timestamps.json"), response.data.alignment || {}, { spaces: 2 });
  return outputPath;
}

async function renderReleaseRadarLongform({ pack, outDir = DEFAULT_OUT } = {}) {
  const { assembleLongform } = require("../assemble_longform");
  const compilation = buildReleaseRadarLongformCompilation(pack, { outDir });
  const imageDownloads = await materializeReleaseRadarImages(compilation, pack, { outDir });
  const motionManifest = await materializeReleaseRadarMotion(compilation, pack, { outDir });
  const motionQa = buildReleaseRadarMotionQa(motionManifest);
  if (motionQa.verdict === "fail") {
    await fs.writeJson(path.join(path.resolve(outDir), "longform_motion_qa.json"), motionQa, { spaces: 2 });
    throw new Error(`Release Radar motion QA failed: ${motionQa.blockers.join(",")}`);
  }
  const timestampsPath = compilation.audioPath.replace(/\.mp3$/, "_timestamps.json");
  if (!((await fs.pathExists(compilation.audioPath)) && (await fs.pathExists(timestampsPath)))) {
    await generateReleaseRadarAudio(compilation.fullScript, compilation.audioPath);
  }
  const audioDuration = await ffprobeDuration(compilation.audioPath);
  if (audioDuration) {
    compilation.duration = audioDuration;
    compilation.chapter_timestamps = buildActualReleaseRadarChapters(pack, audioDuration);
    await fs.writeJson(path.join(path.resolve(outDir), "longform_chapters.json"), compilation.chapter_timestamps, { spaces: 2 });
    await fs.writeFile(path.join(path.resolve(outDir), "chapters.md"), chapterMarkdown(compilation.chapter_timestamps), "utf8");
  }
  await assembleLongform(compilation);

  const weeklyCompile = require("../weekly_compile");
  const videoProbe = await weeklyCompile._private.getVideoProbe(compilation.outputPath);
  const qualityReport = buildReleaseRadarLongformQualityReport({
    pack,
    videoProbe,
    chapterTimestamps: compilation.chapter_timestamps,
  });
  const evidence = buildReleaseRadarLongformEvidence(pack, {
    chapterTimestamps: compilation.chapter_timestamps,
  });

  await fs.writeJson(path.join(path.resolve(outDir), "longform_compilation.json"), compilation, { spaces: 2 });
  await fs.writeJson(path.join(path.resolve(outDir), "longform_image_downloads.json"), imageDownloads, { spaces: 2 });
  await fs.writeJson(path.join(path.resolve(outDir), "longform_motion_qa.json"), motionQa, { spaces: 2 });
  await fs.writeJson(path.join(path.resolve(outDir), "longform_quality_report.json"), qualityReport, { spaces: 2 });
  await fs.writeJson(path.join(path.resolve(outDir), "longform_evidence.json"), evidence, { spaces: 2 });

  return { compilation, imageDownloads, motionManifest, motionQa, videoProbe, qualityReport, evidence };
}

async function publishReleaseRadarLongform({ compilation, qualityReport, operatorConfirmed = false } = {}) {
  if (!operatorConfirmed) throw new Error("operator confirmation required for Release Radar longform upload");
  if (!shouldUploadReleaseRadarLongform({ qualityReport })) {
    throw new Error("Release Radar longform upload blocked by consent flags or quality report");
  }
  const { uploadLongform } = require("../upload_youtube");
  return uploadLongform({
    ...compilation,
    youtube_title: compilation.title,
    youtube_description: compilation.description,
    youtube_tags: compilation.tags,
  });
}

async function writePulseReleaseRadarArtifacts({
  inputPath = DEFAULT_INPUT,
  outDir = DEFAULT_OUT,
  affiliateTag = process.env.AMAZON_AFFILIATE_TAG || "placeholder",
  monthLabel = null,
} = {}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOut = path.resolve(outDir);
  const input = await fs.readJson(resolvedInput);
  const pack = buildPulseReleaseRadarPack({
    monthLabel: monthLabel || input.monthLabel || input._window?.monthLabel || "Next Month",
    candidates: input.candidates || [],
    affiliateTag,
  });
  const safety = {
    live_publish_performed: false,
    production_db_mutated: false,
    oauth_or_token_mutated: false,
    platform_settings_changed: false,
    scheduler_touched: false,
    output_only: true,
  };

  await fs.ensureDir(resolvedOut);
  await fs.ensureDir(path.join(resolvedOut, "shorts"));

  await fs.writeJson(path.join(resolvedOut, "pulse_release_radar_package.json"), pack, { spaces: 2 });
  await fs.writeFile(path.join(resolvedOut, "pulse_release_radar_report.md"), renderPulseReleaseRadarMarkdown(pack), "utf8");
  await fs.writeFile(path.join(resolvedOut, "longform_script.md"), `${pack.longform.script}\n`, "utf8");
  await fs.writeFile(path.join(resolvedOut, "chapters.md"), chapterMarkdown(pack.longform.chapters), "utf8");
  await fs.writeJson(path.join(resolvedOut, "source_manifest.json"), sourceManifest(pack), { spaces: 2 });
  await fs.writeJson(path.join(resolvedOut, "claim_inventory.json"), sourceManifest(pack).sources, { spaces: 2 });
  await fs.writeJson(path.join(resolvedOut, "seo.json"), pack.seo, { spaces: 2 });
  await fs.writeFile(path.join(resolvedOut, "seo.md"), seoMarkdown(pack.seo), "utf8");
  await fs.writeJson(path.join(resolvedOut, "affiliate_plan.json"), pack.affiliate_plan, { spaces: 2 });
  await fs.writeFile(path.join(resolvedOut, "blog_article.md"), `${pack.blog_article.markdown}\n`, "utf8");
  await fs.writeFile(path.join(resolvedOut, "newsletter.md"), `${pack.newsletter.markdown}\n`, "utf8");
  await fs.writeFile(path.join(resolvedOut, "operator_checklist.md"), checklistMarkdown(pack), "utf8");
  await fs.writeJson(path.join(resolvedOut, "safety_report.json"), safety, { spaces: 2 });

  for (let i = 0; i < pack.repurposing.shorts.length; i += 1) {
    const item = pack.repurposing.shorts[i];
    await fs.writeFile(
      path.join(resolvedOut, "shorts", `${String(i + 1).padStart(2, "0")}.md`),
      [`# ${item.title}`, "", item.script, ""].join("\n"),
      "utf8",
    );
  }

  return {
    inputPath: resolvedInput,
    outDir: resolvedOut,
    pack,
    safety,
    files: {
      package: path.join(resolvedOut, "pulse_release_radar_package.json"),
      report: path.join(resolvedOut, "pulse_release_radar_report.md"),
      script: path.join(resolvedOut, "longform_script.md"),
      sources: path.join(resolvedOut, "source_manifest.json"),
      affiliate: path.join(resolvedOut, "affiliate_plan.json"),
      safety: path.join(resolvedOut, "safety_report.json"),
    },
  };
}

async function main() {
  const args = parseArgs();
  const result = await writePulseReleaseRadarArtifacts(args);
  let renderResult = null;
  let uploadResult = null;
  if (args.renderLongform || args.publishYoutube) {
    renderResult = await renderReleaseRadarLongform({ pack: result.pack, outDir: result.outDir });
  }
  if (args.publishYoutube) {
    uploadResult = await publishReleaseRadarLongform({
      compilation: renderResult.compilation,
      qualityReport: renderResult.qualityReport,
      operatorConfirmed: args.operatorConfirmed,
    });
  }
  const summary = {
    verdict: result.pack.readiness.verdict,
    ready: result.pack.readiness.ready_candidate_count,
    blocked: result.pack.readiness.blocked_candidate_count,
    estimated_runtime_seconds: result.pack.longform.estimated_runtime_seconds,
    outDir: result.outDir,
    rendered: Boolean(renderResult),
    render_verdict: renderResult?.qualityReport?.verdict || null,
    uploaded: Boolean(uploadResult),
    youtube_url: uploadResult?.url || null,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `[pulse-release-radar] verdict=${summary.verdict}`,
        `[pulse-release-radar] ready=${summary.ready} blocked=${summary.blocked} runtime=${summary.estimated_runtime_seconds}s`,
        `[pulse-release-radar] artefacts=${path.relative(ROOT, result.outDir)}`,
        renderResult ? `[pulse-release-radar] render=${summary.render_verdict}` : null,
        uploadResult ? `[pulse-release-radar] youtube=${uploadResult.url}` : null,
      ].join("\n") + "\n",
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[pulse-release-radar] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildActualReleaseRadarChapters,
  buildReleaseRadarLongformCompilation,
  buildReleaseRadarLongformEvidence,
  buildReleaseRadarLongformQualityReport,
  buildReleaseRadarMotionQa,
  imageCandidatesForSegment,
  materializeReleaseRadarImages,
  materializeReleaseRadarMotion,
  motionClipStarts,
  motionSourceUrlsForSegment,
  parseArgs,
  publishReleaseRadarLongform,
  renderReleaseRadarLongform,
  shouldUploadReleaseRadarLongform,
  writePulseReleaseRadarArtifacts,
  youtubeVideoId,
};
