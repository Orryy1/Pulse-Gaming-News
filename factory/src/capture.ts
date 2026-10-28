// The owner plays some of the games our long videos cover (GTA V now, GTA VI from launch) and their own
// gameplay is the best footage there is (src/assets/library.ts). When a long video or documentary is
// about one of their games, they get a short "record these moments" list on Discord while there is still
// time to play: the shots the video's shot list asks for. Optional for them, and nothing ever waits on it.
import type { Episode } from "./episodes.ts";
import { logEvent } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import { recordingsOf } from "./assets/library.ts";
import { errorMessage, log } from "./lib/util.ts";
import type { Services } from "./pipeline.ts";

/** At most this many things to record per game, and in the whole message. */
export const CAPTURE_PER_GAME = 5;
export const CAPTURE_MAX_LINES = 10;
/** Less lead than this and there is no time to play and record. */
export const CAPTURE_MIN_LEAD_HOURS = 12;

export interface CaptureChecklist {
  games: Array<{ game: string; shots: string[] }>;
}

/** True when the owner plays this game: the same rule as matching their recordings (a sequel never counts). */
export function ownerPlays(
  ownerGames: string[],
  game: string,
  franchise: string,
): boolean {
  return (
    !!game.trim() &&
    recordingsOf(
      ownerGames.map((g) => ({ game: g, file: "", mtimeMs: 0, bytes: 0 })),
      game,
      franchise,
    ).length > 0
  );
}

const gameplayPhrase = (w: string) => `Some gameplay with ${w}`;
const WANT_PHRASE: Record<string, (what: string) => string> = {
  gameplay: gameplayPhrase,
  cinematic: (w) => `A big story moment with ${w}`,
  character: (w) => `A close look at ${w}`,
  world: (w) => `A slow look around ${w}`,
  vehicle: (w) => `A drive with ${w}`,
  ui: (w) => `The map or menu showing ${w}`,
  calm: (w) => `A calm, quiet shot of ${w}`,
};

const key = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** One shot-list line as a friendly thing to record: capitalised, no full stop, not too long. */
function tidy(t: string): string {
  let s = t
    .replace(/[–—]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]+$/, "");
  if (s.length > 90) s = `${s.slice(0, 87).replace(/\s+\S*$/, "")}...`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The footage asks (want + keywords) of the paragraphs under one documentary chapter, or one long entry's beat. */
function footageAsks(
  script: Script,
  index: number,
): Array<{ want: string; keywords: string[] }> {
  if (script.evergreen_format !== "documentary") {
    const f = script.beats[index]?.footage;
    return f && f.want !== "none" ? [f] : [];
  }
  const out: Array<{ want: string; keywords: string[] }> = [];
  let c = -1;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter") c++;
    if (c === index && b.footage && b.footage.want !== "none")
      out.push(b.footage);
  }
  return out;
}

/**
 * The things to record for a long video or documentary: for each entry or chapter about a game the owner
 * plays, up to five concrete moments from its shot list (what each sentence wants on screen), then the
 * chapter's footage asks. Ten lines at most. Undefined when no entry is about one of their games.
 */
export function captureChecklist(
  script: Script,
  ownerGames: string[],
): CaptureChecklist | undefined {
  if (!script.entries?.length || !ownerGames.length) return undefined;
  // The order media is gathered in (src/pipeline.ts gatherMedia): entry k pairs with beat or chapter k.
  const sorted = [...script.entries].sort((a, b) => b.rank - a.rank);
  const games: CaptureChecklist["games"] = [];
  let total = 0;
  for (const [i, entry] of sorted.entries()) {
    if (total >= CAPTURE_MAX_LINES) break;
    if (entry.from_episode) continue; // a recap chapter reuses its Short's media
    const franchise = script.game_title || entry.game_title;
    if (!ownerPlays(ownerGames, entry.game_title, franchise)) continue;
    let slot = games.find((g) => key(g.game) === key(entry.game_title));
    if (!slot) {
      slot = { game: entry.game_title, shots: [] };
      games.push(slot);
    }
    const seen = new Set(slot.shots.map(key));
    const titleKey = key(entry.game_title);
    const add = (t: string) => {
      const line = tidy(t);
      const k = key(line);
      if (
        !k ||
        k === titleKey ||
        k.split(" ").length < 2 ||
        seen.has(k) ||
        slot.shots.length >= CAPTURE_PER_GAME ||
        total >= CAPTURE_MAX_LINES
      )
        return;
      seen.add(k);
      slot.shots.push(line);
      total++;
    };
    // Real-world B-roll (a studio, a court case) is stock footage, nothing to play.
    for (const m of entry.moments ?? [])
      if (!m.broll?.trim() && m.show?.trim()) add(m.show);
    for (const f of footageAsks(script, i)) {
      const words = f.keywords
        .map((k) => k.trim())
        .filter((k) => k && key(k) !== titleKey && key(k) !== key(franchise))
        .slice(0, 2);
      if (words.length)
        add((WANT_PHRASE[f.want] ?? gameplayPhrase)(words.join(" and ")));
    }
  }
  const out = games.filter((g) => g.shots.length);
  return out.length ? { games: out } : undefined;
}

