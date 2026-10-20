import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterItems, canonicalUrl } from "../src/discovery/cluster.ts";
import { parseFeed } from "../src/discovery/rss.ts";
import { buildSegments, pageCaptions, srtFromWords } from "../src/render/timeline.ts";
import { capFootage, footageBudgetSeconds } from "../src/assets/footage.ts";
import { videoMetadata } from "../src/pipeline.ts";
import { missingScopes } from "../src/doctor.ts";
import { pickVoice } from "../src/voice/index.ts";
import { buildTags, hashtags, keywordLead, pinnedComment, polishTitle, thumbTitle, titleProblems } from "../src/editorial/seo.ts";
import { parseBars, dateLabel, monthsBetween, daysUntil, bandColour } from "../src/render/components/cards/helpers.ts";
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
  assert.ok(pages.every((p) => p.words.length <= 5));
  assert.equal(pages[0]!.words.at(-1)!.text, "three.", "captions break on sentence ends");
});

test("house-rule validation", () => {
  assert.deepEqual(validateScript(goodScript()), []);
  const words = narrationOf(goodScript()).split(/\s+/).length;
  assert.ok(words >= 70 && words <= 115, `fixture has ${words} words`);

  const bad = validateScript(goodScript({ hook: "So, Starfield is delayed again, let me know in the comments what you think about the colour." }));
  assert.ok(bad.some((p) => p.includes("must not open")));
  assert.ok(bad.some((p) => p.includes("Banned phrase")));
  assert.ok(bad.some((p) => p.includes("color")));

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
  assert.equal(footageBudgetSeconds(other), 20);
  const clips = [1, 2, 3, 4].map((i) => ({ file: `c${i}.mp4`, durationSeconds: 3.4 }));
  assert.equal(capFootage(clips, 6).length, 1);
  assert.equal(capFootage(clips, 20).length, 4);
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

test("caption pages never flicker: sub-0.33s pages merge forward", () => {
  const words = ["A", "quick", "one.", "Then", "a", "longer", "phrase", "follows", "here."].map((t, i) => ({ text: t, start: i * 0.1, end: i * 0.1 + 0.08 }));
  const pages = pageCaptions(words);
  assert.ok(pages.every((p) => p.words.length <= 5));
  for (const p of pages.slice(0, -1)) assert.ok(p.end - p.start >= 0.3 || p.words.length >= 4, `page "${p.words.map((w) => w.text).join(" ")}" is too short`);
});

test("video descriptions credit the footage and disclose the synthetic voice", () => {
  const ep: any = {
    script_json: goodScript(),
    story_json: { headline: "Starfield expansion delayed", items: [{ source: "Xbox Wire", url: "https://news.xbox.com/x" }] },
    assets_json: { clips: [{ file: "clips/0.mp4", sourceUrl: "", provenance: "Official Steam trailer for Starfield (app 1716740), publisher: Bethesda Softworks; offset 22s", durationSeconds: 3.4 }] },
    publish_at: null,
  };
  const m = videoMetadata(ep, "unlisted");
  assert.match(m.description, /Footage: .* official trailer \(Bethesda Softworks\)/);
  assert.match(m.description.split("\n")[0]!, /^Starfield .*: /, "the first line is the keyword lead");
  assert.match(m.description, /#Shorts #GamingNews #Starfield$/);
  assert.ok(m.tags.includes("Starfield") && m.tags.includes("gaming news") && m.tags.join(",").length <= 500);
  assert.ok(m.title.length <= 60 && m.title.startsWith("Starfield"));
  assert.match(m.description, /Game Content Usage Rules: https:\/\/www\.xbox\.com\/en-US\/developers\/rules/);
  assert.match(m.description, /synthetic voice/);
  assert.equal(m.containsSyntheticMedia, true);
  const noClips = videoMetadata({ ...ep, assets_json: {} }, "public");
  assert.doesNotMatch(noClips.description, /Footage:/);
});

test("doctor reports the YouTube scopes a login lacks", () => {
  const upload = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube";
  assert.deepEqual(missingScopes(upload).map((s) => s.split("/").at(-1)), ["youtube.force-ssl", "yt-analytics.readonly"]);
  const full = "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly";
  assert.deepEqual(missingScopes(full), []);
});

test("data cards: the validator insists on the fields each card needs", () => {
  const s = goodScript();
  const beat = (visual: any) => ({ ...s, beats: [{ narration: s.beats[0]!.narration, visual }, ...s.beats.slice(1)] });
  assert.ok(validateScript(beat({ kind: "timeline", primary: "Window", secondary: "", date_from: "2026-12", date_to: "2027-03" })).every((p) => !p.includes("Timeline")));
  assert.ok(validateScript(beat({ kind: "timeline", primary: "Window", secondary: "", date_from: "December", date_to: "2027-03" })).some((p) => p.includes("Timeline card")));
  assert.ok(validateScript(beat({ kind: "price", primary: "free", secondary: "" })).some((p) => p.includes("no price")));
  assert.ok(validateScript(beat({ kind: "score", primary: "72", secondary: "", value_a: 172 })).some((p) => p.includes("Score card")));
  assert.ok(validateScript(beat({ kind: "compare", primary: "Players", secondary: "", items: ["*A:10"] })).some((p) => p.includes("Compare card")));
  assert.ok(validateScript(beat({ kind: "countdown", primary: "14 March", secondary: "", date_to: "2027-03-14" })).every((p) => !p.includes("Countdown")));
});

test("data card helpers parse what the writer gives them", () => {
  assert.deepEqual(parseBars(["*Starfield:4,088", "Outer Worlds 2:1,950", "junk", "Avowed:1.4k"]).map((r) => [r.label, r.value, r.highlight]), [["Starfield", 4088, true], ["Outer Worlds 2", 1950, false], ["Avowed", 1400, false]]);
  assert.equal(parseBars(["A:5", "B:9"])[0]!.highlight, true, "the first row is the subject when none is marked");
  assert.equal(dateLabel("2027-03"), "MAR 2027");
  assert.equal(dateLabel("2027-03-14"), "MAR 14, 2027");
  assert.equal(monthsBetween("2026-12", "2027-03"), 3);
  assert.equal(daysUntil("2027-03-14", "2026-10-17"), 148);
  assert.equal(bandColour(85), "#22C55E");
  assert.equal(bandColour(55), "#FF3B3B");
});

test("SEO: titles are game-first, short and clean; tags, hashtags, lead and comment follow the story", () => {
  const s = goodScript();
  const t = polishTitle(s);
  assert.deepEqual(titleProblems(t), []);
  assert.ok(t.startsWith("Starfield"), t);
  const shouty = polishTitle(goodScript({ youtube: { ...s.youtube, title: "You Won't Believe This SHOCKING Starfield Delay!!!" } }));
  assert.deepEqual(titleProblems(shouty), []);
  // A game whose name has a colon leads with its short name, never "A: B: fact", and never gets cut mid-sentence.
  const cod = polishTitle(goodScript({ game_title: "Call of Duty: Modern Warfare 4", headline: "Modern Warfare 4 has the best CoD Steam rating in a decade", youtube: { ...s.youtube, title: "MW4 Hits Best CoD Steam Rating in a Decade" } }));
  assert.ok(!/:.*:/.test(cod), cod);
  assert.ok(cod.startsWith("Modern Warfare 4") || cod.startsWith("MW4"), cod);
  assert.deepEqual(titleProblems(cod), []);
  const codLong = polishTitle(goodScript({ game_title: "Call of Duty: Modern Warfare 4", headline: "Modern Warfare 4 has the best CoD Steam rating in a decade", youtube: { ...s.youtube, title: "MW4 Hits the Best Call of Duty Steam User Rating Seen in a Decade" } }));
  assert.ok(codLong.length <= 60, codLong);
  assert.ok(!/:.*:/.test(codLong), codLong);
  assert.ok(shouty.startsWith("Starfield:"), shouty);
  const long = polishTitle(goodScript({ youtube: { ...s.youtube, title: "Starfield second expansion delayed to early 2027 as Bethesda blames polish and new systems" } }));
  assert.ok(long.length <= 60, long);
  assert.deepEqual(titleProblems("Starfield delayed??"), ["Title uses clickbait punctuation."]);
  // Rankings follow the search pattern and never say "Part One".
  const six = polishTitle(goodScript({ game_title: "Resident Evil", headline: "Six Resident Evil games ranked", evergreen_format: "ranking", youtube: { ...s.youtube, title: "Ranking EVERY Resident Evil Game, Part One" }, entries: Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, game_title: `RE ${i}`, steam_search_term: "", year: 2000 + i, platforms: "PC" })) }));
  assert.equal(six, "6 Resident Evil Games Ranked Worst to Best");
  const ten = polishTitle(goodScript({ game_title: "Resident Evil", headline: "x", evergreen_format: "ranking", youtube: { ...s.youtube, title: "x" }, entries: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, game_title: `RE ${i}`, steam_search_term: "", year: 2000 + i, platforms: "PC" })) }));
  assert.equal(ten, "Every Resident Evil Game Ranked Worst to Best");
  assert.equal(thumbTitle(goodScript({ game_title: "Resident Evil", entries: Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, game_title: "x", steam_search_term: "", year: 2000, platforms: "PC" })) })), "Every Resident Evil Game Ranked");
  assert.equal(thumbTitle(goodScript({ game_title: "Resident Evil", entries: Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, game_title: "x", steam_search_term: "", year: 2000, platforms: "PC" })) })), "6 Resident Evil Games Ranked");
  assert.deepEqual(titleProblems(ten), []);
  const tags = buildTags(s);
  assert.equal(tags[0], "Starfield");
  assert.ok(tags.includes("Bethesda") && tags.includes("Starfield delayed") && tags.includes("gaming news"));
  assert.ok(new Set(tags.map((x) => x.toLowerCase())).size === tags.length, "no duplicate tags");
  assert.deepEqual(hashtags(s), ["#Shorts", "#GamingNews", "#Starfield"]);
  assert.match(keywordLead(s), /^Starfield delayed: /);
  const ranking = goodScript({ game_title: "Resident Evil", headline: "Six Resident Evil games ranked", evergreen_format: "ranking", pulse_take: { ...s.pulse_take, on_screen: "RE7 wins on dread" }, entries: Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, game_title: `RE ${i}`, steam_search_term: "", year: 2000 + i, platforms: "PC" })) });
  assert.match(keywordLead(ranking), /^6 Resident Evil games ranked worst to best: Six Resident Evil games ranked\./);
  assert.match(pinnedComment(ranking), /^Our pick: RE7 wins on dread\. Which Resident Evil game would you move/);
  assert.match(pinnedComment(s), /^Our read: .*\? Sources are in the description\.$/);
});

