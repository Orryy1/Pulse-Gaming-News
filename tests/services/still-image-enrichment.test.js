"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  ALLOWED_STILL_SOURCE_TYPES,
  buildStillImageEnrichmentPlan,
  renderStillImageEnrichmentMarkdown,
  runStillImageEnrichment,
} = require("../../lib/still-image-enrichment");

function img(type, source = "steam", url = `https://cdn.example/${type}.jpg`, extra = {}) {
  return { type, source, url, path: extra.path, ...extra };
}

function baseStory(overrides = {}) {
  return {
    id: "still-story",
    title: "GTA 6 gets a new Xbox showcase update",
    url: "https://example.com/gta-6-xbox",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    hook: "GTA 6 just became the biggest Xbox story of the week.",
    body: "Rockstar and Xbox are the centre of the conversation.",
    full_script:
      "GTA 6 just became the biggest Xbox story of the week. Rockstar and Xbox are the centre of the conversation.",
    downloaded_images: [],
    video_clips: [],
    ...overrides,
  };
}

test("still enrichment accepts only allowed still image source types", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      game_images: [
        img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" }),
        img("igdb_cover", "igdb", "https://cdn.example/gta-cover.jpg", { entity: "GTA" }),
      ],
    }),
  );

  assert.ok(ALLOWED_STILL_SOURCE_TYPES.has("steam_header"));
  assert.ok(ALLOWED_STILL_SOURCE_TYPES.has("igdb_cover"));
  assert.equal(plan.would_fetch.length, 2);
  assert.deepEqual(
    plan.would_fetch.map((item) => item.source_type).sort(),
    ["igdb_cover", "steam_header"],
  );
});

test("still enrichment ignores trailer and video sources", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      game_images: [
        img("steam_trailer", "steam", "https://cdn.example/gta-trailer.mp4", {
          entity: "GTA",
        }),
        img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" }),
      ],
    }),
  );

  assert.equal(plan.would_fetch.some((item) => /trailer|video|movie/.test(item.source_type)), false);
  assert.ok(plan.would_reject.some((item) => item.reason === "source_type_not_allowed_for_v11"));
});

test("still enrichment rejects duplicate URLs", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      downloaded_images: [img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" })],
      game_images: [img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" })],
    }),
  );

  assert.equal(plan.would_fetch.length, 0);
  assert.ok(plan.would_reject.some((item) => item.reason === "duplicate_url_or_hash"));
});

test("still enrichment rejects low-relevance images", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      game_images: [
        img("steam_header", "steam", "https://cdn.example/farming-header.jpg", {
          entity: "Farming Simulator",
        }),
      ],
    }),
  );

  assert.equal(plan.would_fetch.length, 0);
  assert.ok(plan.would_reject.some((item) => item.reason === "low_story_relevance"));
});

test("still enrichment rejects unsafe portraits", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      article_inline_images: [
        img("article_inline", "article", "https://cdn.example/random-author.jpg", {
          human: true,
          role: "author",
          entity: "GTA",
        }),
      ],
    }),
  );

  assert.equal(plan.would_fetch.length, 0);
  assert.ok(plan.would_reject.some((item) => item.reason === "unsafe_thumbnail_or_person"));
});

test("still enrichment only adds candidates that improve deck diversity", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      title: "Take-Two story compares GTA, Red Dead and BioShock",
      full_script: "Take-Two story compares GTA, Red Dead and BioShock.",
      downloaded_images: [
        img("steam_header", "steam", "https://cdn.example/gta-existing.jpg", { entity: "GTA" }),
      ],
      game_images: [
        img("steam_header", "steam", "https://cdn.example/gta-duplicate-entity.jpg", { entity: "GTA" }),
        img("steam_header", "steam", "https://cdn.example/red-dead.jpg", { entity: "Red Dead" }),
        img("igdb_cover", "igdb", "https://cdn.example/bioshock.jpg", { entity: "BioShock" }),
      ],
    }),
  );

  assert.deepEqual(plan.diversity_delta.added_entities.sort(), ["BioShock", "Red Dead"]);
  assert.equal(plan.would_fetch.some((item) => item.entity === "GTA"), false);
});

test("still enrichment dry-run makes no asset writes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stills-dry-"));
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" })],
      }),
    ],
    {
      dryRun: true,
      outputRoot: root,
      fetchImage: async () => Buffer.from("not-called"),
    },
  );
  const files = await fs.readdir(root);

  assert.equal(report.mode, "dry_run");
  assert.equal(report.summary.files_written, 0);
  assert.deepEqual(files, []);
});

