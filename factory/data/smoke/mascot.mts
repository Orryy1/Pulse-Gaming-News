// Pip the mascot proofs (MASCOT_SHARE test, 14 Nov 2026), no model calls and nothing published:
//   sheet <out.png>                         the character sheet, every face (PulseMascotSheet)
//   proof --db <db copy> --eps a,b --out <dir>
//       rebuilds each real Short's render props from its stored plan (as data/smoke/allshorts.mts does), picks Pip's
//       moments (src/render/mascot.ts), prints them with the graphics audit, and renders the same frame of each
//       moment without and with Pip, side by side (before_after_<ep>_<n>.png), plus a strip of the top-right corner
//       across one reaction (reaction_<ep>.png) showing that he pops in, holds and leaves.
// Episode folders and the database copy are only read. Run as an orchestrator job (heavy, priority 20).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  openBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { getBundle, serveDir, webPath } from "../../src/render/render.ts";

const [mode, ...rest] = process.argv.slice(2);
/** ffmpeg drawtext's font (Windows path, colon escaped for the filter). */
const FONT = "fontfile='C\\:/Windows/Fonts/arialbd.ttf'";
const flag = (name: string, fallback = "") => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
};

const serveUrl = await getBundle();
const browser = await openBrowser("chrome", {
  chromiumOptions: { gl: "angle" },
});

if (mode === "sheet") {
  const out = path.resolve(rest[0] ?? "pip_sheet.png");
  const composition = await selectComposition({
    serveUrl,
    id: "PulseMascotSheet",
    inputProps: { frame: 30 },
    puppeteerInstance: browser,
  });
  await renderStill({
    composition,
    serveUrl,
    output: out,
    inputProps: { frame: 30 },
    imageFormat: "png",
    puppeteerInstance: browser,
  });
  console.log("sheet", out);
}

