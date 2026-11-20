// The Blender 3D kit's tools (factory/blender, src/render/blender.ts).
//   node --import tsx src/tools/blender.ts serve [--port=8797] [--cache=<dir>]
//       (the PC) the 3D clip service the Mac's factory asks for clips; each render takes its own orchestrator turn
//   node --import tsx src/tools/blender.ts render <params.json> <out.mp4>
//       one scene from a parameter file (run it inside `orch run`: it takes no turn of its own)
//   node --import tsx src/tools/blender.ts proof <out dir> [--only=podium,chapter] [--images=a.jpg,b.jpg]
//       every scene with sample data, landscape and the vertical variants, then a contact sheet, a reel and
//       timings.json with the render seconds and the black and freeze checks per clip (inside `orch run` too)
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { renderScene, type SceneResult } from "../render/blenderrun.ts";

const [, , command, ...rest] = process.argv;
const flag = (name: string) =>
  rest
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const positional = rest.filter((a) => !a.startsWith("--"));
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

interface ProofItem {
  name: string;
  scene: string;
  seconds: number;
  params: Record<string, unknown>;
  width?: number;
  height?: number;
  alpha?: boolean;
}

/** The proof set: every scene once with realistic data, plus the vertical (Shorts) variants. */
export function proofSet(images: string[]): ProofItem[] {
  const consoles = [
    { label: "PlayStation 2", value: 160, display: "160M" },
    { label: "Nintendo DS", value: 154.02, display: "154M" },
    { label: "Nintendo Switch", value: 150, display: "150M+" },
    { label: "Game Boy", value: 118.69, display: "118.7M" },
    { label: "PlayStation 4", value: 117.2, display: "117.2M" },
    { label: "Wii", value: 101.63, display: "101.6M" },
  ];
  return [
    {
      name: "podium",
      scene: "podium",
      seconds: 4.5,
      params: {
        rank: 7,
        title: "The Legend of Zelda: Breath of the Wild",
        meta: "2017 · Switch",
        kicker: "Number 7 of 10",
      },
    },
    {
      name: "podium_v",
      scene: "podium",
      seconds: 4.5,
      width: 1080,
      height: 1920,
      params: {
        rank: 1,
        title: "Red Dead Redemption 2",
        meta: "2018 · PS4, Xbox One",
      },
    },
    {
      name: "data_bars",
      scene: "data",
      seconds: 6,
      params: {
        mode: "bars",
        title: "Best-selling consoles ever",
        items: consoles,
      },
    },
    {
      name: "data_timeline",
      scene: "data",
      seconds: 6,
      params: {
        mode: "timeline",
        title: "The road to launch",
        items: [
          { year: "2013", label: "GTA V launches" },
          { year: "2022", label: "Sequel confirmed" },
          { year: "2023", label: "First trailer" },
          { year: "2025", label: "Second trailer" },
          { year: "2026", label: "Launch day" },
        ],
      },
    },
    {
      name: "chapter",
      scene: "chapter",
      seconds: 4.5,
      params: { number: 3, title: "The Rise of the Open World", year: "2001" },
    },
    {
      name: "chapter_v",
      scene: "chapter",
      seconds: 4.5,
      width: 1080,
      height: 1920,
      params: { number: 2, title: "A Studio Is Born", year: "1997" },
    },
    {
      name: "desk",
      scene: "desk",
      seconds: 6,
      params: { title: "The making of a classic", images },
    },
    {
      name: "globe",
      scene: "globe",
      seconds: 6,
      params: {
        countries: ["Japan"],
        pins: [
          { lat: 35.01, lon: 135.77, label: "Kyoto, Japan" },
          { lat: 47.67, lon: -122.12, label: "Redmond, USA" },
        ],
      },
    },
    {
      name: "globe_v",
      scene: "globe",
      seconds: 6,
      width: 1080,
      height: 1920,
      params: {
        countries: ["United Kingdom"],
        pins: [{ lat: 52.95, lon: -1.15, label: "Nottingham, UK" }],
      },
    },
    {
      name: "sting",
      scene: "sting",
      seconds: 3.5,
      params: { line: "Gaming news" },
    },
    {
      name: "sting_alpha_v",
      scene: "sting",
      seconds: 3.5,
      width: 1080,
      height: 1920,
      alpha: true,
      params: {},
    },
  ];
}

function ff(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], {
      windowsHide: true,
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) =>
      c === 0 ? resolve(err) : reject(new Error(err.slice(-500))),
    );
  });
}

/** Four frames of a clip as one 1920x270 row (vertical clips pillarboxed). */
async function sheetRow(
  clip: string,
  seconds: number,
  out: string,
): Promise<void> {
  const times = [0.15, 0.4, 0.7, 0.97].map((f) => (seconds * f).toFixed(2));
  const parts: string[] = [];
  for (const [i, t] of times.entries()) {
    const f = `${out}.${i}.png`;
    await ff([
      "-y",
      "-ss",
      t,
      "-i",
      clip,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x202024",
      f,
    ]);
    parts.push(f);
  }
  await ff([
    "-y",
    ...parts.flatMap((p) => ["-i", p]),
    "-filter_complex",
    "hstack=inputs=4",
    out,
  ]);
  for (const p of parts) await fs.rm(p, { force: true });
}

