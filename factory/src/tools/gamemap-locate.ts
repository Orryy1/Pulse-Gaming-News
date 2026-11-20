// MAP_PINS: find where each place sits on a game's map picture, from the map's own printed labels. Run once per map;
// the answers go into the table (src/assets/gamemaps/<id>.json) and are never asked again.
//
//   node --import tsx src/tools/gamemap-locate.ts <table.json> <map picture> [--only "Vice City,Hamlet"]
//        [--engine ocr|vision|both] [--redo]
//
// 1. The picture is cut into overlapping tiles, enlarged so small map type reads.
// 2. The OCR engine on this machine (Windows OCR, or Apple Vision on the Mac: src/assets/ocr.ts) reads each tile;
//    a wanted name printed on it gives the centre of its label. Names OCR cannot find go to the local vision model
//    (Ollama, LOCAL_VISION_URL / LOCAL_VISION_MODEL, as the factory screens frames), which gives the label's centre.
// 3. A name seen at two places far apart is dropped as ambiguous.
// 4. The check, once: a close crop around the spot must show the name again (re-read by OCR, else asked of the
//    vision model). Only then is the place checked. A name never found keeps no spot, so it is never pinned.
// The vision model runs on the GPU: on the PC wrap that run in the orchestrator (--class gpu). OCR alone is light.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../lib/bin.ts";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
} from "../assets/localvision.ts";
import type { GameMapTable } from "../assets/gamemaps.ts";
import { readText, textBox, type Box, type OcrPage, type OcrWord } from "../assets/ocr.ts";

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlapping square-ish tiles covering a picture: each about `size` px, overlapping by a quarter. */
export function tilesFor(width: number, height: number, size: number): Tile[] {
  const step = Math.round(size * 0.75);
  const cols = Math.max(1, Math.ceil((width - size) / step) + 1);
  const rows = Math.max(1, Math.ceil((height - size) / step) + 1);
  const out: Tile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const w = Math.min(size, width);
      const h = Math.min(size, height);
      out.push({
        x: Math.min(c * step, width - w),
        y: Math.min(r * step, height - h),
        w,
        h,
      });
    }
  return out;
}

/**
 * Candidates from every tile's answers, in picture shares: one spot per name, or none when the name was seen at
 * two places more than `apart` (a share of the picture's width) from each other.
 */
export function mergeSightings(
  sightings: Array<{ name: string; x: number; y: number }>,
  width: number,
  height: number,
  apart = 0.04,
): Map<string, { x: number; y: number }> {
  const by = new Map<string, Array<{ x: number; y: number }>>();
  for (const s of sightings)
    by.set(s.name, [...(by.get(s.name) ?? []), { x: s.x, y: s.y }]);
  const out = new Map<string, { x: number; y: number }>();
  for (const [name, pts] of by) {
    const far = pts.some((a) =>
      pts.some(
        (b) =>
          Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) > apart * width,
      ),
    );
    if (far) continue;
    out.set(name, {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    });
  }
  return out;
}

/**
 * An optional ffmpeg filter for the tiles (GAMEMAP_OCR_FILTER), for a map whose labels sit on busy texture: e.g. keep
 * only the bright type, black on white, so the OCR engine reads it.
 */
const OCR_FILTER = process.env.GAMEMAP_OCR_FILTER ?? "";

