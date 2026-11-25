// Wikis as a lead finder (WIKI_LEADS, 20 Nov 2026). The fan wikis (Fandom, wiki.gg and the dedicated wikis) hold the
// timelines, trivia and behind-the-scenes notes no press story repeats. Here they are only a map: each wiki line
// becomes a lead, and a lead becomes a fact candidate only when the primary source the wiki cites, read at that
// source, says the same thing (its numbers and its names). The writers then get the primary source's own text, never
// the wiki's, and the channel never says "according to a wiki" or "according to Wikipedia" (owner, 13 Nov 2026:
// primary sources, attributed sparingly; src/editorial/attribution.ts guards the air).
//
// Reading is through each wiki's MediaWiki API (api.php?action=parse), which Fandom's robots.txt allows by name and
// wiki.gg allows for every reader ("use=reference"; never for model training, which this is not), at a polite pace
// (src/sources/polite.ts). A lead whose wiki gives no source, or whose source does not back it, stays a lead: the
// story finder may look into it, the air never hears it.
//
// On disk: <dataDir>/wikileads/<game slug>.json. Fed to the writers' room as primary sources (src/roomstep.ts
// leadPrimaries) and to the documentary picker's arc reading (src/docpick.ts PickDeps.leads).

import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { canonicalGame } from "../assets/gamelib.ts";
import { sceneSlug } from "../sceneindex/schema.ts";
import {
  normaliseText,
  originalUrl,
  sourceAllowed,
} from "../factvault/normalise.ts";
import { pageFromHtml, type PageText } from "../factvault/harvest.ts";
import type { ArticleText } from "../discovery/article.ts";
import { errorMessage, log } from "../lib/util.ts";
import { sharedPolite, type PoliteFetch } from "./polite.ts";

export const WIKI_LEADS_VERSION = 1;

/** The wiki for a game: its API and the page about the game itself. */
export interface WikiSite {
  api: string;
  /** Page titles to read, the game's own page first. */
  pages: string[];
}

