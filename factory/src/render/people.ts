// People insets and the tracklist card in Shorts (PEOPLE_INSETS, owner 15 Nov 2026, on "GTA 6's Reported 34-track Album
// Isn't the Full Soundtrack"): when a Short names real people (artists, developers, actors), a small picture-in-picture
// photo of each pops in over the footage on the word that names them, with their name and the photo's licence credit
// under it, and a story about a soundtrack or album shows the reported songs on a Pulse-drawn card.
// Pure and browser-safe (the Remotion bundle loads it): where each inset and card sits in time and on the frame.
// The pipeline finds the people and their photos (src/assets/people.ts); components/PeopleInsets.tsx draws them;
// src/render/cleanframe.ts and src/qa/gfxaudit.ts place and measure them with the other overlays.

/** A person's inset as the render gets it: the photo, the name as spoken, the licence credit, when the name is said. */
export interface PersonInset {
  name: string;
  src: string;
  /** "Photo: Jane Doe, CC BY-SA 4.0" */
  credit: string;
  /** Seconds into the Short of the first spoken word of the name. */
  at: number;
}

/** One song on the tracklist card; a reported artist whose song is not named yet has no title. */
export interface Track {
  artist: string;
  title?: string;
}

/** The tracklist card on its line: frames, the line it belongs to (its own card gives way) and what it lists. */
export interface TracklistPlacement {
  segment: number;
  from: number;
  frames: number;
  /** "REPORTED TRACKLIST" for a rumour, else "TRACKLIST". */
  title: string;
  /** The game or album under the title. */
  subtitle: string;
  tracks: Track[];
  /** Tracks a page: the card turns its pages inside its frames. */
  perPage: number;
}

/** Frames an inset stays after its name is said: about 2.5 s. */
export const INSET_HOLD_FRAMES = 75;
/** At most this many insets share the row; a fourth name starts a fresh row that replaces it. */
export const INSET_MAX_GROUP = 3;
/** The photo's side (28% of the 1080-wide frame), the gap between insets and the top of the row. */
export const INSET_SIZE = 302;
export const INSET_GAP = 20;
/** Under the brand band (y 150-300) and the wire, in the hero band's upper part: clear of the headline (gone by then
 * under the one-at-a-time rule), the captions (y 1180+) and the right-hand rail (from y 1000). */
export const INSET_TOP = 330;
export const INSET_RIGHT = 1016;
/** The name and credit under each photo. */
export const INSET_CAPTION = 96;
/** Most people a Short shows. */
export const MAX_PEOPLE = 5;

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']s$/, "")
    .replace(/[^a-z0-9]/g, "");

/** A name's tokens as the voice's words would carry them. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s-]+/)
    .map(norm)
    .filter(Boolean);
}

/**
 * When a name is first spoken (seconds), from the voice's word timings: the run of words that spells the whole name
 * ("Lana Del Rey", "Rey's" with its possessive), or, failing that, the surname alone after the full name was never
 * said. Undefined when it is never said.
 */
export function nameSpokenAt(
  words: Array<{ text: string; start: number }>,
  name: string,
): number | undefined {
  const toks = nameTokens(name);
  if (!toks.length) return undefined;
  const ws = words.map((w) => ({ t: norm(w.text), start: w.start }));
  for (let k = 0; k + toks.length <= ws.length; k++)
    if (toks.every((t, j) => ws[k + j]!.t === t)) return ws[k]!.start;
  // A name the aligner joined or split ("Del Rey" as "Delrey"): the tokens joined against the words joined.
  const joined = toks.join("");
  for (let k = 0; k < ws.length; k++) {
    let acc = "";
    for (let j = k; j < Math.min(ws.length, k + toks.length + 1); j++) {
      acc += ws[j]!.t;
      if (acc === joined) return ws[k]!.start;
      if (!joined.startsWith(acc)) break;
    }
  }
  // Only a surname of some length counts alone ("Richards", never "Lee").
  const last = toks[toks.length - 1]!;
  if (toks.length > 1 && last.length >= 5) {
    const k = ws.findIndex((w) => w.t === last);
    if (k >= 0) return ws[k]!.start;
  }
  return undefined;
}

/** A row of insets: the people named close together, each popping in on its own name, held after the last. */
export interface PeopleGroup {
  key: string;
  from: number;
  /** Exclusive. */
  to: number;
  members: Array<Omit<PersonInset, "at"> & { appear: number }>;
}

