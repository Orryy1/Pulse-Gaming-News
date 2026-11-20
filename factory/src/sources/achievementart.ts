// Achievement and trophy art (ACHIEVEMENT_ART, 20 Nov 2026). Achievement Shorts, guides and long videos show the
// real icon, name and unlock share of an achievement, drawn on Pulse's own card: never another site's share card.
//
// Where the data comes from, checked 20 Nov 2026:
//   Steam Web API      GetSchemaForGame (names, descriptions, icons, hidden flag) needs STEAM_API_KEY, free from
//                      steamcommunity.com/dev/apikey under the Steam Web API Terms of Use; the global unlock shares
//                      (GetGlobalAchievementPercentagesForApp) need no key. The factory has no STEAM_API_KEY yet.
//   Steam community    without a key, the public achievements page (steamcommunity.com/stats/<app>/achievements,
//                      robots.txt allows it) carries the same schema and shares; src/discovery/achievements.ts reads it.
//   Xbox               OpenXBL (xbl.io) serves title achievements only to a signed-up account with its own API key;
//                      none is set up, so nothing is fetched. Microsoft's Game Content Usage Rules cover showing the art.
//   PlayStation        Sony offers no public trophy API; the community libraries sign in with a person's NPSSO
//                      cookie, which Sony's terms do not allow for a business, so PSN trophies are not fetched.
//   TrueAchievements / TrueTrophies   not used (TA_TT_VERDICT below): their terms grant no reuse of their pages or
//                      images, and their share images are a members' feature for their own unlocks.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { systemFont } from "../assets/linevisuals.ts";
import {
  fetchAchievements,
  iconUrl,
  type Achievement,
} from "../discovery/achievements.ts";
import { POLITE_UA } from "./polite.ts";

const exec = promisify(execFile);

/** What TrueAchievements and TrueTrophies allow, as read on 20 Nov 2026 (the record behind the decision). */
export const TA_TT_VERDICT = {
  checked: "2026-11-20",
  use: false,
  why: "Neither site's terms grant any licence to reuse its pages, images or share cards; both reserve all rights and warn that unauthorised use may lead to a claim. The share images TrueAchievements added are for members to share their own unlocks, not a reuse or embed licence, and the site turns automated readers away with a bot challenge. Pulse draws its own card from the official icons instead.",
  terms: [
    {
      site: "TrueAchievements",
      url: "https://www.trueachievements.com/termsandconditions.aspx",
      quotes: [
        "The content of the pages of this website is for your general information and use only.",
        "Unauthorised use of this website may give rise to a claim for damages and/or be a criminal offence.",
      ],
    },
    {
      site: "TrueTrophies",
      url: "https://www.truetrophies.com/termsandconditions.aspx",
      quotes: [
        "The content of the pages of this website is for your general information and use only.",
        "Unauthorised use of this website may give rise to a claim for damages and/or be a criminal offence.",
        "© 2026 TrueGaming Network Ltd, All Rights Reserved",
      ],
    },
  ],
} as const;

/** The other platforms' achievement data and whether Pulse may fetch it (for the record and the tool's report). */
export const PLATFORM_SOURCES = [
  {
    platform: "Steam",
    source: "Steam Web API (STEAM_API_KEY) or the public community page",
    fetched: true,
  },
  {
    platform: "Xbox",
    source: "OpenXBL (xbl.io): needs an owner sign-up and API key",
    fetched: false,
  },
  {
    platform: "PlayStation",
    source: "no public trophy API; sign-in cookie libraries not permitted",
    fetched: false,
  },
] as const;

// ---------------------------------------------------------------- Steam data

