// The wiki art harvester: for one game, its wikis' articles about named things (characters, places, vehicles,
// brands, radio stations, items, logos) and the pictures on them, through the MediaWiki API only (categories,
// pageimages, redirects, imageinfo with extmetadata, and the file description page's wikitext for the licence).
// Every file goes through src/wikiart/classify.ts before it is downloaded: fan art, edits, cosplay, memes, leaks,
// AI pictures and real-world photos are turned down and logged. It resumes from state.json, stops at its deadline
// or the disk cap, and never makes more than one request per WIKIART_GAP_MS per site (src/wikiart/http.ts).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalGame } from "../assets/gamelib.ts";
import { errorMessage } from "../lib/util.ts";
import {
  classifyFile,
  templateGame,
  type ArtKind,
  type FileFacts,
} from "./classify.ts";
import { HostRested, PoliteClient, RobotsDenied } from "./http.ts";
import { normName } from "./lookup.ts";
import {
  capBytes,
  diskUsage,
  duplicateOf,
  emptyIndex,
  gameDir,
  imageId,
  logRejected,
  normalisePicture,
  pictureHash,
  readIndex,
  readState,
  writeIndex,
  writeState,
  type ArtEntity,
  type ArtImage,
  type ArtIndex,
  type CrawlState,
} from "./store.ts";
import {
  boringCategory,
  categoryOfGame,
  franchiseFor,
  guessWikis,
  rootCategoryCandidates,
  STRATEGYWIKI,
  type FranchiseRule,
  type Wiki,
} from "./wikis.ts";

export interface CrawlOptions {
  root: string;
  /** Stop starting new work after this time (ms since epoch). */
  deadline: number;
  /** Most pictures kept per entity (the lead picture counts). */
  perEntity?: number;
  /** Most articles handled per game per run. */
  maxPages?: number;
  /** Names to look up first (the narration's names: "Scooter Bros"). */
  wanted?: string[];
  /** Only the wanted names, no category walk. */
  wantedOnly?: boolean;
  log?: (line: string) => void;
}

export interface CrawlReport {
  game: string;
  wikis: string[];
  pages: number;
  kept: number;
  rejected: number;
  duplicates: number;
  found: string[];
  missing: string[];
  stopped?: string;
}

const strip = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every page of a query, following "continue", with the per-page lists merged (formatversion 2). */
export async function queryAll(
  client: PoliteClient,
  api: string,
  params: Record<string, string>,
  maxRounds = 40,
): Promise<{ pages: any[]; list: any[]; redirects: any[]; normalized: any[] }> {
  const pages = new Map<string, any>();
  const list: any[] = [];
  const redirects: any[] = [];
  const normalized: any[] = [];
  let cont: Record<string, string> = {};
  for (let round = 0; round < maxRounds; round++) {
    const json = await client.api(api, { ...params, ...cont });
    for (const p of json?.query?.pages ?? []) {
      const key = String(p.pageid ?? p.title);
      const had = pages.get(key);
      if (!had) pages.set(key, p);
      else
        for (const [k, v] of Object.entries(p)) {
          if (Array.isArray(v) && Array.isArray(had[k])) had[k].push(...v);
          else if (had[k] === undefined) had[k] = v;
        }
    }
    for (const k of ["categorymembers", "search", "allimages"])
      list.push(...(json?.query?.[k] ?? []));
    redirects.push(...(json?.query?.redirects ?? []));
    normalized.push(...(json?.query?.normalized ?? []));
    if (!json?.continue) break;
    const { continue: _c, ...rest } = json.continue;
    void _c;
    cont = { ...rest, continue: json.continue.continue };
  }
  return { pages: [...pages.values()], list, redirects, normalized };
}

