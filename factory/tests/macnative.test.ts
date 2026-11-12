// Mac-native upgrades (12 Nov 2026), all off until switched on after the GTA VI freeze: MAC_VISION (picture checks on
// the Mac's own model), APPLE_AESTHETICS (Apple's aesthetics score ranks covers and opening frames) and
// APPLE_SOUND_TAGS (Apple's Sound Analysis for the highlight finder and spoken lines).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseVisionHost, macVisionMode } from "../src/assets/macvision.ts";
import { visionTarget, LOCAL_VISION_URL } from "../src/assets/localvision.ts";
import {
  aestheticsCommand,
  coverWorth,
  parseAesthetics,
  rankByAesthetics,
  scoreAesthetics,
} from "../src/assets/appleaesthetics.ts";
import {
  appleSoundReady,
  appleSpeech,
  overlapsSpeech,
  talkVerdict,
} from "../src/assets/applesound.ts";
import {
  soundBonus,
  soundCommand,
  soundTagsOn,
  speechShare,
  speechSpans,
  tagsPerSecond,
  type SoundWindow,
} from "../mac/gameplay/soundtags.mjs";
import { pickHero, type PlanImage } from "../src/render/plan.ts";
import { pickThumbImage } from "../src/shortthumb.ts";
import {
  CUTSCENE_HEARD_FORMAT,
  CUTSCENE_VIDEO_FORMAT,
  cutsceneDownloadArgs,
} from "../src/assets/cutscenes.ts";
import { testConfig } from "./helpers.ts";

// ---------------------------------------------------------------- MAC_VISION

test("MAC_VISION is off unless set; on means fallback, always means always", () => {
  assert.equal(macVisionMode(undefined), "off");
  assert.equal(macVisionMode(""), "off");
  assert.equal(macVisionMode("off"), "off");
  assert.equal(macVisionMode("false"), "off");
  assert.equal(macVisionMode("on"), "fallback");
  assert.equal(macVisionMode("TRUE"), "fallback");
  assert.equal(macVisionMode("fallback"), "fallback");
  assert.equal(macVisionMode("always"), "always");
  const cfg = testConfig(".");
  assert.equal(cfg.macVision, "off");
  assert.equal(cfg.appleAesthetics, false);
  assert.equal(cfg.appleSoundTags, false);
});

test("picture checks stay on the PC when off, off the Mac, or while the Mac's server is down", () => {
  const base = { platform: "darwin", pcDown: true, macUp: true };
  assert.equal(chooseVisionHost({ ...base, mode: "off" }), "pc");
  assert.equal(
    chooseVisionHost({ ...base, mode: "always", platform: "win32" }),
    "pc",
  );
  assert.equal(
    chooseVisionHost({ ...base, mode: "always", macUp: false }),
    "pc",
  );
  assert.equal(
    chooseVisionHost({ ...base, mode: "fallback", macUp: false }),
    "pc",
  );
});

test("fallback uses the Mac only while the PC relay is down; always uses it whenever it answers", () => {
  const base = { platform: "darwin", macUp: true };
  assert.equal(
    chooseVisionHost({ ...base, mode: "fallback", pcDown: true }),
    "mac",
  );
  assert.equal(
    chooseVisionHost({ ...base, mode: "fallback", pcDown: false }),
    "pc",
  );
  assert.equal(
    chooseVisionHost({ ...base, mode: "always", pcDown: false }),
    "mac",
  );
});

test("with MAC_VISION unset every picture call goes to the PC relay as before", async () => {
  const saved = process.env.MAC_VISION;
  delete process.env.MAC_VISION;
  try {
    const t = await visionTarget();
    assert.equal(t.mac, false);
    assert.equal(t.url, LOCAL_VISION_URL);
  } finally {
    if (saved !== undefined) process.env.MAC_VISION = saved;
  }
});

// ---------------------------------------------------------------- APPLE_AESTHETICS

