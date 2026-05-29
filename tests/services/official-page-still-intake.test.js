"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
