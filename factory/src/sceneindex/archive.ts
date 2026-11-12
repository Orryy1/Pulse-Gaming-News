// The curated game-footage archive (ARCHIVE_BACKLOG, owner, 12 Nov 2026: "store tons of gameplaythroughs / full
// game movies ... so we have a huge curated archive", then "index like every single game via YouTube and only
// actually download / pull clips live as we go ... essentially using the world's largest real-time video library").
// YouTube is the store. For every game on the backlog the archive picks one clean full movie or no-commentary
// playthrough (the launch picker's rules: no face cam, no commentary, no burned-in foreign subtitles, 1080p or
// better, the most complete upload) and keeps only its index.json on the Mac:
//   - a LIGHT index for every game (src/sceneindex/light.ts): captions, chapters, storyboard frames and comments,
//     no video downloaded, a megabyte or so a game, half a minute to build;
//   - a FULL index (proxy, Whisper, per-shot text reading) only for the top ARCHIVE_FULL_TOP games, where precision
//     matters; the scene index job builds it, and with ARCHIVE_PROXY=delete the proxy goes once the index is built.
// Clips are pulled live from full-quality sections of the chosen upload, per video, as the factory already does.
// One game at a time, at night (ARCHIVE_HOURS), behind the Mac's turn-taker. An upload that disappears is picked
// again and indexed again. The ranking and the book's rules are pure and tested; only the tick runs anything.

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.ts";
import { errorMessage, log } from "../lib/util.ts";
import { canonicalGame } from "./gamefetch.ts";
import {
  queueGame,
  readQueue,
  turnCommand,
  writeQueue,
  turnOutcome,
} from "./job.ts";
import { loadSceneIndex, sceneIndexDir, sceneSlug } from "./schema.ts";

export interface BacklogGame {
  game: string;
  franchise: string;
  year: number;
  /** Chosen like a recent release: the remake's or remaster's uploads are the right ones. */
  recent?: boolean;
  /** Other names the episodes use for it. */
  aka?: string[];
}

/**
 * The evergreen games Pulse covers or should cover (12 Nov 2026): every mainline GTA, Red Dead, the Zelda run,
 * Mario, FromSoftware, PlayStation's big stories, Resident Evil, Halo, Call of Duty campaigns, Final Fantasy VII,
 * the big RPGs, Metal Gear, Silent Hill, Pokemon, Valve and Blizzard. The ranking orders them; the list only says
 * which games are in.
 */
