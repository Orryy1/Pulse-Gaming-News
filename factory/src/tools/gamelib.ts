// The game media library by hand (src/assets/gamelib.ts). Heavy steps belong in a turn: on the PC wrap them in
// C:\Claude\orchestrator\orch.cmd run (fetch and scenes: --class cpu; tag: --class gpu), never the Mac's macrun.
//   node --import tsx src/tools/gamelib.ts fetch "<game>" [--own=<folder>] [--no-site] [--no-igdb] [--no-steam]
//        the publisher site's official stills, screenshot pack and trailers (Rockstar first), IGDB's whole screenshot
//        set, the Steam store's screenshots and the owner's recordings of the game; near-duplicates dropped
//   node --import tsx src/tools/gamelib.ts scenes "<game>"      cut every video into scenes (cuts, or every 20 s of play)
//   node --import tsx src/tools/gamelib.ts tag "<game>" [--limit=N]   tag stills and scenes on the free local model
//   node --import tsx src/tools/gamelib.ts stats "<game>"
//   node --import tsx src/tools/gamelib.ts pick "<game>" "<sentence>" [--keywords=a,b]   what a line would get
//   node --import tsx src/tools/gamelib.ts queue-playthroughs "<game>" ["<game>" ...]   gameplay indexes for the
//        scene index job (src/sceneindex/schema.ts gameplayIndexName); they download through the YouTube guard's
//        background budget only, once, and keep their proxy
// Settings: DATA_DIR (or GAME_LIBRARY_DIR), LOCAL_VISION_URL, TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET for IGDB.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout } from "../lib/util.ts";
import { TAR } from "../backup.ts";
import {
  canonicalGame,
  cutTimes,
  dhash,
  grabFrame,
  isNearDuplicate,
  itemId,
  libraryDir,
  libraryRoot,
  LIBRARY_VERSION,
  pickForLines,
  readLibrary,
  scenesFromCuts,
  tagPicture,
  tagsForSentence,
  videoSeconds,
  writeLibrary,
  type GameLibrary,
  type LibItem,
} from "../assets/gamelib.ts";
import { siteFor, nameOf, type SiteAsset } from "../assets/publishersite.ts";
import { findIgdbGame } from "../assets/igdb.ts";
import { findSteamApp } from "../assets/steam.ts";
import { libraryFiles, recordingsOf } from "../assets/library.ts";
import { gameplayIndexName } from "../sceneindex/schema.ts";
import { queueGame, readQueue, writeQueue } from "../sceneindex/job.ts";

const exec = promisify(execFile);
const [command, game0, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const dataDir = process.env.DATA_DIR || "data";
const root = libraryRoot(dataDir);

async function load(game: string): Promise<GameLibrary> {
  return (
    (await readLibrary(root, game)) ?? {
      version: LIBRARY_VERSION,
      game: canonicalGame(game),
      items: [],
      updatedAt: "",
    }
  );
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "user-agent": "Mozilla/5.0" } },
      30 * 60_000,
    );
    if (!res.ok || !res.body) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(`${dest}.part`),
    );
    await fs.rename(`${dest}.part`, dest);
    return true;
  } catch (err) {
    console.log(`  download failed ${url}: ${errorMessage(err)}`);
    return false;
  }
}