test("aesthetics only run on the Mac and only when switched on", async () => {
  assert.equal(aestheticsCommand("win32", "/tmp/list.json"), undefined);
  assert.equal(aestheticsCommand("linux", "/tmp/list.json"), undefined);
  const mac = aestheticsCommand("darwin", "/tmp/list.json", "/py");
  assert.equal(mac?.cmd, "/py");
  assert.deepEqual(mac?.args.slice(0, 1), ["-I"]);
  assert.match(mac!.args[1]!, /appleaesthetics\.py$/);
  assert.equal((await scoreAesthetics(false, ["/a.jpg"])).size, 0);
  // Under test it never runs, even switched on.
  assert.equal((await scoreAesthetics(true, ["/a.jpg"])).size, 0);
});

test("aesthetics output: errors and missing scores are left out, screen grabs sink below scenes", () => {
  const scores = parseAesthetics(
    JSON.stringify({
      results: [
        { file: "/a.jpg", score: 0.42, utility: false },
        { file: "/b.jpg", error: "unsupported" },
        { file: "/c.jpg", score: 0.9, utility: true },
        { file: "/d.jpg" },
      ],
    }),
  );
  assert.deepEqual([...scores.keys()], ["/a.jpg", "/c.jpg"]);
  assert.equal(coverWorth(scores.get("/a.jpg")), 0.42);
  assert.ok(
    coverWorth(scores.get("/c.jpg"))! < coverWorth(scores.get("/a.jpg"))!,
  );
  assert.equal(coverWorth(undefined), undefined);
});

test("ranking: best first, unscored keep their order last, one per clip before seconds", () => {
  const items = [
    { f: "a1", clip: "a", s: 0.9 },
    { f: "a2", clip: "a", s: 0.88 },
    { f: "x", clip: "x", s: undefined },
    { f: "b1", clip: "b", s: 0.5 },
    { f: "y", clip: "y", s: undefined },
  ];
  assert.deepEqual(
    rankByAesthetics(items, (i) => i.s).map((i) => i.f),
    ["a1", "a2", "b1", "x", "y"],
  );
  assert.deepEqual(
    rankByAesthetics(
      items,
      (i) => i.s,
      (i) => i.clip,
    ).map((i) => i.f),
    ["a1", "b1", "a2", "x", "y"],
  );
});

test("pickHero is unchanged without scores and takes the most striking clean wide still with them", () => {
  const images: PlanImage[] = [
    { kind: "screenshot", aspect: 16 / 9 },
    { kind: "screenshot", aspect: 16 / 9 },
    { kind: "screenshot", aspect: 16 / 9, wordy: true },
  ];
  assert.equal(pickHero(images), 0);
  const scored = images.map((im, i) => ({
    ...im,
    aesthetic: [0.1, 0.7, 0.95][i],
  }));
  assert.equal(pickHero(scored), 1); // the wordy one never opens while a clean one can
  // The editor's own pick for the hook still leads.
  assert.equal(pickHero([{ ...scored[0]!, role: "hook" }, scored[1]!]), 0);
});

test("the Short's search tile breaks ties within a kind by Apple's score, and only then", () => {
  const imgs = [
    { file: "a.jpg", kind: "screenshot", aspect: 1.78 },
    { file: "b.jpg", kind: "screenshot", aspect: 1.78 },
  ];
  assert.equal(pickThumbImage(imgs)?.file, "a.jpg");
  assert.equal(
    pickThumbImage([
      { ...imgs[0]!, aesthetic: 0.2 },
      { ...imgs[1]!, aesthetic: 0.8 },
    ])?.file,
    "b.jpg",
  );
  // Kind still comes first: key art beats a prettier screenshot.
  assert.equal(
    pickThumbImage([
      { ...imgs[0]!, aesthetic: 0.9 },
      { file: "art.jpg", kind: "hero", aspect: 1.78, aesthetic: 0.1 },
    ])?.file,
    "art.jpg",
  );
});

