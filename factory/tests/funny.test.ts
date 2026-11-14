import { test } from "node:test";
import assert from "node:assert/strict";
import {
  funnyProblem,
  funnySettings,
  funnySummary,
} from "../src/funny/settings.ts";
import {
  burstCount,
  ENV_HZ,
  musicIn,
  parseFlatness,
  parseRms,
  soundCues,
} from "../src/funny/audio.ts";
import {
  actionBursts,
  finalRank,
  gatherEvidence,
  hudWeight,
  payoffOf,
  rankBySignals,
  REACTION_LAG,
  visionVeto,
  type FunnyCandidate,
  type VisionVerdict,
} from "../src/funny/moments.ts";
import {
  AD_SAFE_SECONDS,
  captionProblems,
  funnyFilter,
  funnyPlan,
  pickCaption,
  REPLAY_SPEED,
  strongLanguage,
} from "../src/funny/edit.ts";
import { comedyVerdict } from "../src/funny/vision.ts";
import {
  funnyDayOpen,
  funnyGame,
  funnyKept,
  funnyOf,
  funnyRenderProblems,
  funnyReview,
  funnyScript,
  funnyShortProps,
  funnySlot,
  isFunnyHash,
  type FunnyClipMeta,
} from "../src/funny/review.ts";
import { channelRate, judgeTrial, trialLine } from "../src/funny/verdict.ts";
import {
  MEME_BANK,
  memeProblems,
  memeTags,
  pickMeme,
} from "../src/funny/meme.ts";
import { inSpoilerWindow, memeDue } from "../src/funny/job.ts";
import { reactionEnd } from "../src/funny/finder.ts";
import {
  subsFormat,
  type SubsFormat,
  type SubsTally,
} from "../src/subslearn/learn.ts";
import { gameplayScript } from "../src/gameplay.ts";
import { localTime } from "../src/lanes.ts";
import { tagOn } from "../src/render/GameplayShort.tsx";

const TZ = "Europe/London";

// ------------------------------------------------------------------ settings

test("funny settings are off by default with the agreed defaults", () => {
  const s = funnySettings({});
  assert.equal(s.shorts, false);
  assert.equal(s.memes, false);
  assert.equal(s.slot, "23:30");
  assert.equal(s.start, "2026-11-19");
  assert.equal(s.vision, true);
  assert.equal(s.narration, "none");
  assert.equal(funnySummary(s), "off");
  const on = funnySettings({
    FUNNY_SHORTS: "true",
    MEME_POSTS: "1",
    MEME_DAY: "Saturday",
    FUNNY_SLOT: "bad",
  });
  assert.equal(on.memeDay, "sat");
  assert.equal(on.slot, "23:30");
  assert.match(funnySummary(on), /funny Shorts from 2026-11-19 at 23:30/);
  assert.match(funnySummary(on), /queued for the owner/);
});

test("funny Shorts never add a slot or take GTA 6 Day N's", () => {
  const s = funnySettings({ FUNNY_SHORTS: "true" });
  const cfg = {
    gameplayEnabled: true,
    gameplaySlots: ["21:00", "23:30"],
    gtaDaily: true,
    gtaDailySlot: "21:00",
  };
  assert.equal(funnyProblem(s, cfg), undefined);
  assert.match(
    funnyProblem({ ...s, slot: "22:00" }, cfg)!,
    /not one of GAMEPLAY_SLOTS/,
  );
  assert.match(funnyProblem({ ...s, slot: "21:00" }, cfg)!, /GTA_DAILY_SLOT/);
  assert.match(
    funnyProblem(s, { ...cfg, gameplayEnabled: false })!,
    /GAMEPLAY_ENABLED/,
  );
  assert.equal(
    funnyProblem({ ...s, shorts: false }, { ...cfg, gameplayEnabled: false }),
    undefined,
  );
});

// ------------------------------------------------------------------ sound

