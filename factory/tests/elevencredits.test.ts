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
