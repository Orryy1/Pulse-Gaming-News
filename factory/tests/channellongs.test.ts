import { test } from "node:test";
import assert from "node:assert/strict";
import { channelLongs, isoSeconds, longsFromApi } from "../src/routines.ts";

test("isoSeconds reads YouTube durations", () => {
  assert.equal(isoSeconds("PT10M3S"), 603);
  assert.equal(isoSeconds("PT2H"), 7200);
  assert.equal(isoSeconds("PT45S"), 45);
  assert.equal(isoSeconds("P1D"), 0);
});

test("channel longs come from the Data API when a key is set: 3 min to 3 h only, upload order kept", async () => {
  const old = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "test-key";
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(String(url).split("?")[0]!);
    if (String(url).includes("/playlistItems"))
      return new Response(JSON.stringify({ items: [
        { contentDetails: { videoId: "a" }, snippet: { title: "Ranked" } },
        { contentDetails: { videoId: "b" }, snippet: { title: "A Short" } },
        { contentDetails: { videoId: "c" }, snippet: { title: "Live" } },
      ] }));
    return new Response(JSON.stringify({ items: [
      { id: "a", contentDetails: { duration: "PT10M" } },
      { id: "b", contentDetails: { duration: "PT40S" } },
      { id: "c", contentDetails: { duration: "PT4H" } },
    ] }));
  }) as unknown as typeof fetch;
  try {
    assert.deepEqual(await channelLongs(fake), [{ id: "a", title: "Ranked" }]);
    assert.equal(calls.length, 2);
  } finally {
    if (old === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = old;
  }
  assert.deepEqual(longsFromApi([{ contentDetails: { videoId: "x" } }], {}), []);
});
