// Wikipedia as a map to the record, never the record itself (owner, 13 Nov 2026: "shouldn't we use the actual sources
// Wikipedia itself then states, as people seem to have a distrust of Wikipedia"). The plain-text extract the writers
// used to get drops every footnote, so the 10 Nov launch guide said "according to Wikipedia" 25 times. This reads the
// article's rendered page instead: every sentence keeps a small mark for each reference it cites (⁽3⁾), and the
// references themselves come from the page's citation metadata (outlet, headline, date, address). The writers credit
// the outlet a mark names; the factory then fetches the most-cited originals (the interview, the press release, the
// review, the earnings report) and adds their own words under "[Outlet] headline", so the fact check reads the
// primary text and the description credits it. Pure parsing here; the fetches take a fetch function.

import * as cheerio from "cheerio";
import type { WikiArticle } from "./wikipedia.ts";
import { pickSections } from "./wikipedia.ts";

/** One reference the article cites, as its citation metadata gives it. */
export interface WikiRef {
  /** The mark's number in our text (renumbered from 1 in the order the brief first cites it). */
  n: number;
  /** The original's address (never the archive copy when the original is known). */
  url?: string;
  /** An archived copy, tried when the original won't open. */
  archive?: string;
  /** Who published it, as people say it ("IGN", "Take-Two Interactive", "The Guardian"). */
  outlet: string;
  /** The headline or document title. */
  title?: string;
  /** "2013-09-20" or as the citation gives it. */
  date?: string;
  /** The author's surname(s), when the citation names them. */
  author?: string;
}

/** A primary source read for a brief: its own words are in the text under "[outlet] title". */
export interface PrimaryRead {
  n: number;
  url: string;
  outlet: string;
  title: string;
  chars: number;
}

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** "⁽12⁾" for 12: superscript digits are not \d, so the grounding checks (which keep only [0-9]) never see a mark as a figure. */
export const refMark = (n: number) =>
  `⁽${String(n)
    .split("")
    .map((d) => SUP_DIGITS[Number(d)])
    .join("")}⁾`;
const MARK = /⁽([⁰¹²³⁴⁵⁶⁷⁸⁹]+)⁾/g;
const markNumber = (s: string) =>
  Number(
    s
      .split("")
      .map((c) => SUP_DIGITS.indexOf(c))
      .join(""),
  );

/** The text without its reference marks (narration, quotes, anything a viewer sees or hears). */
export function stripRefMarks(text: string): string {
  return text.replace(/\s?⁽[⁰¹²³⁴⁵⁶⁷⁸⁹]+⁾/g, "");
}

