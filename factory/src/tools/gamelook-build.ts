// GAME_LOOK: builds the per-game style profiles (src/render/gamelooks.data.ts) from each game's key art and logo.
//
//   node --import tsx src/tools/gamelook-build.ts [--only gta6,botw]
//
// The palette is measured from the art (src/render/lookpalette.ts); the face, corners and HUD are the editor's
// choice per game, written in SPECS below: a free licensed face (SIL OFL, public/fonts) matched in style to the
// game's own type, never its font files. Art is cached in data/gamelooks/ and fetched once from its source. With
// --only, every other profile already built is kept as it is, so adding a game never shifts a look in use; a run
// without --only rebuilds them all.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { fetchWithTimeout, USER_AGENT } from "../lib/util.ts";
import { lookPalette } from "../render/lookpalette.ts";
import type { GameLook, LookCorner, LookHud } from "../render/gamelook.ts";

export interface LookSpec {
  id: string;
  name: string;
  titles: string[];
  /** Key art: a URL (cached under data/gamelooks/<id>_art.<ext>) or a file. */
  art: string;
  logo?: string;
  /** Steers which of the art's own colours leads (never invents one): see lookPalette. */
  hint?: string;
  display: string;
  corner: LookCorner;
  hud: LookHud;
}

export const SPECS: LookSpec[] = [
  {
    // Modern, sunlit and loud: the cover's sunset pink leads; a tall condensed face like the series' signage; a
    // clean cut-corner HUD and a radar in the corner, as the game's own screen has.
    id: "gta6",
    name: "Grand Theft Auto VI",
    titles: [
      "Grand Theft Auto VI",
      "Grand Theft Auto 6",
      "GTA VI",
      "GTA 6",
      "GTA6",
    ],
    art: "https://www.rockstargames.com/VI/_next/static/media/Cover_Art_Poster.05g75soif2t00.jpg?akim=1&imdensity=1&imwidth=1920",
    hint: "#ff4fa0",
    display: "bebas",
    corner: "chamfer",
    hud: "minimap",
  },
  {
    // The Sheikah Slate's blue over the gold of the cover; an engraved roman capital like the game's titles;
    // rounded double-rule corners and a stamina wheel.
    id: "botw",
    name: "The Legend of Zelda: Breath of the Wild",
    titles: [
      "The Legend of Zelda: Breath of the Wild",
      "Zelda: Breath of the Wild",
      "Breath of the Wild",
      "BotW",
    ],
    art: "https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg",
    hint: "#3fb5e6",
    display: "cinzel",
    corner: "ornate",
    hud: "stamina",
  },
  {
    // A 16-bit platformer: the box's blue, a pixel face, stepped pixel corners and a score counter.
    id: "sonic1991",
    name: "Sonic the Hedgehog (1991)",
    titles: ["Sonic the Hedgehog (1991)", "Sonic the Hedgehog 1991", "Sonic 1"],
    art: "https://upload.wikimedia.org/wikipedia/en/b/ba/Sonic_the_Hedgehog_1_Genesis_box_art.jpg",
    hint: "#2a6cff",
    display: "pressstart",
    corner: "pixel",
    hud: "pixel",
  },
  {
    // Survival horror: the cover's blood red over near-black, an old engraved small-caps face, rough brushed
    // corners and a tape-recorder counter.
    id: "re4remake",
    name: "Resident Evil 4 (2023)",
    titles: [
      "Resident Evil 4 (2023)",
      "Resident Evil 4 Remake",
      "Resident Evil 4 remake",
      "RE4 Remake",
    ],
    art: "https://upload.wikimedia.org/wikipedia/en/d/df/Resident_Evil_4_remake_cover_art.jpg",
    hint: "#c0202a",
    display: "imfell",
    corner: "scratch",
    hud: "vhs",
  },
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "render", "gamelooks.data.ts");

async function artFile(spec: LookSpec, cacheDir: string): Promise<string> {
  if (!/^https?:/.test(spec.art)) return spec.art;
  const ext = (
    /\.(jpe?g|png|webp)(\?|$)/i.exec(spec.art)?.[1] ?? "jpg"
  ).toLowerCase();
  const file = path.join(cacheDir, `${spec.id}_art.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 5_000) return file;
  const res = await fetchWithTimeout(
    spec.art,
    { headers: { "user-agent": USER_AGENT } },
    60_000,
  );
  if (!res.ok) throw new Error(`${spec.id}: art ${res.status}`);
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** The picture as 96x96 RGB pixels (ffmpeg), the sample the palette is measured from. */
export function samplePixels(file: string, size = 96): Uint8Array {
  const r = spawnSync(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `scale=${size}:${size}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    {
      maxBuffer: 1 << 24,
    },
  );
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.toString()}`);
  return new Uint8Array(r.stdout);
}

/** The profiles as the generated module's source. */
export function profilesSource(looks: GameLook[]): string {
  return `// Generated by src/tools/gamelook-build.ts: the GAME_LOOK style profiles (src/render/gamelook.ts). Rebuild, do not hand-edit.
import type { GameLook } from "./gamelook.ts";

export const PROFILES: GameLook[] = ${JSON.stringify(looks, null, 2)};
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes("--only")
    ? args[args.indexOf("--only") + 1]!.split(",")
    : undefined;
  const cacheDir = path.resolve(process.env.DATA_DIR ?? "data", "gamelooks");
  const { PROFILES } = (await import(pathToFileURL(OUT).href).catch(() => ({
    PROFILES: [],
  }))) as { PROFILES: GameLook[] };
  const out: GameLook[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const spec of SPECS) {
    const kept = PROFILES.find((p) => p.id === spec.id);
    if (kept && only && !only.includes(spec.id)) {
      out.push(kept);
      continue;
    }
    const art = await artFile(spec, cacheDir);
    const logo = spec.logo
      ? await artFile(
          { ...spec, id: `${spec.id}_logo`, art: spec.logo },
          cacheDir,
        )
      : undefined;
    const px = logo
      ? Uint8Array.from([...samplePixels(art), ...samplePixels(logo, 24)])
      : samplePixels(art);
    const pal = lookPalette(px, spec.hint);
    out.push({
      id: spec.id,
      name: spec.name,
      titles: spec.titles,
      ...pal,
      display: spec.display,
      corner: spec.corner,
      hud: spec.hud,
      source: {
        art: spec.art,
        ...(spec.logo ? { logo: spec.logo } : {}),
        built: today,
      },
    });
    console.log(spec.id, pal);
  }
  await fsp.writeFile(OUT, profilesSource(out));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
