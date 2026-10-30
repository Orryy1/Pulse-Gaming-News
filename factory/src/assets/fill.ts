// Every sentence of a long video should have something chosen for its own words on screen (owner, 30 Oct 2026:
// "all videos must be fully media rich all the way through"). The gatherers search by chapter and leave most
// sentences on the chapter's general footage: on the Vice City documentary only 21% had a picture of their own
// and 26% a graphic. This pass looks at each sentence still without either and searches for it alone:
// every official IGDB screenshot and artwork of the chapter's game, a Commons photo whose title names what
// the sentence names, licensed stock for the real-world lines. The picture editor pins a candidate to a
// sentence only when it truly shows it (confidence 0.5 and over); nothing is pinned for the sake of a number.

import path from "node:path";
import { z } from "zod";
import fs from "node:fs/promises";
import type { Llm } from "../editorial/llm.ts";
import type { CommonsImage } from "./commons.ts";
import type { FootageTarget } from "./clipscore.ts";
import type { VisualAsset } from "./steam.ts";
import { clipFrame, rankStills, uncoveredTargets } from "./stillscore.ts";
import { log } from "../lib/util.ts";
import {
  DocMomentSchema,
  groundDocMoments,
  type DocMoment,
} from "../editorial/documentary.ts";

export interface FillMoment {
  show: string;
  person?: string;
  broll?: string;
  keywords?: string[];
  graphic?: { kind: string };
}

export interface FillChapter {
  entry: number; // beatIndex of its images and clips
  game: string;
  year?: number;
  moments: FillMoment[];
  sentences: string[];
}

export interface FillDeps {
  llm: Llm;
  igdbArt(
    title: string,
    year: number | undefined,
    dir: string,
    max: number,
  ): Promise<VisualAsset[]>;
  searchPhotos(query: string): Promise<CommonsImage[]>;
  downloadPhoto(img: CommonsImage, dest: string): Promise<boolean>;
  fetchStock(
    dir: string,
    targets: FootageTarget[],
    gameWords: string[],
    maxClips: number,
  ): Promise<VisualAsset[]>;
}

type Placed = { beatIndex?: number; moment?: number };
/** A picture as the episode stores it (kind is a plain string there); new ones get their shape measured later. */
type Image = {
  file: string;
  kind: string;
  sourceUrl?: string;
  provenance?: string;
  beatIndex?: number;
  moment?: number;
  label?: string;
};
type Clip = Placed & Record<string, unknown>;

/** Sentences (by index) that have a picture or clip of their own, or a graphic. */
export function coveredMoments(
  entry: number,
  moments: FillMoment[],
  images: Placed[],
  clips: Placed[],
): Set<number> {
  const out = new Set<number>();
  for (const x of [...images, ...clips])
    if (x.beatIndex === entry && x.moment !== undefined) out.add(x.moment);
  moments.forEach((m, k) => {
    if (m.graphic && m.graphic.kind !== "none") out.add(k);
  });
  return out;
}

/** The share of all sentences covered (own picture or clip, or a graphic). */
export function coverageShare(
  chapters: FillChapter[],
  images: Placed[],
  clips: Placed[],
): number {
  let total = 0;
  let hit = 0;
  for (const c of chapters) {
    total += c.moments.length;
    hit += coveredMoments(c.entry, c.moments, images, clips).size;
  }
  return total ? hit / total : 1;
}

const GENERIC =
  /^(the|and|with|from|that|this|their|team|game|games|video|scene|shot|shots|real|world|people|person|working|work|footage|gameplay|screen|photo|image|showing|shows|being|over|into|years|year|first|new|old|its|his|her|about|after|before|during)$/i;

/** The words of a "show" note worth finding in a photo's title. */
export function titleWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !GENERIC.test(w)),
    ),
  ];
}

/**
 * Whether a Commons file is about what was searched: for a person, the title carries their surname; for a
 * thing or place, at least one of its significant words. The search engine also matches descriptions and
 * categories, which is how "Rockstar North office" returns a random Edinburgh street.
 */
export function photoMatches(
  title: string,
  query: { person?: string; words: string[] },
): boolean {
  const t = title
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (query.person) {
    const surname = query.person.trim().split(/\s+/).pop()!.toLowerCase();
    return surname.length >= 3 && t.split(" ").includes(surname);
  }
  return query.words.some((w) => t.split(" ").includes(w));
}

