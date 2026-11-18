// The pictures behind the mention insets (MENTION_*, src/render/mentions.ts), found once per video and kept in its
// assets, each with where it came from and under what terms. No model call, nothing paid:
//
// - games: another game the narration names (a run of capitalised words, the writer's footage keywords and tags) is
//   looked up on the Steam store and kept only when the store title is that game (sequel numbers agree, no extra
//   words but an edition); its official library capsule (publisher-supplied store art) is the picture;
// - logos: a studio or publisher on the list below, said by name, gets the logo its Wikidata item files (P154), a
//   Wikimedia Commons file under a free licence or in the public domain (text logos); nothing from a fan site;
// - characters: a character the narration names whose official gallery picture the publisher's own site files under
//   that name ("Jason_Duval_01.jpg" on rockstargames.com); never anything generated;
// - real places: a pair on src/render/mentions.ts PLACE_PAIRS said together: the real place's own Wikidata photo (P18,
//   Commons, a free licence that allows commercial use, credited) beside an official picture of the game place, filed
//   under that place's name by the publisher (or already in the video under that name);
// - receipts: only outlets in the story's own sources (the articles it was written from, the attribution line and the
//   reports those articles cite), with the article's date when it has one.
//
// The platform row needs no picture (Pulse draws the marks). Placing everything on the voice's words is pure and lives
// here too (mentionsOnWords).

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { nameWords, sameGame, type SteamApp } from "./steam.ts";
import { commonsFile, faceSquare, FREE, PRESS } from "./people.ts";
import type { SiteAsset } from "./publishersite.ts";
import { placeFor } from "../render/places.ts";
import {
  COMPARE_WORDS,
  PLACE_PAIRS,
  attributedTimes,
  firstSaid,
  phraseTimes,
  phraseTokens,
  placePairAt,
  platformRuns,
  type MentionInset,
  type MentionKind,
  type MentionPicture,
} from "../render/mentions.ts";

const run = promisify(execFile);
const UA =
  "PulseGamingFactory/1.0 (https://pulse.orryy.com; licensed picture research)";

/** A picture in the episode folder, with its provenance. */
export interface MentionPictureFile {
  /** Relative to the episode folder. */
  file: string;
  label: string;
  sub?: string;
  credit?: string;
  aspect?: number;
  /** Where it came from and under what terms, in words (as people.ts and the image provenance lines say it). */
  provenance: string;
  sourceUrl: string;
  license?: string;
  pageUrl?: string;
}

/** One thing a video may show an inset for, before it is placed on the words. */
export interface MentionAsset {
  kind: Exclude<MentionKind, "platform">;
  key: string;
  /** What the narration says for it ("Red Dead Redemption 2", "Red Dead 2"). */
  aliases: string[];
  pictures: MentionPictureFile[];
  /** The video's own game: a partner in a comparison, never an inset of its own. */
  mainGame?: boolean;
  /** A real place and its game version: both must be said together. */
  pair?: { game: string[]; real: string[] };
  /** A receipt: the outlet, the article date (ISO) and the outlet that carried it. */
  receipt?: { outlet: string; date?: string; via?: string; url?: string };
}

/** What the gather keeps in the episode's assets: the kinds it looked for, and what it found. */
export interface MentionsFound {
  kinds: MentionKind[];
  items: MentionAsset[];
}

// ---- Games -------------------------------------------------------------------------------------------------------

/** Short forms players say, both ways ("GTA 5" is "Grand Theft Auto 5"). */
const SHORT_FORMS: Array<[string, string]> = [
  ["grand theft auto", "gta"],
  ["red dead redemption", "red dead"],
  ["call of duty", "cod"],
  ["the legend of zelda", "zelda"],
  ["counter-strike", "cs"],
  ["the elder scrolls", "elder scrolls"],
  ["final fantasy", "ff"],
];

/** The ways a game's name is said: the store title, before its subtitle colon, and the players' short forms. */
export function gameAliases(name: string): string[] {
  const clean = name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
  const out = new Set<string>([clean]);
  for (const a of [...out]) {
    const lower = a.toLowerCase();
    for (const [long, short] of SHORT_FORMS) {
      if (lower.includes(long)) out.add(lower.replace(long, short));
      else if (new RegExp(`\\b${short}\\b`).test(lower))
        out.add(lower.replace(new RegExp(`\\b${short}\\b`), long));
    }
  }
  return [...out];
}

/** Edition words a store title may add to the game the narration names. */
const EDITION =
  /^(remastered|remaster|definitive|edition|intergrade|goty|game|of|the|year|complete|enhanced|deluxe|ultimate|anniversary|directors|cut|royal|reload|hd)$/;

/**
 * Whether a store title is exactly the game a phrase names (pure): the words agree in order with sequel numbers
 * matching, and anything the store title adds is an edition ("Remastered", "Game of the Year Edition"). "Star Wars" is
 * not "Star Wars Jedi: Survivor"; "Battlefront 3" is not "Battlefront II".
 */
export function exactGame(term: string, storeName: string): boolean {
  if (!sameGame(term, storeName)) return false;
  const want = nameWords(term);
  const have = nameWords(storeName);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (!want.every((w, j) => have[i + j] === w)) continue;
    const extra = [...have.slice(0, i), ...have.slice(i + want.length)];
    if (extra.every((w) => EDITION.test(w))) return true;
  }
  return false;
}

