"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  captureBreakingSourceEvidence,
} = require("../../lib/services/breaking-source-evidence");
const {
  buildReadyInventoryFixture,
} = require("../helpers/governed-editorial-inventory-fixture");

const GENERATED_AT = "2026-07-28T10:00:00.000Z";
const OFFICIAL_URL =
  "https://news.xbox.com/en-us/2026/07/28/canonical-intake-bridge/";

const CLAIMS = Object.freeze([
  Object.freeze({
    claim_key: "xbox.update.expansion",
    text: "Xbox is expanding backwards compatibility with another wave of original Xbox games.",
    location: "body",
  }),
  Object.freeze({
    claim_key: "xbox.update.achievements",
    text: "Every supported release will include newly integrated achievement support for modern profiles.",
    location: "body",
  }),
  Object.freeze({
    claim_key: "xbox.update.gamepass",
    text: "The newly compatible games will also join Game Pass when the programme launches.",
    location: "body",
  }),
]);

const YAZD_SCRIPT =
  "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. Build barricades by day, then survive the night alone or with up to four players. Claim it before the deadline and the full game is yours to keep.";

const LOCKED_YAZD_SCRIPT =
  "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. Claim it before the deadline and the full game stays in your library, this is not a free weekend. It mixes top down shooting with tower defence: spend daylight building barricades, placing turrets and buying weapons, then protect your position when the horde arrives at night. You can play alone, share local co op or fight online with up to four players total. Open the Steam page, make sure the discount shows 100 per cent, and add it to your account. After 30 July, the price comes back.";

const YAZD_CLAIMS = Object.freeze([
  "The official Steam listing marks Yet Another Zombie Defense HD as free to keep.",
  "PC Gamer reports that the offer ends on 30 July 2026.",
  "The Steam price is reduced by 100 per cent from a listed UK price of ?3.39.",
  "The official listing describes single-player, local co-op and online co-op modes for up to four players.",
  "The game combines top-down shooting, barricade building and night-time defence.",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

async function buildGovernedStoryIntakeInventoryBridgeFixture(root) {
  const fixture = buildReadyInventoryFixture(root, {
    storyId: "rss_legacy_editorial_inventory_1",
    primarySourceUrl: OFFICIAL_URL,
  });
  const body = Buffer.from(
    `<article>${CLAIMS.map((claim) => claim.text).join(" ")}</article>`,
    "utf8",
  );
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: fixture.storyId,
      title: "Xbox update",
      subject_ids: ["xbox-backcompat"],
      source_candidates: [OFFICIAL_URL],
    },
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          owner: "Microsoft Gaming",
          hosts: ["news.xbox.com"],
          subject_ids: ["xbox-backcompat"],
        },
      ],
      trusted_editorial: [],
    },
    now: GENERATED_AT,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html; charset=utf-8",
      bytes: body,
    }),
    extractClaims: async () => ({
      extractor: {
        id: "canonical-intake-bridge-fixture",
        version: "1.0.0",
      },
      claims: CLAIMS.map((claim) => ({ ...claim })),
    }),
  });
  const sourceFileSha256 = fixture.writeJson(
    fixture.sourcePath,
    packet,
  );
  const primarySource = packet.sources.find(
    (source) =>
      source.status === "CAPTURED" &&
      source.source_class === "OFFICIAL_FIRST_PARTY" &&
      source.final_url === OFFICIAL_URL,
  );
  const weeklySourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: fixture.storyId,
    source_url: OFFICIAL_URL,
    source_type: "official",
    publisher: primarySource.publisher,
    published_at: GENERATED_AT,
    claims: primarySource.claims.map(
      ({ claim_key, text, claim_text_sha256 }) => ({
        claim_key,
        text,
        claim_text_sha256,
      }),
    ),
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: OFFICIAL_URL,
      source_id: primarySource.source_id,
      source_class: primarySource.source_class,
      canonical_body_algorithm:
        primarySource.canonical_body.algorithm,
      canonical_body_sha256:
        primarySource.canonical_body.sha256,
      claims: primarySource.claims.map(
        ({ claim_key, text, claim_text_sha256 }) => ({
          claim_key,
          text,
          claim_text_sha256,
        }),
      ),
    },
  };
  const weeklyFileSha256 = fixture.writeJson(
    fixture.weeklyPath,
    weeklySourceEvidence,
  );
  const registryBase = {
    ...fixture.registry,
    story: {
      ...fixture.registry.story,
      title: "Xbox expands backwards compatibility",
      published_at: GENERATED_AT,
      primary_source_url: OFFICIAL_URL,
    },
    breaking_source_evidence: {
      path: fixture.sourcePath,
      file_sha256: sourceFileSha256,
      canonical_sha256: packet.packet_sha256,
    },
    weekly_source_evidence: {
      path: fixture.weeklyPath,
      file_sha256: weeklyFileSha256,
    },
  };
  delete registryBase.inventory_sha256;
  const registry = {
    ...registryBase,
    inventory_sha256: fixture.canonicalSha256(registryBase),
  };
  const registryFileSha256 = fixture.writeJson(
    fixture.registryPath,
    registry,
  );
  return {
    ...fixture,
    generatedAt: GENERATED_AT,
    officialUrl: OFFICIAL_URL,
    claims: CLAIMS.map((claim) => ({ ...claim })),
    packet,
    weeklySourceEvidence,
    registry,
    registryFileSha256,
    sourceFileSha256,
    weeklyFileSha256,
    outputDir: path.join(root, "canonical-intake"),
  };
}

