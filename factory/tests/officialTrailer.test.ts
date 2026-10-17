import { test } from "node:test";
import assert from "node:assert/strict";
import { pickOfficial, PUBLISHER_CHANNELS } from "../src/assets/officialTrailer.ts";

const subs = new Map([
  ["rockstar", 10_000_000],
  ["fan", 2_000_000],
  ["nintendo", 9_000_000],
  ["tiny", 1_000],
]);

const item = (o: Partial<{ videoId: string; title: string; channelId: string; channelTitle: string; publishedAt: string }>) => ({
  videoId: "v1",
  title: "Grand Theft Auto VI Trailer 1",
  channelId: "rockstar",
  channelTitle: "Rockstar Games",
  publishedAt: "2023-12-05T00:00:00Z",
  ...o,
});

test("only the publisher's own channel is accepted, never a reupload or a reaction", () => {
  const got = pickOfficial(
    [
      item({ videoId: "re", channelId: "fan", channelTitle: "GTA Fan Hub", title: "GTA 6 Trailer 1 REUPLOAD" }),
      item({ videoId: "react", title: "GTA 6 Trailer 1 REACTION" }),
      item({ videoId: "ok" }),
    ],
    "Grand Theft Auto VI",
    subs,
  );
  assert.equal(got?.videoId, "ok");
  assert.equal(got?.publisher, "Rockstar Games");
  assert.equal(got?.clipSeconds, 6);
});

test("a channel that borrows a publisher's name without its audience is rejected", () => {
  const got = pickOfficial([item({ channelId: "tiny" })], "Grand Theft Auto VI", subs);
  assert.equal(got, undefined);
});

test("the newest proper trailer wins and the game must be named", () => {
  const got = pickOfficial(
    [
      item({ videoId: "old", title: "Grand Theft Auto VI Trailer 1", publishedAt: "2023-12-05T00:00:00Z" }),
      item({ videoId: "new", title: "Grand Theft Auto VI Trailer 2", publishedAt: "2025-05-06T00:00:00Z" }),
      item({ videoId: "other", title: "Red Dead Redemption 2 Trailer", publishedAt: "2026-01-01T00:00:00Z" }),
    ],
    "Grand Theft Auto VI",
    subs,
  );
  assert.equal(got?.videoId, "new");
});

test("Nintendo material is stills only", () => {
  const got = pickOfficial([item({ channelId: "nintendo", channelTitle: "Nintendo of America", title: "Mario Kart World – Overview Trailer" })], "Mario Kart World", subs);
  assert.equal(got?.publisher, "Nintendo");
  assert.equal(got?.clipSeconds, 0);
  assert.ok(PUBLISHER_CHANNELS.every((r) => r.clipSeconds <= 14));
});


test("a platform channel's copy of a Rockstar trailer still carries Rockstar's cap, and Rockstar's own upload wins", () => {
  const ps = item({ videoId: "ps", channelId: "playstation", channelTitle: "PlayStation", title: "Grand Theft Auto VI - Launch Trailer | PS5 Games", publishedAt: "2026-05-01T00:00:00Z" });
  const withSubs = new Map([...subs, ["playstation", 15_000_000]]);
  const alone = pickOfficial([ps], "Grand Theft Auto VI", withSubs);
  assert.equal(alone?.publisher, "Rockstar Games");
  assert.equal(alone?.clipSeconds, 6);
  const both = pickOfficial([ps, item({ videoId: "rs", title: "Grand Theft Auto VI Trailer 2", publishedAt: "2025-05-06T00:00:00Z" })], "Grand Theft Auto VI", withSubs);
  assert.equal(both?.videoId, "rs");
});
