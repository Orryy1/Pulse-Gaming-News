import { test } from "node:test";
import assert from "node:assert/strict";
import {
  footageWaitPlan,
  isFootageHold,
  launchOf,
  planFootageShare,
  premakeNextLook,
  premakeRefreshDecision,
  refreshAssets,
  remakeVerdict,
  restoredAssets,
  PREMADE_VIDEO,
} from "../src/premakerefresh.ts";
import { loadConfig } from "../src/config.ts";

const GTA = [
  {
    game: "Grand Theft Auto VI",
    match: String.raw`gta (6|vi)\b|grand theft auto (6|vi)\b`,
    launch: "2026-11-19",
  },
];
const plan = (clipFrames: number, total = 900) => ({
  totalFrames: total,
  shots: [
    { start: 0, end: clipFrames, media: { type: "clip" } },
    { start: clipFrames, end: total, media: { type: "image" } },
  ],
});

test("the Scooter Bros case: made on 15 Nov, GTA VI out on 19 Nov, looked at on 20 Nov before its 12:00 slot: made again", () => {
  const d = premakeRefreshDecision({
    now: new Date("2026-11-20T09:00:00Z"),
    slotAt: "2026-11-20T12:00:00Z",
    gatheredAt: "2026-11-15T01:04:21Z",
    launches: GTA,
    game: "Grand Theft Auto VI",
    headline: "GTA 6: Why its Scooter Bros could save you the walk back",
    plan: plan(0),
  });
  assert.equal(d.refresh, true);
  assert.match(d.why, /came out on 2026-11-19/);
  assert.match(d.why, /only 0% of it is moving footage/);
});

