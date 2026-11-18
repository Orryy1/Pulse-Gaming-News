// SHORT_SOUND_PLAN=sparse and SHORT_LAYOUTS=on on a whole real Short (gap 2, 18 Nov 2026), from a COPY of the database
// and a COPY of the episode folder. No model calls, no voice, nothing published, nothing written to the live factory.
//   props <db copy> <episode id> <episode copy dir> <out json> <old|new>
//     rebuilds the Short's render props from its stored plan, script and words (as shortdepth_short.mts does). "old" is
//     the stored plan as it rendered; "new" runs the render step's SHORT_LAYOUTS (share 1, first shot 1.5 s) and the
//     sparse sound plan (share 1) on it, with the copy's newest 30 Shorts as the memory. Writes the graphics audit of
//     what will be drawn beside the props (<out json>.gfx.json).
//   render <props json> <episode copy dir> <out mp4>
//     renders those props with the real PulseShort composition, then the factory's loudness pass.
// On the PC run the render through the orchestrator at test priority with ORCH_CLIENT pointing nowhere, since
// renderShort would otherwise take its own turn inside the outer one (feedback: helpers use the orchestrator).
process.env.DATA_DIR ??= process.env.TMPDIR ?? process.env.TEMP ?? "/tmp";
const [mode, ...rest] = process.argv.slice(2);
import fs from "node:fs";

/* eslint-disable @typescript-eslint/no-explicit-any */
if (mode === "render") {
  const [propsFile, dir, out] = rest;
  const { renderShort } = await import("../../src/render/render.ts");
  const { normaliseLoudness } = await import("../../src/qa/media.ts");
  const props = JSON.parse(fs.readFileSync(propsFile!, "utf8"));
  const t0 = Date.now();
  const raw = `${out}.raw.mp4`;
  await renderShort({
    episodeDir: dir!,
    outFile: raw,
    posterFile: `${out}.poster.jpg`,
    concurrency: Number(process.env.PROOF_CONCURRENCY ?? 4),
    props,
  } as never);
  await normaliseLoudness(raw, out!);
  fs.rmSync(raw, { force: true });
  console.log(`rendered ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}

if (mode === "props") {
  const [dbDir, id, dir, out, arm] = rest;
  const { createEmbeddedDb } = await import("../../src/db.ts");
  const { buildSegments } = await import("../../src/render/timeline.ts");
  const pipeline = await import("../../src/pipeline.ts");
  const { bedFor } = await import("../../src/render/soundscape.ts");
  const { wordSoundCue } = await import("../../src/render/wordlook.ts");
  const { planSfx } = await import("../../src/render/plan.ts");
  const { readShortMemory, shapeShort, soundShort } = await import("../../src/untemplatestep.ts");
  const { auditShortGraphics } = await import("../../src/qa/gfxaudit.ts");
  const { gfxInputOf } = await import("../../src/qa/gfxgate.ts");
  const db = await createEmbeddedDb(dbDir!);
  const [e] = (await db.query<any>("select * from episodes where id=$1", [id])) as any[];
  if (!e) throw new Error(`no episode ${id} in the copy`);
  const parse = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;
  const script = parse(e.script_json);
  const assets = parse(e.assets_json);
  const plan = assets.plan;
  const duration = (assets.durationSeconds ?? 30) + 1;
  const words = assets.words ?? [];
  const segments = buildSegments(pipeline.segmentInputs(script, Boolean(assets.desk)), words, duration);
  const stamps = pipeline.stampsFor(script, words);
  const clean = true;
  let shape: any;
  const missing = [...(assets.images ?? []), ...(assets.clips ?? [])].filter((m: any) => !fs.existsSync(`${dir}/${m.file}`));
  if (missing.length) console.log(`warning: ${missing.length} media files missing in the copy, first ${missing[0].file}`);
  const before = { sequence: (plan.sfx ?? []).map((c: any) => c.file.split("/").pop()).join(">"), firstShot: plan.shots[0].end - plan.shots[0].start };
  let sound: any;
  if (arm === "new") {
    const memory = await readShortMemory(db, id!);
    const cfg = { shortLayouts: true, shortLayoutsShare: 1, shortFirstShotMinSeconds: 1.5, shortSoundPlan: "sparse" as const, shortSoundSparseShare: 1 };
    shape = shapeShort({ cfg, id: id!, plan, clean, rumour: Boolean(script.is_rumour), headline: script.headline, thumbText: script.youtube?.thumb_text, memory, assets });
    const stampSound = wordSoundCue(plan.wordLook);
    sound = soundShort({
      cfg, id: id!, plan, segments, words, stamps, clean, stampSound, shape, memory, assets,
      v3: () => planSfx(segments, plan.totalFrames),
    });
  }
  await db.close();
  const gfx = auditShortGraphics(gfxInputOf({ script, assets, segments, words, plan, stamps, clean, shape }));
  fs.writeFileSync(`${out}.gfx.json`, JSON.stringify({ id, arm, before, after: { sequence: plan.sfx.map((c: any) => c.file.split("/").pop()).join(">"), firstShot: plan.shots[0].end - plan.shots[0].start, silences: plan.silences ?? [] }, shape, sound, gfx }, null, 1));
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
      segments,
      words,
      durationSeconds: duration,
      variant: pipeline.variantOf(id!),
      audioFile: assets.audio ?? null,
      musicFile: assets.musicFile ?? bedFor(pipeline.variantOf(id!)),
      imageFiles: (assets.images ?? []).map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, blurFile: i.blurFile, beatIndex: i.beatIndex, focusX: i.focusX })),
      clipFiles: (assets.clips ?? []).map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, blurFile: c.blurFile, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock, crop: c.crop })),
      steam: assets.steam?.facts ?? null,
      emphasis: pipeline.emphasisWords(script),
      stamps,
      plan,
      suite: assets.suite,
      clean,
      heroCutFile: assets.heroCut,
      renderDate: String(e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at).slice(0, 10),
      ...(shape ? { shape } : {}),
    }),
  );
  console.log(JSON.stringify({ id, arm, before, after: { sequence: plan.sfx.map((c: any) => c.file.split("/").pop()).join(">"), firstShot: plan.shots[0].end - plan.shots[0].start, silences: plan.silences ?? [] }, shape, gfx: { faults: (gfx as any).faults?.length ?? (gfx as any).problems?.length } }));
  process.exit(0);
}
console.error("usage: untemplate_short.mts props <db copy> <id> <episode copy dir> <out json> <old|new> | render <props> <dir> <out mp4>");
process.exit(2);
