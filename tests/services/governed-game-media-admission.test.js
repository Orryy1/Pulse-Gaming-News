"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GAME_MEDIA_ADMISSION_SCHEMA,
  PERMISSION_EVIDENCE_SCHEMA,
  SOURCE_EVIDENCE_SCHEMA,
  TRANSFORMATION_EVIDENCE_SCHEMA,
  validateGovernedGameMediaAdmission,
} = require("../../lib/services/governed-game-media-admission");
const {
  validateGovernedSourceMediaManifest,
} = require("../../lib/services/governed-source-media");

const STORY_ID = "official_nintendo_switch_2_001";
const VALIDATION_BOUNDARY = "2026-07-28T14:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function relative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function officialScreenshotFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-game-media-admission-"),
  );
  const sourceAssetPath = path.join(root, "assets", "raw-switch-2.png");
  const materialisedPath = path.join(
    root,
    "materialised",
    "switch-2-editorial-frame.png",
  );
  const sourceEvidencePath = path.join(
    root,
    "evidence",
    "source.json",
  );
  const permissionEvidencePath = path.join(
    root,
    "evidence",
    "permission.json",
  );
  const transformationEvidencePath = path.join(
    root,
    "evidence",
    "transformation.json",
  );
  const manifestPath = path.join(root, "game-media-admission.json");
  const sourceBytes = Buffer.from("official-switch-2-screenshot-source");
  const materialisedBytes = Buffer.from(
    "pulse-cropped-and-animated-switch-2-editorial-frame",
  );
  fs.mkdirSync(path.dirname(sourceAssetPath), { recursive: true });
  fs.mkdirSync(path.dirname(materialisedPath), { recursive: true });
  fs.writeFileSync(sourceAssetPath, sourceBytes);
  fs.writeFileSync(materialisedPath, materialisedBytes);

  const sourceEvidenceSha256 = writeJson(sourceEvidencePath, {
    schema_version: SOURCE_EVIDENCE_SCHEMA,
    story_id: STORY_ID,
    asset_id: "switch-2-official-screenshot-01",
    source_class: "OFFICIAL_PUBLISHER_ASSET",
    media_kind: "OFFICIAL_SCREENSHOT",
    game: {
      title: "Nintendo Switch 2",
      publisher: "Nintendo",
    },
    publisher: "Nintendo",
    page_url: "https://www.nintendo.com/us/gaming-systems/switch-2/",
    story_source_url:
      "https://www.nintendo.com/us/gaming-systems/switch-2/",
    direct_media_url:
      "https://assets.nintendo.com/image/upload/switch-2/official-01.png",
    official_domain_reviewed: true,
    source_asset_sha256: sha256(sourceBytes),
    recorded_at: "2026-07-28T13:40:00.000Z",
  });

  const permissionEvidenceSha256 = writeJson(permissionEvidencePath, {
    schema_version: PERMISSION_EVIDENCE_SCHEMA,
    story_id: STORY_ID,
    asset_id: "switch-2-official-screenshot-01",
    decision: "ADMITTED",
    review_status: "ACCEPTED",
    rights_basis: "PRESS_KIT_TERMS",
    rights_holder: "Nintendo",
    evidence_url:
      "https://www.nintendo.co.jp/networkservice_guideline/en/index.html",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: "2026-07-28T13:45:00.000Z",
    coverage: {
      media_kinds: ["OFFICIAL_SCREENSHOT"],
      destinations: ["YOUTUBE_SHORTS"],
      uses: ["TRANSFORMATIVE_EDITORIAL"],
    },
    attribution: {
      required: true,
      text: "Official Nintendo media",
      delivery: ["ON_SCREEN", "DESCRIPTION"],
    },
    attribution_is_permission: false,
  });

  const transformationEvidenceSha256 = writeJson(
    transformationEvidencePath,
    {
      schema_version: TRANSFORMATION_EVIDENCE_SCHEMA,
      story_id: STORY_ID,
      asset_id: "switch-2-official-screenshot-01",
      source_asset_sha256: sha256(sourceBytes),
      permission_evidence_sha256: permissionEvidenceSha256,
      materialised_asset_sha256: sha256(materialisedBytes),
      purpose: "TRANSFORMATIVE_EDITORIAL",
      operations: ["CROP", "KEN_BURNS", "TEXT_OVERLAY"],
      source_audio_disposition: "NOT_APPLICABLE",
      usage_seconds: [0, 4.2],
      created_at: "2026-07-28T13:50:00.000Z",
    },
  );

  const manifest = {
    schema_version: GAME_MEDIA_ADMISSION_SCHEMA,
    policy: "GOVERNED_GAME_MEDIA_V1",
    story_id: STORY_ID,
    primary_source_url:
      "https://www.nintendo.com/us/gaming-systems/switch-2/",
    generated_at: "2026-07-28T13:55:00.000Z",
    assets: [
      {
        asset_id: "switch-2-official-screenshot-01",
        media_type: "IMAGE",
        media_kind: "OFFICIAL_SCREENSHOT",
        editorial_role: "GAMEPLAY_HERO",
        source: {
          evidence_path: relative(root, sourceEvidencePath),
          evidence_sha256: sourceEvidenceSha256,
          asset_path: relative(root, sourceAssetPath),
          asset_sha256: sha256(sourceBytes),
        },
        permission: {
          evidence_path: relative(root, permissionEvidencePath),
          evidence_sha256: permissionEvidenceSha256,
        },
        transformation: {
          evidence_path: relative(root, transformationEvidencePath),
          evidence_sha256: transformationEvidenceSha256,
        },
        materialised: {
          path: relative(root, materialisedPath),
          sha256: sha256(materialisedBytes),
        },
      },
    ],
  };
  const manifestSha256 = writeJson(manifestPath, manifest);
  return {
    manifest,
    manifestPath,
    manifestSha256,
    materialisedPath,
    permissionEvidencePath,
    root,
    sourceAssetPath,
    sourceEvidencePath,
    transformationEvidencePath,
  };
}