test("refresh rules: once, never too close to the slot, nothing when nothing changed, the story's own date counts", () => {
  const base = {
    now: new Date("2026-11-20T09:00:00Z"),
    slotAt: "2026-11-20T12:00:00Z",
    gatheredAt: "2026-11-15T01:00:00Z",
    launches: GTA,
    game: "Grand Theft Auto VI",
  };
  assert.equal(
    premakeRefreshDecision({ ...base, already: true }).refresh,
    false,
  );
  const late = premakeRefreshDecision({
    ...base,
    now: new Date("2026-11-20T11:00:00Z"),
  });
  assert.equal(late.refresh, false);
  assert.match(late.why, /too close/);
  // Gathered after the launch, with plenty of footage: nothing to do.
  assert.equal(
    premakeRefreshDecision({
      ...base,
      gatheredAt: "2026-11-19T12:00:00Z",
      plan: plan(700),
    }).refresh,
    false,
  );
  // Another game, plenty of footage, but its story's date passed since.
  const key = premakeRefreshDecision({
    ...base,
    game: "Halo",
    launches: [],
    keyDate: "2026-11-18",
    plan: plan(700),
  });
  assert.equal(key.refresh, true);
  assert.match(key.why, /story's date/);
  // Thin footage alone waits for the last 12 hours before the slot.
  const thinEarly = premakeRefreshDecision({
    ...base,
    game: "Halo",
    launches: [],
    now: new Date("2026-11-19T09:00:00Z"),
    plan: plan(100),
  });
  assert.equal(thinEarly.refresh, false);
  const thinLate = premakeRefreshDecision({
    ...base,
    game: "Halo",
    launches: [],
    plan: plan(100),
  });
  assert.equal(thinLate.refresh, true);
  assert.equal(
    launchOf(GTA, "Starfield", "GTA 6 holds 99")?.game,
    "Grand Theft Auto VI",
  );
});

test("footage share, the next look, and the remake verdicts", () => {
  assert.equal(planFootageShare(plan(450)), 0.5);
  assert.equal(planFootageShare(undefined), 0);
  const hold = new Date("2026-11-20T10:00:00Z");
  assert.equal(
    premakeNextLook(hold, new Date("2026-11-16T00:00:00Z"), true).toISOString(),
    "2026-11-16T06:00:00.000Z",
  );
  assert.equal(
    premakeNextLook(hold, new Date("2026-11-20T08:00:00Z"), true).toISOString(),
    hold.toISOString(),
  );
  assert.equal(
    premakeNextLook(
      hold,
      new Date("2026-11-16T00:00:00Z"),
      false,
    ).toISOString(),
    hold.toISOString(),
  );
  const at = {
    now: new Date("2026-11-20T10:00:00Z"),
    slotAt: "2026-11-20T12:00:00Z",
    originalShare: 0.2,
  };
  assert.equal(
    remakeVerdict({ ...at, status: "approved", newShare: 0.6 }).action,
    "keep",
  );
  assert.equal(
    remakeVerdict({ ...at, status: "approved", newShare: 0.1 }).action,
    "restore",
  );
  assert.equal(remakeVerdict({ ...at, status: "failed" }).action, "restore");
  assert.equal(remakeVerdict({ ...at, status: "voiced" }).action, "wait");
  assert.equal(
    remakeVerdict({
      ...at,
      status: "voiced",
      now: new Date("2026-11-20T11:30:00Z"),
    }).action,
    "restore",
  );
  assert.equal(remakeVerdict({ ...at, status: "published" }).action, "wait");
});

test("the remake drops every gathered thing, keeps the voice, and the made one comes back whole", () => {
  const assets = {
    audio: "voice.mp3",
    words: [{ text: "a", start: 0, end: 1 }],
    images: [{ file: "x.jpg" }],
    clips: [],
    steam: { appId: 1 },
    plan: plan(0),
    video: "short.mp4",
    poster: "poster.jpg",
    mentions: { kinds: [], items: [] },
  };
  const next = refreshAssets(assets, {
    at: new Date("2026-11-20T09:00:00Z"),
    why: "out",
    share: 0,
    qa: { rubric: 1 },
    video: true,
    poster: true,
  });
  for (const k of [
    "images",
    "clips",
    "steam",
    "plan",
    "video",
    "poster",
    "mentions",
  ])
    assert.equal(next[k], undefined, k);
  assert.equal(next.audio, "voice.mp3");
  const rec = next.premadeRefresh as {
    state: string;
    original: Record<string, unknown>;
    originalQa: unknown;
  };
  assert.equal(rec.state, "remaking");
  assert.equal(rec.original.video, PREMADE_VIDEO);
  assert.deepEqual(rec.originalQa, { rubric: 1 });
  const back = restoredAssets(
    { ...next, images: [{ file: "new.jpg" }] },
    "late",
  )!;
  assert.deepEqual(back.images, [{ file: "x.jpg" }]);
  assert.equal(back.video, "short.mp4");
  assert.equal(back.poster, "poster.jpg");
  assert.equal((back.premadeRefresh as { state: string }).state, "restored");
  assert.equal(
    (back.premadeRefresh as { original?: unknown }).original,
    undefined,
  );
});

test("SHORT_FOOTAGE_WAIT: waits only for a YouTube pause, once, and not for a very long one", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  const until = Date.parse("2026-11-20T22:19:00Z");
  const w = footageWaitPlan({
    now,
    blockUntil: until,
    metPause: true,
    waitedBefore: false,
  });
  assert.equal(w.wait && w.at.toISOString(), "2026-11-20T22:34:00.000Z");
  assert.equal(
    footageWaitPlan({
      now,
      blockUntil: until,
      metPause: true,
      waitedBefore: true,
    }).wait,
    false,
  );
  assert.equal(
    footageWaitPlan({ now, metPause: false, waitedBefore: false }).wait,
    false,
  );
  assert.equal(
    footageWaitPlan({
      now,
      blockUntil: now + 100 * 3_600_000,
      metPause: true,
      waitedBefore: false,
    }).wait,
    false,
  );
  assert.equal(
    isFootageHold(
      'QA held: "GTA Online needed more than heists" is held: no moving footage of Grand Theft Auto Online on screen (footage share 0%)',
    ),
    true,
  );
  assert.equal(isFootageHold("QA held: spoilers"), false);
});

test("the switches: PREMAKE_REFRESH and SHORT_FOOTAGE_WAIT default on", () => {
  const before = [process.env.PREMAKE_REFRESH, process.env.SHORT_FOOTAGE_WAIT];
  delete process.env.PREMAKE_REFRESH;
  delete process.env.SHORT_FOOTAGE_WAIT;
  const c = loadConfig();
  assert.equal(c.premakeRefresh, true);
  assert.equal(c.shortFootageWait, true);
  process.env.PREMAKE_REFRESH = "false";
  assert.equal(loadConfig().premakeRefresh, false);
  if (before[0] === undefined) delete process.env.PREMAKE_REFRESH;
  else process.env.PREMAKE_REFRESH = before[0];
  if (before[1] !== undefined) process.env.SHORT_FOOTAGE_WAIT = before[1];
});

