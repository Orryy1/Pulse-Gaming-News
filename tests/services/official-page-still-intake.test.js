"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bindOfficialPageStillRightsDecisions,
  buildOfficialPageStillIntakeEntries,
} = require("../../lib/official-page-still-intake");
const {
  buildOfficialSourceIntakeReport,
} = require("../../lib/official-source-intake");

const XBOX_PRODUCT_PAGE =
  "https://www.xbox.com/en-US/accessories/forza-horizon-6-xbox-wireless-controller-and-wireless-headset";

function xboxControllerStory() {
  return {
    story_id: "1sqpa86",
    id: "1sqpa86",
    canonical_subject: "Xbox Controller",
    canonical_game: "Xbox Controller",
    selected_title: "Xbox Controller Deal Has One Catch",
    narration_script:
      "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
    primary_source: "Xbox",
    primary_source_url: XBOX_PRODUCT_PAGE,
  };
}

test("official page still intake extracts first-party Xbox product images as accepted official still rows", () => {
  const html = `
    <meta property="og:image" content="https://cms-assets.xboxservices.com/assets/15/e8/share.jpg?n=394587762_Share-Image-0_Family_200x200_01.jpg">
    <script>
      window.__assets = [
        "https:\\/\\/cms-assets.xboxservices.com\\/assets\\/d4\\/d4\\/d4d49e86-20af-4be4-bf1c-7906d502cd0d.jpg?n=394587762_Image-Hero-768_1920x1200_01.jpg\\\\",
        "https://cms-assets.xboxservices.com/assets/15/0e/150ea685-6aa6-4562-bede-fd7d23d238e5.jpg?n=394587762_Image-Hero-0_767x500_01.jpg",
        "https://cms-assets.xboxservices.com/assets/4d/75/4d753be0-a00a-4cd9-81f0-724421dc98f1.jpg?n=394587762_Content-Placement-0_01-A_740x417_01.jpg",
        "https://cms-assets.xboxservices.com/assets/01/c2/01c201d8-ecee-42a3-a3c1-f2df8674e795.jpg?n=394587762_Gallery_01-A_1350x759_01.jpg",
        "https://cms-assets.xboxservices.com/assets/f7/21/f7211921-2a00-42d6-a648-7292f32ef2eb.jpg?n=394587762_Gallery_02-A_1350x759_01.jpg",
        "https://cms-assets.xboxservices.com/assets/4e/05/4e053846-a7b6-4d5a-bb39-112fb223c404.jpg?n=XGP-Cross-Sell_Page-Hero-1084_04-2026_1920x720.jpg",
        "https://assets.xboxservices.com/assets/92/6f/926f1ec2-236d-4067-bd90-5bb1b2420790.png?n=Accessories_Panes-Triptic-Small-1084-0_White-elite-series-2_353x353.png",
        "https://example.com/not-official-xbox-controller.jpg"
      ];
    </script>
  `;

  const entries = buildOfficialPageStillIntakeEntries({
    story: xboxControllerStory(),
    pageUrl: XBOX_PRODUCT_PAGE,
    html,
    maxAssets: 4,
    generatedAt: "2026-05-28T15:20:00.000Z",
  });

  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => entry.story_id === "1sqpa86"));
  assert.ok(entries.every((entry) => entry.source_type === "official_press_kit_stills"));
  assert.ok(entries.every((entry) => entry.source_owner === "Xbox official product page"));
  assert.ok(entries.every((entry) => entry.official_source_url.includes("cms-assets.xboxservices.com")));
  assert.ok(entries.every((entry) => entry.official_source_url.includes("394587762_")));
  assert.ok(entries.every((entry) => !/Cross-Sell|Accessories_Panes|Share-Image/i.test(entry.official_source_url)));
  assert.equal(new Set(entries.map((entry) => entry.source_family)).size, entries.length);

  const report = buildOfficialSourceIntakeReport({
    stories: [xboxControllerStory()],
    entries,
    generatedAt: "2026-05-28T15:21:00.000Z",
  });

  assert.equal(report.summary.accepted, 4);
  assert.equal(report.summary.rejected, 0);
  assert.ok(report.accepted_references.every((reference) => reference.source_type === "official_press_kit_stills"));
  assert.ok(report.accepted_references.every((reference) => reference.downloads_allowed === false));
});