export const ARCHIVE_BACKLOG: BacklogGame[] = [
  {
    game: "Grand Theft Auto V",
    franchise: "Grand Theft Auto",
    year: 2013,
    aka: ["GTA 5", "GTA V"],
  },
  {
    game: "Grand Theft Auto: San Andreas",
    franchise: "Grand Theft Auto",
    year: 2004,
    aka: ["GTA San Andreas"],
  },
  {
    game: "Grand Theft Auto IV",
    franchise: "Grand Theft Auto",
    year: 2008,
    aka: ["GTA 4", "GTA IV"],
  },
  {
    game: "Grand Theft Auto: Vice City",
    franchise: "Grand Theft Auto",
    year: 2002,
    aka: ["GTA Vice City"],
  },
  {
    game: "Grand Theft Auto III",
    franchise: "Grand Theft Auto",
    year: 2001,
    aka: ["GTA 3", "GTA III"],
  },
  {
    game: "Grand Theft Auto: Liberty City Stories",
    franchise: "Grand Theft Auto",
    year: 2005,
  },
  {
    game: "Grand Theft Auto: Vice City Stories",
    franchise: "Grand Theft Auto",
    year: 2006,
  },
  {
    game: "Grand Theft Auto IV: The Lost and Damned",
    franchise: "Grand Theft Auto",
    year: 2009,
  },
  {
    game: "Grand Theft Auto: The Ballad of Gay Tony",
    franchise: "Grand Theft Auto",
    year: 2009,
  },
  {
    game: "Grand Theft Auto: Chinatown Wars",
    franchise: "Grand Theft Auto",
    year: 2009,
  },
  {
    game: "Red Dead Redemption 2",
    franchise: "Red Dead",
    year: 2018,
    aka: ["RDR2", "RDR 2"],
  },
  {
    game: "Red Dead Redemption",
    franchise: "Red Dead",
    year: 2010,
    aka: ["RDR"],
  },
  { game: "Bully", franchise: "Rockstar", year: 2006 },
  { game: "Max Payne 3", franchise: "Rockstar", year: 2012 },
  { game: "L.A. Noire", franchise: "Rockstar", year: 2011 },
  {
    game: "The Legend of Zelda: Ocarina of Time",
    franchise: "Zelda",
    year: 1998,
    recent: true,
    aka: ["Ocarina of Time"],
  },
  {
    game: "The Legend of Zelda: Majora's Mask",
    franchise: "Zelda",
    year: 2000,
    aka: ["Majora's Mask"],
  },
  {
    game: "The Legend of Zelda: The Wind Waker",
    franchise: "Zelda",
    year: 2002,
    aka: ["Wind Waker"],
  },
  {
    game: "The Legend of Zelda: Twilight Princess",
    franchise: "Zelda",
    year: 2006,
    aka: ["Twilight Princess"],
  },
  {
    game: "The Legend of Zelda: Skyward Sword",
    franchise: "Zelda",
    year: 2011,
    aka: ["Skyward Sword"],
  },
  {
    game: "The Legend of Zelda: Breath of the Wild",
    franchise: "Zelda",
    year: 2017,
    aka: ["Breath of the Wild", "BotW"],
  },
  {
    game: "The Legend of Zelda: Tears of the Kingdom",
    franchise: "Zelda",
    year: 2023,
    aka: ["Tears of the Kingdom", "TotK"],
  },
  {
    game: "The Legend of Zelda: Echoes of Wisdom",
    franchise: "Zelda",
    year: 2024,
  },
  { game: "Super Mario Odyssey", franchise: "Mario", year: 2017 },
  { game: "Super Mario Galaxy", franchise: "Mario", year: 2007 },
  { game: "Super Mario 64", franchise: "Mario", year: 1996 },
  { game: "Super Mario Bros. Wonder", franchise: "Mario", year: 2023 },
  {
    game: "Paper Mario: The Thousand-Year Door",
    franchise: "Mario",
    year: 2004,
    recent: true,
  },
  { game: "Elden Ring", franchise: "FromSoftware", year: 2022 },
  { game: "Elden Ring Nightreign", franchise: "FromSoftware", year: 2025 },
  { game: "Dark Souls", franchise: "FromSoftware", year: 2011 },
  { game: "Dark Souls III", franchise: "FromSoftware", year: 2016 },
  { game: "Bloodborne", franchise: "FromSoftware", year: 2015 },
  { game: "Sekiro: Shadows Die Twice", franchise: "FromSoftware", year: 2019 },
  {
    game: "God of War (2018)",
    franchise: "God of War",
    year: 2018,
    aka: ["God of War 2018"],
  },
  {
    game: "God of War Ragnarök",
    franchise: "God of War",
    year: 2022,
    aka: ["God of War Ragnarok"],
  },
  { game: "God of War III", franchise: "God of War", year: 2010 },
  {
    game: "Marvel's Spider-Man",
    franchise: "Spider-Man",
    year: 2018,
    aka: ["Spider-Man PS4"],
  },
  { game: "Marvel's Spider-Man 2", franchise: "Spider-Man", year: 2023 },
  {
    game: "Marvel's Spider-Man: Miles Morales",
    franchise: "Spider-Man",
    year: 2020,
  },
  {
    game: "The Last of Us Part I",
    franchise: "The Last of Us",
    year: 2013,
    aka: ["The Last of Us"],
  },
  { game: "The Last of Us Part II", franchise: "The Last of Us", year: 2020 },
  { game: "Uncharted 4: A Thief's End", franchise: "Uncharted", year: 2016 },
  { game: "Uncharted 2: Among Thieves", franchise: "Uncharted", year: 2009 },
  { game: "Ghost of Tsushima", franchise: "Ghost of Tsushima", year: 2020 },
  { game: "Ghost of Yotei", franchise: "Ghost of Tsushima", year: 2025 },
  { game: "Horizon Zero Dawn", franchise: "Horizon", year: 2017 },
  { game: "Horizon Forbidden West", franchise: "Horizon", year: 2022 },
  { game: "Death Stranding", franchise: "Kojima", year: 2019 },
  { game: "Death Stranding 2: On the Beach", franchise: "Kojima", year: 2025 },
  {
    game: "Resident Evil 2",
    franchise: "Resident Evil",
    year: 2019,
    recent: true,
  },
  {
    game: "Resident Evil 4",
    franchise: "Resident Evil",
    year: 2023,
    recent: true,
  },
  { game: "Resident Evil Village", franchise: "Resident Evil", year: 2021 },
  {
    game: "Resident Evil 7: Biohazard",
    franchise: "Resident Evil",
    year: 2017,
  },
  { game: "Resident Evil Requiem", franchise: "Resident Evil", year: 2026 },
  {
    game: "Resident Evil 3",
    franchise: "Resident Evil",
    year: 2020,
    recent: true,
  },
  { game: "Halo: Combat Evolved", franchise: "Halo", year: 2001 },
  { game: "Halo 2", franchise: "Halo", year: 2004 },
  { game: "Halo 3", franchise: "Halo", year: 2007 },
  { game: "Halo: Reach", franchise: "Halo", year: 2010 },
  { game: "Halo Infinite", franchise: "Halo", year: 2021 },
  {
    game: "Call of Duty 4: Modern Warfare",
    franchise: "Call of Duty",
    year: 2007,
  },
  {
    game: "Call of Duty: Modern Warfare 2",
    franchise: "Call of Duty",
    year: 2009,
  },
  { game: "Call of Duty: Black Ops", franchise: "Call of Duty", year: 2010 },
  { game: "Call of Duty: Black Ops 6", franchise: "Call of Duty", year: 2024 },
  { game: "Final Fantasy VII", franchise: "Final Fantasy", year: 1997 },
  { game: "Final Fantasy VII Remake", franchise: "Final Fantasy", year: 2020 },
  { game: "Final Fantasy VII Rebirth", franchise: "Final Fantasy", year: 2024 },
  { game: "Final Fantasy X", franchise: "Final Fantasy", year: 2001 },
  { game: "Final Fantasy XVI", franchise: "Final Fantasy", year: 2023 },
  {
    game: "The Witcher 3: Wild Hunt",
    franchise: "The Witcher",
    year: 2015,
    aka: ["Witcher 3"],
  },
  { game: "Cyberpunk 2077", franchise: "Cyberpunk", year: 2020 },
  {
    game: "The Elder Scrolls V: Skyrim",
    franchise: "The Elder Scrolls",
    year: 2011,
    aka: ["Skyrim"],
  },
  {
    game: "The Elder Scrolls IV: Oblivion",
    franchise: "The Elder Scrolls",
    year: 2006,
    recent: true,
    aka: ["Oblivion"],
  },
  { game: "Fallout 3", franchise: "Fallout", year: 2008 },
  { game: "Fallout: New Vegas", franchise: "Fallout", year: 2010 },
  { game: "Fallout 4", franchise: "Fallout", year: 2015 },
  { game: "Starfield", franchise: "Bethesda", year: 2023 },
  { game: "Mass Effect 2", franchise: "Mass Effect", year: 2010 },
  { game: "Mass Effect", franchise: "Mass Effect", year: 2007 },
  { game: "Mass Effect 3", franchise: "Mass Effect", year: 2012 },
  { game: "Baldur's Gate 3", franchise: "Baldur's Gate", year: 2023 },
  { game: "Metal Gear Solid", franchise: "Metal Gear", year: 1998 },
  {
    game: "Metal Gear Solid 3: Snake Eater",
    franchise: "Metal Gear",
    year: 2004,
    recent: true,
    aka: ["Metal Gear Solid Delta"],
  },
  {
    game: "Metal Gear Solid V: The Phantom Pain",
    franchise: "Metal Gear",
    year: 2015,
  },
  { game: "Silent Hill 2", franchise: "Silent Hill", year: 2024, recent: true },
  { game: "Silent Hill f", franchise: "Silent Hill", year: 2025 },
  { game: "Pokémon Scarlet and Violet", franchise: "Pokemon", year: 2022 },
  { game: "Pokémon Legends: Arceus", franchise: "Pokemon", year: 2022 },
  { game: "Pokémon Legends: Z-A", franchise: "Pokemon", year: 2025 },
  { game: "Half-Life 2", franchise: "Half-Life", year: 2004 },
  { game: "Half-Life", franchise: "Half-Life", year: 1998 },
  { game: "Half-Life: Alyx", franchise: "Half-Life", year: 2020 },
  { game: "Portal 2", franchise: "Portal", year: 2011 },
  {
    game: "StarCraft II: Wings of Liberty",
    franchise: "Blizzard",
    year: 2010,
    aka: ["StarCraft"],
  },
  {
    game: "World of Warcraft cinematics",
    franchise: "Blizzard",
    year: 2004,
    aka: ["World of Warcraft", "WoW"],
  },
  { game: "Diablo IV", franchise: "Blizzard", year: 2023 },
  { game: "BioShock", franchise: "BioShock", year: 2007 },
  { game: "BioShock Infinite", franchise: "BioShock", year: 2013 },
  { game: "Hollow Knight: Silksong", franchise: "Hollow Knight", year: 2025 },
  { game: "Batman: Arkham City", franchise: "Batman", year: 2011 },
  { game: "Assassin's Creed II", franchise: "Assassin's Creed", year: 2009 },
  { game: "Prince of Persia: The Sands of Time", franchise: "Prince of Persia", year: 2003 },
  {
    game: "Assassin's Creed Shadows",
    franchise: "Assassin's Creed",
    year: 2025,
  },
  { game: "Kingdom Hearts II", franchise: "Kingdom Hearts", year: 2005 },
  { game: "Persona 5 Royal", franchise: "Persona", year: 2019 },
  {
    game: "Clair Obscur: Expedition 33",
    franchise: "Clair Obscur",
    year: 2025,
  },
  { game: "Minecraft Story Mode", franchise: "Minecraft", year: 2015 },
];