/** Known wikis by the game (or series) they cover; anything else tries "<series>.fandom.com". */
const KNOWN: Array<{
  match: RegExp;
  api: string;
  page?: (game: string) => string[];
}> = [
  { match: /grand theft auto|^gta\b/i, api: "https://gta.fandom.com/api.php" },
  { match: /red dead/i, api: "https://reddead.fandom.com/api.php" },
  { match: /elden ring/i, api: "https://eldenring.fandom.com/api.php" },
  { match: /cyberpunk/i, api: "https://cyberpunk.fandom.com/api.php" },
  { match: /witcher/i, api: "https://witcher.fandom.com/api.php" },
  { match: /fallout/i, api: "https://fallout.fandom.com/api.php" },
  {
    match: /elder scrolls|skyrim|oblivion/i,
    api: "https://elderscrolls.fandom.com/api.php",
  },
  { match: /\bhalo\b/i, api: "https://halo.fandom.com/api.php" },
  { match: /zelda/i, api: "https://zeldawiki.wiki/w/api.php" },
  { match: /minecraft/i, api: "https://minecraft.wiki/api.php" },
  { match: /terraria/i, api: "https://terraria.wiki.gg/api.php" },
  { match: /hollow knight/i, api: "https://hollowknight.wiki/api.php" },
  { match: /baldur'?s gate/i, api: "https://bg3.wiki/w/api.php" },
  { match: /stardew/i, api: "https://stardewvalleywiki.com/mediawiki/api.php" },
  { match: /resident evil/i, api: "https://residentevil.fandom.com/api.php" },
  { match: /call of duty/i, api: "https://callofduty.fandom.com/api.php" },
  {
    match: /assassin'?s creed/i,
    api: "https://assassinscreed.fandom.com/api.php",
  },
  { match: /god of war/i, api: "https://godofwar.fandom.com/api.php" },
  { match: /mass effect/i, api: "https://masseffect.fandom.com/api.php" },
  { match: /final fantasy/i, api: "https://finalfantasy.fandom.com/api.php" },
  { match: /pok[eé]mon/i, api: "https://bulbapedia.bulbagarden.net/w/api.php" },
];

/** The wiki to read for a game (pure). */
export function wikiFor(game: string): WikiSite {
  const g = canonicalGame(game);
  const hit = KNOWN.find((k) => k.match.test(g) || k.match.test(game));
  const series = g
    .toLowerCase()
    .replace(/[:\-–].*$/, "")
    .replace(/\b(the|of|and|[ivx]+|\d+)\b/g, "")
    .replace(/[^a-z]/g, "");
  const api = hit?.api ?? `https://${series || "community"}.fandom.com/api.php`;
  return {
    api,
    pages: hit?.page?.(g) ?? [g, `${g}/Trivia`, `${g}/Development`],
  };
}

export type LeadKind = "trivia" | "development" | "timeline" | "history";

export interface WikiLead {
  id: string;
  game: string;
  kind: LeadKind;
  text: string;
  section: string;
  /** Where the lead was found (kept for the record only: never named on air). */
  wikiUrl: string;
  /** The sources the wiki cites for this line, wikis and Wikipedia left out. */
  refs: string[];
  /** The citation is the next sentence's: verified only with a name and a figure, all found. */
  borrowed?: boolean;
  /** Hedged or guessing wording: never a fact candidate. */
  speculative: boolean;
  status: "verified" | "unverified" | "unsourced" | "speculative";
  /** Set when verified: the primary source that says it, and the words found there. */
  primary?: { url: string; title: string; matched: string[]; excerpt: string };
}

export interface WikiLeadFile {
  version: number;
  game: string;
  wiki: string;
  updatedAt: string;
  leads: WikiLead[];
}

/** The sections that hold leads, and the kind each gives (pure). */
export function sectionKind(title: string): LeadKind | undefined {
  const t = title.toLowerCase();
  if (/trivia|did you know|fun facts?|easter eggs?/.test(t)) return "trivia";
  if (
    /development|production|behind the scenes|design|cut content|beta|prerelease|pre-release/.test(
      t,
    )
  )
    return "development";
  if (/timeline|chronolog/.test(t)) return "timeline";
  if (/history|release|marketing|announcement|reception|legacy/.test(t))
    return "history";
  return undefined;
}

/** Hedged or guessing wording a lead may not be verified from. */
export const SPECULATIVE =
  /\b(rumou?r\w*|specul\w*|it is (believed|thought|possible)|possibly|perhaps|likely|may (be|have)|might|could be|allegedly|unconfirmed|fan theor\w*|it seems|appears to|unclear|unknown|disputed|conflicting|some (sites|sources|fans)|others claim)\b/i;

/** Wikis, encyclopaedias and forums: never a primary source. Any host or path that says "wiki" counts. */
export const WIKI_HOST =
  /(^|\.)(fandom\.com|wikia\.com|fextralife\.com|bulbagarden\.net|tvtropes\.org|reddit\.com|wikiwand\.com)$|wiki/i;

/** An archived copy's original address (pure). */
const unwrap = (u: string): string => originalUrl(u);

const notPrimary = (u: string): boolean => {
  try {
    return NOT_PRIMARY.test(new URL(unwrap(u)).hostname);
  } catch {
    return true;
  }
};

export const isWikiUrl = (u: string): boolean => {
  try {
    const x = new URL(unwrap(u));
    return WIKI_HOST.test(x.hostname) || /\/wikis?\//i.test(x.pathname);
  } catch {
    return true;
  }
};

const leadId = (game: string, text: string) =>
  `${sceneSlug(canonicalGame(game))}-${normaliseText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48)}`;

/** The leads in a parsed wiki page (pure): lines under the lead sections, with the sources each cites. */
export function leadsFromHtml(
  html: string,
  game: string,
  wikiUrl: string,
): WikiLead[] {
  const $ = cheerio.load(html);
  const notes = new Map<string, string[]>();
  $('li[id^="cite_note"]').each((_, li) => {
    const links = $(li)
      .find("a[href^='http']")
      .map((_, a) => $(a).attr("href") ?? "")
      .get()
      .filter(
        (h) =>
          /^https?:/.test(h) &&
          !isWikiUrl(h) &&
          !/web\.archive\.org\/web\/\d+\/?$/.test(h),
      );
    notes.set($(li).attr("id") ?? "", [...new Set(links)]);
  });
  const out: WikiLead[] = [];
  let section = "";
  let kind: LeadKind | undefined;
  $(".mw-parser-output")
    .first()
    .children()
    .each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
      if (/^h[2-4]$/.test(tag) || $(el).hasClass("mw-heading")) {
        section = $(el)
          .text()
          .replace(/\[edit[^\]]*\]/gi, "")
          .trim();
        kind = sectionKind(section);
        return;
      }
      if (!kind) return;
      const blocks =
        tag === "ul" || tag === "ol"
          ? $(el).children("li").toArray()
          : tag === "p"
            ? [el]
            : [];
      for (const b of blocks) {
        // Each citation becomes a marker in the text, so every sentence keeps the sources cited for it; a sentence
        // with none takes the next citation in its paragraph (wikis often cite once at the end of a paragraph).
        const c = $(b).clone();
        c.find("ul, ol, style, .mw-editsection").remove();
        c.find("sup.reference").each((_, sup) => {
          const id = (
            $(sup).find("a[href^='#cite_note']").attr("href") ?? ""
          ).slice(1);
          $(sup).replaceWith(id ? ` [[ref:${id}]] ` : " ");
        });
        c.find("sup").remove();
        const marked = c.text().replace(/\s+/g, " ").trim();
        const sentences = splitMarked(marked);
        sentences.forEach((sen, i) => {
          // Only the sentence right before a cited one borrows its citation, and is held to a stricter check.
          const borrowed =
            !sen.ids.length &&
            i + 1 < sentences.length &&
            sentences[i + 1]!.ids.length > 0;
          const ids = sen.ids.length
            ? sen.ids
            : borrowed
              ? sentences[i + 1]!.ids
              : [];
          const refs = [...new Set(ids.flatMap((id) => notes.get(id) ?? []))];
          const text = sen.text;
          if (text.length < 40 || text.length > 400) return;
          if (!standsAlone(text)) return;
          const speculative = SPECULATIVE.test(text);
          const k: LeadKind =
            kind === "history" &&
            /^(in |on |by )?(\w+ )?(\d{1,2} )?\w* ?\d{4}\b/i.test(text)
              ? "timeline"
              : kind!;
          out.push({
            id: leadId(game, text),
            game: canonicalGame(game),
            kind: k,
            text,
            section,
            wikiUrl,
            refs,
            ...(borrowed && refs.length ? { borrowed: true } : {}),
            speculative,
            status: speculative
              ? "speculative"
              : refs.length
                ? "unverified"
                : "unsourced",
          });
        });
      }
    });
  const seen = new Set<string>();
  return out.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

