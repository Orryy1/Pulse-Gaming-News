"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bestSteamResult,
  buildOfficialSearchIntakeAutofillReport,
  matchScore,
  renderOfficialSearchIntakeAutofillMarkdown,
  steamApiSearchUrl,
} = require("../../lib/official-search-intake-autofill");
const { parseArgs, rowsFromPayload } = require("../../tools/official-search-intake-autofill");
const packageJson = require("../../package.json");

const searchEntries = [
  {
    story_id: "granblue-gap",
    entity: "Granblue Fantasy: Relink",
    query: "Granblue Fantasy: Relink official gameplay trailer",
    accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
    status: "official_search_required",
    downloads_allowed: false,
    candidate_generation_policy: "search_action_only_not_render_candidate",
  },
  {
    story_id: "doom-gap",
    entity: "Doom Composer Lawsuit",
    query: "Doom Composer Lawsuit official trailer",
    accepted_sources: ["official publisher channel"],
    status: "official_search_required",
    downloads_allowed: false,
  },
];

test("official search autofill accepts only exact or strong Steam storefront matches", async () => {
  const calls = [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: searchEntries,
    generatedAt: "2026-06-21T20:15:00.000Z",
    fetchJson: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: {
          items: [
            { id: 881020, name: "Granblue Fantasy: Relink" },
            { id: 999, name: "Relinked Fantasy Maker" },
          ],
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], steamApiSearchUrl("Granblue Fantasy: Relink"));
  assert.equal(report.execution_mode, "official_search_intake_autofill");
  assert.equal(report.summary.search_entries, 2);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.summary.output_entries, 1);
  assert.equal(report.safety.video_downloads_started, false);
  assert.equal(report.safety.browser_scraping_started, false);
  assert.equal(report.safety.production_db_mutated, false);

  const entry = report.output_template.entries[0];
  assert.equal(entry.story_id, "granblue-gap");
  assert.equal(entry.entity, "Granblue Fantasy: Relink");
  assert.equal(entry.source_type, "platform_storefront");
  assert.equal(entry.source_family, "steam_881020_granblue_fantasy_relink");
  assert.equal(entry.official_source_url, "https://store.steampowered.com/app/881020/Granblue_Fantasy%3A_Relink/");
  assert.equal(entry.direct_media_url_if_available, "");
  assert.equal(entry.downloads_allowed, false);
  assert.equal(entry.autonomous_use_approved, false);
  assert.equal(entry.candidate_generation_policy, "official_storefront_reference_only_not_render_candidate");
  assert.match(entry.evidence_of_officialness, /Steam official app 881020/);
});

test("official search autofill adds trusted official media pages for known publisher entities", async () => {
  let steamFetches = 0;
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "gta-vi-gap",
        entity: "Grand Theft Auto VI",
        query: "Grand Theft Auto VI official gameplay trailer",
        accepted_sources: ["official publisher channel", "official game site", "platform storefront"],
        status: "official_search_required",
        downloads_allowed: false,
      },
    ],
    fetchJson: async () => {
      steamFetches += 1;
      return { ok: true, status: 200, json: { items: [] } };
    },
  });

  assert.equal(steamFetches, 0);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.output_entries, 1);
  assert.deepEqual(report.safety.provider_scope, [
    "official_site_catalog",
    "steam_storesearch",
  ]);
  const row = report.rows[0];
  assert.equal(row.provider, "official_site_catalog");
  assert.equal(row.status, "accepted");
  assert.equal(row.reason, null);
  const entry = report.output_template.entries[0];
  assert.equal(entry.story_id, "gta-vi-gap");
  assert.equal(entry.entity, "Grand Theft Auto VI");
  assert.equal(entry.source_type, "official_game_website_media_page");
  assert.equal(entry.source_owner, "Rockstar Games official site");
  assert.equal(entry.source_title, "Grand Theft Auto VI Videos");
  assert.equal(entry.official_source_url, "https://www.rockstargames.com/VI/media/videos");
  assert.equal(entry.direct_media_url_if_available, "");
  assert.equal(entry.downloads_allowed, false);
  assert.equal(entry.autonomous_use_approved, false);
  assert.equal(
    entry.candidate_generation_policy,
    "official_media_page_reference_only_direct_media_discovery_required",
  );
  assert.match(entry.evidence_of_officialness, /Rockstar Games official media page/);
});

