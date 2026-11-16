// The footage-first fixes of 15 Nov 2026 (after "Why did Rockstar narrow GTA 6's roads?" went out on stills alone):
// publisher-site trailers, the game library and its picker, comparison stories, beat relevance, no hardware, the
// footage gate, the collage card rule and gameplay indexes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestFile,
  nameOf,
  rockstarDownloads,
  rockstarSiteStills,
  rockstarTrailerGuesses,
  trailerOfGame,
} from "../src/assets/publishersite.ts";
import {
  assetKey,
  dhashOf,
  hamming,
  isNearDuplicate,
  pickForLines,
  recentUses,
  scenesFromCuts,
  tagsForSentence,
  tagsFromAnswer,
  type GameLibrary,
  type LibItem,
} from "../src/assets/gamelib.ts";
import {
  comparedGames,
  hardwareStory,
  isHardwareAsset,
  mapScale,
  sentenceWants,
} from "../src/assets/linevisuals.ts";
import { footageGate, indexAsLibraryItem, realMap } from "../src/assets/shortlibrary.ts";
import {
  overlaySpans,
  stingPlacement,
  STING_MIN_FRAMES,
} from "../src/render/cleanframe.ts";
import { clipForWords } from "../src/render/plan.ts";
import { pickSource, playthroughQueries } from "../src/sceneindex/build.ts";
import {
  baseGameOf,
  gameplayIndexName,
  isGameplayIndex,
  sceneSlug,
} from "../src/sceneindex/schema.ts";

// The roads Short, as written.
const ROADS = {
  game_title: "Grand Theft Auto VI",
  headline: "GTA 6's roads get narrower",
  hook: "Why does GTA 6 give you less room to drive?",
  beats: [
    {
      narration:
        "Edge's October 29 preview calls the narrower streets more believable. GTA 5 had deliberately wide roads.",
      footage: {
        want: "world",
        keywords: ["city streets", "highways", "traffic"],
      },
    },
    {
      narration:
        "You still get a bigger map. Edge puts it at roughly 2 times GTA 5's size.",
      footage: { want: "calm", keywords: ["Leonida", "landscape"] },
    },
  ],
  pulse_take: {
    narration:
      "Believable streets are worth giving up space. I'd check launch reviews to see whether tighter roads make police chases more fun.",
  },
  loop_line: "Getting away in GTA 6 could take more careful driving.",
};

// ---------------------------------------------------------------- 1. publisher-site trailers

test("Rockstar's media page gives its official trailers and packs, never the Extended Look, cover art or pre-load advert", () => {
  const cdn = "https://media-rockstargames-com.akamaized.net/VI/downloads";
  const html = [
    `${cdn}/videos/GTAVI_Launch_Trailer/GTAVI_Launch_Trailer.mp4`,
    `${cdn}/videos/GTAVI_An_Extended_Look/GTAVI_An_Extended_Look.mp4`,
    `${cdn}/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4`,
    `${cdn}/videos/GTAVI_Pre-Load_Now/GTAVI_Pre-Load_Now.mp4`,
    `${cdn}/screenshots/GTAVI_Screenshots.zip`,
    `${cdn}/screenshots/GTAVI_Ultimate_Edition_Benefits.zip`,
    `${cdn}/artwork_wallpapers/GTAVI_Artwork_Wallpapers.zip`,
    `${cdn}/videos/GTAVI_Videos.zip`,
  ]
    .map((u) => `<a href="${u}">x</a>`)
    .join("\n");
  const got = rockstarDownloads(
    html,
    "VI",
    "https://www.rockstargames.com/VI/media",
  );
  assert.deepEqual(
    got.map((a) => [a.kind, a.name]),
    [
      ["video", "Launch Trailer"],
      ["pack", "Screenshots"],
      ["pack", "Videos"],
    ],
  );
  assert.ok(got.every((a) => a.publisher === "Rockstar Games"));
});