test("official page still intake scopes Xbox Store images to the page product payload", () => {
  const pageUrl =
    "https://www.xbox.com/en-US/games/store/conker-live-and-reloaded/BVFB8CBS75R6";
  const targetHero =
    "https://store-images.s-microsoft.com/image/apps.42431.target-product.hero";
  const targetScreenshotOne =
    "https://store-images.s-microsoft.com/image/apps.23314.target-product.screen-one";
  const targetScreenshotTwo =
    "https://store-images.s-microsoft.com/image/apps.23799.target-product.screen-two";
  const unrelatedHero =
    "https://store-images.s-microsoft.com/image/apps.99999.unrelated-product.hero";
  const preloadedState = {
    core2: {
      products: {
        productSummaries: {
          BVFB8CBS75R6: {
            productId: "BVFB8CBS75R6",
            title: "Conker: Live and Reloaded",
            images: {
              boxArt: {
                url: "https://store-images.s-microsoft.com/image/apps.50097.target-product.box",
                width: 1080,
                height: 1080,
              },
              superHeroArt: { url: targetHero, width: 1920, height: 1080 },
              screenshots: [
                { url: targetScreenshotOne, width: 1920, height: 1080 },
                { url: targetScreenshotTwo, width: 1920, height: 1080 },
              ],
            },
          },
          UNRELATED123: {
            productId: "UNRELATED123",
            title: "Unrelated Game",
            images: {
              superHeroArt: { url: unrelatedHero, width: 1920, height: 1080 },
            },
          },
        },
      },
    },
  };
  const html = `
    <img src="https://cms-assets.xboxservices.com/assets/generic.jpg?n=PCGP-TitleHeroArt-1920x1080.jpg">
    <script>window.__PRELOADED_STATE__ = ${JSON.stringify(preloadedState)};</script>
  `;

  const entries = buildOfficialPageStillIntakeEntries({
    story: {
      story_id: "rss_5efb04ad7c4889e1",
      canonical_subject: "Xbox",
      selected_title: "4 Xbox Classics Hit PC, Achievements Come Later",
    },
    pageUrl,
    html,
    maxAssets: 3,
    generatedAt: "2026-07-23T07:00:00.000Z",
  });

  assert.equal(entries.length, 3);
  assert.deepEqual(
    new Set(entries.map((entry) => entry.official_source_url)),
    new Set([targetHero, targetScreenshotOne, targetScreenshotTwo]),
  );
  assert.ok(entries.every((entry) => entry.product_id === "BVFB8CBS75R6"));
  assert.ok(entries.every((entry) => entry.product_title === "Conker: Live and Reloaded"));
  assert.ok(entries.every((entry) => entry.scoped_product_payload === true));
  assert.ok(entries.every((entry) => entry.downloads_allowed === false));
  assert.ok(!entries.some((entry) => /PCGP|generic|unrelated/i.test(entry.official_source_url)));
});