/**
 * Whether a sentence makes sense on its own (pure): not a piece of a quotation (unbalanced quote marks) and not
 * leaning on the sentence before it ("This is the equivalent of ...", "According to X, it ...").
 */
export function standsAlone(text: string): boolean {
  const quotes = (text.match(/["“”]/g) ?? []).length;
  if (quotes % 2 === 1) return false;
  if (/^[a-z]/.test(text)) return false;
  if (
    /^(this|that|these|those|it|its|he|she|they|his|her|their|there|such|both|also|however|but|and|so|when|which)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /^according to [^,]{3,60}, (this|that|it|these|they|he|she)\b/i.test(text)
  )
    return false;
  return true;
}
/**
 * A paragraph with citation markers split into sentences (pure): each sentence's text without markers and the
 * citations inside it or right after its full stop.
 */
export function splitMarked(
  marked: string,
): Array<{ text: string; ids: string[] }> {
  const out: Array<{ text: string; ids: string[] }> = [];
  // Break after . ! ? (and any markers that follow it) before a capital or a quote: "A did B. [[ref:x]] Then C."
  const parts = marked.split(
    /(?<=[.!?]["”’)]?(?:\s*\[\[ref:[^\]]+\]\])*)\s+(?=[A-Z0-9"“])/,
  );
  for (const p of parts) {
    const ids = [...p.matchAll(/\[\[ref:([^\]]+)\]\]/g)].map((m) => m[1]!);
    const text = p
      .replace(/\s*\[\[ref:[^\]]+\]\]\s*/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ text, ids });
  }
  return out;
}

