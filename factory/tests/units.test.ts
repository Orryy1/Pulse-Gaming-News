import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterItems, canonicalUrl } from "../src/discovery/cluster.ts";
import { parseFeed } from "../src/discovery/rss.ts";
import { buildSegments, pageCaptions, srtFromWords } from "../src/render/timeline.ts";
import { capFootage, footageBudgetSeconds } from "../src/assets/footage.ts";
import { wordsFromAlignment } from "../src/voice/elevenlabs.ts";
import { validateScript } from "../src/editorial/editorial.ts";
import { narrationOf } from "../src/editorial/schema.ts";
import { signToken, verifyToken, encrypt, decrypt } from "../src/lib/crypto.ts";
import { bestMatch } from "../src/assets/steam.ts";
import { buildResource, markerTag } from "../src/youtube/upload.ts";
import { choosePublishAt } from "../src/pipeline.ts";
import { item, goodScript, testConfig } from "./helpers.ts";

test("clusters the same story across outlets and marks it corroborated", () => {
  const now = new Date();
  const clusters = clusterItems(
    [
      item("Starfield second expansion delayed to early 2027", "IGN", "outlet", 30, now),
      item("Bethesda delays Starfield's second expansion to early 2027", "VGC", "outlet", 50, now),
      item("OUT NOW", "Pure Xbox", "outlet", 10, now),
      item("Everything out now on Game Pass this week", "Xbox Wire", "official", 20, now),
    ],
    now,
  );
  const starfield = clusters.find((c) => c.headline.includes("Starfield"))!;
  assert.equal(starfield.items.length, 2);
  assert.equal(starfield.corroborated, true);
  const outNow = clusters.find((c) => c.headline === "OUT NOW")!;
  assert.equal(outNow.items.length, 1, "short titles never absorb other stories");
  assert.equal(outNow.corroborated, false);
});

test("drops stale items and keeps story hashes stable", () => {
  const now = new Date();
  const a = clusterItems([item("Old news about Halo Infinite servers", "IGN", "outlet", 60 * 30, now)], now, 24);
  assert.equal(a.length, 0);
  const one = clusterItems([item("Silksong DLC dated for December", "IGN", "outlet", 30, now)], now)[0]!;
  const two = clusterItems([item("Silksong DLC dated for December", "IGN", "outlet", 30, now)], now)[0]!;
  assert.equal(one.hash, two.hash);
  assert.equal(canonicalUrl("https://www.ign.com/a/?utm_source=x#top"), "ign.com/a");
});

test("parses RSS and Atom", () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[GTA 6 gets a launch trailer]]></title><link>https://x.example/a</link><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Rockstar released it.&lt;/p&gt;</description><media:content url="https://x.example/i.jpg"/></item></channel></rss>`;
  const atom = `<feed><entry><title>Switch 2 sales top 20 million</title><link rel="alternate" href="https://y.example/b"/><updated>2026-10-15T09:00:00Z</updated><summary>Nintendo said so.</summary></entry></feed>`;
  const [r] = parseFeed(rss, { name: "X", url: "", kind: "outlet" });
  assert.equal(r!.title, "GTA 6 gets a launch trailer");
  assert.equal(r!.summary, "Rockstar released it.");
  assert.equal(r!.imageUrl, "https://x.example/i.jpg");
  const [a] = parseFeed(atom, { name: "Y", url: "", kind: "official" });
  assert.equal(a!.url, "https://y.example/b");
  assert.equal(a!.sourceKind, "official");
});

test("turns character alignment into word timings", () => {
  const text = "GTA six, now.";
  const chars = [...text];
  const words = wordsFromAlignment({
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.1),
    character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08),
  });
  assert.deepEqual(
    words.map((w) => w.text),
    ["GTA", "six,", "now."],
  );
  assert.equal(words[1]!.start, 0.4);
  assert.ok(Math.abs(words[1]!.end - 0.78) < 1e-9);
});

test("maps narration segments onto word timings and pages captions", () => {
  const words = "One two three. Four five six seven. Eight nine.".split(" ").map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const segs = buildSegments(
    [
      { kind: "hook", text: "One two three." },
      { kind: "beat", text: "Four five six seven." },
      { kind: "loop", text: "Eight nine." },
    ],
    words,
    4,
  );
  assert.deepEqual(
    segs.map((s) => [s.kind, s.start, s.end]),
    [
      ["hook", 0, 1.2000000000000002],
      ["beat", 1.2000000000000002, 2.8000000000000003],
      ["loop", 2.8000000000000003, 4],
    ],
  );
  const pages = pageCaptions(words);
  assert.ok(pages.every((p) => p.words.length <= 3));
  assert.equal(pages[0]!.words.at(-1)!.text, "three.", "captions break on sentence ends");
});

test("house-rule validation", () => {
  assert.deepEqual(validateScript(goodScript()), []);
  const words = narrationOf(goodScript()).split(/\s+/).length;
  assert.ok(words >= 70 && words <= 115, `fixture has ${words} words`);

  const bad = validateScript(goodScript({ hook: "So, Starfield is delayed again, let me know in the comments what you think about the color." }));
  assert.ok(bad.some((p) => p.includes("must not open")));
  assert.ok(bad.some((p) => p.includes("Banned phrase")));
  assert.ok(bad.some((p) => p.includes("colour")));

  const rumour = validateScript(goodScript({ is_rumour: true }));
  assert.ok(rumour.some((p) => p.includes("attribute")));
  const oxford = validateScript(goodScript({ youtube: { ...goodScript().youtube, description: "Out on Xbox, PS5, and PC." } }));
  assert.ok(oxford.some((p) => p.includes("Oxford")));
});