test("the numbered trailers the page leaves out are guessed under the same CDN pattern", () => {
  assert.deepEqual(
    rockstarTrailerGuesses("VI", "GTAVI", 2).map((a) => a.url),
    [
      "https://media-rockstargames-com.akamaized.net/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
      "https://media-rockstargames-com.akamaized.net/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    ],
  );
});

test("the site's named gallery stills carry their place or person; box fronts and hashed UI art are left out", () => {
  const html = `"/VI/_next/static/media/Vice_City_03.0vt46a.1s.7-y.jpg" "/VI/_next/static/media/Jason_Duval_01.0r.ute88os9k-.jpg"
    "/VI/_next/static/media/GTAVI_FOB_StandardEdition_Desktop.09clbpu8-nv8i.jpg" "/VI/_next/static/media/39ak81277255o9.0lmk9f~r~10.x.jpg"`;
  assert.deepEqual(
    rockstarSiteStills(html, "https://www.rockstargames.com", "page").map(
      (a) => [a.name, a.tags[0]],
    ),
    [
      ["Vice City 03", "Vice City"],
      ["Jason Duval 01", "Jason Duval"],
    ],
  );
  assert.equal(nameOf("GTAVI_Launch_Trailer.mp4"), "GTAVI Launch Trailer");
});

test("an older game's site video counts only when it is a trailer of exactly that game", () => {
  assert.equal(
    trailerOfGame(
      {
        title: "PlayStation 5 Announcement Trailer",
        game: "Grand Theft Auto V",
      },
      "Grand Theft Auto V",
    ),
    true,
  );
  assert.equal(
    trailerOfGame(
      { title: "Trailer 2", game: "Grand Theft Auto VI" },
      "Grand Theft Auto V",
    ),
    false,
  );
  assert.equal(
    trailerOfGame(
      {
        title: "The Kortz Center Heist Now Available",
        game: "Grand Theft Auto Online",
      },
      "Grand Theft Auto V",
    ),
    false,
  );
  assert.equal(
    trailerOfGame(
      { title: "An Extended Look", game: "Grand Theft Auto VI" },
      "Grand Theft Auto VI",
    ),
    false,
  );
  assert.equal(
    bestFile([
      { resolution: "2160p", src: "a" },
      { resolution: "1080p", src: "b" },
      { resolution: "360p", src: "c" },
    ]),
    "b",
  );
});

// ---------------------------------------------------------------- the library and its picker

const item = (o: Partial<LibItem> & Pick<LibItem, "id" | "kind">): LibItem => ({
  file: `${o.id}.jpg`,
  sourceUrl: o.id,
  provenance: o.id,
  source: "Rockstar Games",
  named: [],
  tags: [],
  seen: "",
  addedAt: "",
  ...o,
});

test("the vision tagger's answer keeps known tags only and marks hardware, overlays and lettering unusable", () => {
  assert.deepEqual(
    tagsFromAnswer({
      tags: ["Driving", "road", "spaceship"],
      seen: "a car on a road",
      lettering: false,
      webcam: false,
      hardware: false,
      suggestive: false,
    }),
    { tags: ["driving", "road"], seen: "a car on a road" },
  );
  assert.equal(
    tagsFromAnswer({ tags: [], seen: "a controller", hardware: true })
      ?.unusable,
    "hardware or merchandise",
  );
  assert.equal(
    tagsFromAnswer({ tags: ["city"], seen: "title card", lettering: true })
      ?.unusable,
    "large lettering",
  );
  assert.equal(tagsFromAnswer({ nope: 1 }), undefined);
});

test("near-duplicate pictures are found by their difference hash", () => {
  const a = new Uint8Array(72).map((_, i) => (i * 37) % 251);
  const b = Uint8Array.from(a);
  b[5] = (b[5]! + 1) % 251;
  const ha = dhashOf(a)!;
  const hb = dhashOf(b)!;
  assert.ok(hamming(ha, hb) <= 2);
  assert.ok(isNearDuplicate(hb, [ha]));
  assert.equal(
    isNearDuplicate("ffffffffffffffff", ["0000000000000000"]),
    false,
  );
});

test("a video's cuts become scenes of 1.2 to 6 s, with the trailer's logo head and rating tail left out", () => {
  const s = scenesFromCuts([3, 4, 12, 13.5], 20, { skipHead: 1, skipTail: 2 });
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.end - x.at >= 1.2 && x.end - x.at <= 6));
  assert.ok(s[0]!.at >= 1);
  assert.ok(s.at(-1)!.end <= 18);
  assert.ok(!s.some((x) => x.at < 4 && x.end > 4)); // never across a cut
});

