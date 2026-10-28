import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_MAX_LINES,
  CAPTURE_PER_GAME,
  captureChecklist,
  captureMessage,
  maybeSendCaptureChecklist,
} from "../src/capture.ts";
import type { AnyMoment } from "../src/editorial/longform.ts";
import type { Script } from "../src/editorial/schema.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";

const OWNER = ["Grand Theft Auto V", "Grand Theft Auto VI"];

const moment = (show: string, broll = ""): AnyMoment =>
  ({
    show,
    keywords: [],
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
    emphasis: "",
    broll,
  }) as AnyMoment;

type Entry = NonNullable<Script["entries"]>[number];
const entry = (rank: number, game_title: string, shows: string[]): Entry => ({
  rank,
  game_title,
  steam_search_term: "",
  year: 2013,
  platforms: "PS5, Xbox",
  moments: shows.map((s) => moment(s)),
});

function longScript(entries: Entry[], extra: Partial<Script> = {}): Script {
  return goodScript({
    game_title: "Grand Theft Auto",
    headline: "Every GTA Ranked",
    runtime: "long",
    evergreen_format: "ranking",
    beats: entries.map(() => ({
      narration: "A sentence.",
      footage: { want: "gameplay", keywords: [] },
      visual: { kind: "none", primary: "", secondary: "" },
    })),
    youtube: {
      title: "Every GTA Game Ranked",
      description: "",
      tags: [],
    },
    entries,
    ...extra,
  });
}

test("only the owner's own games get a checklist, never a sequel or an older game in the series", () => {
  const script = longScript([
    entry(3, "Grand Theft Auto: Vice City", ["Tommy on the Ocean Drive strip"]),
    entry(2, "Grand Theft Auto V", [
      "A slow drive along the Vespucci beach at sunset.",
      "A five-star police chase through downtown Los Santos",
      "A five-star police chase through downtown Los Santos", // a repeat is listed once
    ]),
    entry(1, "Grand Theft Auto VI", ["Jason and Lucia robbing a store"]),
  ]);
  const list = captureChecklist(script, OWNER);
  assert.ok(list);
  assert.deepEqual(
    list.games.map((g) => g.game),
    ["Grand Theft Auto V", "Grand Theft Auto VI"],
  );
  assert.deepEqual(list.games[0]!.shots, [
    "A slow drive along the Vespucci beach at sunset",
    "A five-star police chase through downtown Los Santos",
  ]);
  assert.deepEqual(list.games[1]!.shots, ["Jason and Lucia robbing a store"]);
});

test("nothing is sent for games the owner does not play", () => {
  const script = longScript([
    entry(2, "Grand Theft Auto: San Andreas", ["CJ on Grove Street"]),
    entry(1, "Red Dead Redemption 2", ["Arthur riding through the snow"]),
  ]);
  assert.equal(captureChecklist(script, OWNER), undefined);
  assert.equal(captureChecklist(script, []), undefined);
  assert.equal(
    captureChecklist(goodScript({ entries: undefined }), OWNER),
    undefined,
  );
});

test("at most five things per game and ten lines in all; real-world B-roll is left out", () => {
  const shots = (n: string) =>
    Array.from({ length: 8 }, (_, i) => `${n} moment number ${i + 1}`);
  const v = entry(3, "Grand Theft Auto V", shots("Five"));
  v.moments = [
    moment("Rockstar's office in Edinburgh", "Rockstar North office"),
    ...v.moments!,
  ];
  const script = longScript([
    v,
    entry(2, "Grand Theft Auto VI", shots("Six")),
    entry(1, "Half-Life 2 RTX", shots("Rtx")),
  ]);
  const list = captureChecklist(script, [...OWNER, "Half-Life 2 RTX"]);
  assert.ok(list);
  const all = list.games.flatMap((g) => g.shots);
  assert.equal(all.length, CAPTURE_MAX_LINES);
  for (const g of list.games) assert.ok(g.shots.length <= CAPTURE_PER_GAME);
  assert.equal(list.games[0]!.shots[0], "Five moment number 1");
  assert.ok(!all.some((s) => /Edinburgh/.test(s)));
  assert.deepEqual(
    list.games.map((g) => g.game),
    ["Grand Theft Auto V", "Grand Theft Auto VI"],
  );
});

