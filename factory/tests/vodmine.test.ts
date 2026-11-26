import test from "node:test";
import assert from "node:assert/strict";
import {
  backMeta,
  backMoments,
  overlapsTaken,
  pickMoments,
  takenFrom,
  type BackMoment,
} from "../src/liveclips/vodmine.ts";
import type { SecondSample } from "../src/liveclips/detect.ts";
import { gameplayScript, type GameplayReview } from "../src/gameplay.ts";
import { loadProfile, wantedEvents, type RawSample } from "../src/hudreader/telemetry.ts";

const T0 = Date.parse("2026-11-23T00:00:00Z");

/** A quiet stream. */
function quiet(seconds: number): SecondSample[] {
  return Array.from({ length: seconds }, (_, i) => ({
    at: T0 + i * 1000,
    loud: -30,
    motion: 0.02,
  }));
}

const moment = (over: Partial<BackMoment>): BackMoment => ({
  at: 100,
  start: 86,
  end: 126,
  peakInClip: 14,
  score: 1.2,
  kinds: ["hud"],
  details: ["on screen: Wasted"],
  story: false,
  ...over,
});

test("a HUD event in a quiet stretch becomes a moment with its build-up kept", () => {
  const ms = backMoments(
    quiet(1800),
    [{ t: 900, score: 1.2, detail: "Wasted" }],
    {
      startMs: T0,
      minScore: 1,
    },
  );
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.at, 900);
  assert.equal(ms[0]!.start, 886);
  assert.equal(ms[0]!.end, 926);
  assert.deepEqual(ms[0]!.kinds, ["hud"]);
  assert.equal(ms[0]!.story, false);
});

test("a weak HUD event alone is not a moment, and a mission result is a story moment", () => {
  const weak = backMoments(
    quiet(1800),
    [{ t: 900, score: 0.6, detail: "Mission failed" }],
    {
      startMs: T0,
      minScore: 1,
    },
  );
  assert.equal(weak.length, 0);
  const story = backMoments(
    quiet(1800),
    [{ t: 1200, score: 1.2, detail: 'Mission passed ("MISSION PASSED")' }],
    { startMs: T0, minScore: 1 },
  );
  assert.equal(story.length, 1);
  assert.equal(story[0]!.story, true);
});

test("a HUD event in the last seconds of a recording is still found", () => {
  const ms = backMoments(
    quiet(600),
    [{ t: 595, score: 1.2, detail: "Busted" }],
    { startMs: T0, minScore: 1 },
  );
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.at, 595);
});

test("taken windows are never filed again, with a margin either side", () => {
  assert.equal(overlapsTaken(100, 140, [[150, 190]]), true); // 10 s apart, inside the margin
  assert.equal(overlapsTaken(100, 140, [[200, 240]]), false);
  assert.equal(overlapsTaken(100, 140, [[60, 90]]), true);
});

test("the owner's recordings file only HUD-backed moments; the cousin's loudest count too", () => {
  const ms = [
    moment({ at: 100, start: 86, end: 126, score: 1.2 }),
    moment({
      at: 400,
      start: 386,
      end: 426,
      score: 2.5,
      kinds: ["loudness"],
      details: ["sound"],
    }),
    moment({ at: 410, start: 396, end: 436, score: 1.1 }),
    moment({ at: 900, start: 886, end: 926, score: 1.8 }),
  ];
  const own = pickMoments(ms, [[880, 920]], {
    top: 3,
    hudOnly: true,
    gapSeconds: 120,
    minScore: 1,
  });
  assert.deepEqual(
    own.map((m) => m.at),
    [100, 410],
  );
  const cousin = pickMoments(ms, [], {
    top: 2,
    hudOnly: false,
    gapSeconds: 120,
    minScore: 1,
  });
  // HUD-backed first, then strength: 900 (1.8) and 100 (1.2).
  assert.deepEqual(
    cousin.map((m) => m.at),
    [100, 900],
  );
  // The loud one at 400 loses to the HUD-backed one 10 s away (one moment, not two).
  const three = pickMoments(ms, [], {
    top: 3,
    hudOnly: false,
    gapSeconds: 120,
    minScore: 1,
  });
  assert.deepEqual(
    three.map((m) => m.at),
    [100, 410, 900],
  );
});

