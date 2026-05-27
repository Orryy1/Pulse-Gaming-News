"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { postTemplate } = require("../../blog/templates");

test("blog post template shows Amazon associate disclosure before affiliate links", () => {
  const html = postTemplate({
    title: "Pokemon Go event announced",
    slug: "pokemon-go-event",
    description: "Pokemon Go event.",
    html: "<p>Pokemon Go has a confirmed event.</p>",
    publishedAt: "2026-05-08T10:00:00.000Z",
    story: {
      affiliate_links: [
        {
          label: "Pokemon Go Plus+",
          url: "https://www.amazon.co.uk/s?k=Pokemon%20Go%20Plus%20Plus&tag=pulsegaming-21",
        },
      ],
    },
  });

  assert.match(html, /As an Amazon Associate I earn from qualifying purchases\./);
  assert.match(html, /rel="noopener noreferrer sponsored"/);
  assert.ok(
    html.indexOf("As an Amazon Associate") <
      html.indexOf("Pokemon Go Plus+"),
  );
});