/** "Saturday 31 October at 8:00 pm", in the factory's time zone. */
export function captureWhen(at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(at)
    .replace(/\s+/g, " ")
    .toLowerCase();
  return `${day} at ${time}`;
}

/** The Discord message: plain and short, for someone who just wants to play. */
export function captureMessage(
  title: string,
  list: CaptureChecklist,
  publishAt: Date,
  timeZone: string,
): string {
  return [
    `**Fancy getting your own gameplay into the next video?**`,
    `"${title}" goes out ${captureWhen(publishAt, timeZone)}. Anything you record before ${captureWhen(new Date(publishAt.getTime() - CAPTURE_GATHER_LEAD_HOURS * 3600_000), timeZone)} can make it in. These are the moments it would love:`,
    ...list.games.flatMap((g) => [
      "",
      `**${g.game}**`,
      ...g.shots.map((s) => `- ${s}`),
    ]),
    "",
    "No extra steps: anything you stream on Twitch or save as an Xbox capture gets picked up automatically, and the best bits go straight into the video. The sooner, the better. Totally optional, the video gets made either way.",
  ].join("\n");
}

/** Hours before the slot that a held video gathers its footage (rendering takes about three hours). */
export const CAPTURE_GATHER_LEAD_HOURS = 10;

/**
 * Sends the checklist when it applies, then says until when the footage should wait: CAPTURE_GATHER_LEAD_HOURS
 * before the slot, for a video whose list went out. Remakes never wait (their slot is close and set).
 */
export async function captureHold(
  s: Pick<Services, "cfg" | "db" | "notify" | "now">,
  ep: Pick<Episode, "id" | "lane" | "script_json" | "publish_at" | "slot_at">,
): Promise<Date | undefined> {
  await maybeSendCaptureChecklist(s, ep);
  const when = ep.publish_at ?? ep.slot_at;
  if (!when || !s.cfg.captureChecklist) return undefined;
  const [sent] = await s.db.query<{ remade: boolean; listed: boolean }>(
    `SELECT bool_or(kind = 'remake') AS remade, bool_or(kind = 'capture_checklist') AS listed FROM events WHERE episode_id = $1`,
    [ep.id],
  );
  if (!sent?.listed || sent.remade) return undefined;
  const until = new Date(new Date(when).getTime() - CAPTURE_GATHER_LEAD_HOURS * 3600_000);
  return until > s.now() ? until : undefined;
}

/**
 * Sends the checklist once per episode (event "capture_checklist"), for a long video or documentary
 * about one of the owner's games that goes out at least 12 hours from now. Never throws.
 */
export async function maybeSendCaptureChecklist(
  s: Pick<Services, "cfg" | "db" | "notify" | "now">,
  ep: Pick<Episode, "id" | "lane" | "script_json" | "publish_at" | "slot_at">,
): Promise<boolean> {
  try {
    const script = ep.script_json;
    if (!s.cfg.captureChecklist || !script) return false;
    if (script.runtime !== "long" && ep.lane !== "longform") return false;
    const when = ep.publish_at ?? ep.slot_at;
    if (!when) return false;
    const at = new Date(when);
    if (at.getTime() - s.now().getTime() < CAPTURE_MIN_LEAD_HOURS * 3600_000)
      return false;
    const list = captureChecklist(script, s.cfg.ownerGames);
    if (!list) return false;
    const sent = await s.db.query(
      `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'capture_checklist' LIMIT 1`,
      [ep.id],
    );
    if (sent.length) return false;
    const title = script.youtube?.title || script.headline;
    const delivered = await s.notify({
      content: captureMessage(title, list, at, s.cfg.timezone),
    });
    await logEvent(s.db, ep.id, "capture_checklist", {
      games: list.games.map((g) => g.game),
      shots: list.games.reduce((n, g) => n + g.shots.length, 0),
      publish_at: at.toISOString(),
      delivered: delivered ?? null,
    });
    return true;
  } catch (err) {
    log("warn", "capture checklist failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return false;
  }
}
