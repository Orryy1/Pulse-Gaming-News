// Previews the archive documents (src/render/components/docs) on their own PulseDoc composition and writes a
// contact sheet: light CPU, one still at a time, no video unless asked.
// node --import tsx data/smoke/docs.mts <cases.json> <out dir> [--video]
// cases.json: [{ "name": "memo_a", "scene": DocScene, "len": 180, "words": [{ text, start, end }] (seconds from
//   the shot's start, optional), "frames": [14, 60, 104] }]
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [casesFile, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const video = process.argv.includes("--video");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const cases = (JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>).filter(
  (c) => !only || c.name.includes(only),
);
fs.mkdirSync(out!, { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.resolve("src/render/components/docs/Preview.tsx"),
  publicDir: path.resolve("public"),
  onProgress: () => undefined,
});
const stills: string[] = [];
for (const c of cases) {
  const len = c.len ?? 180;
  const props = { scene: c.scene, len, words: c.words, durationSeconds: len / 30 };
  const composition = await selectComposition({ serveUrl, id: "PulseDoc", inputProps: props });
  for (const f of c.frames ?? [14, 60, 104]) {
    const file = `${out}/${c.name}_${String(f).padStart(3, "0")}.png`;
    await renderStill({ composition, serveUrl, output: file, inputProps: props, frame: Math.min(f, len - 1), chromiumOptions: { gl: "angle" } });
    stills.push(file);
  }
  if (video)
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: `${out}/${c.name}.mp4`, inputProps: props, muted: true, chromiumOptions: { gl: "angle" }, concurrency: 2 });
  console.log("rendered", c.name);
}
// The contact sheet: three frames a case (landing, marking, settled), one case a row.
const per = Math.max(...cases.map((c) => (c.frames ?? [0, 0, 0]).length));
const list = path.join(out!, "sheet_list.txt");
fs.writeFileSync(list, stills.map((s) => `file '${path.resolve(s).split(path.sep).join("/")}'`).join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=640:-1,tile=${per}x${cases.length}:padding=6:color=black`, "-frames:v", "1", path.join(out!, "contact_sheet.jpg")]);
console.log("sheet", path.join(out!, "contact_sheet.jpg"));