test("a line about roads asks for driving and roads; a map line for a map", () => {
  assert.ok(
    tagsForSentence("GTA 5 had deliberately wide roads.")
      .slice(0, 3)
      .includes("road"),
  );
  assert.ok(tagsForSentence("You still get a bigger map.").includes("map"));
  assert.ok(tagsForSentence("police chases").includes("chase"));
});

test("the picker gives each sentence its best-fitting scene, never repeats one in a Short and avoids what recent Shorts showed", () => {
  const lib: GameLibrary = {
    version: 1,
    game: "Grand Theft Auto VI",
    updatedAt: "",
    items: [
      item({
        id: "trailer",
        kind: "video",
        scenes: [
          {
            at: 1,
            end: 4,
            tags: ["driving", "road", "car", "street"],
            seen: "a car on a city street",
          },
          {
            at: 5,
            end: 8,
            tags: ["driving", "road", "car", "highway"],
            seen: "a car on a highway",
          },
          { at: 9, end: 12, tags: ["beach"], seen: "a beach" },
        ],
      }),
      item({
        id: "controller",
        kind: "still",
        seen: "a controller",
        unusable: "hardware or merchandise",
      }),
      item({
        id: "street",
        kind: "still",
        tags: ["street", "road", "city"],
        seen: "a street",
      }),
    ],
  };
  const libs = new Map([["Grand Theft Auto VI", lib]]);
  const want = (sentence: string) => ({
    key: "beat:0",
    sentence,
    game: "Grand Theft Auto VI",
    tags: tagsForSentence(sentence),
    names: [],
  });
  const picks = pickForLines(
    libs,
    [
      want("The narrower streets are more believable."),
      want("Traffic on the roads."),
    ],
    { preferVideo: true },
  );
  assert.equal(picks.length, 2);
  assert.ok(picks.every((p) => p.scene && p.scene.tags.includes("road")));
  assert.notEqual(
    assetKey(picks[0]!.item, picks[0]!.scene),
    assetKey(picks[1]!.item, picks[1]!.scene),
  );
  assert.ok(!picks.some((p) => p.item.id === "controller"));
  // The street scene was in recent Shorts: the highway scene goes first now.
  const recent = new Map([
    [assetKey(lib.items[0]!, lib.items[0]!.scenes![0]), 2],
  ]);
  const fresh = pickForLines(
    libs,
    [want("The narrower streets are more believable.")],
    { preferVideo: true, recent },
  );
  assert.equal(fresh[0]!.scene!.at, 5);
});

test("the usage ledger counts each asset over the game's last ten Shorts only, never the Short itself", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    episode: `ep${i}`,
    game: "GTA 6",
    at: `2026-11-${String(i + 1).padStart(2, "0")}`,
    keys: ["a", ...(i < 2 ? ["old"] : [])],
  }));
  const r = recentUses(
    [
      ...entries,
      {
        episode: "me",
        game: "Grand Theft Auto VI",
        at: "2026-11-30",
        keys: ["mine"],
      },
    ],
    "Grand Theft Auto VI",
    10,
    "me",
  );
  assert.equal(r.get("a"), 10);
  assert.equal(r.get("old"), undefined); // shown eleven and twelve Shorts ago
  assert.equal(r.get("mine"), undefined);
});