/** A trailer or clip as a silent 1080p H.264 copy: small, quick to cut, plays everywhere. */
async function proxyVideo(src: string, dest: string): Promise<boolean> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // H.264 already (Rockstar's downloads, the owner's recordings): the picture is kept as it is and only the sound
  // dropped, a copy and no encode, so fetching is light work. Anything else is encoded once to 1080p.
  const { stdout } = await exec(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,height",
    "-of",
    "csv=p=0",
    src,
  ]).catch(() => ({ stdout: "" }));
  const [codec, height] = String(stdout).trim().split(",");
  if (codec === "h264" && Number(height) <= 2160) {
    try {
      await exec(
        FFMPEG,
        [
          "-y",
          "-v",
          "error",
          "-i",
          src,
          "-an",
          "-c:v",
          "copy",
          "-movflags",
          "+faststart",
          `${dest}.part.mp4`,
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 3600_000 },
      );
      await fs.rename(`${dest}.part.mp4`, dest);
      return true;
    } catch (err) {
      console.log(`  copy failed ${src}: ${errorMessage(err).slice(0, 200)}`);
    }
  }
  try {
    await exec(
      FFMPEG,
      [
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-an",
        "-vf",
        "scale=-2:'min(1080,ih)',fps=30",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        `${dest}.part.mp4`,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 3 * 3600_000 },
    );
    await fs.rename(`${dest}.part.mp4`, dest);
    return true;
  } catch (err) {
    console.log(`  proxy failed ${src}: ${errorMessage(err).slice(0, 200)}`);
    return false;
  }
}

async function addStill(
  lib: GameLibrary,
  dir: string,
  file: string,
  sourceUrl: string,
  provenance: string,
  source: string,
  named: string[],
): Promise<boolean> {
  if (lib.items.some((i) => i.sourceUrl === sourceUrl)) return false;
  const hash = await dhash(path.join(dir, file));
  if (
    isNearDuplicate(
      hash,
      lib.items.filter((i) => i.kind === "still").map((i) => i.dhash),
    )
  ) {
    await fs.rm(path.join(dir, file), { force: true });
    return false;
  }
  lib.items.push({
    id: itemId(sourceUrl),
    kind: "still",
    file,
    sourceUrl,
    provenance,
    source,
    named,
    tags: [],
    seen: "",
    ...(hash ? { dhash: hash } : {}),
    addedAt: new Date().toISOString(),
  });
  return true;
}

async function fetchSite(
  lib: GameLibrary,
  dir: string,
  game: string,
): Promise<void> {
  const site = siteFor(game);
  if (!site) return console.log("no publisher site source for", game);
  const assets = await site.list(game);
  console.log(`${site.publisher}: ${assets.length} listed`);
  for (const a of assets) {
    try {
      if (a.kind === "still") await siteStill(lib, dir, a);
      else if (a.kind === "video") await siteVideo(lib, dir, a, a.name);
      else await sitePack(lib, dir, a);
    } catch (err) {
      console.log(`  ${a.url}: ${errorMessage(err)}`);
    }
  }
}

async function siteStill(
  lib: GameLibrary,
  dir: string,
  a: SiteAsset,
  local?: string,
): Promise<void> {
  const id = itemId(a.url);
  const file = path.join(
    "stills",
    `${id}${path.extname(new URL(a.url).pathname) || ".jpg"}`,
  );
  if (lib.items.some((i) => i.sourceUrl === a.url)) return;
  if (local) await fs.copyFile(local, path.join(dir, file));
  else if (!(await download(a.url, path.join(dir, file)))) return;
  const ok = await addStill(
    lib,
    dir,
    file,
    a.url,
    `Official ${a.publisher} screenshot "${a.name}" from the publisher's own site (${a.listedAt})`,
    a.publisher,
    a.tags,
  );
  if (ok) console.log(`  still ${a.name}`);
}