/** The other backlog games of a game's franchise (pure): the picker refuses uploads that name one of them instead. */
export function siblingsOf(game: string, backlog: BacklogGame[] = ARCHIVE_BACKLOG): string[] {
  const me = backlog.find((g) => canonicalGame(g.game) === canonicalGame(game));
  const key = canonicalGame(game);
  return backlog
    .filter((g) => canonicalGame(g.game) !== key && (g.franchise === me?.franchise || canonicalGame(g.game).startsWith(`${key} `)))
    .flatMap((g) => [g.game, ...(g.aka ?? [])]);
}

/** How well a franchise travels on YouTube beyond Pulse's own numbers, 0-1 (a judgement, kept small). */
export const FRANCHISE_POPULARITY: Record<string, number> = {
  "Grand Theft Auto": 1,
  "Red Dead": 0.9,
  Zelda: 0.9,
  Mario: 0.8,
  FromSoftware: 0.8,
  "God of War": 0.8,
  "Resident Evil": 0.8,
  "Spider-Man": 0.75,
  "The Last of Us": 0.75,
  "Call of Duty": 0.7,
  Halo: 0.7,
  "Final Fantasy": 0.7,
  Pokemon: 0.7,
  "The Elder Scrolls": 0.7,
  "The Witcher": 0.65,
  Cyberpunk: 0.6,
  Fallout: 0.6,
  "Metal Gear": 0.6,
  "Silent Hill": 0.55,
  "Half-Life": 0.55,
  Uncharted: 0.55,
  Rockstar: 0.5,
};