test("a scene index's described shots join the library; blank, menu, lettered and undescribed shots do not", () => {
  const shot = (o: Record<string, unknown>) => ({
    id: 0,
    start: 10,
    end: 14,
    keyframes: [],
    desc: "Franklin drives a car down a highway",
    who: ["Franklin"],
    where: "Los Santos",
    mood: "",
    tags: ["car"],
    text: "",
    luma: 120,
    motion: 20,
    ...o,
  });
  const it = indexAsLibraryItem(
    {
      version: 1,
      game: "Grand Theft Auto V",
      slug: "grand-theft-auto-v",
      builtAt: "",
      coverage: [],
      cast: [],
      places: [],
      lines: [],
      source: {
        videoId: "aD5T3K9mFAw",
        title: "GTA 5 All Cutscenes",
        uploader: "x",
        duration: 1,
        kind: "movie",
        pickedAt: "",
      },
      shots: [
        shot({}),
        shot({ desc: "" }),
        shot({ menu: true }),
        shot({ text: "MISSION PASSED" }),
        shot({ luma: 10 }),
      ],
    } as never,
    "/abs/proxy.mp4",
  )!;
  assert.equal(it.scenes!.length, 1);
  assert.ok(it.scenes![0]!.tags.includes("driving"));
  assert.equal(it.source, "Rockstar Games"); // counted against Rockstar's footage cap
});

// ---------------------------------------------------------------- 2. comparison stories, 3. beat relevance

test("a story comparing GTA 6 with GTA 5 fetches both games and puts each sentence on the right game", () => {
  assert.deepEqual(comparedGames(ROADS), ["Grand Theft Auto V"]);
  const wants = sentenceWants(ROADS);
  const by = (s: string) => wants.find((w) => w.sentence.startsWith(s))!;
  assert.equal(by("Edge's October 29").game, "Grand Theft Auto VI");
  assert.equal(
    by("GTA 5 had deliberately wide roads").game,
    "Grand Theft Auto V",
  );
  assert.ok(by("GTA 5 had deliberately wide roads").tags.includes("road"));
  assert.ok(by("You still get a bigger map").tags.includes("map"));
  assert.deepEqual(
    comparedGames({
      ...ROADS,
      beats: [{ narration: "Vice City is back." }],
      pulse_take: { narration: "" },
      loop_line: "",
    }),
    [],
  );
});

test("only a real map counts as a map, never a minimap or an aerial view", () => {
  assert.equal(realMap("In-game map showing roads and locations in GTA V."), true);
  assert.equal(realMap("helicopter flying over city at night with minimap"), false);
  assert.equal(realMap("Aerial night city view with helicopter and minimap"), false);
  assert.equal(realMap("Aerial view of a highway"), false);
});

test("a map line with a size figure gets an honest to-scale comparison; a vague one gets none", () => {
  assert.deepEqual(mapScale("Edge puts it at roughly 2 times GTA 5's size."), {
    factor: 2,
  });
  assert.deepEqual(mapScale("The map is twice as big."), { factor: 2 });
  assert.equal(mapScale("You still get a bigger map."), undefined);
  assert.equal(mapScale("It sold 2 times as many copies."), undefined);
});

test("in a line with two sentences, the clip chosen for the words said now plays first", () => {
  const clips = [
    {
      durationSeconds: 4,
      beatIndex: 0,
      forWords:
        "Edge's October 29 preview calls the narrower streets more believable.",
    },
    {
      durationSeconds: 4,
      beatIndex: 0,
      forWords: "GTA 5 had deliberately wide roads.",
    },
  ];
  const words =
    "Edge's October 29 preview calls the narrower streets more believable. GTA 5 had deliberately wide roads."
      .split(" ")
      .map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.equal(clipForWords(clips, [0, 1], words, { start: 0, end: 90 }), 0);
  assert.equal(clipForWords(clips, [0, 1], words, { start: 90, end: 160 }), 1);
});

// ---------------------------------------------------------------- 4. no hardware or merchandise

