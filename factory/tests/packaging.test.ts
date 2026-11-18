import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  packagingAtLeast,
  packagingSettings,
  packagingSummary,
} from "../src/packaging/settings.ts";
import {
  cleanTitle,
  namesGame,
  TITLE_FEATURES,
  titleFeatures,
} from "../src/packaging/features.ts";
import { clarity, figures } from "../src/packaging/clarity.ts";
import {
  hookCandidates,
  titleCandidates,
  titleCase,
} from "../src/packaging/candidates.ts";
import {
  fitRidge,
  pairwiseAccuracy,
  predict,
  solve,
  spearman,
} from "../src/packaging/model.ts";
import {
  neighbourScores,
  pulseRowsFromExport,
  studyRowsFromListing,
  studyRowsFromVidiq,
} from "../src/packaging/corpus.ts";
import {
  blendFrom,
  pulseTargets,
  trainPackagingModel,
} from "../src/packaging/train.ts";
import {
  DEFAULT_MODEL_FILE,
  loadModel,
  pickBest,
  rankCandidates,
  titleScore,
  type FullModel,
} from "../src/packaging/score.ts";
import { lookFeatures, pixelFeatures } from "../src/packaging/image.ts";
import {
  packBeforeUpload,
  pickHookWords,
  rankTitles,
} from "../src/packaging/lab.ts";
import {
  abTestVideoIds,
  judge,
  percentileOf,
  runSecondChance,
} from "../src/packaging/secondchance.ts";
import { YouTubeClient } from "../src/youtube/upload.ts";
import type { Episode } from "../src/episodes.ts";
import { goodScript, testDb, tmpDir } from "./helpers.ts";

test("PACKAGING_LAB is off unless set, and each stage includes the ones before it", () => {
  const off = packagingSettings({});
  assert.equal(off.mode, "off");
  assert.equal(packagingSummary(off), "off");
  assert.equal(packagingAtLeast(off, "score"), false);
  assert.equal(packagingSettings({ PACKAGING_LAB: "banana" }).mode, "off");
  const r = packagingSettings({
    PACKAGING_LAB: "Retitle",
    PACKAGING_DAILY_CAP: "99",
  });
  assert.equal(r.mode, "retitle");
  assert.equal(r.dailyCap, 20, "the cap is bounded");
  assert.ok(
    packagingAtLeast(r, "score") &&
      packagingAtLeast(r, "pick") &&
      packagingAtLeast(r, "retitle"),
  );
  const p = packagingSettings({ PACKAGING_LAB: "pick" });
  assert.ok(packagingAtLeast(p, "score") && packagingAtLeast(p, "pick"));
  assert.equal(packagingAtLeast(p, "retitle"), false);
  assert.equal(packagingAtLeast(p, "off"), false);
  assert.equal(r.minHours, 48);
  assert.equal(r.maxHours, 72);
});

test("title features read numbers, the game, a gap and a rumour label", () => {
  const f = titleFeatures("Why GTA 6's $99.99 Edition Still Launches Solo", {
    game: "Grand Theft Auto 6",
  });
  assert.equal(f.money, 1);
  assert.equal(f.number, 1);
  assert.equal(f.curiosity, 1);
  assert.equal(f.game_named, 1);
  assert.equal(f.question, 0);
  assert.equal(
    titleFeatures("Sony's PS5 update is reportedly required").rumour_label,
    1,
  );
  assert.equal(
    titleFeatures("Helldivers 2 HUGE NEWS! #gaming #shorts").caps_words! > 0,
    true,
  );
  assert.equal(
    cleanTitle("Skyrim Gets New Update #skyrim #gaming"),
    "Skyrim Gets New Update",
  );
  assert.ok(
    namesGame("Fresh trailer for Grand Theft Auto VI", "Grand Theft Auto VI"),
  );
  assert.equal(namesGame("A quiet week for news"), false);
  for (const k of TITLE_FEATURES) assert.ok(k in f, k);
  for (const v of Object.values(f))
    assert.ok(v >= 0 && v <= 1, "features are bounded");
});