function rewriteSource(input, mutate) {
  const source = JSON.parse(
    fs.readFileSync(input.sourceEvidencePath, "utf8"),
  );
  mutate(source);
  input.manifest.assets[0].source.evidence_sha256 = writeJson(
    input.sourceEvidencePath,
    source,
  );
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );
  return input;
}

function rewritePermission(input, mutate) {
  const permission = JSON.parse(
    fs.readFileSync(input.permissionEvidencePath, "utf8"),
  );
  mutate(permission);
  const permissionSha256 = writeJson(
    input.permissionEvidencePath,
    permission,
  );
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  transformation.permission_evidence_sha256 = permissionSha256;
  const transformationSha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );
  input.manifest.assets[0].permission.evidence_sha256 =
    permissionSha256;
  input.manifest.assets[0].transformation.evidence_sha256 =
    transformationSha256;
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );
  return input;
}

function yazdSteamFixture({ trailer = false } = {}) {
  const input = officialScreenshotFixture();
  const assetId = trailer
    ? "yazd-steam-trailer-119861"
    : "yazd-steam-screenshot-c64f69";
  const mediaKind = trailer
    ? "OFFICIAL_TRAILER_SEGMENT"
    : "OFFICIAL_SCREENSHOT";
  const directMediaUrl = trailer
    ? "https://video.akamai.steamstatic.com/store_trailers/674750/119861/09f5412003a2036916ec9da9ba30ba9a751cc545/1751129439/hls_264_master.m3u8?t=1683211115"
    : "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/674750/ss_c64f69ed658fac18ee8ac772783357b00b8928ed.1920x1080.jpg?t=1780089205";
  const storyId = "rss_e82fbaff7bc3650b";
  const source = JSON.parse(
    fs.readFileSync(input.sourceEvidencePath, "utf8"),
  );
  const permission = JSON.parse(
    fs.readFileSync(input.permissionEvidencePath, "utf8"),
  );
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  source.story_id = storyId;
  source.asset_id = assetId;
  source.source_class = "OFFICIAL_STEAM_STOREFRONT_ASSET";
  source.media_kind = mediaKind;
  source.game = {
    title: "Yet Another Zombie Defense HD",
    publisher: "Awesome Games Studio",
  };
  source.publisher = "Awesome Games Studio";
  source.page_url = "https://store.steampowered.com/app/674750/";
  source.story_source_url =
    "https://store.steampowered.com/app/674750/";
  source.direct_media_url = directMediaUrl;
  source.steam_app_id = "674750";
  source.official_domain_reviewed = true;
  const sourceEvidenceSha256 = writeJson(
    input.sourceEvidencePath,
    source,
  );

  permission.story_id = storyId;
  permission.asset_id = assetId;
  permission.rights_basis = "TRANSFORMATIVE_EDITORIAL_USE";
  permission.rights_holder = "Awesome Games Studio";
  delete permission.evidence_url;
  permission.permission_rule_id =
    "steam_storefront_transformative_editorial_risk_review";
  permission.source_platform = "STEAM";
  permission.review_status = "HUMAN_REVIEW";
  permission.coverage.media_kinds = [mediaKind];
  permission.attribution.text =
    "Source: Steam / Awesome Games Studio";
  permission.operator_risk_decision = {
    decision_type: "HUMAN_REVIEW",
    decision: "ACCEPT_RISK",
    story_id: storyId,
    asset_id: assetId,
    destinations: ["YOUTUBE_SHORTS"],
    use: "TRANSFORMATIVE_EDITORIAL",
    rationale:
      "A short official-store excerpt identifies the exact game and is materially restructured around original reporting. This is an editorial risk decision, not permission or a legal guarantee.",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: "2026-07-28T13:45:00.000Z",
    automatic_clearance: false,
    attribution_is_permission: false,
    fair_use_guaranteed: false,
    source_page_is_licence: false,
  };
  const permissionEvidenceSha256 = writeJson(
    input.permissionEvidencePath,
    permission,
  );

  transformation.story_id = storyId;
  transformation.asset_id = assetId;
  transformation.permission_evidence_sha256 =
    permissionEvidenceSha256;
  transformation.source_audio_disposition = trailer
    ? "REMOVED"
    : "NOT_APPLICABLE";
  transformation.operations = trailer
    ? ["CUT", "REFRAME", "TEXT_OVERLAY"]
    : ["CROP", "KEN_BURNS", "TEXT_OVERLAY"];
  const transformationEvidenceSha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );

  input.manifest.story_id = storyId;
  input.manifest.primary_source_url =
    "https://store.steampowered.com/app/674750/";
  input.manifest.assets[0].asset_id = assetId;
  input.manifest.assets[0].media_type = trailer ? "VIDEO" : "IMAGE";
  input.manifest.assets[0].media_kind = mediaKind;
  input.manifest.assets[0].source.evidence_sha256 =
    sourceEvidenceSha256;
  input.manifest.assets[0].permission.evidence_sha256 =
    permissionEvidenceSha256;
  input.manifest.assets[0].transformation.evidence_sha256 =
    transformationEvidenceSha256;
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );
  return input;
}