test("controllers, consoles, editions and merch are hardware; a story about them may show them", () => {
  assert.ok(
    isHardwareAsset({
      provenance:
        "Press image from PlayStation press: https://blog.playstation.com/2026/09/03/first-look-at-the-grand-theft-auto-vi-limited-edition-dualsense-wireless-controllers/",
    }),
  );
  assert.ok(
    isHardwareAsset({
      sourceUrl: "https://x/GTAVI_FOB_StandardEdition_Desktop.jpg",
    }),
  );
  assert.ok(
    !isHardwareAsset({
      provenance: 'IGDB screenshot for "Grand Theft Auto VI" (2026)',
    }),
  );
  assert.ok(
    !isHardwareAsset({
      provenance: 'Official Rockstar Games screenshot "Vice City 03"',
    }),
  );
  assert.equal(hardwareStory(ROADS), false);
  assert.equal(
    hardwareStory({
      headline: "The GTA 6 DualSense controller is real",
      hook: "",
      beats: [],
    }),
    true,
  );
});

// ---------------------------------------------------------------- 5. the gate

test("no moving footage, or no footage to open on, holds a Short when footage of the game exists", () => {
  assert.equal(
    footageGate({
      footageShare: 0,
      openingOk: false,
      footageExists: true,
      alreadyRich: false,
    }),
    "regather",
  );
  assert.equal(
    footageGate({
      footageShare: 0,
      openingOk: false,
      footageExists: true,
      alreadyRich: true,
    }),
    "hold",
  );
  assert.equal(
    footageGate({
      footageShare: 0.5,
      openingOk: false,
      footageExists: true,
      alreadyRich: true,
    }),
    "hold",
  );
  assert.equal(
    footageGate({
      footageShare: 0,
      openingOk: false,
      footageExists: false,
      alreadyRich: true,
    }),
    "pass",
  );
  assert.equal(
    footageGate({
      footageShare: 0.6,
      openingOk: true,
      footageExists: true,
      alreadyRich: false,
    }),
    "pass",
  );
});

// ---------------------------------------------------------------- 6. the collage card

test("the game collage card shows only on a spoken line that names the game, for at least 2.5 s", () => {
  const fps = 30;
  const segments = [
    { kind: "hook" as const, start: 0, end: 3 },
    { kind: "beat" as const, start: 3, end: 9 },
    { kind: "take" as const, start: 9, end: 14 },
  ];
  const say = (text: string, from: number) =>
    text
      .split(" ")
      .map((t, i) => ({
        text: t,
        start: from + i * 0.35,
        end: from + i * 0.35 + 0.3,
      }));
  const names = (t: string) => /\bgta 6\b/i.test(t);
  // The roads Short: GTA 6 is named only in the hook, so no card at all.
  const none = stingPlacement({
    segments,
    words: [
      ...say("Why does GTA 6 give you less room", 0),
      ...say("Edge calls the streets believable", 3),
      ...say("Believable streets are worth it", 9),
    ],
    fps,
    totalFrames: 450,
    names,
    pictures: 6,
  });
  assert.equal(none, undefined);
  const at = stingPlacement({
    segments,
    words: [
      ...say("Why so narrow", 0),
      ...say("Rockstar built GTA 6 around Vice City", 3),
    ],
    fps,
    totalFrames: 450,
    names,
    pictures: 6,
  })!;
  assert.ok(at.frames >= STING_MIN_FRAMES);
  assert.equal(at.from, Math.round((3 + 2 * 0.35) * fps));
  assert.equal(
    stingPlacement({
      segments,
      words: say("Rockstar built GTA 6 around Vice City", 3),
      fps,
      totalFrames: 450,
      names,
      pictures: 2,
    }),
    undefined,
  );
  const spans = overlaySpans({
    segments: [],
    words: [],
    plan: { fps, totalFrames: 450, shelf: [], craft: undefined } as never,
    layout: { hookEnd: 90, loopFrom: 450, totalFrames: 450 },
    stamps: [],
    sting: at,
  });
  assert.deepEqual(
    spans.find((x) => x.key === "sting"),
    { key: "sting", kind: "sting", from: at.from, to: at.from + at.frames },
  );
});