test("a documentary chapter without a shot list falls back to its footage asks", () => {
  const script = goodScript({
    game_title: "Grand Theft Auto",
    runtime: "long",
    evergreen_format: "documentary",
    beats: [
      {
        narration: "Chapter one.",
        footage: { want: "world", keywords: ["Liberty City"] },
        visual: {
          kind: "chapter",
          primary: "Liberty City",
          secondary: "Grand Theft Auto IV",
        },
      },
      {
        narration: "Chapter two.",
        footage: { want: "world", keywords: ["Los Santos beach", "sunset"] },
        visual: {
          kind: "chapter",
          primary: "Los Santos",
          secondary: "Grand Theft Auto V",
        },
      },
      {
        narration: "More of chapter two.",
        footage: {
          want: "vehicle",
          keywords: ["Grand Theft Auto V", "police chase"],
        },
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    entries: [
      {
        rank: 2,
        game_title: "Grand Theft Auto IV",
        steam_search_term: "",
        year: 2008,
        platforms: "PC",
      },
      {
        rank: 1,
        game_title: "Grand Theft Auto V",
        steam_search_term: "",
        year: 2013,
        platforms: "PC",
      },
    ],
  });
  assert.deepEqual(captureChecklist(script, OWNER), {
    games: [
      {
        game: "Grand Theft Auto V",
        shots: [
          "A slow look around Los Santos beach and sunset",
          "A drive with police chase",
        ],
      },
    ],
  });
});

test("the message is plain, gives the deadline and says clips arrive by themselves", () => {
  const text = captureMessage(
    "Every GTA Game Ranked",
    {
      games: [
        { game: "Grand Theft Auto V", shots: ["A five-star police chase"] },
      ],
    },
    new Date("2026-10-31T20:00:00Z"),
    "Europe/London",
  );
  assert.match(
    text,
    /"Every GTA Game Ranked" goes out Saturday 31 October at 8:00 pm/,
  );
  assert.match(text, /\*\*Grand Theft Auto V\*\*\n- A five-star police chase/);
  assert.match(text, /Twitch/);
  assert.match(text, /Xbox capture/);
  assert.ok(!/[–—]/.test(text));
});

test("the checklist is sent once, and only with at least 12 hours to play", async () => {
  const db = await testDb();
  const sent: DiscordMessage[] = [];
  const now = new Date("2026-10-28T10:00:00Z");
  const s = {
    cfg: testConfig(await tmpDir(), {
      ownerGames: OWNER,
      captureChecklist: true,
    }),
    db,
    notify: async (m: DiscordMessage) => {
      sent.push(m);
      return true;
    },
    now: () => now,
  };
  const script = longScript([
    entry(1, "Grand Theft Auto V", ["A heist getaway"]),
  ]);
  const ep = (id: string, hours: number) => ({
    id,
    lane: "longform",
    script_json: script,
    publish_at: null,
    slot_at: new Date(now.getTime() + hours * 3600_000).toISOString(),
  });
  assert.equal(await maybeSendCaptureChecklist(s, ep("soon", 8)), false);
  assert.equal(await maybeSendCaptureChecklist(s, ep("later", 48)), true);
  assert.equal(await maybeSendCaptureChecklist(s, ep("later", 48)), false);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.content!, /A heist getaway/);
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM events WHERE kind = 'capture_checklist' AND episode_id = 'later'`,
  );
  assert.equal(rows[0]!.n, 1);
  s.cfg.captureChecklist = false;
  assert.equal(await maybeSendCaptureChecklist(s, ep("off", 48)), false);
  assert.equal(sent.length, 1);
  await db.close();
});