test("official search autofill rejects weak Steam result matches", async () => {
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "halo-gap",
        entity: "Halo: Campaign Evolved",
        query: "Halo: Campaign Evolved official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
    ],
    fetchJson: async () => ({
      ok: true,
      status: 200,
      json: {
        items: [
          { id: 1, name: "Halo Infinite" },
          { id: 2, name: "Combat Evolved Fan Trivia" },
        ],
      },
    }),
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.no_confident_match, 1);
  assert.equal(report.output_template.entries.length, 0);
  assert.equal(report.rows[0].reason, "no_exact_or_strong_steam_app_match");
});

test("official search autofill falls back from character trailer phrasing to the canonical Steam app", async () => {
  const calls = [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "sf6-gap",
        entity: "Street Fighter 6 Yasmine Character Gameplay",
        query: "Street Fighter 6 Yasmine Character Gameplay official trailer",
        accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
      },
    ],
    fetchJson: async (url) => {
      calls.push(url);
      if (url === steamApiSearchUrl("Street Fighter 6 Yasmine Character Gameplay")) {
        return { ok: true, status: 200, json: { items: [] } };
      }
      assert.equal(url, steamApiSearchUrl("Street Fighter 6"));
      return {
        ok: true,
        status: 200,
        json: {
          items: [
            { id: 2154900, name: "Street Fighter 6 Demo" },
            { id: 1364780, name: "Street Fighter™ 6" },
            { id: 310950, name: "Street Fighter V" },
          ],
        },
      };
    },
  });

  assert.deepEqual(calls, [
    steamApiSearchUrl("Street Fighter 6 Yasmine Character Gameplay"),
    steamApiSearchUrl("Street Fighter 6"),
  ]);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.no_confident_match, 0);
  assert.equal(report.rows[0].matched_app_name, "Street Fighter™ 6");
  assert.equal(report.output_template.entries[0].source_family, "steam_1364780_street_fighter_6");
  assert.match(report.output_template.entries[0].entity_match_notes, /Street Fighter 6 Yasmine Character Gameplay/);
});

test("official search autofill falls back from official character wording to stylised Steam titles", async () => {
  const calls = [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "robo-ky-gap",
        entity: "GUILTY GEAR -STRIVE- Robo-Ky Official",
        query: "GUILTY GEAR -STRIVE- Robo-Ky Official official gameplay trailer",
        accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
      },
    ],
    fetchJson: async (url) => {
      calls.push(url);
      if (url === steamApiSearchUrl("GUILTY GEAR -STRIVE- Robo-Ky Official")) {
        return { ok: true, status: 200, json: { items: [] } };
      }
      if (url === steamApiSearchUrl("GUILTY GEAR -STRIVE- Robo-Ky")) {
        return { ok: true, status: 200, json: { items: [] } };
      }
      assert.equal(url, steamApiSearchUrl("GUILTY GEAR -STRIVE-"));
      return {
        ok: true,
        status: 200,
        json: {
          items: [
            { id: 1384160, name: "GUILTY GEAR -STRIVE-" },
            { id: 9999, name: "GUILTY GEAR Xrd REV 2" },
          ],
        },
      };
    },
  });

  assert.deepEqual(calls, [
    steamApiSearchUrl("GUILTY GEAR -STRIVE- Robo-Ky Official"),
    steamApiSearchUrl("GUILTY GEAR -STRIVE- Robo-Ky"),
    steamApiSearchUrl("GUILTY GEAR -STRIVE-"),
  ]);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.no_confident_match, 0);
  assert.equal(report.rows[0].matched_app_name, "GUILTY GEAR -STRIVE-");
  assert.equal(report.output_template.entries[0].source_family, "steam_1384160_guilty_gear_strive");
  assert.match(report.output_template.entries[0].entity_match_notes, /Robo-Ky Official/);
});

test("official search autofill rejects derivative store products as game matches", async () => {
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "sea-gap",
        entity: "Sea of Thieves",
        query: "Sea of Thieves official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
      {
        story_id: "fc-gap",
        entity: "EA SPORTS FC 26",
        query: "EA SPORTS FC 26 official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
    ],
    fetchJson: async (url) => {
      if (url === steamApiSearchUrl("Sea of Thieves")) {
        return {
          ok: true,
          status: 200,
          json: {
            items: [
              { id: 9991, name: "Sea of Thieves Original Soundtrack - 2026 Edition" },
              { id: 9993, name: "Sea of Thieves: 2026 Deluxe Bundle" },
            ],
          },
        };
      }
      return {
        ok: true,
        status: 200,
        json: { items: [{ id: 9992, name: "EA SPORTS FC™ 26 - FC Points" }] },
      };
    },
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.no_confident_match, 2);
  assert.equal(report.output_template.entries.length, 0);
});