/**
 * What Pulse's own analytics loop says does best (12 Nov 2026): GTA, Zelda and Resident Evil lead, fandom and
 * "why" stories after. A small lift on top of the measured numbers, so a franchise the episodes do not name yet
 * still ranks.
 */
export const CHANNEL_LIFT: Record<string, number> = {
  "Grand Theft Auto": 3,
  Zelda: 2,
  "Resident Evil": 2,
  "Red Dead": 1.5,
  FromSoftware: 1,
  Pokemon: 1,
  Mario: 1,
};

export interface CoverageRow {
  game: string;
  /** Pulse episodes about it. */
  n: number;
  /** Their best view counts, added up. */
  views: number;
}

export interface RankedGame extends BacklogGame {
  rank: number;
  score: number;
  episodes: number;
  franchiseEpisodes: number;
  franchiseViews: number;
  /** Among the top `fullTop`: gets the full index. */
  full: boolean;
  why: string;
}

/** True when an episode's game names this backlog game (pure): its title or an alias, written any way. */
export function namesGame(
  episodeGame: string,
  g: Pick<BacklogGame, "game" | "aka">,
): boolean {
  const key = canonicalGame(episodeGame);
  if (!key) return false;
  return [g.game, ...(g.aka ?? [])].some((n) => canonicalGame(n) === key);
}

