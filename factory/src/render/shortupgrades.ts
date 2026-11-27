// The long videos' 3D and look craft in Shorts (owner, 20 Nov 2026: every new visual upgrade on Shorts too, "top tier
// and beautiful"), only where it suits 35-50 s of vertical video at Shorts pace (memory: best of both worlds). Each
// device has its own SHORT_* switch and only runs where its long-video switch is on too:
//
// - SHORT_MAP_PINS: a line naming a checked place in the Short's game flies down the game's own map to a pin
//   (components/GameMap3D.tsx, vertical and quicker: the pin lands on the place's word, about a second in).
// - SHORT_GAME_LOOK: the cards and the map take the game's own palette (src/render/gamelook.ts); the captions,
//   the logo and a rumour's colour stay Pulse's.
// - SHORT_BLENDER: a ranking's number one opens on the vertical 3D podium (src/render/blender.ts), when the Short's
//   slot leaves time for the Mac's Blender to make it; otherwise the flat card, as before.
// - SHORT_BOX_3D: a ranking entry's card turns its game's box in (components/Box3D.tsx) instead of the flat cover.
// - SHORT_DEPTH_TYPE: the word moment, landing on a wide layered still, set huge behind the picture's subject.
// - SHORT_COMPARE_WIPE: a ranking line comparing two entries' games shows both games' pictures, split by a wipe.
// - SHORT_DEPTH_ORBIT: the Short's best layered still swings round its subject once (components/DepthOrbit.tsx).
//
// The rules every device keeps: never inside the hook (the first seconds sell the Short) or the loop's return to
// frame 0; never over another overlay (the clean frame's one-at-a-time rule); on screen long enough to read; tied
// to the words being said. Pure and browser-safe: the pipeline plans (src/shortupgradestep.ts), Short.tsx draws.

import type { GameMapGraphic } from "./gamemap.ts";
import { FLY_TO } from "./gamemap.ts";
import type { Segment } from "./timeline.ts";

export interface ShortUpgradeSwitches {
  mapPins: boolean;
  gameLook: boolean;
  blender: boolean;
  blenderWaitMinutes: number;
  blenderMarginMinutes: number;
  box3d: boolean;
  depthType: boolean;
  compareWipe: boolean;
  depthOrbit: boolean;
}

/** A game map over a line that names its places (frames are the Short's own). */
export interface ShortMapMoment {
  key: string;
  from: number;
  len: number;
  segment: number;
  /** The line's card gives way to the map (they would overlap). */
  replacesCard: boolean;
  graphic: {
    primary: string;
    secondary: string;
    items: string[];
    gameMap: GameMapGraphic;
  };
}

/** A Blender 3D clip over its beat; `src` in the render, `file` (relative to the episode) in the pipeline. */
export interface ShortBlenderMoment {
  key: string;
  from: number;
  len: number;
  role: "rank";
  segment: number;
  src?: string;
  file?: string;
}

/** Two games' pictures split by a wipe while a line compares them (indices into the Short's images). */
export interface ShortWipeMoment {
  key: string;
  from: number;
  len: number;
  left: number;
  right: number;
  leftGame: string;
  rightGame: string;
}

/** The word moment set behind a still's subject: drawn over the whole shot so the picture never changes mid-shot. */
export interface ShortDepthTypeMoment {
  key: string;
  from: number;
  len: number;
  image: number;
  phrase: string;
  /** The word's frame from `from`. */
  at: number;
  /** The frame (from `from`) the phrase is gone by: the word moment's kept stretch, so it never shares the frame. */
  until: number;
  /** Which word moment it stands in for. */
  stamp: number;
}

/** One still filmed as a 3D photo that swings round its subject. */
export interface ShortOrbitMoment {
  key: string;
  from: number;
  len: number;
  image: number;
  dir: 1 | -1;
}

/** What a Short draws of the upgrades (ShortProps.upgrades). */
export interface ShortUpgrades {
  /** SHORT_GAME_LOOK: the cards in the game's look where it has a profile. */
  look?: boolean;
  /** SHORT_BOX_3D: a ranking card's cover as a turning box. */
  box3d?: boolean;
  maps?: ShortMapMoment[];
  blender?: ShortBlenderMoment[];
  wipes?: ShortWipeMoment[];
  depthTypes?: ShortDepthTypeMoment[];
  orbits?: ShortOrbitMoment[];
  /** GTA_KIT (src/render/gtakit.ts): the kit's place card, cash readout or head-to-head over their lines. */
  kit?: import("./gtakit.ts").KitMoment[];
}