function xboxWireFixture() {
  const input = officialScreenshotFixture();
  const storyId = "rss_cabe09fbc0ecebd8";
  const assetId = "xbox-wire-ubisoft-pc-hero";
  const pageUrl =
    "https://news.xbox.com/en-us/2026/07/27/ubisoft-xbox-pc/";
  const source = JSON.parse(
    fs.readFileSync(input.sourceEvidencePath, "utf8"),
  );
  const permission = JSON.parse(
    fs.readFileSync(input.permissionEvidencePath, "utf8"),
  );
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  source.story_id = storyId;
  source.asset_id = assetId;
  source.source_class = "OFFICIAL_XBOX_WIRE_ASSET";
  source.media_kind = "OFFICIAL_PRESS_ASSET";
  source.game = {
    title: "Ubisoft Games on Xbox PC",
    publisher: "Ubisoft",
  };
  source.publisher = "Xbox Wire";
  source.page_url = pageUrl;
  source.story_source_url = pageUrl;
  source.direct_media_url =
    "https://xboxwire.thesourcemediaassets.com/sites/2/2026/07/X_16_9_Card_1920x1080-1-6abc8a4e6baeb7b4e4cd.jpg";
  source.official_domain_reviewed = true;
  const sourceEvidenceSha256 = writeJson(
    input.sourceEvidencePath,
    source,
  );

  permission.story_id = storyId;
  permission.asset_id = assetId;
  permission.rights_basis = "PRESS_KIT_TERMS";
  permission.rights_holder = "Xbox Wire";
  permission.evidence_url = pageUrl;
  permission.permission_rule_id =
    "xbox_wire_first_party_article_editorial_use";
  permission.source_platform = "XBOX_WIRE";
  permission.coverage.media_kinds = ["OFFICIAL_PRESS_ASSET"];
  permission.attribution.text = "Source: Xbox Wire";
  const permissionEvidenceSha256 = writeJson(
    input.permissionEvidencePath,
    permission,
  );

  transformation.story_id = storyId;
  transformation.asset_id = assetId;
  transformation.permission_evidence_sha256 =
    permissionEvidenceSha256;
  const transformationEvidenceSha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );

  input.manifest.story_id = storyId;
  input.manifest.primary_source_url = pageUrl;
  input.manifest.assets[0].asset_id = assetId;
  input.manifest.assets[0].media_kind = "OFFICIAL_PRESS_ASSET";
  input.manifest.assets[0].source.evidence_sha256 =
    sourceEvidenceSha256;
  input.manifest.assets[0].permission.evidence_sha256 =
    permissionEvidenceSha256;
  input.manifest.assets[0].transformation.evidence_sha256 =
    transformationEvidenceSha256;
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );
  return input;
}

