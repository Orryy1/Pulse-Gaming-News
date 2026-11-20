// The owner's recordings on this machine and the game each one is of (pure parts first). The downloader names each
// Twitch past broadcast "YYYY-MM-DD <stream title> [<vod id>].mp4" (mac/gameplay/download-vods.sh); the stream title
// names the game more often than not ("GTA V 100%", "Silent Hill: f"), so the game is read from it against the games
// the factory knows (the stream-ask games, the owner's games, the launch calendar), in every spelling the spoiler
// guard knows ("GTA 6", "GTA VI", "GTA6").

import fs from "node:fs/promises";
import path from "node:path";
import { gameAliases } from "../sceneindex/spoilers.ts";
import { parseVodName } from "./schema.ts";

const VIDEO = /\.(mp4|mkv|mov|webm)$/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The known game a stream title names, longest name first so "GTA VI" is never read as "GTA V" (pure). */
export function detectGame(title: string, known: string[]): string | undefined {
  const names = known.flatMap((g) =>
    gameAliases(g).map((a) => ({ game: g, alias: a })),
  );
  names.sort((a, b) => b.alias.length - a.alias.length);
  for (const { game, alias } of names) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${esc(alias)}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    if (re.test(title)) return game;
  }
  return undefined;
}

export interface Recording {
  file: string;
  vodId: string;
  title: string;
  recordedOn: string;
  game?: string;
  bytes: number;
  mtimeMs: number;
}

/** The recordings in a folder, newest first, each with its game when the title names one. */
export async function listRecordings(
  dir: string,
  known: string[],
): Promise<Recording[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: Recording[] = [];
  for (const name of names) {
    if (!VIDEO.test(name)) continue;
    const file = path.join(dir, name);
    const st = await fs.stat(file).catch(() => undefined);
    if (!st?.isFile() || st.size < 5_000_000) continue;
    const n = parseVodName(file);
    out.push({
      file,
      ...n,
      game: detectGame(n.title, known),
      bytes: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  return out.sort(
    (a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.mtimeMs - a.mtimeMs,
  );
}

/** The games streamed lately (pure): those named by recordings from the last `days` days, most streamed first. */
export function gamesStreamed(
  recordings: Recording[],
  today: string,
  days: number,
): string[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const count = new Map<string, number>();
  for (const r of recordings)
    if (r.game && (r.recordedOn || "0000") >= since)
      count.set(r.game, (count.get(r.game) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