/** A span another overlay holds (frames, `to` exclusive), as src/render/cleanframe.ts keeps them. */
export interface TakenSpan {
  kind: string;
  from: number;
  to: number;
}

/** Overlays a full-frame device may sit over: the shelf steps back under it (Short.tsx overShelf). */
const PASSABLE = new Set(["shelf"]);

// ---- Game maps ------------------------------------------------------------------------------------------------

/** How much faster than a long video's the Short's camera flies down (GameMap3D pace). */
export const SHORT_MAP_SPEED = 1.8;
/** The frame (from the map's start) the first pin lands on in a Short: FLY_TO - 10 at SHORT_MAP_SPEED. */
export const SHORT_MAP_PIN_FRAME = Math.round((FLY_TO - 10) / SHORT_MAP_SPEED);
/** A Short's map holds at least 3.5 s (the pin, its label and the heading read) and at most 5 s. */
export const SHORT_MAP_MIN = 105;
export const SHORT_MAP_MAX = 150;
/** It may run on this far into the next line, to reach its reading time. */
export const SHORT_MAP_SPILL = 15;

/** The long-video frame a Short's map frame stands for: the fly-down at SHORT_MAP_SPEED, then real time (pure). */
export function shortMapFrame(frame: number, speed = SHORT_MAP_SPEED): number {
  const pin = FLY_TO - 10;
  const turn = pin / speed;
  return frame <= turn ? frame * speed : pin + (frame - turn);
}