async function siteVideo(
  lib: GameLibrary,
  dir: string,
  a: SiteAsset,
  name: string,
  local?: string,
): Promise<void> {
  if (lib.items.some((i) => i.sourceUrl === a.url)) return;
  const id = itemId(a.url);
  const raw = local ?? path.join(dir, "videos", `${id}.raw`);
  if (!local) {
    const head = await fetchWithTimeout(
      a.url,
      { method: "HEAD", headers: { "user-agent": "Mozilla/5.0" } },
      30_000,
    ).catch(() => undefined);
    if (!head?.ok) return console.log(`  not on the site: ${name}`);
    if (!(await download(a.url, raw))) return;
  }
  const file = path.join("videos", `${id}.mp4`);
  const ok = await proxyVideo(raw, path.join(dir, file));
  if (!local) await fs.rm(raw, { force: true });
  if (!ok) return;
  lib.items.push({
    id,
    kind: "video",
    file,
    sourceUrl: a.url,
    provenance: `Official ${a.tags.includes("trailer") ? "trailer" : "video"} "${name}" from ${a.publisher}'s own site (${a.listedAt})`,
    source: a.publisher,
    named: a.tags,
    tags: [],
    seen: "",
    durationSeconds: await videoSeconds(path.join(dir, file)),
    addedAt: new Date().toISOString(),
  });
  console.log(`  video ${name}`);
}

async function sitePack(
  lib: GameLibrary,
  dir: string,
  a: SiteAsset,
): Promise<void> {
  const work = path.join(dir, "pack_work");
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const zip = path.join(work, "pack.zip");
  if (!(await download(a.url, zip))) return;
  await exec(TAR, ["-xf", zip, "-C", work], { maxBuffer: 16 * 1024 * 1024 });
  const walk = async (d: string): Promise<string[]> =>
    (
      await Promise.all(
        (await fs.readdir(d, { withFileTypes: true })).map((e) =>
          e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
        ),
      )
    ).flat();
  for (const f of await walk(work)) {
    const rel = path.relative(work, f).split(path.sep);
    const name = nameOf(f);
    // The pack's own folders say what each shows: People/Jason Duval, Places/Vice City.
    const folder = rel.length > 1 ? rel[rel.length - 2]! : "";
    const tags = [
      ...new Set(
        [folder, a.tags[0] ?? ""].filter(
          (t) => t && !/^(people|places|gtavi.*)$/i.test(t),
        ),
      ),
    ];
    const url = `${a.url}#${rel.join("/")}`;
    if (/\.(jpe?g|png|webp)$/i.test(f))
      await siteStill(lib, dir, { ...a, kind: "still", url, name, tags }, f);
    else if (/\.mp4$/i.test(f) && !/cover[ _]art/i.test(f))
      await siteVideo(
        lib,
        dir,
        {
          ...a,
          kind: "video",
          url,
          name,
          tags: [...tags, name.replace(/ Video Clip$/i, "")],
        },
        name,
        f,
      );
  }
  await fs.rm(work, { recursive: true, force: true });
}

async function fetchIgdb(
  lib: GameLibrary,
  dir: string,
  game: string,
): Promise<void> {
  const g = await findIgdbGame(
    {
      clientId: process.env.TWITCH_CLIENT_ID ?? "",
      secret: process.env.TWITCH_CLIENT_SECRET ?? "",
    },
    game,
  ).catch(() => undefined);
  if (!g) return console.log("IGDB: no match");
  let n = 0;
  for (const id of [...g.screenshots, ...g.artworks]) {
    const url = `https://images.igdb.com/igdb/image/upload/t_1080p/${id}.jpg`;
    const file = path.join("stills", `igdb-${id}.jpg`);
    if (lib.items.some((i) => i.sourceUrl === url)) continue;
    if (!(await download(url, path.join(dir, file)))) continue;
    if (
      await addStill(
        lib,
        dir,
        file,
        url,
        `IGDB ${g.screenshots.includes(id) ? "screenshot" : "key art"} for "${g.name}"${g.year ? ` (${g.year})` : ""}, publisher material via igdb.com`,
        "IGDB",
        [],
      )
    )
      n++;
  }
  console.log(`IGDB: ${n} new of ${g.screenshots.length + g.artworks.length}`);
}