// ---------------------------------------------------------------- the gameplay index

test("a gameplay index has its own name and folder, searches playthroughs only and never takes a cutscene movie", () => {
  const name = gameplayIndexName("Grand Theft Auto V");
  assert.equal(name, "Grand Theft Auto V (gameplay)");
  assert.ok(isGameplayIndex(name));
  assert.equal(baseGameOf(name), "Grand Theft Auto V");
  assert.equal(sceneSlug(name), "grand-theft-auto-v-gameplay");
  assert.ok(
    playthroughQueries("Grand Theft Auto V").every((q) =>
      /no commentary|longplay/.test(q),
    ),
  );
  const movie = { videoId: "mmmmmmmmmmm", title: "Grand Theft Auto V All Cutscenes Full Movie", uploader: "u", channel: "u", duration: 7200, height: 1080 };
  const play = { videoId: "ppppppppppp", title: "Grand Theft Auto V Full Game Walkthrough No Commentary", uploader: "u", channel: "u", duration: 30000, height: 1080 };
  assert.equal(pickSource([movie, play] as never, "Grand Theft Auto V")?.videoId, "mmmmmmmmmmm");

  assert.equal(pickSource([movie, play] as never, "Grand Theft Auto V", { playthroughOnly: true })?.videoId, "ppppppppppp");
});