/** Words that open a sentence or name nothing in particular, never a lead's distinguishing name. */
const COMMON =
  /^(the|a|an|in|on|at|by|for|this|that|these|those|it|its|he|she|they|his|her|their|there|when|while|after|before|during|although|however|also|both|one|some|many|most|according|if|as|with|from|to|of|and|but|or|was|is|are|were|game|games|player|players|version|edition|update|mission|missions|trailer|series)$/i;

/** Days and months: dates, never a lead's distinguishing name. */
const CALENDAR =
  /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i;

/** The units a figure is checked with, as a pattern that also takes the singular or the other spelling. */
const UNITS: Array<[RegExp, string]> = [
  [/^(%|per ?cent|percent)$/i, "(?:%|\\s*per ?cent)"],
  [/^million$/i, "\\s*(?:million|m\\b)"],
  [/^billion$/i, "\\s*(?:billion|bn\\b)"],
  [/^thousand$/i, "\\s*thousand"],
  [/^hundred$/i, "\\s*hundred"],
];
const UNIT_WORD =
  /^(%|per ?cent|percent|million|billion|thousand|hundred|copies|players|hours|years|days|times|units|views|weeks|months)$/i;

/** A figure as a pattern over lower-cased text (pure): "8" never matches "8.5" or "18", "8 million" never "8 years". */
export function figurePattern(figure: string): RegExp {
  const [value, ...rest] = figure.split(" ");
  const unit = rest.join(" ");
  const v = value!.replace(/\./g, "\\.");
  let u = "";
  if (unit) {
    const known = UNITS.find(([re]) => re.test(unit));
    u = known ? known[1] : `\\s*${unit.replace(/s$/i, "")}s?\\b`;
  }
  return new RegExp(`(^|[^0-9.,])${v}(?![0-9]|[.,][0-9])${u}`, "i");
}

/**
 * What a primary source must contain for a lead to count as verified (pure): every figure with the unit it counts
 * ("8 million", "24 hours"; the game's own title number aside, a lone single digit only with a unit) and its names
 * (the game's own words, dates and sentence openers aside).
 */