test("astats and aspectralstats output is read in order", () => {
  const err = [
    "[Parsed_ametadata_3 @ 0] lavfi.astats.Overall.RMS_level=-30.5",
    "[Parsed_ametadata_3 @ 0] lavfi.astats.Overall.RMS_level=-inf",
    "[Parsed_ametadata_3 @ 0] lavfi.astats.Overall.RMS_level=-12",
  ].join("\n");
  assert.deepEqual(parseRms(err), [-30.5, -90, -12]);
  assert.deepEqual(
    parseFlatness(
      "lavfi.aspectralstats.1.flatness=0.25\nlavfi.aspectralstats.1.flatness=nan",
    ),
    [0.25, 1],
  );
});

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

test("a laugh is a run of bursts; an impact is a sudden onset from sound; music is steady and tonal", () => {
  // 70 s of steady game sound at -36 dB, then a laugh: bursts every 0.2 s for 2 s, 12 dB up.
  const voice = flat(700, -36);
  for (let i = 0; i < 20; i += 2) voice.push(-24, -34);
  voice.push(...flat(60, -36));
  const low = flat(voice.length, -30);
  low[750] = -10; // a thump 20 dB over the sound before it
  const env = { voice, low, flat: flat(voice.length, 0.4) };
  assert.ok(burstCount(voice, 700, 720, -36) >= 4);
  const cues = soundCues(env);
  const laugh = cues.find((c) => c.kind === "laugh");
  assert.ok(laugh, "laugh found");
  assert.ok(Math.abs(laugh!.t - 70) <= 1);
  const impact = cues.find((c) => c.kind === "impact");
  assert.equal(impact?.t, 75);
  assert.equal(cues.filter((c) => c.kind === "music").length, 0);
  // A thump out of silence (a menu closing) is not an impact.
  const quiet = {
    voice: flat(200, -36),
    low: [...flat(100, -90), ...flat(100, -20)],
    flat: flat(200, 0.4),
  };
  assert.equal(soundCues(quiet).filter((c) => c.kind === "impact").length, 0);
  // Ten seconds of tonal, steady sound is music.
  const song = {
    voice: flat(20 * ENV_HZ, -30),
    low: flat(20 * ENV_HZ, -30),
    flat: flat(20 * ENV_HZ, 0.05),
  };
  const m = soundCues(song).filter((c) => c.kind === "music");
  assert.ok(m.length >= 1);
  assert.equal(musicIn(m, 3, 8), true);
  assert.equal(musicIn(m, 40, 50), false);
});

test("a silent start is never read as a shout", () => {
  const voice = [...flat(600, -90), ...flat(100, -35)];
  const cues = soundCues({
    voice,
    low: flat(voice.length, -90),
    flat: flat(voice.length, 0.5),
  });
  assert.equal(cues.filter((c) => c.kind === "shout").length, 0);
});

// ------------------------------------------------------------------ ranking

test("HUD events weigh fails and chaos, not progress", () => {
  assert.equal(hudWeight({ kind: "wasted" }), 1.6);
  assert.equal(hudWeight({ kind: "busted" }), 1.4);
  assert.equal(hudWeight({ kind: "wanted_up", value: 3, from: 1 }), 1);
  assert.equal(hudWeight({ kind: "wanted_up", value: 2, from: 1 }), 0);
  assert.equal(hudWeight({ kind: "air_start" }), 0.4);
  assert.equal(hudWeight({ kind: "collectible" }), 0);
});

test("reactions point back to their cause, timed events keep their second", () => {
  const ev = gatherEvidence(
    [
      { kind: "laugh", t: 101.2, score: 1, detail: "x" },
      { kind: "impact", t: 100, score: 1, detail: "y" },
      { kind: "music", t: 50, score: 1, detail: "z" },
    ],
    [],
    [{ t: 99.5, kind: "wasted", detail: "Wasted" }],
  );
  assert.equal(ev.length, 3);
  assert.equal(
    ev.find((e) => e.kind === "laugh")!.t,
    Math.round((101.2 - REACTION_LAG) * 100) / 100,
  );
  // The strongest timed event is the payoff: the HUD's Wasted (1.6) over the thump (0.7).
  assert.equal(payoffOf(ev), 99.5);
});

test("action bursts stand out from the half minute around them", () => {
  const secs = Array.from({ length: 60 }, (_, i) => ({
    t: i,
    motion: i === 30 ? 0.8 : 0.05,
  }));
  const b = actionBursts(secs);
  assert.deepEqual(
    b.map((e) => e.t),
    [30],
  );
});