/**
 * The insets in rows (pure). A name said while the row is still up joins it (up to INSET_MAX_GROUP), so names said
 * together stand side by side and never cover each other; a row holds INSET_HOLD_FRAMES after its last name, and ends
 * where the next row starts, which replaces it. Never past the frame's end (less a beat).
 */
export function peopleGroups(
  people: Array<Omit<PersonInset, "at"> & { at: number }>,
  fps: number,
  totalFrames: number,
): PeopleGroup[] {
  const sorted = [...people]
    .filter((p) => Number.isFinite(p.at))
    .map((p) => ({ ...p, appear: Math.max(0, Math.round(p.at * fps)) }))
    .sort((a, b) => a.appear - b.appear)
    .slice(0, MAX_PEOPLE);
  const groups: PeopleGroup[] = [];
  for (const p of sorted) {
    const { at: _at, ...m } = p;
    const g = groups[groups.length - 1];
    if (g && p.appear < g.to && g.members.length < INSET_MAX_GROUP) {
      g.members.push(m);
      g.to = p.appear + INSET_HOLD_FRAMES;
    } else
      groups.push({
        key: `people${groups.length}`,
        from: p.appear,
        to: p.appear + INSET_HOLD_FRAMES,
        members: [m],
      });
  }
  const end = Math.max(0, totalFrames - 6);
  return groups
    .map((g, k) => ({
      ...g,
      to: Math.min(g.to, groups[k + 1]?.from ?? Infinity, end),
    }))
    .filter((g) => g.to > g.from);
}

/** Where inset k of a row of n sits: right-aligned to the safe edge, in name order from the left. */
export function insetBox(
  n: number,
  k: number,
): { left: number; top: number; size: number } {
  const size = INSET_SIZE;
  const total = n * size + (n - 1) * INSET_GAP;
  const left0 = INSET_RIGHT - total;
  return { left: left0 + k * (size + INSET_GAP), top: INSET_TOP, size };
}

// ---- The tracklist ---------------------------------------------------------------------------------

/** Tracks a page by default; three is what a glance takes in. */
export const TRACKS_PER_PAGE = 3;
/** Most tracks the card lists. */
export const MAX_TRACKS = 6;
/** Reading time, as the graphics audit counts it (src/qa/gfxaudit.ts READ_BASE, READ_PER_WORD, READ_FLOOR). */
const READ_BASE = 0.6;
const READ_PER_WORD = 0.3;
const READ_FLOOR = 1.2;

const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** A track's words on the card. */
export const trackWords = (t: Track): number =>
  wordsOf(t.artist) + (t.title ? wordsOf(t.title) : 0);

/** The tracks in pages. */
export function trackPages(
  tracks: Track[],
  perPage = TRACKS_PER_PAGE,
): Track[][] {
  const out: Track[][] = [];
  for (let i = 0; i < tracks.length; i += Math.max(1, perPage))
    out.push(tracks.slice(i, i + Math.max(1, perPage)));
  return out;
}

/** Seconds one page needs on screen to be read. */
export function pageSeconds(page: Track[]): number {
  const n = page.reduce((s, t) => s + trackWords(t), 0);
  return Math.max(READ_FLOOR, READ_BASE + READ_PER_WORD * n);
}

/** Seconds a whole tracklist needs, page by page. */
export function tracklistSeconds(
  tracks: Track[],
  perPage = TRACKS_PER_PAGE,
): number {
  return trackPages(tracks, perPage).reduce((s, p) => s + pageSeconds(p), 0);
}

/**
 * Frames each page holds inside a card of `frames` (pure): in proportion to what each page needs, so a page with
 * longer titles stays longer. The card's pages turn on these frames.
 */