test("admits an official game screenshot only through separate source, permission, transformation and materialised hashes", () => {
  const input = officialScreenshotFixture();

  const result = validateGovernedGameMediaAdmission({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: STORY_ID,
    requiredDestinations: ["YOUTUBE_SHORTS"],
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.policy, "GOVERNED_GAME_MEDIA_V1");
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.assets[0].binding, {
    source_evidence_sha256:
      input.manifest.assets[0].source.evidence_sha256,
    source_asset_sha256: input.manifest.assets[0].source.asset_sha256,
    permission_evidence_sha256:
      input.manifest.assets[0].permission.evidence_sha256,
    transformation_evidence_sha256:
      input.manifest.assets[0].transformation.evidence_sha256,
    materialised_asset_sha256:
      input.manifest.assets[0].materialised.sha256,
  });
  assert.equal(
    result.assets[0].materialised.path,
    path.resolve(input.materialisedPath),
  );
  assert.deepEqual(result.required_attributions, [
    {
      text: "Official Nintendo media",
      delivery: ["DESCRIPTION", "ON_SCREEN"],
    },
  ]);
  assert.equal(result.publish_authorised, false);
  assert.equal(result.network_used, false);
});

test("rejects attribution-only evidence because a credit is not permission", () => {
  const input = rewritePermission(
    officialScreenshotFixture(),
    (permission) => {
      permission.rights_basis = "ATTRIBUTION_ONLY";
      permission.evidence_url = "";
      permission.attribution_is_permission = true;
    },
  );

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: STORY_ID,
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_asset_0_attribution_cannot_grant_permission",
        ),
      );
      return true;
    },
  );
});