/** True when an episode's game belongs to a franchise (pure): its key's words lead the episode's. */
export function inFranchise(
  episodeGame: string,
  franchise: string,
  games: BacklogGame[],
): boolean {
  const key = canonicalGame(episodeGame);
  const f = canonicalGame(franchise);
  if (!key || !f) return false;
  if (` ${key} `.includes(` ${f} `)) return true;
  return games.some(
    (g) => g.franchise === franchise && namesGame(episodeGame, g),
  );
}

/**
 * The backlog in the order to archive it (pure). A game's score: Pulse's own episodes about it (log scale, most
 * weight), its franchise's episodes and views (log scale), the analytics loop's lift and the franchise's
 * popularity. Ties go to the newer game. The top `fullTop` are marked for the full index.
 */
export function rankBacklog(
  backlog: BacklogGame[],
  coverage: CoverageRow[],
  o: { fullTop: number },
): RankedGame[] {
  const scored = backlog.map((g) => {
    const own = coverage.filter((c) => namesGame(c.game, g));
    const fam = coverage.filter((c) =>
      inFranchise(c.game, g.franchise, backlog),
    );
    const episodes = own.reduce((n, c) => n + c.n, 0);
    const franchiseEpisodes = fam.reduce((n, c) => n + c.n, 0);
    const franchiseViews = fam.reduce((n, c) => n + c.views, 0);
    const lift = CHANNEL_LIFT[g.franchise] ?? 0;
    const pop = FRANCHISE_POPULARITY[g.franchise] ?? 0.3;
    const score =
      3 * Math.log1p(episodes) +
      1.5 * Math.log1p(franchiseEpisodes) +
      0.5 * Math.log10(1 + franchiseViews) +
      lift +
      3 * pop;
    const why = [
      episodes ? `${episodes} Pulse videos` : "",
      franchiseEpisodes ? `${franchiseEpisodes} in the franchise` : "",
      franchiseViews
        ? `${Math.round(franchiseViews).toLocaleString("en-US")} franchise views`
        : "",
      lift ? `channel lift ${lift}` : "",
      `popularity ${pop}`,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      ...g,
      score: Math.round(score * 100) / 100,
      episodes,
      franchiseEpisodes,
      franchiseViews,
      why,
    };
  });
  return scored
    .sort((a, b) => b.score - a.score || b.year - a.year)
    .map((g, i) => ({ ...g, rank: i + 1, full: i < o.fullTop }));
}

// ---------------------------------------------------------------- the archive's book

export type ArchiveStatus =
  | "waiting"
  | "light"
  | "full"
  | "no-source"
  | "failed"
  | "gone";

export interface ArchiveRecord {
  game: string;
  slug: string;
  rank: number;
  full: boolean;
  status: ArchiveStatus;
  videoId?: string;
  title?: string;
  uploader?: string;
  minutes?: number;
  /** index.json on disk, and the proxy while it is there. */
  indexBytes?: number;
  proxyBytes?: number;
  tries?: number;
  lastTry?: string;
  /** When the full index was asked of the scene index job (asked again after a week if it is still light). */
  fullQueuedAt?: string;
  /** When the upload was last seen still up. */
  checkedAt?: string;
  /** Uploads found gone: never picked again for this game. */
  gone?: string[];
  error?: string;
}

export interface ArchiveBook {
  games: ArchiveRecord[];
  updatedAt?: string;
}

export function parseArchive(raw: unknown): ArchiveBook {
  const games = (raw as ArchiveBook | null)?.games;
  return {
    games: (Array.isArray(games) ? games : []).filter(
      (g) => g && typeof g.game === "string" && typeof g.slug === "string",
    ),
    ...(typeof (raw as ArchiveBook | null)?.updatedAt === "string"
      ? { updatedAt: (raw as ArchiveBook).updatedAt }
      : {}),
  };
}

/** The book with today's ranking merged in (pure): ranks and full marks refreshed, new games added waiting. */
export function mergeRanking(
  book: ArchiveBook,
  ranked: RankedGame[],
): ArchiveBook {
  const bySlug = new Map(book.games.map((g) => [g.slug, g]));
  const games: ArchiveRecord[] = ranked.map((r) => {
    const slug = sceneSlug(r.game);
    const had = bySlug.get(slug);
    bySlug.delete(slug);
    return had
      ? { ...had, rank: r.rank, full: r.full }
      : { game: r.game, slug, rank: r.rank, full: r.full, status: "waiting" };
  });
  // Games taken off the list keep their record (and their index): only the ranking forgets them.
  for (const g of bySlug.values())
    games.push({ ...g, rank: 9999, full: false });
  return { ...book, games };
}

