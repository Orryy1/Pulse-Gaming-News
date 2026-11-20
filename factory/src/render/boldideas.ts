// Three visual devices from the 20 Nov 2026 research pass (the owner asked for "tons of genius visual ideas"), each
// behind its own switch and off until a proof render has been judged. Pure planning only; the components draw.
//
// - CHAPTER_WALL (components/ScreenshotWall.tsx): a documentary chapter's title breather plays over a 3D wall of
//   that chapter's own stills, the camera drifting through it, instead of a flat texture. Same title, same look for
//   every chapter (the owner's one-look rule of 5 Nov), only the backdrop is new.
// - DEPTH_TYPE (components/DepthType.tsx): on a wide still with depth layers, the line's stressed phrase is set huge
//   BEHIND the picture's subject, between the far wall and the figure, the magazine-cover trick, in place of that
//   line's ordinary caption.
// - COMPARE_WIPE (components/CompareWipe.tsx): when a line compares the chapter's game with another chapter's game
//   ("bigger than San Andreas"), the two games' pictures share the frame behind a sliding wipe, each labelled.
//
// Browser-safe: the Remotion bundle loads it.

/** Kinds of still worth putting on the wall or under the type: wide, full-bleed game pictures. */
const WIDE_KINDS = new Set(["hero", "screenshot", "article", "header"]);

export interface IdeaImage {
  kind: string;
  aspect: number;
  beatIndex?: number;
  wordy?: boolean;
  layers?: { bg: string; mid: string; fg: string };
}

/** Most pictures on one wall: enough to read as a wall, few enough for a 4K frame to stay cheap. */
export const WALL_MAX = 12;
/** A wall needs at least this many pictures or the chapter keeps its plain breather. */
export const WALL_MIN = 5;

/**
 * The pictures on a chapter's wall (pure): the chapter's wide game stills first, topped up from the neighbouring
 * chapters' when it has too few, never the same picture twice; empty when even that is fewer than WALL_MIN.
 */
export function wallPictures(
  images: readonly IdeaImage[],
  chapter: number | undefined,
): number[] {
  const wide = images
    .map((im, i) => ({ im, i }))
    .filter(({ im }) => WIDE_KINDS.has(im.kind) && im.aspect >= 1.2);
  const own = wide
    .filter(({ im }) => im.beatIndex === chapter)
    .map(({ i }) => i);
  const near = wide
    .filter(({ im }) => im.beatIndex !== chapter)
    .sort(
      (a, b) =>
        Math.abs((a.im.beatIndex ?? 99) - (chapter ?? 0)) -
          Math.abs((b.im.beatIndex ?? 99) - (chapter ?? 0)) || a.i - b.i,
    )
    .map(({ i }) => i);
  const out = [...own, ...near].slice(0, WALL_MAX);
  return out.length >= WALL_MIN ? out : [];
}

/** Where each card sits on the wall (pure, seeded): a gentle curve of rows in depth, nearer cards larger. */
export function wallLayout(
  n: number,
  seed: number,
): Array<{
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  delay: number;
}> {
  const out: Array<{
    x: number;
    y: number;
    z: number;
    ry: number;
    w: number;
    delay: number;
  }> = [];
  const cols = 4;
  let r = (seed * 9301 + 49297) % 233280;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  for (let k = 0; k < n; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const x = (col - (cols - 1) / 2) * 560 + (rnd() - 0.5) * 120;
    const y = (row - 1) * 340 + (rnd() - 0.5) * 70;
    // The wall curves away at its sides, and alternate cards step forward or back a little.
    const z = -Math.abs(x) * 0.45 - row * 120 - rnd() * 260;
    out.push({
      x,
      y,
      z,
      ry: -x / 60,
      w: 480 + rnd() * 90,
      delay: Math.round(k * 2.5 + rnd() * 4),
    });
  }
  return out;
}

export interface IdeaWindow {
  entry: number;
  moment: number;
  start: number;
  end: number;
  at: number;
}

export interface IdeaShot {
  start: number;
  end: number;
  media: { type: string; index: number };
}

