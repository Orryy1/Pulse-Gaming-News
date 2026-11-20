// The new source harvesters by hand (src/sources, 20 Nov 2026). Network only, light work: no render, no GPU.
//   node --import tsx src/tools/sources.ts presskits "<game>"      harvest and index a game's press kit assets
//   node --import tsx src/tools/sources.ts presskit-library "<game>"   download the indexed stills into the game media
//        library (src/assets/gamelib.ts), credited and carrying their terms; packs are left to gamelib.ts fetch
//   node --import tsx src/tools/sources.ts achievements "<game>" [--appid=N] [--cards=N] [--out=<dir>] [--library]
//        the game's real Steam achievements, and Pulse's own cards for the rarest N (into the library with --library)
//   node --import tsx src/tools/sources.ts wikileads "<game>"      leads from the game's wiki, checked at their sources
//   node --import tsx src/tools/sources.ts terms                   every source's recorded terms and the TA/TT verdict
// Settings: DATA_DIR (or PRESS_KIT_DIR, WIKI_LEADS_DIR, GAME_LIBRARY_DIR), STEAM_API_KEY (optional).
import fs from "node:fs/promises";
import path from "node:path";
import {
  harvestPressKits,
  pressKitRoot,
  PRESS_KIT_SOURCES,
  readPressIndex,
  writePressIndex,
} from "../sources/presskits.ts";
import {
  cardProvenance,
  PLATFORM_SOURCES,
  renderAchievementCard,
  steamAchievements,
  TA_TT_VERDICT,
} from "../sources/achievementart.ts";
import {
  findWikiLeads,
  wikiLeadsRoot,
  writeWikiLeads,
} from "../sources/wikileads.ts";
import { politeFetcher } from "../sources/polite.ts";
import { findSteamApp } from "../assets/steam.ts";
import { rarest } from "../discovery/achievements.ts";
import {
  addPressKitStills,
  addAchievementCards,
} from "../sources/librarysources.ts";
import { libraryRoot } from "../assets/gamelib.ts";

const [command, game = "", ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const dataDir = process.env.DATA_DIR || "data";

async function main() {
  if (command === "presskits") {
    const idx = await writePressIndex(
      pressKitRoot(dataDir),
      await harvestPressKits(game),
    );
    console.log(`${idx.game}: ${idx.assets.length} press kit assets`);
    for (const s of idx.sources)
      console.log(
        `  ${s.id.padEnd(15)} ${s.status.padEnd(8)} ${s.count}${s.note ? `  (${s.note.slice(0, 110)})` : ""}`,
      );
    const byKind = new Map<string, number>();
    for (const a of idx.assets)
      byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    console.log(
      `  kinds: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
    );
    for (const a of idx.assets.slice(0, 12))
      console.log(
        `  - [${a.kind}] ${a.publisher}: ${a.title.slice(0, 70)} :: ${a.url}`,
      );
    return;
  }
  if (command === "presskit-library") {
    const idx = await readPressIndex(pressKitRoot(dataDir), game);
    if (!idx) return console.log("no press kit index: run presskits first");
    const { added, marked } = await addPressKitStills(
      libraryRoot(dataDir),
      idx,
      politeFetcher(),
    );
    console.log(`${idx.game}: ${added} press kit stills added to the game library, ${marked} library pictures marked as the kit's`);
    return;
  }
  if (command === "achievements") {
    const appId = Number(flag("appid")) || (await findSteamApp(game))?.appId;
    if (!appId) return console.log(`no Steam app for ${game}`);
    const { list, via } = await steamAchievements(appId, {
      apiKey: process.env.STEAM_API_KEY,
    });
    console.log(
      `${game} (app ${appId}): ${list.length} achievements via the ${via}${process.env.STEAM_API_KEY ? "" : " (no STEAM_API_KEY set)"}`,
    );
    const pick = rarest(list, Number(flag("cards") ?? 3));
    const out = flag("out") ?? path.join(dataDir, "achievementcards");
    const cards: Array<{ file: string; name: string; provenance: string }> = [];
    for (const a of pick) {
      console.log(
        `  ${a.percent}%  ${a.name}: ${a.hidden ? "(hidden)" : a.description}`,
      );
      if (!a.icon) continue;
      const slug = `${appId}_${a.apiName.replace(/[^a-z0-9]+/gi, "_")}`;
      const icon = path.join(out, `${slug}_icon.jpg`);
      const res = await fetch(a.icon);
      if (!res.ok) continue;
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(icon, Buffer.from(await res.arrayBuffer()));
      const file = path.join(out, `${slug}_card.jpg`);
      if (await renderAchievementCard(a, game, icon, file)) {
        console.log(`    card: ${file}`);
        cards.push({
          file,
          name: a.name,
          provenance: cardProvenance(a, game, appId, via),
        });
      }
    }
    if (flag("library"))
      console.log(
        `  added to the library: ${await addAchievementCards(libraryRoot(dataDir), game, cards)}`,
      );
    return;
  }
  if (command === "wikileads") {
    const f = await findWikiLeads(game);
    await writeWikiLeads(wikiLeadsRoot(dataDir), f);
    const count = (s: string) => f.leads.filter((l) => l.status === s).length;
    console.log(
      `${f.game}: ${f.leads.length} leads from ${f.wiki} (verified ${count("verified")}, unverified ${count("unverified")}, unsourced ${count("unsourced")}, speculative ${count("speculative")})`,
    );
    for (const l of f.leads.filter((x) => x.status === "verified"))
      console.log(
        `  [${l.kind}] ${l.text}\n      checked against: ${l.primary!.url} (found: ${l.primary!.matched.join(", ")})`,
      );
    return;
  }
  if (command === "terms") {
    for (const s of PRESS_KIT_SOURCES)
      console.log(
        `${s.id.padEnd(15)} ${s.access.padEnd(13)} ${s.terms.allowedUse.padEnd(9)} ${s.terms.url}\n    ${s.terms.summary}${s.terms.quote ? `\n    "${s.terms.quote}"` : ""}`,
      );
    console.log("\nAchievement data:");
    for (const p of PLATFORM_SOURCES)
      console.log(
        `  ${p.platform}: ${p.source} (${p.fetched ? "used" : "not used"})`,
      );
    console.log(
      `\nTrueAchievements / TrueTrophies (checked ${TA_TT_VERDICT.checked}): ${TA_TT_VERDICT.use ? "used" : "not used"}\n  ${TA_TT_VERDICT.why}`,
    );
    for (const t of TA_TT_VERDICT.terms)
      for (const q of t.quotes) console.log(`  ${t.site}: "${q}" (${t.url})`);
    return;
  }
  console.log(
    'usage: sources.ts presskits|presskit-library|achievements|wikileads|terms "<game>"',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