export function pageFrames(
  tracks: Track[],
  perPage: number,
  frames: number,
): number[] {
  const pages = trackPages(tracks, perPage);
  const need = pages.map(pageSeconds);
  const sum = need.reduce((a, b) => a + b, 0) || 1;
  const out = need.map((n) => Math.floor((n / sum) * frames));
  out[out.length - 1] = frames - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

const LIST_WORD =
  /\b(soundtrack|tracklist|track ?list|listing|album|songs?|tracks?|singles?|ost|vinyl)\b/i;

/** Whether a story is about a soundtrack, album or tracklist. */
export function soundtrackStory(text: string): boolean {
  return /\b(soundtrack|tracklist|track ?list|album|songs|radio station|ost)\b/i.test(
    text,
  );
}

/**
 * Where the tracklist card goes (pure): on the line that mentions the list, starting on its first list word, held
 * for the pages' reading time, up to 1.5 s past the line when the next line has no card. A line that names a person with an inset is passed
 * over when another list line has none (their faces have the frame there), and the line naming the most listed
 * artists and songs wins a tie on list words. When the room is short the last tracks go; undefined when not even two
 * can be read there.
 */
export function placeTracklist(o: {
  segments: Array<{ kind: string; text: string; start: number; end: number; visual?: { kind: string } }>;
  words: Array<{ text: string; start: number }>;
  fps: number;
  totalFrames: number;
  tracks: Track[];
  rumour: boolean;
  subtitle: string;
  /** Seconds when a person's inset is up, so their line is passed over. */
  insetTimes?: number[];
}): TracklistPlacement | undefined {
  const tracks = o.tracks.slice(0, MAX_TRACKS);
  if (tracks.length < 2) return undefined;
  const hookIdx = o.segments.findIndex((s) => s.kind === "hook");
  const hookEnd = hookIdx >= 0 ? o.segments[hookIdx]!.end : 0;
  const names = tracks
    .flatMap((t) => [t.artist, t.title ?? ""])
    .filter(Boolean)
    .map((x) => nameTokens(x));
  const scored = o.segments
    .map((s, i) => {
      if (s.kind !== "beat" && s.kind !== "take") return undefined;
      if (s.start < hookEnd - 0.05) return undefined;
      // Distinct list words, a word that introduces a list ("including"), and the listed names it says, twice over.
      const list = new Set(
        (s.text.match(new RegExp(LIST_WORD.source, "gi")) ?? []).map((w) =>
          w.toLowerCase().replace(/s$/, ""),
        ),
      ).size;
      if (!list) return undefined;
      const intro = /\b(includ(es|ing)|lists?|features?|featuring)\b/i.test(s.text) ? 1 : 0;
      const toks = s.text.split(/[\s-]+/).map(norm);
      const named = names.filter(
        (n) =>
          n.length && toks.some((_, k) => n.every((t, j) => toks[k + j] === t)),
      ).length;
      const faces = (o.insetTimes ?? []).some(
        (t) => t >= s.start - 0.05 && t < s.end,
      );
      return { i, s, score: list + intro + 2 * named, faces };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!scored.length) return undefined;
  const pick = [...scored].sort(
    (a, b) =>
      Number(a.faces) - Number(b.faces) || b.score - a.score || a.i - b.i,
  )[0]!;
  const { s, i } = pick;
  const first = o.words.find(
    (w) =>
      w.start >= s.start - 0.05 && w.start < s.end && LIST_WORD.test(w.text),
  );
  const start = Math.round(s.start * o.fps);
  const word = Math.round((first?.start ?? s.start) * o.fps) - 6;
  // Past its own line only when the next line draws no card of its own (that card is about its own words).
  const next = o.segments[i + 1]?.visual;
  const spill = next && next.kind !== "none" ? 0 : 1.5;
  const stop = Math.min(Math.round((s.end + spill) * o.fps), o.totalFrames - 60);
  // Whole pages that fit between the line's start and the stop, the last tracks going first.
  let n = tracks.length;
  const need = (k: number) =>
    Math.round(tracklistSeconds(tracks.slice(0, k)) * o.fps);
  while (n > 2 && need(n) > stop - start) n--;
  if (need(n) > stop - start) return undefined;
  // On its list word when the pages still fit after it, else early enough that they do.
  const from = Math.max(start, Math.min(word, stop - need(n)));
  return {
    segment: i,
    from,
    frames: need(n),
    title: o.rumour ? "REPORTED TRACKLIST" : "TRACKLIST",
    subtitle: o.subtitle,
    tracks: tracks.slice(0, n),
    perPage: TRACKS_PER_PAGE,
  };
}

/** The tracklist card's text, as the graphics audit reads it. */
export function tracklistText(
  t: Pick<TracklistPlacement, "title" | "tracks">,
): string {
  return [
    t.title,
    ...t.tracks.map((x) => [x.artist, x.title].filter(Boolean).join(" ")),
  ].join(" ");
}