test("still enrichment apply-local writes only under the configured local output root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stills-apply-"));
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" })],
      }),
    ],
    {
      dryRun: false,
      applyLocal: true,
      outputRoot: root,
      fetchImage: async () => ({
        buffer: Buffer.from("fake image bytes"),
        contentType: "image/jpeg",
      }),
    },
  );
  const written = report.plans[0].applied_assets[0];
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(written.local_path);

  assert.equal(report.mode, "apply_local");
  assert.equal(report.summary.files_written, 1);
  assert.ok(resolvedPath.startsWith(resolvedRoot));
  assert.equal(await fs.readFile(resolvedPath, "utf8"), "fake image bytes");
});

test("still enrichment apply-local records fetch failures and continues", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stills-apply-continue-"));
  const report = await runStillImageEnrichment(
    [
      baseStory({
        title: "GTA and Red Dead get a big Xbox update",
        full_script: "GTA and Red Dead get a big Xbox update.",
        game_images: [
          img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" }),
          img("igdb_cover", "igdb", "https://cdn.example/red-dead.jpg", { entity: "Red Dead" }),
        ],
      }),
    ],
    {
      dryRun: false,
      applyLocal: true,
      outputRoot: root,
      fetchImage: async (url) => {
        if (url.includes("gta-header")) throw new Error("status_429");
        return {
          buffer: Buffer.from("fake image bytes"),
          contentType: "image/jpeg",
        };
      },
    },
  );

  assert.equal(report.summary.files_written, 1);
  assert.equal(report.plans[0].applied_assets.length, 1);
  assert.ok(report.plans[0].provenance.some((item) => item.action === "fetch_failed"));
});

test("still enrichment records provenance for accepted and applied assets", async () => {
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [img("igdb_cover", "igdb", "https://cdn.example/gta-cover.jpg", { entity: "GTA" })],
      }),
    ],
    { dryRun: true },
  );
  const provenance = report.plans[0].provenance[0];
  const markdown = renderStillImageEnrichmentMarkdown(report);

  assert.equal(provenance.source_url, "https://cdn.example/gta-cover.jpg");
  assert.equal(provenance.source_type, "igdb_cover");
  assert.equal(provenance.entity, "GTA");
  assert.equal(provenance.action, "would_fetch");
  assert.match(markdown, /Controlled Still-Image Enrichment/);
});

test("still enrichment reports Creator Studio before and after readiness projection", () => {
  const plan = buildStillImageEnrichmentPlan(
    baseStory({
      title: "GTA and Red Dead get a big Xbox update",
      full_script: "GTA and Red Dead get a big Xbox update for players on Xbox.",
      game_images: [
        img("steam_header", "steam", "https://cdn.example/gta-header.jpg", { entity: "GTA" }),
        img("steam_capsule", "steam", "https://cdn.example/gta-capsule.jpg", { entity: "GTA" }),
        img("steam_screenshot", "steam", "https://cdn.example/red-dead.jpg", { entity: "Red Dead" }),
        img("igdb_cover", "igdb", "https://cdn.example/xbox-cover.jpg", { entity: "Xbox" }),
      ],
    }),
  );

  assert.equal(plan.before.creator_studio_media_verdict, "blog_only");
  assert.equal(plan.after_projected.creator_studio_media_verdict, "short_only");
  assert.equal(plan.after_projected.format, "standard_short");
  assert.equal(plan.would_improve_readiness, true);
});

test("v1.4 resolves Steam app metadata before verified-only filtering", async () => {
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [
          img("steam_header", "steam", "https://cdn.akamai.steamstatic.com/steam/apps/3240220/header.jpg", {
            entity: "GTA",
          }),
        ],
      }),
    ],
    {
      dryRun: true,
      verifyStoreMetadata: true,
      requireVerifiedStore: true,
      storeMetadataHttp: {
        get: async () => ({
          data: {
            "3240220": {
              success: true,
              data: { name: "Grand Theft Auto VI" },
            },
          },
        }),
      },
    },
  );

  assert.equal(report.plans[0].would_fetch.length, 1);
  assert.equal(report.plans[0].would_fetch[0].store_app_id, "3240220");
  assert.equal(report.plans[0].would_fetch[0].store_app_title, "Grand Theft Auto VI");
  assert.equal(report.plans[0].would_fetch[0].store_match_status, "verified");
  assert.equal(report.plans[0].would_fetch[0].counted_for_premium, true);
});

