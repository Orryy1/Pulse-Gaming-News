// In-world mention insets (MENTION_INWORLD, owner, 20 Nov 2026): when the script names something that exists inside the
// game (a brand like "Scooter Bros", a shop, a radio station, a vehicle, a place), the inset shows that thing as the
// game shows it. Sources, best first, each kept only when it really shows the named thing:
//
// 1. our own frames: the scene index of the game's cutscene movie (a shot whose on-screen writing, read by the text
//    reader when the index was built, spells the name; inside the spoiler window only from the story's opening, the
//    same rule as footage) and the game library's video scenes the vision model described with the name;
// 2. official material: the game library's publisher stills filed under that name (Rockstar's own site files them by
//    place) and the publisher site's gallery tagged with it;
// 3. a game wiki's in-game picture of it (wikiArt below, the one place that asks a wiki): only an in-game logo, sign or
//    screenshot whose page says the thing is in this game and whose file page is licensed as a screenshot or logo,
//    never a fan render, edit or fan art. Credited on screen. The PC's wiki art library (claude/wikiart, lookupArt)
//    is asked first when WIKIART_LOOKUP_URL is set; otherwise one small, spaced, cached lookup on the game's wiki.
//
// A frame with the sign in it is cut to the sign where the text reader can find it. Every found picture (and every
// miss, for a day) is cached per game and name under <data>/mentioncache/inworld, so the next video naming it costs
// nothing. Nothing found means no inset: a picture is never generated.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { phraseTokens } from "../render/mentions.ts";
import { sceneSlug, type SceneIndex } from "../sceneindex/schema.ts";
import type { LibItem } from "./gamelib.ts";
import type { SiteAsset } from "./publishersite.ts";

const run = promisify(execFile);
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; licensed picture research; one request a second)";

/** A picture found for an in-world name, before it is copied into the episode. */
export interface InworldPicture {
  /** Absolute path of the cached picture. */
  file: string;
  name: string;
  /** A logo or sign shown whole on a light card, rather than a frame cut to fill. */
  logo: boolean;
  aspect: number;
  credit: string;
  provenance: string;
  sourceUrl: string;
  pageUrl?: string;
  /** "own" (our frames), "official" (publisher material), "wiki". */
  from: "own" | "official" | "wiki";
}

// ---- Which names are in-world (pure) -----------------------------------------------------------------------------

/** Acronyms and words that are never an in-game thing on their own (platforms, formats, the press). */
const NOT_INWORLD =
  /^(gta|rpg|fps|dlc|pc|ps4|ps5|xbox|usa|uk|us|ui|hud|npc|npcs|ai|tv|ok|ign|vgc|bbc|ceo|cgi|hdr|ssd|vr|ar|mmo|pvp|pve|goty|tba|tbd|new|dlss|fsr|esrb|pegi|boom)$/i;
/** Words that start a sentence or a heading, never the first word of a name ("If Grand Theft Auto", "Put Leonida"). */
const LEADING =
  /^(the|a|an|and|but|or|so|if|when|while|then|now|here|there|this|that|it|its|they|we|our|you|your|i|my|he|she|his|her|who|what|why|how|which|yes|no|not|just|still|even|also|after|before|since|until|for|with|from|in|on|at|to|by|of|put|have|has|does|do|did|should|could|would|can|will|is|are|was|were|be|buy|get|use|watch|keep|treat|give|try|play|installing|finding|meanwhile|plus|sources?|according|youtuber|two|one|three|as|once|every|imagine|most|fans|players|reports|many|some|all|both|each|another|still|yet|well)$/i;
/** Title-case words inside a heading ("Claims That Fail", "Finding Your Way"): a run with one is not a name. */
const HEADING_WORD =
  /^(that|your|you|this|these|those|when|why|how|what|which|who|is|are|was|were|can|will|should|could|would|does|do|did|have|has|it|its|we|our|my|i)$/i;
/** A product or edition, not something inside the game. */
const PRODUCT =
  /\b(edition|pack|bundle|trailer|update|patch|dlc|season pass|pre-?order)$/i;