/** What a page is about, from its categories (pure). */
export function entityType(categories: string[]): string {
  const c = categories.join(" | ").toLowerCase();
  if (/radio stations?\b|\bradio\b/.test(c)) return "radio";
  if (
    /\b(characters|people|protagonists|antagonists|npcs|bosses|members|families|residents)\b/.test(
      c,
    )
  )
    return "character";
  if (
    /\b(vehicles|cars|motorcycles|bikes|boats|aircraft|helicopters|planes|trucks|vans|bicycles|trains|mounts)\b/.test(
      c,
    )
  )
    return "vehicle";
  if (
    /\b(businesses|companies|brands|manufacturers|corporations|stores|shops|restaurants|bars|clubs|nightclubs|websites|products|newspapers|tv shows|television|channels|apps?)\b/.test(
      c,
    )
  )
    return "brand";
  if (
    /\b(gangs|organi[sz]ations|factions|groups|crews|cartels|agencies)\b/.test(
      c,
    )
  )
    return "group";
  if (
    /\b(locations|places|buildings|structures|neighbou?rhoods|districts|cities|towns|islands|regions|areas|landmarks|counties|states|safehouses|dungeons|temples|kingdoms|planets)\b/.test(
      c,
    )
  )
    return "place";
  if (
    /\b(weapons|items|equipment|collectibles|consumables|armou?r|clothing|tools|ammunition|materials)\b/.test(
      c,
    )
  )
    return "item";
  if (/\b(animals|creatures|enemies|monsters|species|wildlife)\b/.test(c))
    return "creature";
  if (/\b(games|titles)\b/.test(c)) return "game";
  return "thing";
}

/** Squashed lower-case letters and digits, for "does this file name carry the page's name" (pure). */
const squash = (s: string) => normName(s).replace(/ /g, "");

/** Whether a file is about the page's subject: its name carries the page's name (pure). */
export function fileAboutPage(fileTitle: string, pageTitle: string): boolean {
  const page = squash(pageTitle.replace(/\s*\([^)]*\)\s*$/, ""));
  if (page.length < 3) return false;
  const file = squash(
    fileTitle.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, ""),
  );
  const raw = fileTitle
    .replace(/^File:/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return file.includes(page) || raw.includes(page);
}

/**
 * The thing a gallery file names, from its file name (pure): "Artwork-JasonDuval-GTAVI.jpg" is "Jason Duval".
 * Game codes, picture words and numbers are dropped; CamelCase is split.
 */
export function nameFromFile(fileTitle: string, gameCodes: string[]): string {
  let s = fileTitle.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  for (const code of gameCodes)
    s = s.replace(
      new RegExp(
        `(^|[-_ ])${code.replace(/[^A-Za-z0-9]/g, "")}(?=$|[-_ ])`,
        "gi",
      ),
      " ",
    );
  s = s
    .replace(
      /(^|[-_ ])(artwork|official|screenshot|render|promo|trailer\d*|bg|background|logo|icon|front|rear|side|hd|original|v\d|\d+)(?=$|[-_ ])/gi,
      " ",
    )
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b(BG|and)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

const GALLERY =
  /\/(artwork|screenshots|gallery|images|renders|official art|promotional)$/i;

/** A page whose pictures each show something different, named by their file names (pure). */
export function isGallery(wiki: Pick<Wiki, "id">, pageTitle: string): boolean {
  return (
    GALLERY.test(pageTitle) ||
    (wiki.id === STRATEGYWIKI.id && pageTitle.includes("/"))
  );
}

/** A file title with the game's own names taken out ("Elden Ring Malenia.png" is "Malenia.png") (pure). */
export function withoutGameNames(fileTitle: string, names: string[]): string {
  let s = fileTitle;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (n.length < 3) continue;
    const re = new RegExp(
      n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s_]+/g, "[\\s_-]*"),
      "gi",
    );
    s = s.replace(re, " ");
  }
  return s;
}

/**
 * The short codes a franchise wiki files a game's pictures under (pure): the squashed names ("gtavi",
 * "ocarinaoftime") and, for names of three words or more, their initials with numerals kept whole ("oot", "botw",
 * "gtavi" from "Grand Theft Auto VI", never "gtav").
 */
export function gameCodes(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const words = n
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[:'’]/g, "")
      .split(/[\s-]+/)
      .filter(Boolean);
    const sq = words
      .join("")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (sq.length >= 3) out.add(sq);
    if (words.length >= 3) {
      const init = words
        .map((w) => (/^([ivx]+|\d+)$/i.test(w) ? w : w[0]!))
        .join("")
        .toLowerCase();
      if (init.length >= 3) out.add(init);
    }
  }
  return [...out];
}

const EDITION =
  /^(3d|hd|ns\d*|dx|remake|remastered|definitive|enhanced|se|ae)?$/i;

