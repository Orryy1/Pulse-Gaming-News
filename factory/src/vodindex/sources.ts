// The stream recordings the factory may cut footage from, one entry a Twitch channel (owner, 25 Nov 2026): the owner's
// own channel (tinotv) first, then his cousin's (spencey96), who gave full permission for his streams to be downloaded
// and used. Each channel has its folder on the PC, its download archive, the game its titles mostly leave unsaid (his
// cousin's titles are story chapters, "GTA VI Chapter 3!"), its rank (lower is tried first) and its on-screen credit:
// none for the owner's own play, "Gameplay: Spencey96 on Twitch" for the cousin's (the handle only, never a name).
// VOD_SOURCES overrides the list: "channel=folder;channel2=folder2" (the order is the rank).
// Pure: the environment is passed in.

import path from "node:path";

export interface VodSource {
  channel: string;
  dir: string;
  /** yt-dlp's archive file: one line a downloaded VOD. */
  archive: string;
  /** Lower is tried first. */
  rank: number;
  /** The owner's own play: "Pulse's own gameplay capture", no credit. */
  own: boolean;
  /** On-screen credit; "" for the owner's own play. */
  credit: string;
  /** The game a title that names none is taken to be. */
  defaultGame: string;
}

const VODS = "D:\\pulse-data\\vods";

/** The channels known by name: the owner's own and the permitted ones, with their credit. */
export const KNOWN_CHANNELS: Record<
  string,
  { own: boolean; credit: string; folder: string; archive: string }
> = {
  tinotv: {
    own: true,
    credit: "",
    folder: "TinoTV VODs",
    archive: "downloaded.txt",
  },
  spencey96: {
    own: false,
    credit: "Gameplay: Spencey96 on Twitch",
    folder: "Spencey96 VODs",
    archive: "spencey96-downloaded.txt",
  },
};

export function vodSources(env: NodeJS.ProcessEnv): VodSource[] {
  const root = env.VOD_ROOT || VODS;
  const game = env.VOD_DEFAULT_GAME || "Grand Theft Auto VI";
  const raw = (env.VOD_SOURCES ?? "").trim();
  const pairs: Array<[string, string | undefined]> = raw
    ? raw
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const i = p.indexOf("=");
          return i > 0
            ? [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()]
            : [p.toLowerCase(), undefined];
        })
    : Object.keys(KNOWN_CHANNELS).map((c) => [c, undefined]);
  return pairs.map(([channel, dir], rank) => {
    const known = KNOWN_CHANNELS[channel];
    return {
      channel,
      dir: dir || path.join(root, known?.folder ?? `${channel} VODs`),
      archive: path.join(root, known?.archive ?? `${channel}-downloaded.txt`),
      rank,
      own: known?.own ?? false,
      // An unknown channel gets the plain handle credit: never a personal name.
      credit: known ? known.credit : `Gameplay: ${channel} on Twitch`,
      defaultGame: game,
    };
  });
}

/** The channel a recording's folder belongs to (pure); undefined for a folder on no list. */
export function sourceOfFile(
  file: string,
  sources: readonly VodSource[],
): VodSource | undefined {
  const dir = path.resolve(path.dirname(file)).toLowerCase();
  return sources.find((s) => path.resolve(s.dir).toLowerCase() === dir);
}

/** The channel's settings by name (pure); the owner's own when the name is empty (indexes made before channels). */
export function sourceByChannel(
  channel: string | undefined,
  sources: readonly VodSource[],
): VodSource | undefined {
  const c = (channel || "tinotv").toLowerCase();
  return (
    sources.find((s) => s.channel === c) ??
    (KNOWN_CHANNELS[c]
      ? {
          channel: c,
          dir: "",
          archive: "",
          rank: c === "tinotv" ? 0 : 1,
          own: KNOWN_CHANNELS[c]!.own,
          credit: KNOWN_CHANNELS[c]!.credit,
          defaultGame: "",
        }
      : undefined)
  );
}

/** A clip cut from someone's stream (the owner's or a permitted channel's): footage caps never count it (pure). */
export const STREAM_CAPTURE =
  /^(Pulse's own gameplay capture|Permitted stream capture)/;
