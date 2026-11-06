import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bar,
  claimDaily,
  compact,
  levelOf,
  nextRole,
  roleFor,
  xpForLevel,
  xpToNext,
} from "../src/discord/levels.ts";
import { fresh, parseNewsRss, parseYouTubeFeed } from "../src/discord/feeds.ts";

test("levels follow the 5L² + 50L + 100 curve", () => {
  assert.equal(xpToNext(0), 100);
  assert.equal(xpToNext(1), 155);
  assert.equal(xpForLevel(2), 255);
  assert.deepEqual(levelOf(0), { level: 0, into: 0, need: 100 });
  assert.deepEqual(levelOf(99), { level: 0, into: 99, need: 100 });
  assert.deepEqual(levelOf(255), { level: 2, into: 0, need: 220 });
  for (const l of [1, 5, 10, 35]) assert.equal(levelOf(xpForLevel(l)).level, l);
  assert.equal(levelOf(xpForLevel(10) - 1).level, 9);
});

test("level roles are the highest one reached", () => {
  assert.equal(roleFor(4), undefined);
  assert.equal(roleFor(5), "Regular");
  assert.equal(roleFor(19), "Insider");
  assert.equal(roleFor(99), "Legend");
  assert.deepEqual(nextRole(12), { at: 20, role: "OG" });
  assert.equal(nextRole(40), undefined);
});

test("daily streaks continue only from yesterday, once a day", () => {
  const now = new Date("2026-10-22T09:00:00Z");
  assert.deepEqual(claimDaily(undefined, 0, now), {
    ok: true,
    streak: 1,
    xp: 100,
  });
  assert.deepEqual(claimDaily("2026-10-21", 4, now), {
    ok: true,
    streak: 5,
    xp: 140,
  });
  assert.deepEqual(claimDaily("2026-10-19", 4, now), {
    ok: true,
    streak: 1,
    xp: 100,
  });
  assert.deepEqual(claimDaily("2026-10-21", 30, now), {
    ok: true,
    streak: 31,
    xp: 200,
  });
  const again = claimDaily("2026-10-22", 5, now);
  assert.equal(again.ok, false);
  assert.equal(
    !again.ok && again.next.toISOString(),
    "2026-10-23T00:00:00.000Z",
  );
});

test("bars and compact counts", () => {
  assert.equal(bar(0, 100, 10), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(bar(50, 100, 10), "▰▰▰▰▰▱▱▱▱▱");
  assert.equal(bar(100, 100, 4), "▰▰▰▰");
  assert.equal(compact(950), "950");
  assert.equal(compact(1000), "1K");
  assert.equal(compact(1250), "1.3K");
  assert.equal(compact(12_900), "12K");
  assert.equal(compact(1_250_000), "1.3M");
});

test("YouTube feed entries", () => {
  const xml = `<feed><title>Pulse Gaming</title><entry><id>yt:video:abcdefghijk</id><yt:videoId>abcdefghijk</yt:videoId><title>Mass Effect&#39;s TV Show &amp; More</title><published>2026-10-22T12:00:36+00:00</published></entry><entry><yt:videoId>zyxwvutsrqp</yt:videoId><title>Older</title><published>2026-10-21T12:00:00+00:00</published></entry></feed>`;
  assert.deepEqual(parseYouTubeFeed(xml), [
    {
      id: "abcdefghijk",
      title: "Mass Effect's TV Show & More",
      published: "2026-10-22T12:00:36+00:00",
    },
    {
      id: "zyxwvutsrqp",
      title: "Older",
      published: "2026-10-21T12:00:00+00:00",
    },
  ]);
});

test("news RSS items keep the opening text, picture and video", () => {
  const xml = `<rss><channel><title>Pulse Gaming News</title><item><title>Marvel&#39;s Wolverine Tops US Sales</title><link>https://pulsegmg.com/news/wolverine-8e0906b0</link><guid isPermaLink="false">pulse-ep_1</guid><pubDate>Thu, 22 Oct 2026 16:30:00 GMT</pubDate><description><![CDATA[<p><a href="https://youtube.com/watch?v=mfFDNxTsje4"><img src="https://i.ytimg.com/vi/mfFDNxTsje4/hqdefault.jpg" alt=""></a></p><p>It outsold every other game in America in September.</p><p>Second.</p><p>Third.</p>]]></description></item></channel></rss>`;
  const [s] = parseNewsRss(xml);
  assert.equal(s!.title, "Marvel's Wolverine Tops US Sales");
  assert.equal(s!.guid, "pulse-ep_1");
  assert.equal(s!.videoId, "mfFDNxTsje4");
  assert.equal(s!.image, "https://i.ytimg.com/vi/mfFDNxTsje4/hqdefault.jpg");
  assert.equal(
    s!.summary,
    "It outsold every other game in America in September.\n\nSecond.",
  );
});

test("fresh posts only new items, oldest first, and the first run only remembers", () => {
  const items = ["c", "b", "a"];
  const first = fresh(items, (x) => x, undefined);
  assert.deepEqual(first.post, []);
  const next = fresh(["e", "d", ...items], (x) => x, first.seen);
  assert.deepEqual(next.post, ["d", "e"]);
  assert.deepEqual(fresh(["e", "d"], (x) => x, next.seen).post, []);
});
