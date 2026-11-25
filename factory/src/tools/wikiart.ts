// The wiki art library by hand (src/wikiart/). On the PC, wrap crawls in an orchestrator turn:
//   C:\Claude\orchestrator\orch.cmd run --class cpu --project pulse --job "wiki art crawl" --priority 20 --est 120 -- ^
//     node --import tsx src/tools/wikiart.ts crawl --minutes=110
//
//   node --import tsx src/tools/wikiart.ts crawl [--games="A;B"] [--minutes=110] [--slice=25]
//        the roster (src/wikiart/roster.ts) in order, each game for at most --slice minutes a pass, resuming where it
//        stopped; GTA VI first. Stops at --minutes or the disk cap (WIKIART_MAX_GB, default 40)
//   node --import tsx src/tools/wikiart.ts want "<game>" "<name>" ["<name>" ...]   look these names up now
//   node --import tsx src/tools/wikiart.ts lookup "<game>" "<name>"                 what lookupArt answers
//   node --import tsx src/tools/wikiart.ts sheet "<game>" --out=<file.jpg> "<name>" ...   a contact sheet of lookups
//   node --import tsx src/tools/wikiart.ts stats                                     games, counts and disk used
//   node --import tsx src/tools/wikiart.ts import-drop [--dir=<folder>]   the owner's drop folder into the library
//        (WIKIART_DROP_DIR, default D:\pulse-data\wikiart-drop; see src/wikiart/drop.ts)
// Settings: WIKIART_DIR (default D:\pulse-data\wikiart on the PC), WIKIART_GAP_MS (1500), WIKIART_MAX_GB (40),
// WIKIART_MAX_PAGES (4000 articles per game per run).

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { canonicalGame } from "../assets/gamelib.ts";
import { crawlGame, verifyWiki, type CrawlReport } from "../wikiart/crawl.ts";
import { PoliteClient } from "../wikiart/http.ts";
import { lookupArt } from "../wikiart/lookup.ts";
import { ROSTER } from "../wikiart/roster.ts";
import {
  capBytes,
  diskUsage,
  logRejected,
  readIndex,
  readState,
  wikiartRoot,
  writeIndex,
  writeState,
} from "../wikiart/store.ts";

const exec = promisify(execFile);
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const args = rest.filter((a) => !a.startsWith("--"));
const root = wikiartRoot();

async function logRun(r: CrawlReport, started: number): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.appendFile(
    path.join(root, "crawl-log.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), ...r })}\n`,
    "utf8",
  );
}

async function stats(): Promise<void> {
  const rows: string[] = [];
  let entities = 0;
  let images = 0;
  for (const d of await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => [])) {
    if (!d.isDirectory()) continue;
    const idx = JSON.parse(
      await fs
        .readFile(path.join(root, d.name, "index.json"), "utf8")
        .catch(() => "null"),
    );
    if (!idx) continue;
    entities += idx.entities.length;
    images += idx.images.length;
    const st = await readState(root, idx.game);
    const rejected = Object.values(st.files).filter((v) =>
      v.startsWith("rejected"),
    ).length;
    rows.push(
      `${idx.game}: ${idx.entities.length} named things, ${idx.images.length} pictures, ${rejected} files turned down, ${Object.values(st.pages).reduce((n, p) => n + p.length, 0)} articles visited`,
    );
  }
  const used = await diskUsage(root);
  console.log(rows.join("\n"));
  console.log(
    `total: ${rows.length} games, ${entities} named things, ${images} pictures, ${(used / 1e9).toFixed(2)} GB of ${(capBytes() / 1e9).toFixed(0)} GB`,
  );
}

