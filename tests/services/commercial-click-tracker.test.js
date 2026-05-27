"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildAffiliateLinkManifest,
  writeAffiliateLinkManifest,
} = require("../../lib/commercial-intelligence-engine");
const {
  findTrackedCommercialLink,
  recordCommercialClick,
  resolveCommercialRedirect,
} = require("../../lib/commercial-click-tracker");

test("server exposes the commercial redirect route without a broad static mount", async () => {
  const serverSource = await fs.readFile(
    path.join(__dirname, "..", "..", "server.js"),
    "utf8",
  );

  assert.match(serverSource, /app\.get\(\s*["']\/go\/:storyId\/:offerId["']/);
  assert.doesNotMatch(serverSource, /app\.use\(\s*["']\/go["']\s*,\s*express\.static/);
});

test("commercial click tracker resolves only manifest-owned affiliate links", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-clicks-"));
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "forza-commercial",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      full_script: "Forza players are comparing racing wheel and Xbox controller setups.",
    },
    tag: "pulsegaming-21",
  });
  await writeAffiliateLinkManifest(manifest, { outputDir: tmp });

  const found = await findTrackedCommercialLink({
    storyId: "forza-commercial",
    offerId: manifest.primary_link.id,
    manifestDirs: [tmp],
  });

  assert.equal(found.link.id, manifest.primary_link.id);
  assert.match(found.link.url, /amazon\.co\.uk/);

  const missing = await findTrackedCommercialLink({
    storyId: "forza-commercial",
    offerId: "not-real",
    manifestDirs: [tmp],
  });
  assert.equal(missing, null);
});

test("commercial click tracker records click events without personal identifiers", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-click-log-"));
  const logPath = path.join(tmp, "clicks.jsonl");

  const entry = await recordCommercialClick({
    storyId: "forza-commercial",
    offerId: "racing-wheel",
    platform: "youtube",
    ctaVariant: "story_page",
    videoId: "yt123",
    outputPath: logPath,
    now: new Date("2026-05-19T10:00:00.000Z"),
    referrer: "https://pulse.orryy.com/p/forza",
    userAgent: "UnitTestBrowser",
  });

  const raw = await fs.readFile(logPath, "utf8");
  const parsed = JSON.parse(raw.trim());

  assert.equal(entry.story_id, "forza-commercial");
  assert.equal(parsed.platform, "youtube");
  assert.equal(parsed.video_id, "yt123");
  assert.equal(parsed.user_agent_hash.length, 16);
  assert.equal(parsed.referrer_host, "pulse.orryy.com");
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "ip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "userAgent"), false);
});

test("commercial redirect resolves, logs and returns the safe target URL", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-redirect-"));
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "steam-deck-oled",
      title: "Steam Deck OLED deal gets a useful storage catch",
      full_script: "Steam Deck OLED storage and microSD choices are the practical part.",
    },
    tag: "pulsegaming-21",
  });
  await writeAffiliateLinkManifest(manifest, { outputDir: tmp });

  const resolved = await resolveCommercialRedirect({
    storyId: "steam-deck-oled",
    offerId: manifest.primary_link.id,
    manifestDirs: [tmp],
    clickLogPath: path.join(tmp, "clicks.jsonl"),
    query: { platform: "youtube", cta: "story_page", video_id: "yt123" },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.status, 302);
  assert.match(resolved.url, /amazon\.co\.uk/);
  assert.equal(resolved.click.story_id, "steam-deck-oled");
});
