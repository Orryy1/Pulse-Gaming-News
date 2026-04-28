"use strict";

const fsExtra = require("fs-extra");
const mediaPaths = require("../media-paths");

const PATH_FIELDS = [
  "exported_path",
  "audio_path",
  "image_path",
  "story_image_path",
  "hf_thumbnail_path",
  "thumbnail_candidate_path",
];

async function inspectPath(storyId, field, storedPath, { fs = fsExtra } = {}) {
  const resolved = await mediaPaths.resolveExisting(storedPath, { fs });
  const exists = resolved ? await fs.pathExists(resolved) : false;
  let size = null;
  let issue = null;
  if (!exists) {
    issue = "missing";
  } else {
    try {
      const stat = await fs.stat(resolved);
      size = stat.size;
      if (size === 0) issue = "zero_byte";
      if (/\.mp4$/i.test(storedPath) && size < 200 * 1024) {
        issue = "tiny_mp4";
      }
    } catch (err) {
      issue = `stat_failed:${err.code || "unknown"}`;
    }
  }
  return { storyId, field, storedPath, resolved, exists, size, issue };
}

async function verifyMedia({ stories = [], fs = fsExtra } = {}) {
  const checks = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    for (const field of PATH_FIELDS) {
      if (story && story[field]) {
        checks.push(await inspectPath(story.id, field, story[field], { fs }));
      }
    }
    for (const img of Array.isArray(story?.downloaded_images)
      ? story.downloaded_images
      : []) {
      if (img?.path) {
        checks.push(await inspectPath(story.id, "downloaded_images.path", img.path, { fs }));
      }
    }
    for (const clip of Array.isArray(story?.video_clips) ? story.video_clips : []) {
      checks.push(await inspectPath(story.id, "video_clips", clip, { fs }));
    }
  }
  const issues = checks.filter((c) => c.issue);
  return {
    generatedAt: new Date().toISOString(),
    verdict: issues.some((i) => ["zero_byte", "tiny_mp4"].includes(i.issue))
      ? "fail"
      : issues.length
        ? "review"
        : "pass",
    storyCount: Array.isArray(stories) ? stories.length : 0,
    checked: checks.length,
    issueCount: issues.length,
    issues,
    checks: checks.slice(0, 200),
  };
}

function renderMediaVerifyMarkdown(report) {
  const lines = [
    "# Media Verify",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    `Stories: ${report.storyCount}`,
    `Paths checked: ${report.checked}`,
    `Issues: ${report.issueCount}`,
    "",
    "## Issues",
    ...(report.issues.length
      ? report.issues.map(
          (i) => `- ${i.storyId} ${i.field}: ${i.issue} (${i.storedPath})`,
        )
      : ["- none"]),
  ];
  return lines.join("\n") + "\n";
}

module.exports = { verifyMedia, renderMediaVerifyMarkdown, PATH_FIELDS };
