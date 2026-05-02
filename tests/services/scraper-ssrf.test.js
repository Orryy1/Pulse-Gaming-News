"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

test("scrapeImagesForStory does not record an output path when unsafe image download is rejected", async () => {
  const prev = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-scraper-"));
  try {
    process.chdir(tmp);
    delete require.cache[require.resolve("../../scraper")];
    const scraper = require("../../scraper");
    const images = await scraper.scrapeImagesForStory({
      id: "unsafe",
      reddit_images: ["http://169.254.169.254/latest/meta-data"],
    });
    assert.deepEqual(images, []);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
    delete require.cache[require.resolve("../../scraper")];
  }
});
