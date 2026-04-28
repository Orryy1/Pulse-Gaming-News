"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const mediaPaths = require("./media-paths");
const brand = require("../brand");
const {
  selectThumbnailSubjectImage,
  runThumbnailPreUploadQa,
} = require("./thumbnail-safety");

const DEFAULT_OUTPUT_DIR = path.join("output", "thumbnails");

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapWords(text, maxChars, maxLines) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function headlineForStory(story) {
  return String(
    story?.suggested_thumbnail_text || story?.suggested_title || story?.title || "PULSE GAMING",
  )
    .replace(/\s+[-:|].*$/, "")
    .trim()
    .toUpperCase();
}

async function resolveSubjectCandidate(story, subjectImagePath) {
  if (subjectImagePath) {
    return {
      path: subjectImagePath,
      resolvedPath: subjectImagePath,
      safety: null,
    };
  }

  const images = Array.isArray(story?.downloaded_images)
    ? story.downloaded_images
    : [];
  const selected = selectThumbnailSubjectImage(story, images);
  if (!selected) return null;
  const stored = selected.image?.path;
  const resolved = stored ? await mediaPaths.resolveExisting(stored) : null;
  if (!resolved || !(await fs.pathExists(resolved))) return null;
  return {
    path: stored,
    resolvedPath: resolved,
    safety: selected,
  };
}

async function buildThumbnailCandidatePng({
  story,
  outPath,
  subjectImagePath,
} = {}) {
  if (!story || !story.id) {
    throw new Error("buildThumbnailCandidatePng: story.id required");
  }

  const sharp = require("sharp");
  const outRel =
    outPath || path.join(DEFAULT_OUTPUT_DIR, `${story.id}_thumbnail_candidate.png`);
  const outAbs = path.isAbsolute(outRel) ? outRel : mediaPaths.writePath(outRel);
  await fs.ensureDir(path.dirname(outAbs));

  const subject = await resolveSubjectCandidate(story, subjectImagePath);
  let heroData = "";
  if (subject?.resolvedPath) {
    const buf = await fs.readFile(subject.resolvedPath);
    const meta = await sharp(buf).metadata();
    const mime = meta.format === "png" ? "image/png" : "image/jpeg";
    heroData = `data:${mime};base64,${buf.toString("base64")}`;
  }

  const headline = headlineForStory(story);
  const lines = wrapWords(headline, 13, 4);
  const titleTspans = lines
    .map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : 92}">${escapeXml(line)}</tspan>`)
    .join("");
  const source = escapeXml(
    story.subreddit ? `r/${story.subreddit}` : story.source_type || "GAMING NEWS",
  ).toUpperCase();
  const flair = escapeXml(story.flair || story.classification || "NEWS").toUpperCase();

  const hero = heroData
    ? `
  <image href="${heroData}" x="-180" y="0" width="1440" height="1920" preserveAspectRatio="xMidYMid slice" opacity="0.34" filter="url(#blur)"/>
  <rect x="70" y="205" width="940" height="690" rx="28" fill="#09090b" opacity="0.9"/>
  <image href="${heroData}" x="70" y="205" width="940" height="690" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
  <rect x="70" y="205" width="940" height="690" rx="28" fill="none" stroke="${brand.PRIMARY}" stroke-width="4" opacity="0.75"/>
`
    : `
  <rect x="70" y="205" width="940" height="690" rx="28" fill="#14161b" opacity="0.96"/>
  <rect x="70" y="205" width="940" height="690" rx="28" fill="none" stroke="${brand.PRIMARY}" stroke-width="4" opacity="0.65"/>
  <text x="540" y="570" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="900" fill="${brand.PRIMARY}" letter-spacing="3">PULSE GAMING</text>
`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0c0d12"/>
      <stop offset="54%" stop-color="#111318"/>
      <stop offset="100%" stop-color="#050506"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="75%" stop-color="#050506"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="24"/></filter>
    <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.85"/></filter>
    <clipPath id="heroClip"><rect x="70" y="205" width="940" height="690" rx="28"/></clipPath>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  ${hero}
  <rect x="0" y="660" width="1080" height="520" fill="url(#fade)"/>
  <rect x="70" y="965" width="270" height="58" rx="29" fill="${brand.PRIMARY}" opacity="0.96"/>
  <text x="205" y="1003" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="900" fill="#fff" letter-spacing="2">${flair}</text>
  <text x="70" y="1115" font-family="Inter,Arial,sans-serif" font-size="84" font-weight="950" fill="#fff" filter="url(#shadow)">${titleTspans}</text>
  <rect x="70" y="1502" width="390" height="8" rx="4" fill="${brand.PRIMARY}"/>
  <text x="70" y="1585" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" fill="${brand.PRIMARY}" letter-spacing="5">PULSE GAMING</text>
  <text x="70" y="1632" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="650" fill="#cfd2dc" letter-spacing="2">${source}</text>
</svg>`;

  await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(outAbs);

  const qa = await runThumbnailPreUploadQa(
    { ...story, thumbnail_candidate_path: outAbs },
    {
      selectedImage: subject?.safety?.image || null,
      selectedPath: outAbs,
    },
  );

  return {
    path: outAbs,
    relativePath: path.isAbsolute(outRel) ? outAbs : outRel,
    subject,
    qa,
  };
}

async function buildThumbnailContactSheet({ images = [], outPath } = {}) {
  if (!outPath) throw new Error("buildThumbnailContactSheet: outPath required");
  const sharp = require("sharp");
  const cells = [];
  for (const imgPath of images.filter(Boolean)) {
    if (!(await fs.pathExists(imgPath))) continue;
    const buf = await sharp(imgPath)
      .resize(270, 480, { fit: "cover" })
      .png()
      .toBuffer();
    cells.push({ input: buf });
  }
  if (cells.length === 0) return null;
  const width = 270 * Math.min(4, cells.length);
  const rows = Math.ceil(cells.length / 4);
  const height = 480 * rows;
  const composite = cells.map((cell, i) => ({
    input: cell.input,
    left: (i % 4) * 270,
    top: Math.floor(i / 4) * 480,
  }));
  await fs.ensureDir(path.dirname(outPath));
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#050506",
    },
  })
    .composite(composite)
    .jpeg({ quality: 90 })
    .toFile(outPath);
  return outPath;
}

module.exports = {
  buildThumbnailCandidatePng,
  buildThumbnailContactSheet,
  headlineForStory,
};
