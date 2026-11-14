// Quick Pip proofs without a Remotion render (seconds of CPU): the character sheet from the same SVG the Short
// draws (PipFigure through react-dom/server, screenshotted once by headless Chrome), and before/after stills made
// from the published Shorts' own frames (one ffmpeg frame each) with Pip overlaid in his box at each of his moments.
// The full render proof is data/smoke/mascot.mts (an orchestrator heavy job).
//   node --import tsx data/smoke/mascot_quick.mts --db <db copy> --eps a,b --out <dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { PipFigure } from "../../src/render/components/Pip.tsx";
import {
  PIP_MOOD_LABEL,
  PIP_MOODS,
  PIP_SHORT,
  auditPip,
  pipMoments,
  type PipMood,
} from "../../src/render/mascot.ts";
import { buildSegments } from "../../src/render/timeline.ts";
import { TAIL_SECONDS } from "../../src/render/plan.ts";
import { segmentInputs, stampsFor } from "../../src/pipeline.ts";

const args = process.argv.slice(2);
const flag = (n: string, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const OUT = path.resolve(flag("out", "data/smoke/mascot_out"));
fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(OUT, "_tmp");
fs.mkdirSync(TMP, { recursive: true });
const CHROME =
  "C:/PulseFactory/factory/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe";
const FONT = "fontfile='C\\:/Windows/Fonts/arialbd.ttf'";

const figure = (mood: PipMood, size: number, f = 30) =>
  renderToStaticMarkup(React.createElement(PipFigure, { mood, f, size }));

/** One screenshot of an HTML page (transparent where the page is). */
function shoot(html: string, w: number, h: number, out: string) {
  const file = path.join(TMP, `${path.basename(out, ".png")}.html`);
  fs.writeFileSync(
    file,
    `<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`,
  );
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      `file:///${file.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore" },
  );
}

const USE: Record<PipMood, string> = {
  shocked: "Reveal: a big number or surprise",
  laughing: "Joke: the line lands",
  thinking: "Twist, or a steady verdict",
  smug: "Sarcasm, or a call we made",
  facepalm: "Delay, bug or price rise",
  hype: "Good news, strong verdict",
  sceptical: "Rumour, the catch, faint verdict",
  receipt: "Confirmed: the claim checked out",
};

// ---- The character sheet ----
{
  const cells = PIP_MOODS.map(
    (
      m,
    ) => `<div style="background:#22222A;border-radius:26px;padding:20px 16px 22px;display:flex;flex-direction:column;align-items:center">
      ${figure(m, 340)}
      <div style="font:900 46px Impact,'Arial Black';color:#F5F5F2;margin-top:8px;letter-spacing:1px">${PIP_MOOD_LABEL[m].toUpperCase()}</div>
      <div style="font:25px Arial;color:#B4B4BC;margin-top:6px;text-align:center">${USE[m]}</div></div>`,
  ).join("");
  const small = PIP_MOODS.map((m) => figure(m, PIP_SHORT.size)).join("");
  const html = `<div style="width:2400px;height:1500px;background:#16161B;box-sizing:border-box;padding:60px 70px;font-family:Arial">
    <div style="display:flex;align-items:baseline;gap:26px"><span style="font:92px Impact,'Arial Black';color:#FF6B1A">PIP</span>
    <span style="font-size:40px;color:#F5F5F2">the Pulse mascot: eight reactions</span></div>
    <div style="font-size:28px;color:#B4B4BC;margin-top:4px">Drawn in code, never talks, no voice. Two or three short reactions per Short, top right, only at the reveal, the joke and the verdict.</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:30px;margin-top:34px">${cells}</div>
    <div style="display:flex;align-items:center;gap:40px;margin-top:26px"><div style="font-size:26px;color:#B4B4BC;width:250px">Actual size on a 1080 x 1920 Short:</div>${small}</div></div>`;
  shoot(html, 2400, 1500, path.join(OUT, "pip_character_sheet.png"));
  console.log("sheet", path.join(OUT, "pip_character_sheet.png"));
}

// ---- Before and after on real Shorts ----
const ROOT = "C:/PulseFactory/factory/data/episodes";
const eps = flag("eps").split(",").filter(Boolean);
const esc = (s: string) =>
  s
    .replace(/\\/g, "")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,");
if (eps.length) {
  const db = new PGlite(flag("db"));
  for (const id of eps) {
    const row = (
      await db.query<any>(
        `SELECT script_json, assets_json FROM episodes WHERE id = $1`,
        [id],
      )
    ).rows[0];
    const script = row.script_json;
    const assets = row.assets_json;
    const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
    const words = assets.words ?? [];
    const segments = buildSegments(
      segmentInputs(script, Boolean(assets.desk)),
      words,
      duration,
    );
    const moments = pipMoments({
      segments,
      stamps: stampsFor(script, words),
      isRumour: script.is_rumour,
      words,
      durationSeconds: duration,
    });
    const audit = auditPip(moments, segments);
    console.log(`\n=== ${id} "${script.headline}"`);
    for (const m of moments)
      console.log(
        `  ${m.at.toFixed(2)} s  ${m.beat.padEnd(7)} ${PIP_MOOD_LABEL[m.mood].padEnd(16)} on: "${segments[m.segment]!.text.slice(0, 80)}"`,
      );
    console.log(
      `  graphics audit: ${audit.length ? audit.map((a) => `${a.at}s ${a.problem}`).join("; ") : "clean"}`,
    );
    const short = id.slice(-8);
    for (const [n, m] of moments.entries()) {
      const t = m.at + 0.9;
      const frame = path.join(TMP, `f_${short}_${n}.png`);
      const overlay = path.join(TMP, `o_${short}_${n}.png`);
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        t.toFixed(3),
        "-i",
        `${ROOT}/${id}/short.mp4`,
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:1920",
        frame,
      ]);
      // The full-frame overlay: Pip in his box with the same drop shadow the Short gives him.
      shoot(
        `<div style="position:absolute;left:${PIP_SHORT.left}px;top:${PIP_SHORT.top}px;width:${PIP_SHORT.size}px;height:${PIP_SHORT.size}px;filter:drop-shadow(0 7px 12px rgba(0,0,0,0.6))">${figure(m.mood, PIP_SHORT.size, 27)}</div>`,
        1080,
        1920,
        overlay,
      );
      const title = esc(
        `${script.headline}   ${t.toFixed(1)} s   ${m.beat}: ${PIP_MOOD_LABEL[m.mood]}`,
      );
      const out = path.join(OUT, `before_after_${short}_${n + 1}.png`);
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        frame,
        "-i",
        overlay,
        "-filter_complex",
        `[0][1]overlay=0:0[aft];[0]split[b0][bz];[aft]split[a0][az];` +
          `[b0]scale=720:1280,drawtext=${FONT}:text='BEFORE (as published)':x=20:y=20:fontsize=38:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12[l];` +
          `[a0]scale=720:1280,drawtext=${FONT}:text='AFTER (with Pip)':x=20:y=20:fontsize=38:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12[r];` +
          `[bz]crop=540:300:540:110,scale=720:400,drawtext=${FONT}:text='before, top right':x=14:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8[zb];` +
          `[az]crop=540:300:540:110,scale=720:400,drawtext=${FONT}:text='after, top right':x=14:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8[za];` +
          `[l][r]hstack=inputs=2[top];[zb][za]hstack=inputs=2[bot];[top][bot]vstack=inputs=2,pad=1440:1760:0:80:color=0x16161B,` +
          `drawtext=${FONT}:text='${title}':x=20:y=24:fontsize=34:fontcolor=0xF5F5F2`,
        "-frames:v",
        "1",
        out,
      ]);
      console.log("  wrote", out);
    }
  }
  await db.close();
}
fs.rmSync(TMP, { recursive: true, force: true });