test("the clarity check refuses dashes, shouting, unlabelled rumours, missing games and invented figures", () => {
  const ctx = {
    game: "Starfield",
    source: "Starfield is delayed to early 2027, three months late.",
  };
  assert.equal(
    clarity("Starfield Expansion Delayed to Early 2027", ctx).ok,
    true,
  );
  assert.match(
    clarity("Starfield Expansion Delayed — 2027", ctx).hard.join(),
    /long dash/,
  );
  assert.match(
    clarity("Starfield Expansion Delayed to 2027!", ctx).hard.join(),
    /exclamation/,
  );
  assert.match(
    clarity("Starfield Expansion DELAYED to 2027", ctx).hard.join(),
    /all-caps/,
  );
  assert.equal(
    clarity("GTA 6 on PS5 Gets a 2027 Window", { source: "GTA 6 2027 PS5 5" })
      .ok,
    true,
    "acronyms are not shouting",
  );
  assert.match(
    clarity("Bethesda Delays Its Next Expansion to 2027", ctx).hard.join(),
    /name the game/,
  );
  assert.match(
    clarity("Starfield Expansion Delayed to 2028", ctx).hard.join(),
    /figure not in the video: 2028/,
  );
  const rumour = { ...ctx, rumour: true };
  assert.match(
    clarity("Starfield Expansion Delayed to 2027", rumour).hard.join(),
    /without a label/,
  );
  assert.match(
    clarity(
      "Starfield Delay to 2027 Confirmed, Reportedly",
      rumour,
    ).hard.join(),
    /as confirmed/,
  );
  assert.equal(
    clarity("Starfield Expansion Reportedly Slips to 2027", rumour).ok,
    true,
  );
  assert.match(
    clarity(
      "Starfield Expansion Delayed to the fourteenth of March",
      ctx,
    ).hard.join(),
    /ordinal/,
  );
  assert.match(
    clarity("You Won't Believe What Starfield Did", ctx).hard.join(),
    /clickbait/,
  );
  assert.match(clarity("Starfield", ctx).hard.join(), /under 18/);
  assert.equal(
    clarity("STARFIELD 2027 DELAY", { kind: "hook", source: "2027" }).ok,
    true,
  );
  assert.match(
    clarity("THE STARFIELD EXPANSION IS NOW LATE", {
      kind: "hook",
    }).hard.join(),
    /longer than 5/,
  );
  assert.deepEqual(figures("$99.99 for 1,000 copies"), ["99.99", "1000"]);
  assert.ok(
    clarity("Starfield Is a Huge Mess Now, Insane", ctx).penalty > 0,
    "hype costs score",
  );
});

test("candidates come from the video itself: the writer's title first, rearranged, rumours labelled", () => {
  const src = {
    title: "Huge Patch Lands Today for Grand Theft Auto 6",
    variants: ["Why the Grand Theft Auto 6 Patch Is 212 GB"],
    headline: "GTA 6 patch weighs 212 GB",
    hook: "Grand Theft Auto 6 just got a 212 GB patch.",
    game: "Grand Theft Auto 6",
    rumour: true,
  };
  const c = titleCandidates(src, 40);
  assert.equal(c[0]!.origin, "writer");
  assert.ok(
    c.some(
      (x) =>
        x.origin === "game_first" && x.text.startsWith("Grand Theft Auto 6:"),
    ),
  );
  assert.ok(c.some((x) => x.origin === "short_name" && /GTA 6/.test(x.text)));
  assert.ok(
    c.some((x) => x.origin === "report" && x.text.startsWith("Report: ")),
  );
  const keys = c.map((x) => x.text.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, "no duplicates");
  const source = Object.values(src).join(" ");
  for (const x of c)
    for (const f of figures(x.text))
      assert.ok(figures(source).includes(f), `${x.text} invents ${f}`);
  assert.equal(
    titleCase("the patch is out for gta 6 on ps5"),
    "The Patch Is Out for Gta 6 on PS5",
  );
  const h = hookCandidates({ ...src, thumbText: "212 GB PATCH" });
  assert.equal(h[0]!.text, "212 GB PATCH");
  assert.ok(
    h.every(
      (x) => x.text.split(" ").length <= 4 && x.text === x.text.toUpperCase(),
    ),
  );
});