const HOUR = 3_600_000;
/** An upload is looked at again for being gone this often. */
export const GONE_CHECK_DAYS = 7;

export type ArchiveTurn =
  | { kind: "light"; rec: ArchiveRecord }
  | { kind: "check"; rec: ArchiveRecord }
  | { kind: "full"; rec: ArchiveRecord };

/**
 * The next piece of archive work (pure), or undefined: first a game whose upload was found gone (picked again),
 * then a full-index game whose light index is in (handed to the scene index job, asked again a week later if it is
 * still light), then the best-ranked game with no index yet (a no-source game rests a day between searches, three
 * tries a week), then the oldest upload due its weekly look.
 */
export function nextArchiveTurn(
  book: ArchiveBook,
  now: Date,
): ArchiveTurn | undefined {
  const t = now.getTime();
  const since = (iso?: string) => (iso ? t - Date.parse(iso) : Infinity);
  const ranked = [...book.games]
    .filter((g) => g.rank < 9999)
    .sort((a, b) => a.rank - b.rank);
  const gone = ranked.find((g) => g.status === "gone");
  if (gone) return { kind: "light", rec: gone };
  // Asking the scene index job for a full index costs this tick nothing: the job takes its own turns.
  const upgrade = ranked.find((g) => g.full && g.status === "light" && since(g.fullQueuedAt) >= 7 * 24 * HOUR);
  if (upgrade) return { kind: "full", rec: upgrade };
  const fresh = ranked.find(
    (g) =>
      g.status === "waiting" ||
      (g.status === "failed" &&
        since(g.lastTry) >= 6 * HOUR &&
        (g.tries ?? 0) < 6) ||
      (g.status === "no-source" &&
        since(g.lastTry) >= 24 * HOUR &&
        ((g.tries ?? 0) < 3 || since(g.lastTry) >= 7 * 24 * HOUR)),
  );
  if (fresh) return { kind: "light", rec: fresh };
  const due = ranked
    .filter(
      (g) =>
        (g.status === "light" || g.status === "full") &&
        since(g.checkedAt) >= GONE_CHECK_DAYS * 24 * HOUR,
    )
    .sort((a, b) => since(b.checkedAt) - since(a.checkedAt))[0];
  return due ? { kind: "check", rec: due } : undefined;
}

/** True when `hour` (0-23) is inside ARCHIVE_HOURS (pure): "22-7" wraps midnight, "all" or "" is always. */
export function inArchiveHours(spec: string, hour: number): boolean {
  const s = spec.trim().toLowerCase();
  if (!s || s === "all" || s === "always") return true;
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(s);
  if (!m) return true;
  const a = Number(m[1]) % 24;
  const b = Number(m[2]) % 24;
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
}

/** The book after a light turn (pure), from the tool's last line: "light <videoId> <bytes>", "no-source" or an error. */
export function afterLightTurn(
  book: ArchiveBook,
  slug: string,
  out: { outcome: string; videoId?: string; bytes?: number; error?: string },
  now: Date,
): ArchiveBook {
  return {
    ...book,
    games: book.games.map((g) => {
      if (g.slug !== slug) return g;
      const base = {
        ...g,
        lastTry: now.toISOString(),
        tries: (g.tries ?? 0) + 1,
      };
      if (out.outcome === "light")
        return {
          ...base,
          status: g.status === "full" ? "full" : "light",
          tries: 0,
          checkedAt: now.toISOString(),
          ...(out.videoId ? { videoId: out.videoId } : {}),
          ...(out.bytes ? { indexBytes: out.bytes } : {}),
          error: undefined,
        };
      if (out.outcome === "no-source") return { ...base, status: "no-source" };
      return {
        ...base,
        status: g.status === "gone" ? "gone" : "failed",
        error: (out.error ?? out.outcome).slice(0, 200),
      };
    }),
  };
}