test("official page still intake binds a new product image to an existing held rights decision without stale asset evidence", () => {
  const pageUrl =
    "https://www.xbox.com/en-US/games/store/conker-live-and-reloaded/BVFB8CBS75R6";
  const candidate = {
    story_id: "rss_5efb04ad7c4889e1",
    entity: "Xbox",
    source_type: "official_press_kit_stills",
    source_owner: "Xbox official product page",
    source_family: "rss_5efb04ad7c4889e1_bvfb8cbs75r6_screenshot_03",
    official_source_url:
      "https://store-images.s-microsoft.com/image/apps.37949.target-product.screen-three",
    source_title: "Conker: Live and Reloaded official product image: screenshot 03",
    evidence_of_officialness: "Image is declared in the hash-bound product payload.",
    entity_match_notes: "The official product payload is for the named title in the story.",
    reference_page_url: pageUrl,
    downloads_allowed: false,
    product_id: "BVFB8CBS75R6",
    product_title: "Conker: Live and Reloaded",
    scoped_product_payload: true,
  };
  const template = {
    story_id: "rss_5efb04ad7c4889e1",
    entity: "Conker: Live and Reloaded",
    source_type: "official_press_kit_stills",
    source_owner: "Microsoft Studios",
    source_url:
      "https://store-images.s-microsoft.com/image/apps.23314.target-product.screen-one",
    local_source_path: "output/old-capture.jpg",
    source_asset_sha256: "a".repeat(64),
    source_asset_size_bytes: 123456,
    reference_page_url: pageUrl.toLowerCase(),
    product_page_evidence_path: "output/source/conker-xbox-store.html",
    product_page_evidence_sha256: "b".repeat(64),
    product_page_evidence_size_bytes: 700000,
    licence_basis: "microsoft_game_content_usage_rules_youtube_ad_program",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube"],
    restricted_platforms: ["tiktok", "instagram", "facebook", "x"],
    commercial_use_allowed: true,
    local_materialization_allowed: true,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
    approval_status: "approved_for_local_materialization_only",
    rights_status: "conditional_youtube_ad_program_scope",
    risk_score: 0.45,
    required_rules_link: "https://www.xbox.com/en-us/developers/rules",
    required_public_notice: "Conker Copyright Microsoft Corporation.",
    policy_evidence_path: "output/source/xbox-game-content-usage-rules.html",
    policy_evidence_sha256: "c".repeat(64),
    policy_evidence_size_bytes: 370000,
  };

  const report = bindOfficialPageStillRightsDecisions({
    entries: [candidate],
    rightsTemplates: [template],
    generatedAt: "2026-07-23T07:05:00.000Z",
  });

  assert.equal(report.summary.bound, 1);
  assert.equal(report.summary.rejected, 0);
  const bound = report.bound_entries[0];
  assert.equal(bound.official_source_url, candidate.official_source_url);
  assert.equal(bound.licence_basis, template.licence_basis);
  assert.deepEqual(bound.allowed_platforms, ["youtube"]);
  assert.equal(bound.live_publish_allowed, false);
  assert.equal(bound.requires_human_legal_review_before_publish, true);
  assert.equal(bound.product_page_evidence_sha256, "b".repeat(64));
  assert.equal(bound.policy_evidence_sha256, "c".repeat(64));
  assert.equal(bound.rights_binding_status, "held_decision_hash_bound");
  assert.equal("local_source_path" in bound, false);
  assert.equal("source_asset_sha256" in bound, false);
  assert.equal("source_asset_size_bytes" in bound, false);
});

test("official page still intake resolves same-site Rockstar relative image assets", () => {
  const story = {
    story_id: "rss_e2b3643dbce03eaf",
    id: "rss_e2b3643dbce03eaf",
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    selected_title: "GTA 6 Preorders Begin June 25",
    title: "GTA 6 Preorders Begin June 25",
    primary_source: "Rockstar Games",
    primary_source_url: "https://www.rockstargames.com/VI/media",
  };
  const html = `
    <script>
      self.__next_f.push(["/VI/_next/static/media/hero.0q5-tr6h86ai7.jpg?akim=1&imdensity=1&imwidth=1600"]);
      self.__next_f.push(["/VI/_next/static/media/hero.0q5-tr6h86ai7.jpg?akim=1&imdensity=1&imwidth=3840"]);
      self.__next_f.push(["https://media.rockstargames.com/VI/screenshots/GTAVI_Screenshot_1920x1080.jpg"]);
      self.__next_f.push(["https://example.com/GTAVI_wrong_host_3840x2160.jpg"]);
    </script>
  `;

  const entries = buildOfficialPageStillIntakeEntries({
    story,
    pageUrl: "https://www.rockstargames.com/VI/media",
    html,
    maxAssets: 4,
    generatedAt: "2026-06-22T15:30:00.000Z",
  });

  assert.equal(entries.length, 2);
  assert.ok(entries.some((entry) =>
    entry.official_source_url ===
      "https://www.rockstargames.com/VI/_next/static/media/hero.0q5-tr6h86ai7.jpg?akim=1&imdensity=1&imwidth=3840",
  ));
  assert.ok(!entries.some((entry) => /imwidth=1600/.test(entry.official_source_url)));
  assert.ok(entries.some((entry) => entry.official_source_url.includes("media.rockstargames.com/VI/screenshots/")));
  assert.ok(entries.every((entry) => entry.entity === "Grand Theft Auto VI"));
  assert.ok(entries.every((entry) => entry.source_owner === "Grand Theft Auto VI product page"));
});