/** GetSchemaForGame's achievements and the keyless global shares merged (pure). */
export function mergeSchema(
  schema: any,
  percentages: any,
  appId: number,
): Achievement[] {
  const pct = new Map<string, number>();
  for (const p of (percentages?.achievementpercentages?.achievements ??
    []) as any[])
    pct.set(String(p?.name ?? ""), Number(p?.percent));
  const out: Achievement[] = [];
  for (const a of (schema?.game?.availableGameStats?.achievements ??
    []) as any[]) {
    const apiName = String(a?.name ?? "");
    const percent = pct.get(apiName);
    if (!apiName || percent === undefined || !Number.isFinite(percent))
      continue;
    out.push({
      apiName,
      name: String(a?.displayName ?? "").trim(),
      description: String(a?.description ?? "").trim(),
      hidden: Number(a?.hidden ?? 0) === 1,
      icon: iconUrl(String(a?.icon ?? ""), appId),
      percent: Math.round(percent * 10) / 10,
    });
  }
  return out.filter((a) => a.name).sort((a, b) => a.percent - b.percent);
}

/**
 * A Steam game's achievements: the Web API when STEAM_API_KEY is set (the official schema), else the public community
 * page. Never throws; an empty list when neither answers.
 */
export async function steamAchievements(
  appId: number,
  o: {
    apiKey?: string;
    fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
    page?: (id: number) => Promise<Achievement[]>;
  } = {},
): Promise<{
  list: Achievement[];
  via: "web api" | "community page" | "none";
}> {
  if (o.apiKey) {
    try {
      // The Web API's robots.txt turns crawlers away; these are documented API calls made under the Steam Web API
      // Terms of Use, two per game, so they go straight out rather than through the robots-reading fetcher.
      const get =
        o.fetchFn ??
        ((u: string, init?: RequestInit) =>
          fetchWithTimeout(u, init ?? {}, 20_000));
      const raw = (u: string) =>
        get(u, { headers: { "user-agent": POLITE_UA } });
      const [s, p] = await Promise.all([
        raw(
          `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(o.apiKey)}&appid=${appId}&l=english`,
        ),
        raw(
          `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`,
        ),
      ]);
      if (s.ok && p.ok) {
        const list = mergeSchema(await s.json(), await p.json(), appId);
        if (list.length) return { list, via: "web api" };
      }
    } catch (err) {
      log("warn", "steam web api achievements failed", {
        appId,
        error: errorMessage(err),
      });
    }
  }
  const list = await (o.page ?? fetchAchievements)(appId);
  return { list, via: list.length ? "community page" : "none" };
}

// ---------------------------------------------------------------- the card

/** How rare an unlock share is, in the words the card prints (pure). */
export function rarityTier(percent: number): string {
  if (percent < 1) return "Ultra rare";
  if (percent < 5) return "Very rare";
  if (percent < 15) return "Rare";
  if (percent < 40) return "Uncommon";
  return "Common";
}

/** A share as people say it on a card: "0.4%", "12%", "under 0.1%" (pure). */
export function shareText(percent: number): string {
  if (percent < 0.1) return "under 0.1%";
  if (percent < 10) return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(percent)}%`;
}

/** A line cut to fit the card, at a word boundary (pure). */
export function fitLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).replace(/[,;:.\s]+$/, "")}…`;
}

export interface CardText {
  game: string;
  name: string;
  description: string;
  share: string;
  tier: string;
  credit: string;
  /** 0-1: how much of the rarity bar is filled. */
  fill: number;
}

/** The words on an achievement's card (pure). A hidden achievement's description is never printed. */
export function cardText(
  a: Achievement,
  game: string,
  platform = "Steam",
): CardText {
  return {
    game: fitLine(game, 48),
    name: fitLine(a.name, 38),
    description: a.hidden ? "Hidden achievement" : fitLine(a.description, 72),
    share: `Unlocked by ${shareText(a.percent)} of ${platform} players`,
    tier: rarityTier(a.percent).toUpperCase(),
    credit: `Achievement data: ${platform}`,
    fill: Math.max(0.01, Math.min(1, a.percent / 100)),
  };
}

const W = 1920;
const H = 1080;
const ICON = 300;
const BAR = 900;