async function fetchSteam(
  lib: GameLibrary,
  dir: string,
  game: string,
): Promise<void> {
  const app = await findSteamApp(game).catch(() => undefined);
  if (!app) return console.log("Steam: not on Steam");
  let n = 0;
  for (const s of (app.details.screenshots ?? []) as Array<{
    path_full: string;
  }>) {
    const url = s.path_full.replace(/\?.*$/, "");
    const file = path.join("stills", `steam-${itemId(url)}.jpg`);
    if (lib.items.some((i) => i.sourceUrl === url)) continue;
    if (!(await download(url, path.join(dir, file)))) continue;
    if (
      await addStill(
        lib,
        dir,
        file,
        url,
        `Steam store screenshot for "${app.name}" (app ${app.appId}), publisher-supplied marketing art`,
        "Steam",
        [],
      )
    )
      n++;
  }
  console.log(`Steam: ${n} new`);
}

async function fetchOwn(
  lib: GameLibrary,
  dir: string,
  game: string,
  folder: string,
): Promise<void> {
  const files = recordingsOf(await libraryFiles(folder), game, game);
  for (const f of files) {
    const url = `own:${path.basename(f.file)}`;
    if (lib.items.some((i) => i.sourceUrl === url)) continue;
    const id = itemId(url);
    const file = path.join("videos", `own-${id}.mp4`);
    if (!(await proxyVideo(f.file, path.join(dir, file)))) continue;
    lib.items.push({
      id,
      kind: "video",
      file,
      sourceUrl: url,
      provenance: `Pulse's own gameplay capture of ${game} (${path.basename(f.file)})`,
      source: "own",
      named: ["gameplay"],
      tags: [],
      seen: "",
      durationSeconds: await videoSeconds(path.join(dir, file)),
      addedAt: new Date().toISOString(),
    });
    console.log(`  own ${path.basename(f.file)}`);
  }
}