// ---------------------------------------------------------------- APPLE_SOUND_TAGS

const w = (t: number, top: Array<[string, number]>): SoundWindow => ({
  t,
  d: 3,
  top,
});

test("APPLE_SOUND_TAGS is off unless set, and never runs off the Mac or under test", async () => {
  assert.equal(soundTagsOn(undefined), false);
  assert.equal(soundTagsOn("false"), false);
  assert.equal(soundTagsOn("true"), true);
  assert.equal(soundCommand("win32", "/a.wav"), undefined);
  assert.match(
    soundCommand("darwin", "/a.wav", "/py")!.args[1]!,
    /applesound\.py$/,
  );
  assert.equal(appleSoundReady(false, "darwin"), false);
  assert.equal(appleSoundReady(true, "win32"), false);
  assert.equal(appleSoundReady(true, "darwin"), false); // under test
  assert.equal(await appleSpeech("/clip.mp4", { enabled: true }), undefined);
});

test("sound windows become per-second tags and a finder bonus from the strongest tag", () => {
  const tags = tagsPerSecond(
    [
      w(0, [["music", 0.9]]),
      w(3, [
        ["gunshot_gunfire", 0.8],
        ["boom", 0.2],
      ]),
      w(6, [
        ["boom", 0.7],
        ["laughter", 0.5],
      ]),
    ],
    10,
  );
  assert.equal(tags.length, 10);
  assert.deepEqual(tags[1], ["music"]);
  assert.deepEqual(tags[4], ["gunfire"]); // boom at 0.2 is below the bar
  assert.deepEqual(tags[7], ["explosion", "laughter"]);
  assert.deepEqual(tags[9], []);
  const bonus = soundBonus(tags);
  assert.equal(bonus[1], 0); // music is not action
  assert.ok(bonus[7]! > bonus[4]!); // an explosion lifts more than gunfire
});

test("spoken lines merge across short gaps and give the talk share", () => {
  const spans = speechSpans([
    w(0, [["speech", 0.8]]),
    w(1.5, [["speech", 0.7]]),
    w(9, [
      ["speech", 0.6],
      ["music", 0.9],
    ]),
    w(12, [["speech", 0.3]]),
  ]);
  assert.deepEqual(spans, [
    { from: 0.75, to: 3.75 },
    { from: 9.75, to: 11.25 },
  ]);
  assert.equal(speechShare(spans, 15), 0.3);
  assert.equal(speechShare([], 0), 0);
  assert.equal(overlapsSpeech(spans, 4, 9), false);
  assert.equal(overlapsSpeech(spans, 3, 5), true);
});

test("the talk check: plain speech mutes, no speech keeps, anything between asks the recogniser", () => {
  assert.equal(talkVerdict(undefined), "unsure");
  assert.equal(
    talkVerdict({ spans: [{ from: 0, to: 20 }], share: 0.6, seconds: 30 }),
    "talk",
  );
  assert.equal(talkVerdict({ spans: [], share: 0, seconds: 30 }), "clean");
  assert.equal(
    talkVerdict({ spans: [{ from: 25, to: 28 }], share: 0.1, seconds: 30 }),
    "unsure",
  );
});

test("cutscene sections are fetched without sound unless Apple's hearing is on", () => {
  const upload = {
    videoId: "abc",
    title: "t",
    uploader: "u",
    duration: 600,
  } as Parameters<typeof cutsceneDownloadArgs>[0];
  const off = cutsceneDownloadArgs(upload, 10, 40, "s.mp4");
  assert.equal(off[off.indexOf("-f") + 1], CUTSCENE_VIDEO_FORMAT);
  const on = cutsceneDownloadArgs(upload, 10, 40, "s.mp4", true);
  assert.equal(on[on.indexOf("-f") + 1], CUTSCENE_HEARD_FORMAT);
  assert.match(CUTSCENE_HEARD_FORMAT, /\+ba/);
});