/** Whether a file is tied to this game by its name's tokens, its template's game field or its categories (pure). */
export function fileOfGame(
  fileTitle: string,
  codes: string[],
  tplGame: string | undefined,
  categories: string[],
  names: string[],
): boolean {
  const tokens = fileTitle
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .split(/[\s_.()-]+/)
    .concat(tplGame ? [tplGame.toLowerCase().replace(/[^a-z0-9]/g, "")] : []);
  const hit = (t: string) =>
    codes.some((c) => t.startsWith(c) && EDITION.test(t.slice(c.length)));
  return tokens.some(hit) || categories.some((c) => categoryOfGame(c, names));
}

/** Picture servers checked this run: true when they serve pictures to us. */
const pictureHosts = new Map<string, boolean>();

/** Whether a wiki can be used: it answers, robots.txt allows its API, and its picture server serves us (live). */
export async function verifyWiki(
  client: PoliteClient,
  wiki: Wiki,
  title: string,
  guessed: boolean,
  log: (l: string) => void,
): Promise<boolean> {
  try {
    if (
      !(await client.allowed(
        `${wiki.api}?action=query&meta=siteinfo&format=json`,
      ))
    ) {
      log(
        `  ${wiki.name}: robots.txt keeps generic agents off its API; skipped`,
      );
      return false;
    }
    const json = await client.api(wiki.api, { meta: "siteinfo" });
    const site = String(json?.query?.general?.sitename ?? "");
    if (!site) return false;
    if (guessed) {
      const want = normName(title.split(":")[0]!);
      if (!normName(site).includes(want)) {
        log(`  ${wiki.api}: "${site}" is not about ${title}; skipped`);
        return false;
      }
    }
    // One sample picture: a picture server that turns automated clients away (Fandom's Cloudflare challenge) makes
    // the wiki useless to us, and we do not try to get past a challenge.
    const sample = await client.api(wiki.fileApi ?? wiki.api, {
      generator: "allimages",
      gailimit: "1",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "320",
    });
    const ii = sample?.query?.pages?.[0]?.imageinfo?.[0];
    const url = String(ii?.thumburl ?? ii?.url ?? "");
    if (url) {
      const host = new URL(url).host;
      let ok = pictureHosts.get(host);
      if (ok === undefined) {
        try {
          const res = await client.get(url, "image/*");
          ok = res.ok && /^image\//.test(res.headers.get("content-type") ?? "");
          await res.body?.cancel().catch(() => undefined);
        } catch {
          ok = false;
        }
        pictureHosts.set(host, ok);
      }
      if (!ok) {
        log(
          `  ${wiki.name}: its picture server (${host}) turns automated clients away; skipped`,
        );
        return false;
      }
    }
    return true;
  } catch (err) {
    log(`  ${wiki.name}: ${errorMessage(err)}`);
    return false;
  }
}

/** The wikis that hold a game's art, checked live (each must answer and allow its API). */
export async function wikisFor(
  client: PoliteClient,
  title: string,
  log: (l: string) => void,
): Promise<Array<{ wiki: Wiki; rule?: FranchiseRule }>> {
  const rule = franchiseFor(title);
  const out: Array<{ wiki: Wiki; rule?: FranchiseRule }> = [];
  if (rule) {
    for (const w of [...(rule.alt ?? []), rule.wiki])
      if (await verifyWiki(client, w, title, false, log)) {
        out.push({ wiki: w, rule });
        break;
      }
  } else
    for (const w of guessWikis(title))
      if (await verifyWiki(client, w, title, true, log)) {
        out.push({ wiki: w });
        break;
      }
  // StrategyWiki for every game too: its box art and logo, and the named pictures on its subpages.
  if (await verifyWiki(client, STRATEGYWIKI, title, false, log))
    out.push({ wiki: STRATEGYWIKI });
  return out;
}

const SEED_CATEGORIES = [
  "Characters",
  "Locations",
  "Places",
  "Vehicles",
  "Weapons",
  "Items",
  "Bosses",
  "Enemies",
  "NPCs",
  "Factions",
  "Organizations",
  "Logos",
  "Maps",
  "Companies",
  "Brands",
  "Regions",
  "Areas",
];

