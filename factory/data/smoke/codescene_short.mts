// Code scenes on real Shorts, from a copy of the database; no model calls, nothing published.
//   survey <db copy> <from ISO>           what the planner would do to each Short since a date, and proof it took no clip
//   props <db copy> <episode id> <out>    the stored plan with scenes laid over it, as render props
//   render <props json> <episode dir> <out mp4> [frames from-to]   renders those props
process.env.DATA_DIR ??= process.env.TEMP ?? "/tmp";
const [mode, ...rest] = process.argv.slice(2);
import fs from "node:fs";

if (mode === "render") {
  const [propsFile, dir, out, range] = rest;
  const { renderShort } = await import("../../src/render/render.ts");
  const props = JSON.parse(fs.readFileSync(propsFile!, "utf8"));
  const t0 = Date.now();
  await renderShort({
    episodeDir: dir!,
    outFile: out!,
    posterFile: `${out}.poster.jpg`,
    concurrency: Number(process.env.SCENE_CONCURRENCY ?? 4),
    gl: "angle",
    props,
    frameRange: range ? (range.split("-").map(Number) as [number, number]) : undefined,
  } as never);
  console.log(`rendered ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}

const { PGlite } = await import("@electric-sql/pglite");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { applyCodeScenes, sceneShare } = await import("../../src/render/codescene.ts");
const pipeline = await import("../../src/pipeline.ts");
const { bedFor } = await import("../../src/render/soundscape.ts");
const db = new PGlite(rest[0]!);
await db.waitReady;
const parse = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;
const prepared = (script: any, assets: any, today: string) => {
  const duration = (assets.durationSeconds ?? 30) + 1;
  const words = assets.words ?? [];
  const segments = buildSegments(pipeline.segmentInputs(script, Boolean(assets.desk)), words, duration);
  const stamps = pipeline.stampsFor(script, words);
  const ctx = {
    sourced: [...segments.map((s: any) => s.text), ...(script.claims ?? []).map((c: any) => c.claim)].join(" "),
    game: script.game_title,
    today,
  };
  const after = applyCodeScenes(assets.plan, segments, words, ctx, stamps.map((s: any) => s.at), assets.images ?? []);
  return { duration, words, segments, stamps, after };
};
const plateShare = (p: any) =>
  p.shots.filter((s: any) => s.media.type === "plate").reduce((n: number, s: any) => n + s.end - s.start, 0) / p.totalFrames;

if (mode === "survey") {
  const r: any = await db.query("select id, lane, script_json, assets_json, created_at from episodes where created_at >= $1 order by created_at desc", [rest[1]]);
  let n = 0;
  const types: Record<string, number> = {};
  let withScene = 0;
  let clipsBefore = 0;
  let clipsAfter = 0;
  for (const e of r.rows) {
    const script = parse(e.script_json);
    const assets = parse(e.assets_json);
    if (!assets?.plan?.shots || !script?.beats || e.lane === "longform") continue;
    let res;
    try {
      res = prepared(script, assets, String(e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at).slice(0, 10));
    } catch {
      continue;
    }
    n++;
    const clips = (p: any) => p.shots.filter((s: any) => s.media.type === "clip").length;
    clipsBefore += clips(assets.plan);
    clipsAfter += clips(res.after);
    const got = res.after.scenes ?? [];
    if (got.length) withScene++;
    for (const s of got) types[s.scene.type] = (types[s.scene.type] ?? 0) + 1;
    console.log(
      e.id,
      e.lane.padEnd(13),
      `plate ${Math.round(plateShare(assets.plan) * 100)}% -> ${Math.round(plateShare(res.after) * 100)}%`,
      `scene ${Math.round(sceneShare(res.after) * 100)}%`,
      got.map((s: any) => `${s.scene.type}@${s.segment}(${s.to - s.from}f)`).join(" "),
    );
  }
  console.log(`SHORTS ${n}; with a scene ${withScene}; by type ${JSON.stringify(types)}; clip shots ${clipsBefore} -> ${clipsAfter}`);
}

if (mode === "props") {
  const [, id, out] = rest;
  const r: any = await db.query("select * from episodes where id=$1", [id]);
  const e = r.rows[0];
  const script = parse(e.script_json);
  const assets = parse(e.assets_json);
  const today = "2026-11-04";
  const res = prepared(script, assets, today);
  const plan = res.after;
  // Exactly the Short as published, with the scenes laid over it: only what would sit on top of a scene is dropped.
  if (plan.craft)
    plan.craft = {
      ...plan.craft,
      fillers: plan.craft.fillers.filter((f: any) => !(plan.scenes ?? []).some((s: any) => f.from < s.to && f.from + f.len > s.from)),
    };
  console.log("plate", plateShare(assets.plan), "->", plateShare(plan));
  console.log(JSON.stringify(plan.scenes, null, 0));
  const steam = assets.steam?.facts ?? null;
  const qa = parse(e.qa_json);
  fs.writeFileSync(
    out!,
    JSON.stringify({
      headline: script.headline,
      storyType: script.is_rumour ? "rumour" : script.story_type,
      gameTitle: script.game_title,
      isRumour: script.is_rumour,
      attribution: script.attribution,
      gameSubtitle: "",
      footageCredit: "",
      segments: res.segments,
      words: res.words,
      durationSeconds: res.duration,
      variant: pipeline.variantOf(id!),
      audioFile: assets.audio ?? null,
      musicFile: bedFor(pipeline.variantOf(id!)),
      imageFiles: (assets.images ?? []).map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, blurFile: i.blurFile, beatIndex: i.beatIndex })),
      clipFiles: (assets.clips ?? []).map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, blurFile: c.blurFile, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock })),
      steam,
      emphasis: pipeline.emphasisWords(script),
      stamps: res.stamps,
      plan,
      suite: assets.suite,
      clean: qa?.clean ?? true,
      mascot: assets.mascot,
      heroCutFile: assets.heroCut,
      renderDate: today,
    }),
  );
}
await db.close();
process.exit(0);