test("admits user-owned captured gameplay through an accepted ownership attestation", () => {
  const input = officialScreenshotFixture();
  input.manifest.assets[0].media_type = "VIDEO";
  input.manifest.assets[0].media_kind = "USER_OWNED_CAPTURE";
  input.manifest.assets[0].editorial_role = "GAMEPLAY_DETAIL";
  rewriteSource(input, (source) => {
    source.source_class = "USER_OWNED_CAPTURE";
    source.media_kind = "USER_OWNED_CAPTURE";
    source.game = {
      title: "The Alters",
      publisher: "11 bit studios",
    };
    delete source.publisher;
    delete source.page_url;
    delete source.direct_media_url;
    delete source.official_domain_reviewed;
    source.capture_owner = "Pulse Gaming";
    source.captured_by = "MORR";
    source.captured_at = "2026-07-28T13:35:00.000Z";
  });
  rewritePermission(input, (permission) => {
    permission.rights_basis = "OWNED_CAPTURE";
    permission.rights_holder = "Pulse Gaming";
    delete permission.evidence_url;
    permission.ownership_attested = true;
    permission.capture_owner = "Pulse Gaming";
    permission.coverage.media_kinds = ["USER_OWNED_CAPTURE"];
    permission.attribution = {
      required: false,
      text: "",
      delivery: [],
    };
  });
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  transformation.source_audio_disposition = "REMOVED";
  input.manifest.assets[0].transformation.evidence_sha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );

  const result = validateGovernedGameMediaAdmission({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: STORY_ID,
    requiredDestinations: ["YOUTUBE_SHORTS"],
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.assets[0].media_kind, "USER_OWNED_CAPTURE");
  assert.equal(result.assets[0].rights_basis, "OWNED_CAPTURE");
  assert.deepEqual(result.required_attributions, []);
  assert.equal(result.assets[0].transformation.source_audio_disposition, "REMOVED");
});

test("the existing governed source-media boundary accepts the reusable game policy without an FFXIV allowlist", () => {
  const input = officialScreenshotFixture();

  const result = validateGovernedSourceMediaManifest({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: STORY_ID,
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.policy, "GOVERNED_GAME_MEDIA_V1");
  assert.equal(result.components.length, 1);
  assert.equal(
    result.components[0].component_id,
    "switch-2-official-screenshot-01",
  );
  assert.equal(result.components[0].source.publisher, "Nintendo");
  assert.equal(
    result.components[0].asset.sha256,
    input.manifest.assets[0].materialised.sha256,
  );
  assert.equal(
    result.components[0].admission_binding.permission_evidence_sha256,
    input.manifest.assets[0].permission.evidence_sha256,
  );
});

test("admits YAZD Steam media only through an exact human-reviewed transformative editorial risk decision", () => {
  for (const trailer of [false, true]) {
    const input = yazdSteamFixture({ trailer });

    const result = validateGovernedGameMediaAdmission({
      manifestPath: input.manifestPath,
      expectedManifestSha256: input.manifestSha256,
      expectedStoryId: "rss_e82fbaff7bc3650b",
      requiredDestinations: ["YOUTUBE_SHORTS"],
      validationBoundaryAt: VALIDATION_BOUNDARY,
    });

    assert.equal(
      result.assets[0].game.title,
      "Yet Another Zombie Defense HD",
    );
    assert.equal(
      result.assets[0].source.page_url,
      "https://store.steampowered.com/app/674750/",
    );
    assert.match(
      result.assets[0].source.direct_media_url,
      /steamstatic\.com\/(?:store_item_assets\/steam\/apps|store_trailers)\/674750\//,
    );
    assert.equal(
      result.assets[0].rights_basis,
      "TRANSFORMATIVE_EDITORIAL_USE",
    );
    assert.deepEqual(result.assets[0].permission.risk_decision, {
      decision_type: "HUMAN_REVIEW",
      decision: "ACCEPT_RISK",
      story_id: "rss_e82fbaff7bc3650b",
      asset_id: trailer
        ? "yazd-steam-trailer-119861"
        : "yazd-steam-screenshot-c64f69",
      destinations: ["YOUTUBE_SHORTS"],
      use: "TRANSFORMATIVE_EDITORIAL",
      rationale:
        "A short official-store excerpt identifies the exact game and is materially restructured around original reporting. This is an editorial risk decision, not permission or a legal guarantee.",
      reviewed_by: "pulse-editorial-rights-review",
      reviewed_at: "2026-07-28T13:45:00.000Z",
      automatic_clearance: false,
      attribution_is_permission: false,
      fair_use_guaranteed: false,
      source_page_is_licence: false,
    });
  }
});

test("rejects a broad Steam trailer excerpt even after a human risk decision", () => {
  const input = yazdSteamFixture({ trailer: true });
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  transformation.usage_seconds = [0, 12];
  input.manifest.assets[0].transformation.evidence_sha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: "rss_e82fbaff7bc3650b",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_asset_0_steam_excerpt_not_narrow",
        ),
      );
      return true;
    },
  );
});