/** The articles to visit for a game on one wiki, with whether each is in the game's own categories. */
async function articlesFor(
  client: PoliteClient,
  wiki: Wiki,
  title: string,
  rule: FranchiseRule | undefined,
  st: CrawlState,
  maxPages: number,
  log: (l: string) => void,
): Promise<{ articles: Map<string, boolean>; root?: string }> {
  const articles = new Map<string, boolean>();
  const names = rule ? rule.names(title) : [title, title.split(":")[0]!];
  let root: string | undefined;
  const seeds: Array<{
    cat: string;
    depth: number;
    ofGame: boolean;
    cap: number;
  }> = [];
  if (wiki.id === STRATEGYWIKI.id) {
    // The game's page and its subpages ("Grand Theft Auto V/Characters"), all of them this game's.
    const page = await client.api(wiki.api, {
      titles: title,
      redirects: "1",
      prop: "info",
    });
    const main = (page?.query?.pages ?? []).find(
      (p: any) => !p.missing && p.ns === 0,
    )?.title as string | undefined;
    if (!main) {
      log(`  ${wiki.name}: no page for ${title}`);
      return { articles };
    }
    articles.set(main, true);
    const subs = await queryAll(
      client,
      wiki.api,
      {
        list: "allpages",
        apprefix: `${main}/`,
        aplimit: "500",
        apnamespace: "0",
      },
      4,
    );
    for (const s of subs.list) articles.set(String(s.title), true);
    return { articles, root: main };
  }
  if (wiki.scope === "franchise") {
    const cands = rootCategoryCandidates(title, rule);
    const info = await client.api(wiki.api, {
      titles: cands.join("|"),
      prop: "categoryinfo",
    });
    const found = (info?.query?.pages ?? [])
      .filter((p: any) => p.categoryinfo && !p.missing)
      .sort(
        (a: any, b: any) =>
          (b.categoryinfo.size ?? 0) - (a.categoryinfo.size ?? 0),
      );
    root = found[0]?.title;
    if (root) seeds.push({ cat: root, depth: 3, ofGame: true, cap: maxPages });
    else
      log(
        `  ${wiki.name}: no category for ${title} (tried ${cands.join(", ")})`,
      );
    for (const c of rule?.shared ?? [])
      seeds.push({ cat: c, depth: 1, ofGame: false, cap: 600 });
  } else {
    root = "(whole wiki)";
    for (const c of SEED_CATEGORIES)
      seeds.push({
        cat: `Category:${c}`,
        depth: 2,
        ofGame: true,
        cap: maxPages,
      });
  }
  const walked = new Set(st.categories[wiki.id] ?? []);
  for (const seed of seeds) {
    const queue: Array<{ cat: string; depth: number }> = [
      { cat: seed.cat, depth: 0 },
    ];
    const seen = new Set<string>();
    let added = 0;
    while (queue.length && added < seed.cap && articles.size < maxPages * 2) {
      const { cat, depth } = queue.shift()!;
      if (seen.has(cat)) continue;
      seen.add(cat);
      let res;
      try {
        res = await queryAll(
          client,
          wiki.api,
          {
            list: "categorymembers",
            cmtitle: cat,
            cmlimit: "500",
            cmtype: "page|subcat",
            cmnamespace: "0|14",
          },
          10,
        );
      } catch (err) {
        if (err instanceof HostRested || err instanceof RobotsDenied) throw err;
        log(`  ${cat}: ${errorMessage(err)}`);
        continue;
      }
      walked.add(cat);
      for (const m of res.list) {
        if (m.ns === 14) {
          if (depth + 1 > seed.depth || boringCategory(m.title)) continue;
          // On a franchise wiki only the game's own subcategories ("Vehicles in GTA VI"), never "Vehicles in GTA V".
          if (
            wiki.scope === "franchise" &&
            seed.ofGame &&
            !categoryOfGame(m.title, names)
          )
            continue;
          queue.push({ cat: m.title, depth: depth + 1 });
        } else if (m.ns === 0) {
          if (!articles.has(m.title)) added++;
          articles.set(
            m.title,
            (articles.get(m.title) ?? false) || seed.ofGame,
          );
        }
      }
    }
  }
  st.categories[wiki.id] = [...walked];
  return { articles, ...(root ? { root } : {}) };
}

