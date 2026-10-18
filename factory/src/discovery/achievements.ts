// Achievement data from Steam's public community pages: every achievement's
// name, description, icon and the exact share of players who unlocked it.
// Powers the weekly achievement-hunting Shorts (the rarest in one game, the
// hardest across today's biggest games) with real numbers only.

import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";

export interface Achievement {
  apiName: string;
  name: string;
  description: string;
  hidden: boolean;
  icon?: string;
  percent: number; // share of the game's players who unlocked it, 0-100
}

/** Pulls achievements and unlock shares out of the page's embedded data (quotes may be JSON-escaped). */
export function parseAchievementsPage(html: string): Achievement[] {
  const text = html
    .replace(/\\\\"/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
  const percents = new Map<number, number>();
  const pm = text.match(/"percentages":\{([^}]*)\}/);
  if (pm)
    for (const m of pm[1]!.matchAll(/"(\d+)":([\d.]+)/g))
      percents.set(Number(m[1]), Number(m[2]));
  const out: Achievement[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(
    /\{"internal_key":(\d+),"api_name":"([^"]+)","name":"((?:[^"\\]|\\.)*)","description":"((?:[^"\\]|\\.)*)","hidden":(true|false)[^}]*?"icon_achieved":"([^"]*)"/g,
  )) {
    const key = Number(m[1]);
    if (seen.has(m[2]!) || !percents.has(key)) continue;
    seen.add(m[2]!);
    out.push({
      apiName: m[2]!,
      name: m[3]!.trim(),
      description: m[4]!.trim(),
      hidden: m[5] === "true",
      icon: m[6] || undefined,
      percent: Math.round(percents.get(key)! * 10) / 10,
    });
  }
  return out.sort((a, b) => a.percent - b.percent);
}

export async function fetchAchievements(appId: number): Promise<Achievement[]> {
  try {
    const res = await fetchWithTimeout(
      `https://steamcommunity.com/stats/${appId}/achievements?l=english`,
      { headers: { accept: "text/html" } },
      20_000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseAchievementsPage(await res.text());
  } catch (err) {
    log("warn", "achievements unavailable", {
      appId,
      error: errorMessage(err),
    });
    return [];
  }
}

/** The N rarest real achievements: under 0.1% is usually a broken or retired one, not a feat. */
export function rarest(list: Achievement[], n = 6): Achievement[] {
  return list.filter((a) => a.percent >= 0.1 && a.name).sort((a, b) => a.percent - b.percent).slice(0, n);
}
