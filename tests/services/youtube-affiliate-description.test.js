"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMetadata } = require("../../upload_youtube");

test("buildMetadata renders a targeted affiliate stack in the description", () => {
  const meta = buildMetadata({
    title: "Pokemon Go event announced",
    full_script:
      "Pokemon Go has a new event. Players can catch more monsters in the new update. Follow Pulse Gaming for more gaming news.",
    affiliate_links: [
      {
        label: "Pokemon Go Plus+",
        url: "https://www.amazon.co.uk/s?k=Pokemon%20Go%20Plus%20Plus&tag=pulsegaming-21",
      },
      {
        label: "Pokemon TCG",
        url: "https://www.amazon.co.uk/s?k=Pokemon%20TCG&tag=pulsegaming-21",
      },
    ],
  });

  assert.match(meta.description, /Related links:/);
  assert.match(meta.description, /As an Amazon Associate I earn from qualifying purchases\./);
  assert.match(meta.description, /Pokemon Go Plus\+/);
  assert.match(meta.description, /Pokemon TCG/);
  assert.equal((meta.description.match(/tag=pulsegaming-21/g) || []).length, 2);
});

test("buildMetadata suppresses stale affiliate fields when the approved action forbids affiliate links", () => {
  const meta = buildMetadata({
    title: "Four Xbox classics hit PC",
    youtube_description:
      "Four original Xbox games have joined Xbox Backward Compatibility on PC.",
    full_script:
      "Four original Xbox games have joined Xbox Backward Compatibility on PC. Existing digital console licences carry over, while achievement support is coming later. Follow Pulse Gaming for sharp gaming news that is worth your time.",
    suppress_affiliate_links: true,
    affiliate_links: [
      {
        label: "Play Xbox games",
        url: "https://www.amazon.co.uk/s?k=Xbox&tag=pulsegaming-21",
      },
    ],
    affiliate_url:
      "https://www.amazon.co.uk/s?k=Xbox&tag=pulsegaming-21",
  });

  assert.doesNotMatch(meta.description, /Amazon Associate/i);
  assert.doesNotMatch(meta.description, /amazon\.co\.uk/i);
  assert.doesNotMatch(meta.description, /Related links:/i);
});