test("moments are ranked by agreeing signals and kept 30 s apart", () => {
  const ev = gatherEvidence(
    [
      { kind: "impact", t: 100, score: 1.5, detail: "thump" },
      { kind: "laugh", t: 101.5, score: 1.5, detail: "laugh" },
      { kind: "impact", t: 110, score: 1.5, detail: "thump 2" },
      { kind: "shout", t: 400, score: 1, detail: "shout" },
    ],
    [],
    [],
  );
  const ranked = rankBySignals(ev, { top: 5, duration: 1000 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.payoff, 100);
  assert.ok(ranked[0]!.signalScore > ranked[1]!.signalScore);
  assert.ok(Math.abs(ranked[1]!.payoff - (400 - REACTION_LAG)) < 0.01);
  // Edges and blocked seconds are never payoffs.
  assert.equal(
    rankBySignals(ev, { top: 5, duration: 1000, blocked: (t) => t < 200 })
      .length,
    1,
  );
});

const verdict = (v: Partial<VisionVerdict>): VisionVerdict => ({
  funny: 8,
  kind: "fail",
  why: "car flips",
  menu: false,
  cutscene: false,
  gore: false,
  radio_on_screen: false,
  ...v,
});
const cand = (
  payoff: number,
  signal: number,
  v?: VisionVerdict,
  music = false,
): FunnyCandidate => ({
  payoff,
  signalScore: signal,
  score: signal,
  evidence: [],
  ...(v ? { vision: v } : {}),
  music,
  reasons: [],
});

test("the vision rating joins the signals and its vetoes set moments aside", () => {
  const out = finalRank(
    [
      cand(10, 1, verdict({ funny: 9 })),
      cand(50, 3, verdict({ menu: true })),
      cand(90, 2),
      cand(130, 2, verdict({ funny: 4 })),
      cand(170, 2, verdict({}), true),
    ],
    { inSpoilerWindow: false, visionMin: 7, stripped: false },
  );
  assert.equal(out[0]!.payoff, 10);
  assert.equal(out[0]!.score, 5.5);
  assert.equal(out[1]!.payoff, 90); // no verdict: signals only, said so
  assert.match(out[1]!.reasons.at(-1)!, /no vision check/);
  const vetoed = out.filter((c) => c.veto);
  assert.equal(vetoed.length, 3);
  assert.ok(vetoed.every((c) => c.score === 0));
  assert.match(out.find((c) => c.payoff === 170)!.veto!, /licensed music/);
  // A radio-free copy lifts the music veto.
  const stripped = finalRank([cand(170, 2, verdict({}), true)], {
    inSpoilerWindow: false,
    visionMin: 7,
    stripped: true,
  });
  assert.equal(stripped[0]!.veto, undefined);
});

test("cutscenes are vetoed only inside the spoiler window; gore and radio always", () => {
  assert.equal(visionVeto(verdict({ cutscene: true }), false), undefined);
  assert.match(visionVeto(verdict({ cutscene: true }), true)!, /spoiler/);
  assert.match(visionVeto(verdict({ gore: true }), false)!, /gore/);
  assert.match(visionVeto(verdict({ radio_on_screen: true }), false)!, /radio/);
});

test("the reaction end is the last laugh or shout within six seconds", () => {
  const cues = [
    { kind: "laugh" as const, t: 101, score: 1, detail: "" },
    { kind: "shout" as const, t: 104, score: 1, detail: "" },
    { kind: "laugh" as const, t: 120, score: 1, detail: "" },
  ];
  assert.equal(reactionEnd(cues, 100), 105);
  assert.equal(reactionEnd(cues, 200), undefined);
});

// ------------------------------------------------------------------ the edit

test("the comedy plan: tight cut-in, freeze on the payoff, slowed replay ending on it", () => {
  const p = funnyPlan({ payoff: 12, clipSeconds: 30 });
  assert.equal(p.cutIn, 7.5);
  assert.equal(p.payoffAt, 4.5);
  assert.equal(p.cutOut, 14.6);
  assert.deepEqual(p.replay, { from: 10.6, to: 12.8, speed: REPLAY_SPEED });
  assert.equal(p.replayAt, 7.1);
  assert.equal(p.seconds, Math.round((7.1 + 2.2 / REPLAY_SPEED) * 1000) / 1000);
  // A build-up gets a longer run-in; the reaction sets the tail (capped).
  assert.equal(
    funnyPlan({ payoff: 12, clipSeconds: 30, buildup: true }).cutIn,
    5.5,
  );
  assert.equal(
    funnyPlan({ payoff: 12, clipSeconds: 30, reactionEnd: 30 }).cutOut,
    17,
  );
  // A payoff at the very start or end of a clip is pulled inside it.
  const edge = funnyPlan({ payoff: 0.2, clipSeconds: 30 });
  assert.equal(edge.cutIn, 0);
  assert.ok(edge.payoff >= 1.5);
});

test("the comedy filter holds the payoff frame, keeps sound and picture in step and crops to 9:16", () => {
  const p = funnyPlan({ payoff: 12, clipSeconds: 30 });
  const f = funnyFilter(p, { focus: 0.5 });
  assert.match(f, /tpad=stop_mode=clone:stop_duration=0\.6/);
  assert.match(f, /zoompan=z='min\(1\.18/);
  // The picture resumes at payoff + freeze (the sound ran on through the freeze).
  assert.match(f, /trim=start=12\.6:end=14\.6/);
  assert.match(f, /setpts=\(PTS-STARTPTS\)\/0\.5/);
  assert.match(f, /atempo=0\.5/);
  assert.match(f, /crop=1080:1920/);
  assert.match(f, /\[vout\]$/);
});

test("captions stay short, clean, kind and advertiser-safe", () => {
  assert.deepEqual(captionProblems("Physics had other plans"), []);
  assert.ok(
    captionProblems("He died instantly").includes("advertiser-unfriendly word"),
  );
  assert.ok(captionProblems("What the shit").includes("swearing"));
  assert.ok(captionProblems("What an idiot").includes("mean about someone"));
  assert.ok(captionProblems("Too close — again").includes("a long dash"));
  assert.ok(
    captionProblems("one two three four five six seven eight").includes(
      "over 7 words",
    ),
  );
  assert.equal(strongLanguage("oh my god what the fuck"), true);
  assert.equal(strongLanguage("no way that worked"), false);
});

test("every caption in the bank passes its own checks", async () => {
  const { CAPTIONS } = await import("../src/funny/edit.ts");
  for (const [kind, list] of Object.entries(CAPTIONS))
    for (const c of list) {
      assert.deepEqual(captionProblems(c.hook), [], `${kind}: ${c.hook}`);
      assert.deepEqual(captionProblems(c.punch), [], `${kind}: ${c.punch}`);
    }
  // The model's caption is used only when it passes; else the bank.
  assert.equal(
    pickCaption("fail", "a", "Instant regret").hook,
    "Instant regret",
  );
  assert.notEqual(
    pickCaption("fail", "a", "What a stupid idiot").hook,
    "What a stupid idiot",
  );
  assert.equal(pickCaption("fail", "a").hook, pickCaption("fail", "a").hook);
});

test("the vision answer is read safely, its caption checked", () => {
  const v = comedyVerdict({
    message: {
      content: JSON.stringify({
        funny: 8.6,
        kind: "physics",
        why: "car cartwheels",
        caption: "Gravity: 1",
        menu: false,
        cutscene: false,
        gore: false,
        radio_on_screen: false,
      }),
    },
  });
  assert.equal(v?.funny, 9);
  assert.equal(v?.caption, "Gravity: 1");
  const bad = comedyVerdict({
    message: {
      content: JSON.stringify({
        funny: 3,
        kind: "weird",
        why: "",
        caption: "He died lol",
        menu: true,
        cutscene: false,
        gore: false,
        radio_on_screen: false,
      }),
    },
  });
  assert.equal(bad?.kind, "none");
  assert.equal(bad?.caption, undefined);
  assert.equal(bad?.menu, true);
  assert.equal(comedyVerdict({ message: { content: "no idea" } }), undefined);
  // The answer wrapped in the model's thinking is still found.
  assert.equal(
    comedyVerdict({
      message: { content: "", thinking: 'so {"funny": 5, "kind": "fail"}' },
    })?.funny,
    5,
  );
});

// ------------------------------------------------------------------ the lane

const plan = funnyPlan({ payoff: 12, clipSeconds: 30 });
const meta = (over: Partial<FunnyClipMeta["funny"]> = {}): FunnyClipMeta => ({
  id: "funny_v1_100",
  status: "new",
  source: { file: "x.mp4", title: "GTA 6 day one", kind: "funny_vod" },
  clip: { file: "clip.mp4", seconds: 30 },
  frames: [],
  created_at: "2026-11-20T00:00:00Z",
  funny: {
    payoff_in_clip: 12,
    buildup: false,
    score: 8,
    signal_score: 3,
    kind: "physics",
    caption: { hook: "Physics had other plans", punch: "Newton says hi" },
    reasons: ["local vision 9/10, physics: car cartwheels", "a 20 dB thump"],
    vision: verdict({ funny: 9, kind: "physics" }),
    at_in_source: 100,
    plan,
    ...over,
  },
});

test("a funny clip is reviewed with no model call, and swearing or gore sets it aside", () => {
  const ok = funnyReview(meta(), [], { minScore: 4, inSpoilerWindow: true });
  assert.equal(ok.keep, true);
  assert.equal(ok.game_title, "Grand Theft Auto VI");
  assert.equal(ok.question, "Physics had other plans");
  assert.equal(ok.result_line, "Newton says hi");
  assert.ok(ok.youtube_title.length <= 70);
  assert.ok(ok.hashtags.includes("#GTA6"));
  assert.equal(ok.real_test, false);
  // Swearing in the first seconds (and anywhere in the cut).
  const sworn = funnyReview(
    meta(),
    [{ text: "shit", start: plan.cutIn + 1, end: plan.cutIn + 1.4 }],
    { minScore: 4, inSpoilerWindow: false },
  );
  assert.equal(sworn.keep, false);
  assert.equal(sworn.strong_language, true);
  assert.match(sworn.reason, new RegExp(`first ${AD_SAFE_SECONDS} s`));
  // Words outside the cut do not count.
  assert.equal(
    funnyReview(meta(), [{ text: "shit", start: 1, end: 1.4 }], {
      minScore: 4,
      inSpoilerWindow: false,
    }).keep,
    true,
  );
  assert.equal(
    funnyReview(meta({ vision: verdict({ gore: true }) }), [], {
      minScore: 4,
      inSpoilerWindow: false,
    }).keep,
    false,
  );
  assert.equal(
    funnyReview(meta({ vision: verdict({ cutscene: true }) }), [], {
      minScore: 4,
      inSpoilerWindow: true,
    }).spoiler,
    true,
  );
  assert.equal(
    funnyReview(meta({ score: 2 }), [], { minScore: 4, inSpoilerWindow: false })
      .keep,
    false,
  );
});

test("a funny clip is recognised by its block and its id", () => {
  assert.ok(funnyOf(meta()));
  assert.equal(funnyOf({ ...meta(), funny: undefined } as never), undefined);
  assert.equal(isFunnyHash("gameplay:funny_v1_100"), true);
  assert.equal(isFunnyHash("gameplay:gp_123"), false);
  assert.equal(funnyGame("GTA V 100%").short, "GTA 5");
});

test("the funny script has no narration and carries the comedy plan", () => {
  const m = meta();
  const r = funnyReview(m, [], { minScore: 4, inSpoilerWindow: false });
  const s = funnyScript(gameplayScript(r, m.id, []), m.funny, r.game_title);
  assert.equal(s.hook, "Physics had other plans");
  assert.equal(s.beats[0]!.narration, "");
  assert.equal(s.gameplay!.direct!.funny!.punch, "Newton says hi");
  assert.equal(s.gameplay!.direct!.seconds, plan.seconds);
  assert.ok(s.youtube.tags.includes("funny moments"));
  const props = funnyShortProps(m.funny);
  assert.equal(props.hookEnd, plan.payoffAt);
  assert.deepEqual(props.tag, {
    text: "REPLAY",
    from: plan.replayAt,
    to: plan.seconds,
  });
  assert.equal(tagOn(plan.replayAt + 0.1, props.tag), true);
  assert.equal(tagOn(plan.replayAt - 0.1, props.tag), false);
});

test("the finished funny Short is checked for black picture, an ending payoff and its length", () => {
  assert.deepEqual(
    funnyRenderProblems({ blacks: [], payoffAt: 4.5, seconds: 14 }),
    [],
  );
  assert.equal(
    funnyRenderProblems({
      blacks: [{ start: 2, end: 2.2 }],
      payoffAt: 13,
      seconds: 14,
    }).length,
    2,
  );
  assert.match(
    funnyRenderProblems({ blacks: [], payoffAt: 2, seconds: 40 })[0]!,
    /8-30 s/,
  );
});

// ------------------------------------------------------------------ the slot

test("a funny Short takes FUNNY_SLOT from launch day, one a day, never the daily's slot", () => {
  const s = funnySettings({ FUNNY_SHORTS: "true" });
  const now = new Date("2026-11-17T12:00:00Z");
  const first = funnySlot(s, {
    now,
    timeZone: TZ,
    dropped: false,
    funnyTaken: [],
    scheduled: [],
    gapMinutes: 60,
  });
  assert.equal(
    first?.toISOString(),
    localTime("2026-11-19", "23:30", TZ).toISOString(),
  );
  // That day already has one: the next day.
  const next = funnySlot(s, {
    now,
    timeZone: TZ,
    dropped: false,
    funnyTaken: [first!],
    scheduled: [],
    gapMinutes: 60,
  });
  assert.equal(
    next?.toISOString(),
    localTime("2026-11-20", "23:30", TZ).toISOString(),
  );
  // Something else scheduled within the gap, or the slot kept for another series: the next day too.
  const busy = funnySlot(s, {
    now,
    timeZone: TZ,
    dropped: false,
    funnyTaken: [],
    scheduled: [new Date(first!.getTime() + 30 * 60_000)],
    gapMinutes: 60,
  });
  assert.equal(busy?.toISOString(), next?.toISOString());
  const kept = funnySlot(s, {
    now,
    timeZone: TZ,
    dropped: false,
    funnyTaken: [],
    scheduled: [],
    gapMinutes: 60,
    kept: (at) => at.getTime() === first!.getTime(),
  });
  assert.equal(kept?.toISOString(), next?.toISOString());
  assert.equal(
    funnySlot(s, {
      now,
      timeZone: TZ,
      dropped: true,
      funnyTaken: [],
      scheduled: [],
      gapMinutes: 60,
    }),
    undefined,
  );
  assert.equal(funnyDayOpen(s, "2026-11-18", false), false);
});

test("other gameplay Shorts leave FUNNY_SLOT to a waiting funny Short on open days only", () => {
  const s = funnySettings({ FUNNY_SHORTS: "true" });
  const kept = funnyKept(s, TZ, false);
  assert.equal(kept(localTime("2026-11-20", "23:30", TZ)), true);
  assert.equal(kept(localTime("2026-11-20", "21:00", TZ)), false);
  assert.equal(kept(localTime("2026-11-18", "23:30", TZ)), false);
  assert.equal(
    funnyKept(s, TZ, true)(localTime("2026-11-20", "23:30", TZ)),
    false,
  );
});

test("the story is protected only for GTA VI inside its window", () => {
  assert.equal(inSpoilerWindow("GTA 6 first look", "2026-11-25", 28), true);
  assert.equal(inSpoilerWindow("GTA 6 first look", "2026-12-20", 28), false);
  assert.equal(inSpoilerWindow("GTA V 100%", "2026-11-25", 28), false);
});

// ------------------------------------------------------------------ measurement

test("funny Shorts and memes are their own formats in the subscriber learner", () => {
  assert.equal(
    subsFormat({ lane: "gameplay", story_hash: "gameplay:funny_v1_100" }),
    "funny",
  );
  assert.equal(
    subsFormat({ lane: "gameplay", story_hash: "gameplay:gp_1" }),
    "gameplay",
  );
  assert.equal(
    subsFormat({ lane: "other", story_hash: "meme:2026-11-20" }),
    "meme",
  );
});

const month = (entries: Array<[SubsFormat, SubsTally]>) => new Map(entries);
const S = { minViews: 5000, minVideos: 5, lead: 1.5 };

test("a trial format is promoted, kept or dropped on subscribers per 1,000 views", () => {
  const base: Array<[SubsFormat, SubsTally]> = [
    ["news", { videos: 20, views: 100_000, subs: 100 }],
  ];
  assert.equal(channelRate(month(base)), 1);
  const promoted = judgeTrial(
    "funny",
    "trial",
    month([...base, ["funny", { videos: 6, views: 10_000, subs: 20 }]]),
    S,
  );
  assert.equal(promoted.now, "promoted");
  const dropped = judgeTrial(
    "funny",
    "trial",
    month([...base, ["funny", { videos: 6, views: 10_000, subs: 2 }]]),
    S,
  );
  assert.equal(dropped.now, "dropped");
  // A promoted format falls back to trial first, never straight to dropped.
  assert.equal(
    judgeTrial(
      "funny",
      "promoted",
      month([...base, ["funny", { videos: 6, views: 10_000, subs: 2 }]]),
      S,
    ).now,
    "trial",
  );
  const thin = judgeTrial(
    "meme",
    "trial",
    month([...base, ["meme", { videos: 2, views: 900, subs: 5 }]]),
    S,
  );
  assert.equal(thin.now, "trial");
  assert.match(thin.why, /not enough yet/);
  assert.match(trialLine(promoted, false), /report only/);
  assert.equal(judgeTrial("meme", "dropped", month(base), S).now, "dropped");
});

// ------------------------------------------------------------------ memes

test("every meme in the bank passes the checks and fits a layout", () => {
  for (const b of MEME_BANK) {
    const m = pickMeme({
      id: b.key,
      frames: ["a.jpg", "b.jpg"],
      kinds: b.kinds,
      game: "GTA 6",
      used: [],
    });
    assert.deepEqual(memeProblems(m), [], m.key);
  }
  for (const b of MEME_BANK)
    for (const l of b.lines) assert.deepEqual(captionProblems(l, { words: 9, chars: 44 }), [], l);
});

test("a meme fits the week's moments, has its frames and does not repeat", () => {
  const m = pickMeme({
    id: "w1",
    frames: ["calm.jpg", "payoff.jpg"],
    kinds: ["physics"],
    game: "Grand Theft Auto VI",
  });
  assert.ok(MEME_BANK.find((b) => b.key === m.key)!.kinds.includes("physics"));
  assert.match(m.post, /#GTA6/);
  const again = pickMeme({
    id: "w1",
    frames: ["calm.jpg", "payoff.jpg"],
    kinds: ["physics"],
    game: "GTA 6",
    used: [m.key],
  });
  assert.notEqual(again.key, m.key);
  // One frame: only the one-frame layouts.
  const one = pickMeme({
    id: "w2",
    frames: ["only.jpg"],
    kinds: ["fail"],
    game: "",
  });
  assert.equal(one.frames.length, 1);
  assert.equal(MEME_BANK.find((b) => b.key === one.key)!.frames, 1);
  assert.equal(memeTags("GTA V 100%"), "#GTA5 #GTAV #gaming");
});

test("a meme is due once on its day from its hour, twice a week once promoted", () => {
  const s = { memeDay: "fri", memeHour: 12 };
  const fri = new Date("2026-11-20T13:00:00Z");
  assert.equal(
    memeDue(s, { now: fri, timeZone: TZ, promoted: false, madeOn: [] }),
    "2026-11-20",
  );
  assert.equal(
    memeDue(s, {
      now: fri,
      timeZone: TZ,
      promoted: false,
      madeOn: ["2026-11-20"],
    }),
    undefined,
  );
  assert.equal(
    memeDue(s, {
      now: new Date("2026-11-20T09:00:00Z"),
      timeZone: TZ,
      promoted: false,
      madeOn: [],
    }),
    undefined,
  );
  const mon = new Date("2026-11-23T13:00:00Z");
  assert.equal(
    memeDue(s, { now: mon, timeZone: TZ, promoted: false, madeOn: [] }),
    undefined,
  );
  assert.equal(
    memeDue(s, { now: mon, timeZone: TZ, promoted: true, madeOn: [] }),
    "2026-11-23",
  );
});