test("the ridge model recovers a planted signal, and a strong prior holds its weights", () => {
  const names = ["a", "b"];
  const rows = Array.from({ length: 200 }, (_, i) => {
    const a = (i * 37) % 11;
    const b = (i * 17) % 7;
    return { x: [a, b], y: 2 * a - 0.5 * b + ((i * 13) % 5) * 0.01 };
  });
  const m = fitRidge(names, rows, 0.01);
  assert.ok(
    Math.abs(predict(m, [3, 2]) - (6 - 1)) < 0.2,
    String(predict(m, [3, 2])),
  );
  assert.ok(
    pairwiseAccuracy(rows.map((r) => ({ score: predict(m, r.x), y: r.y })))
      .accuracy > 0.98,
  );
  const prior = { ...m, weights: [0, 0] };
  const held = fitRidge(names, rows, 1e9, prior);
  assert.ok(Math.abs(held.weights[0]!) < 0.01, "a huge lambda keeps the prior");
  assert.deepEqual(
    solve(
      [
        [2, 0],
        [0, 4],
      ],
      [2, 8],
    ).map((v) => Math.round(v)),
    [1, 2],
  );
  assert.equal(
    pairwiseAccuracy([
      { score: 1, y: 1 },
      { score: 1, y: 2 },
    ]).accuracy,
    0.5,
    "a tie counts half",
  );
  assert.equal(
    pairwiseAccuracy([
      { score: 1, y: 1, group: "a" },
      { score: 2, y: 2, group: "b" },
    ]).pairs,
    0,
    "groups never mix",
  );
  assert.ok(spearman([1, 2, 3, 4], [10, 20, 30, 40]) > 0.99);
});

test("study rows are scored against the channel's neighbouring uploads", () => {
  const views = [
    50, 60, 70, 80, 90, 1000, 1100, 1000, 20000, 900, 1000, 1100, 950, 1000,
    1050,
  ];
  const z = neighbourScores(views, 4, 5);
  assert.equal(z[0], undefined, "the newest are still growing");
  assert.ok(z[8]! > 2, "the spike stands out");
  assert.ok(Math.abs(z[10]!) < 1);
  const rows = studyRowsFromListing(
    {
      channel_id: "UCx",
      entries: views.map((v, i) => ({
        id: `v${i}`,
        title: `Title ${i}`,
        view_count: v,
      })),
    },
    "short",
  );
  assert.ok(
    rows.length >= 5 && rows.every((r) => r.thumb?.includes("oardefault")),
  );
  const vq = studyRowsFromVidiq("short\tabc\tA Title\t1000\t10\nnoise line\n");
  assert.equal(vq.length, 1);
  assert.ok(vq[0]!.z > 2);
  const pulse = pulseRowsFromExport([
    {
      id: "e1",
      youtube_video_id: "y1",
      lane: "news",
      live_at: "2026-11-01",
      script_json: { hook: "h", youtube: { title: "T" } },
      metrics: [
        { label: "72h", views: 500 },
        { label: "ctr", raw: { ctr: 0.02, impressions: 600 } },
        { label: "retention", raw: { views: 100, engagedViews: 40 } },
      ],
    },
    { id: "e2", lane: "news", script_json: { youtube: { title: "no video" } } },
  ]);
  assert.equal(pulse.length, 1);
  assert.equal(pulse[0]!.viewedRate, 0.4);
  assert.equal(pulse[0]!.format, "short");
  assert.ok(pulseTargets(pulse).get("e1")!.ctr! < 0);
});