export function leadNeeds(
  text: string,
  game: string,
): { figures: string[]; names: string[] } {
  const gameWords = new Set(
    canonicalGame(game)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const plain = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const figures: string[] = [];
  for (const m of plain.matchAll(
    /(?<!\d|\d\.)(\d+(?:\.\d+)?)(?!\d|\.\d)(?:\s*(%|per ?cent|[a-z]+))?/gi,
  )) {
    const value = m[1]!;
    const unit = m[2] && UNIT_WORD.test(m[2]) ? m[2].toLowerCase() : "";
    if (value.length < 2 && Number(value) <= 9 && !unit) continue;
    if (!unit && gameWords.has(value)) continue;
    const f = unit ? `${value} ${unit}` : value;
    if (!figures.includes(f)) figures.push(f);
  }
  const names: string[] = [];
  for (const m of text.matchAll(
    /\b((?:[A-Z][a-zA-Z'’.-]{2,}|[A-Z]{2,})(?:\s+(?:[A-Z][a-zA-Z'’.-]{2,}|[A-Z]{2,}))*)/g,
  )) {
    const n = m[1]!.replace(/(['’]s|[.'’])+$/, "");
    const words = n.split(/\s+/);
    if (
      COMMON.test(n) ||
      CALENDAR.test(n) ||
      words.every((w) => gameWords.has(w.toLowerCase()))
    )
      continue;
    // A capital that only opens the sentence ("Development of ...") is not a name.
    const at = m.index ?? 0;
    if (
      words.length === 1 &&
      (at === 0 || /[.!?]\s+$/.test(text.slice(0, at))) &&
      /^[A-Z][a-z]+$/.test(n)
    )
      continue;
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return { figures, names: names.slice(0, 6) };
}

/**
 * Whether a primary source's text backs a lead (pure). Every figure, with its unit, must be there, and every name
 * (all but one when the lead has four or more). There must be something specific to check: at least one name, or a
 * figure that counts something. A lead that borrowed its citation needs a name and a figure.
 */
export function backs(
  sourceText: string,
  lead: Pick<WikiLead, "text" | "game" | "borrowed">,
): string[] | undefined {
  const raw = ` ${sourceText
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")} `;
  const norm = ` ${normaliseText(sourceText)} `;
  const { figures, names } = leadNeeds(lead.text, lead.game);
  // Quoted words ("thinly-written") and numbers in words ("six other covers") must be in the source too.
  const quotes = [...lead.text.matchAll(/["“]([^"”]{2,120})["”]/g)].map((m) =>
    m[1]!.trim(),
  );
  const counts = [...lead.text.toLowerCase().matchAll(NUMBER_WORDS)].map(
    (m) => m[1]!,
  );
  const counted = figures.some((f) => f.includes(" "));
  if (!names.length && !counted) return undefined;
  // One name and nothing else to check is too thin.
  if (!figures.length && !quotes.length && !counts.length && names.length < 2)
    return undefined;
  if (lead.borrowed && (!names.length || !figures.length)) return undefined;
  if (!figures.every((f) => figurePattern(f).test(raw))) return undefined;
  // Whole words: "Florida" is found in "Florida's Keys", never inside "Floridas".
  const word = (w: string) =>
    new RegExp(
      `(^|[^a-z0-9])${normaliseText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`,
    ).test(norm);
  if (!quotes.every(word) || !counts.every(word)) return undefined;
  const found = names.filter(word);
  const need =
    names.length >= 4 && !lead.borrowed ? names.length - 1 : names.length;
  if (found.length < need) return undefined;
  return [...new Set([...figures, ...counts, ...quotes, ...found])];
}

/** Counts written as words, checked like figures. */
const NUMBER_WORDS =
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|dozen)\b/g;

/** Statistics farms and resellers that copy wikis: never the primary source a lead is checked against. */
export const NOT_PRIMARY =
  /(^|\.)(levvvel\.com|demandsage\.com|earthweb\.com|gitnux\.org|zipdo\.co|wifitalents\.com|playercounter\.com|thegamer\.com\/wiki|gamerant\.com\/wiki)$/i;
/** The paragraphs of a source that carry the matched words, for the writers (pure). */
export function excerptOf(text: string, matched: string[], max = 1500): string {
  const paras = text.split(/\n+/);
  const want = matched.map((m) => normaliseText(m));
  const hits = paras.filter((p) => {
    const n = normaliseText(p);
    return want.some((w) => n.includes(w));
  });
  return (hits.length ? hits : paras).join("\n").slice(0, max);
}

export interface LeadOptions {
  fetch?: PoliteFetch;
  read?: (url: string) => Promise<PageText | undefined>;
  /** At most this many leads checked at their sources (default 25), and sources read per lead (default 2). */
  maxChecks?: number;
  refsPerLead?: number;
}

/** One wiki page through the MediaWiki API: its HTML, or undefined when the page does not exist. */
async function parsePage(
  api: string,
  page: string,
  fetch: PoliteFetch,
): Promise<{ html: string; url: string } | undefined> {
  const q = new URLSearchParams({
    action: "parse",
    page,
    prop: "text",
    redirects: "1",
    format: "json",
    formatversion: "2",
    disabletoc: "1",
  });
  const res = await fetch(`${api}?${q}`);
  if (!res.ok) return undefined;
  const j = (await res.json().catch(() => ({}))) as {
    parse?: { text?: string; title?: string };
  };
  if (!j.parse?.text) return undefined;
  const base = api.replace(/\/(w\/|mediawiki\/)?api\.php$/, "");
  return {
    html: j.parse.text,
    url: `${base}/wiki/${encodeURIComponent((j.parse.title ?? page).replace(/ /g, "_"))}`,
  };
}

/** A game's leads from its wiki, the sourced ones checked at their primary sources. Never throws. */
export async function findWikiLeads(
  game: string,
  o: LeadOptions = {},
): Promise<WikiLeadFile> {
  const fetch = o.fetch ?? sharedPolite();
  const site = wikiFor(game);
  const read =
    o.read ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml" },
      }).catch(() => undefined);
      if (
        !res?.ok ||
        !/html|xml|text/i.test(res.headers.get("content-type") ?? "")
      )
        return undefined;
      return pageFromHtml(await res.text(), url);
    });
  const leads: WikiLead[] = [];
  for (const page of site.pages) {
    try {
      const got = await parsePage(site.api, page, fetch);
      if (!got) continue;
      for (const l of leadsFromHtml(got.html, game, got.url))
        if (!leads.some((x) => x.id === l.id)) leads.push(l);
    } catch (err) {
      log("info", "wiki page unavailable", {
        api: site.api,
        page,
        error: errorMessage(err),
      });
    }
  }
  // Sourced, specific leads first: those with figures, then the trivia and development notes.
  const order = (l: WikiLead) =>
    (leadNeeds(l.text, l.game).figures.length ? 0 : 1) +
    (l.kind === "trivia" || l.kind === "development" ? 0 : 0.5);
  const toCheck = leads
    .filter((l) => l.status === "unverified")
    .sort((a, b) => order(a) - order(b))
    .slice(0, o.maxChecks ?? 25);
  const pages = new Map<string, Promise<PageText | undefined>>();
  for (const l of toCheck) {
    for (const url of l.refs
      .filter((u) => sourceAllowed(u) && !isWikiUrl(u) && !notPrimary(u))
      .slice(0, o.refsPerLead ?? 2)) {
      let p = pages.get(url);
      if (!p) {
        p = read(url).catch(() => undefined);
        pages.set(url, p);
      }
      const src = await p;
      if (!src || src.text.length < 200) continue;
      const matched = backs(`${src.title}\n${src.text}`, l);
      if (!matched) continue;
      l.status = "verified";
      l.primary = {
        url,
        title: src.title,
        matched,
        excerpt: excerptOf(src.text, matched),
      };
      break;
    }
  }
  return {
    version: WIKI_LEADS_VERSION,
    game: canonicalGame(game),
    wiki: site.api,
    updatedAt: new Date().toISOString(),
    leads,
  };
}

