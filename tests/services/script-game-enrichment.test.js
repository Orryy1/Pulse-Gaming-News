"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const e = require("../../lib/script-game-enrichment");

// 2026-04-30 reported issue: "Take-Two Rejected A Sequel" video had
// repeated images and no gameplay footage even though the script
// mentioned GTA, Red Dead, BioShock, Civilization, Borderlands,
// Mafia, NBA 2K, Max Payne. Each one has rich Steam/IGDB imagery
// ready to download. These tests pin the dictionary extractor +
// per-title fetch contract.

// ── extractGameTitles: dictionary matching ────────────────────────

test("extractGameTitles: catches major Take-Two franchises", () => {
  const script =
    "Take-Two owns Rockstar Games (Grand Theft Auto, Red Dead Redemption, " +
    "Max Payne, L.A. Noire, Bully) and 2K (BioShock, Borderlands, " +
    "Civilization, NBA 2K, Mafia).";
  const out = e.extractGameTitles(script, { maxTitles: 20 });
  const names = out.map((t) => t.name);
  assert.ok(names.includes("Grand Theft Auto"));
  assert.ok(names.includes("Red Dead Redemption"));
  assert.ok(names.includes("Max Payne"));
  assert.ok(names.includes("BioShock"));
  assert.ok(names.includes("Borderlands"));
  assert.ok(names.includes("Civilization"));
  assert.ok(names.includes("NBA 2K"));
  assert.ok(names.includes("Mafia"));
});

test("extractGameTitles: more-specific match wins over generic franchise", () => {
  // "GTA VI" should beat "GTA" alone — the dictionary has both, the
  // most-specific should claim the span first.
  const script = "The reveal of GTA VI is imminent.";
  const out = e.extractGameTitles(script, { maxTitles: 5 });
  const names = out.map((t) => t.name);
  assert.ok(names.includes("Grand Theft Auto VI"));
  assert.ok(!names.includes("Grand Theft Auto"));
});

test("extractGameTitles: multiple franchises return in first-mention order", () => {
  const script =
    "After the success of Borderlands 3, fans wonder whether GTA 6 will land first or BioShock 4 returns.";
  const out = e.extractGameTitles(script, { maxTitles: 5 });
  const names = out.map((t) => t.name);
  // Borderlands appears first in the text
  assert.equal(names[0], "Borderlands 3");
});

test("extractGameTitles: respects maxTitles cap", () => {
  const script =
    "GTA, Red Dead, BioShock, Civilization, Borderlands, Mafia, NBA 2K, " +
    "Max Payne, Skyrim, Halo, Final Fantasy.";
  const out = e.extractGameTitles(script, { maxTitles: 3 });
  assert.equal(out.length, 3);
});

test("extractGameTitles: empty / null script → empty array", () => {
  assert.deepEqual(e.extractGameTitles(""), []);
  assert.deepEqual(e.extractGameTitles(null), []);
  assert.deepEqual(e.extractGameTitles(undefined), []);
});

test("extractGameTitles: irrelevant text returns no matches", () => {
  const script =
    "Today's news is about quarterly earnings and a new logistics deal.";
  const out = e.extractGameTitles(script);
  assert.deepEqual(out, []);
});

test("extractGameTitles: dedupes when same game mentioned multiple times", () => {
  const script =
    "GTA is a huge franchise. GTA continues to dominate. GTA fans wait.";
  const out = e.extractGameTitles(script);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Grand Theft Auto");
});

test("extractGameTitles: case-insensitive matching", () => {
  const script = "fans love grand theft auto and bioshock";
  const out = e.extractGameTitles(script);
  const names = out.map((t) => t.name);
  assert.ok(names.includes("Grand Theft Auto"));
  assert.ok(names.includes("BioShock"));
});

test("extractGameTitles: stamps publisher when known", () => {
  const script = "GTA is back and Skyrim returns.";
  const out = e.extractGameTitles(script);
  const gta = out.find((t) => t.name.startsWith("Grand Theft Auto"));
  const skyrim = out.find((t) => t.name.includes("Skyrim"));
  assert.equal(gta.publisher, "rockstar");
  assert.equal(skyrim.publisher, "bethesda");
});

test("extractGameTitles: handles unicode (Pokémon vs Pokemon)", () => {
  const a = e.extractGameTitles("Pokémon Scarlet sells well.");
  const b = e.extractGameTitles("Pokemon Scarlet sells well.");
  const aHas = a.some((t) => t.name.includes("Scarlet"));
  const bHas = b.some((t) => t.name.includes("Scarlet"));
  assert.equal(aHas, true);
  assert.equal(bHas, true);
});

// ── fetchImageUrlsForTitle (mocked HTTP) ──────────────────────────

function fakeHttp({
  steamItems = [],
  igdbResult = [],
  steamThrows = false,
  igdbThrows = false,
} = {}) {
  return {
    async get(url, opts) {
      if (steamThrows) throw new Error("steam down");
      if (url.includes("storesearch")) {
        return { data: { items: steamItems } };
      }
      return { data: {} };
    },
    async post() {
      throw new Error("not implemented");
    },
  };
}

