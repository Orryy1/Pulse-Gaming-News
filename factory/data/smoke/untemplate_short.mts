// SHORT_SOUND_PLAN=sparse and SHORT_LAYOUTS=on on a whole real Short (gap 2, 18 Nov 2026), from a COPY of the database
// and a COPY of the episode folder. No model calls, no voice, nothing published, nothing written to the live factory.
//   props <db copy> <episode id> <episode copy dir> <out json> <old|new>
//     rebuilds the Short's render props from its stored plan, script and words (as shortdepth_short.mts does). "old" is
//     the stored plan as it rendered; "new" runs the render step's SHORT_LAYOUTS (share 1, first shot 1.5 s) and the
//     sparse sound plan (share 1) on it, with the copy's newest 30 Shorts as the memory. Both arms carry the collage
//     card where stage's render step places it (motifSting), and the sparse plan hears it. Writes the graphics audit of
//     what will be drawn beside the props (<out json>.gfx.json).
//     FORCE_OPEN=footage|lower (proof only) replaces the picked opening after the pick, keeping the picked closing;
//     refused when that opening is not allowed (a lower third needs a headline that fits one line and no rumour).
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
    // The cover still (SHORT_FULL_COVER), drawn with today's card opening whatever the shape (render.ts cardStillProps).
    coverFile: `${out!.replace(/\.mp4$/, "")}.cover.jpg`,
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
  const { lowerLine } = await import("../../src/render/untemplate.ts");
  const { auditShortGraphics } = await import("../../src/qa/gfxaudit.ts");
  const { gfxInputOf } = await import("../../src/qa/gfxgate.ts");
  const { stingPlacement } = await import("../../src/render/cleanframe.ts");
  const { namesGame, isHardwareAsset } = await import("../../src/assets/linevisuals.ts");
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
  // The game collage card's place, as stage's render step works it out (pipeline.ts stingAt) and hands the render.
  const stingAt = assets.suite
    ? (stingPlacement({
        segments,
        words,
        fps: plan.fps,
        totalFrames: plan.totalFrames,
        names: (t: string) => namesGame(t, script.game_title),
        pictures: (assets.images ?? []).filter((i: any) => i.aspect >= 1.2 && !isHardwareAsset(i)).length,
      }) ?? null)
    : undefined;
  const missing = [...(assets.images ?? []), ...(assets.clips ?? [])].filter((m: any) => !fs.existsSync(`${dir}/${m.file}`));
  if (missing.length) console.log(`warning: ${missing.length} media files missing in the copy, first ${missing[0].file}`);
  const before = { sequence: (plan.sfx ?? []).map((c: any) => c.file.split("/").pop()).join(">"), firstShot: plan.shots[0].end - plan.shots[0].start };
  let sound: any;
  if (arm === "new") {
    const memory = await readShortMemory(db, id!);
    const cfg = {
      shortLayouts: true,
      shortLayoutsShare: 1,
      shortFirstShotMinSeconds: 1.5,
      shortFirstShotShare: 1,
      shortSoundPlan: "sparse" as const,
      shortSoundSparseShare: 1,
    };
    shape = shapeShort({ cfg, id: id!, plan, clean, rumour: Boolean(script.is_rumour), headline: script.headline, memory, assets });
    const force = process.env.FORCE_OPEN;
    if (force && shape && shape.open !== force) {
      const line = lowerLine(script.headline);
      if (force === "lower" && (!line || script.is_rumour)) throw new Error(`FORCE_OPEN=lower refused: ${script.is_rumour ? "a rumour" : "the headline does not fit one line"}`);
      if (force !== "lower" && force !== "footage") throw new Error(`FORCE_OPEN=${force}: only footage or lower`);
      console.log(`proof override: picked ${shape.open}, forced ${force}`);
      shape = force === "lower" ? { open: "lower", close: shape.close, line } : { open: "footage", close: shape.close };
      assets.shortShape = { ...(assets.shortShape ?? {}), ...shape, forcedForProof: true };
      if (force !== "lower") delete assets.shortShape.line;
    }
    const stampSound = wordSoundCue(plan.wordLook);
    sound = soundShort({
      cfg, id: id!, plan, segments, words, stamps, clean, stampSound, shape, memory, assets, sting: stingAt ?? false,
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
      ...(stingAt !== undefined ? { motifSting: stingAt } : {}),
      ...(shape ? { shape } : {}),
    }),
  );
  console.log(JSON.stringify({ id, arm, before, after: { sequence: plan.sfx.map((c: any) => c.file.split("/").pop()).join(">"), firstShot: plan.shots[0].end - plan.shots[0].start, silences: plan.silences ?? [] }, shape, gfx: { faults: (gfx as any).faults?.length ?? (gfx as any).problems?.length } }));
  process.exit(0);
}
console.error("usage: untemplate_short.mts props <db copy> <id> <episode copy dir> <out json> <old|new> | render <props> <dir> <out mp4>");
process.exit(2);
