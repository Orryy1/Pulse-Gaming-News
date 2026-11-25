import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shortCodexCapMs } from "../src/pipeline.ts";

test("a slot-bound Short's step caps Codex at CODEX_SHORT_TIMEOUT_MINUTES; long videos and evergreen are not capped", () => {
  const cfg = { codexShortTimeoutMinutes: 12 };
  // The search lane's Shorts are news-lane episodes (src/searchq/step.ts).
  assert.equal(shortCodexCapMs(cfg, { lane: "news" }), 12 * 60_000);
  assert.equal(shortCodexCapMs(cfg, { lane: "news_breaking" }), 12 * 60_000);
  assert.equal(shortCodexCapMs(cfg, { lane: "cutdown" }), 12 * 60_000);
  // evergreen.write's good runs reach 18 min (13-25 Nov), and evergreen Shorts are made days ahead.
  assert.equal(shortCodexCapMs(cfg, { lane: "evergreen" }), undefined);
  assert.equal(shortCodexCapMs(cfg, { lane: "longform" }), undefined);
  // 0 switches the cap off.
  assert.equal(shortCodexCapMs({ codexShortTimeoutMinutes: 0 }, { lane: "news" }), undefined);
});

test("advance wraps every episode step in the Short cap", () => {
  const src = fs.readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8");
  const advance = src.slice(src.indexOf("export async function advance("), src.indexOf("export function shortCodexCapMs("));
  assert.match(advance, /withCodexCap\(shortCodexCapMs\(s\.cfg, ep\), \(\) =>\s*withLearn\(s, ep, \(run\) => advanceStep\(run, ep\)\)/);
});