if (mode === "proof") {
  const { PGlite } = await import("@electric-sql/pglite");
  const { buildSegments } = await import("../../src/render/timeline.ts");
  const { TAIL_SECONDS } = await import("../../src/render/plan.ts");
  const { emphasisWords, photoCredit, segmentInputs, stampsFor, variantOf } =
    await import("../../src/pipeline.ts");
  const { ccCredit } = await import("../../src/render/cleanframe.ts");
  const { pipMoments, auditPip, PIP_SHORT, PIP_MOOD_LABEL } =
    await import("../../src/render/mascot.ts");
  const OUT = path.resolve(flag("out", "data/smoke/mascot_out"));
  fs.mkdirSync(OUT, { recursive: true });
  const ROOT = "C:/PulseFactory/factory/data/episodes";
  const db = new PGlite(flag("db", "data/smoke/dbcopy/db"));
  for (const id of flag("eps").split(",").filter(Boolean)) {
    const row = (
      await db.query<any>(
        `SELECT script_json, assets_json, created_at FROM episodes WHERE id = $1`,
        [id],
      )
    ).rows[0];
    if (!row) {
      console.log("missing", id);
      continue;
    }
    const script = row.script_json;
    const assets = row.assets_json;
    const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
    const words = assets.words ?? [];
    const segments = buildSegments(
      segmentInputs(script, Boolean(assets.desk)),
      words,
      duration,
    );
    const stamps = stampsFor(script, words);
    const moments = pipMoments({
      segments,
      stamps,
      isRumour: script.is_rumour,
      words,
      durationSeconds: duration,
    });
    const audit = auditPip(moments, segments);
    console.log(`\n=== ${id} "${script.headline}"`);
    for (const m of moments)
      console.log(
        `  ${m.at.toFixed(2)} s  ${m.beat.padEnd(7)} ${PIP_MOOD_LABEL[m.mood].padEnd(16)} on: "${segments[m.segment]!.text.slice(0, 70)}"`,
      );
    console.log(
      `  graphics audit: ${audit.length ? audit.map((a) => `${a.at}s ${a.problem}`).join("; ") : "clean"}`,
    );
    const day = String(
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    ).slice(0, 10);
    const gameYear =
      Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) ||
      undefined;
    const images = (assets.images ?? []).map((i: any) => ({
      ...i,
      credit: photoCredit(i),
    }));
    const clips = assets.clips ?? [];
    const dir = `${ROOT}/${id}`;
    const files = await serveDir(dir);
    try {
      const base = {
        headline: script.headline,
        storyType: script.is_rumour ? "rumour" : script.story_type,
        gameTitle: script.game_title,
        isRumour: script.is_rumour,
        attribution: script.attribution,
        gameSubtitle: gameYear ? String(gameYear) : "",
        footageCredit: clips.length
          ? `Footage: ${script.game_title} · official trailer`
          : "",
        segments,
        words,
        durationSeconds: duration,
        variant: variantOf(id),
        steam: assets.steam?.facts ?? null,
        emphasis: emphasisWords(script),
        deskName: assets.desk?.voice?.name,
        stamps,
        suite: Boolean(assets.suite),
        renderDate: day,
        plan: assets.plan,
        images: images.map((i: any) => ({
          src: `${files.url}/${webPath(i.file)}`,
          kind: i.kind,
          aspect: i.aspect,
          blurSrc: i.blurFile ? `${files.url}/${webPath(i.blurFile)}` : null,
          beatIndex: i.beatIndex,
          credit: i.credit,
        })),
        clips: clips.map((c: any) => ({
          src: `${files.url}/${webPath(c.file)}`,
          durationSeconds: c.durationSeconds,
          blurSrc: c.blurFile ? `${files.url}/${webPath(c.blurFile)}` : null,
          beatIndex: c.beatIndex,
          role: c.role,
          motion: c.motion,
          luma: c.luma,
          stock: c.stock,
          credit: ccCredit(c.provenance),
        })),
        audioSrc: null,
        musicSrc: null,
        logoSrc: "logo.png",
      };
      const still = async (
        props: any,
        frame: number,
        out: string,
        scale = 1,
      ) => {
        const composition = await selectComposition({
          serveUrl,
          id: "PulseShort",
          inputProps: props,
          puppeteerInstance: browser,
        });
        await renderStill({
          composition,
          serveUrl,
          output: out,
          inputProps: props,
          frame,
          imageFormat: "png",
          scale,
          puppeteerInstance: browser,
          timeoutInMilliseconds: 180_000,
        });
      };
      const short = id.slice(-8);
      for (const [n, m] of moments.entries()) {
        const frame = Math.round((m.at + 0.9) * 30);
        const a = path.join(OUT, `_before_${short}_${n}.png`);
        const b = path.join(OUT, `_after_${short}_${n}.png`);
        await still({ ...base, mascot: false }, frame, a);
        await still({ ...base, mascot: true }, frame, b);
        // Side by side at two thirds size with a label bar, then the corner of the "after" frame at full size.
        const label =
          `${short}  ${(frame / 30).toFixed(1)} s  ${m.beat}: ${PIP_MOOD_LABEL[m.mood]}`.replace(
            /:/g,
            "\\:",
          );
        execFileSync("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          "-i",
          a,
          "-i",
          b,
          "-filter_complex",
          `[0]scale=720:1280,drawtext=${FONT}:text='BEFORE':x=24:y=24:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10[l];` +
            `[1]scale=720:1280,drawtext=${FONT}:text='AFTER (WITH PIP)':x=24:y=24:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10[r];` +
            `[l][r]hstack=inputs=2,pad=1452:1360:6:80:color=0x16161B,drawtext=${FONT}:text='${label}':x=24:y=22:fontsize=36:fontcolor=white`,
          "-frames:v",
          "1",
          path.join(OUT, `before_after_${short}_${n + 1}.png`),
        ]);
        execFileSync("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          "-i",
          b,
          "-vf",
          "crop=540:420:540:100",
          path.join(OUT, `corner_${short}_${n + 1}.png`),
        ]);
        fs.rmSync(a, { force: true });
        fs.rmSync(b, { force: true });
        console.log("  wrote", `before_after_${short}_${n + 1}.png`);
      }
      // One reaction across time: the top-right corner before, at the pop, settled, holding and gone.
      const m = moments[0];
      if (m) {
        const start = Math.round(m.at * 30);
        const offs = [-6, 3, 8, 20, 45, 68, 78];
        const parts: string[] = [];
        for (const o of offs) {
          const p = path.join(OUT, `_r_${short}_${o}.png`);
          await still({ ...base, mascot: true }, start + o, p);
          const c = path.join(OUT, `_rc_${short}_${o}.png`);
          execFileSync("ffmpeg", [
            "-y",
            "-loglevel",
            "error",
            "-i",
            p,
            "-vf",
            `crop=${PIP_SHORT.size + 120}:${PIP_SHORT.size + 60}:${PIP_SHORT.left - 90}:${PIP_SHORT.top - 30},drawtext=${FONT}:text='${((start + o) / 30).toFixed(2)}s':x=8:y=8:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6`,
            c,
          ]);
          parts.push(c);
          fs.rmSync(p, { force: true });
        }
        execFileSync("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          ...parts.flatMap((p) => ["-i", p]),
          "-filter_complex",
          `hstack=inputs=${parts.length}`,
          path.join(OUT, `reaction_${short}.png`),
        ]);
        parts.forEach((p) => fs.rmSync(p, { force: true }));
        console.log("  wrote", `reaction_${short}.png`);
      }
    } finally {
      await files.close();
    }
  }
  await db.close();
}
await browser.close({ silent: true });