test("taken spans come from inbox entries and live_taken.json, by the VOD id in the file name", () => {
  const t = takenFrom(
    [
      {
        source: {
          file: "/Volumes/Storage/TinoTV VODs/2026-11-23 GTA 6 [v2938662394].mp4",
          title: "",
          kind: "twitch_vod",
        },
        clip: { file: "clip.mp4", start_in_source: 4753, seconds: 40 },
      },
      {
        source: {
          file: "twitch live stream 1",
          title: "",
          kind: "twitch_live",
        },
        clip: { file: "clip.mp4", start_in_source: 10, seconds: 40 },
      },
    ],
    { v2938662394: [[100, 140]] },
  );
  assert.deepEqual(t, {
    v2938662394: [
      [100, 140],
      [4753, 4793],
    ],
  });
});

test("an inbox entry carries the cousin's credit and the HUD's events; a story moment is held until the window", () => {
  const now = new Date("2026-11-26T15:00:00Z");
  const rec = {
    file: "D:/v/Spencey96 VODs/x [v1].mp4",
    title: "GTA VI Chapter 2",
    vodId: "v1",
    seconds: 3600,
    credit: "Gameplay: Spencey96 on Twitch",
  };
  const m = backMeta(
    moment({}),
    rec,
    ["frames/01.jpg"],
    now,
    "2026-12-18T00:00:00Z",
  );
  assert.equal(m.status, "new");
  assert.equal(m.source.credit, "Gameplay: Spencey96 on Twitch");
  assert.equal(m.source.kind, "twitch_vod");
  assert.equal(m.clip.start_in_source, 86);
  assert.deepEqual(m.hud, { facts: [], events: ["Wasted"] });
  assert.match(m.id, /^gp_hud_[0-9a-f]{10}$/);
  assert.equal(
    backMeta(moment({}), rec, [], now).id,
    m.id,
    "the same moment keeps its id",
  );
  const held = backMeta(
    moment({ story: true }),
    { ...rec, credit: "" },
    [],
    now,
    "2026-12-18T00:00:00Z",
  );
  assert.equal(held.status, "rejected");
  assert.equal(held.review?.spoiler_held_until, "2026-12-18T00:00:00Z");
  assert.equal(held.source.credit, undefined);
  const after = backMeta(
    moment({ story: true }),
    rec,
    [],
    new Date("2026-12-19T00:00:00Z"),
    "2026-12-18T00:00:00Z",
  );
  assert.equal(after.status, "new");
});

test("a gameplay Short from the cousin's play credits him in the attribution and the description", () => {
  const r = {
    keep: true,
    score: 8,
    reason: "",
    game_title: "Grand Theft Auto VI",
    real_test: false,
    experiment_number: 0,
    question: "Can you outrun a 3-star chase on a boat",
    result_line: "GONE",
    result: "The stars faded out.",
    start_seconds: 0,
    end_seconds: 30,
    youtube_title: "Boat escape",
    description: "A boat escape in Vice City.",
    hashtags: ["GTA6"],
    radio_audible: false,
    spoiler: false,
    strong_language: false,
    captions_ok: true,
  } as GameplayReview;
  const own = gameplayScript(r, "gp_a", []);
  assert.equal(own.attribution, "Gameplay: Pulse Gaming");
  assert.equal(own.youtube.description, "A boat escape in Vice City.");
  const his = gameplayScript(
    r,
    "gp_b",
    [],
    false,
    "Gameplay: Spencey96 on Twitch",
  );
  assert.equal(his.attribution, "Gameplay: Spencey96 on Twitch");
  assert.equal(
    his.youtube.description,
    "A boat escape in Vice City.\n\nGameplay: Spencey96 on Twitch",
  );
});