test("library paths are stored with forward slashes on every machine, so a PC-built library reads on the Mac", async () => {
  const { portableFile, writeLibrary, readLibrary } = await import("../src/assets/gamelib.ts");
  assert.equal(portableFile("stills\\igdb-sc166fv.jpg"), "stills/igdb-sc166fv.jpg");
  assert.equal(portableFile("videos/t.mp4"), "videos/t.mp4");
  assert.equal(portableFile("D:\\pulse-data\\proxy.mp4"), "D:\\pulse-data\\proxy.mp4");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");
  const path = await import("node:path");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "lib-"));
  try {
    await writeLibrary(root, { version: 1, game: "Grand Theft Auto VI", updatedAt: "", items: [{ id: "a", kind: "still", file: "stills\\a.jpg", sourceUrl: "a", provenance: "a", source: "IGDB", named: [], tags: [], seen: "", addedAt: "" }] });
    const raw = await fsp.readFile(path.join(root, "grand-theft-auto-vi", "library.json"), "utf8");
    assert.ok(raw.includes('"stills/a.jpg"'));
    assert.equal((await readLibrary(root, "GTA 6"))!.items[0]!.file, "stills/a.jpg");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("a 4K library still is copied into a Short at 1920 pixels across, small enough for the picture checks", async () => {
  const { materialise, libraryDir } = await import("../src/assets/gamelib.ts");
  const { FFMPEG, FFPROBE } = await import("../src/lib/bin.ts");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");
  const path = await import("node:path");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "lib-"));
  const ep = await fsp.mkdtemp(path.join(os.tmpdir(), "ep-"));
  const prev = process.env.GAMELIB_REMOTE;
  delete process.env.GAMELIB_REMOTE;
  try {
    const dir = libraryDir(root, "Grand Theft Auto VI");
    await fsp.mkdir(path.join(dir, "stills"), { recursive: true });
    await exec(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x406080:s=3840x2160", "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2", path.join(dir, "stills", "big.zip")]);
    const item = { id: "big", kind: "still" as const, file: "stills/big.zip", sourceUrl: "x", provenance: "x", source: "Rockstar Games", named: [], tags: [], seen: "", addedAt: "" };
    const made = await materialise(root, { key: "beat:0", sentence: "x", game: "Grand Theft Auto VI", item, score: 1 }, ep);
    assert.ok(made && made.file.endsWith(".jpg"));
    const { stdout } = await exec(FFPROBE, ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", path.join(ep, made!.file)]);
    assert.equal(Number(String(stdout).trim()), 1920);
  } finally {
    if (prev !== undefined) process.env.GAMELIB_REMOTE = prev;
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(ep, { recursive: true, force: true });
  }
});

test("a comparison line's footage of the other game never opens the Short", async () => {
  const { openingCandidates, clipOfOtherGame } = await import("../src/openingstep.ts");
  const own = { provenance: "Pulse's own gameplay capture of Grand Theft Auto V (stream.mp4), 6.0s at 1861s", durationSeconds: 4.2, motion: 0.9 };
  const six = { provenance: 'Official trailer "Trailer 1" from Rockstar Games\'s own site, publisher: Rockstar Games', durationSeconds: 3, motion: 0.5 };
  assert.equal(clipOfOtherGame(own, "Grand Theft Auto VI"), true);
  assert.equal(clipOfOtherGame(six, "Grand Theft Auto VI"), false);
  assert.equal(clipOfOtherGame(own, "Grand Theft Auto V"), false);
  assert.deepEqual(openingCandidates([own, six] as never, { game: "Grand Theft Auto VI", entries: 0 } as never), [1]);
});

test("a picture chosen for a sentence plays over a cut inside that sentence, even when the sentence spans several cuts", async () => {
  const { pictureForWords } = await import("../src/render/plan.ts");
  const sentence = "Edge puts it at roughly 2 times GTA 5's size.";
  const words = sentence.split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const images = [{ kind: "screenshot", aspect: 1, forWords: sentence }];
  // A cut over the first four words only: a third of the sentence, all of it from the sentence.
  assert.equal(pictureForWords(images as never, words, { start: 0, end: 36 }, [0]), 0);
  // A cut over other words: nothing.
  const other = "Believable streets are worth giving up space.".split(" ").map((text, i) => ({ text, start: 10 + i * 0.3, end: 10 + i * 0.3 + 0.25 }));
  assert.equal(pictureForWords(images as never, [...words, ...other], { start: 300, end: 390 }, [0]), undefined);
});

test("the hook only takes a scene long enough to open the Short", async () => {
  const { pickForLines, HOOK_SCENE_SECONDS } = await import("../src/assets/gamelib.ts");
  const lib = {
    version: 1, game: "Grand Theft Auto VI", updatedAt: "",
    items: [{ id: "t", kind: "video" as const, file: "t.mp4", sourceUrl: "t", provenance: "t", source: "Rockstar Games", named: [], tags: [], seen: "", addedAt: "",
      scenes: [{ at: 10, end: 11.6, tags: ["driving", "road", "car"], seen: "a car" }, { at: 20, end: 24, tags: ["driving", "road"], seen: "a road" }] }],
  };
  const libs = new Map([["Grand Theft Auto VI", lib]]);
  const [hook] = pickForLines(libs, [{ key: "hook", sentence: "Why less room to drive?", game: "Grand Theft Auto VI", tags: ["driving", "road", "car"], names: [] }], { preferVideo: true });
  assert.ok(hook!.scene!.end - hook!.scene!.at >= HOOK_SCENE_SECONDS);
  const [beat] = pickForLines(libs, [{ key: "beat:0", sentence: "x", game: "Grand Theft Auto VI", tags: ["driving", "road", "car"], names: [] }], { preferVideo: true });
  assert.equal(beat!.scene!.at, 10);
});

test("a letterboxed trailer scene is cut without its black bars; a full-frame one is left alone", async () => {
  const { letterboxFilter } = await import("../src/assets/gamelib.ts");
  assert.equal(letterboxFilter(3840, 2160, 3840, 1600, 0, 280), "crop=3840:1600:0:280,");
  assert.equal(letterboxFilter(1920, 1080, 1920, 1080, 0, 0), undefined);
  assert.equal(letterboxFilter(1920, 1080, 1920, 1040, 0, 20), undefined); // thin bars stay
  assert.equal(letterboxFilter(1920, 1080, 1200, 800, 360, 140), undefined); // a dark scene, not a letterbox
});
