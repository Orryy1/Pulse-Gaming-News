"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const channel = require("../../channels/pulse-gaming");

test("Pulse speaks global gaming prices in US dollars and keeps region-neutral offers uncluttered", () => {
  assert.match(
    channel.systemPrompt,
    /Narration defaults to verified US dollars \(\$\)/,
  );
  assert.match(
    channel.systemPrompt,
    /For global discounts or free offers, lead with the region-neutral saving/,
  );
  assert.match(
    channel.systemPrompt,
    /verified USD first and GBP second/,
  );
  assert.match(
    channel.systemPrompt,
    /Never convert or invent a regional price/,
  );
  assert.match(
    channel.evergreenVerdictPrompt,
    /Narrate verified prices in US dollars/,
  );
  assert.match(
    channel.evergreenVerdictPrompt,
    /USD first and GBP second/,
  );
  assert.match(
    channel.evergreenVerdictPrompt,
    /Never convert or invent a regional price/,
  );
});