/** The free stretches of [from, to) once the taken spans are cut out (pure). */
export function freeStretches(
  from: number,
  to: number,
  taken: readonly TakenSpan[],
): Array<[number, number]> {
  let pieces: Array<[number, number]> = to > from ? [[from, to]] : [];
  for (const t of taken) {
    if (PASSABLE.has(t.kind)) continue;
    const next: Array<[number, number]> = [];
    for (const [a, b] of pieces) {
      if (t.to <= a || t.from >= b) next.push([a, b]);
      else {
        if (t.from > a) next.push([a, t.from]);
        if (t.to < b) next.push([t.to, b]);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Where a line's game map goes (pure): it starts so the first pin lands on the place's word, never before its line
 * or inside the hook, and holds SHORT_MAP_MIN to SHORT_MAP_MAX frames, up to a little past its line, before the loop's
 * return. Overlays it would cover (word moments, insets, freezes, fillers, cards) keep their frames: a map that cannot
 * start within a beat of its word and read in full between them is not shown. Cards are left out of `taken` when the
 * map may replace its line's card.
 */
export function placeShortMap(o: {
  /** The place's first spoken word, seconds. */
  wordAt: number;
  segStart: number;
  segEnd: number;
  hookEnd: number;
  loopFrom: number;
  fps: number;
  taken: readonly TakenSpan[];
}): { from: number; len: number } | undefined {
  const ideal = Math.round(o.wordAt * o.fps) - SHORT_MAP_PIN_FRAME;
  // The dive may start in the line before (a place among a line's first words), never inside the hook.
  const from0 = Math.max(o.segStart - SHORT_MAP_PIN_FRAME, o.hookEnd, ideal);
  const end = Math.min(o.segEnd + SHORT_MAP_SPILL, o.loopFrom);
  const piece = freeStretches(from0, end, o.taken).find(
    ([a]) => a - from0 <= 12,
  );
  if (!piece) return undefined;
  const [a, b] = piece;
  // The pin lands on its word, at most a beat (12 frames) late: a map pushed later shows the pin after the line moved on.
  if (a > ideal + 12 || a + SHORT_MAP_PIN_FRAME > o.segEnd) return undefined;
  const len = Math.min(SHORT_MAP_MAX, b - a);
  return len >= SHORT_MAP_MIN ? { from: a, len } : undefined;
}

// ---- Game look ------------------------------------------------------------------------------------------------

/**
 * Whose look a segment's card wears (pure): in a ranking, the entry's own game (its rank card's title, carried to the
 * lines after it); otherwise the Short's game.
 */
export function lookTitleAt(
  segments: readonly Pick<Segment, "kind" | "visual">[],
  i: number,
  game: string,
): string {
  for (let k = i; k >= 0; k--) {
    const v = segments[k]?.visual;
    if (segments[k]?.kind === "beat" && v?.kind === "rank" && v.primary.trim())
      return v.primary;
  }
  return game;
}

// ---- Blender podium -------------------------------------------------------------------------------------------

/** The podium clip's length in a Short: long enough to read rank and name, short enough to keep the pace. */
export const SHORT_PODIUM_SECONDS = 3;

/**
 * The 3D clips a Short asks for (pure): only a ranking's number one, opening its entry on the vertical podium, when
 * the entry runs long enough to leave its card most of its time. Returns the beat and the scene's parameters.
 */
export function shortBlenderBeats(segments: readonly Segment[]): Array<{
  segment: number;
  at: number;
  seconds: number;
  params: Record<string, unknown>;
}> {
  const ranks = segments.filter(
    (s) => s.kind === "beat" && s.visual?.kind === "rank",
  );
  const i = segments.findIndex(
    (s) =>
      s.kind === "beat" && s.visual?.kind === "rank" && s.visual.value_a === 1,
  );
  const s = segments[i];
  // Release-date lists and achievements wear a date or a requirement on the badge, not a rank: no podium.
  // Never inside the hook: a list that opens on its number one keeps its opening clean.
  const hookEnd = segments.find((x) => x.kind === "hook")?.end ?? 3;
  if (!s?.visual || s.start < hookEnd || ranks.length < 3 || s.visual.date_to || s.visual.items?.[2])
    return [];
  const len = s.end - s.start;
  if (len < SHORT_PODIUM_SECONDS + 2) return [];
  // " | ", not " · ": the 3D scenes' font has no middle dot (src/render/blender.ts planBlender).
  const meta = [s.visual.items?.[0], s.visual.items?.[1]]
    .filter(Boolean)
    .join(" | ");
  return [
    {
      segment: i,
      at: s.start,
      seconds: SHORT_PODIUM_SECONDS,
      params: {
        rank: 1,
        title: s.visual.primary,
        ...(meta ? { meta } : {}),
        kicker: `Number 1 of ${ranks.length}`,
        vertical: true,
      },
    },
  ];
}

/**
 * How a Short's wait for its 3D clips stands (pure): "render" now with what is back, or "wait" until `retryAt`.
 * Only a Short with a slot waits, never past its slot less the margin, and never longer than `waitMinutes` from its
 * first ask.
 */
export function blenderWaitVerdict(o: {
  now: number;
  slotAt?: number;
  askedAt?: number;
  pending: number;
  waitMinutes: number;
  marginMinutes: number;
  pollMinutes?: number;
}): { verdict: "render" } | { verdict: "wait"; retryAt: number } {
  if (!o.pending || !o.slotAt) return { verdict: "render" };
  const asked = o.askedAt ?? o.now;
  const deadline = Math.min(
    asked + o.waitMinutes * 60_000,
    o.slotAt - o.marginMinutes * 60_000,
  );
  if (o.now >= deadline) return { verdict: "render" };
  return {
    verdict: "wait",
    retryAt: Math.min(deadline, o.now + (o.pollMinutes ?? 3) * 60_000),
  };
}

/** Whether a Short's slot leaves time to ask for a 3D clip at all: the wait and the margin both fit (pure). */
export function blenderLeadOk(o: {
  now: number;
  slotAt?: number;
  waitMinutes: number;
  marginMinutes: number;
}): boolean {
  return (
    !!o.slotAt &&
    o.slotAt - o.now >= (Math.min(o.waitMinutes, 12) + o.marginMinutes) * 60_000
  );
}

// ---- Stills: depth type and orbit -------------------------------------------------------------------------------

export interface UpgradeImage {
  kind: string;
  aspect: number;
  wordy?: boolean;
  focusX?: number;
  beatIndex?: number;
  layers?: { bg: string; mid: string; fg: string; mesh?: unknown };
}

export interface UpgradeShot {
  start: number;
  end: number;
  media: { type: string; index: number };
  then?: boolean;
}

/** Pictures that are not the game's world: covers, logos, people, hardware. */
const NOT_WIDE = new Set([
  "capsule",
  "logo",
  "portrait",
  "photo",
  "person",
  "icon",
  "hardware",
  "sketch",
]);

const wideStill = (im: UpgradeImage | undefined): boolean =>
  !!im && !NOT_WIDE.has(im.kind) && im.aspect >= 1.2 && !im.wordy;

/** A word moment short enough to set huge: one or two words, at most 12 letters (a phone's width at size). */
export function shortTypeable(text: string | undefined): string | undefined {
  const t = (text ?? "")
    .trim()
    .replace(/[.,;:!?"“”]+$/g, "")
    .replace(/^["“]+/, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2 || t.length > 12 || t.length < 3)
    return undefined;
  return t;
}

/**
 * SHORT_DEPTH_TYPE (pure): each word moment with no second line, landing on a wide still with depth layers after the
 * hook, with at least 2 s of the shot left after its word, is set behind the still's subject for that whole shot. The
 * phrase rises and goes in the word moment's own kept stretch (`kept`, the clean frame's `stamp<k>`; the planned hold
 * where there is none), so it never shares the frame with another overlay.
 */
export function shortDepthTypes(o: {
  stamps: ReadonlyArray<{ at: number; text: string; sub?: string }>;
  kept?: ReadonlyArray<{ key: string; from: number; to: number }>;
  shots: readonly UpgradeShot[];
  images: readonly UpgradeImage[];
  fps: number;
  hookEnd: number;
  loopFrom: number;
}): ShortDepthTypeMoment[] {
  const out: ShortDepthTypeMoment[] = [];
  o.stamps.forEach((st, k) => {
    const phrase = shortTypeable(st.text);
    if (!phrase || st.sub?.trim()) return;
    const span = o.kept
      ? o.kept.find((x) => x.key === `stamp${k}`)
      : { from: Math.round(st.at * o.fps), to: Math.round(st.at * o.fps) + 84 };
    if (!span) return;
    const f = span.from;
    const sh = o.shots.find((s) => f >= s.start && f < s.end);
    if (!sh || sh.media.type !== "image" || sh.then) return;
    const im = o.images[sh.media.index];
    if (!wideStill(im) || !im!.layers) return;
    if (sh.start < o.hookEnd || sh.end > o.loopFrom || sh.end - f < 2 * o.fps)
      return;
    if (out.some((x) => x.from === sh.start)) return;
    out.push({
      key: `dtype${k}`,
      from: sh.start,
      len: sh.end - sh.start,
      image: sh.media.index,
      phrase,
      at: f - sh.start,
      until: Math.min(sh.end, span.to) - sh.start,
      stamp: k,
    });
  });
  return out;
}

/**
 * SHORT_DEPTH_ORBIT (pure): the Short's longest still shot after the hook on a wide picture with the depth camera's
 * maps, at least 2.5 s, whose subject sits near the middle (the orbit frames the picture's centre), not one already
 * set with depth type. One a Short: a device, not a habit.
 */
export function shortOrbit(o: {
  shots: readonly UpgradeShot[];
  images: readonly UpgradeImage[];
  fps: number;
  hookEnd: number;
  loopFrom: number;
  blocked?: ReadonlySet<number>;
  variant?: number;
}): ShortOrbitMoment | undefined {
  let best: { s: UpgradeShot; i: number } | undefined;
  o.shots.forEach((s, i) => {
    if (
      i === 0 ||
      s.media.type !== "image" ||
      s.then ||
      o.blocked?.has(s.start)
    )
      return;
    const im = o.images[s.media.index];
    if (!wideStill(im) || !im!.layers?.mesh) return;
    const fx = im!.focusX ?? 0.5;
    if (fx < 0.3 || fx > 0.7) return;
    if (
      s.start < o.hookEnd ||
      s.end > o.loopFrom ||
      s.end - s.start < 2.5 * o.fps
    )
      return;
    if (!best || s.end - s.start > best.s.end - best.s.start) best = { s, i };
  });
  if (!best) return undefined;
  const { s, i } = best;
  return {
    key: `orbit${i}`,
    from: s.start,
    len: s.end - s.start,
    image: s.media.index,
    dir: (o.variant ?? i) % 2 ? -1 : 1,
  };
}

// ---- Compare wipe -----------------------------------------------------------------------------------------------

/** A Short's wipe holds 2.5 s: two stills side by side slow a Short if they stay longer. */
export const SHORT_WIPE_FRAMES = 75;

/** Words that make a line a comparison (the long videos' cue, src/render/boldideas.ts). */
const COMPARE_CUE =
  /\b(than|versus|vs\.?|compared|comparison|unlike|whereas|next to)\b/i;

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/grand theft auto/g, "gta")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * SHORT_COMPARE_WIPE (pure): in a ranking, a line with a comparison cue that names another entry's game (its whole
 * name as written, capital first) splits the frame between the two games' wide pictures for SHORT_WIPE_FRAMES from
 * the other game's name, inside the line and clear of the hook, the loop and every overlay but the entry's own card
 * (which stays over it). At most one a Short.
 */
export function shortCompareWipe(o: {
  segments: readonly Segment[];
  words: ReadonlyArray<{ start: number; text: string }>;
  images: readonly UpgradeImage[];
  fps: number;
  hookEnd: number;
  loopFrom: number;
  taken: readonly TakenSpan[];
}): ShortWipeMoment | undefined {
  const entries: Array<{ seg: number; game: string; entry: number }> = [];
  o.segments.forEach((s, i) => {
    if (
      s.kind === "beat" &&
      s.visual?.kind === "rank" &&
      s.visual.primary.trim()
    )
      entries.push({
        seg: i,
        game: s.visual.primary.trim(),
        entry: entries.length,
      });
  });
  if (entries.length < 2) return undefined;
  const picture = (entry: number) =>
    o.images.findIndex((im) => im.beatIndex === entry && wideStill(im));
  for (const e of entries) {
    const s = o.segments[e.seg]!;
    const ws = o.words.filter(
      (w) => w.start >= s.start - 0.05 && w.start < s.end,
    );
    const raw = ws.map((w) => w.text).join(" ");
    if (!COMPARE_CUE.test(fold(raw))) continue;
    for (const other of entries) {
      if (other.entry === e.entry || fold(other.game) === fold(e.game))
        continue;
      const name = other.game.replace(/^Grand Theft Auto/, "GTA");
      const parts = fold(name).split(" ").filter(Boolean);
      if (!parts.length) continue;
      // The other game's name as said, word by word, the first with its capital ("Journey", not "the journey").
      const at = ws.findIndex(
        (_, k) =>
          parts.every((p, j) => fold(ws[k + j]?.text ?? "") === p) &&
          /^[A-Z0-9"“]/.test(ws[k]!.text.trim()),
      );
      if (at < 0) continue;
      const left = picture(e.entry);
      const right = picture(other.entry);
      if (left < 0 || right < 0) continue;
      const from = Math.max(
        Math.round(ws[at]!.start * o.fps) - 4,
        o.hookEnd,
        Math.round(s.start * o.fps),
      );
      const to = Math.min(from + SHORT_WIPE_FRAMES, o.loopFrom);
      const others = o.taken.filter((t) => t.kind !== "entry");
      if (
        to - from < SHORT_WIPE_FRAMES ||
        freeStretches(from, to, others)[0]?.[1] !== to ||
        freeStretches(from, to, others)[0]?.[0] !== from
      )
        continue;
      return {
        key: `wipe${e.seg}`,
        from,
        len: to - from,
        left,
        right,
        leftGame: e.game,
        rightGame: other.game,
      };
    }
  }
  return undefined;
}

/**
 * The graphics frame check's sample times with the upgrades in mind (pure): a card the map stands in for, or one the map
 * covers at that moment, is not sampled (the frame shows the map); a rank card sampled under the 3D podium is sampled
 * just after it instead, where the card itself is on screen.
 */
export function checksClearOfUpgrades<T extends { key: string; t: number }>(
  checks: readonly T[],
  up: ShortUpgrades | undefined,
  fps: number,
): T[] {
  if (!up) return [...checks];
  const out: T[] = [];
  for (const c of checks) {
    const f = Math.round(c.t * fps);
    const map = (up.maps ?? []).find(
      (m) => (m.replacesCard && c.key === `card${m.segment}`) || (f >= m.from && f < m.from + m.len),
    );
    if (map) continue;
    // GTA_KIT: a card the kit stands in for is not there to check.
    if ((up.kit ?? []).some((k) => k.replacesCard && c.key === `card${k.line}`)) continue;
    const pod = (up.blender ?? []).find((b) => f >= b.from && f < b.from + b.len);
    out.push(pod ? { ...c, t: (pod.from + pod.len + 15) / fps } : c);
  }
  return out;
}