test("the GTA VI profile is calibrated from the owner's streams: six slots filled from the right, the radar's outline", async () => {
  const vi = (await loadProfile("gta6")) as unknown as {
    calibrated: boolean;
    wanted: {
      max: number;
      fill: string;
      emptyDarker: boolean;
      slots: { x: number[] };
    };
    minimap: { frame?: { minShare: number }; bars?: unknown };
  };
  assert.equal(vi.calibrated, true);
  assert.equal(vi.wanted.max, 6);
  assert.equal(vi.wanted.slots.x.length, 6);
  assert.equal(vi.wanted.fill, "right");
  assert.equal(vi.wanted.emptyDarker, true);
  assert.ok(vi.minimap.frame && vi.minimap.frame.minShare > 0.5);
  assert.equal(vi.minimap.bars, undefined);
});

test("stars read on a frame without the radar count (GTA VI hides it in a chase); a bare frame without it does not", () => {
  const samples: RawSample[] = [
    { t: 0, state: "hud", stars: 0 },
    { t: 2, state: "other", stars: 0, dim: 3 },
    { t: 4, state: "other", stars: 0, dim: 3 },
    { t: 6, state: "other" },
    { t: 8, state: "hud", stars: 3 },
  ];
  const ev = wantedEvents(samples).events;
  assert.equal(ev[0]!.kind, "wanted_start");
  assert.equal(ev[0]!.value, 3);
  assert.ok(!ev.some((e) => e.kind === "wanted_clear"));
});

test("a moment in the first seconds starts its clip at 0 and keeps its true place in it", () => {
  const ms = backMoments(quiet(600), [{ t: 5.4, score: 1.2, detail: "Wasted" }], { startMs: T0, minScore: 1 });
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.start, 0);
  assert.equal(ms[0]!.end, 40);
  assert.equal(ms[0]!.peakInClip, 5.4);
});

test("a credited clip never feeds the owner's own footage, his series or a 'we tested' article", async () => {
  const { articleFields } = await import("../src/gameplay.ts");
  const g = { question: "Can you?", result: "Yes.", real_test: true };
  assert.deepEqual(articleFields(g, "Grand Theft Auto VI"), { question: "Can you?", result: "Yes." });
  assert.deepEqual(articleFields({ ...g, credit: "Gameplay: Spencey96 on Twitch" }, "Grand Theft Auto VI"), {});
  const { inboxFiles } = await import("../src/assets/library.ts");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vodmine-"));
  for (const [id, credit] of [["gp_own", undefined], ["gp_his", "Gameplay: Spencey96 on Twitch"]] as const) {
    const dir = path.join(root, "inbox", id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "clip.mp4"), "x");
    await fs.writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({ status: "rejected", source: { file: "f", title: "", kind: "twitch_vod", ...(credit ? { credit } : {}) }, clip: { file: "clip.mp4" }, review: { game: "Grand Theft Auto VI" } }),
    );
  }
  const files = await inboxFiles(root);
  assert.deepEqual(files.map((f) => path.basename(path.dirname(f.file))), ["gp_own"]);
  const his = gameplayScript(
    { keep: true, score: 8, reason: "", game_title: "Grand Theft Auto VI", real_test: true, experiment_number: 0, question: "Q", result_line: "R", result: "R.", start_seconds: 0, end_seconds: 30, youtube_title: "T", description: "D", hashtags: [], radio_audible: false, spoiler: false, strong_language: false, captions_ok: true } as GameplayReview,
    "gp_his", [], false, "Gameplay: Spencey96 on Twitch",
  );
  assert.equal(his.gameplay?.credit, "Gameplay: Spencey96 on Twitch");
  assert.deepEqual(articleFields(his.gameplay!, "Grand Theft Auto VI"), {});
});