test("training writes heads, a blend that sums to one, and backtests on the newest videos", () => {
  const study = Array.from({ length: 300 }, (_, i) => ({
    source: "ytdlp" as const,
    format: (i % 2 ? "short" : "long") as "short" | "long",
    channel: `c${i % 10}`,
    id: `s${i}`,
    title: i % 3 ? `Why Halo ${i} Failed` : `Halo ${i} update`,
    views: 1000,
    z: i % 3 ? 1 : -1,
  }));
  const pulse = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    videoId: `v${i}`,
    format: "short" as const,
    lane: "news",
    liveAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    title: i % 2 ? `Why Halo ${i} Matters Now` : `Halo ${i} patch notes`,
    hook: "h",
    rumour: false,
    views72: i % 2 ? 2000 + i : 100 + i,
    ctr: i % 2 ? 0.05 : 0.01,
    impressions: 1000,
    viewedRate: i % 2 ? 0.5 : 0.3,
  }));
  const { model, reports } = trainPackagingModel(
    study,
    pulse,
    new Date("2026-11-14"),
  );
  assert.ok(model.heads.short.prior && model.heads.long.prior);
  const sum = Object.values(model.blend.short).reduce(
    (a, b) => a + (b ?? 0),
    0,
  );
  assert.ok(Math.abs(sum - 1) < 0.01);
  const ctr = reports.find((r) => r.head === "ctr");
  assert.ok(ctr && ctr.test === 12 && ctr.blended > 0.8, JSON.stringify(ctr));
  assert.ok(
    titleScore(model, "short", "Why Halo 9 Matters Now") >
      titleScore(model, "short", "Halo 9 patch notes"),
  );
  assert.equal(
    blendFrom([], "long", 0.5).prior,
    1,
    "a coin-flip prior still keeps its floor share",
  );
});

test("the shipped model loads, and the choice keeps the writer's title unless a passing one clearly wins", () => {
  const model = loadModel();
  assert.ok(model, `model at ${DEFAULT_MODEL_FILE}`);
  assert.equal(model!.version, 1);
  const cands = [
    { text: "Starfield Expansion Delayed to Early 2027", origin: "writer" },
    { text: "Why Starfield's Expansion Slipped to 2027", origin: "variant" },
    { text: "Starfield — Delayed", origin: "bad" },
  ];
  const scores: Record<string, number> = {
    [cands[0]!.text]: 0,
    [cands[1]!.text]: 0.1,
    [cands[2]!.text]: 9,
  };
  const ctx = { game: "Starfield", source: "2027" };
  const ranked = rankCandidates(cands, (t) => scores[t]!, ctx);
  assert.equal(
    ranked[ranked.length - 1]!.origin,
    "bad",
    "a refused candidate never wins",
  );
  assert.equal(
    pickBest(ranked, cands[0]!.text, 0.15)!.changed,
    false,
    "a small lift is noise",
  );
  const p = pickBest(ranked, cands[0]!.text, 0.05)!;
  assert.equal(p.changed, true);
  assert.equal(p.chosen.origin, "variant");
  const failing = rankCandidates(
    [{ text: "Delayed to Early 2027", origin: "writer" }, cands[1]!],
    (t) => (t === cands[1]!.text ? -5 : 5),
    ctx,
  );
  assert.equal(
    pickBest(failing, "Delayed to Early 2027", 0.15)!.chosen.origin,
    "variant",
    "a writer's title that fails the check gives way",
  );
});

