// Which word-moment look a Short gets (owner, 30 Oct 2026: "those red stamps are being too overused in
// shorts, we need WAY more variety"). The suite (src/render/components/wordmoment) has nineteen looks; this
// picks one per Short from the ones that can draw the stamp (fits, tone, era), never the previous Short's,
// never one already used that day while another fits, preferring looks the channel has not used in its
// last twelve and, when the Short wears a motif (a console or franchise look), one that suits it. The
// choice is stored on the plan (`plan.wordLook`) so a retried render is identical, and the last twelve
// are kept in the settings row `recent_word_looks`. `pickWordLook` is pure; the two settings helpers read
// and write that row the way src/experiments.ts reads and writes its overrides.
import type { Db } from "../db.ts";
import { DEFAULT_LOOK, W_STYLES } from "./components/wordmoment/index.ts";
import type { Tone, WordSound, WordStamp } from "./components/wordmoment/types.ts";
import { LEVEL, RETRO_SFX, SFX } from "./soundscape.ts";

export const RECENT_WORD_LOOKS_KEY = "recent_word_looks";
/** How many looks the channel remembers. */
export const RECENT_KEEP = 12;

/** One remembered use: the look and the day (YYYY-MM-DD) it went out. Newest first in the list. */
export type RecentLook = { look: string; day: string };

export type WordLookContext = {
  /** The game's release year, when known (the VHS look wants a game from before 2000). */
  year?: number;
  /** The Short's motif id (src/render/components/motifs), when it wears one. */
  motif?: string;
  /** The day the Short is made, YYYY-MM-DD. */
  day: string;
  /** The Short's variant or any stable number: breaks ties the same way on a retry. */
  seed?: number;
};

/** A stable 0..1 from a string and a number: the picker's only tie-breaker. */
function hash(s: string, seed: number): number {
  let h = 2166136261 ^ (seed | 0);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** What the picker needs of a stamp: the pipeline's stamp (tone as a string) or a render prop. */
export type StampIn = { text: string; sub?: string; tone?: string };

const TONES: readonly string[] = ["confirm", "alert", "price", "neutral"];

/** The looks that can draw this stamp in this Short, by name, in registry order. */
export function fittingLooks(
  stamp: StampIn,
  ctx: Pick<WordLookContext, "year">,
): string[] {
  const tone = TONES.includes(stamp.tone ?? "")
    ? (stamp.tone as Tone)
    : undefined;
  const full: WordStamp = {
    at: 0,
    colour: "",
    text: stamp.text,
    sub: stamp.sub,
    tone,
  };
  return Object.keys(W_STYLES).filter((id) => {
    const w = W_STYLES[id]!;
    if (w.tone && tone && !w.tone.includes(tone)) return false;
    if (w.era) {
      if (w.era.to !== undefined && (!ctx.year || ctx.year > w.era.to))
        return false;
      if (
        w.era.from !== undefined &&
        ctx.year !== undefined &&
        ctx.year < w.era.from
      )
        return false;
    }
    try {
      return !w.fits || w.fits(full);
    } catch {
      return false;
    }
  });
}

/**
 * The look for this Short's word moment. Among the fitting looks: not the previous Short's (recent[0]),
 * not one used today, then the ones not in `recent` at all, then (with a motif) the ones that suit it,
 * then the least recently used; ties break on a hash of the stamp's text and the seed.
 */
export function pickWordLook(
  stamp: StampIn,
  ctx: WordLookContext,
  recent: RecentLook[],
): string {
  let cands = fittingLooks(stamp, ctx);
  if (!cands.length) return DEFAULT_LOOK;
  const previous = recent[0]?.look;
  if (previous && cands.length > 1) {
    const rest = cands.filter((c) => c !== previous);
    if (rest.length) cands = rest;
  }
  const today = new Set(
    recent.filter((r) => r.day === ctx.day).map((r) => r.look),
  );
  const fresh = cands.filter((c) => !today.has(c));
  if (fresh.length) cands = fresh;
  const lastUse = (id: string) => {
    const i = recent.findIndex((r) => r.look === id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const suits = (id: string) =>
    Boolean(ctx.motif && W_STYLES[id]!.motifs?.includes(ctx.motif));
  const key = (id: string) => [
    lastUse(id) === Number.POSITIVE_INFINITY ? 1 : 0,
    suits(id) ? 1 : 0,
    lastUse(id) === Number.POSITIVE_INFINITY ? 0 : lastUse(id),
    hash(`${stamp.text}|${id}`, ctx.seed ?? 0),
  ];
  return [...cands].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++)
      if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
    return a < b ? -1 : 1;
  })[0]!;
}

/** The list with a new use at its head, kept to RECENT_KEEP. */
export function remember(
  recent: RecentLook[],
  look: string,
  day: string,
): RecentLook[] {
  return [{ look, day }, ...recent].slice(0, RECENT_KEEP);
}

/** The sound that lands with a look: its soundscape file and level (src/render/soundscape.ts). */
export function wordSoundCue(look: string | undefined): {
  name: string;
  volume: number;
} {
  const kind: WordSound = W_STYLES[look ?? ""]?.sound ?? "land";
  switch (kind) {
    case "air":
      return { name: SFX.air[0], volume: LEVEL.air };
    case "glint":
      return { name: SFX.glint[0], volume: LEVEL.glint };
    case "vhs":
    case "static":
    case "tvon":
      // The retro kit at its lab level for a Short (the long videos' level less their 2 dB cut).
      return {
        name: RETRO_SFX[kind],
        volume:
          kind === "static" ? LEVEL.staticLong * 1.26 : LEVEL.retroLong * 1.26,
      };
    default:
      return { name: SFX.land[0], volume: LEVEL.land };
  }
}

/** The motif the Short will wear, as src/render/Short.tsx finds it; none when the motifs cannot load. */
export async function motifIdFor(
  gameTitle: string,
  year: number | undefined,
): Promise<string | undefined> {
  return import("./components/motifs/index.ts")
    .then(
      (m) =>
        m.motifsFor({
          title: gameTitle,
          platforms: "",
          year,
          theme: gameTitle,
        })[0]?.id,
    )
    .catch(() => undefined);
}

// ---- The settings row ---------------------------------------------------------------------------

export async function readRecentWordLooks(db: Db): Promise<RecentLook[]> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [RECENT_WORD_LOOKS_KEY],
  );
  try {
    const list = row ? (JSON.parse(row.value) as unknown) : [];
    return Array.isArray(list)
      ? list
          .filter((x): x is RecentLook =>
            Boolean(
              x &&
              typeof x === "object" &&
              typeof (x as RecentLook).look === "string",
            ),
          )
          .map((x) => ({ look: x.look, day: String(x.day ?? "") }))
          .slice(0, RECENT_KEEP)
      : [];
  } catch {
    return [];
  }
}

export async function writeRecentWordLooks(
  db: Db,
  recent: RecentLook[],
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [RECENT_WORD_LOOKS_KEY, JSON.stringify(recent.slice(0, RECENT_KEEP))],
  );
}

/** Picks the look for a Short from the channel's memory and records it. The one call the pipeline makes. */
export async function chooseWordLook(
  db: Db,
  stamp: StampIn,
  ctx: WordLookContext,
): Promise<{ look: string; recent: string[] }> {
  const recent = await readRecentWordLooks(db);
  const look = pickWordLook(stamp, ctx, recent);
  await writeRecentWordLooks(db, remember(recent, look, ctx.day));
  return { look, recent: recent.map((r) => r.look) };
}
