"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMetadata } = require("../../upload_youtube");

test("Pulse v1 freezes affiliate links in public YouTube metadata", () => {
  const meta = buildMetadata({
    channel_id: "pulse-gaming",
    title: "Pokemon Go event announced",
    full_script:
      "Pokemon Go has a new event. Players can catch more monsters in the new update.",
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

  assert.doesNotMatch(meta.description, /Related links:/);
  assert.doesNotMatch(meta.description, /Pokemon Go Plus\+/);
  assert.doesNotMatch(meta.description, /Pokemon TCG/);
  assert.doesNotMatch(meta.description, /tag=pulsegaming-21/);
});
