import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript, testDb } from "./helpers.ts";
import { segmentInputs } from "../src/pipeline.ts";
import {
  analyticsScopeOk,
  ANALYTICS_SCOPE,
  baselineOf,
  buildStudy,
  captureEarlyCurves,
  EARLY_LABEL,
  findDrops,
  openingLoss,
  openingSubject,
  resetLoginCheck,
  retentionLearnTick,
  retentionLessonLines,
  retentionSection,
  shortTimeline,
  studyRows,
  watchAtSeconds,
  type Curve,
} from "../src/retentionlearn.ts";
import { withRetentionLessons } from "../src/analyticsloop.ts";
import { retentionLines } from "../src/growthreport.ts";

const DUR = 30;

/** A 30-second Short's records: words every half second, footage and stills taking turns every 6 s. */
function shortRecords(id: string, opts: { firstStill?: boolean } = {}) {
  const script = goodScript();
  const text = segmentInputs(script, false)
    .map((s) => s.text)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const step = (DUR - 1) / text.length;
  const words = text.map((t, i) => ({
    text: t,
    start: +(i * step).toFixed(3),
    end: +((i + 1) * step).toFixed(3),
  }));
  const kinds = opts.firstStill
    ? ["image", "clip", "image", "clip", "image"]
    : ["clip", "image", "clip", "image", "clip"];
  const shots = kinds.map((type, k) => ({
    start: k * 180,
    end: (k + 1) * 180,
    segment: 0,
    move: "pushIn",
    framed: false,
    luma: 100,
    media: { type, index: 0 },
  }));
  return {
    id,
    lane: "news",
    videoId: `v_${id}`,
    label: "curve",
    script,
    assets: {
      words,
      durationSeconds: DUR,
      plan: { fps: 30, shots, shelf: [], sfx: [], turns: [] },
      clips: [
        {
          file: "assets/official_0.mp4",
          provenance: "Official trailer from the publisher",
        },
      ],
      images: [{ file: "a.jpg", kind: "screenshot" }],
    },
  };
}

/** A curve that loses `still` a point while a still is on screen and `moving` a point otherwise (shots of 6 s). */
function curveFor(
  rec: ReturnType<typeof shortRecords>,
  still = 0.012,
  moving = 0.002,
): Curve {
  const out: Curve = [];
  let w = 1;
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * DUR;
    out.push({ at: i / 100, watch: +w.toFixed(5), relative: 0.5 });
    const shot = rec.assets.plan.shots[Math.min(4, Math.floor(t / 6))]!;
    w *= 1 - (shot.media.type === "image" ? still : moving);
  }
  return out;
}

test("retention curves: interpolation, the opening's loss and drops beyond the usual curve", () => {
  const flat: Curve = Array.from({ length: 101 }, (_, i) => ({
    at: i / 100,
    watch: 1 - i * 0.002,
    relative: 0.5,
  }));
  assert.ok(Math.abs(watchAtSeconds(flat, 15, 30) - 0.9) < 1e-9);
  assert.ok(
    Math.abs(openingLoss(flat, 30) - (1 - watchAtSeconds(flat, 2, 30))) < 1e-9,
  );
  // A steady curve has no drop; a cliff from 12 s to 14 s is one drop, found where it is.
  assert.deepEqual(findDrops(flat, 30), []);
  const cliff = flat.map((p) => ({
    ...p,
    watch: p.at * 30 >= 13 ? p.watch - 0.15 : p.watch,
  }));
  const drops = findDrops(cliff, 30);
  assert.equal(drops.length, 1);
  assert.ok(
    drops[0]!.from >= 11.5 && drops[0]!.to <= 14.5,
    JSON.stringify(drops[0]),
  );
  assert.ok(drops[0]!.excess > 0.1);
  // A cliff inside the first 2 s is the opening's, never a drop.
  const early = flat.map((p) => ({
    ...p,
    watch: p.at * 30 >= 1 ? p.watch - 0.2 : p.watch,
  }));
  assert.deepEqual(findDrops(early, 30), []);
  // Against a baseline that expects the cliff, it is no drop either.
  const base = baselineOf(
    [cliff, cliff, cliff].map((curve) => ({ curve, duration: 30 })),
  );
  assert.deepEqual(findDrops(cliff, 30, base), []);
});

test("retention curves: what was on screen and said at a moment comes from the episode's own records", () => {
  const rec = shortRecords("a");
  const tl = shortTimeline(rec, segmentInputs)!;
  assert.ok(tl);
  const at = (t: number) =>
    tl.spans.filter((s) => s.from <= t && s.to > t).map((s) => s.tag);
  assert.ok(
    at(1).includes("moving footage") &&
      at(1).includes("trailer footage") &&
      at(1).includes("during the hook"),
  );
  assert.ok(
    at(8).includes("a still picture") && at(8).includes("a screenshot"),
  );
  assert.ok(
    tl.spans.some((s) => s.tag === "a cut" && Math.abs(s.from - 5.4) < 0.01),
  );
  assert.ok(tl.spans.some((s) => s.tag === "the take card"));
  assert.ok(
    tl.video.includes("opens on moving footage") &&
      tl.video.includes("opens on trailer footage"),
  );
  // No word timings, no timeline.
  assert.equal(
    shortTimeline(
      { ...rec, assets: { ...rec.assets, words: [] } },
      segmentInputs,
    ),
    undefined,
  );
});