/** Finds the article for a wanted name: the exact title or a redirect, else a search hit whose title is that name. */
async function findArticle(
  client: PoliteClient,
  wiki: Wiki,
  name: string,
): Promise<string | undefined> {
  const direct = await client.api(wiki.api, {
    titles: name,
    redirects: "1",
    prop: "info",
  });
  const page = (direct?.query?.pages ?? []).find(
    (p: any) => !p.missing && p.ns === 0,
  );
  if (page) return page.title;
  const search = await client.api(wiki.api, {
    list: "search",
    srsearch: name,
    srnamespace: "0",
    srlimit: "8",
    srprop: "",
  });
  const want = normName(name);
  const hits: string[] = (search?.query?.search ?? []).map((s: any) =>
    String(s.title),
  );
  return hits.find((t) => normName(t) === want);
}

interface PageFacts {
  title: string;
  lead?: string;
  redirects: string[];
  categories: string[];
  images: string[];
}

async function pageFacts(
  client: PoliteClient,
  wiki: Wiki,
  titles: string[],
): Promise<PageFacts[]> {
  const res = await queryAll(client, wiki.api, {
    titles: titles.join("|"),
    prop: "pageimages|redirects|categories|images",
    piprop: "name",
    rdlimit: "max",
    cllimit: "max",
    clshow: "!hidden",
    imlimit: "max",
  });
  return res.pages
    .filter((p) => !p.missing && p.ns === 0)
    .map((p) => ({
      title: String(p.title),
      ...(p.pageimage ? { lead: `File:${p.pageimage}` } : {}),
      redirects: (p.redirects ?? []).map((r: any) => String(r.title)),
      categories: (p.categories ?? []).map((c: any) => String(c.title)),
      images: (p.images ?? []).map((i: any) => String(i.title)),
    }));
}

async function fileFacts(
  client: PoliteClient,
  wiki: Wiki,
  files: string[],
): Promise<
  Map<
    string,
    FileFacts & { url: string; thumb?: string; page: string; sha1?: string }
  >
> {
  // A shared file repository (Bulbagarden Archives) holds the file pages: their licence text and categories.
  const res = await queryAll(client, wiki.fileApi ?? wiki.api, {
    titles: files.join("|"),
    prop: "imageinfo|categories|revisions",
    iiprop: "url|size|mime|extmetadata|sha1",
    iiurlwidth: "1600",
    iiextmetadatafilter:
      "ImageDescription|Artist|Credit|LicenseShortName|UsageTerms",
    rvprop: "content",
    rvslots: "main",
    cllimit: "max",
  });
  const out = new Map<
    string,
    FileFacts & { url: string; thumb?: string; page: string; sha1?: string }
  >();
  for (const p of res.pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const meta = ii.extmetadata ?? {};
    const v = (k: string) => strip(String(meta[k]?.value ?? ""));
    out.set(String(p.title), {
      title: String(p.title),
      mime: String(ii.mime ?? ""),
      width: Number(ii.width ?? 0),
      height: Number(ii.height ?? 0),
      categories: (p.categories ?? []).map((c: any) => String(c.title)),
      wikitext: String(p.revisions?.[0]?.slots?.main?.content ?? ""),
      description: [
        v("ImageDescription"),
        v("Artist"),
        v("Credit"),
        v("UsageTerms"),
      ]
        .filter(Boolean)
        .join(" | "),
      licence: v("LicenseShortName"),
      url: String(ii.url ?? ""),
      ...(ii.thumburl && Number(ii.thumbwidth ?? 0) < Number(ii.width ?? 0)
        ? { thumb: String(ii.thumburl) }
        : {}),
      page: String(
        ii.descriptionurl ??
          `${wiki.articles}${encodeURIComponent(String(p.title).replace(/ /g, "_"))}`,
      ),
      ...(ii.sha1 ? { sha1: String(ii.sha1) } : {}),
    });
  }
  return out;
}

const KIND_WORD: Record<ArtKind, string> = {
  logo: "logo",
  sign: "in-game sign",
  boxart: "box art",
  artwork: "artwork",
  render: "official render",
  map: "map",
  screenshot: "screenshot",
  icon: "in-game icon",
};