function fakeIgdbModule({ result = [], shouldThrow = false } = {}) {
  return {
    async fetchIgdbImages(title) {
      if (shouldThrow) throw new Error("igdb down");
      return result;
    },
  };
}

test("fetchImageUrlsForTitle: Steam hit returns capsule + hero + key_art", async () => {
  const out = await e.fetchImageUrlsForTitle("Grand Theft Auto V", {
    http: fakeHttp({
      steamItems: [{ id: 271590, name: "Grand Theft Auto V" }],
    }),
    env: {},
    igdbModule: fakeIgdbModule(),
    max: 3,
  });
  assert.equal(out.length, 3);
  assert.equal(out[0].type, "capsule");
  assert.equal(out[0].source, "steam");
  assert.match(out[0].url, /library_600x900\.jpg$/);
  assert.equal(out[1].type, "hero");
  assert.match(out[1].url, /library_hero\.jpg$/);
  assert.equal(out[2].type, "key_art");
  assert.match(out[2].url, /header\.jpg$/);
});

test("fetchImageUrlsForTitle: respects max cap", async () => {
  const out = await e.fetchImageUrlsForTitle("GTA V", {
    http: fakeHttp({ steamItems: [{ id: 1, name: "X" }] }),
    env: {},
    igdbModule: fakeIgdbModule(),
    max: 1,
  });
  assert.equal(out.length, 1);
});

test("fetchImageUrlsForTitle: Steam miss + IGDB hit returns IGDB images only", async () => {
  const out = await e.fetchImageUrlsForTitle("Bloodborne", {
    http: fakeHttp({ steamItems: [] }),
    env: {
      TWITCH_CLIENT_ID: "x",
      TWITCH_CLIENT_SECRET: "y",
    },
    igdbModule: fakeIgdbModule({
      result: [
        {
          url: "https://images.igdb/upload/cover/x.jpg",
          type: "key_art",
          game_name: "Bloodborne",
        },
        {
          url: "https://images.igdb/upload/sc/x.jpg",
          type: "screenshot",
          game_name: "Bloodborne",
        },
      ],
    }),
    max: 3,
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].source, "igdb");
});

test("fetchImageUrlsForTitle: Steam miss + IGDB env unset → empty", async () => {
  const out = await e.fetchImageUrlsForTitle("Anything", {
    http: fakeHttp({ steamItems: [] }),
    env: {}, // TWITCH_* not set
    igdbModule: fakeIgdbModule(),
    max: 3,
  });
  assert.deepEqual(out, []);
});

test("fetchImageUrlsForTitle: Steam throws → still tries IGDB", async () => {
  const out = await e.fetchImageUrlsForTitle("Halo Infinite", {
    http: fakeHttp({ steamThrows: true }),
    env: {
      TWITCH_CLIENT_ID: "x",
      TWITCH_CLIENT_SECRET: "y",
    },
    igdbModule: fakeIgdbModule({
      result: [
        {
          url: "https://images.igdb/upload/cover/halo.jpg",
          type: "key_art",
          game_name: "Halo Infinite",
        },
      ],
    }),
    max: 3,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "igdb");
});

test("fetchImageUrlsForTitle: empty / non-string title → empty", async () => {
  assert.deepEqual(await e.fetchImageUrlsForTitle(""), []);
  assert.deepEqual(await e.fetchImageUrlsForTitle(null), []);
});

// ── enrichImagesFromScript (top-level) ────────────────────────────

test("enrichImagesFromScript: end-to-end on a Take-Two-style script", async () => {
  const story = {
    id: "test-1",
    full_script:
      "Take-Two owns Rockstar (GTA, Red Dead) and 2K (BioShock, Civilization).",
  };
  const out = await e.enrichImagesFromScript(story, {
    http: fakeHttp({ steamItems: [{ id: 1, name: "Test" }] }),
    env: {},
    igdbModule: fakeIgdbModule(),
    maxTitles: 4,
    maxPerTitle: 2,
  });
  assert.equal(out.titles.length, 4);
  // 4 titles × 2 per title (Steam capsule + hero) = 8 image urls
  assert.equal(out.image_urls.length, 8);
  // Each image carries the originating entity tag
  assert.ok(out.image_urls.every((i) => i._entity));
});

test("enrichImagesFromScript: no script → empty result", async () => {
  const out = await e.enrichImagesFromScript({ id: "x" });
  assert.deepEqual(out.titles, []);
  assert.deepEqual(out.image_urls, []);
});

test("enrichImagesFromScript: script with no game mentions → empty", async () => {
  const out = await e.enrichImagesFromScript({
    id: "x",
    full_script: "Quarterly earnings rose seven percent year over year.",
  });
  assert.deepEqual(out.titles, []);
});

test("enrichImagesFromScript: falls back to tts_script when full_script absent", async () => {
  const out = await e.enrichImagesFromScript(
    {
      id: "x",
      tts_script: "Skyrim is back, baby.",
    },
    {
      http: fakeHttp({ steamItems: [{ id: 72850, name: "Skyrim" }] }),
      env: {},
      igdbModule: fakeIgdbModule(),
    },
  );
  assert.ok(out.titles.length > 0);
});