test("retention study: a still picture that loses viewers is named as the top cause, with its numbers", () => {
  const now = new Date("2026-11-16T09:00:00Z");
  const rows = Array.from({ length: 6 }, (_, k) => {
    const rec = shortRecords(`s${k}`, { firstStill: k % 2 === 1 });
    return { ...rec, curve: curveFor(rec), stayed: k % 2 === 1 ? 0.3 : 0.5 };
  });
  const st = buildStudy(rows, segmentInputs, now);
  assert.equal(st.videos.length, 6);
  assert.deepEqual(st.skipped, []);
  const still = st.effects.find((e) => e.tag === "a still picture")!;
  const moving = st.effects.find((e) => e.tag === "moving footage")!;
  assert.ok(
    still.points > 0 && still.ratio > 1.5 && still.worse === 6,
    JSON.stringify(still),
  );
  assert.ok(moving.points < 0 && moving.ratio < 1, JSON.stringify(moving));
  assert.ok(
    st.causes.some((c) => c.kind === "drop" && c.tag === "a still picture"),
  );
  // Opening on a still: swiped away 70% against 50%, three Shorts a side.
  const open = st.causes.find(
    (c) => c.kind === "opening" && c.tag === "opens on a still picture",
  )!;
  assert.ok(open, JSON.stringify(st.causes.map((c) => c.tag)));
  assert.match(
    open.detail,
    /70% swiped away against 50% for the rest \(3 against 3 Shorts\)/,
  );
  assert.ok(st.lessons.length >= 2 && st.lessons.length <= 4);
  assert.ok(
    st.lessons.every((l) => l.endsWith("(retention curves 2026-11-16).")),
  );
  assert.ok(
    st.lessons.some((l) => /^Shorts that open on a still picture lose/.test(l)),
  );
  const section = retentionSection(st);
  assert.match(
    section[0]!,
    /^Retention curves: 6 Shorts. 60% of viewers swiped away/,
  );
  assert.ok(section.length >= 2 && section.length <= 6);
  // The growth report's lines, and the weekly report's merged lessons (retention first, three at most, blocklist kept).
  assert.match(
    retentionLines(st)[0]!,
    /^📉 \*\*Retention curves:\*\* 6 Shorts/,
  );
  const merged = withRetentionLessons(
    ["loop a", "loop b", "loop c", "loop d"],
    [...st.lessons, "extra one"],
    ["loop b"],
  );
  assert.equal(merged.length, 6);
  assert.equal(merged[0], st.lessons[0]);
  assert.ok(!merged.includes("loop b"));
});

test("retention study: under three Shorts a side nothing is stated", () => {
  const rows = [0, 1].map((k) => {
    const rec = shortRecords(`t${k}`);
    return { ...rec, curve: curveFor(rec) };
  });
  const st = buildStudy(rows, segmentInputs, new Date());
  assert.deepEqual(st.causes, []);
  assert.deepEqual(st.lessons, []);
  assert.deepEqual(retentionLessonLines([], [], "2026-11-16"), []);
  assert.equal(
    openingSubject("opens on a still picture"),
    "Shorts that open on a still picture",
  );
  assert.equal(
    openingSubject("a question hook"),
    "Shorts with a question hook",
  );
});

test("retention curves: read once at 48 hours, only on the stored login with the Analytics scope", async () => {
  const db = await testDb();
  const now = new Date("2026-11-16T12:00:00Z");
  const rec = shortRecords("ep_a");
  const ins = (id: string, hoursAgo: number) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, assets_json, youtube_video_id, publish_at) VALUES ($1, $1, 'published', '{"headline":"x","items":[]}', 'news', $2, $3, $4, $5)`,
      [
        id,
        JSON.stringify(rec.script),
        JSON.stringify(rec.assets),
        `v_${id}`,
        new Date(now.getTime() - hoursAgo * 3_600_000),
      ],
    );
  await ins("ep_old", 50);
  await ins("ep_new", 30);
  const asked: string[] = [];
  const yt = {
    retention: async () => new Map(),
    retentionCurve: async (v: string) => {
      asked.push(v);
      return curveFor(rec);
    },
  };
  assert.equal(await captureEarlyCurves(db, yt, now), 1);
  assert.deepEqual(asked, ["v_ep_old"]);
  assert.equal(await captureEarlyCurves(db, yt, now), 0, "read once");
  const rows = await studyRows(db, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.label, EARLY_LABEL);

  // The tick: no stored login, nothing read; a login without the scope, nothing read; with it, curves are read.
  resetLoginCheck();
  const later = new Date(now.getTime() + 24 * 3_600_000);
  assert.equal(
    await retentionLearnTick({
      db,
      now: later,
      yt,
      storedToken: async () => undefined,
    }),
    0,
  );
  resetLoginCheck();
  const tokeninfo = (scope: string) =>
    (async () =>
      new Response(JSON.stringify({ scope }), {
        status: 200,
      })) as unknown as typeof fetch;
  assert.equal(
    await retentionLearnTick({
      db,
      now: later,
      yt,
      storedToken: async () => "tok",
      fetchFn: tokeninfo("https://www.googleapis.com/auth/youtube.upload"),
    }),
    0,
  );
  resetLoginCheck();
  assert.equal(
    await retentionLearnTick({
      db,
      now: later,
      yt,
      storedToken: async () => "tok",
      fetchFn: tokeninfo(`a ${ANALYTICS_SCOPE}`),
    }),
    1,
  );
  assert.deepEqual(
    (await analyticsScopeOk("tok", tokeninfo(ANALYTICS_SCOPE))).ok,
    true,
  );
  await db.close();
});