function crop(src: string, t: Tile, out: string, scaleTo = 1000): void {
  const r = spawnSync(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      src,
      "-vf",
      `crop=${t.w}:${t.h}:${t.x}:${t.y},scale=${scaleTo}:-2:flags=lanczos${OCR_FILTER ? `,${OCR_FILTER}` : ""}`,
      "-q:v",
      "3",
      out,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffmpeg crop failed: ${r.stderr}`);
}

async function ask<T>(
  prompt: string,
  file: string,
  schema: object,
  predict = 400,
): Promise<T | undefined> {
  const image = (await fsp.readFile(file)).toString("base64");
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.GAMEMAP_VISION_MODEL || LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: schema,
        keep_alive: "60s",
        options: {
          temperature: 0,
          num_predict: predict + THINK_ROOM,
          num_ctx: 8192,
        },
        messages: [{ role: "user", content: prompt, images: [image] }],
      }),
    },
    180_000,
  );
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return visionAnswer(
    (await res.json()) as { message?: { content?: string; thinking?: string } },
  ) as T | undefined;
}

const FIND_SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["name", "x", "y"],
      },
    },
  },
  required: ["found"],
};

const CHECK_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, shows: { type: "boolean" } },
  required: ["text", "shows"],
};

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Where a place's own label is printed on an OCR page: the name's words (textBox), and only when they are the whole
 * label: no word of the same type size runs on beside them or on the line just under or over them. So "Capri" is
 * never read off "Capri Sound", nor "Ambrosia" off "Ambrosia Raceway Park". A box in shares of the page, or undefined.
 */
export function labelBox(page: OcrPage, name: string): Box | undefined {
  const box = textBox(page, name);
  if (!box) return undefined;
  const W = page.width;
  const H = page.height;
  // The matched words themselves: inside the box.
  const inside = (w: OcrWord) => w.x >= box[0] * W - 1 && w.x + w.w <= box[2] * W + 1 && w.y >= box[1] * H - 1 && w.y + w.h <= box[3] * H + 1;
  const own = page.words.filter(inside);
  if (!own.length) return undefined;
  const h = own.reduce((s, w) => s + w.h, 0) / own.length;
  const x1 = Math.min(...own.map((w) => w.x));
  const x2 = Math.max(...own.map((w) => w.x + w.w));
  const y1 = Math.min(...own.map((w) => w.y));
  const y2 = Math.max(...own.map((w) => w.y + w.h));
  const runsOn = page.words.some((w) => {
    if (inside(w) || w.h < h * 0.75 || w.h > h * 1.33) return false;
    const cy = w.y + w.h / 2;
    const sameLine = cy >= y1 && cy <= y2;
    const besideGap = w.x >= x2 ? w.x - x2 : x1 - (w.x + w.w);
    if (sameLine && besideGap >= 0 && besideGap < h * 0.9) return true;
    const overlapsX = w.x < x2 && w.x + w.w > x1;
    const lineGap = w.y >= y2 ? w.y - y2 : y1 - (w.y + w.h);
    return overlapsX && lineGap >= 0 && lineGap < h * 0.6;
  });
  return runsOn ? undefined : box;
}

/** The place's spot from an OCR page of a tile: the centre of its printed label, in picture shares. */
export function ocrSighting(page: OcrPage, name: string, t: Tile, width: number, height: number): { x: number; y: number } | undefined {
  const box = labelBox(page, name);
  if (!box) return undefined;
  return { x: (t.x + ((box[0] + box[2]) / 2) * t.w) / width, y: (t.y + ((box[1] + box[3]) / 2) * t.h) / height };
}

/** Whether a label's box (shares of a check crop) sits around the crop's middle, where the spot is. */
export function centred(box: Box): boolean {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return Math.abs(cx - 0.5) < 0.25 && Math.abs(cy - 0.5) < 0.25;
}

function checkTile(c: { x: number; y: number }, width: number, height: number): Tile {
  const cw = Math.round(Math.min(width, Math.max(260, width * 0.16)));
  const ch = Math.round(Math.min(height, cw * 0.6));
  return {
    x: Math.round(Math.min(width - cw, Math.max(0, c.x * width - cw / 2))),
    y: Math.round(Math.min(height - ch, Math.max(0, c.y * height - ch / 2))),
    w: cw,
    h: ch,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueFlags = ["--only", "--engine"];
  const [tableFile, picture] = args.filter((a, i) => !a.startsWith("--") && !valueFlags.includes(args[i - 1]!));
  if (!tableFile || !picture) throw new Error("usage: gamemap-locate.ts <table.json> <map picture> [--only names] [--engine ocr|vision|both] [--redo]");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",").map((s) => s.trim()) : undefined;
  const engine = args.includes("--engine") ? args[args.indexOf("--engine") + 1]! : "both";
  const redo = args.includes("--redo");
  const table = JSON.parse(await fsp.readFile(tableFile, "utf8")) as GameMapTable;
  const { width, height } = table.map;
  const wanted = table.places.filter((p) => (!only || only.includes(p.name)) && (redo || !p.checked));
  if (!wanted.length) {
    console.log("nothing to locate");
    return;
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gamemap-"));
  const size = Number(process.env.GAMEMAP_TILE ?? Math.round(Math.min(width, height) / 2.2));
  const tiles = tilesFor(width, height, size);
  const tileFiles = tiles.map((t, k) => {
    const file = path.join(tmp, `tile${k}.png`);
    // OCR reads small map type better enlarged; the engine's own limit is about 2,600 px a side.
    crop(picture, t, file, Math.min(2400, Math.max(1000, t.w * 2)));
    return file;
  });
  const today = new Date().toISOString().slice(0, 10);
  const found = new Map<string, { x: number; y: number; by: "ocr" | "vision" }>();
  // 1. The printed labels, read by the OCR engine on this machine (Windows OCR or Apple Vision): exact text.
  if (engine !== "vision") {
    const pages = await readText(tileFiles);
    const sightings: Array<{ name: string; x: number; y: number }> = [];
    for (const p of wanted)
      tiles.forEach((t, k) => {
        const page = pages.get(tileFiles[k]!);
        const s = page ? ocrSighting(page, p.name, t, width, height) : undefined;
        if (s) sightings.push({ name: p.name, ...s });
      });
    for (const [name, c] of mergeSightings(sightings, width, height)) found.set(name, { ...c, by: "ocr" });
    console.log(`OCR read ${pages.size}/${tiles.length} tiles, found ${found.size}/${wanted.length}`);
  }
  // 2. What OCR missed, asked of the local vision model.
  const missing = wanted.filter((p) => !found.has(p.name)).map((p) => p.name);
  if (engine !== "ocr" && missing.length) {
    const sightings: Array<{ name: string; x: number; y: number }> = [];
    for (const [k, t] of tiles.entries()) {
      const ans = await ask<{ found?: Array<{ name: string; x: number; y: number }> }>(
        `This is part of a video game's map. Which of these place names are printed as text labels on it? ${missing.map((n) => `"${n}"`).join(", ")}.\nFor each one whose label you can read on this image, give the name exactly as listed and the centre of its printed label as x and y from 0 to 1000 across the image's width and height. Leave out every name you cannot read here. Do not guess.`,
        tileFiles[k]!,
        FIND_SCHEMA,
        600,
      ).catch((err) => {
        console.warn(`tile ${k}: ${err instanceof Error ? err.message : err}`);
        return undefined;
      });
      for (const f of ans?.found ?? []) {
        const name = missing.find((n) => normName(n) === normName(f.name));
        if (!name || !(f.x >= 0 && f.x <= 1000 && f.y >= 0 && f.y <= 1000)) continue;
        sightings.push({ name, x: (t.x + (f.x / 1000) * t.w) / width, y: (t.y + (f.y / 1000) * t.h) / height });
      }
    }
    for (const [name, c] of mergeSightings(sightings, width, height)) found.set(name, { ...c, by: "vision" });
  }
  // 3. The check, once: a close crop around each spot must show the name again (re-read by OCR, else the vision model).
  const checks = new Map<string, string>();
  const checkFiles = new Map<string, string[]>();
  for (const p of wanted) {
    const c = found.get(p.name);
    if (!c) continue;
    // Two enlargements: OCR reads some map type at one size and not the other.
    const tile = checkTile(c, width, height);
    const files = [1.5, 2.5].map((k, i) => {
      const file = path.join(tmp, `check_${normName(p.name).replace(/ /g, "_")}_${i}.png`);
      crop(picture, tile, file, Math.round(tile.w * k));
      return file;
    });
    checkFiles.set(p.name, files);
  }
  if (engine !== "vision" && checkFiles.size) {
    const pages = await readText([...checkFiles.values()].flat());
    for (const [name, files] of checkFiles) {
      // The whole label again, and in the middle of the crop: the spot is the label, not a name printed nearby.
      const ok = files.some((file) => {
        const page = pages.get(file);
        const box = page ? labelBox(page, name) : undefined;
        return !!box && centred(box);
      });
      if (ok) checks.set(name, `ocr crop ${today}: re-read "${name}"`);
    }
  }
  for (const [name, [file]] of checkFiles) {
    if (checks.has(name) || engine === "ocr" || !file) continue;
    const v = await ask<{ text?: string; shows?: boolean }>(
      `Read the largest printed place name nearest the middle of this crop of a video game map, exactly as printed (text). Then answer shows: true only if the printed name "${name}" appears in full in this crop.`,
      file,
      CHECK_SCHEMA,
      120,
    ).catch(() => undefined);
    // The whole name read back, word for word: "Vice Beach" never confirms Vice City.
    if (v?.shows === true && normName(v.text ?? "") === normName(name)) checks.set(name, `vision crop ${today}: read "${v.text}"`);
  }
  for (const place of wanted) {
    const c = found.get(place.name);
    if (!c) {
      console.log(`NOT FOUND ${place.name}`);
      place.checked = false;
      continue;
    }
    place.x = Math.round(c.x * 10000) / 10000;
    place.y = Math.round(c.y * 10000) / 10000;
    place.located = "vision";
    place.checked = checks.has(place.name);
    place.check = checks.get(place.name) ?? `${c.by} ${today}: found, but the crop check failed`;
    console.log(`${place.checked ? "CHECKED" : "FAILED "} ${place.name} at ${place.x}, ${place.y} (${place.check})`);
  }
  await fsp.writeFile(tableFile, `${JSON.stringify(table, null, 2)}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