/** Capitalised words that start a sentence or name an outlet, a month or a platform: never a game on their own. */
const NOT_A_GAME =
  /^(the|a|an|and|but|or|so|if|when|while|then|now|here|there|this|that|these|those|it|its|it's|that's|they|their|we|our|you|your|i|i'm|i'd|he|she|his|her|who|what|why|how|which|yes|no|not|just|still|even|also|after|before|since|until|for|with|from|per|according|meanwhile|plus|sources?|reportedly|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|steam|xbox|playstation|nintendo|switch|pc|ps5|ps4|ign|bloomberg|reuters|reddit|youtube|twitter|tiktok|discord|kotaku|polygon|eurogamer|gamespot|vgc)$/i;

/** Small words allowed inside a game's name ("Ghost of Tsushima", "Lord of the Rings"). */
const JOINER = /^(of|the|and|&|in|to|on|a|vs|for)$/i;

/**
 * Phrases in the spoken lines that could be another game (pure): runs of capitalised words, numbers and Roman numerals
 * (two to seven words, small joiners inside), plus the writer's footage keywords and tags that the narration says.
 * The video's own game is left out. Single words only from the writer's lists (a capitalised word alone is too often
 * the start of a sentence).
 */
export function gameCandidates(o: {
  spoken: string;
  listed: string[];
  mainGame: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const said = new Set<string>();
  const spokenToks = phraseTokens(o.spoken).join(" ");
  const isSaid = (p: string) =>
    ` ${spokenToks} `.includes(` ${phraseTokens(p).join(" ")} `);
  const push = (p: string, single: boolean) => {
    const t = p
      .replace(/[“”"()]/g, "")
      .replace(/[’']s$/i, "")
      .replace(/[,.;:!?]+$/, "")
      .trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (!words.length || (words.length === 1 && !single)) return;
    if (words.length === 1 && NOT_A_GAME.test(words[0]!)) return;
    if (o.mainGame && (sameGame(t, o.mainGame) || sameGame(o.mainGame, t)))
      return;
    const k = phraseTokens(t).join(" ");
    if (!k || seen.has(k) || !isSaid(t)) return;
    seen.add(k);
    out.push(t);
    said.add(k);
  };
  for (const sentence of o.spoken.split(/(?<=[.!?])\s+/)) {
    const toks = sentence.split(/\s+/).filter(Boolean);
    let runW: string[] = [];
    const flush = () => {
      while (runW.length && JOINER.test(runW[runW.length - 1]!)) runW.pop();
      while (
        runW.length &&
        NOT_A_GAME.test(runW[0]!.replace(/[^\p{L}'’]/gu, ""))
      )
        runW.shift();
      if (runW.length >= 2 && runW.length <= 7) {
        const whole = runW.join(" ");
        push(whole, false);
        // "Red Dead Redemption 2 and Star Wars": each side too (a title with "and" in it keeps the whole run first).
        for (const part of whole.split(/\s+(?:and|&|vs|or)\s+/i))
          if (part !== whole) push(part, false);
      }
      runW = [];
    };
    for (const raw of toks) {
      const w = raw.replace(/^[(“"‘']+/, "");
      const bare = w.replace(/[,.;:!?)”"’']+$/, "").replace(/[’']s$/, "");
      const capital = /^[A-Z0-9][\p{L}\p{N}'’&:-]*$/u.test(bare);
      const numeral = /^(\d{1,2}|[IVX]{1,4})$/.test(bare);
      if (capital || numeral || (runW.length && JOINER.test(bare)))
        runW.push(bare);
      else flush();
      // A run ends at the word's own punctuation ("Red Dead 2, and").
      if (/[,.;:!?)”"]$/.test(w) || /[’']s$/.test(w.replace(/[,.;:!?]+$/, "")))
        flush();
    }
    flush();
  }
  for (const l of o.listed) push(l, true);
  return out;
}

// ---- Logos ------------------------------------------------------------------------------------------------------

/**
 * Studios and publishers a logo chip may show, each with the names that say it and the Wikipedia article whose
 * Wikidata item files its logo. Only these: the logo is the company's own and lands only on its own name.
 */
export const COMPANIES: Array<{
  key: string;
  names: string[];
  article: string;
}> = [
  {
    key: "rockstar",
    names: ["Rockstar Games", "Rockstar"],
    article: "Rockstar Games",
  },
  {
    key: "taketwo",
    names: ["Take-Two Interactive", "Take-Two", "Take Two"],
    article: "Take-Two Interactive",
  },
  { key: "nintendo", names: ["Nintendo"], article: "Nintendo" },
  {
    key: "sony",
    names: ["Sony Interactive Entertainment", "Sony"],
    article: "Sony Interactive Entertainment",
  },
  { key: "microsoft", names: ["Microsoft"], article: "Microsoft" },
  { key: "valve", names: ["Valve"], article: "Valve Corporation" },
  { key: "ea", names: ["Electronic Arts", "EA"], article: "Electronic Arts" },
  { key: "ubisoft", names: ["Ubisoft"], article: "Ubisoft" },
  {
    key: "bethesda",
    names: ["Bethesda Softworks", "Bethesda"],
    article: "Bethesda Softworks",
  },
  { key: "capcom", names: ["Capcom"], article: "Capcom" },
  { key: "squareenix", names: ["Square Enix"], article: "Square Enix" },
  { key: "activision", names: ["Activision"], article: "Activision" },
  {
    key: "blizzard",
    names: ["Blizzard Entertainment", "Blizzard"],
    article: "Blizzard Entertainment",
  },
  {
    key: "cdprojekt",
    names: ["CD Projekt Red", "CD Projekt"],
    article: "CD Projekt",
  },
  {
    key: "fromsoftware",
    names: ["FromSoftware", "From Software"],
    article: "FromSoftware",
  },
  { key: "sega", names: ["Sega"], article: "Sega" },
  {
    key: "bandainamco",
    names: ["Bandai Namco"],
    article: "Bandai Namco Entertainment",
  },
  { key: "konami", names: ["Konami"], article: "Konami" },
  { key: "bioware", names: ["BioWare"], article: "BioWare" },
  { key: "epic", names: ["Epic Games"], article: "Epic Games" },
  { key: "naughtydog", names: ["Naughty Dog"], article: "Naughty Dog" },
  {
    key: "insomniac",
    names: ["Insomniac Games", "Insomniac"],
    article: "Insomniac Games",
  },
  { key: "bungie", names: ["Bungie"], article: "Bungie" },
  { key: "idsoftware", names: ["id Software"], article: "Id Software" },
  { key: "machinegames", names: ["MachineGames"], article: "MachineGames" },
  {
    key: "arkane",
    names: ["Arkane Studios", "Arkane"],
    article: "Arkane Studios",
  },
  {
    key: "remedy",
    names: ["Remedy Entertainment", "Remedy"],
    article: "Remedy Entertainment",
  },
  {
    key: "larian",
    names: ["Larian Studios", "Larian"],
    article: "Larian Studios",
  },
];

/** The companies the spoken lines name (pure), in the order first said. Names are matched as whole words, case kept. */
export function companiesSaid(
  spoken: string,
): Array<(typeof COMPANIES)[number]> {
  const hits: Array<{ c: (typeof COMPANIES)[number]; at: number }> = [];
  for (const c of COMPANIES) {
    let at = -1;
    for (const n of c.names) {
      const re = new RegExp(
        `(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
        "u",
      );
      const m = spoken.match(re);
      if (m?.index !== undefined && (at < 0 || m.index < at)) at = m.index;
    }
    if (at >= 0) hits.push({ c, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.c);
}

/** Whether a Commons file may be shown as a company's logo chip, and why not (pure). */
export function logoAllowed(m: {
  title: string;
  license: string;
  usageTerms?: string;
  width: number;
  height: number;
}): { ok: true } | { ok: false; why: string } {
  const lic = m.license.trim();
  if (!lic) return { ok: false, why: "no licence stated" };
  if (
    /fair use|non-free|all rights reserved|\bnc\b|noncommercial|\bnd\b|noderiv/i.test(
      `${lic} ${m.usageTerms ?? ""}`,
    )
  )
    return { ok: false, why: `licence not free (${lic})` };
  // Text logos are public domain on Commons ("PD-textlogo", "Public domain"); a free licence also passes.
  if (
    !FREE.test(lic) &&
    !/public domain|pd[- ]?textlogo|pd[- ]?shape/i.test(lic)
  )
    return { ok: false, why: `licence not clearly free (${lic})` };
  if (!/\.(svg|png|jpe?g|webp)$/i.test(m.title))
    return { ok: false, why: "not a picture file" };
  if (Math.max(m.width, m.height) < 120) return { ok: false, why: "too small" };
  return { ok: true };
}

// ---- Characters ----------------------------------------------------------------------------------------------

/** First names that are also everyday words ("Real Dimez" is never "real"): the full name only. */
const COMMON_WORD =
  /^(real|big|little|young|old|lil|uncle|aunt|auntie|king|queen|boss|doc|sweet|ice|jet|baby|mister|miss|sir|lady|lord|cool|mad|crazy|lucky|happy|sunny|rich|grand|vice|port|mount|saint|san|los|las|new|north|south|east|west)$/i;

/**
 * The characters a publisher's site files pictures under (pure): a still's tag of two or three capitalised words that
 * is not a place we know (PLACE_PAIRS, the map gazetteer, or `places`), with the ways it is said: the full name, and
 * the first name alone when no other character shares it.
 */
export function characterTags(
  stills: Array<
    Pick<SiteAsset, "kind" | "tags" | "url" | "name" | "listedAt" | "publisher">
  >,
  places: string[] = [],
): Array<{ name: string; aliases: string[]; stills: typeof stills }> {
  const placeSet = new Set(
    [...PLACE_PAIRS.flatMap((p) => [...p.game, ...p.real]), ...places].map(
      (p) => phraseTokens(p).join(" "),
    ),
  );
  const by = new Map<string, typeof stills>();
  for (const s of stills) {
    if (s.kind !== "still") continue;
    const tag = s.tags[0]?.trim() ?? "";
    const words = tag.split(/\s+/);
    if (
      words.length < 2 ||
      words.length > 3 ||
      !words.every((w) => /^[A-Z][\p{L}'’]*$/u.test(w))
    )
      continue;
    if (placeSet.has(phraseTokens(tag).join(" ")) || placeFor(tag)) continue;
    by.set(tag, [...(by.get(tag) ?? []), s]);
  }
  const names = [...by.keys()];
  const first = (n: string) => n.split(/\s+/)[0]!;
  return names.map((name) => ({
    name,
    aliases: [
      name,
      ...(first(name).length >= 3 &&
      !COMMON_WORD.test(first(name)) &&
      names.filter((x) => first(x) === first(name)).length === 1
        ? [first(name)]
        : []),
    ],
    stills: by.get(name)!,
  }));
}

// ---- Receipts -------------------------------------------------------------------------------------------------

export interface StoryItem {
  url?: string;
  title?: string;
  source?: string;
  summary?: string;
  sourceKind?: string;
  publishedAt?: string;
}

/** Never a receipt: an encyclopedia, a wiki, a forum, a video site or the channel itself. */
const NOT_A_SOURCE =
  /wikipedia|wikidata|\bwiki\b|fandom|reddit|resetera|youtube|tiktok|\bpulse\b/i;

/** A first-party feed's name as the narration says the company ("Rockstar Newswire" is "Rockstar"). */
const FEED_SUFFIX =
  /\s+(newswire|news ?wire|blog|news|press|press releases?|official|store)$/i;

/**
 * The outlets a story's receipts may name (pure): every article it was written from (with its date), the first-party
 * feeds under the company's name, and the reports those articles or the attribution line cite ("Bloomberg via Push
 * Square"), dated by the earliest article that cites them. Nothing outside the story's own sources.
 */
export function receiptSources(o: {
  items: StoryItem[];
  attribution?: string;
  docSources?: Array<string | { url?: string; source?: string }>;
}): Array<{
  outlet: string;
  aliases: string[];
  date?: string;
  via?: string;
  url?: string;
}> {
  const out = new Map<
    string,
    {
      outlet: string;
      aliases: string[];
      date?: string;
      via?: string;
      url?: string;
    }
  >();
  const add = (
    outlet: string,
    extra: Partial<{ date: string; via: string; url: string }>,
    aliases: string[] = [],
  ) => {
    const name = outlet.replace(/\s+/g, " ").trim();
    if (!name || name.length > 40 || NOT_A_SOURCE.test(name)) return;
    const k = name.toLowerCase();
    const had = out.get(k);
    if (had) {
      if (extra.date && (!had.date || extra.date < had.date))
        Object.assign(had, extra);
      return;
    }
    out.set(k, {
      outlet: name,
      aliases: [...new Set([name, ...aliases])],
      ...extra,
    });
  };
  // Never an encyclopedia, a forum or Pulse itself: a receipt names the outlet that reported the fact (owner, 13 Nov).
  const items = o.items.filter((i) => i.source && !NOT_A_SOURCE.test(i.source));
  for (const it of items) {
    const feed =
      it.sourceKind === "official"
        ? it.source!.replace(FEED_SUFFIX, "")
        : undefined;
    add(
      it.source!,
      {
        ...(it.publishedAt ? { date: it.publishedAt } : {}),
        ...(it.url ? { url: it.url } : {}),
      },
      feed ? [feed] : [],
    );
  }
  // The attribution line: "Source: Bloomberg via Push Square / GameSpot".
  const attr = (o.attribution ?? "").replace(/^sources?:\s*/i, "");
  const cited = new Set<string>();
  for (const part of attr.split(/\s*[/,;&]\s*|\s+and\s+/)) {
    const [first] = part.split(/\s+via\s+/i);
    if (first?.trim()) cited.add(first.trim());
  }
  for (const c of cited) {
    if (out.has(c.toLowerCase())) continue;
    // Dated and carried by the earliest article that names it.
    const re = new RegExp(
      `\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    const carriers = items
      .filter((i) => re.test(`${i.title ?? ""} ${i.summary ?? ""}`))
      .sort((a, b) =>
        String(a.publishedAt ?? "").localeCompare(String(b.publishedAt ?? "")),
      );
    const c0 = carriers[0];
    if (!c0 && !items.length) add(c, {});
    else if (c0)
      add(c, {
        ...(c0.publishedAt ? { date: c0.publishedAt } : {}),
        via: c0.source!,
        ...(c0.url ? { url: c0.url } : {}),
      });
  }
  // A long video's own sources list (articles, or outlet names): undated unless the address carries the month.
  for (const s of o.docSources ?? []) {
    const url =
      typeof s === "string" ? (/^https?:/.test(s) ? s : undefined) : s.url;
    const name = typeof s === "string" ? (url ? undefined : s) : s.source;
    const ym = url?.match(/\/(20\d\d)\/(0[1-9]|1[0-2])\//);
    if (name)
      add(name, {
        ...(ym ? { date: `${ym[1]}-${ym[2]}` } : {}),
        ...(url ? { url } : {}),
      });
  }
  return [...out.values()];
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** "OCT 30, 2026" (or "OCT 2026" for a month alone), as the receipt chip prints a date; undefined when unknown. */
export function receiptDate(iso: string | undefined): string | undefined {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return undefined;
  const mon = MONTHS[Number(m[2]) - 1];
  if (!mon) return undefined;
  return m[3] ? `${mon} ${Number(m[3])}, ${m[1]}` : `${mon} ${m[1]}`;
}

// ---- Placing on the words (pure) --------------------------------------------------------------------------------

type Word = { text: string; start: number; end?: number };

/** The sentence a moment sits in: the voice's words from the last full stop before it to the next. */
function sentenceAround(words: Word[], t: number): string {
  let a = words.findIndex((w) => w.start >= t - 0.01);
  if (a < 0) return "";
  let z = a;
  while (a > 0 && !/[.!?]["”’)]?$/.test(words[a - 1]!.text)) a--;
  while (z < words.length - 1 && !/[.!?]["”’)]?$/.test(words[z]!.text)) z++;
  return words
    .slice(a, z + 1)
    .map((w) => w.text)
    .join(" ");
}

/**
 * Whether the company name said at `at` runs on into another name (pure): the word after the longest alias that
 * matches there is capitalised and the name does not end its sentence ("Rockstar North's", "EA Sports").
 */
export function namesSomethingElse(
  words: Word[],
  at: number,
  aliases: string[],
): boolean {
  const i = words.findIndex((w) => Math.abs(w.start - at) < 0.001);
  if (i < 0) return false;
  let n = 0;
  for (const a of aliases)
    if (phraseTimes(words.slice(i), a)[0] === words[i]!.start)
      n = Math.max(n, a.split(/\s+/).filter(Boolean).length);
  const last = words[i + Math.max(1, n) - 1];
  const next = words[i + Math.max(1, n)];
  if (!last || !next || /[.!?,;:]["”’)]?$/.test(last.text)) return false;
  return /^[A-Z]/.test(next.text.replace(/^[("“‘']+/, ""));
}

const pic = (p: MentionPictureFile): MentionPicture => ({
  src: p.file,
  label: p.label,
  ...(p.sub ? { sub: p.sub } : {}),
  ...(p.credit ? { credit: p.credit } : {}),
  ...(p.aspect ? { aspect: p.aspect } : {}),
});

/**
 * The insets on the voice's words (pure), every time each thing is said (the schedule keeps the first, and a long
 * video's repeats): a game, logo or character on its name; a real place where it and its game version are said
 * together; a receipt only where the outlet is said as the source of a fact; the platform row on a spoken list. A
 * game in a comparison sentence stands beside the video's own game. Pictures stay as episode-relative paths (`src`).
 */
export function mentionsOnWords(
  items: MentionAsset[],
  words: Word[],
  o: { kinds: ReadonlySet<MentionKind> },
): MentionInset[] {
  const out: MentionInset[] = [];
  const main = items.find((i) => i.mainGame && i.kind === "game");
  for (const it of items) {
    if (it.mainGame || !o.kinds.has(it.kind)) continue;
    if (it.kind === "receipt") {
      const r = it.receipt;
      if (!r) continue;
      for (const hit of attributedTimes(words, it.aliases)) {
        const date = receiptDate(r.date);
        out.push({
          kind: "receipt",
          key: it.key,
          at: hit.at,
          pictures: [],
          label: r.outlet,
          sub: [hit.verb, date].filter(Boolean).join(" · "),
          ...(r.via && r.via.toLowerCase() !== r.outlet.toLowerCase()
            ? { note: `via ${r.via}` }
            : {}),
        });
      }
      continue;
    }
    if (it.kind === "realplace") {
      if (!it.pair || it.pictures.length !== 2) continue;
      const at = placePairAt(words, it.pair);
      if (at !== undefined)
        out.push({
          kind: "realplace",
          key: it.key,
          at,
          pictures: it.pictures.map(pic),
        });
      continue;
    }
    if (!it.pictures.length) continue;
    const times = [
      ...new Set(it.aliases.flatMap((a) => phraseTimes(words, a))),
    ].sort((a, b) => a - b);
    for (const at of times) {
      // A logo only on the company's own name: "Rockstar North", "EA Sports", "Microsoft Flight Simulator" and
      // "Nintendo Switch" name something else (the next word is a capitalised part of another name).
      if (it.kind === "logo" && namesSomethingElse(words, at, it.aliases))
        continue;
      let pictures = it.pictures.map(pic);
      if (
        it.kind === "game" &&
        main &&
        COMPARE_WORDS.test(sentenceAround(words, at))
      ) {
        // Both games side by side, in the order the sentence says them (the video's game first when it comes first).
        const mainAt = firstSaid(
          words.filter((w) => Math.abs(w.start - at) < 12),
          main.aliases,
        );
        const mine = main.pictures.map(pic);
        pictures =
          mainAt !== undefined && mainAt < at
            ? [...mine, ...pictures]
            : [...pictures, ...mine];
        pictures = pictures.slice(0, 2);
      }
      out.push({ kind: it.kind, key: it.key, at, pictures });
    }
  }
  if (o.kinds.has("platform"))
    for (const r of platformRuns(words))
      out.push({
        kind: "platform",
        key: `platforms:${r.platforms.join(",")}`,
        at: r.at,
        pictures: [],
        platforms: r.platforms,
      });
  return out.sort((a, b) => a.at - b.at);
}

// ---- Finding the pictures (network) -----------------------------------------------------------------------------

type Fetch = typeof fetch;

export interface MentionDeps {
  fetchFn?: Fetch;
  /** The Steam store lookup (src/assets/steam.ts findSteamApp). */
  findSteamApp?: (term: string) => Promise<SteamApp | undefined>;
  /** The publisher's own site listing for a game (src/assets/publishersite.ts siteFor(...).list). */
  siteStills?: (game: string) => Promise<SiteAsset[]>;
  /** Faces in a picture (Apple Vision on the Mac mini), for the square crop. */
  faces?: (
    file: string,
  ) => Promise<Array<{ x: number; y: number; w: number; h: number }>>;
}

export interface MentionInput {
  dir: string;
  kinds: MentionKind[];
  spoken: string;
  /** The writer's footage keywords and tags: names it meant. */
  listed: string[];
  mainGame: string;
  /** The video's own game on Steam, for the comparison partner. */
  mainSteam?: { appId: number; name: string };
  attribution?: string;
  items: StoryItem[];
  docSources?: Array<string | { url?: string; source?: string }>;
  /** The video's pictures, with their labels (a game place already shown under its name). */
  images?: Array<{
    file: string;
    label?: string;
    kind?: string;
    sourceUrl?: string;
    provenance?: string;
    aspect?: number;
  }>;
}

async function getJson(url: string, fetchFn: Fetch): Promise<any> {
  const res = await fetchFn(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function save(
  url: string,
  dest: string,
  fetchFn: Fetch,
  minBytes = 4000,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < minBytes) return false;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function size(file: string): Promise<[number, number] | undefined> {
  try {
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
    return w && h ? [w, h] : undefined;
  } catch {
    return undefined;
  }
}

/** A picture cut to a square (on the biggest face when one is found) at 480 px, in the episode folder. */
async function square(
  dir: string,
  raw: string,
  file: string,
  deps: MentionDeps,
): Promise<boolean> {
  const wh = await size(raw);
  if (!wh || Math.min(...wh) < 240) return false;
  const face = (await deps.faces?.(raw).catch(() => []))?.sort(
    (a, b) => b.w * b.h - a.w * a.h,
  )[0];
  const sq = faceSquare(wh[0], wh[1], face);
  // A wide picture without a face: its middle, not the head-and-shoulders guess (that is for portraits).
  const box =
    face || wh[1] >= wh[0]
      ? sq
      : { x: Math.round((wh[0] - wh[1]) / 2), y: 0, size: wh[1] };
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    raw,
    "-vf",
    `crop=${box.size}:${box.size}:${box.x}:${box.y},scale=480:480:flags=lanczos`,
    "-q:v",
    "3",
    path.join(dir, file),
  ]);
  return true;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/**
 * A store title as the inset prints it (pure): the game, not the listing's edition ("Grand Theft Auto IV: The Complete
 * Edition" is "Grand Theft Auto IV", "Grand Theft Auto V Enhanced" is "Grand Theft Auto V").
 */
export function storeTitle(name: string): string {
  let t = name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
  const parts = t.split(/\s*[:–—]\s*|\s+-\s+/);
  while (
    parts.length > 1 &&
    nameWords(parts[parts.length - 1]!).every((w) => EDITION.test(w))
  )
    parts.pop();
  t = parts.join(": ");
  const words = t.split(" ");
  while (
    words.length > 1 &&
    EDITION.test(
      words[words.length - 1]!.toLowerCase().replace(/[^a-z]/g, ""),
    ) &&
    !/^(of|the|game)$/i.test(words[words.length - 1]!)
  )
    words.pop();
  return words.join(" ");
}

/** A game's official Steam library capsule in the episode folder, or undefined. */
async function capsule(
  dir: string,
  app: { appId: number; name: string },
  fetchFn: Fetch,
): Promise<MentionPictureFile | undefined> {
  const cdn = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${app.appId}`;
  const file = path.join("assets", `mention_game_${app.appId}.jpg`);
  for (const name of ["library_600x900_2x.jpg", "library_600x900.jpg"]) {
    const url = `${cdn}/${name}`;
    if (await save(url, path.join(dir, file), fetchFn, 8000))
      return {
        file,
        label: storeTitle(app.name),
        aspect: 2 / 3,
        provenance: `Steam store library capsule for "${app.name}" (app ${app.appId}), publisher-supplied marketing art`,
        sourceUrl: url,
      };
  }
  return undefined;
}

/** The Wikidata item a Wikipedia article stands for, with a claim's first file (P154 logo, P18 image). */
async function itemFile(
  article: string,
  prop: "P154" | "P18",
  fetchFn: Fetch,
): Promise<{ qid: string; file?: string } | undefined> {
  const pp = new URLSearchParams({
    action: "query",
    prop: "pageprops",
    titles: article,
    redirects: "1",
    format: "json",
  });
  const page = (
    Object.values(
      (await getJson(`https://en.wikipedia.org/w/api.php?${pp}`, fetchFn))
        ?.query?.pages ?? {},
    ) as any[]
  )[0];
  const qid = page?.pageprops?.wikibase_item as string | undefined;
  if (!qid || page?.pageprops?.disambiguation !== undefined) return undefined;
  return itemFileById(qid, prop, fetchFn);
}
async function itemFileById(
  qid: string,
  prop: "P154" | "P18",
  fetchFn: Fetch,
): Promise<{ qid: string; file?: string }> {
  const e = (
    await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`,
      fetchFn,
    )
  )?.entities?.[qid];
  // The current logo: a claim with no end date, preferred rank first.
  const claims: any[] = e?.claims?.[prop] ?? [];
  const current = claims
    .filter((c) => !c?.qualifiers?.P582)
    .sort(
      (a, b) =>
        Number(b?.rank === "preferred") - Number(a?.rank === "preferred"),
    );
  const file = (current[0] ?? claims[0])?.mainsnak?.datavalue?.value as
    | string
    | undefined;
  return { qid, ...(file ? { file } : {}) };
}

/**
 * Every mention picture a video can use, for the kinds switched on (network, never throws): each kind fails alone and
 * a thing whose picture is not found or not verified is simply not there.
 */
export async function findMentions(
  input: MentionInput,
  deps: MentionDeps = {},
): Promise<MentionAsset[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const kinds = new Set(input.kinds);
  const out: MentionAsset[] = [];
  const dir = input.dir;
  const tryKind = async (kind: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (err) {
      log("warn", "mention insets: a kind failed", {
        kind,
        error: errorMessage(err),
      });
    }
  };

  if (kinds.has("game") && deps.findSteamApp)
    await tryKind("game", async () => {
      if (input.mainSteam) {
        const c = await capsule(dir, input.mainSteam, fetchFn);
        if (c)
          out.push({
            kind: "game",
            key: `game:${input.mainSteam.appId}`,
            aliases: gameAliases(input.mainGame || input.mainSteam.name),
            pictures: [c],
            mainGame: true,
          });
      }
      const seen = new Set<number>(
        input.mainSteam ? [input.mainSteam.appId] : [],
      );
      for (const term of gameCandidates({
        spoken: input.spoken,
        listed: input.listed,
        mainGame: input.mainGame,
      }).slice(0, 8)) {
        const app = await deps.findSteamApp!(term).catch(() => undefined);
        if (!app || seen.has(app.appId) || !exactGame(term, app.name)) continue;
        if (
          input.mainGame &&
          (sameGame(input.mainGame, app.name) ||
            sameGame(app.name, input.mainGame))
        )
          continue;
        seen.add(app.appId);
        const c = await capsule(dir, app, fetchFn);
        if (c)
          out.push({
            kind: "game",
            key: `game:${app.appId}`,
            aliases: [...new Set([term, ...gameAliases(app.name)])],
            pictures: [c],
          });
      }
    });

  if (kinds.has("logo"))
    await tryKind("logo", async () => {
      let k = 0;
      for (const c of companiesSaid(input.spoken).slice(0, 6)) {
        const it = await itemFile(c.article, "P154", fetchFn).catch(
          () => undefined,
        );
        if (!it?.file) continue;
        const meta = await commonsFile(it.file, fetchFn, 600);
        if (!meta) continue;
        const ok = logoAllowed(meta);
        if (!ok.ok) {
          log("info", "mention insets: logo refused", {
            company: c.key,
            file: it.file,
            why: ok.why,
          });
          continue;
        }
        const file = path.join("assets", `mention_logo_${k++}.png`);
        if (!(await save(meta.url, path.join(dir, file), fetchFn, 500)))
          continue;
        out.push({
          kind: "logo",
          key: `logo:${c.key}`,
          aliases: c.names,
          pictures: [
            {
              file,
              label: c.names[0]!,
              aspect:
                meta.thumbWidth && meta.thumbHeight
                  ? meta.thumbWidth / meta.thumbHeight
                  : undefined,
              provenance: `${c.names[0]}'s logo as Wikidata files it (${it.qid}, P154): Wikimedia Commons ${meta.title}, ${meta.license}`,
              sourceUrl: meta.url,
              license: meta.license,
              pageUrl: meta.pageUrl,
            },
          ],
        });
      }
    });

  // The publisher site's named pictures serve the characters and the game side of a real place.
  let site: SiteAsset[] | undefined;
  const siteList = async () =>
    (site ??= deps.siteStills
      ? await deps.siteStills(input.mainGame).catch(() => [])
      : []);

  if (kinds.has("character"))
    await tryKind("character", async () => {
      const said = phraseTokens(input.spoken).join(" ");
      let k = 0;
      for (const ch of characterTags(await siteList())) {
        const alias = ch.aliases.find((a) =>
          ` ${said} `.includes(` ${phraseTokens(a).join(" ")} `),
        );
        if (!alias || k >= 5) continue;
        const still = ch.stills[0]!;
        const raw = path.join(dir, "assets", `mention_char_${k}_src.jpg`);
        if (!(await save(still.url, raw, fetchFn, 8000))) continue;
        const file = path.join("assets", `mention_char_${k}.jpg`);
        const made = await square(dir, raw, file, deps).catch(() => false);
        await fs.rm(raw, { force: true });
        if (!made) continue;
        k++;
        out.push({
          kind: "character",
          key: `character:${slug(ch.name)}`,
          aliases: ch.aliases,
          pictures: [
            {
              file,
              label: ch.name,
              credit: `Official art: ${still.publisher}`,
              provenance: `Official gallery picture "${still.name}" listed by ${still.publisher} at ${still.listedAt}`,
              sourceUrl: still.url,
            },
          ],
        });
      }
    });

  if (kinds.has("realplace"))
    await tryKind("realplace", async () => {
      const spokenToks = ` ${phraseTokens(input.spoken).join(" ")} `;
      const has = (names: string[]) =>
        names.some((n) =>
          spokenToks.includes(` ${phraseTokens(n).join(" ")} `),
        );
      let k = 0;
      for (const p of PLACE_PAIRS) {
        if (!p.series.test(input.mainGame) || !has(p.game) || !has(p.real))
          continue;
        // The game side: an official picture filed under the game place's name, from the video or the publisher.
        const tagged = (t: string) =>
          p.game.some((g) =>
            phraseTokens(t).join(" ").startsWith(phraseTokens(g).join(" ")),
          );
        const own = (input.images ?? []).find(
          (im) => im.label && tagged(im.label) && (im.aspect ?? 1.6) >= 1,
        );
        const still = own
          ? undefined
          : (await siteList()).find(
              (s) => s.kind === "still" && tagged(s.tags[0] ?? ""),
            );
        if (!own && !still) continue;
        // The real side: the place's own Wikidata photo under a licence that allows commercial use.
        const it = await itemFileById(p.qid, "P18", fetchFn).catch(
          () => undefined,
        );
        if (!it?.file) continue;
        const meta = await commonsFile(it.file, fetchFn, 900);
        if (!meta) continue;
        const lic = `${meta.license} ${meta.usageTerms ?? ""}`;
        if (
          !FREE.test(meta.license.trim()) ||
          /\bnc\b|noncommercial|\bnd\b|noderiv|fair use|non-free/i.test(lic)
        )
          continue;
        if (
          PRESS.test(`${meta.artist} ${meta.credit ?? ""}`) ||
          /map|logo|flag|seal|coat of arms|\.svg/i.test(meta.title)
        )
          continue;
        const rawReal = path.join(dir, "assets", `mention_real_${k}_src.jpg`);
        if (!(await save(meta.url, rawReal, fetchFn, 8000))) continue;
        const realFile = path.join("assets", `mention_real_${k}.jpg`);
        const okReal = await square(dir, rawReal, realFile, {}).catch(
          () => false,
        );
        await fs.rm(rawReal, { force: true });
        if (!okReal) continue;
        let gameFile = own?.file;
        let gameSource = own?.sourceUrl ?? "";
        let gameProv = own?.provenance ?? "";
        if (!gameFile && still) {
          const raw = path.join(
            dir,
            "assets",
            `mention_gameplace_${k}_src.jpg`,
          );
          if (!(await save(still.url, raw, fetchFn, 8000))) continue;
          gameFile = path.join("assets", `mention_gameplace_${k}.jpg`);
          const ok = await square(dir, raw, gameFile, {}).catch(() => false);
          await fs.rm(raw, { force: true });
          if (!ok) continue;
          gameSource = still.url;
          gameProv = `Official gallery picture "${still.name}" listed by ${still.publisher} at ${still.listedAt}`;
        } else if (gameFile) {
          // The video's own picture, cut square beside the photo.
          const sq = path.join("assets", `mention_gameplace_${k}.jpg`);
          if (
            !(await square(dir, path.join(dir, gameFile), sq, {}).catch(
              () => false,
            ))
          )
            continue;
          gameFile = sq;
        }
        k++;
        out.push({
          kind: "realplace",
          key: `realplace:${p.qid}`,
          aliases: [...p.game, ...p.real],
          pair: { game: p.game, real: p.real },
          pictures: [
            {
              file: realFile,
              label: p.real[0]!,
              sub: "REAL",
              credit: (() => {
                let a =
                  meta.artist.replace(/\s+/g, " ").trim() || "Unknown author";
                if (a.length > 28)
                  a = a.split(/\s+from\s+|\s*[,(|]\s*/)[0]!.trim() || a;
                return `Photo: ${a.slice(0, 34)}, ${meta.license}`;
              })(),
              provenance: `${p.real[0]}'s own Wikidata photo (${p.qid}, P18): Wikimedia Commons ${meta.title} by ${meta.artist}, ${meta.license}`,
              sourceUrl: meta.url,
              license: meta.license,
              pageUrl: meta.pageUrl,
            },
            {
              file: gameFile!,
              label: p.game[0]!,
              sub: "IN THE GAME",
              provenance: gameProv,
              sourceUrl: gameSource,
            },
          ],
        });
      }
    });

  if (kinds.has("receipt"))
    for (const r of receiptSources({
      items: input.items,
      attribution: input.attribution,
      docSources: input.docSources,
    }))
      out.push({
        kind: "receipt",
        key: `receipt:${r.outlet.toLowerCase()}`,
        aliases: r.aliases,
        pictures: [],
        receipt: {
          outlet: r.outlet,
          ...(r.date ? { date: r.date } : {}),
          ...(r.via ? { via: r.via } : {}),
          ...(r.url ? { url: r.url } : {}),
        },
      });

  return out;
}
