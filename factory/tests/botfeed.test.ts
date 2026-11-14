import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { feedBotPost, maskSecrets, messageText } from "../src/botfeed.ts";

test("bot feed: one masked JSON line per post, embeds included", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "feed-")), "posts.jsonl");
  process.env.BOT_FEED_FILE = file;
  try {
    feedBotPost("", { content: "hi https://discord.com/api/webhooks/123/abcDEF", embeds: [{ title: "Upload failed", description: "key=sk-ant-abcdefghijklmnop123" }] }, 1_700_000_000_000);
    const [row] = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(row.at, 1_700_000_000);
    assert.equal(row.channel, "not-configured");
    assert.match(row.text, /Upload failed/);
    assert.doesNotMatch(row.text, /abcDEF|sk-ant/);
  } finally {
    delete process.env.BOT_FEED_FILE;
  }
});

test("bot feed: masking keeps ordinary words and joins embed fields", () => {
  assert.equal(maskSecrets("GTA 6 Short published at 19:00"), "GTA 6 Short published at 19:00");
  assert.equal(messageText({ embeds: [{ title: "T", fields: [{ name: "a", value: "b" }] }] }), "T\na: b");
});
