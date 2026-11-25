import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elevenLabsCreditsLeft,
  resetElevenLabsCreditsCache,
} from "../src/voice/index.ts";

const ok = () =>
  new Response(JSON.stringify({ character_count: 100, character_limit: 1000 }), { status: 200 });

function stub(seq: Array<() => Response>) {
  let i = 0;
  globalThis.fetch = (async () => {
    const f = seq[Math.min(i++, seq.length - 1)]!;
    return f();
  }) as typeof fetch;
  return () => i;
}

test("a 500 then an answer still gives the balance", async () => {
  resetElevenLabsCreditsCache();
  const calls = stub([() => new Response("", { status: 500 }), ok]);
  assert.equal(await elevenLabsCreditsLeft("k", { waitMs: 1 }), 900);
  assert.equal(calls(), 2);
});

test("an unanswered check uses a balance from the last two hours", async () => {
  resetElevenLabsCreditsCache();
  let t = 1_000_000;
  stub([ok]);
  assert.equal(await elevenLabsCreditsLeft("k", { waitMs: 1, now: () => t }), 900);
  stub([() => { throw new Error("timeout"); }]);
  t += 60 * 60 * 1000;
  assert.equal(await elevenLabsCreditsLeft("k", { waitMs: 1, now: () => t }), 900);
  t += 2 * 60 * 60 * 1000;
  assert.equal(await elevenLabsCreditsLeft("k", { waitMs: 1, now: () => t }), undefined);
});

test("a bad key never falls back to the remembered balance", async () => {
  resetElevenLabsCreditsCache();
  stub([ok]);
  await elevenLabsCreditsLeft("k", { waitMs: 1 });
  stub([() => new Response("", { status: 401 })]);
  assert.equal(await elevenLabsCreditsLeft("k", { waitMs: 1 }), undefined);
});

// ELEVENLABS_BALANCE_STALE_HOURS: the balance kept on disk across restarts (18 Nov: two restarts during a subscription
// blip stopped 5 Shorts with 619,000 characters left).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  elevenLabsBalance,
  elevenLabsBalanceFile,
  noteElevenLabsSpend,
  UNSEEN_CHARS_PER_DAY,
} from "../src/voice/index.ts";

const big = () =>
  new Response(JSON.stringify({ character_count: 380_000, character_limit: 1_000_000 }), { status: 200 });
const down = () => {
  throw new Error("This operation was aborted");
};
const HOUR = 60 * 60 * 1000;

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "elbal-")), "elevenlabs_balance.json");
}

test("a live answer is kept on disk", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  stub([big]);
  const b = await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => 5_000 });
  assert.deepEqual(b, { left: 620_000, source: "live", ageMs: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { left: 620_000, at: 5_000 });
});

test("after a restart, an unanswered check uses the disk reading less the unseen-spend allowance", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  let t = 1_000_000;
  stub([big]);
  await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => t });
  resetElevenLabsCreditsCache(); // the restart
  stub([down]);
  t += 6 * HOUR;
  const b = await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => t });
  assert.equal(b?.source, "disk");
  assert.equal(b?.left, 620_000 - Math.ceil(UNSEEN_CHARS_PER_DAY / 4));
  assert.equal(b?.ageMs, 6 * HOUR);
});

test("a fresh disk reading still takes off at least an hour of unseen spend", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ left: 100_000, at: 1_000 }));
  stub([down]);
  const b = await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => 1_000 + 60_000 });
  assert.equal(b?.left, 100_000 - Math.ceil(UNSEEN_CHARS_PER_DAY / 24));
});

test("a disk reading older than the window, or with the setting at 0, is not used", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ left: 620_000, at: 0 }));
  stub([down]);
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => 25 * HOUR }), undefined);
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 0, now: () => HOUR }), undefined);
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, now: () => HOUR }), undefined);
});

test("a bad key never falls back to the disk reading", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ left: 620_000, at: 0 }));
  stub([() => new Response("", { status: 401 })]);
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => HOUR }), undefined);
});

test("a missing or broken file is no balance, never a crash", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  stub([down]);
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR }), undefined);
  fs.writeFileSync(file, "{not json");
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR }), undefined);
  fs.writeFileSync(file, JSON.stringify({ left: "lots", at: 0 }));
  assert.equal(await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR }), undefined);
});

test("spend is taken off the remembered balance in memory and on disk, keeping the reading's time", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  let t = 1_000_000;
  stub([big]);
  await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => t });
  await noteElevenLabsSpend(900, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { left: 619_100, at: 1_000_000 });
  stub([down]);
  t += HOUR;
  const mem = await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => t });
  assert.deepEqual(mem, { left: 619_100, source: "memory", ageMs: HOUR });
  await noteElevenLabsSpend(0, file);
  await noteElevenLabsSpend(-5, file);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).left, 619_100);
});

test("the disk reading never goes below zero", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ left: 1_000, at: 0 }));
  stub([down]);
  assert.equal((await elevenLabsBalance("k", { waitMs: 1, file, staleMs: 24 * HOUR, now: () => 12 * HOUR }))?.left, 0);
});

test("the balance file sits in the data folder, and not at all with the setting at 0", () => {
  assert.equal(
    elevenLabsBalanceFile({ dataDir: "/d", elevenLabsBalanceStaleHours: 24 }),
    path.join("/d", "elevenlabs_balance.json"),
  );
  assert.equal(elevenLabsBalanceFile({ dataDir: "/d", elevenLabsBalanceStaleHours: 0 }), undefined);
});

test("jobs finishing together each have their spend taken off the file (no lost update)", async () => {
  resetElevenLabsCreditsCache();
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ left: 100_000, at: 7 }));
  await Promise.all(Array.from({ length: 20 }, () => noteElevenLabsSpend(500, file)));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { left: 90_000, at: 7 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["elevenlabs_balance.json"], "no temp files left behind");
});

test("ELEVENLABS_BALANCE_STALE_HOURS defaults to 12", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "../src/config.ts"), "utf8");
  assert.match(src, /int\("ELEVENLABS_BALANCE_STALE_HOURS", 12\)/);
});