async function main(): Promise<void> {
  if (command === "queue-playthroughs") {
    const games = [game0, ...rest.filter((a) => !a.startsWith("--"))].filter(
      Boolean,
    ) as string[];
    let q = await readQueue(dataDir);
    for (const g of games)
      q = queueGame(
        q,
        gameplayIndexName(g),
        "gameplay index: a full no-commentary playthrough, downloaded once and kept (owner, 15 Nov 2026)",
        new Date(),
      );
    await writeQueue(dataDir, q);
    console.log(
      q.games
        .filter((g) => g.game.endsWith("(gameplay)"))
        .map((g) => g.game)
        .join("\n"),
    );
    return;
  }
  const game = game0;
  if (!game)
    throw new Error(
      'usage: gamelib.ts fetch|scenes|tag|stats|pick|queue-playthroughs "<game>" ...',
    );
  const lib = await load(game);
  const dir = libraryDir(root, game);
  await fs.mkdir(path.join(dir, "stills"), { recursive: true });
  const save = () => writeLibrary(root, lib);
  if (command === "fetch") {
    if (!flag("no-site")) await fetchSite(lib, dir, game);
    await save();
    if (!flag("no-igdb")) await fetchIgdb(lib, dir, game);
    if (!flag("no-steam")) await fetchSteam(lib, dir, game);
    if (flag("own")) await fetchOwn(lib, dir, game, flag("own")!);
    await save();
  } else if (command === "scenes") {
    for (const v of lib.items.filter((i) => i.kind === "video" && !i.scenes)) {
      const file = path.join(dir, v.file);
      const total = await videoSeconds(file);
      const own = v.source === "own";
      // A trailer's first and last seconds are logos and the rating card; a recording is one continuous take.
      const scenes = own
        ? scenesFromCuts(await cutTimes(file, true), total, {
            min: 3,
            max: 6,
            skipHead: 5,
            skipTail: 5,
          }).filter((_, k) => k % 3 === 0)
        : scenesFromCuts(await cutTimes(file), total, {
            skipHead: 2,
            skipTail:
              v.tags.includes("trailer") || v.named.includes("trailer") ? 8 : 1,
          });
      v.scenes = scenes.map((s) => ({ ...s, tags: [], seen: "" }));
      console.log(`${v.provenance.slice(0, 70)}: ${v.scenes.length} scenes`);
      await save();
    }
  } else if (command === "tag") {
    const limit = Number(flag("limit") ?? 100000);
    const work = path.join(dir, "tag_work");
    await fs.mkdir(work, { recursive: true });
    let done = 0;
    let fails = 0;
    for (const item of lib.items) {
      if (done >= limit || fails >= 5) break;
      if (item.kind === "still" && !item.seen && !item.unusable) {
        const t = await tagPicture(
          path.join(dir, item.file),
          lib.game,
          item.named,
        ).catch((e) => (fails++, console.log(errorMessage(e)), undefined));
        if (!t) continue;
        fails = 0;
        Object.assign(item, {
          tags: t.tags,
          seen: t.seen || "-",
          ...(t.unusable ? { unusable: t.unusable } : {}),
        });
        done++;
      }
      for (const sc of item.scenes ?? []) {
        if (done >= limit || fails >= 5) break;
        if (sc.seen) continue;
        const frame = path.join(work, "f.jpg");
        if (
          !(await grabFrame(
            path.join(dir, item.file),
            (sc.at + sc.end) / 2,
            frame,
          ))
        ) {
          sc.seen = "-";
          continue;
        }
        const t = await tagPicture(frame, lib.game, item.named).catch(
          (e) => (fails++, console.log(errorMessage(e)), undefined),
        );
        if (!t) continue;
        fails = 0;
        sc.tags = t.unusable ? [] : t.tags;
        sc.seen = t.unusable ? `unusable: ${t.unusable}` : t.seen || "-";
        done++;
      }
      if (done && done % 25 === 0) await save();
    }
    await save();
    await fs.rm(work, { recursive: true, force: true });
    console.log(
      `tagged ${done}${fails >= 5 ? " (stopped: the vision model is not answering)" : ""}`,
    );
  } else if (command === "stats") {
    const stills = lib.items.filter((i) => i.kind === "still");
    const videos = lib.items.filter((i) => i.kind === "video");
    const scenes = videos.flatMap((v) => v.scenes ?? []);
    const count = new Map<string, number>();
    for (const t of [
      ...stills.flatMap((s) => s.tags),
      ...scenes.flatMap((s) => s.tags),
    ])
      count.set(t, (count.get(t) ?? 0) + 1);
    console.log(
      JSON.stringify(
        {
          game: lib.game,
          stills: stills.length,
          stillsTagged: stills.filter((s) => s.seen).length,
          unusable: stills.filter((s) => s.unusable).length,
          videos: videos.length,
          scenes: scenes.length,
          scenesTagged: scenes.filter((s) => s.seen).length,
          bySource: Object.fromEntries(
            [...new Set(lib.items.map((i) => i.source))].map((s) => [
              s,
              lib.items.filter((i) => i.source === s).length,
            ]),
          ),
          tags: Object.fromEntries(
            [...count.entries()].sort((a, b) => b[1] - a[1]),
          ),
        },
        null,
        1,
      ),
    );
  } else if (command === "pick") {
    const sentence = rest.find((a) => !a.startsWith("--")) ?? "";
    const picks = pickForLines(
      new Map([[lib.game, lib]]),
      [
        {
          key: "beat:0",
          sentence,
          game: lib.game,
          tags: tagsForSentence(
            sentence,
            (flag("keywords") ?? "").split(",").filter(Boolean),
          ),
          names: [],
        },
      ],
      { preferVideo: true, stillsToo: true },
    );
    for (const p of picks)
      console.log(
        p.score.toFixed(2),
        p.item.kind,
        p.scene
          ? `${p.scene.at}s ${p.scene.seen} [${p.scene.tags}]`
          : `${p.item.seen} [${p.item.tags}]`,
        p.item.file,
      );
  } else throw new Error(`unknown command ${command}`);
}

await main();