/** The mark numbers a text carries, most-cited first (ties in order of first appearance). */
export function marksIn(text: string): number[] {
  const count = new Map<number, number>();
  for (const m of text.matchAll(MARK)) {
    const n = markNumber(m[1]!);
    count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

// ---------------------------------------------------------------- outlets

/** Hosts whose names people say differently from the address. */
const HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)ign\.com$/, "IGN"],
  [/(^|\.)kotaku\.com$/, "Kotaku"],
  [/(^|\.)polygon\.com$/, "Polygon"],
  [/(^|\.)eurogamer\.net$/, "Eurogamer"],
  [/(^|\.)gamespot\.com$/, "GameSpot"],
  [/(^|\.)gamesradar\.com$/, "GamesRadar"],
  [/(^|\.)pcgamer\.com$/, "PC Gamer"],
  [/(^|\.)theverge\.com$/, "The Verge"],
  [/(^|\.)vg247\.com$/, "VG247"],
  [/(^|\.)videogameschronicle\.com$/, "VGC"],
  [/(^|\.)gamesindustry\.biz$/, "GamesIndustry.biz"],
  [/(^|\.)gameinformer\.com$/, "Game Informer"],
  [/(^|\.)rockpapershotgun\.com$/, "Rock Paper Shotgun"],
  [/(^|\.)destructoid\.com$/, "Destructoid"],
  [/(^|\.)purexbox\.com$/, "Pure Xbox"],
  [/(^|\.)pushsquare\.com$/, "Push Square"],
  [/(^|\.)nintendolife\.com$/, "Nintendo Life"],
  [/(^|\.)theguardian\.com$/, "The Guardian"],
  [/(^|\.)nytimes\.com$/, "The New York Times"],
  [/(^|\.)bloomberg\.com$/, "Bloomberg"],
  [/(^|\.)reuters\.com$/, "Reuters"],
  [/(^|\.)bbc\.(co\.uk|com)$/, "the BBC"],
  [/(^|\.)wsj\.com$/, "The Wall Street Journal"],
  [/(^|\.)ft\.com$/, "the Financial Times"],
  [/(^|\.)cnbc\.com$/, "CNBC"],
  [/(^|\.)variety\.com$/, "Variety"],
  [/(^|\.)hollywoodreporter\.com$/, "The Hollywood Reporter"],
  [/(^|\.)wired\.(com|co\.uk)$/, "Wired"],
  [/(^|\.)arstechnica\.com$/, "Ars Technica"],
  [/(^|\.)engadget\.com$/, "Engadget"],
  [/(^|\.)tomshardware\.com$/, "Tom's Hardware"],
  [/(^|\.)digitalfoundry\.net$/, "Digital Foundry"],
  [/(^|\.)famitsu\.com$/, "Famitsu"],
  [/(^|\.)edge-online\.com$/, "Edge"],
  [/(^|\.)metacritic\.com$/, "Metacritic"],
  [/(^|\.)vgchartz\.com$/, "VGChartz"],
  [/(^|\.)hitmarker\.net$/, "Hitmarker"],
  [/(^|\.)take2games\.com$/, "Take-Two"],
  [/^support\.rockstargames\.com$/, "Rockstar Support"],
  [/(^|\.)rockstargames\.com$/, "Rockstar"],
  [/(^|\.)playstation\.com$/, "PlayStation"],
  [/(^|\.)xbox\.com$/, "Xbox"],
  [/(^|\.)nintendo\.(com|co\.jp|co\.uk)$/, "Nintendo"],
  [/(^|\.)ea\.com$/, "EA"],
  [/(^|\.)ubisoft\.com$/, "Ubisoft"],
  [/(^|\.)capcom\.(com|co\.jp)$/, "Capcom"],
  [/(^|\.)square-enix\.com$/, "Square Enix"],
  [/(^|\.)sec\.gov$/, "an SEC filing"],
  [/(^|\.)steampowered\.com$/, "Steam"],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, "a post on X"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "a video"],
];

/** The outlet a link belongs to, as people say it (pure); the citation's own name wins when it gives one. */
export function outletName(url: string | undefined, named?: string): string {
  const given = (named ?? "")
    .replace(/\s+/g, " ")
    .replace(/^\[|\]$/g, "")
    .trim();
  if (given && !/wikipedia/i.test(given)) return given;
  let host = "";
  try {
    host = new URL(url ?? "").hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return given || "the record";
  }
  for (const [re, name] of HOSTS) if (re.test(host)) return name;
  if (/wikipedia\.org$/.test(host)) return "the record";
  return host;
}

const ARCHIVE =
  /(^|\/\/)(web\.)?archive\.(org|today|is|ph)\/|archive\.org\/web\//i;

// ---------------------------------------------------------------- parsing the page

const SKIP_HEAD =
  /^(see also|notes|references|external links|further reading|bibliography|citations|sources|footnotes|explanatory notes)$/i;

