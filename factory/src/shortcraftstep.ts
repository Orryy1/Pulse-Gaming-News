// The Short render step's one call into the craft (src/render/shortcraft.ts), kept out of src/pipeline.ts so the
// step's edit stays two lines. It runs on the new-look Shorts only (the suite test, src/pipeline.ts suiteFor),
// so the test's other half keeps the look it is being judged against; with every SHORT_CRAFT_* setting off it
// does nothing. It reads the media-richness measure to find the bare lines, plans the four layers with the
// channel's memory, stores the result on the plan (a retried render reuses it), remembers the looks for the
// next Shorts, logs a `short_craft` event with the before and after media richness, and tells the owner on
// Discord, once, the first time it runs. No model call: every choice is a pure function.
import type { Services } from "./pipeline.ts";
import { logEvent } from "./episodes.ts";
import type { RenderPlan } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import { bareLines, shortMediaRichness } from "./qa/mediarich.ts";
import { growthDefaults } from "./growth.ts";
import { shortsCleanFor } from "./render/cleanframe.ts";
import {
  craftSummary,
  fillSeconds,
  planShortCraft,
  readRecentCraft,
  rememberCraft,
  writeRecentCraft,
  type CraftSettings,
} from "./render/shortcraft.ts";

export const CRAFT_ANNOUNCED_KEY = "short_craft_announced";

/** The plain-English notice the owner gets the first time the craft runs. */
export function craftNotice(settings: CraftSettings): string {
  const on = [
    settings.cards
      ? "Pulse-universe cards (the phone story, posts, mail and chat when the source names them, the calendar, the store, a console, a platforms panel) join the card rotation"
      : "",
    settings.photos
      ? "real photos land as an instant print, on an evidence board or as newsprint"
      : "",
    settings.fillers
      ? "a line with nothing on screen for it gets kinetic type of its key words (or a drawn scene or a document) for under three seconds"
      : "",
    settings.camera
      ? "the camera pushes through a cut or freezes on the word a line is about, at most three times in a 40 second Short"
      : "",
  ].filter(Boolean);
  return `🎬 New-look Shorts now borrow the documentaries' craft: ${on.join("; ")}. The hook, the captions, the word moment and the loop are unchanged, and nothing new costs a model call. Each part has its own switch (SHORT_CRAFT_CARDS, SHORT_CRAFT_PHOTOS, SHORT_CRAFT_FILLERS, SHORT_CRAFT_CAMERA).`;
}

export async function craftForShort(
  s: Pick<Services, "db" | "cfg" | "now" | "notify">,
  episodeId: string,
  input: {
    suite: boolean;
    segments: Segment[];
    words: Array<{ text: string; start: number; end: number }>;
    plan: RenderPlan;
    images: Array<{ kind: string; credit?: string; beatIndex?: number }>;
    clips: Array<{
      durationSeconds: number;
      beatIndex?: number;
      role?: string;
    }>;
    stamps: Array<{ at: number }>;
    game: string;
    gameYear?: number;
    seed: number;
  },
): Promise<Map<number, number> | undefined> {
  const settings: CraftSettings = {
    cards: s.cfg.shortCraftCards,
    photos: s.cfg.shortCraftPhotos,
    fillers: s.cfg.shortCraftFillers,
    camera: s.cfg.shortCraftCamera,
  };
  if (!input.suite || !Object.values(settings).some(Boolean)) return undefined;
  const { plan } = input;
  if (plan.craft) return fillSeconds(plan.craft, plan.fps);
  const before = shortMediaRichness(
    input.segments,
    plan,
    input.images,
    input.clips,
  );
  const recent = await readRecentCraft(s.db);
  const day = s.now().toISOString().slice(0, 10);
  const craft = planShortCraft(
    {
      segments: input.segments,
      words: input.words,
      plan,
      images: input.images,
      clips: input.clips,
      stamps: input.stamps,
      bare: bareLines(before),
      game: input.game,
      gameYear: input.gameYear,
      madeYear: Number(day.slice(0, 4)),
      seed: input.seed,
    },
    settings,
    recent,
  );
  plan.craft = craft;
  await writeRecentCraft(s.db, rememberCraft(recent, craft, day));
  const fills = fillSeconds(craft, plan.fps);
  const after = shortMediaRichness(
    input.segments,
    plan,
    input.images,
    input.clips,
    fills,
  );
  await logEvent(s.db, episodeId, "short_craft", {
    summary: craftSummary(craft),
    cards: craft.cards.map((c) => c.look),
    photos: craft.photos.map((p) => p.treatment),
    fillers: craft.fillers.map((f) => `${f.family}:${f.style}`),
    moves: craft.moves.map((m) => m.kind),
    media_rich_before: before.covered,
    media_rich_after: after.covered,
  });
  const [flag] = await s.db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [CRAFT_ANNOUNCED_KEY],
  );
  if (!flag) {
    await s.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [CRAFT_ANNOUNCED_KEY, day],
    );
    await s
      .notify({ level: "info", content: craftNotice(settings) })
      .catch(() => undefined);
  }
  return fills;
}

/**
 * Whether this Short is drawn clean (src/render/cleanframe.ts): SHORTS_CLEAN off, never; a Short in the clean-frame
 * retention test (src/growth.ts), its arm; after that test, its winner; until then, clean. Logged on the episode.
 */
export async function shortsCleanStep(
  s: Pick<Services, "db" | "cfg">,
  episodeId: string,
  test: { key: string; variant: "A" | "B" } | undefined,
): Promise<boolean> {
  const winner = s.cfg.shortsClean
    ? (await growthDefaults(s.db).catch(() => [])).find((d) => d.test.key === "shorts_clean")?.variant
    : undefined;
  const clean = shortsCleanFor(s.cfg.shortsClean, test, winner);
  await logEvent(s.db, episodeId, "shorts_clean", {
    clean,
    why: !s.cfg.shortsClean
      ? "SHORTS_CLEAN is off"
      : test?.key === "shorts_clean"
        ? `retention test arm ${test.variant}`
        : winner
          ? `retention test winner ${winner}`
          : "default",
  });
  return clean;
}