/** The weekly growth report's lines on the archive (pure). */
export function archiveLines(book: ArchiveBook): string[] {
  const live = book.games.filter((g) => g.rank < 9999);
  if (!live.length) return [];
  const count = (s: ArchiveStatus) => live.filter((g) => g.status === s).length;
  const archived = count("light") + count("full");
  const bytes = live.reduce(
    (n, g) => n + (g.indexBytes ?? 0) + (g.proxyBytes ?? 0),
    0,
  );
  const failed = live.filter(
    (g) => g.status === "failed" || g.status === "no-source",
  );
  return [
    "",
    "🗄️ **Game archive**",
    `- ${archived} of ${live.length} games archived (${count("full")} full, ${count("light")} light), ${count("waiting")} queued, ${failed.length} without a clean upload or failed, ${count("gone")} uploads gone and being replaced; ${(bytes / 1e6).toFixed(0)} MB on the Mac`,
    ...failed
      .slice(0, 5)
      .map(
        (g) =>
          `- ${g.game}: ${g.status === "no-source" ? "no clean full movie or playthrough yet" : `failed (${g.error ?? "?"})`}`,
      ),
  ];
}

// ---------------------------------------------------------------- the tick (files, child processes)

type ArchiveCfg = Pick<
  Config,
  | "dataDir"
  | "sceneIndex"
  | "archiveBacklog"
  | "archiveFullTop"
  | "archiveHours"
  | "archiveComments"
  | "ytdlpPath"
  | "macMinFreeGb"
>;

const bookFile = (dataDir: string) =>
  path.join(dataDir, "sceneindex", "archive.json");

export async function readArchive(dataDir: string): Promise<ArchiveBook> {
  try {
    return parseArchive(
      JSON.parse(await fsp.readFile(bookFile(dataDir), "utf8")),
    );
  } catch {
    return { games: [] };
  }
}

export async function writeArchive(
  dataDir: string,
  book: ArchiveBook,
): Promise<void> {
  const file = bookFile(dataDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(book, null, 1));
  await fsp.rename(tmp, file);
}

/** The tool's last "light ..." / "no-source" / "gone" / "alive" line, parsed (pure). */
export function lightOutcome(stdout: string): {
  outcome: string;
  videoId?: string;
  bytes?: number;
} {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => /^(light|no-source|gone|alive)\b/.test(l));
  if (!line) return { outcome: turnOutcome(stdout) || "error" };
  const [outcome, videoId, bytes] = line.split(/\s+/);
  return {
    outcome: outcome!,
    ...(videoId ? { videoId } : {}),
    ...(Number(bytes) ? { bytes: Number(bytes) } : {}),
  };
}

let running = false;
const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "sceneindex.ts",
);

/**
 * One pass of the archive, never throws, nothing while ARCHIVE_BACKLOG is off or outside ARCHIVE_HOURS: the
 * ranking refreshed from Pulse's episodes, then one piece of work. A light index or an upload's weekly look is a
 * child process behind the Mac's turn-taker; a full index is a request in the scene index job's queue.
 */