/** Crawls one game; resumable, polite, stops at the deadline. */
export async function crawlGame(
  client: PoliteClient,
  game: string,
  o: CrawlOptions,
): Promise<CrawlReport> {
  const log = o.log ?? ((l: string) => console.log(l));
  const title = canonicalGame(game);
  const idx: ArtIndex = (await readIndex(o.root, title)) ?? emptyIndex(title);
  const st = await readState(o.root, title);
  const perEntity = o.perEntity ?? 6;
  const maxPages = o.maxPages ?? Number(process.env.WIKIART_MAX_PAGES ?? 4000);
  const report: CrawlReport = {
    game: title,
    wikis: [],
    pages: 0,
    kept: 0,
    rejected: 0,
    duplicates: 0,
    found: [],
    missing: [],
  };
  const dir = gameDir(o.root, title);
  await fs.mkdir(path.join(dir, "img"), { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wikiart-"));
  let used = await diskUsage(o.root);
  const cap = capBytes();
  const images = new Map(idx.images.map((i) => [i.id, i]));
  const wantedAll = [...new Set([...(o.wanted ?? []), ...st.wanted])];
  const save = async () => {
    await writeIndex(o.root, idx);
    await writeState(o.root, title, st);
  };
  try {
    const wikis = await wikisFor(client, title, log);
    if (!wikis.length) {
      log(`${title}: no wiki found that allows its API`);
      report.stopped = "no wiki";
      return report;
    }
    for (const { wiki, rule } of wikis) {
      report.wikis.push(wiki.name);
      const gameNames = rule ? rule.names(title) : [title];
      const codes = gameCodes([...gameNames, title]);
      // Words dropped from gallery file names when naming what they show.
      const fileCodes = [...codes, "GTAO", "GTAOnline", "HD"];
      const ofGameFile = (f: string, tplGame?: string, cats: string[] = []) =>
        wiki.scope === "game" || fileOfGame(f, codes, tplGame, cats, gameNames);
      const pagesDone = new Set(st.pages[wiki.id] ?? []);
      // 1. The wanted names, each to its article (exact title, redirect, or a search hit with that very name).
      const queue = new Map<string, { ofGame: boolean; alias?: string }>();
      // Not on StrategyWiki: it covers every game, so a bare name ("Vice City") finds another game's page there.
      for (const name of wiki.id === STRATEGYWIKI.id ? [] : wantedAll) {
        if (Date.now() > o.deadline) break;
        try {
          const t = await findArticle(client, wiki, name);
          if (t) {
            queue.set(t, { ofGame: false, alias: name });
            pagesDone.delete(t);
            st.wanted = st.wanted.filter((w) => w !== name);
          } else {
            st.missing[name] = new Date().toISOString();
            if (!report.missing.includes(name)) report.missing.push(name);
          }
        } catch (err) {
          if (err instanceof HostRested) throw err;
          log(`  ${name}: ${errorMessage(err)}`);
        }
      }
      // 2. The game's categories (and the franchise's shared ones).
      let root: string | undefined;
      if (!o.wantedOnly && Date.now() < o.deadline) {
        const found = await articlesFor(
          client,
          wiki,
          title,
          rule,
          st,
          maxPages,
          log,
        );
        root = found.root;
        for (const [t, ofGame] of found.articles)
          if (!queue.has(t)) queue.set(t, { ofGame });
          else if (ofGame) queue.get(t)!.ofGame = true;
      }
      const w = idx.wikis.find((x) => x.id === wiki.id);
      if (!w)
        idx.wikis.push({
          id: wiki.id,
          name: wiki.name,
          api: wiki.api,
          ...(root ? { root } : {}),
        });
      const todo = [...queue.entries()]
        .filter(([t]) => !pagesDone.has(t))
        .slice(0, maxPages);
      log(
        `${title} on ${wiki.name}: ${queue.size} articles, ${todo.length} to visit${root ? ` (from ${root})` : ""}`,
      );
      // The game's own article first, then the rest (game's own categories before franchise extras).
      todo.sort(
        (a, b) =>
          Number(gameNames.includes(b[0])) - Number(gameNames.includes(a[0])) ||
          Number(b[1].ofGame) - Number(a[1].ofGame),
      );
      for (let i = 0; i < todo.length; i += 25) {
        if (Date.now() > o.deadline) {
          report.stopped = "deadline";
          break;
        }
        if (used > cap) {
          report.stopped = `disk cap ${(cap / 1e9).toFixed(0)} GB`;
          break;
        }
        const batch = todo.slice(i, i + 25);
        let facts: PageFacts[];
        try {
          facts = await pageFacts(
            client,
            wiki,
            batch.map(([t]) => t),
          );
        } catch (err) {
          if (err instanceof HostRested || err instanceof RobotsDenied)
            throw err;
          log(`  pages: ${errorMessage(err)}`);
          continue;
        }
        // Which files each page wants: its lead picture, then pictures whose names carry the page's name; on a
        // gallery page ("Grand Theft Auto VI/Artwork"), every picture, named by its file name.
        const wantFiles = new Map<
          string,
          Array<{ page: PageFacts; lead: boolean; entityName: string }>
        >();
        const addWant = (
          file: string,
          page: PageFacts,
          lead: boolean,
          entityName: string,
        ) => {
          const list = wantFiles.get(file) ?? [];
          list.push({ page, lead, entityName });
          wantFiles.set(file, list);
        };
        for (const p of facts) {
          const gallery = isGallery(wiki, p.title);
          if (gallery) {
            // StrategyWiki's contents page carries the game's logo: that is the game's own entity.
            const contents = /\/Table of Contents$/i.test(p.title);
            for (const f of p.images.slice(0, 200))
              addWant(
                f,
                p,
                false,
                contents
                  ? title
                  : nameFromFile(
                      withoutGameNames(f, [title, ...gameNames]),
                      fileCodes,
                    ) || p.title.replace(/\/.*$/, ""),
              );
            continue;
          }
          if (p.lead) addWant(p.lead, p, true, p.title);
          // This game's own pictures of the thing first (a franchise page shows every game it appears in).
          for (const f of p.images
            .filter((f) => f !== p.lead && fileAboutPage(f, p.title))
            .sort((a, b) => Number(ofGameFile(b)) - Number(ofGameFile(a)))
            .slice(0, perEntity * 2))
            addWant(f, p, false, p.title);
        }
        const undecided = [...wantFiles.keys()].filter(
          (f) => !st.files[`${wiki.id}|${f}`],
        );
        const info: Awaited<ReturnType<typeof fileFacts>> = new Map();
        for (let j = 0; j < undecided.length; j += 40) {
          if (Date.now() > o.deadline) break;
          try {
            for (const [k, v] of await fileFacts(
              client,
              wiki,
              undecided.slice(j, j + 40),
            ))
              info.set(k, v);
          } catch (err) {
            if (err instanceof HostRested || err instanceof RobotsDenied)
              throw err;
            log(`  files: ${errorMessage(err)}`);
          }
        }
        for (const [file, uses] of wantFiles) {
          if (Date.now() > o.deadline || used > cap) break;
          const key = `${wiki.id}|${file}`;
          let decided = st.files[key];
          if (!decided) {
            const f = info.get(file);
            if (!f) continue;
            const v = classifyFile(f);
            if (!v.keep) {
              decided = `rejected:${v.why}`;
              report.rejected++;
              await logRejected(o.root, title, {
                wiki: wiki.id,
                file,
                why: v.why,
                page: f.page,
              });
            } else {
              const id = imageId(wiki.id, file);
              const src = f.thumb ?? f.url;
              let tmp = "";
              try {
                const res = await client.get(src, "image/*");
                if (!res.ok) throw new Error(`answered ${res.status}`);
                tmp = path.join(tmpDir, `${id}.src`);
                await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
                const alpha =
                  /png|gif|svg|webp/i.test(f.mime) &&
                  (v.kind === "logo" ||
                    v.kind === "icon" ||
                    v.kind === "sign" ||
                    v.kind === "render" ||
                    v.kind === "artwork");
                const out = await normalisePicture(
                  tmp,
                  path.join(dir, "img", id),
                  alpha,
                );
                if (!out) throw new Error("could not read the picture");
                const hash = await pictureHash(out.file);
                const entityName = uses[0]!.entityName;
                const ent = idx.entities.find(
                  (e) => normName(e.name) === normName(entityName),
                );
                const dup = duplicateOf(
                  hash,
                  f.sha1,
                  (ent?.images ?? [])
                    .map((x) => images.get(x))
                    .filter((x): x is ArtImage => !!x),
                  idx.images,
                );
                if (dup) {
                  await fs.rm(out.file, { force: true });
                  decided = `dup:${dup.id}`;
                  report.duplicates++;
                } else {
                  const img: ArtImage = {
                    id,
                    file: path
                      .relative(dir, out.file)
                      .split(path.sep)
                      .join("/"),
                    kind: v.kind!,
                    origin: v.origin!,
                    width: out.width,
                    height: out.height,
                    bytes: out.bytes,
                    ...(hash ? { dhash: hash } : {}),
                    ...(f.sha1 ? { sha1: f.sha1 } : {}),
                    wiki: wiki.name,
                    filePage: f.page,
                    fileUrl: f.url,
                    fileTitle: file,
                    licence: v.licence ?? "",
                    forGame: ofGameFile(
                      file,
                      templateGame(f.wikitext),
                      f.categories,
                    ),
                    // A picture filed under another game of the series is credited without this game's name.
                    credit: ofGameFile(
                      file,
                      templateGame(f.wikitext),
                      f.categories,
                    )
                      ? `${title} ${KIND_WORD[v.kind!]}, via ${wiki.name}`
                      : `Official ${KIND_WORD[v.kind!]}${templateGame(f.wikitext) ? ` (${templateGame(f.wikitext)})` : ""}, via ${wiki.name}`,
                    ...(f.description
                      ? { description: f.description.slice(0, 240) }
                      : {}),
                    addedAt: new Date().toISOString(),
                  };
                  idx.images.push(img);
                  images.set(id, img);
                  used += out.bytes;
                  decided = `kept:${id}`;
                  report.kept++;
                }
              } catch (err) {
                if (err instanceof HostRested) throw err;
                log(`  ${file}: ${errorMessage(err)}`);
                continue; // not decided: tried again next run
              } finally {
                if (tmp) await fs.rm(tmp, { force: true });
              }
            }
            st.files[key] = decided;
          }
          const imgId = /^(kept|dup):(.+)$/.exec(decided)?.[2];
          if (!imgId || !images.has(imgId)) continue;
          for (const u of uses) {
            const q = queue.get(u.page.title);
            const name = u.entityName;
            let ent = idx.entities.find(
              (e) =>
                normName(e.name) === normName(name) && e.wiki === wiki.name,
            );
            if (!ent) {
              ent = {
                name,
                aliases: [],
                type:
                  normName(name) === normName(title)
                    ? "game"
                    : isGallery(wiki, u.page.title)
                      ? "thing"
                      : entityType(u.page.categories),
                page: `${wiki.articles}${encodeURIComponent(u.page.title.replace(/ /g, "_"))}`,
                wiki: wiki.name,
                ofGame:
                  wiki.scope === "game" ||
                  !!q?.ofGame ||
                  u.page.categories.some((c) => categoryOfGame(c, gameNames)),
                images: [],
              };
              idx.entities.push(ent);
            }
            if (!isGallery(wiki, u.page.title)) {
              for (const a of [
                ...u.page.redirects,
                ...(q?.alias ? [q.alias] : []),
              ])
                if (
                  normName(a) !== normName(ent.name) &&
                  !ent.aliases.includes(a)
                )
                  ent.aliases.push(a);
              if (gameNames.includes(u.page.title)) ent.type = "game";
            }
            if (
              !ent.images.includes(imgId) &&
              ent.images.length < perEntity * 2
            ) {
              if (u.lead) ent.images.unshift(imgId);
              else ent.images.push(imgId);
            }
          }
        }
        for (const [t] of batch) pagesDone.add(t);
        report.pages += batch.length;
        st.pages[wiki.id] = [...pagesDone];
        await save();
        log(
          `  ${report.pages}/${todo.length} articles, ${report.kept} pictures kept, ${report.rejected} turned down, ${report.duplicates} repeats`,
        );
      }
      for (const name of wantedAll) {
        const hit = idx.entities.find(
          (e) =>
            e.images.length &&
            [e.name, ...e.aliases].some((a) => normName(a) === normName(name)),
        );
        const line = `${name} -> ${hit?.name}`;
        if (hit && !report.found.includes(line)) report.found.push(line);
      }
    }
  } catch (err) {
    if (err instanceof HostRested || err instanceof RobotsDenied) {
      report.stopped = errorMessage(err);
      log(`  stopped: ${report.stopped}`);
    } else throw err;
  } finally {
    await save();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
  return report;
}