test("requires source audio to be removed from a Steam trailer excerpt", () => {
  const input = yazdSteamFixture({ trailer: true });
  const transformation = JSON.parse(
    fs.readFileSync(input.transformationEvidencePath, "utf8"),
  );
  transformation.source_audio_disposition = "MUTED";
  input.manifest.assets[0].transformation.evidence_sha256 = writeJson(
    input.transformationEvidencePath,
    transformation,
  );
  input.manifestSha256 = writeJson(
    input.manifestPath,
    input.manifest,
  );

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: "rss_e82fbaff7bc3650b",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_asset_0_steam_source_audio_not_removed",
        ),
      );
      return true;
    },
  );
});

test("rejects a Steam store page presented as platform promotional permission", () => {
  const input = rewritePermission(
    yazdSteamFixture(),
    (permission) => {
      permission.rights_basis = "PLATFORM_PROMOTIONAL_TERMS";
      permission.evidence_url =
        "https://store.steampowered.com/app/674750/";
      permission.permission_rule_id =
        "steam_storefront_promotional_editorial_use";
      permission.review_status = "ACCEPTED";
      delete permission.operator_risk_decision;
    },
  );

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: "rss_e82fbaff7bc3650b",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.some((code) =>
          code.startsWith(
            "game_media_asset_0_steam_human_risk_",
          ),
        ),
      );
      return true;
    },
  );
});

test("fails closed when any human Steam risk-decision binding or disclaimer is changed", () => {
  const cases = [
    (risk) => {
      risk.story_id = "other-story";
    },
    (risk) => {
      risk.asset_id = "other-asset";
    },
    (risk) => {
      risk.destinations = ["INSTAGRAM_REELS"];
    },
    (risk) => {
      risk.use = "PROMOTIONAL_ADVERTISING";
    },
    (risk) => {
      risk.rationale = "because";
    },
    (risk) => {
      risk.reviewed_by = "unbound-reviewer";
    },
    (risk) => {
      risk.reviewed_at = "2026-07-28T13:44:00.000Z";
    },
    (risk) => {
      risk.automatic_clearance = true;
    },
    (risk) => {
      risk.attribution_is_permission = true;
    },
    (risk) => {
      risk.fair_use_guaranteed = true;
    },
    (risk) => {
      risk.source_page_is_licence = true;
    },
  ];

  for (const mutate of cases) {
    const input = rewritePermission(
      yazdSteamFixture(),
      (permission) => mutate(permission.operator_risk_decision),
    );
    assert.throws(
      () =>
        validateGovernedGameMediaAdmission({
          manifestPath: input.manifestPath,
          expectedManifestSha256: input.manifestSha256,
          expectedStoryId: "rss_e82fbaff7bc3650b",
          requiredDestinations: ["YOUTUBE_SHORTS"],
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "game_media_asset_0_steam_human_risk_review_invalid",
          ),
        );
        return true;
      },
    );
  }
});