/** A labelled contact sheet of what lookupArt answers for each name (ffmpeg, no extra packages). */
async function sheet(
  game: string,
  names: string[],
  out: string,
): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "wikiart-sheet-"));
  const font =
    process.platform === "win32"
      ? "C\\:/Windows/Fonts/arial.ttf"
      : "/System/Library/Fonts/Supplemental/Arial.ttf";
  let n = 0;
  const lines: string[] = [];
  for (const name of names) {
    const hit = await lookupArt(game, name);
    if (!hit?.file) {
      lines.push(`MISSING  ${name}`);
      continue;
    }
    const label = path.join(work, `l${n}.txt`);
    await fs.writeFile(
      label,
      `${name}  ->  ${hit.name}\n${hit.kind} (${hit.origin}), ${hit.width}x${hit.height}\n${hit.credit}`,
      "utf8",
    );
    const labelArg = label.replace(/\\/g, "/").replace(/:/g, "\\:");
    await exec(FFMPEG, [
      "-y",
      "-v",
      "error",
      "-i",
      hit.file,
      "-frames:v",
      "1",
      // Transparent pictures (logos, cut-out artwork) are laid on a grey card, never flattened blindly.
      "-filter_complex",
      `color=c=0x202020:s=560x340[bg];[0:v]scale=560:340:force_original_aspect_ratio=decrease,format=rgba[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,pad=560:420:0:0:color=0x101010,drawtext=fontfile='${font}':textfile='${labelArg}':x=10:y=348:fontsize=17:fontcolor=white:line_spacing=4,format=rgb24`,
      path.join(work, `c${String(n).padStart(3, "0")}.png`),
    ]);
    lines.push(
      `ok       ${name} -> ${hit.name} | ${hit.kind}/${hit.origin} | ${hit.filePage}`,
    );
    n++;
  }
  if (!n) throw new Error("nothing to show");
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await exec(FFMPEG, [
    "-y",
    "-v",
    "error",
    "-framerate",
    "1",
    "-i",
    path.join(work, "c%03d.png"),
    "-vf",
    `tile=${cols}x${rows}:padding=6:color=0x000000`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
  await fs.rm(work, { recursive: true, force: true });
  console.log(lines.join("\n"));
  console.log(`sheet: ${out} (${n} of ${names.length})`);
}

/** Takes the library's write lock (created atomically; a lock left by a process that has gone is taken over). */
async function takeLock(): Promise<boolean> {
  const lock = path.join(root, "write.lock");
  await fs.mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const h = await fs.open(lock, "wx");
      await h.writeFile(String(process.pid), "utf8");
      await h.close();
      process.on("exit", () => {
        try {
          if (Number(fsSync.readFileSync(lock, "utf8")) === process.pid)
            fsSync.rmSync(lock, { force: true });
        } catch {
          /* a stale lock is taken over by the next run */
        }
      });
      return true;
    } catch {
      const held = Number(await fs.readFile(lock, "utf8").catch(() => "0"));
      let alive = false;
      try {
        if (held) (process.kill(held, 0), (alive = true));
      } catch {
        alive = false;
      }
      if (alive) {
        console.log(
          `the wiki art library is being written by pid ${held}; try again when it finishes`,
        );
        return false;
      }
      await fs.rm(lock, { force: true });
    }
  }
  return false;
}