test("voice rotation: a few Shorts in a row share a voice, then the pool moves on and wraps", () => {
  const cfg = testConfig("x", { voicePool: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], voiceRotation: 2 });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((n) => pickVoice(cfg, n).id), ["a", "a", "b", "b", "c", "c", "a"]);
  assert.equal(pickVoice(testConfig("x", { voicePool: [] }), 5).id, testConfig("x").elevenLabsVoiceId, "an empty pool keeps the configured voice");
});

test("breaths between words are found from the audio, and words are left alone", async () => {
  const { breathGaps } = await import("../src/voice/breaths.ts");
  // 10 ms windows: speech at -12 dB for 0-1 s, a breath at -40 dB from 0.95 s (inside the word's
  // timestamped end) to 1.3 s, speech again from 1.3 s.
  const db = Array.from({ length: 200 }, (_, i) => (i < 95 || i >= 130 ? -12 : -40));
  const words = [
    { text: "today.", start: 0.5, end: 1.0 },
    { text: "Skyward", start: 1.32, end: 1.9 },
  ];
  const gaps = breathGaps(words, db);
  assert.equal(gaps.length, 1);
  const [a, b] = gaps[0]!;
  assert.ok(a >= 0.95 && a <= 0.97, `starts where the breath starts, got ${a}`);
  assert.ok(b <= 1.3, `stops before the next word, got ${b}`);
  assert.deepEqual(breathGaps([{ text: "a", start: 0.5, end: 1 }, { text: "b", start: 1.05, end: 1.5 }], db.map(() => -12)), [], "no quiet, no dip");
});