async function buildLockedYazdInventoryFixture(root) {
  const storyId = "official_3b8d305c4e17";
  const canonicalIdentityUrl =
    "https://store.steampowered.com/app/674750/";
  const newsUrl =
    "https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=674750&count=1&maxlength=0&format=json";
  const storeApiUrl =
    "https://store.steampowered.com/api/appdetails?appids=674750&cc=gb&l=en";
  const fixture = buildReadyInventoryFixture(root, {
    storyId,
    primarySourceUrl: newsUrl,
  });
  const newsClaims = [
    {
      claim_key: "awesome_games_studio.yazd_hd.free",
      text: "[h3][b]YAZD HD Is FREE for a Limited Time![/b][/h3]",
      location: "body",
    },
    {
      claim_key: "awesome_games_studio.yazd_hd.claim_period",
      text:
        "Starting at 10am Pacific on July 23rd until July 30th, you'll be able to add Yet Another Zombie Defense HD to your Steam library for free",
      location: "body",
    },
  ];
  const newsBody = Buffer.from(
    JSON.stringify({
      appnews: {
        appid: 674750,
        newsitems: [
          {
            title:
              "YAZD HD is free! Yet Another Zombie Survivors 1.0 release date announced!",
            contents: newsClaims.map((claim) => claim.text).join(" "),
          },
        ],
      },
    }),
    "utf8",
  );
  const newsArchivePath = path.join(
    root,
    "source-bytes",
    `${sha256(newsBody)}.source`,
  );
  fs.mkdirSync(path.dirname(newsArchivePath), {
    recursive: true,
  });
  fs.writeFileSync(newsArchivePath, newsBody);
  const sourcePolicy = {
    official_first_party: [
      {
        source_id: "steam-news-api",
        owner: "Awesome Games Studio",
        hosts: ["api.steampowered.com"],
        subject_ids: ["steam"],
      },
      {
        source_id: "steam-store-api",
        owner: "Valve",
        hosts: ["store.steampowered.com"],
        subject_ids: ["steam"],
      },
    ],
    trusted_editorial: [],
  };
  const newsPacket = await captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title: "Yet Another Zombie Defense HD is free until 30 July",
      subject_ids: ["steam"],
      source_candidates: [newsUrl],
    },
    sourcePolicy,
    now: GENERATED_AT,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "application/json; charset=utf-8",
      bytes: newsBody,
      archive_path: newsArchivePath,
      archive_ref: `sha256:${sha256(newsBody)}`,
    }),
    extractClaims: async () => ({
      extractor: {
        id: "locked-yazd-news-fixture",
        version: "1.0.0",
      },
      claims: newsClaims,
    }),
  });
  const sourceFileSha256 = fixture.writeJson(
    fixture.sourcePath,
    newsPacket,
  );
  const newsSource = newsPacket.sources[0];
  const weeklySourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: storyId,
    source_url: newsUrl,
    source_type: "official",
    publisher: newsSource.publisher,
    published_at: GENERATED_AT,
    claims: newsSource.claims.map(
      ({ claim_key, text, claim_text_sha256 }) => ({
        claim_key,
        text,
        claim_text_sha256,
      }),
    ),
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: newsUrl,
      source_id: newsSource.source_id,
      source_class: newsSource.source_class,
      canonical_body_algorithm:
        newsSource.canonical_body.algorithm,
      canonical_body_sha256:
        newsSource.canonical_body.sha256,
      claims: newsSource.claims.map(
        ({ claim_key, text, claim_text_sha256 }) => ({
          claim_key,
          text,
          claim_text_sha256,
        }),
      ),
    },
  };
  const weeklyFileSha256 = fixture.writeJson(
    fixture.weeklyPath,
    weeklySourceEvidence,
  );
  const registryBase = {
    ...fixture.registry,
    story: {
      ...fixture.registry.story,
      id: storyId,
      title:
        "Yet Another Zombie Defense HD Is Free To Keep Until 30 July",
      published_at: GENERATED_AT,
      primary_source_url: newsUrl,
    },
    breaking_source_evidence: {
      path: fixture.sourcePath,
      file_sha256: sourceFileSha256,
      canonical_sha256: newsPacket.packet_sha256,
    },
    weekly_source_evidence: {
      path: fixture.weeklyPath,
      file_sha256: weeklyFileSha256,
    },
  };
  delete registryBase.inventory_sha256;
  const registry = {
    ...registryBase,
    inventory_sha256: fixture.canonicalSha256(registryBase),
  };
  const registryFileSha256 = fixture.writeJson(
    fixture.registryPath,
    registry,
  );

  const storeClaims = [
    {
      claim_key: "yet_another_zombie_defense.store_description",
      text:
        "Top-down zombie shooter with tower defense elements featuring up to 4 players local and online co-op. Build your base by day, defend it by night, put your skills to the test to stay alive as long as possible!",
      location: "body",
    },
    {
      claim_key: "yet_another_zombie_defense.gameplay_loop",
      text:
        "Prepare yourself before the night falls - build some defensive barricades, buy guns and ammo, set up turrets and stay alive as long as you can.",
      location: "body",
    },
    {
      claim_key: "yet_another_zombie_defense.coop",
      text: "Local and online co-op up to four players",
      location: "body",
    },
    {
      claim_key: "yet_another_zombie_defense.discount_percent",
      text: "\"discount_percent\":100",
      location: "body",
    },
    {
      claim_key: "yet_another_zombie_defense.normal_price",
      text: "\"initial_formatted\":\"?3.39\"",
      location: "body",
    },
    {
      claim_key: "yet_another_zombie_defense.current_price",
      text: "\"final_formatted\":\"Free\"",
      location: "body",
    },
  ];
  const storeBody = Buffer.from(
    JSON.stringify({
      674750: {
        success: true,
        data: {
          name: "Yet Another Zombie Defense HD",
          is_free: true,
          short_description: storeClaims[0].text,
          price_overview: {
            currency: "GBP",
            initial: 339,
            final: 339,
            discount_percent: 100,
            initial_formatted: "?3.39",
            final_formatted: "Free",
          },
          about_the_game: [
            storeClaims[1].text,
            storeClaims[2].text,
          ].join(" "),
        },
      },
    }),
    "utf8",
  );
  const storeArchivePath = path.join(
    root,
    "source-bytes",
    `${sha256(storeBody)}.source`,
  );
  fs.writeFileSync(storeArchivePath, storeBody);
  const storePacket = await captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title: "Yet Another Zombie Defense HD is free until 30 July",
      subject_ids: ["steam"],
      source_candidates: [storeApiUrl],
    },
    sourcePolicy,
    now: GENERATED_AT,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "application/json; charset=utf-8",
      bytes: storeBody,
      archive_path: storeArchivePath,
      archive_ref: `sha256:${sha256(storeBody)}`,
    }),
    extractClaims: async () => ({
      extractor: {
        id: "locked-yazd-store-fixture",
        version: "1.0.0",
      },
      claims: storeClaims,
    }),
  });
  const supplementalPath = path.join(
    root,
    "supplemental",
    "store-api-evidence.json",
  );
  const supplementalFileSha256 = writeJson(
    supplementalPath,
    storePacket,
  );
  return {
    ...fixture,
    storyId,
    canonicalIdentityUrl,
    newsUrl,
    storeApiUrl,
    newsPacket,
    storePacket,
    registry,
    registryFileSha256,
    sourceFileSha256,
    weeklyFileSha256,
    supplementalPath,
    supplementalFileSha256,
    newsArchivePath,
    storeArchivePath,
    script: LOCKED_YAZD_SCRIPT,
    scriptSha256: sha256(Buffer.from(LOCKED_YAZD_SCRIPT, "utf8")),
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id:
        "what_changes_breaking_high_cadence_35_42",
      target_duration_seconds: 36.48,
      target_duration_review: {
        status: "APPROVED",
        target_duration_seconds: 36.48,
        script_sha256: sha256(
          Buffer.from(LOCKED_YAZD_SCRIPT, "utf8"),
        ),
        reviewed_by: "pulse-autonomous-editorial-review-v1",
        reviewed_at: "2026-07-28T23:37:32.580Z",
      },
    },
    freshness: {
      discovered_at: "2026-07-28T20:00:00.000Z",
      source_last_checked_at: "2026-07-29T08:32:02.590Z",
      publish_by: "2026-07-30T15:00:00.000Z",
      stale_after: "2026-07-30T17:00:00.000Z",
      reverification_required: true,
      stale_reframe_option: {
        allowed: false,
        reason:
          "The script and call to action depend on the live free-to-keep offer.",
      },
    },
    visualBrief: {
      format: "owned-motion-only",
      source_media_policy: "OWNED_ONLY",
      palette: ["#07090D", "#FF6B1A", "#F7F8FA"],
    },
    scriptClaimBindings: [
      {
        clause:
          "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July.",
        claim_keys: [
          "awesome_games_studio.yazd_hd.free",
          "awesome_games_studio.yazd_hd.claim_period",
        ],
      },
      {
        clause:
          "Claim it before the deadline and the full game stays in your library, this is not a free weekend.",
        claim_keys: [
          "awesome_games_studio.yazd_hd.claim_period",
          "awesome_games_studio.yazd_hd.free",
        ],
      },
      {
        clause:
          "It mixes top down shooting with tower defence: spend daylight building barricades, placing turrets and buying weapons, then protect your position when the horde arrives at night.",
        claim_keys: [
          "yet_another_zombie_defense.store_description",
          "yet_another_zombie_defense.gameplay_loop",
        ],
      },
      {
        clause:
          "You can play alone, share local co op or fight online with up to four players total.",
        claim_keys: [
          "yet_another_zombie_defense.store_description",
          "yet_another_zombie_defense.coop",
        ],
      },
      {
        clause:
          "Open the Steam page, make sure the discount shows 100 per cent, and add it to your account.",
        claim_keys: [
          "awesome_games_studio.yazd_hd.claim_period",
          "yet_another_zombie_defense.discount_percent",
          "yet_another_zombie_defense.current_price",
        ],
      },
      {
        clause: "After 30 July, the price comes back.",
        claim_keys: [
          "awesome_games_studio.yazd_hd.claim_period",
          "yet_another_zombie_defense.normal_price",
          "yet_another_zombie_defense.current_price",
        ],
      },
    ],
    presentationClaimBindings: [
      {
        presentation_text: "UK ?3.39",
        claim_keys: [
          "yet_another_zombie_defense.normal_price",
        ],
      },
      {
        presentation_text: "100% OFF",
        claim_keys: [
          "yet_another_zombie_defense.discount_percent",
        ],
      },
    ],
    outputDir: path.join(root, "locked-yazd-intake"),
  };
}

