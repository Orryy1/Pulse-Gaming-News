import { test } from "node:test";
import assert from "node:assert/strict";
import { channelLongs, isoSeconds, longsFromApi } from "../src/routines.ts";

test("isoSeconds reads YouTube durations", () => {
  assert.equal(isoSeconds("PT10M3S"), 603);
  assert.equal(isoSeconds("PT2H"), 7200);
  assert.equal(isoSeconds("PT45S"), 45);
  assert.equal(isoSeconds("P0D"), 0);
});

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const old = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "test-key-123";
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = old;
  }
}

test("channel longs: the long-form uploads list, newest first, over 3 min and under 3 h", async () => {
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/playlistItems"))
      return new Response(JSON.stringify({ items: [
        { contentDetails: { videoId: "old", videoPublishedAt: "2026-11-01T00:00:00Z" }, snippet: { title: "Older" } },
        { contentDetails: { videoId: "new", videoPublishedAt: "2026-11-21T00:00:00Z" }, snippet: { title: "Newer" } },
        { contentDetails: { videoId: "short3", videoPublishedAt: "2026-11-22T00:00:00Z" }, snippet: { title: "Three minutes" } },
        { contentDetails: { videoId: "live", videoPublishedAt: "2026-11-23T00:00:00Z" }, snippet: { title: "Stream" } },
      ] }));
    return new Response(JSON.stringify({ items: [
      { id: "old", contentDetails: { duration: "PT30M" } },
      { id: "new", contentDetails: { duration: "PT10M" } },
      { id: "short3", contentDetails: { duration: "PT3M" } },
      { id: "live", contentDetails: { duration: "PT4H" } },
    ] }));
  }) as unknown as typeof fetch;
  const got = await withKey(() => channelLongs(fake));
  assert.deepEqual(got.map((v) => v.id), ["new", "old"]);
  assert.match(urls[0]!, /playlistId=UULFvgNDjtTezrpxL8oUe6mYwA/);
  assert.equal(urls.length, 2);
});

test("channel longs: an API error names the reason and never the key; an empty list makes one call", async () => {
  const failing = (async () =>
    new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(
    () => withKey(() => channelLongs(failing)),
    (e: Error) => /HTTP 403 quotaExceeded/.test(e.message) && !e.message.includes("test-key-123"),
  );
  let calls = 0;
  const empty = (async () => {
    calls++;
    return new Response(JSON.stringify({}));
  }) as unknown as typeof fetch;
  assert.deepEqual(await withKey(() => channelLongs(empty)), []);
  assert.equal(calls, 1);
  assert.deepEqual(longsFromApi([{ contentDetails: { videoId: "x" } }], {}), []);
});