async function main(): Promise<void> {
  const client = new PoliteClient();
  // Everything that writes the library takes the one lock (two scheduled turns can meet when the first waited long
  // for its turn, and a "want" or "reject" by hand must not race a crawl's in-memory copy).
  if (
    ["crawl", "want", "reject", "import-library", "import-drop"].includes(
      command ?? "",
    ) &&
    !(await takeLock())
  )
    return;
  if (command === "crawl") {
    // The publisher's own named stills first (no web), inside the same lock and orchestrator turn.
    if (flag("import")) {
      const { importLibrary } = await import("../wikiart/libimport.ts");
      for (const g of flag("import")!
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean))
        await importLibrary(root, g).catch((e) =>
          console.log(`import ${g}: ${e instanceof Error ? e.message : e}`),
        );
    }
    const games = flag("games")
      ? flag("games")!
          .split(";")
          .map((g) => g.trim())
          .filter(Boolean)
      : ROSTER;
    const end = Date.now() + Number(flag("minutes") ?? 110) * 60_000;
    const slice = Number(flag("slice") ?? 25) * 60_000;
    // Games least recently crawled go first after GTA VI, so every pass moves the whole roster on.
    const order: Array<{ game: string; last: string }> = [];
    for (const g of games)
      order.push({
        game: g,
        last: (await readState(root, canonicalGame(g))).lastRun ?? "",
      });
    const [first, ...others] = order;
    others.sort((a, b) => a.last.localeCompare(b.last));
    for (const { game } of [first!, ...others]) {
      if (Date.now() > end - 60_000) break;
      if ((await diskUsage(root)) > capBytes()) {
        console.log(
          `disk cap reached (${(capBytes() / 1e9).toFixed(0)} GB): stopping`,
        );
        break;
      }
      const started = Date.now();
      const r = await crawlGame(client, game, {
        root,
        deadline: Math.min(end, started + slice),
      });
      await logRun(r, started);
      console.log(
        `${r.game}: ${r.pages} articles, ${r.kept} kept, ${r.rejected} turned down, ${r.duplicates} repeats${r.stopped ? ` (stopped: ${r.stopped})` : ""}`,
      );
    }
    console.log(
      `requests by site: ${[...client.counts].map(([h, c]) => `${h} ${c}`).join(", ")}`,
    );
    await stats();
    return;
  }
  if (command === "want") {
    const [game, ...names] = args;
    if (!game || !names.length)
      throw new Error('usage: wikiart.ts want "<game>" "<name>" ...');
    const title = canonicalGame(game);
    const st = await readState(root, title);
    st.wanted = [...new Set([...st.wanted, ...names])];
    await writeState(root, title, st);
    const started = Date.now();
    const r = await crawlGame(client, title, {
      root,
      deadline: Date.now() + Number(flag("minutes") ?? 20) * 60_000,
      wanted: names,
      wantedOnly: true,
    });
    await logRun(r, started);
    console.log(
      `found: ${r.found.join("; ") || "none"}\nnot on the wiki: ${r.missing.join("; ") || "none"}\n${r.kept} pictures kept, ${r.rejected} turned down`,
    );
    return;
  }
  if (command === "lookup") {
    const [game, name] = args;
    console.log(
      JSON.stringify((await lookupArt(game!, name!)) ?? null, null, 1),
    );
    return;
  }
  if (command === "sheet") {
    const [game, ...names] = args;
    await sheet(
      game!,
      names,
      flag("out") ?? path.join(root, "sheets", `${canonicalGame(game!)}.jpg`),
    );
    return;
  }
  if (command === "stats") return stats();
  if (command === "check") {
    // Whether wikis can be used (answers, robots.txt allows the API, pictures are served): check <api url> ...
    for (const api of args) {
      const u = new URL(api);
      const ok = await verifyWiki(
        client,
        {
          id: u.host,
          name: u.host,
          api,
          articles: `${u.origin}/wiki/`,
          scope: "franchise",
        },
        u.host,
        false,
        (l) => console.log(l),
      );
      console.log(`${ok ? "USABLE " : "no     "} ${api}`);
    }
    return;
  }
  if (command === "reject") {
    // A picture a person turned down on review (a watermark, fan work the file page did not admit): out of the index
    // and its file deleted, and remembered so no later crawl brings it back. reject "<game>" <image id> "<why>"
    const [game, id, why = "turned down on review"] = args;
    const title = canonicalGame(game!);
    const idx = await readIndex(root, title);
    const img = idx?.images.find((i) => i.id === id);
    if (!idx || !img) throw new Error(`no picture ${id} in ${title}`);
    idx.images = idx.images.filter((i) => i.id !== id);
    for (const e of idx.entities) e.images = e.images.filter((x) => x !== id);
    idx.entities = idx.entities.filter((e) => e.images.length);
    await writeIndex(root, idx);
    await fs.rm(path.join(root, idx.slug, img.file), { force: true });
    const st = await readState(root, title);
    for (const k of Object.keys(st.files))
      if (st.files[k] === `kept:${id}` || st.files[k] === `dup:${id}`)
        st.files[k] = `rejected:${why}`;
    await writeState(root, title, st);
    await logRejected(root, title, {
      file: img.fileTitle,
      why,
      page: img.filePage,
      review: true,
    });
    console.log(`rejected ${img.fileTitle}: ${why}`);
    return;
  }
  if (command === "import-drop") {
    // The owner's drop folder (src/wikiart/drop.ts): new and changed pictures in, removed ones out. Quick when
    // nothing changed; windows\wikiart-drop.cmd runs it every 30 minutes and wikiart-crawl.cmd before each crawl.
    const { DROP_README, dropRoot, importDrop, reportText } =
      await import("../wikiart/drop.ts");
    const dir = flag("dir") ?? dropRoot();
    await fs.mkdir(dir, { recursive: true });
    const readme = path.join(dir, "README.txt");
    if (!(await fs.stat(readme).catch(() => undefined)))
      await fs.writeFile(readme, DROP_README.replace(/\n/g, "\r\n"), "utf8");
    const r = await importDrop(root, dir);
    if (r.added.length || r.removed.length || r.turnedDown)
      await fs.writeFile(path.join(dir, "_report.txt"), reportText(r), "utf8");
    console.log(
      `drop folder: ${r.added.length} added, ${r.removed.length} removed, ${r.rejected.length} not used, ${r.unchanged} unchanged`,
    );
    return;
  }
  if (command === "import-library") {
    const { importLibrary } = await import("../wikiart/libimport.ts");
    await importLibrary(root, args[0]!);
    return;
  }
  if (command === "index") {
    const idx = await readIndex(root, canonicalGame(args[0]!));
    console.log(
      JSON.stringify(
        idx?.entities.map(
          (e) =>
            `${e.name} [${e.type}${e.ofGame ? "" : ", franchise"}] ${e.images.length} pics${e.aliases.length ? ` aka ${e.aliases.slice(0, 4).join(", ")}` : ""}`,
        ) ?? [],
        null,
        1,
      ),
    );
    return;
  }
  throw new Error(
    "usage: wikiart.ts crawl|want|lookup|sheet|stats|index|import-drop ...",
  );
}

await main();
