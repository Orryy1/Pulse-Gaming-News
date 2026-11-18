// APPLE_SMART_CROP and APPLE_SUBJECT_LIFT on a whole real Short (14 Nov 2026), on the Mac mini, from a COPY of the
// database and a COPY of the episode folder. No model calls, nothing published, nothing written to the live factory.
//   props <db copy> <episode id> <episode copy dir> <out json>
//     rebuilds the Short's render props from its stored plan (as codescene_short.mts does), then does what the render
//     step does with both settings on: a smart crop for every clip (Apple Vision, src/assets/applevision.ts) and the
//     hero art's subject lifted for the opening poster. Prints each clip's crop path (how far it travels).
//   render <props json> <episode copy dir> <out mp4>
//     renders those props with the real PulseShort composition.
// Run through ~/orch/macrun.sh with PATH=/opt/homebrew/bin first, outside the render windows.
process.env.DATA_DIR ??= process.env.TMPDIR ?? "/tmp";
const [mode, ...rest] = process.argv.slice(2);
import fs from "node:fs";
import path from "node:path";

if (mode === "render") {
  const [propsFile, dir, out] = rest;
  const { renderShort } = await import("../../src/render/render.ts");
  const props = JSON.parse(fs.readFileSync(propsFile!, "utf8"));
  const t0 = Date.now();
  await renderShort({
    episodeDir: dir!,
    outFile: out!,
    posterFile: `${out}.poster.jpg`,
    concurrency: Number(process.env.APPLE_CONCURRENCY ?? 4),
    gl: "angle",
    props,
  } as never);
  console.log(`rendered ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}

if (mode === "props") {
  const [dbDir, id, dir, out] = rest;
  const { PGlite } = await import("@electric-sql/pglite");
  const { buildSegments } = await import("../../src/render/timeline.ts");
  const pipeline = await import("../../src/pipeline.ts");
  const { bedFor } = await import("../../src/render/soundscape.ts");
  const { smartCrop, appleCut } = await import("../../src/assets/applevision.ts");
  const db = new PGlite(dbDir!);
  await db.waitReady;
  const parse = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;
  const r: any = await db.query("select * from episodes where id=$1", [id]);
  const e = r.rows[0];
  if (!e) throw new Error(`no episode ${id} in the copy`);
  const script = parse(e.script_json);
  const assets = parse(e.assets_json);
  const qa = parse(e.qa_json);
  await db.close();
  const plan = assets.plan;
  const duration = (assets.durationSeconds ?? 30) + 1;
  const words = assets.words ?? [];
  const segments = buildSegments(pipeline.segmentInputs(script, Boolean(assets.desk)), words, duration);
  const stamps = pipeline.stampsFor(script, words);
  const clips: any[] = assets.clips ?? [];
  const report: any[] = [];
  for (const c of clips) {
    const t0 = Date.now();
    const crop = c.crop ?? (await smartCrop(path.join(dir!, c.file)));
    if (crop) c.crop = crop;
    const xs = (crop?.path ?? []).map((p: any) => p[1] as number);
    report.push({
      file: c.file,
      seconds: c.durationSeconds,
      crop: Boolean(crop),
      points: xs.length,
      xMin: xs.length ? Math.min(...xs) : null,
      xMax: xs.length ? Math.max(...xs) : null,
      ms: Date.now() - t0,
    });
  }
  console.log(JSON.stringify({ clips: report }, null, 1));
  // The render step lifts the hero only when the opening shot is the hero art (the new-look poster).
  const heroImage = assets.images?.[plan.heroIndex];
  const heroFirst = heroImage && plan.shots[0]?.media.type === "image" && plan.shots[0].media.index === plan.heroIndex;
  let heroCut = assets.heroCut;
  if (assets.suite && heroImage) {
    const cut = await appleCut(dir!, heroImage.file);
    console.log(JSON.stringify({ hero: heroImage.file, heroFirst, suite: assets.suite, lift: cut ?? null }));
    if (cut && heroFirst && !heroCut) heroCut = cut;
  } else console.log(JSON.stringify({ hero: heroImage?.file ?? null, heroFirst, suite: assets.suite, lift: "not tried (no suite)" }));
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
      musicFile: bedFor(pipeline.variantOf(id!)),
      imageFiles: (assets.images ?? []).map((i: any) => ({ file: i.file, kind: i.kind, aspect: i.aspect, blurFile: i.blurFile, beatIndex: i.beatIndex, focusX: i.focusX })),
      clipFiles: clips.map((c: any) => ({ file: c.file, durationSeconds: c.durationSeconds, blurFile: c.blurFile, beatIndex: c.beatIndex, role: c.role, motion: c.motion, luma: c.luma, stock: c.stock, crop: c.crop })),
      steam: assets.steam?.facts ?? null,
      emphasis: pipeline.emphasisWords(script),
      stamps,
      plan,
      suite: assets.suite,
      clean: qa?.clean ?? true,
      mascot: assets.mascot,
      heroCutFile: heroCut,
      renderDate: String(e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at).slice(0, 10),
    }),
  );
  process.exit(0);
}
console.error("usage: apple_short.mts props <db copy> <episode id> <episode copy dir> <out json> | render <props> <dir> <out mp4>");
process.exit(2);