test("signed links expire and cannot be reused for another action", () => {
  const now = Date.now();
  const t = signToken("approve:ep1", "secret-secret-secret", 60, now);
  assert.equal(verifyToken("approve:ep1", t, "secret-secret-secret", now), true);
  assert.equal(verifyToken("reject:ep1", t, "secret-secret-secret", now), false);
  assert.equal(verifyToken("approve:ep1", t, "secret-secret-secret", now + 61_000), false);
  assert.equal(decrypt(encrypt("refresh-token", "secret-secret-secret"), "secret-secret-secret"), "refresh-token");
  assert.throws(() => decrypt(encrypt("x", "secret-secret-secret"), "another-secret-value"));
});

test("Steam matching prefers the exact game", () => {
  const items = [
    { id: 1, name: "Hades II Soundtrack", type: "app" },
    { id: 2, name: "Hades II", type: "app" },
    { id: 3, name: "Unrelated Farming Sim", type: "app" },
  ];
  assert.equal(bestMatch("Hades II", items)?.id, 2);
  assert.equal(bestMatch("Grand Theft Auto VI", items), undefined);
});

test("upload resource carries the marker and schedules privately", () => {
  const r = buildResource(
    {
      title: "T",
      description: "D",
      tags: ["a"],
      categoryId: "20",
      privacyStatus: "public",
      publishAt: "2026-10-17T07:00:00.000Z",
      containsSyntheticMedia: false,
      defaultLanguage: "en-GB",
    },
    markerTag("ep_20261016_abcd"),
  );
  assert.ok(r.snippet.tags.includes("pulserefep20261016abcd"));
  assert.equal(r.status.privacyStatus, "private");
  assert.equal(r.status.publishAt, "2026-10-17T07:00:00.000Z");
});

test("publish window scheduling", () => {
  const cfg = testConfig("/tmp", { publishWindowStartUtc: 7, publishWindowEndUtc: 22 });
  assert.equal(choosePublishAt(cfg, new Date("2026-10-16T12:00:00Z")), undefined, "inside the window: publish now");
  assert.equal(choosePublishAt(cfg, new Date("2026-10-16T23:10:00Z"))?.toISOString(), "2026-10-17T07:00:00.000Z");
  assert.equal(choosePublishAt(cfg, new Date("2026-10-16T03:00:00Z"))?.toISOString(), "2026-10-16T07:00:00.000Z");
  const veto = testConfig("/tmp", { youtubeVetoMinutes: 30 });
  assert.equal(choosePublishAt(veto, new Date("2026-10-16T12:00:00Z"))?.toISOString(), "2026-10-16T12:30:00.000Z");
});

test("srtFromWords writes numbered, non-overlapping cues held at least 0.7s", () => {
  const text = "Starfield's first expansion has slipped to early 2027, three months later than planned. Here is why.";
  const words = text.split(" ").map((w, i) => ({ text: w, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const srt = srtFromWords(words);
  const cues = srt.trim().split("\n\n");
  assert.ok(cues.length >= 2 && cues.length <= 6, `cue count ${cues.length}`);
  assert.match(cues[0]!, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nStarfield's/);
  const times = cues.map((c) => c.split("\n")[1]!.split(" --> "));
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1]![1]! <= times[i]![0]!, "cues do not overlap");
  for (const [a, b] of times) assert.ok(Number(b!.slice(-6).replace(",", ".")) - Number(a!.slice(-6).replace(",", ".")) >= 0.69 || a!.slice(0, 5) !== b!.slice(0, 5));
  assert.equal(srtFromWords([]), "");
});

test("Rockstar footage is held to about six seconds per Short", () => {
  const rockstar = { appId: 1, name: "Grand Theft Auto VI", details: { publishers: ["Rockstar Games"], developers: ["Rockstar North"] } };
  const other = { appId: 2, name: "Starfield", details: { publishers: ["Bethesda Softworks"] } };
  assert.equal(footageBudgetSeconds(rockstar), 6);
  assert.equal(footageBudgetSeconds(other), 14);
  const clips = [1, 2, 3, 4].map((i) => ({ file: `c${i}.mp4`, durationSeconds: 3.4 }));
  assert.equal(capFootage(clips, 6).length, 1);
  assert.equal(capFootage(clips, 14).length, 4);
  assert.equal(capFootage(clips, 0).length, 0);
});

test("buildSegments recovers when the aligner splits a token in an earlier segment", () => {
  const spoken = ["Hook", "line", "twenty", "twenty-", "seven.", "Beat", "one", "here.", "Our", "read", "now."];
  const words = spoken.map((w, i) => ({ text: w, start: i, end: i + 0.8 }));
  const segs = buildSegments(
    [
      { kind: "hook", text: "Hook line twenty twenty-seven." },
      { kind: "beat", text: "Beat one here." },
      { kind: "take", text: "Our read now." },
    ],
    words,
    11,
  );
  assert.equal(segs[1]!.start, 5, "beat starts at the spoken 'Beat' despite the extra token");
  assert.equal(segs[2]!.start, 8, "take starts at the spoken 'Our'");
  assert.equal(segs[0]!.end, 5);
});