test("pixel features tell a dark busy frame from a bright clean one, and vision answers become features", () => {
  const w = 16;
  const h = 9;
  const dark = new Uint8Array(w * h * 3).fill(10);
  const bright = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const subject =
      i % w > 5 && i % w < 10 && Math.floor(i / w) > 2 && Math.floor(i / w) < 7;
    bright.set(subject ? [255, 120, 20] : [200, 200, 210], i * 3);
  }
  const d = pixelFeatures(dark, w, h);
  const b = pixelFeatures(bright, w, h);
  assert.ok(d.dark_share! > 0.9 && b.dark_share! < 0.1);
  assert.ok(b.lum_mean! > d.lum_mean!);
  assert.ok(
    b.subject_area! > 0 && b.subject_area! < 0.5,
    String(b.subject_area),
  );
  assert.ok(b.warm! > 0);
  assert.deepEqual(pixelFeatures(new Uint8Array(3), 4, 4), {});
  assert.deepEqual(
    lookFeatures({ subject: "face", realPerson: false, size: 0.4, words: 4 }),
    {
      v_face: 1,
      v_character: 1,
      v_real_person: 0,
      v_subject_size: 0.4,
      v_words: 0.5,
    },
  );
});

async function insertEpisode(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  extra: Partial<Record<string, unknown>> = {},
) {
  const script = (extra.script as object) ?? goodScript();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, script_json, assets_json, youtube_video_id, publish_at, lane)
     VALUES ($1, $1, $2, '{}', $3, $4, $5, $6, 'news')`,
    [
      id,
      extra.status ?? "uploading",
      JSON.stringify(script),
      JSON.stringify(extra.assets ?? {}),
      extra.videoId ?? null,
      extra.publishAt ?? null,
    ],
  );
  const [ep] = await db.query<Episode>(`SELECT * FROM episodes WHERE id = $1`, [
    id,
  ]);
  return ep!;
}

/** A model that loves question marks, written where the lab looks first. */
function questionModel(dataDir: string): void {
  const names = [...TITLE_FEATURES];
  const m = {
    names,
    mean: names.map(() => 0),
    scale: names.map(() => 1),
    weights: names.map((n) => (n === "question" ? 5 : 0)),
    bias: 0,
  };
  const model: FullModel = {
    version: 1,
    trainedAt: "x",
    features: names,
    heads: { short: { prior: m }, long: { prior: m } },
    blend: { short: { prior: 1 }, long: { prior: 1 } },
    meta: {},
  };
  fs.mkdirSync(path.join(dataDir, "packaging"), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "packaging", "model.json"),
    JSON.stringify(model),
  );
}

test("before upload: score mode logs and changes nothing, pick mode takes the best passing title once", async () => {
  const db = await testDb();
  const dataDir = await tmpDir();
  questionModel(dataDir);
  const script = goodScript({
    desk_question: "So is early 2027 a sign of trouble?",
  } as never);
  script.youtube.title_variants = ["Is Starfield's Expansion in Trouble?"];
  const ep = await insertEpisode(db, "ep_score", { script });
  const now = () => new Date("2026-11-14T12:00:00Z");
  const off = await packBeforeUpload(
    { cfg: { packaging: packagingSettings({}), dataDir }, db, now },
    ep,
    dataDir,
  );
  assert.equal(off, false);
  assert.equal(ep.assets_json?.packaging, undefined, "off does nothing at all");
  const scored = await packBeforeUpload(
    {
      cfg: {
        packaging: packagingSettings({ PACKAGING_LAB: "score" }),
        dataDir,
      },
      db,
      now,
    },
    ep,
    dataDir,
  );
  assert.equal(scored, false);
  assert.equal(
    ep.script_json!.youtube.title,
    "Starfield Expansion Delayed To Early 2027",
  );
  assert.ok((ep.assets_json as any)?.packaging?.runnersUp.length);
  const [ev] = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'ep_score'`,
  );
  assert.equal(ev!.kind, "packaging_scored");

  const ep2 = await insertEpisode(db, "ep_pick", {
    script: JSON.parse(JSON.stringify(script)),
  });
  const picked = await packBeforeUpload(
    {
      cfg: { packaging: packagingSettings({ PACKAGING_LAB: "pick" }), dataDir },
      db,
      now,
    },
    ep2,
    dataDir,
  );
  assert.equal(picked, true);
  assert.equal(
    ep2.script_json!.youtube.title,
    "Is Starfield's Expansion in Trouble?",
  );
  const [row] = await db.query<{ script_json: any; assets_json: any }>(
    `SELECT script_json, assets_json FROM episodes WHERE id = 'ep_pick'`,
  );
  assert.equal(
    row!.script_json.youtube.title,
    "Is Starfield's Expansion in Trouble?",
    "saved",
  );
  assert.equal(
    row!.assets_json.packaging.writerTitle,
    "Starfield Expansion Delayed To Early 2027",
  );
  assert.equal(
    await packBeforeUpload(
      {
        cfg: {
          packaging: packagingSettings({ PACKAGING_LAB: "pick" }),
          dataDir,
        },
        db,
        now,
      },
      ep2,
      dataDir,
    ),
    false,
    "once per episode",
  );
  // A rumour's question needs no label beyond the question mark; an unlabelled rumour title is never picked.
  const ranked = rankTitles(
    loadModel(dataDir)!,
    goodScript({ is_rumour: true }),
  );
  assert.ok(
    ranked
      .filter((r) => r.clarity.ok)
      .every((r) =>
        /reportedly|report|could|may|might|leak|\?|rumou?r|claim|insider|source/i.test(
          r.text,
        ),
      ),
  );
  // Hook words under pick: the writer's stay unless a candidate clearly wins; off returns the writer's.
  const s3 = goodScript();
  s3.youtube.thumb_text = "DELAYED AGAIN";
  assert.equal(
    pickHookWords(packagingSettings({}), dataDir, s3),
    "DELAYED AGAIN",
  );
  assert.ok(
    pickHookWords(packagingSettings({ PACKAGING_LAB: "pick" }), dataDir, s3),
  );
});