test("v1.4 verified-store-only rejects unresolved Steam store assets", async () => {
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [
          img("steam_header", "steam", "https://cdn.akamai.steamstatic.com/steam/apps/3240220/header.jpg", {
            entity: "GTA",
          }),
        ],
      }),
    ],
    {
      dryRun: true,
      verifyStoreMetadata: true,
      requireVerifiedStore: true,
      storeMetadataHttp: {
        get: async () => ({ data: { "3240220": { success: false } } }),
      },
    },
  );

  assert.equal(report.plans[0].would_fetch.length, 0);
  assert.ok(report.plans[0].would_reject.some((item) => item.reason === "store_match_not_verified"));
});

test("v1.4 apply-local preserves repaired store provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stills-v14-"));
  const report = await runStillImageEnrichment(
    [
      baseStory({
        game_images: [
          img("steam_header", "steam", "https://cdn.akamai.steamstatic.com/steam/apps/3240220/header.jpg", {
            entity: "GTA",
          }),
        ],
      }),
    ],
    {
      dryRun: false,
      applyLocal: true,
      verifyStoreMetadata: true,
      requireVerifiedStore: true,
      outputRoot: root,
      storeMetadataHttp: {
        get: async () => ({
          data: {
            "3240220": {
              success: true,
              data: { name: "Grand Theft Auto VI" },
            },
          },
        }),
      },
      fetchImage: async () => ({
        buffer: Buffer.from("verified still bytes"),
        contentType: "image/jpeg",
      }),
    },
  );

  assert.equal(report.summary.files_written, 1);
  assert.equal(report.plans[0].applied_assets[0].store_app_title, "Grand Theft Auto VI");
  assert.ok(
    report.plans[0].provenance.some(
      (entry) => entry.action === "applied_local" && entry.store_match_verified === true,
    ),
  );
});

test("v1.5 multi-entity store search adds verified stills per required subject group", async () => {
  const idByTerm = {
    gta: { id: 3240220, name: "Grand Theft Auto V Enhanced" },
    "red dead": { id: 1174180, name: "Red Dead Redemption 2" },
    bioshock: { id: 409710, name: "BioShock Remastered" },
  };
  const report = await runStillImageEnrichment(
    [
      baseStory({
        title: "Take-Two story compares GTA, Red Dead and BioShock",
        full_script: "Take-Two story compares GTA, Red Dead and BioShock.",
        downloaded_images: [],
        game_images: [],
      }),
    ],
    {
      dryRun: true,
      multiEntityStoreSearch: true,
      requireVerifiedStore: true,
      maxDownloadsPerStory: 9,
      storeSearchHttp: {
        get: async (url) => {
          const term = new URL(url).searchParams.get("term").toLowerCase();
          return { data: { items: [idByTerm[term]].filter(Boolean) } };
        },
      },
    },
  );

  const plan = report.plans[0];
  assert.deepEqual(
    Array.from(new Set(plan.would_fetch.map((item) => item.exact_subject_group))).sort(),
    ["BioShock", "GTA", "Red Dead"],
  );
  assert.equal(plan.would_fetch.length, 9);
  assert.equal(plan.would_fetch.every((item) => item.store_match_status === "verified"), true);
  assert.equal(plan.multi_entity_store_search.coverage.length, 3);
});

test("v1.5 multi-entity store search targets inferred headline game before platform context", async () => {
  const searchedTerms = [];
  const report = await runStillImageEnrichment(
    [
      baseStory({
        id: "marathon-platform-rankings",
        title:
          "Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists",
        hook: "Marathon has fallen hard on Steam.",
        body: "The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
        full_script:
          "Marathon has fallen hard on Steam. The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
        downloaded_images: [],
        game_images: [],
      }),
    ],
    {
      dryRun: true,
      multiEntityStoreSearch: true,
      requireVerifiedStore: true,
      maxDownloadsPerStory: 3,
      storeSearchHttp: {
        get: async (url) => {
          const term = new URL(url).searchParams.get("term");
          searchedTerms.push(term);
          return {
            data: {
              items:
                term.toLowerCase() === "marathon"
                  ? [{ id: 3445850, name: "Marathon" }]
                  : [],
            },
          };
        },
      },
    },
  );

  const plan = report.plans[0];
  assert.equal(searchedTerms[0], "Marathon");
  assert.deepEqual(plan.multi_entity_store_search.coverage.map((item) => item.entity), ["Marathon"]);
  assert.equal(plan.would_fetch.length, 3);
  assert.equal(plan.would_fetch.every((item) => item.exact_subject_group === "Marathon"), true);
});