/**
 * The phrases in the spoken lines that could be in-game things (pure): runs of two to four capitalised words ("Scooter
 * Bros", "Flash FM", "Port Gellhorn") and single coined words (ALL CAPS of four letters or more, "WAINK", or a capital
 * inside, "RydeMe"), never a sentence opener or heading, a product or edition, the video's own game, or anything in
 * `exclude` (studios, outlets, other games, platforms, the story's own sources). At most `max`, in the order said.
 */
export function inworldCandidates(o: {
  spoken: string;
  mainGame: string;
  exclude: string[];
  max?: number;
}): string[] {
  const key = (s: string) => phraseTokens(s).join(" ");
  const ex = new Set(o.exclude.map(key).filter(Boolean));
  const main = key(o.mainGame);
  const mainShort = key(o.mainGame.replace(/grand theft auto/i, "GTA"));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    const k = key(p);
    if (!k || seen.has(k) || ex.has(k) || k === main || k === mainShort) return;
    if (
      main &&
      (main.includes(k) ||
        k.includes(main) ||
        (mainShort && k.includes(mainShort)))
    )
      return;
    if (PRODUCT.test(p)) return;
    seen.add(k);
    out.push(p);
  };
  for (const sentence of o.spoken.split(/(?<=[.!?:])\s+/)) {
    const toks = sentence.split(/\s+/).filter(Boolean);
    let runW: string[] = [];
    const flush = () => {
      while (runW.length && LEADING.test(runW[0]!)) runW.shift();
      if (
        runW.length >= 2 &&
        runW.length <= 4 &&
        !runW.some((w) => HEADING_WORD.test(w)) &&
        !runW.every((w) => NOT_INWORLD.test(w))
      )
        push(runW.join(" "));
      runW = [];
    };
    for (const raw of toks) {
      const w = raw.replace(/^[(“"‘']+/, "");
      const bare = w.replace(/[,.;:!?)”"’']+$/, "").replace(/[’']s$/, "");
      if (/^[A-Z][\p{L}\p{N}&'’+-]*$/u.test(bare)) runW.push(bare);
      else flush();
      const coined =
        /^[A-Z]{4,}$/.test(bare) || /^[A-Z][a-z]+[A-Z][A-Za-z]*$/.test(bare);
      if (coined && !NOT_INWORLD.test(bare) && runW.length <= 1) push(bare);
      if (/[,.;:!?)”"]$/.test(w) || /[’']s$/.test(w.replace(/[,.;:!?]+$/, "")))
        flush();
    }
    flush();
  }
  return out.slice(0, o.max ?? 6);
}

/** True when `text` spells the name as whole words in order (pure; case, possessives and punctuation ignored). */
export function namesIt(text: string, name: string): boolean {
  const want = phraseTokens(name);
  if (!want.length) return false;
  const have = phraseTokens(text);
  for (let i = 0; i + want.length <= have.length; i++)
    if (want.every((t, k) => have[i + k] === t)) return true;
  return false;
}

/** The scene index shots whose on-screen writing spells the name (pure); their description only with the writing empty. */
export function shotsNaming(
  index: Pick<SceneIndex, "shots">,
  name: string,
): SceneIndex["shots"] {
  return index.shots.filter(
    (s) =>
      !s.blank &&
      !s.menu &&
      (namesIt(s.text ?? "", name) || (!s.text && namesIt(s.desc ?? "", name))),
  );
}

/** Library items that show the name (pure): publisher stills filed under it, then scenes or stills described with it. */
export function libraryNaming(
  items: LibItem[],
  name: string,
): Array<{ item: LibItem; at?: number; official: boolean }> {
  const out: Array<{ item: LibItem; at?: number; official: boolean }> = [];
  for (const i of items) {
    // Large lettering keeps a picture out of the footage, but on a sign it is the thing itself; anything else the
    // vision model ruled out (not ad-safe, a webcam, merchandise, a pre-order item) stays out.
    if (i.unusable && !/^large lettering$/i.test(i.unusable.trim())) continue;
    const official = !/^(own|igdb)$/i.test(i.source);
    if (
      i.kind === "still" &&
      official &&
      i.named.some(
        (n) =>
          namesIt(n, name) &&
          phraseTokens(n).length === phraseTokens(name).length,
      )
    )
      out.push({ item: i, official: true });
    else if (i.kind === "still" && namesIt(i.seen ?? "", name))
      out.push({ item: i, official });
    for (const sc of i.scenes ?? [])
      if (namesIt(sc.seen ?? "", name))
        out.push({ item: i, at: sc.at, official });
  }
  // Filed under the name first, then described with it; our own scenes before the publisher's.
  return out.sort(
    (a, b) =>
      Number(b.item.named.length > 0 && b.official) -
      Number(a.item.named.length > 0 && a.official),
  );
}

// ---- The wiki (one function, cached) -----------------------------------------------------------------------------

/** The game wikis we may ask, by series, with how a page says a thing is in a given game. */
export const GAME_WIKIS: Array<{
  series: RegExp;
  api: string;
  site: string;
  /** The code the wiki's "games" field uses for a game ("VI" for Grand Theft Auto VI). */
  code: (game: string) => string | undefined;
}> = [
  {
    series: /grand theft auto|\bgta\b/i,
    api: "https://gta.fandom.com/api.php",
    site: "GTA Wiki (Fandom)",
    code: (g) => {
      const t = g.toLowerCase();
      if (/online/.test(t)) return "O";
      if (/\b(vi|6)\b/.test(t)) return "VI";
      if (/\b(v|5)\b/.test(t)) return "V";
      if (/\b(iv|4)\b/.test(t)) return "IV";
      if (/san andreas/.test(t)) return "SA";
      if (/vice city/.test(t)) return "VC";
      if (/\b(iii|3)\b/.test(t)) return "III";
      return undefined;
    },
  },
  {
    series: /red dead/i,
    api: "https://reddead.fandom.com/api.php",
    site: "Red Dead Wiki (Fandom)",
    code: (g) => (/\b(2|ii)\b/i.test(g) ? "RDR2" : "RDR"),
  },
];

/** Words on a wiki file page that mean it is not the game's own picture. */
const FAN_WORK =
  /\b(fan[- ]?(art|made|render|edit|creation|logo)|fanon|render(ed)? by|edited by|made by|my own|user[- ]made|mock-?up|concept by|recreat\w*|custom|photoshop|fanmade|unofficial|ai[- ]generated|upscaled by)\b/i;
/** A licence template that says what it is: a screenshot, a logo or official artwork. */
const GAME_PICTURE =
  /\{\{\s*([a-z0-9]+ )?(screenshot|logo|artwork|copyrighted game|game screenshot|cover art)\s*(\||\}\})/i;

/** Whether a wiki page says the thing is in this game (pure): its infobox's games field carries the game's code. */
export function pageInGame(wikitext: string, code: string): boolean {
  const field = wikitext.match(/\|\s*games\s*=([^\n]*)/i)?.[1] ?? "";
  return new RegExp(`(^|[|{\\s])${code}\\s*=\\s*y`, "i").test(field);
}

/** The picture a wiki page's infobox names for the thing: its sign, logo or image, with the page's caption (pure). */
export function infoboxPicture(
  wikitext: string,
): { file: string; field: string; caption: string } | undefined {
  const caption =
    wikitext.match(/\|\s*caption\s*=([^\n]*)/i)?.[1]?.trim() ?? "";
  for (const field of ["sign", "logo", "image"]) {
    const m = wikitext.match(
      new RegExp(`\\|\\s*${field}\\s*=\\s*([^|\\n}]+)`, "i"),
    );
    // A value written as a link ("[[File:X.png|thumb]]") is the same file.
    const file = m?.[1]
      ?.replace(/\[\[|\]\]/g, "")
      .trim()
      .replace(/^(file|image):/i, "")
      .trim();
    if (file && /\.(png|jpe?g|webp|gif|svg)$/i.test(file))
      return { file, field, caption: field === "image" ? caption : "" };
  }
  return undefined;
}

/**
 * Whether a wiki file page is the game's own picture (pure): licensed as a screenshot, logo or artwork, and no fan work.
 * A file page with nothing on it passes only when the article's own caption calls it the game's logo, sign or
 * screenshot in this game ("Flash FM logo in {{VI}}"), and the caption says nothing of fan work.
 */
export function wikiFileOk(
  fileWikitext: string,
  o: { caption?: string; code?: string } = {},
): { ok: true; by: "file page" | "caption" } | { ok: false; why: string } {
  if (FAN_WORK.test(fileWikitext) || FAN_WORK.test(o.caption ?? ""))
    return { ok: false, why: "the file page or caption describes fan work" };
  if (GAME_PICTURE.test(fileWikitext)) return { ok: true, by: "file page" };
  if (!fileWikitext.trim() && o.caption && o.code) {
    const inGame = new RegExp(
      `\\{\\{\\s*${o.code}\\s*\\}\\}|\\bin (grand theft auto|gta) ?${o.code}\\b`,
      "i",
    ).test(o.caption);
    if (inGame && /\b(logo|sign|signage|screenshot|in-game)\b/i.test(o.caption))
      return { ok: true, by: "caption" };
  }
  return {
    ok: false,
    why: fileWikitext.trim()
      ? "not licensed as a screenshot, logo or artwork"
      : "the file page says nothing to check",
  };
}

type Fetch = typeof fetch;
let lastWikiCall = 0;
async function wikiJson(
  api: string,
  params: Record<string, string>,
  fetchFn: Fetch,
): Promise<any> {
  // One request a second at most, from this process: a wiki is a shared, volunteer-run site. The next turn is taken
  // before waiting, so two lookups at once still go one after the other.
  const turn = Math.max(Date.now(), lastWikiCall + 1100);
  lastWikiCall = turn;
  const wait = turn - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetchFn(
    `${api}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`,
    {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`${res.status} from ${new URL(api).host}`);
  return res.json();
}

/**
 * The one way the factory asks a wiki for an in-game picture of a name in a game: the PC's wiki art library first
 * (WIKIART_LOOKUP_URL, the claude/wikiart lookupArt), else one search and, for at most three pages named for the thing,
 * the page, its file page and the file's address (ten requests at most, a second apart). Undefined when nothing passes.
 */
export async function wikiArt(
  game: string,
  name: string,
  fetchFn: Fetch = fetch,
): Promise<
  | {
      url: string;
      pageUrl: string;
      credit: string;
      provenance: string;
      logo: boolean;
    }
  | undefined
> {
  const lookup = process.env.WIKIART_LOOKUP_URL;
  if (lookup) {
    try {
      const res = await fetchFn(
        `${lookup}?${new URLSearchParams({ game, name })}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        // The wiki art library's ArtHit (src/wikiart/lookup.ts): credit, sourcePage/filePage and forGame. The older
        // field names (pageUrl, site, official) are still read for any other lookup service.
        const j = (await res.json()) as {
          url?: string;
          pageUrl?: string;
          sourcePage?: string;
          filePage?: string;
          site?: string;
          credit?: string;
          kind?: string;
          official?: boolean;
          forGame?: boolean;
        } | null;
        // A picture filed under another game of the series is not this game's thing: no inset rather than a wrong one.
        if (j?.url && j.official !== false && j.forGame !== false) {
          const page = j.sourcePage ?? j.pageUrl ?? j.filePage ?? j.url;
          const credit = j.credit
            ? j.credit.startsWith("Image")
              ? j.credit
              : `Image: ${j.credit}`
            : `Image: ${j.site ?? "game wiki"}`;
          return {
            url: j.url,
            pageUrl: page,
            credit,
            provenance: `In-game picture of "${name}" (${page}), via the wiki art library: ${j.credit ?? j.site ?? "a game wiki"}`,
            logo: j.kind === "logo" || j.kind === "sign",
          };
        }
      }
    } catch {
      // The library is optional: fall through to the wiki itself.
    }
  }
  const wiki = GAME_WIKIS.find((w) => w.series.test(game));
  const code = wiki?.code(game);
  if (!wiki || !code) return undefined;
  const found = await wikiJson(
    wiki.api,
    {
      action: "query",
      list: "search",
      srsearch: name,
      srnamespace: "0",
      srlimit: "5",
    },
    fetchFn,
  );
  const titles: string[] = (found?.query?.search ?? []).map(
    (x: { title: string }) => x.title,
  );
  // The page named for the thing (a disambiguation's universe pages too: "Flash FM (HD Universe)").
  const own = titles.filter(
    (t) =>
      namesIt(t.replace(/\s*\([^)]*\)\s*$/, ""), name) &&
      phraseTokens(t.replace(/\s*\([^)]*\)\s*$/, "")).length ===
        phraseTokens(name).length,
  );
  for (const title of own.slice(0, 3)) {
    const page = await wikiJson(
      wiki.api,
      { action: "parse", page: title, prop: "wikitext", redirects: "1" },
      fetchFn,
    );
    const text: string = page?.parse?.wikitext ?? "";
    if (!pageInGame(text, code)) continue;
    const pic = infoboxPicture(text);
    if (!pic) continue;
    const filePage = await wikiJson(
      wiki.api,
      { action: "parse", page: `File:${pic.file}`, prop: "wikitext" },
      fetchFn,
    );
    const ok = wikiFileOk(filePage?.parse?.wikitext ?? "", {
      caption: pic.caption,
      code,
    });
    if (!ok.ok) {
      log("info", "in-world inset: wiki picture refused", {
        name,
        file: pic.file,
        why: ok.why,
      });
      continue;
    }
    const info = await wikiJson(
      wiki.api,
      {
        action: "query",
        titles: `File:${pic.file}`,
        prop: "imageinfo",
        iiprop: "url|size",
      },
      fetchFn,
    );
    const ii = info?.query?.pages?.[0]?.imageinfo?.[0];
    if (!ii?.url) continue;
    const pageUrl = `${wiki.api.replace(/api\.php$/, "wiki/")}${encodeURIComponent(`File:${pic.file}`.replace(/ /g, "_"))}`;
    return {
      url: ii.url,
      pageUrl,
      credit: `Image: ${wiki.site}`,
      provenance: `In-game ${pic.field} of "${name}" from ${wiki.site}, page "${title}" (in ${game}), file ${pic.file}, checked by its ${ok.by}${ok.by === "caption" ? ` ("${pic.caption.slice(0, 80)}")` : ""}`,
      logo: pic.field !== "image" || /logo|sign/i.test(pic.file),
    };
  }
  return undefined;
}

// ---- Finding and caching (network, files) ------------------------------------------------------------------------

export interface InworldDeps {
  fetchFn?: Fetch;
  /** The game's scene index and its proxy video (absolute path), or undefined. */
  sceneIndex?: (
    game: string,
  ) => Promise<
    | Array<{ index: SceneIndex; proxy?: string }>
    | { index: SceneIndex; proxy?: string }
    | undefined
  >;
  /** Whether a moment of the index may be shown in a Short now (src/sceneindex/spoilers.ts footageAllowed). */
  frameAllowed?: (index: SceneIndex, at: number) => boolean;
  /** The game library's items, and a readable path for one of its files. */
  library?: (
    game: string,
  ) => Promise<
    | { items: LibItem[]; file: (item: LibItem) => Promise<string | undefined> }
    | undefined
  >;
  /** The publisher site's named gallery pictures (src/assets/publishersite.ts). */
  siteStills?: (game: string) => Promise<SiteAsset[]>;
  /** Where a phrase is written in a picture, as fractions [left, top, right, bottom] (src/assets/ocr.ts). */
  textBox?: (
    file: string,
    phrase: string,
  ) => Promise<[number, number, number, number] | undefined>;
  /** The wiki lookup (wikiArt by default). */
  wiki?: typeof wikiArt;
  now?: () => number;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);

/** How long a miss is remembered (the wiki and the library grow; a launch week changes daily). */
export const INWORLD_MISS_HOURS = 24;
/** How long a find is kept before it is looked for again (our own frame may since replace a wiki picture). */
export const INWORLD_FOUND_DAYS = 7;

async function save(
  url: string,
  dest: string,
  fetchFn: Fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1500) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * A frame (or still) cut for the card: around the sign when the text reader finds it (at least 40% of the width, about
 * 16:10), else the whole picture at 720 px wide. Returns the aspect written.
 */
async function cutCard(
  src: string,
  out: string,
  box: [number, number, number, number] | undefined,
  at?: number,
): Promise<number | undefined> {
  const seek = at !== undefined ? ["-ss", at.toFixed(2)] : [];
  let vf = "scale=720:-2";
  let aspect = 16 / 9;
  if (box) {
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const w = Math.min(1, Math.max(0.4, (box[2] - box[0]) * 2.2));
    // About 16:10 on a 16:9 picture: the height fraction is 16/9 / 1.6 = 1.11 times the width fraction.
    const h = Math.min(1, w * 1.11);
    const x = Math.min(1 - w, Math.max(0, cx - w / 2));
    const y = Math.min(1 - h, Math.max(0, cy - h / 2));
    vf = `crop=iw*${w.toFixed(3)}:ih*${h.toFixed(3)}:iw*${x.toFixed(3)}:ih*${y.toFixed(3)},scale=720:-2`;
    aspect = (w * 16) / (h * 9);
  }
  try {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        ...seek,
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        vf,
        "-q:v",
        "3",
        out,
      ],
      { timeout: 60_000 },
    );
    // The card's real shape (a still need not be 16:9).
    return (await probeAspect(out)) ?? aspect;
  } catch {
    return undefined;
  }
}

/** A cached find (or a remembered miss) for a game and name. */
async function readCache(
  dir: string,
  now: number,
): Promise<InworldPicture | null | undefined> {
  try {
    const j = JSON.parse(
      await fs.readFile(path.join(dir, "found.json"), "utf8"),
    );
    if (j.miss)
      return now - Date.parse(j.at) < INWORLD_MISS_HOURS * 3_600_000
        ? null
        : undefined;
    if (now - Date.parse(j.at) > INWORLD_FOUND_DAYS * 86_400_000)
      return undefined;
    if (
      await fs.stat(j.file).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      return j as InworldPicture;
  } catch {
    // no cache yet
  }
  return undefined;
}

/**
 * The best real picture of an in-world name in a game, cached under `cacheRoot` (network, never throws): our own frames,
 * then official material, then a game wiki. Undefined when none passes.
 */
export async function findInworldPicture(
  game: string,
  name: string,
  cacheRoot: string,
  deps: InworldDeps,
): Promise<InworldPicture | undefined> {
  const now = deps.now?.() ?? Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const dir = path.join(cacheRoot, sceneSlug(game), slug(name));
  const cached = await readCache(dir, now);
  if (cached === null) return undefined;
  if (cached) return cached;
  const keep = async (p: InworldPicture) => {
    await fs.writeFile(
      path.join(dir, "found.json"),
      JSON.stringify({ ...p, at: new Date(now).toISOString() }, null, 1),
    );
    log("info", "in-world inset found", {
      game,
      name,
      from: p.from,
      source: p.sourceUrl,
    });
    return p;
  };
  const card = path.join(dir, "card.jpg");
  try {
    await fs.mkdir(dir, { recursive: true });
    // 1. Our own frames: the scene index (spoiler rule), then the library's described scenes and stills.
    const found = await deps.sceneIndex?.(game).catch(() => undefined);
    // The cutscene index and the gameplay index (src/sceneindex/schema.ts gameplayIndexName), each under the spoiler rule.
    for (const si of Array.isArray(found) ? found : found ? [found] : [])
      if (si.proxy)
        for (const shot of shotsNaming(si.index, name)) {
          const at = shot.keyframes[0] ?? (shot.start + shot.end) / 2;
          if (deps.frameAllowed && !deps.frameAllowed(si.index, at)) continue;
          const raw = path.join(dir, "frame_src.jpg");
          if ((await cutCard(si.proxy!, raw, undefined, at)) === undefined)
            continue;
          const box = await deps.textBox?.(raw, name).catch(() => undefined);
          const aspect = await cutCard(raw, card, box);
          await fs.rm(raw, { force: true });
          if (aspect === undefined) continue;
          return await keep({
            file: card,
            name,
            logo: false,
            aspect,
            credit: `In-game: ${game}`,
            provenance: `Frame at ${Math.round(at)} s of the scene index source for ${game} (${si.index.source.title}, ${si.index.source.uploader}), shot ${shot.id}, whose on-screen writing reads "${shot.text || shot.desc}"`,
            sourceUrl: `https://www.youtube.com/watch?v=${si.index.source.videoId}&t=${Math.round(at)}`,
            from: "own",
          });
        }
    const lib = await deps.library?.(game).catch(() => undefined);
    const libHits = lib ? libraryNaming(lib.items, name) : [];
    for (const official of [false, true])
      for (const h of libHits.filter(
        (x) =>
          x.official === official &&
          (official || x.item.source.toLowerCase() === "own"),
      )) {
        const src = await lib!.file(h.item);
        if (!src) continue;
        const box =
          h.at === undefined
            ? await deps.textBox?.(src, name).catch(() => undefined)
            : undefined;
        const aspect = await cutCard(src, card, box, h.at);
        if (aspect === undefined) continue;
        return await keep({
          file: card,
          name,
          logo: false,
          aspect,
          credit: official ? `Official: ${h.item.source}` : `In-game: ${game}`,
          provenance: `${h.item.provenance}${h.at !== undefined ? ` (scene at ${Math.round(h.at)} s)` : ""}, filed or described as "${name}"`,
          sourceUrl: h.item.sourceUrl,
          from: official ? "official" : "own",
        });
      }
    // 2. Official: the publisher site's gallery tagged with the name.
    const stills = (await deps.siteStills?.(game).catch(() => [])) ?? [];
    for (const st of stills.filter(
      (x) =>
        x.kind === "still" &&
        x.tags.some(
          (t) =>
            namesIt(t, name) &&
            phraseTokens(t).length === phraseTokens(name).length,
        ),
    )) {
      const raw = path.join(dir, "site_src.jpg");
      if (!(await save(st.url, raw, fetchFn))) continue;
      const box = await deps.textBox?.(raw, name).catch(() => undefined);
      const aspect = await cutCard(raw, card, box);
      await fs.rm(raw, { force: true });
      if (aspect === undefined) continue;
      return await keep({
        file: card,
        name,
        logo: false,
        aspect,
        credit: `Official: ${st.publisher}`,
        provenance: `Official gallery picture "${st.name}" listed by ${st.publisher} at ${st.listedAt}, tagged "${name}"`,
        sourceUrl: st.url,
        from: "official",
      });
    }
    // 3. A game wiki's in-game picture. A lookup that failed (the wiki down, a refusal) is not remembered as a miss.
    let wikiFailed = false;
    const w = await (deps.wiki ?? wikiArt)(game, name, fetchFn).catch((err) => {
      wikiFailed = true;
      log("info", "in-world inset: wiki lookup failed", {
        game,
        name,
        error: errorMessage(err),
      });
      return undefined;
    });
    if (w) {
      const ext = (
        w.url.match(/\.(png|jpe?g|webp|gif)(?=$|[/?])/i)?.[1] ?? "png"
      ).toLowerCase();
      const raw = path.join(dir, `wiki_src.${ext}`);
      const got = await save(w.url, raw, fetchFn);
      // The wiki's picture server refusing us (20 Nov 2026: Fandom's image host answers 403) is not a miss either.
      if (!got) {
        wikiFailed = true;
        log("info", "in-world inset: wiki picture could not be downloaded", {
          game,
          name,
          url: w.url,
        });
      }
      if (got) {
        const out = path.join(dir, w.logo ? "card.png" : "card.jpg");
        const ok = await run(
          FFMPEG,
          [
            "-v",
            "error",
            "-y",
            "-i",
            raw,
            "-frames:v",
            "1",
            "-vf",
            "scale='min(720,iw)':-2",
            out,
          ],
          { timeout: 60_000 },
        ).then(
          () => true,
          () => false,
        );
        await fs.rm(raw, { force: true });
        if (ok) {
          const aspect = await probeAspect(out);
          return await keep({
            file: out,
            name,
            logo: w.logo,
            aspect: aspect ?? 1.6,
            credit: w.credit,
            provenance: w.provenance,
            sourceUrl: w.url,
            pageUrl: w.pageUrl,
            from: "wiki",
          });
        }
      }
    }
    if (!wikiFailed)
      await fs.writeFile(
        path.join(dir, "found.json"),
        JSON.stringify({ miss: true, at: new Date(now).toISOString() }),
      );
    log("info", "in-world inset: no real picture found", { game, name });
    return undefined;
  } catch (err) {
    log("warn", "in-world inset lookup failed", {
      game,
      name,
      error: errorMessage(err),
    });
    return undefined;
  }
}

async function probeAspect(file: string): Promise<number | undefined> {
  try {
    const { FFPROBE } = await import("../lib/bin.ts");
    const p = await run(FFPROBE, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ]);
    const [w, h] = p.stdout.trim().split(",").map(Number);
    return w && h ? w / h : undefined;
  } catch {
    return undefined;
  }
}