async function proof(outDir: string): Promise<void> {
  const only = flag("only")?.split(",");
  const images = (flag("images") ?? "").split(",").filter(Boolean);
  const set = proofSet(images).filter((p) => !only || only.includes(p.name));
  await fs.mkdir(outDir, { recursive: true });
  const results: Array<
    {
      name: string;
      scene: string;
      size: string;
      file?: string;
      error?: string;
    } & Partial<SceneResult>
  > = [];
  for (const p of set) {
    const ext = p.alpha ? "mov" : "mp4";
    const outFile = path.join(outDir, `${p.name}.${ext}`);
    const t0 = Date.now();
    try {
      const r = await renderScene({
        scene: p.scene,
        params: p.params,
        seconds: p.seconds,
        width: p.width,
        height: p.height,
        alpha: p.alpha,
        workDir: path.join(outDir, "work", p.name),
        outFile,
        keepFrames: false,
      });
      results.push({
        name: p.name,
        scene: p.scene,
        size: `${p.width ?? 1920}x${p.height ?? 1080}`,
        ...r,
      });
      console.log(
        `${p.name}: render ${r.renderSeconds.toFixed(1)} s, encode ${r.encodeSeconds.toFixed(1)} s, black ${JSON.stringify(r.black)}, frozen ${JSON.stringify(r.frozen)}, info ${JSON.stringify(r.info)}`,
      );
    } catch (err) {
      results.push({
        name: p.name,
        scene: p.scene,
        size: `${p.width ?? 1920}x${p.height ?? 1080}`,
        error: String(err).slice(0, 400),
      });
      console.log(
        `${p.name}: FAILED after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${String(err).slice(0, 300)}`,
      );
    }
    await fs.writeFile(
      path.join(outDir, "timings.json"),
      JSON.stringify(results, null, 1),
    );
  }
  const made = results.filter((r) => r.file);
  if (!made.length) return;
  // Contact sheet: one row of four frames per clip, in the order above.
  const rows: string[] = [];
  for (const r of made) {
    const row = path.join(outDir, "work", `${r.name}_row.png`);
    await sheetRow(r.file!, set.find((p) => p.name === r.name)!.seconds, row);
    rows.push(row);
  }
  await ff([
    "-y",
    ...rows.flatMap((x) => ["-i", x]),
    "-filter_complex",
    rows.length > 1 ? `vstack=inputs=${rows.length}` : "null",
    path.join(outDir, "contact_sheet.png"),
  ]);
  // The reel: every clip in turn at 1920x1080 (vertical ones pillarboxed, the alpha ident over the house ink).
  const inputs = made.flatMap((r) => ["-i", r.file!]);
  const chains = made
    .map(
      (_, i) =>
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0B0B0E,fps=30,format=yuv420p,setsar=1[v${i}]`,
    )
    .join(";");
  const cat =
    made.map((_, i) => `[v${i}]`).join("") +
    `concat=n=${made.length}:v=1:a=0[out]`;
  const reel = flag("reel") ?? path.join(outDir, "reel.mp4");
  await ff([
    "-y",
    ...inputs,
    "-filter_complex",
    `${chains};${cat}`,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    reel,
  ]);
  console.log(
    `contact sheet ${path.join(outDir, "contact_sheet.png")}, reel ${reel}`,
  );
}

async function main(): Promise<void> {
  if (command === "serve") {
    const { createBlenderServer } = await import("../render/blenderserve.ts");
    const port = Number(flag("port") ?? process.env.BLENDER_SERVE_PORT ?? 8797);
    const cacheDir =
      flag("cache") ??
      process.env.BLENDER_CACHE ??
      (process.platform === "win32"
        ? "D:/pulse-data/blender/cache"
        : path.join(os.homedir(), "PulseFactory", "blender", "cache"));
    // This machine only: the orchestrator's LAN relay forwards the Mac's requests here.
    createBlenderServer({ cacheDir }).listen(port, "127.0.0.1", () =>
      console.log(`3D clips: http://127.0.0.1:${port} (cache ${cacheDir})`),
    );
    return;
  }
  if (command === "render") {
    const [pfile, out] = positional;
    if (!pfile || !out)
      throw new Error("usage: render <params.json> <out.mp4>");
    const p = JSON.parse(await fs.readFile(pfile, "utf8")) as Record<
      string,
      unknown
    > & {
      scene: string;
      seconds?: number;
      width?: number;
      height?: number;
      alpha?: boolean;
    };
    const r = await renderScene({
      scene: p.scene,
      params: p,
      seconds: p.seconds ?? 5,
      width: p.width,
      height: p.height,
      alpha: p.alpha,
      workDir: `${out}.work`,
      outFile: out,
    });
    console.log(JSON.stringify({ ...r, info: r.info }, null, 1));
    return;
  }
  if (command === "proof") {
    if (!positional[0]) throw new Error("usage: proof <out dir>");
    await proof(positional[0]);
    return;
  }
  console.log(
    "commands: serve | render <params.json> <out.mp4> | proof <out dir>",
  );
}

await main();