test("a launched big release gets a gameplay index planned beside its cutscene movie, a day after launch", async () => {
  const { gameplayPlan, plannedQueue } = await import("../src/sceneindex/gamefetch.ts");
  const rec = {
    game: "Grand Theft Auto VI",
    slug: "grand-theft-auto-vi",
    release: "2026-11-19",
    signals: ["owner" as const],
    why: ["GAME_FETCH_TITLES"],
    firstSeen: "2026-11-12T04:43:55.782Z",
    status: "indexed" as never,
    updatedAt: "2026-11-20T00:00:00Z",
  };
  const plan = { notBefore: "2026-11-18T11:00:00.000Z", searchEveryHours: 3, recheckEveryHours: 24, recheckUntil: "2026-12-18T00:00:00.000Z", priority: 50 };
  const p = gameplayPlan(rec, plan, new Date("2026-11-20T10:00:00Z"))!;
  assert.equal(p.notBefore, "2026-11-20T00:00:00.000Z");
  assert.equal(p.priority, 45);
  assert.equal(gameplayPlan(rec, plan, new Date("2026-11-18T10:00:00Z")), undefined, "not before the launch");
  assert.equal(gameplayPlan({ ...rec, signals: ["videos" as never] }, plan, new Date("2026-11-20T10:00:00Z")), undefined, "big releases only");
  assert.equal(gameplayPlan({ ...rec, game: "Grand Theft Auto VI (gameplay)" }, plan, new Date("2026-11-20T10:00:00Z")), undefined);
  const q = plannedQueue({ games: [] }, { games: [rec] }, new Date("2026-11-20T10:00:00Z"), {
    hours: 3,
    recheckHours: 24,
    recheckDays: 28,
    days: 28,
    openingShare: 0.1,
  });
  assert.deepEqual(
    q.games.map((g) => g.game),
    ["Grand Theft Auto VI", "Grand Theft Auto VI (gameplay)"],
  );
});

test("launch timing: media gathered the day before launch in the UK still predates the launch for most viewers", () => {
  const d = premakeRefreshDecision({
    now: new Date("2026-11-20T09:00:00Z"),
    slotAt: "2026-11-20T12:00:00Z",
    gatheredAt: "2026-11-18T15:00:00Z",
    launches: GTA,
    game: "Grand Theft Auto VI",
  });
  assert.equal(d.refresh, true);
  // Gathered once the launch day had started everywhere: nothing new.
  assert.equal(
    premakeRefreshDecision({ now: new Date("2026-11-20T09:00:00Z"), slotAt: "2026-11-20T12:00:00Z", gatheredAt: "2026-11-19T13:00:00Z", launches: GTA, game: "Grand Theft Auto VI" }).refresh,
    false,
  );
});

test("the made video's thumbnails come back with it; one only the remake made is removed", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { keepMadeFiles, putMadeFilesBack } = await import("../src/premakerefresh.ts");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "premade-"));
  await fs.writeFile(path.join(dir, "short.mp4"), "made");
  await fs.writeFile(path.join(dir, "poster.jpg"), "made poster");
  await fs.writeFile(path.join(dir, "thumb_short.jpg"), "made thumb");
  assert.deepEqual(await keepMadeFiles(dir), { video: true, poster: true });
  // The remake writes over everything, and adds a search thumbnail the made one never had.
  await fs.writeFile(path.join(dir, "short.mp4"), "remake");
  await fs.writeFile(path.join(dir, "thumb_short.jpg"), "remake thumb");
  await fs.writeFile(path.join(dir, "thumb_search.jpg"), "remake search");
  assert.equal(await putMadeFilesBack(dir), true);
  assert.equal(await fs.readFile(path.join(dir, "short.mp4"), "utf8"), "made");
  assert.equal(await fs.readFile(path.join(dir, "thumb_short.jpg"), "utf8"), "made thumb");
  await assert.rejects(fs.stat(path.join(dir, "thumb_search.jpg")));
  await fs.rm(dir, { recursive: true, force: true });
});