test("holds generic cards and third-party reuploads outside the governed game-media source families", () => {
  for (const candidate of [
    {
      source_class: "GENERATED_GENERIC_CARD",
      page_url: "https://pulse.invalid/cards/yazd",
      direct_media_url: "https://pulse.invalid/cards/yazd.png",
    },
    {
      source_class: "THIRD_PARTY_REUPLOAD",
      page_url: "https://www.youtube.com/watch?v=reuploaded-yazd",
      direct_media_url:
        "https://i.ytimg.com/vi/reuploaded-yazd/maxresdefault.jpg",
    },
  ]) {
    const input = yazdSteamFixture();
    rewriteSource(input, (source) => Object.assign(source, candidate));

    assert.throws(
      () =>
        validateGovernedGameMediaAdmission({
          manifestPath: input.manifestPath,
          expectedManifestSha256: input.manifestSha256,
          expectedStoryId: "rss_e82fbaff7bc3650b",
          requiredDestinations: ["YOUTUBE_SHORTS"],
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "game_media_asset_0_unsupported_source_class",
          ),
        );
        return true;
      },
    );
  }
});

test("accepts the current canonical YAZD Steam page slug while keeping app 674750 bound", () => {
  const input = yazdSteamFixture();
  const canonicalPage =
    "https://store.steampowered.com/app/674750/Yet_Another_Zombie_Defense_HD/";
  input.manifest.primary_source_url = canonicalPage;
  rewriteSource(input, (source) => {
    source.page_url = canonicalPage;
    source.story_source_url = canonicalPage;
  });

  const result = validateGovernedGameMediaAdmission({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: "rss_e82fbaff7bc3650b",
    requiredDestinations: ["YOUTUBE_SHORTS"],
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.assets[0].source.page_url, canonicalPage);
});

test("admits first-party Xbox Wire hero media only when it is bound to the exact standby story page", () => {
  const input = xboxWireFixture();

  const result = validateGovernedGameMediaAdmission({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: "rss_cabe09fbc0ecebd8",
    requiredDestinations: ["YOUTUBE_SHORTS"],
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.assets[0].game.publisher, "Ubisoft");
  assert.equal(
    result.assets[0].source.page_url,
    "https://news.xbox.com/en-us/2026/07/27/ubisoft-xbox-pc/",
  );
  assert.match(
    result.assets[0].source.direct_media_url,
    /^https:\/\/xboxwire\.thesourcemediaassets\.com\/sites\/2\//,
  );
  assert.equal(result.assets[0].rights_basis, "PRESS_KIT_TERMS");
});

test("rejects Xbox Wire media whose evidence is rebound to a different story page", () => {
  const input = xboxWireFixture();
  rewriteSource(input, (source) => {
    source.story_source_url =
      "https://news.xbox.com/en-us/2026/07/27/a-different-story/";
  });

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: "rss_cabe09fbc0ecebd8",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_asset_0_story_source_binding_mismatch",
        ),
      );
      return true;
    },
  );
});

test("accepts Xbox-owned CDN article media and rejects a scraped outlet replacement", () => {
  const microsoftCdn = xboxWireFixture();
  rewriteSource(microsoftCdn, (source) => {
    source.direct_media_url =
      "https://cms-assets.xboxservices.com/assets/64/4a/644a1aaf-9122-472e-9a75-6986268cfa84.jpg";
  });
  assert.doesNotThrow(() =>
    validateGovernedGameMediaAdmission({
      manifestPath: microsoftCdn.manifestPath,
      expectedManifestSha256: microsoftCdn.manifestSha256,
      expectedStoryId: "rss_cabe09fbc0ecebd8",
      requiredDestinations: ["YOUTUBE_SHORTS"],
      validationBoundaryAt: VALIDATION_BOUNDARY,
    }),
  );

  const scraped = xboxWireFixture();
  rewriteSource(scraped, (source) => {
    source.direct_media_url =
      "https://assets.ign.com/images/reuploaded-ubisoft-xbox-pc.jpg";
  });
  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: scraped.manifestPath,
        expectedManifestSha256: scraped.manifestSha256,
        expectedStoryId: "rss_cabe09fbc0ecebd8",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: VALIDATION_BOUNDARY,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_asset_0_xbox_direct_media_mismatch",
        ),
      );
      return true;
    },
  );
});