export function wikiLeadsRoot(dataDir: string): string {
  return process.env.WIKI_LEADS_DIR || path.join(dataDir, "wikileads");
}

const fileOf = (root: string, game: string) =>
  path.join(root, `${sceneSlug(canonicalGame(game))}.json`);

export async function readWikiLeads(
  root: string,
  game: string,
): Promise<WikiLeadFile | undefined> {
  try {
    const f = JSON.parse(
      await fs.readFile(fileOf(root, game), "utf8"),
    ) as WikiLeadFile;
    return f.version === WIKI_LEADS_VERSION && Array.isArray(f.leads)
      ? f
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeWikiLeads(
  root: string,
  f: WikiLeadFile,
): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const file = fileOf(root, f.game);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(f, null, 1), "utf8");
  await fs.rename(tmp, file);
}

/**
 * The verified leads as the writers' room's primary sources (pure): the primary source's own paragraphs only, never
 * the wiki's sentence. With `about` (the story's headline and items), only leads whose checked names or figures the
 * story mentions, so a Short is not handed unrelated trivia.
 */
export function leadPrimaries(
  f: WikiLeadFile | undefined,
  max = 3,
  about?: string,
): ArticleText[] {
  if (!f || !Array.isArray(f.leads)) return [];
  const story = about ? ` ${normaliseText(about)} ` : undefined;
  const relevant = (l: WikiLead) =>
    !story ||
    (l.primary?.matched ?? []).some(
      (m) => !/^\d/.test(m) && story.includes(` ${normaliseText(m)} `),
    );
  const byUrl = new Map<string, WikiLead[]>();
  for (const l of f.leads)
    if (l.status === "verified" && l.primary && relevant(l))
      byUrl.set(l.primary.url, [...(byUrl.get(l.primary.url) ?? []), l]);
  return [...byUrl.entries()].slice(0, max).map(([url, ls]) => ({
    url,
    title: ls[0]!.primary!.title || url,
    text: ls[0]!.primary!.excerpt,
  }));
}

/** The verified leads as one block of story material for the documentary picker's arc reading (pure). */
export function leadText(f: WikiLeadFile | undefined, max = 12): string {
  if (!f || !Array.isArray(f.leads)) return "";
  return f.leads
    .filter((l) => l.status === "verified")
    .slice(0, max)
    .map((l) => l.text)
    .join("\n");
}