/** A phrase short enough to set huge: one to three words, at most 18 letters. */
export function typeablePhrase(text: string | undefined): string | undefined {
  const t = (text ?? "")
    .trim()
    .replace(/[.,;:!?"“”]+$/g, "")
    .replace(/^["“]+/, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3 || t.length > 18 || t.length < 3)
    return undefined;
  return t;
}

/** Seconds between two depth-type moments, and the most a video gets: a device, not a habit. */
export const DEPTH_TYPE_GAP_SECONDS = 45;
export const DEPTH_TYPE_MAX = 8;

/**
 * The shots that get the stressed phrase behind their subject (pure): a window whose emphasis is typeable, landing
 * on a wide still with depth layers that has two seconds left after the word, spaced and capped. `blocked` are
 * shots something else already claims (a detail push, a retro device, a display). Returns shot index to the
 * phrase, the window's index (its caption is then not drawn) and the word's frame from the shot's start.
 */
export function depthTypePlan(
  windows: readonly IdeaWindow[],
  emphasisOf: (w: IdeaWindow) => string | undefined,
  shots: readonly IdeaShot[],
  images: readonly IdeaImage[],
  fps: number,
  blocked: ReadonlySet<number> = new Set(),
): Map<number, { phrase: string; window: number; at: number }> {
  const out = new Map<number, { phrase: string; window: number; at: number }>();
  let last = -Infinity;
  windows.forEach((w, k) => {
    if (out.size >= DEPTH_TYPE_MAX || w.moment === 0) return;
    const phrase = typeablePhrase(emphasisOf(w));
    if (!phrase) return;
    const f = Math.round(w.at * fps);
    if (f - last < DEPTH_TYPE_GAP_SECONDS * fps) return;
    const i = shots.findIndex((s) => f >= s.start && f < s.end);
    const sh = shots[i];
    if (!sh || sh.media.type !== "image" || blocked.has(i) || out.has(i))
      return;
    const im = images[sh.media.index];
    if (!im?.layers || !WIDE_KINDS.has(im.kind) || im.aspect < 1.2 || im.wordy)
      return;
    if (sh.end - f < 2 * fps) return;
    out.set(i, { phrase, window: k, at: Math.max(0, f - sh.start) });
    last = f;
  });
  return out;
}

/** Words that make a sentence a comparison. */
const COMPARE_CUE =
  /\b(than|versus|vs\.?|compared|comparison|against|unlike|whereas|while|next to)\b/i;

/** A game's name as spoken: lower case, "grand theft auto" folded to "gta", numerals kept. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/grand theft auto/g, "gta")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The distinctive part of a game's name, the words a narrator says ("San Andreas" of "GTA: San Andreas"). */
export function gameCallNames(game: string): string[] {
  const parts = fold(game);
  const out = new Set<string>([parts]);
  const tail = parts.replace(/^gta /, "");
  if (tail !== parts && tail.length >= 3) out.add(tail);
  return [...out].filter((x) => x.length >= 3);
}

/** Seconds a wipe holds, and the most a video gets. */
export const COMPARE_SECONDS = 4;
export const COMPARE_MAX = 6;

/**
 * The comparison wipes (pure): a window whose words carry a comparison cue and name another chapter's game, inside
 * a chapter that has a wide picture of its own game and where the other game has one too. At most COMPARE_MAX, one
 * per chapter. Returns frames (absolute) and the two pictures with their games.
 */
export function compareWipePlan(
  windows: readonly IdeaWindow[],
  words: ReadonlyArray<{ start: number; text?: string }>,
  chapterGames: ReadonlyMap<number, string>,
  images: readonly IdeaImage[],
  fps: number,
): Array<{
  from: number;
  len: number;
  left: number;
  right: number;
  leftGame: string;
  rightGame: string;
}> {
  const out: Array<{
    from: number;
    len: number;
    left: number;
    right: number;
    leftGame: string;
    rightGame: string;
  }> = [];
  const best = (entry: number) =>
    images.findIndex(
      (im) =>
        im.beatIndex === entry &&
        WIDE_KINDS.has(im.kind) &&
        im.aspect >= 1.2 &&
        !im.wordy,
    );
  const used = new Set<number>();
  for (const w of windows) {
    if (out.length >= COMPARE_MAX || used.has(w.entry)) continue;
    const own = chapterGames.get(w.entry);
    if (!own) continue;
    const text = fold(
      words
        .filter((x) => x.start >= w.start - 0.05 && x.start < w.end)
        .map((x) => x.text ?? "")
        .join(" "),
    );
    if (!COMPARE_CUE.test(text)) continue;
    const ownNames = gameCallNames(own);
    let other: number | undefined;
    for (const [entry, game] of chapterGames) {
      if (entry === w.entry || game === own) continue;
      const names = gameCallNames(game).filter(
        (n) => !ownNames.some((o) => o.includes(n)),
      );
      if (
        names.some((n) =>
          new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
            text,
          ),
        )
      ) {
        other = entry;
        break;
      }
    }
    if (other === undefined) continue;
    const left = best(w.entry);
    const right = best(other);
    if (left < 0 || right < 0) continue;
    const from = Math.round(w.start * fps);
    const len = Math.min(
      Math.round(COMPARE_SECONDS * fps),
      Math.max(0, Math.round(w.end * fps) - from),
    );
    if (len < 2 * fps) continue;
    out.push({
      from,
      len,
      left,
      right,
      leftGame: own,
      rightGame: chapterGames.get(other)!,
    });
    used.add(w.entry);
  }
  return out;
}