test("fails closed when any source, permission, transformation or materialised hash chain member is changed", () => {
  const cases = [
    {
      file: (input) => input.sourceAssetPath,
      code: "game_media_asset_0_source_asset_sha256_mismatch",
    },
    {
      file: (input) => input.sourceEvidencePath,
      code: "game_media_asset_0_source_evidence_sha256_mismatch",
    },
    {
      file: (input) => input.permissionEvidencePath,
      code: "game_media_asset_0_permission_evidence_sha256_mismatch",
    },
    {
      file: (input) => input.transformationEvidencePath,
      code: "game_media_asset_0_transformation_evidence_sha256_mismatch",
    },
    {
      file: (input) => input.materialisedPath,
      code: "game_media_asset_0_materialised_asset_sha256_mismatch",
    },
  ];
  for (const candidate of cases) {
    const input = yazdSteamFixture();
    fs.appendFileSync(candidate.file(input), Buffer.from("tampered"));
    assert.throws(
      () =>
        validateGovernedGameMediaAdmission({
          manifestPath: input.manifestPath,
          expectedManifestSha256: input.manifestSha256,
          expectedStoryId: "rss_e82fbaff7bc3650b",
          requiredDestinations: ["YOUTUBE_SHORTS"],
          validationBoundaryAt: VALIDATION_BOUNDARY,
        }),
      (error) => {
        assert.ok(error.codes.includes(candidate.code));
        return true;
      },
    );
  }
});

test("cannot legitimise evidence with an operator-supplied future validation boundary", () => {
  const input = yazdSteamFixture();
  const futureBoundary = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  assert.throws(
    () =>
      validateGovernedGameMediaAdmission({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: "rss_e82fbaff7bc3650b",
        requiredDestinations: ["YOUTUBE_SHORTS"],
        validationBoundaryAt: futureBoundary,
      }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "game_media_validation_boundary_in_future",
        ),
      );
      return true;
    },
  );
});

test("the read-only operator command proves a YAZD admission without external side effects", () => {
  const input = yazdSteamFixture({ trailer: true });
  const command = spawnSync(
    process.execPath,
    [
      path.resolve(
        __dirname,
        "../../tools/governed-game-media-admission.js",
      ),
      "--manifest",
      input.manifestPath,
      "--sha256",
      input.manifestSha256,
      "--story",
      "rss_e82fbaff7bc3650b",
      "--boundary",
      VALIDATION_BOUNDARY,
      "--destination",
      "YOUTUBE_SHORTS",
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(command.stdout);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.policy, "GOVERNED_GAME_MEDIA_V1");
  assert.equal(result.assets[0].asset_id, "yazd-steam-trailer-119861");
  assert.equal(
    result.assets[0].permission_review_status,
    "HUMAN_REVIEW",
  );
  assert.equal(
    result.assets[0].operator_risk_decision.decision,
    "ACCEPT_RISK",
  );
  assert.equal(
    result.assets[0].operator_risk_decision.fair_use_guaranteed,
    false,
  );
  assert.equal(
    result.assets[0].operator_risk_decision.source_page_is_licence,
    false,
  );
  assert.deepEqual(result.safety, {
    acquisition_performed: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    live_publish_attempted: false,
    network_used: false,
  });
});