/** The ffmpeg filter that draws a card (pure): text comes from files, so nothing in a name needs escaping. */
export function cardFilter(
  font: string,
  files: Record<keyof Omit<CardText, "fill">, string>,
  fill: number,
): string {
  const f = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const tf = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const text = (
    file: string,
    size: number,
    color: string,
    y: number | string,
    x = "(w-tw)/2",
  ) =>
    `drawtext=fontfile='${f}':textfile='${tf(file)}':expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
  const ix = (W - ICON) / 2;
  const fillW = Math.max(12, Math.round(BAR * fill));
  return [
    `[1:v]scale=${ICON}:${ICON}:flags=lanczos,format=rgba[ic]`,
    `[0:v]drawbox=x=${ix - 8}:y=${132 - 8}:w=${ICON + 16}:h=${ICON + 16}:color=0xFF6B1A:t=fill[bg]`,
    `[bg][ic]overlay=${ix}:132,` +
      [
        text(files.game, 34, "0x9aa4b2", 56, "64"),
        text(files.tier, 34, "0xFF6B1A", 482),
        text(files.name, 76, "white", 540),
        text(files.description, 42, "0xc9d1d9", 648),
        `drawbox=x=${(W - BAR) / 2}:y=760:w=${BAR}:h=26:color=0x30363d:t=fill`,
        `drawbox=x=${(W - BAR) / 2}:y=760:w=${fillW}:h=26:color=0xFF6B1A:t=fill`,
        text(files.share, 44, "white", 820),
        text(files.credit, 28, "0x9aa4b2", H - 70, `w-tw-64`),
      ].join(","),
  ].join(";");
}

/**
 * Draws an achievement's card (1920x1080 JPEG) from its downloaded icon: Pulse's own design, the official icon, name
 * and share, credited to the platform. True when the card was written.
 */
export async function renderAchievementCard(
  a: Achievement,
  game: string,
  iconFile: string,
  outFile: string,
  platform = "Steam",
): Promise<boolean> {
  const font = systemFont();
  if (!font) return false;
  const t = cardText(a, game, platform);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "achcard-"));
  try {
    const files = {} as Record<keyof Omit<CardText, "fill">, string>;
    for (const k of [
      "game",
      "name",
      "description",
      "share",
      "tier",
      "credit",
    ] as const) {
      files[k] = path.join(work, `${k}.txt`);
      await fs.writeFile(files[k], t[k], "utf8");
    }
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await exec(
      FFMPEG,
      [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x0d1117:s=${W}x${H}:d=1`,
        "-i",
        iconFile,
        "-filter_complex",
        cardFilter(font, files, t.fill),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outFile,
      ],
      { timeout: 60_000 },
    );
    return true;
  } catch (err) {
    log("warn", "achievement card not drawn", {
      name: a.name,
      error: errorMessage(err),
    });
    return false;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The achievements a sentence names, each once, in the order it says them (pure): what a guide line gets a card for. */
export function achievementsNamed(
  sentence: string,
  list: Achievement[],
): Achievement[] {
  const s = ` ${sentence.toLowerCase().replace(/[“”"’']/g, "")} `;
  const hits: Array<{ a: Achievement; at: number; n: string }> = [];
  // Longest names first, so "Elden Lord" is taken and the "Lord" inside it is not.
  for (const a of [...list].sort((x, y) => y.name.length - x.name.length)) {
    const n = a.name
      .toLowerCase()
      .replace(/[“”"’']/g, "")
      .trim();
    if (n.length < 4) continue;
    const m = new RegExp(
      `(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    ).exec(s);
    if (m && !hits.some((h) => h.n.includes(n)))
      hits.push({ a, at: m.index, n });
  }
  return hits.sort((x, y) => x.at - y.at).map((h) => h.a);
}

/** The provenance line of a card in the library and an episode. */
export function cardProvenance(
  a: Achievement,
  game: string,
  appId: number,
  via: string,
): string {
  return `Pulse achievement card for "${a.name}" (${game}): official Steam icon, name and ${shareText(a.percent)} global unlock share from the Steam ${via}, https://steamcommunity.com/stats/${appId}/achievements`;
}
