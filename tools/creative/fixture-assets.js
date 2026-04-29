#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function fixtureAssetName(storyId, fixturePath) {
  const withoutScheme = String(fixturePath || "")
    .replace(/^fixture:\/\//, "")
    .replace(/\.(jpg|jpeg|png|webp)$/i, "");
  return `${storyId}_${withoutScheme.replace(/[^a-z0-9]+/gi, "_")}.jpg`;
}

function fixtureColour(image) {
  const blob = `${image?.source || ""} ${image?.type || ""} ${image?.path || ""}`.toLowerCase();
  if (/steam|key_art|capsule|hero/.test(blob)) return "#244d75";
  if (/trailer/.test(blob)) return "#273f50";
  if (/logo|platform/.test(blob)) return "#23303a";
  if (/pexels|unsplash|people|portrait|author|gravatar/.test(blob)) return "#4d3a3a";
  return "#313744";
}

async function materialiseFixtureStory(story, assetDir) {
  if (!assetDir) throw new Error("materialiseFixtureStory: assetDir required");
  const sharp = require("sharp");
  await fs.ensureDir(assetDir);
  const cloned = {
    ...story,
    downloaded_images: [],
  };

  for (const img of story.downloaded_images || []) {
    if (!String(img.path || "").startsWith("fixture://")) {
      cloned.downloaded_images.push(img);
      continue;
    }
    const outPath = path.join(assetDir, fixtureAssetName(story.id, img.path));
    if (!(await fs.pathExists(outPath))) {
      await sharp({
        create: {
          width: 900,
          height: 600,
          channels: 3,
          background: fixtureColour(img),
        },
      })
        .jpeg({ quality: 88 })
        .toFile(outPath);
    }
    cloned.downloaded_images.push({
      ...img,
      path: outPath,
      original_fixture_path: img.path,
    });
  }
  return cloned;
}

module.exports = {
  fixtureAssetName,
  fixtureColour,
  materialiseFixtureStory,
};