function fakeYouTube(live: { title: string; privacyStatus: string }) {
  const calls: string[] = [];
  return {
    calls,
    yt: {
      async liveVideo() {
        calls.push("liveVideo");
        return live;
      },
      async retitle(_id: string, expected: string, title: string) {
        calls.push(`retitle:${expected}->${title}`);
        live.title = title;
      },
      async setThumbnail() {
        calls.push("setThumbnail");
      },
      async stats(ids: string[]) {
        calls.push("stats");
        return new Map(
          ids.map((id) => [
            id,
            { views: 100, privacyStatus: live.privacyStatus },
          ]),
        );
      },
    },
  };
}

async function secondChanceFixture(
  opts: { liveTitle?: string; privacy?: string; abtest?: boolean } = {},
) {
  const db = await testDb();
  const dataDir = await tmpDir();
  questionModel(dataDir);
  const now = new Date();
  // Ten peers that did well, and one 60 hours old that did not.
  for (let i = 0; i < 10; i++) {
    const e = await insertEpisode(db, `peer${i}`, {
      status: "published",
      videoId: `peer${i}`,
      publishAt: new Date(now.getTime() - (100 + i) * 3600_000).toISOString(),
    });
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views) VALUES ($1, '24h', $2)`,
      [e.id, 1000 + i],
    );
  }
  const script = goodScript();
  script.youtube.title_variants = ["Is Starfield's Expansion in Trouble?"];
  await insertEpisode(db, "slow", {
    status: "published",
    videoId: "slowvid",
    script,
    publishAt: new Date(now.getTime() - 60 * 3600_000).toISOString(),
  });
  await db.query(
    `INSERT INTO video_metrics (episode_id, label, views) VALUES ('slow', '24h', 40)`,
  );
  if (opts.abtest) {
    fs.mkdirSync(path.join(dataDir, "abtests"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "abtests", "pending.json"),
      JSON.stringify([{ videoId: "slowvid" }]),
    );
  }
  const fake = fakeYouTube({
    title: opts.liveTitle ?? script.youtube.title,
    privacyStatus: opts.privacy ?? "public",
  });
  const notes: string[] = [];
  const s = {
    cfg: {
      packaging: packagingSettings({ PACKAGING_LAB: "retitle" }),
      dataDir,
    },
    db,
    now: () => now,
    youtube: () => fake.yt,
    notify: async (m: { content: string }) => notes.push(m.content),
  };
  return { db, dataDir, s, fake, notes };
}

test("second chance: an under-performing public video gets one new title, logged, privacy untouched", async () => {
  const { db, s, fake, notes } = await secondChanceFixture();
  const r = await runSecondChance(s);
  assert.equal(r.applied.length, 1, JSON.stringify(r));
  assert.equal(r.applied[0]!.to, "Is Starfield's Expansion in Trouble?");
  assert.ok(
    fake.calls.includes(
      "retitle:Starfield Expansion Delayed To Early 2027->Is Starfield's Expansion in Trouble?",
    ),
  );
  assert.ok(
    !fake.calls.some((c) => /privacy|public/i.test(c)),
    "no privacy call exists in the path",
  );
  assert.match(notes[0]!, /privacy untouched/);
  const [ev] = await db.query<{ detail: any }>(
    `SELECT detail FROM events WHERE kind = 'packaging_second_chance'`,
  );
  assert.equal(ev!.detail.kind, "title");
  // Never twice: the hourly throttle aside, the video is done for good.
  await db.query(`DELETE FROM events WHERE kind = 'packaging_tick'`);
  const again = await runSecondChance(s);
  assert.equal(again.applied.length, 0);
});

test("second chance leaves alone hand-edited titles, private videos, Test & compare videos, dry runs and other modes", async () => {
  const edited = await secondChanceFixture({
    liveTitle: "The Owner's Own Title",
  });
  const r1 = await runSecondChance(edited.s);
  assert.equal(r1.applied.length, 0);
  assert.match(r1.skipped[0]!.why, /changed by hand/);
  assert.ok(!edited.fake.calls.some((c) => c.startsWith("retitle")));

  const priv = await secondChanceFixture({ privacy: "private" });
  const r2 = await runSecondChance(priv.s);
  assert.match(r2.skipped[0]!.why, /not public/);

  const ab = await secondChanceFixture({ abtest: true });
  const r3 = await runSecondChance(ab.s);
  assert.match(r3.skipped[0]!.why, /Test & compare/);
  assert.ok(abTestVideoIds(ab.dataDir).has("slowvid"));

  const dry = await secondChanceFixture();
  const r4 = await runSecondChance({
    ...dry.s,
    cfg: { ...dry.s.cfg, dryRun: true },
  });
  assert.equal(r4.applied.length, 0);

  const pick = await secondChanceFixture();
  const r5 = await runSecondChance({
    ...pick.s,
    cfg: {
      ...pick.s.cfg,
      packaging: packagingSettings({ PACKAGING_LAB: "pick" }),
    },
  });
  assert.equal(r5.applied.length + r5.skipped.length, 0);
  assert.equal(pick.fake.calls.length, 0);
});

test("verdicts compare views per hour after the change with similar videos over the same ages", () => {
  assert.equal(
    judge({
      beforeViews: 100,
      beforeHours: 50,
      afterViews: 300,
      afterHours: 72,
      control: 0.5,
    }).verdict,
    "helped",
  );
  assert.equal(
    judge({
      beforeViews: 100,
      beforeHours: 50,
      afterViews: 20,
      afterHours: 72,
      control: 0.5,
    }).verdict,
    "hurt",
  );
  assert.equal(
    judge({
      beforeViews: 100,
      beforeHours: 50,
      afterViews: 72,
      afterHours: 72,
      control: 0.5,
    }).verdict,
    "no clear change",
  );
  assert.equal(percentileOf(5, [1, 2, 3, 10]), 0.75);
  assert.equal(percentileOf(5, []), 0.5);
});

test("retitle sends only the snippet, and refuses a title someone changed by hand", async () => {
  const sent: Array<{ url: string; body?: string }> = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    sent.push({ url, body: init?.body as string | undefined });
    if (init?.method === "PUT") return new Response("{}", { status: 200 });
    return new Response(
      JSON.stringify({
        items: [
          {
            snippet: {
              title: "Old",
              description: "d",
              categoryId: "20",
              tags: ["t"],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const yt = new YouTubeClient(async () => "tok", fetchFn as never);
  await yt.retitle("vid", "Old", "New");
  const put = sent.find((x) => x.body);
  assert.match(put!.url, /part=snippet$/);
  const body = JSON.parse(put!.body!);
  assert.equal(body.snippet.title, "New");
  assert.equal(body.snippet.description, "d");
  assert.equal(body.status, undefined, "privacy is never sent");
  await assert.rejects(
    yt.retitle("vid", "Something else", "New"),
    /changed|not the one/,
  );
});

test("the game must be the episode's own, a name in capitals is not shouting, and hook figures keep their phrase", async () => {
  const { namesOwnGame } = await import("../src/packaging/features.ts");
  assert.ok(namesOwnGame("GTA 6 gets a patch", "Grand Theft Auto 6"), "the US short name counts");
  assert.equal(namesOwnGame("Pure Xbox called the trailer odd", "Fable"), false, "another franchise is not the game");
  assert.match(clarity("Pure Xbox Called the Trailer Odd", { game: "Fable" }).hard.join(), /name the game/);
  const src = "The WAINK app lists cars. WAINK is new.";
  assert.equal(clarity("What Is GTA 6's WAINK App?", { source: src + " GTA 6" }).ok, true);
  assert.match(clarity("What Is GTA 6's WAINK App?", { source: "GTA 6 app" }).hard.join(), /all-caps/);
  const h = hookCandidates({ title: "Resident Evil Requiem wins GOTY with 17% of the vote" });
  assert.ok(h.some((x) => x.text === "17% OF THE VOTE"), JSON.stringify(h));
  const h2 = hookCandidates({ title: "Xbox adds 21 PC classics free for owners" });
  assert.ok(h2.every((x) => !/ (OF|THE|FOR)$/.test(x.text)), "never ends on a small word");
});

test("pictures read in one ffmpeg batch match the one-at-a-time reading, and a bad file falls back safely", async () => {
  const { imageFeatures, imageFeaturesBatch, imageDistance } = await import("../src/packaging/image.ts");
  const { FFMPEG } = await import("../src/lib/bin.ts");
  const { execFileSync } = await import("node:child_process");
  const dir = await tmpDir();
  const a = path.join(dir, "a.jpg");
  const b = path.join(dir, "b.jpg");
  execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "color=c=orange:s=320x180", "-frames:v", "1", a]);
  execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x180", "-frames:v", "1", b]);
  const batch = await imageFeaturesBatch([a, b], "long", dir);
  const one = await imageFeatures(b, "long");
  assert.ok(Math.abs(batch[1]!.lum_mean! - one!.lum_mean!) < 0.02);
  assert.ok(batch[0]!.warm! > batch[1]!.warm! || batch[0]!.sat_mean! > 0.5);
  const bad = path.join(dir, "bad.jpg");
  fs.writeFileSync(bad, "not a picture");
  const mixed = await imageFeaturesBatch([a, bad, b], "long", dir);
  assert.equal(mixed.length, 3);
  assert.equal(mixed[1], undefined, "the unreadable one gets nothing");
  assert.ok(mixed[2] && Math.abs(mixed[2].lum_mean! - one!.lum_mean!) < 0.02, "no feature lands on the wrong picture");
  assert.equal(await imageDistance(a, a), 0);
  assert.ok((await imageDistance(a, b))! > 0.05);
});