/** One reference entry's metadata from the page: the COinS span when it has one, else its first outside link. */
function refFromEntry(
  $: cheerio.CheerioAPI,
  li: any,
): Omit<WikiRef, "n"> | undefined {
  const entry = $(li);
  // A short footnote ("Smith 2014, p. 3") points at the full citation in the bibliography.
  const sfn = entry.find('a[href^="#CITEREF"]').first().attr("href");
  const target = sfn ? $(`cite[id="${sfn.slice(1)}"]`).first() : undefined;
  const scope = target && target.length ? target.parent() : entry;
  const coins = scope.find("span.Z3988").first().attr("title");
  const links = scope
    .find("a.external")
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .filter((h) => /^https?:\/\//.test(h));
  const original = links.find((h) => !ARCHIVE.test(h));
  const archive = links.find((h) => ARCHIVE.test(h));
  let title: string | undefined;
  let work: string | undefined;
  let date: string | undefined;
  let author: string | undefined;
  let id: string | undefined;
  if (coins) {
    const q = new URLSearchParams(coins.replace(/&amp;/g, "&"));
    title =
      q.get("rft.atitle") ??
      q.get("rft.btitle") ??
      q.get("rft.title") ??
      undefined;
    work = q.get("rft.jtitle") ?? q.get("rft.pub") ?? undefined;
    date = q.get("rft.date") ?? undefined;
    author = q.get("rft.aulast") ?? q.get("rft.au")?.split(",")[0] ?? undefined;
    id = q.get("rft_id") ?? undefined;
  }
  if (!title) {
    const a = scope.find("a.external").first();
    title =
      a
        .text()
        .replace(/^["“]|["”]$/g, "")
        .trim() || undefined;
  }
  if (!work) work = scope.find("cite i").first().text().trim() || undefined;
  const url =
    (original ??
      (id && /^https?:/.test(id) && !ARCHIVE.test(id) ? id : undefined)) ||
    undefined;
  if (!url && !archive && !title) return undefined;
  return {
    ...(url ? { url } : {}),
    ...(archive ? { archive } : {}),
    outlet: outletName(url ?? archive, work),
    ...(title ? { title: title.replace(/\s+/g, " ").trim() } : {}),
    ...(date ? { date } : {}),
    ...(author ? { author } : {}),
  };
}

/**
 * The page's body as the plain extract writes it ("== Heading ==" lines, one paragraph a line) with a mark after
 * each cited sentence, and every reference by its page label ("20", "Guardian_Leak-20" resolve to the same entry).
 * Notes that explain rather than cite ([a], [b]) carry no mark.
 */
export function parseCitedPage(html: string): {
  extract: string;
  refs: Map<number, Omit<WikiRef, "n">>;
} {
  const $ = cheerio.load(html);
  // Each reference entry by its id, read once.
  // Read before anything is cut: the entries sit in the reference list, which the body text leaves out.
  const byId = new Map<string, Omit<WikiRef, "n"> | null>();
  $('li[id^="cite_note"]').each((_, li) => {
    const id = $(li).attr("id");
    if (id) byId.set(id, refFromEntry($, li) ?? null);
  });
  const entryRef = (noteId: string) => byId.get(noteId) ?? undefined;
  // Page-local numbers: the first time an entry is cited it gets the next one.
  const numberOf = new Map<string, number>();
  const refs = new Map<number, Omit<WikiRef, "n">>();
  // The page body; a bare fragment (tests) is its own body.
  const wrapped = $(".mw-parser-output").first();
  const root: cheerio.Cheerio<any> = wrapped.length ? wrapped : $("body").first().length ? $("body").first() : $.root();
  root
    .find(
      "style, script, table, figure, .infobox, .navbox, .hatnote, .mw-editsection, .reflist, .mw-references-wrap, .thumb, .gallery, .noprint, .shortdescription, sup.Inline-Template",
    )
    .not("sup.reference")
    .remove();
  root.find("sup.reference").each((_, el) => {
    const href = $(el).find("a").attr("href") ?? "";
    const noteId = href.replace(/^#/, "");
    const label = $(el)
      .text()
      .replace(/[[\]\s]/g, "");
    // Explanatory notes ("a", "note 1") explain; only numbered references cite.
    const ref = /^\d+$/.test(label) && noteId ? entryRef(noteId) : undefined;
    if (!ref) {
      $(el).replaceWith("");
      return;
    }
    let n = numberOf.get(noteId);
    if (n === undefined) {
      n = numberOf.size + 1;
      numberOf.set(noteId, n);
      refs.set(n, ref);
    }
    $(el).replaceWith(refMark(n));
  });
  const lines: string[] = [];
  let skipping = false;
  const walk = (el: any) => {
    const tag = (el.tagName ?? el.name ?? "").toLowerCase();
    const node = $(el);
    if (/^h[2-4]$/.test(tag)) {
      const title = node.text().replace(/\s+/g, " ").trim();
      skipping = SKIP_HEAD.test(title);
      const eq = "=".repeat(Number(tag[1]));
      if (!skipping) lines.push("", `${eq} ${title} ${eq}`);
      return;
    }
    if (node.is("div.mw-heading")) {
      node.children().each((_, c) => walk(c));
      return;
    }
    if (skipping) return;
    if (tag === "p") {
      const t = node.text().replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
      return;
    }
    if (tag === "ul" || tag === "ol") {
      node.children("li").each((_, li) => {
        const t = $(li).text().replace(/\s+/g, " ").trim();
        if (t) lines.push(t);
      });
      return;
    }
    if (tag === "blockquote") {
      const t = node.text().replace(/\s+/g, " ").trim();
      if (t) lines.push(`"${t}"`);
      return;
    }
    if (tag === "div" || tag === "section")
      node.children().each((_, c) => walk(c));
  };
  root.children().each((_, c) => walk(c));
  // A mark goes after the sentence's full stop, as a footnote does.
  const extract = lines
    .join("\n")
    .replace(/ +(⁽[⁰¹²³⁴⁵⁶⁷⁸⁹]+⁾)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { extract, refs };
}

/**
 * Renumbers a text's marks from `from` in the order they first appear, keeping only the references it cites (pure).
 * A brief's marks then run 1, 2, 3 with no gaps, and two articles merged never share a number.
 */
export function renumber(
  text: string,
  refs: ReadonlyMap<number, Omit<WikiRef, "n">> | readonly WikiRef[],
  from = 1,
): { text: string; refs: WikiRef[]; map: Map<number, number> } {
  const lookup = new Map<number, Omit<WikiRef, "n">>(
    Array.isArray(refs)
      ? (refs as WikiRef[]).map((r) => [r.n, r] as [number, WikiRef])
      : [...(refs as ReadonlyMap<number, Omit<WikiRef, "n">>).entries()],
  );
  const next = new Map<number, number>();
  const out: WikiRef[] = [];
  const t = text.replace(MARK, (_whole, digits: string) => {
    const old = markNumber(digits);
    const ref = lookup.get(old);
    if (!ref) return "";
    let n = next.get(old);
    if (n === undefined) {
      n = from + next.size;
      next.set(old, n);
      const { n: _drop, ...rest } = ref as WikiRef;
      out.push({ ...rest, n });
    }
    return refMark(n);
  });
  return { text: t, refs: out, map: next };
}

/** The reference list a brief ends with: who first reported each marked line (pure). */
export function refTable(refs: readonly WikiRef[] | undefined): string {
  if (!refs?.length) return "";
  return `\n\nWHO REPORTED IT (the ⁽n⁾ marks above; when a line needs a credit, credit these, never Wikipedia):\n${refs
    .map(
      (r) =>
        `${refMark(r.n)} ${r.outlet}${r.title ? `, "${r.title}"` : ""}${r.date ? ` (${r.date.slice(0, 10)})` : ""}${r.author ? `, by ${r.author}` : ""}`,
    )
    .join("\n")}`;
}

/** The brief a writer or checker reads: the notes, then the reference list. */
export function briefText(a: Pick<WikiArticle, "text" | "refs">): string {
  return `${a.text}${refTable(a.refs)}`;
}

/** The heading over a SOURCE block: what it is, without inviting "according to Wikipedia". */
export function sourceHeading(a: Pick<WikiArticle, "title" | "refs">): string {
  return a.refs?.length
    ? `SOURCE (research notes on "${a.title}"; ⁽n⁾ marks name who first reported each line, listed at the end, and "[Outlet] headline" sections are the originals' own words)`
    : `SOURCE (research notes on "${a.title}")`;
}

type FetchLike = typeof fetch;
const API = "https://en.wikipedia.org/w/api.php";
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; documentary research)";

/** The article's rendered page; undefined when there is no such page. */
export async function fetchWikiHtml(
  title: string,
  fetchFn: FetchLike = fetch,
): Promise<{ title: string; html: string } | undefined> {
  const q = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "text",
    redirects: "1",
    format: "json",
    formatversion: "2",
    disablelimitreport: "1",
    disableeditsection: "1",
  });
  const res = await fetchFn(`${API}?${q}`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return undefined;
  const p = ((await res.json()) as any)?.parse;
  if (!p?.text) return undefined;
  return { title: String(p.title ?? title), html: String(p.text) };
}

/**
 * The cited version of an article already read as plain text: the same picked sections, each sentence carrying the
 * marks of what it cites, and the references those marks name. The plain article stands when the page won't load.
 */
export async function citeArticle(
  article: WikiArticle,
  maxChars: number,
  focus: string | undefined,
  fetchFn: FetchLike = fetch,
): Promise<WikiArticle> {
  const page = await fetchWikiHtml(article.title, fetchFn).catch(
    () => undefined,
  );
  if (!page) return article;
  const { extract, refs } = parseCitedPage(page.html);
  if (!refs.size || extract.length < 400) return article;
  // The marks take room too: a little more budget keeps the same facts in.
  const picked = pickSections(extract, Math.round(maxChars * 1.08), focus);
  const r = renumber(picked, refs);
  if (picked.length < 400) return article;
  return { ...article, text: r.text, refs: r.refs };
}

// ---------------------------------------------------------------- the originals

const STOP = new Set(
  "the a an and or of to in on for with at by from as is was were be been it its that this which who his her their they he she has had have not but also after into than more most over".split(
    " ",
  ),
);
const contentWords = (t: string) =>
  new Set(
    stripRefMarks(t)
      .toLowerCase()
      .split(/[^a-z0-9$%]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** The sentences of a brief that cite reference n (pure). */
export function sentencesCiting(text: string, n: number): string[] {
  const mark = refMark(n);
  return text
    .split(/\n/)
    .flatMap((line) => line.split(/(?<=[.!?]["”’]?(?:⁽[⁰¹²³⁴⁵⁶⁷⁸⁹]+⁾)+)\s+/))
    .filter((s) => s.includes(mark));
}

/**
 * The part of an original that backs what the brief cites it for (pure): its paragraphs ranked by the words they share
 * with the citing sentences, kept in their own order, within the budget. Empty when nothing overlaps.
 */
export function excerptFor(
  primary: string,
  citing: readonly string[],
  budget = 1400,
): string {
  const want = new Set(citing.flatMap((s) => [...contentWords(s)]));
  if (!want.size) return "";
  const paras = primary
    .split(/\n+/)
    .map((p, i) => ({ p: p.trim(), i }))
    .filter((x) => x.p.length > 40);
  const scored = paras
    .map((x) => {
      const w = contentWords(x.p);
      let hit = 0;
      for (const k of w) if (want.has(k)) hit++;
      return { ...x, hit };
    })
    .filter((x) => x.hit >= 2)
    .sort((a, b) => b.hit - a.hit || a.i - b.i);
  const keep: typeof scored = [];
  let used = 0;
  for (const x of scored) {
    if (used + x.p.length > budget && keep.length) continue;
    keep.push(x);
    used += x.p.length + 1;
    if (used >= budget) break;
  }
  return keep
    .sort((a, b) => a.i - b.i)
    .map((x) =>
      x.p.length > budget
        ? `${x.p.slice(0, budget).replace(/\s+\S*$/, "")} …`
        : x.p,
    )
    .join("\n");
}

/**
 * Reads the most-cited originals and adds their own words to the brief under "[Outlet] headline" (the header the
 * on-screen credit reads), the original first and its archived copy when the original won't open. At most `max`
 * reads, each within its time; one that fails or says nothing relevant is skipped. Never touches Wikipedia itself.
 */
export async function readPrimaries(
  article: WikiArticle,
  read: (url: string) => Promise<{ title: string; text: string } | undefined>,
  opts: { max?: number; budget?: number; skip?: ReadonlySet<string> } = {},
): Promise<WikiArticle> {
  const refs = article.refs ?? [];
  if (!refs.length) return article;
  const max = opts.max ?? 4;
  const byN = new Map(refs.map((r) => [r.n, r]));
  const order = marksIn(article.text)
    .map((n) => byN.get(n))
    .filter((r): r is WikiRef => Boolean(r && (r.url || r.archive)))
    .filter((r) => !/wikipedia\.org/.test(r.url ?? ""))
    .filter((r) => !opts.skip?.has(r.url ?? ""));
  const parts: string[] = [];
  const primaries: PrimaryRead[] = [...(article.primaries ?? [])];
  for (const r of order) {
    if (primaries.length >= max + (article.primaries?.length ?? 0)) break;
    let got: { title: string; text: string; url: string } | undefined;
    for (const u of [r.url, r.archive].filter((x): x is string => Boolean(x))) {
      const a = await read(u).catch(() => undefined);
      if (a?.text && a.text.length > 300) {
        got = { ...a, url: r.url ?? u };
        break;
      }
    }
    if (!got) continue;
    const excerpt = excerptFor(
      got.text,
      sentencesCiting(article.text, r.n),
      opts.budget ?? 1400,
    );
    if (excerpt.length < 60) continue;
    const title = (r.title || got.title || "").replace(/\s+/g, " ").trim();
    parts.push(
      `[${r.outlet}] ${title}${r.date ? ` (${r.date.slice(0, 10)})` : ""} ${refMark(r.n)}\n${excerpt}`,
    );
    primaries.push({
      n: r.n,
      url: got.url,
      outlet: r.outlet,
      title,
      chars: excerpt.length,
    });
  }
  if (!parts.length) return article;
  return {
    ...article,
    text: `${article.text}\n\n${parts.join("\n\n")}`,
    primaries,
  };
}

/**
 * The originals a script's sources should credit (pure): the primaries read for its briefs first, then the other
 * references its briefs cited, each address once. Wikipedia itself is never in the list.
 */
export function primaryCredits(
  articles: ReadonlyArray<Pick<WikiArticle, "refs" | "primaries">>,
  max = 12,
): Array<{ name: string; url: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; url: string }> = [];
  const add = (name: string, url?: string) => {
    if (
      !url ||
      seen.has(url) ||
      /wikipedia\.org/.test(url) ||
      out.length >= max
    )
      return;
    seen.add(url);
    out.push({ name, url });
  };
  for (const a of articles)
    for (const p of a.primaries ?? []) add(p.outlet, p.url);
  for (const a of articles) for (const r of a.refs ?? []) add(r.outlet, r.url);
  return out;
}

/**
 * A description's source lines (pure): each address under the name people know its outlet by. Wikipedia only when
 * nothing else is listed (a script written before PRIMARY_SOURCES), so the description credits the record.
 */
export function descriptionSources(urls: readonly string[]): string[] {
  const others = urls.filter((u) => !/wikipedia\.org/.test(u));
  const list = others.length ? others : urls;
  return [...new Set(list)].map((u) =>
    /wikipedia\.org/.test(u) ? `• Wikipedia: ${u}` : `• ${outletName(u)}: ${u}`,
  );
}