function buildYazdLegacyPackageFixture(root) {
  const storyId = "rss_e82fbaff7bc3650b";
  const sourceUrl = "https://store.steampowered.com/app/674750/";
  const publishedAt = "2026-07-27T03:32:08.000Z";
  const packageRoot = path.join(root, "legacy-yazd-package");
  const seedPath = path.join(root, "seed", "story.json");
  const canonicalStoryManifestPath = path.join(
    packageRoot,
    "canonical_story_manifest.json",
  );
  const sourceManifestPath = path.join(
    packageRoot,
    "source_manifest.json",
  );
  const story = {
    id: storyId,
    title:
      "Yet Another Zombie Defense HD is free to keep on Steam until 30 July",
    url: sourceUrl,
    article_url: sourceUrl,
    primary_source_url: sourceUrl,
    source_type: "rss",
    source_name: "Steam",
    source_published_at: publishedAt,
    confirmed_claims: [...YAZD_CLAIMS],
    claim_inventory: {
      confirmed: [...YAZD_CLAIMS],
      unconfirmed: [],
      prohibited: [],
    },
    source_evidence: {
      status: "verified",
      source_url: sourceUrl,
      source_owner: "Awesome Games Studio",
      detected_at: publishedAt,
      verified_at: "2026-07-27T07:45:00.000Z",
      claims: [
        {
          claim: "The game is free to keep during the active offer.",
          status: "confirmed",
          source_section:
            "Steam purchase block and appdetails price metadata",
        },
        {
          claim:
            "The game supports local and online co-op for up to four players.",
          status: "confirmed",
          source_section:
            "Steam categories and official game description",
        },
      ],
    },
    secondary_sources: [
      {
        name: "PC Gamer",
        url:
          "https://www.pcgamer.com/games/action/yet-another-zombie-defense-hd-which-is-its-real-name-is-free-on-steam-for-a-limited-time/",
        published_at: publishedAt,
        purpose: "Independent confirmation of the 30 July deadline",
      },
    ],
  };
  const seedFileSha256 = writeJson(seedPath, { stories: [story] });
  const canonicalStoryManifestFileSha256 = writeJson(
    canonicalStoryManifestPath,
    {
      story_id: storyId,
      title:
        "Yet Another Zombie Defense HD Is Free To Keep Until 30 July",
      primary_source_url: sourceUrl,
      source_published_at: publishedAt,
      confirmed_claims: [...YAZD_CLAIMS],
      claim_inventory: structuredClone(story.claim_inventory),
      publish_status: "DRAFT",
    },
  );
  const sourceManifestFileSha256 = writeJson(sourceManifestPath, {
    schema_version: 1,
    story_id: storyId,
    generated_at: "2026-07-27T09:09:00.944Z",
    primary_source: {
      name: "Steam",
      url: sourceUrl,
      type: "rss",
      published_at: publishedAt,
    },
    source_evidence: structuredClone(story.source_evidence),
    source_age_policy_hours: 168,
    freshness_gate: "pass",
    coherence_gate: "pass",
    fallback_from_story_manifest: true,
    blockers: [],
  });
  return {
    root,
    packageRoot,
    storyId,
    sourceUrl,
    publishedAt,
    claims: [...YAZD_CLAIMS],
    script: YAZD_SCRIPT,
    scriptSha256: sha256(Buffer.from(YAZD_SCRIPT, "utf8")),
    seedPath,
    seedFileSha256,
    canonicalStoryManifestPath,
    canonicalStoryManifestFileSha256,
    sourceManifestPath,
    sourceManifestFileSha256,
    outputDir: path.join(root, "canonical-yazd-intake"),
    scriptClaimBindings: [
      {
        clause:
          "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July.",
        claim_indexes: [0, 1],
      },
      {
        clause:
          "Build barricades by day, then survive the night alone or with up to four players.",
        claim_indexes: [3, 4],
      },
      {
        clause:
          "Claim it before the deadline and the full game is yours to keep.",
        claim_indexes: [0, 1, 4],
      },
    ],
  };
}

module.exports = {
  buildGovernedStoryIntakeInventoryBridgeFixture,
  buildLockedYazdInventoryFixture,
  buildYazdLegacyPackageFixture,
};
