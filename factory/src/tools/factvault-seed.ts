// Seeds the Pulse Fact Vault for the channel's top 100 games (14 Nov 2026), into a scratch database, and writes the
// seed file the factory loads the first time FACT_VAULT is switched on (factvault/seed.json.gz). Per game: Steam's
// store data (price, PC date, developer, publisher, Metacritic), then the game's Wikipedia page read for its
// citations only, each cited claim checked in the cited source's own text and stored against that source. No model
// is called and nothing touches the factory's own database.
//
//   node --import tsx src/tools/factvault-seed.ts <scratch-db-dir> <out-dir> [--only "Game A,Game B"] [--fetch 14]

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createEmbeddedDb, migrate } from "../db.ts";
import { findSteamApp, steamFacts } from "../assets/steam.ts";
import {
  fetchWikiHtml,
  parseCitedPage,
  type WikiRef,
} from "../discovery/wikirefs.ts";
import {
  harvestReviews,
  reviewTable,
  harvestCited,
  harvestSteam,
  readPage,
  type PageReader,
} from "../factvault/harvest.ts";
import { FactVault } from "../factvault/store.ts";
import { SEED_GAMES } from "../factvault/seedlist.ts";

const [dbDir, outDir] = process.argv.slice(2);
if (!dbDir || !outDir) {
  console.error(
    "usage: factvault-seed.ts <scratch-db-dir> <out-dir> [--only a,b] [--fetch n]",
  );
  process.exit(1);
}
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = flag("--only")
  ?.split(",")
  .map((s) => s.trim().toLowerCase());
const maxFetch = Number(flag("--fetch") ?? 14);
const concurrency = Number(flag("--concurrency") ?? 5);

fs.mkdirSync(outDir, { recursive: true });
const db = await createEmbeddedDb(dbDir);
await migrate(db);
const vault = new FactVault(db);

// Pages read once per run (two games citing one review share it), and a log of what each read returned.
const cache = new Map<string, ReturnType<PageReader>>();
const reads: Array<{ url: string; ok: boolean; chars: number }> = [];
const read: PageReader = (url) => {
  if (!cache.has(url))
    cache.set(
      url,
      readPage(url).then((p) => {
        reads.push({ url, ok: !!p, chars: p?.text.length ?? 0 });
        return p;
      }),
    );
  return cache.get(url)!;
};

interface GameReport {
  game: string;
  steam: number;
  wiki?: string;
  refs: number;
  candidates: number;
  fetched: number;
  verified: number;
  stored: number;
  reviews?: number;
  reviewsRead?: number;
  error?: string;
}
const reports: GameReport[] = [];

async function seedGame(g: (typeof SEED_GAMES)[number]): Promise<void> {
  const r: GameReport = {
    game: g.name,
    steam: 0,
    refs: 0,
    candidates: 0,
    fetched: 0,
    verified: 0,
    stored: 0,
  };
  try {
    if (g.steam !== false) {
      const app = await findSteamApp(g.steam ?? g.name).catch(() => undefined);
      if (app) {
        const facts = await steamFacts(app);
        r.steam = await harvestSteam(
          vault,
          g.name,
          facts,
          { ...app.details, steam_appid: app.appId },
          { origin: "seed" },
        );
      }
    }
    const page = await fetchWikiHtml(g.wiki ?? g.name).catch(() => undefined);
    if (page) {
      const { extract, refs } = parseCitedPage(page.html);
      const list: WikiRef[] = [...refs.entries()].map(([n, ref]) => ({
        ...ref,
        n,
      }));
      r.wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
      r.refs = list.length;
      const h = await harvestCited(
        vault,
        { name: g.name, aliases: g.aliases },
        { url: r.wiki, text: extract, refs: list },
        read,
        { maxFetch, origin: "seed" },
      );
      Object.assign(r, h);
      // The reception table's reviews, read at each outlet: scores and verdict sentences word for word.
      const rows = reviewTable(page.html);
      const rv = await harvestReviews(vault, g.name, rows, read, {
        max: 8,
        origin: "seed",
        discoveredVia: r.wiki,
      });
      r.reviews = rows.length;
      r.reviewsRead = rv.read;
      r.stored += rv.stored;
    }
  } catch (err) {
    r.error = String(err).slice(0, 300);
  }
  reports.push(r);
  console.log(
    `${g.name}: steam ${r.steam}, refs ${r.refs}, reviews ${r.reviewsRead ?? 0}/${r.reviews ?? 0}, fetched ${r.fetched}, verified ${r.verified}, stored ${r.stored}${r.error ? ` ERROR ${r.error}` : ""}`,
  );
}

const queue = SEED_GAMES.filter(
  (g) => !only || only.includes(g.name.toLowerCase()),
);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let g = queue.shift(); g; g = queue.shift()) await seedGame(g);
  }),
);

const stats = await vault.stats();
const data = await vault.exportAll();
fs.writeFileSync(
  path.join(outDir, "seed.json.gz"),
  zlib.gzipSync(JSON.stringify(data)),
);
fs.writeFileSync(
  path.join(outDir, "seed-report.json"),
  JSON.stringify(
    {
      stats,
      games: reports,
      reads: { total: reads.length, ok: reads.filter((x) => x.ok).length },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(stats, null, 2));
await db.close();
