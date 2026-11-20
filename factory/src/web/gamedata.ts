// Live facts for the website's game hubs: the Steam store page (art, price in
// dollars, pounds and euros, release date, reviews, players right now). Cached
// on disk and in memory; a stale card is served at once and refreshed behind it.

import fs from "node:fs";
import path from "node:path";
import { findSteamApp, steamFacts, type SteamFacts } from "../assets/steam.ts";
import { errorMessage, log } from "../lib/util.ts";

export interface GameCard extends Partial<SteamFacts> {
  term: string;
  appId?: number;
  header?: string;
  description?: string;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  platforms?: string[];
  missing?: boolean; // looked up and not on Steam
  checkedAt: string;
}

const FRESH_MS = 12 * 3600 * 1000;
const MISSING_MS = 3 * 24 * 3600 * 1000;

let file = "";
let cards: Record<string, GameCard> = {};
const inflight = new Map<string, Promise<GameCard>>();

function load(dataDir: string): void {
  const f = path.join(dataDir, "site", "games.json");
  if (file === f) return;
  file = f;
  try {
    cards = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    cards = {};
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cards));
  } catch (err) {
    log("warn", "game cards save failed", { error: errorMessage(err) });
  }
}

const key = (term: string, year?: number) =>
  `${term.toLowerCase().trim()}|${year ?? ""}`;

async function lookup(term: string, year?: number): Promise<GameCard> {
  const checkedAt = new Date().toISOString();
  const app = await findSteamApp(term).catch(() => undefined);
  const d = app?.details ?? {};
  const released = Number(
    String(d.release_date?.date ?? "").match(/\b(19|20)\d\d\b/)?.[0],
  );
  // A remake or reboot shares the name: a known year must match the store page's.
  if (!app || (year && released && Math.abs(released - year) > 1))
    return { term, missing: true, checkedAt };
  const facts = await steamFacts(app).catch(() => undefined);
  const list = (xs: any) =>
    Array.isArray(xs)
      ? xs
          .map((x) => (typeof x === "string" ? x : x?.description))
          .filter(Boolean)
          .slice(0, 4)
      : undefined;
  return {
    ...facts,
    term,
    appId: app.appId,
    name: app.name,
    header: d.header_image,
    description:
      String(d.short_description ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim() || undefined,
    developers: list(d.developers),
    publishers: list(d.publishers),
    genres: list(d.genres),
    platforms: d.platforms
      ? Object.entries(d.platforms)
          .filter(([, on]) => on)
          .map(
            ([p]) =>
              ({ windows: "Windows", mac: "Mac", linux: "Linux" })[p] ?? p,
          )
      : undefined,
    checkedAt,
  };
}

/** The cached card now; a missing or stale one is fetched, waiting at most `waitMs` for it. */
export async function gameCard(
  dataDir: string,
  term: string,
  year?: number,
  waitMs = 6000,
): Promise<GameCard | undefined> {
  load(dataDir);
  const k = key(term, year);
  const have = cards[k];
  const age = have ? Date.now() - Date.parse(have.checkedAt) : Infinity;
  if (have && age < (have.missing ? MISSING_MS : FRESH_MS))
    return have.missing ? undefined : have;
  let job = inflight.get(k);
  if (!job) {
    job = lookup(term, year)
      .then((card) => {
        // A failed refresh keeps the last good card.
        if (!(card.missing && have && !have.missing)) cards[k] = card;
        save();
        return cards[k]!;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, job);
  }
  if (have) return have.missing ? undefined : have; // stale: serve it, refresh behind it
  const card = await Promise.race([
    job,
    new Promise<undefined>((r) => setTimeout(() => r(undefined), waitMs)),
  ]);
  return card && !card.missing ? card : undefined;
}

/** Only what is already cached: for index pages that must not wait on Steam. */
export function cachedCard(
  dataDir: string,
  term: string,
  year?: number,
): GameCard | undefined {
  load(dataDir);
  const c = cards[key(term, year)];
  return c && !c.missing ? c : undefined;
}