test("official search autofill rejects broad and generic entity matches", async () => {
  const calls = [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "gundam-gap",
        entity: "Gundam",
        query: "Gundam official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
      {
        story_id: "generic-gap",
        entity: "This Game",
        query: "This Game official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
    ],
    fetchJson: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: {
          items: [
            { id: 1672500, name: "GUNDAM BREAKER 4" },
            { id: 3890190, name: "This Game Exists Now" },
          ],
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.summary.no_confident_match, 1);
  assert.equal(report.rows[0].reason, "no_exact_or_strong_steam_app_match");
  assert.equal(report.rows[1].reason, "generic_entity_not_safe_for_autofill");
  assert.equal(report.output_template.entries.length, 0);
});

test("official search autofill does not query storefronts for generic season labels", async () => {
  const calls = [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "season-gap",
        entity: "Season One",
        query: "Season One official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
    ],
    fetchJson: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: { items: [{ id: 1234, name: "Season One: A Different Game" }] },
      };
    },
  });

  assert.deepEqual(calls, []);
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.rows[0].reason, "generic_entity_not_safe_for_autofill");
  assert.equal(report.output_template.entries.length, 0);
});

test("official search autofill allows one-token Steam matches only when the app title is exact", async () => {
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: [
      {
        story_id: "doom-gap",
        entity: "Doom",
        query: "Doom official gameplay trailer",
        accepted_sources: ["Steam", "platform storefront"],
      },
    ],
    fetchJson: async () => ({
      ok: true,
      status: 200,
      json: { items: [{ id: 2280, name: "DOOM" }] },
    }),
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.output_template.entries[0].source_family, "steam_2280_doom");
});

test("official search autofill can merge existing intake rows without duplicates", async () => {
  const existing = {
    story_id: "granblue-gap",
    entity: "Granblue Fantasy: Relink",
    source_family: "steam_881020_granblue_fantasy_relink",
    official_source_url: "https://store.steampowered.com/app/881020/Granblue_Fantasy%3A_Relink/",
  };
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries: searchEntries.slice(0, 1),
    existingEntries: [existing],
    fetchJson: async () => ({
      ok: true,
      status: 200,
      json: { items: [{ id: 881020, name: "Granblue Fantasy: Relink" }] },
    }),
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.output_entries, 1);
  assert.equal(report.output_template.entries[0], existing);
});

test("official search autofill match scoring handles edition suffixes conservatively", () => {
  assert.equal(matchScore("Granblue Fantasy: Relink", "Granblue Fantasy: Relink"), 1);
  assert.ok(matchScore("Sea of Thieves: 2025 Edition", "Sea of Thieves") >= 0.9);
  assert.ok(matchScore("Halo Infinite", "Halo: Campaign Evolved") < 0.9);

  const match = bestSteamResult(
    [
      { id: 1172620, name: "Sea of Thieves: 2025 Edition" },
      { id: 999, name: "Sea Salt" },
    ],
    "Sea of Thieves",
  );
  assert.equal(match.appid, "1172620");
});

test("official search autofill markdown, rows parser and CLI are safe", () => {
  const markdown = renderOfficialSearchIntakeAutofillMarkdown({
    generated_at: "2026-06-21T20:20:00.000Z",
    summary: { search_entries: 1, accepted: 1, output_entries: 1 },
    rows: [{ story_id: "granblue-gap", entity: "Granblue Fantasy: Relink", provider: "steam", status: "accepted" }],
  });
  const args = parseArgs([
    "node",
    "tools/official-search-intake-autofill.js",
    "--input",
    "test/output/visual_v4_official_search_template.json",
    "--merge-input",
    "test/output/visual_v4_source_family_intake_template.json",
    "--story-id",
    "granblue-gap",
    "--minimum-steam-score",
    "0.95",
  ]);

  assert.match(markdown, /No downloads/);
  assert.equal(args.storyId, "granblue-gap");
  assert.equal(args.minimumSteamScore, 0.95);
  assert.deepEqual(rowsFromPayload({ output_template: { entries: [{ story_id: "a" }] } }), [{ story_id: "a" }]);
  assert.match(
    packageJson.scripts["media:autofill-official-source-intake"],
    /official-search-intake-autofill\.js/,
  );
});