export async function archiveTick(
  cfg: ArchiveCfg,
  deps: {
    coverage?: () => Promise<CoverageRow[]>;
    now?: () => Date;
    run?: (
      cmd: string,
      args: string[],
      env: NodeJS.ProcessEnv,
    ) => Promise<{ stdout: string; code: number }>;
  } = {},
): Promise<string | undefined> {
  if (!cfg.archiveBacklog || running) return undefined;
  const now = (deps.now ?? (() => new Date()))();
  if (!inArchiveHours(cfg.archiveHours, now.getHours())) return undefined;
  running = true;
  try {
    const coverage = await (deps.coverage ?? (async () => []))().catch(
      () => [] as CoverageRow[],
    );
    let book = mergeRanking(
      await readArchive(cfg.dataDir),
      rankBacklog(ARCHIVE_BACKLOG, coverage, { fullTop: cfg.archiveFullTop }),
    );
    // Records brought up to date from what is on disk: the scene index job finishes the full indexes.
    for (const g of book.games) {
      const index = await loadSceneIndex(cfg.dataDir, g.game);
      if (!index) continue;
      const dir = sceneIndexDir(cfg.dataDir, g.game);
      const size = (f: string) =>
        fsp
          .stat(path.join(dir, f))
          .then((s) => s.size)
          .catch(() => 0);
      g.indexBytes = await size("index.json");
      g.proxyBytes = await size("proxy.mp4");
      g.videoId = index.source.videoId;
      g.title = index.source.title;
      g.uploader = index.source.uploader;
      g.minutes = Math.round(index.source.duration / 60);
      if (
        g.status === "waiting" ||
        g.status === "failed" ||
        g.status === "no-source"
      )
        g.status = "light";
      if ((index.tier ?? "full") === "full" && g.status !== "gone")
        g.status = "full";
    }
    const turn = nextArchiveTurn(book, now);
    if (!turn) {
      await writeArchive(cfg.dataDir, {
        ...book,
        updatedAt: now.toISOString(),
      });
      return undefined;
    }
    if (turn.kind === "full") {
      // The scene index job builds it (one game at a time, its own turns); the light index stays until replaced.
      const queue = await readQueue(cfg.dataDir);
      const next = queueGame(
        queue,
        turn.rec.game,
        "archive: full index",
        now,
        Boolean(
          ARCHIVE_BACKLOG.find((b) => sceneSlug(b.game) === turn.rec.slug)
            ?.recent,
        ),
      );
      if (next !== queue) await writeQueue(cfg.dataDir, next);
      book = {
        ...book,
        games: book.games.map((g) =>
          g.slug === turn.rec.slug ? { ...g, fullQueuedAt: now.toISOString() } : g,
        ),
      };
      await writeArchive(cfg.dataDir, {
        ...book,
        updatedAt: now.toISOString(),
      });
      return "full-queued";
    }
    const free = await fsp
      .statfs(cfg.dataDir)
      .then((s) => (s.bavail * s.bsize) / 1e9)
      .catch(() => Infinity);
    if (free < cfg.macMinFreeGb) return undefined;
    const backlog = ARCHIVE_BACKLOG.find(
      (b) => sceneSlug(b.game) === turn.rec.slug,
    );
    const macrun = path.join(os.homedir(), "orch", "macrun.sh");
    const args =
      turn.kind === "check"
        ? ["--import", "tsx", TOOL, "alive", turn.rec.game]
        : [
            "--import",
            "tsx",
            TOOL,
            "light",
            turn.rec.game,
            `--comments=${cfg.archiveComments}`,
            ...(backlog?.recent ? ["--recent"] : []),
            ...(turn.rec.status === "gone" || turn.rec.gone?.length
              ? [`--exclude=${(turn.rec.gone ?? []).join(",")}`, "--repick"]
              : []),
          ];
    const [cmd, cmdArgs] = turnCommand(
      process.platform,
      fs.existsSync(macrun) ? macrun : undefined,
      process.execPath,
      args,
    );
    const env = {
      ...process.env,
      DATA_DIR: cfg.dataDir,
      YTDLP_PATH: cfg.ytdlpPath,
      MACRUN_WAIT_MIN: "20",
    };
    const r = await (
      deps.run ??
      ((c: string, a: string[], e: NodeJS.ProcessEnv) =>
        new Promise<{ stdout: string; code: number }>((resolve) => {
          execFile(
            c,
            a,
            {
              env: e,
              cwd: path.join(path.dirname(TOOL), "..", ".."),
              timeout: HOUR,
              maxBuffer: 16 * 1024 * 1024,
              windowsHide: true,
            },
            (err, stdout) =>
              resolve({
                stdout: String(stdout),
                code: err ? Number((err as { code?: number }).code ?? 1) : 0,
              }),
          );
        }))
    )(cmd, cmdArgs, env);
    if (r.code === 75) return "waiting";
    const out = lightOutcome(r.stdout);
    book = await readArchive(cfg.dataDir).then((b) =>
      mergeRanking(
        b,
        rankBacklog(ARCHIVE_BACKLOG, coverage, { fullTop: cfg.archiveFullTop }),
      ),
    );
    if (turn.kind === "check") {
      book = {
        ...book,
        games: book.games.map((g) =>
          g.slug !== turn.rec.slug
            ? g
            : out.outcome === "gone"
              ? {
                  ...g,
                  status: "gone",
                  gone: [
                    ...new Set([
                      ...(g.gone ?? []),
                      ...(g.videoId ? [g.videoId] : []),
                    ]),
                  ],
                }
              : out.outcome === "alive"
                ? { ...g, checkedAt: now.toISOString() }
                : g,
        ),
      };
    } else book = afterLightTurn(book, turn.rec.slug, out, now);
    await writeArchive(cfg.dataDir, { ...book, updatedAt: now.toISOString() });
    log("info", "archive: turn finished", {
      game: turn.rec.game,
      kind: turn.kind,
      outcome: out.outcome,
    });
    return out.outcome;
  } catch (err) {
    log("warn", "archive: turn failed", { error: errorMessage(err) });
    return undefined;
  } finally {
    running = false;
  }
}