/** A sentence about the real world (a studio, people, money, hardware, a launch), not a moment in the game. */
export function realWorld(m: FillMoment): boolean {
  return !!(m.broll && m.broll.trim());
}

const MAX_PHOTO_QUERIES = 12;
const MAX_STOCK = 8;
const BATCH = 24;

/**
 * Tops up a long video's sentences without a picture or graphic of their own. Images and clips are added in
 * place; returns the coverage before and after.
 */
export async function fillSentencePictures(
  deps: FillDeps,
  dir: string,
  chapters: FillChapter[],
  images: Image[],
  clips: Clip[],
  franchise: string,
  scope?: "campaign",
): Promise<{ before: number; after: number }> {
  const before = coverageShare(chapters, images, clips);
  const games = chapters.map((c) => c.game);
  for (const ch of chapters) {
    try {
      await fillChapter(deps, dir, ch, images, clips, franchise, scope);
      // What is still bare and states a date, place, figure or name gets the graphic that shows it.
      const covered = coveredMoments(ch.entry, ch.moments, images, clips);
      const bare = ch.moments.map((_, k) => k).filter((k) => !covered.has(k));
      await graphicsForBare(deps.llm, ch, bare, ch.sentences.join(" "), games);
    } catch (err) {
      log("warn", "sentence top-up failed for a chapter", {
        game: ch.game,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const after = coverageShare(chapters, images, clips);
  log("info", "sentence pictures topped up", {
    before: Math.round(before * 100),
    after: Math.round(after * 100),
  });
  return { before, after };
}

async function fillChapter(
  deps: FillDeps,
  dir: string,
  ch: FillChapter,
  images: Image[],
  clips: Clip[],
  franchise: string,
  scope?: "campaign",
): Promise<void> {
  const open = () => {
    const covered = coveredMoments(ch.entry, ch.moments, images, clips);
    return ch.moments.map((_, k) => k).filter((k) => !covered.has(k));
  };
  if (!open().length) return;
  const base = path.join(`entry_${ch.entry}`, "fill");
  const abs = path.join(dir, base);
  await fs.mkdir(abs, { recursive: true });

  // 1. Licensed stock for the real-world sentences that ask for it.
  const stockTargets: FootageTarget[] = open()
    .filter((k) => realWorld(ch.moments[k]!))
    .slice(0, MAX_STOCK)
    .map((k) => ({
      key: `beat:${ch.entry}#m${k}`,
      text: `${ch.sentences[k] ?? ""} (show: ${ch.moments[k]!.broll})`,
      want: "cinematic" as const,
      energy: "medium" as const,
      keywords: [ch.moments[k]!.broll!],
    }));
  if (stockTargets.length) {
    const got = await deps
      .fetchStock(
        path.join(abs, "stock"),
        stockTargets,
        franchise.split(/\s+/),
        stockTargets.length,
      )
      .catch(() => [] as VisualAsset[]);
    for (const c of got)
      if (c.moment !== undefined)
        clips.push({
          file: path.join(base, "stock", c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: c.durationSeconds ?? 4,
          beatIndex: ch.entry,
          role: undefined,
          motion: 0.5,
          luma: undefined,
          label: c.label,
          reason: c.reason,
          startSeconds: 0,
          stock: true,
          moment: c.moment,
          credit: "ILLUSTRATIVE · STOCK FOOTAGE: PEXELS",
        });
  }

  // 2. Candidates: every official screenshot and artwork of the game not already in the video, and Commons
  //    photos of what the real-world sentences and named people show.
  const have = new Set(images.map((i) => i.sourceUrl));
  const candidates: Image[] = [];
  for (const a of await deps
    .igdbArt(ch.game, ch.year, abs, 40)
    .catch(() => [] as VisualAsset[]))
    if (a.kind !== "capsule" && !have.has(a.sourceUrl))
      candidates.push({
        ...a,
        file: path.join(base, a.file),
        beatIndex: ch.entry,
      });
  const queries = new Map<string, { person?: string; words: string[] }>();
  for (const k of open()) {
    const m = ch.moments[k]!;
    if (m.person && m.person.trim().split(/\s+/).length >= 2)
      queries.set(m.person.trim(), { person: m.person.trim(), words: [] });
    else if (realWorld(m)) {
      const words = titleWords(m.show);
      if (words.length)
        queries.set(m.show.split(/\s+/).slice(0, 6).join(" "), { words });
    }
  }
  let n = 0;
  const seen = new Set<string>();
  for (const [q, want] of [...queries].slice(0, MAX_PHOTO_QUERIES)) {
    const found = (await deps.searchPhotos(q).catch(() => [] as CommonsImage[]))
      .filter((img) => !seen.has(img.title) && photoMatches(img.title, want))
      .slice(0, 3);
    for (const img of found) {
      seen.add(img.title);
      const file = path.join(base, "photos", `p_${n++}.jpg`);
      if (!(await deps.downloadPhoto(img, path.join(dir, file)))) continue;
      candidates.push({
        kind: "photo",
        file,
        sourceUrl: img.pageUrl,
        provenance: `Wikimedia Commons photo by ${img.artist}, ${img.license}: ${img.pageUrl}`,
        beatIndex: ch.entry,
        ...(want.person ? { label: want.person.toUpperCase() } : {}),
      } as Image);
    }
  }

  // 3. The picture editor pins what truly shows a sentence; official art it passes over still widens the pool.
  for (let b = 0; b < candidates.length; b += BATCH) {
    const left = open();
    if (!left.length) break;
    const batch = candidates.slice(b, b + BATCH);
    const want = uncoveredTargets(
      ch.moments,
      ch.sentences,
      new Set(ch.moments.map((_, k) => k).filter((k) => !left.includes(k))),
    );
    const ranked = await rankStills(
      deps.llm,
      want,
      batch.map((a) => ({ file: path.join(dir, a.file) })),
      path.join(abs, `score_${b}`),
      scope,
      "documentary",
    );
    const picked = new Set<number>();
    for (const p of ranked.picks) {
      if (ranked.withText.has(p.image)) continue;
      const a = batch[p.image]!;
      a.moment = Number(p.key.slice(1));
      a.label ??= p.label;
      picked.add(p.image);
    }
    batch.forEach((a, i) => {
      if (ranked.withText.has(i)) return;
      a.label ??= ranked.labels.get(i);
      // A photo nobody picked could be anything; official art is always the game.
      if (picked.has(i) || a.kind !== "photo") images.push(a);
    });
  }

  // 3b. Footage nobody described: one frame of each unlabelled clip goes to the editor, which labels it (so the
  //     bin pass can cut to it) and pins it where it truly shows a sentence.
  const unlabelled = clips.filter(
    (c) =>
      c.beatIndex === ch.entry &&
      c.moment === undefined &&
      !c.label &&
      !c.stock,
  );
  for (let b = 0; b < unlabelled.length; b += BATCH) {
    const batch = unlabelled.slice(b, b + BATCH);
    const frames: Array<{ file: string }> = [];
    const shown: Clip[] = [];
    for (const [i, c] of batch.entries()) {
      const frame = path.join(abs, "frames", `clip_${b + i}.jpg`);
      try {
        await clipFrame(
          path.join(dir, String(c.file)),
          Number(c.durationSeconds ?? 4),
          frame,
        );
        frames.push({ file: frame });
        shown.push(c);
      } catch {
        // an unreadable clip stays general footage
      }
    }
    if (!frames.length) continue;
    const want = uncoveredTargets(
      ch.moments,
      ch.sentences,
      new Set(ch.moments.map((_, k) => k).filter((k) => !open().includes(k))),
    );
    if (!want.length) break;
    const ranked = await rankStills(
      deps.llm,
      want,
      frames,
      path.join(abs, `clipscore_${b}`),
      scope,
      "documentary",
    );
    shown.forEach((c, i) => {
      c.label ??= ranked.labels.get(i);
    });
    for (const p of ranked.picks)
      if (!ranked.withText.has(p.image))
        shown[p.image]!.moment = Number(p.key.slice(1));
  }

  // 4. The editor's pass over the bin: what is left uncovered gets the best fitting shot the chapter already has
  //    (the way an editor cuts "the demand was real" to a queue, or "the wait didn't hurt" to a sunset over the city).
  await assignFromBin(deps.llm, ch, open(), images, clips);
}

const BinSchema = z.object({
  picks: z.array(
    z.object({
      sentence: z.number().describe("The sentence number exactly as given"),
      item: z.string().describe("The item id exactly as given, e.g. i12 or c4"),
      fit: z
        .enum(["shows it", "fits it", "none"])
        .describe(
          '"shows it": the item shows what the sentence names; "fits it": the item suits the moment, place, era and mood of the sentence the way a documentary editor would cut to it; "none": nothing in the bin fits',
        ),
    }),
  ),
});

const BIN_PROMPT = `You are the editor of a long gaming documentary. For each numbered sentence still without its own picture, pick from the bin of this chapter's pictures and clips (each listed by id and what it shows) the one a top documentary editor would cut to while that sentence is spoken.
Pick only something that belongs with the sentence: the same game and era, the place, character, mission, mood or real-world subject it talks about. A line about money, sales or a studio may take a real-world shot of that; a line about the game's world takes footage or art of that world. Never pick a different game, an era the sentence is not about, or a person the sentence does not name. Use each item once, and prefer clips (footage) over stills. For a sentence about controversy, violence, crime, race, a lawsuit or a tragedy, pick only a neutral shot (the city, a street, a car, the skyline, real-world stock), never people, weapons or a fight. When nothing in the bin belongs with a sentence, answer "none" for it: a sentence left on the chapter's general footage is better than a wrong picture.`;

/** Gives each uncovered sentence the best fitting shot from the chapter's own unpinned pictures and clips. */
export async function assignFromBin(
  llm: Llm,
  ch: FillChapter,
  uncovered: number[],
  images: Image[],
  clips: Clip[],
): Promise<number> {
  if (!uncovered.length) return 0;
  const bin: Array<{ id: string; what: string; set: (k: number) => void }> = [];
  images.forEach((im, i) => {
    if (
      im.beatIndex !== ch.entry ||
      im.moment !== undefined ||
      im.kind === "capsule"
    )
      return;
    const what = (im.label ?? "").trim();
    if (!what) return;
    bin.push({
      id: `i${i}`,
      what: `${im.kind}: ${what}`,
      set: (k) => (im.moment = k),
    });
  });
  clips.forEach((c, i) => {
    if (c.beatIndex !== ch.entry || c.moment !== undefined) return;
    const what = String(c.label ?? "").trim();
    if (!what) return;
    bin.push({
      id: `c${i}`,
      what: `${c.stock ? "stock footage" : "footage"}: ${what}`,
      set: (k) => (c.moment = k),
    });
  });
  if (!bin.length) return 0;
  const r = await llm.structured({
    tier: "mid",
    system: BIN_PROMPT,
    content: [
      `Game: ${ch.game}${ch.year ? ` (${ch.year})` : ""}`,
      "",
      "Sentences:",
      ...uncovered.map(
        (k) =>
          `${k}. "${ch.sentences[k] ?? ""}" (wanted on screen: ${ch.moments[k]?.show ?? ""})`,
      ),
      "",
      "Bin:",
      ...bin.map((b) => `${b.id}: ${b.what}`),
    ].join("\n"),
    schema: BinSchema,
    effort: "low",
  });
  const used = new Set<string>();
  const done = new Set<number>();
  let n = 0;
  for (const p of r.picks) {
    if (
      p.fit === "none" ||
      !uncovered.includes(p.sentence) ||
      done.has(p.sentence) ||
      used.has(p.item)
    )
      continue;
    const b = bin.find((x) => x.id === p.item);
    if (!b) continue;
    b.set(p.sentence);
    used.add(p.item);
    done.add(p.sentence);
    n++;
  }
  log("info", "sentences given a shot from the bin", {
    game: ch.game,
    asked: uncovered.length,
    bin: bin.length,
    given: n,
  });
  return n;
}

const GraphicPicks = z.object({
  graphics: z.array(
    z.object({
      sentence: z.number().describe("The sentence number exactly as given"),
      graphic: DocMomentSchema.shape.graphic,
    }),
  ),
});

const GRAPHICS_PROMPT = `You are the motion-graphics designer of a long gaming documentary in the style of the best YouTube documentary channels. Each numbered sentence below has no picture of its own yet. Give each one the explanatory graphic that shows what it says, the way a top documentary would put it on screen:
- a date or a moment in time: "date" (a calendar page), or "timeline" when the chapter text gives several years in order, "delay" when a date slipped, "span" for years between two events;
- a place, a move or a journey (a studio, a city, a research trip): "map" with the real places in the order the story moves;
- a figure: "stat" for one number, "bars" or "compare" for two or more, "share" for parts of a whole;
- a record or a first: "milestone"; press coverage: "headline"; named people and their roles: "people"; two or more things named: "list"; this game against another chapter's game: "versus"; hardware or technical figures: "specs"; a studio or series family line: "lineage".
Use only what the sentence itself or the chapter text states, word for word for every name, figure and date; never invent, round or convert one. Answer "none" for a sentence that states nothing a graphic can show (a mood, an opinion, a transition): an empty card is worse than footage.`;

/**
 * Explanatory graphics for the sentences still bare after the picture search (owner, 30 Oct 2026: dates,
 * places and journeys should get calendars, timelines, maps and the rest of the suite). Each graphic is grounded
 * in the chapter's own fact-checked narration by the documentary's usual checks; one that fails is dropped.
 */
export async function graphicsForBare(
  llm: Llm,
  ch: FillChapter,
  bare: number[],
  chapterText: string,
  games: string[],
): Promise<number> {
  const asked = bare.filter((k) => k > 0);
  if (!asked.length) return 0;
  const r = await llm.structured({
    tier: "mid",
    system: GRAPHICS_PROMPT,
    content: [
      `Game: ${ch.game}${ch.year ? ` (${ch.year})` : ""}. Chapter games of this documentary: ${games.join("; ")}`,
      "",
      "Chapter text:",
      chapterText,
      "",
      "Sentences needing a graphic:",
      ...asked.map((k) => `${k}. "${ch.sentences[k] ?? ""}"`),
    ].join("\n"),
    schema: GraphicPicks,
    effort: "low",
  });
  const source = { title: ch.game, url: "", text: chapterText } as never;
  let n = 0;
  for (const g of r.graphics) {
    if (!asked.includes(g.sentence) || g.graphic.kind === "none") continue;
    const m = ch.moments[g.sentence] as DocMoment | undefined;
    if (!m || (m.graphic && m.graphic.kind !== "none")) continue;
    // Grounded on its own (index 1: a chapter's first sentence plays under its title card).
    const probe = { ...m, graphic: g.graphic } as DocMoment;
    const grounded = groundDocMoments([probe, probe], source, games, [
      ch.sentences[g.sentence - 1] ?? "",
      ch.sentences[g.sentence] ?? "",
    ]).moments[1]!;
    if (grounded.graphic.kind === "none") continue;
    if (!graphicFitsSentence(grounded.graphic, ch.sentences, g.sentence, chapterText)) continue;
    m.graphic = grounded.graphic;
    n++;
  }
  log("info", "graphics for bare sentences", {
    game: ch.game,
    asked: asked.length,
    given: n,
  });
  return n;
}

/**
 * A graphic belongs on the sentence that says it: a date, figure, delay, milestone or headline only carries
 * numbers spoken in this sentence or the one before (30 Oct 2026 trial: a Forbes line got a server shutdown
 * date from elsewhere in the chapter); a quote names a speaker the chapter names.
 */
export function graphicFitsSentence(
  g: { kind: string; primary: string; secondary: string; items: string[] },
  sentences: string[],
  k: number,
  chapterText: string,
): boolean {
  const flat = (t: string) => t.toLowerCase().replace(/,/g, "");
  const near = flat(`${sentences[k - 1] ?? ""} ${sentences[k] ?? ""}`);
  const nums = (t: string) => flat(t).match(/\d[\d.]*/g) ?? [];
  if (["date", "stat", "delay", "milestone", "headline", "compare", "bars", "share"].includes(g.kind)) {
    const said = [g.primary, ...g.items].flatMap(nums);
    if (!said.every((d) => near.includes(d))) return false;
  }
  if (g.kind === "quote") {
    const who = g.secondary.split(",")[0]!.trim().toLowerCase();
    if (!who || !chapterText.toLowerCase().includes(who)) return false;
    // Only words the narration puts in quotation marks, in this sentence or a neighbour, are a quote.
    const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    const quoted = `${sentences[k - 1] ?? ""} ${sentences[k] ?? ""} ${sentences[k + 1] ?? ""}`
      .match(/["“]([^"”]{3,})["”]/g)
      ?.map(words) ?? [];
    const said = words(g.primary);
    if (!said || !quoted.some((q) => q.includes(said))) return false;
  }
  return true;
}
