// The search-demand engine's files (SEARCH_SHORTS): data/search/queries.json (the ranked list the lane picks from),
// queries.html (the same list for the owner to read), history.json (first and last sightings, for freshness) and
// state.json (when the last harvest ran). Plain files, no table: a broken file means a fresh start, never a stop.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { History, QueryCluster } from "./rank.ts";

export const searchDir = (dataDir: string) => path.join(dataDir, "search");

export interface QueryFile {
  harvestedAt: string;
  games: string[];
  requests: number;
  failed: number;
  refused: string[];
  observations: number;
  queries: QueryCluster[];
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The files in `dir`: the data folder's search/ (searchDir) or a proof run's own folder. */
export const readQueries = (dir: string) =>
  readJson<QueryFile>(path.join(dir, "queries.json"));
export const readHistory = (dir: string) =>
  readJson<History>(path.join(dir, "history.json"));
export const readState = async (dir: string) =>
  (await readJson<{ harvestedAt?: string }>(path.join(dir, "state.json"))) ??
  {};

/** Writes the list, its page and the history in `dir` (the data folder's search/ unless another is given). */
export async function writeQueries(
  dir: string,
  file: QueryFile,
  history?: History,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "queries.json"),
    `${JSON.stringify(file, null, 2)}\n`,
  );
  await fs.writeFile(path.join(dir, "queries.html"), queriesHtml(file));
  if (history)
    await fs.writeFile(
      path.join(dir, "history.json"),
      `${JSON.stringify(history)}\n`,
    );
  await fs.writeFile(
    path.join(dir, "state.json"),
    `${JSON.stringify({ harvestedAt: file.harvestedAt })}\n`,
  );
}

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** The owner's page (pure): the ranked queries, what answers each and why the rest are left out. */
export function queriesHtml(f: QueryFile): string {
  const row = (
    q: QueryCluster,
    i: number,
  ) => `<tr class="${q.dropped ? "out" : "in"}">
<td>${i + 1}</td><td><b>${esc(q.query)}</b>${q.variants.length > 1 ? `<div class="v">also: ${esc(q.variants.slice(1, 4).join(" · "))}</div>` : ""}</td>
<td>${esc(q.game)}</td><td class="n">${q.score}</td><td class="n">${q.demand}</td><td class="n">${q.fresh}</td><td class="n">${Math.round(q.answerable * 100) / 100}</td>
<td>${esc(q.sources.join(", "))} (#${q.bestRank + 1})</td><td>${esc(q.intent)}</td>
<td>${esc(q.title)}${q.titleProblems.length ? `<div class="p">${esc(q.titleProblems.join(" "))}</div>` : ""}</td>
<td>${q.dropped ? `<span class="p">${esc(q.dropped)}${q.covered ? `: ${esc(q.covered)}` : ""}</span>` : q.rumour ? "rumour, labelled" : "makeable"}${q.facts.length ? `<ul>${q.facts.map((x) => `<li>${esc(x.text)}${x.urls[0] ? ` <a href="${esc(x.urls[0])}">${esc(x.source)}</a>` : ` (${esc(x.source)})`}</li>`).join("")}</ul>` : ""}${q.playNotes.length ? `<ul>${q.playNotes.map((n) => `<li>${esc(n.text)} (${esc(n.from)})</li>`).join("")}</ul>` : ""}</td>
</tr>`;
  const kept = f.queries.filter((q) => !q.dropped);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Pulse search demand, ${esc(f.harvestedAt.slice(0, 16).replace("T", " "))} UTC</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #333;padding:6px 8px;vertical-align:top;text-align:left}th{position:sticky;top:0;background:#222}
.n{text-align:right;font-variant-numeric:tabular-nums}.out{opacity:.55}.v{color:#999;font-size:12px}.p{color:#f90;font-size:12px}
ul{margin:4px 0 0 16px;padding:0;font-size:12px;color:#bbb}a{color:#ff6b1a}</style></head><body>
<h1>What people search: ${esc(f.games.join(", "))}</h1>
<p>Harvested ${esc(f.harvestedAt)} from YouTube and Google autocomplete${f.refused.length ? ` (refused: ${esc(f.refused.join(", "))})` : ""}, plus DuckDuckGo question forms: ${f.requests} requests, ${f.observations} suggestions, ${f.queries.length} distinct queries, ${kept.length} makeable. Score = 45% demand (place in the lists, sites, seeds) + 20% freshness + 35% answerable from confirmed facts or the owner's play.</p>
<table><thead><tr><th>#</th><th>Query</th><th>Game</th><th>Score</th><th>Demand</th><th>Fresh</th><th>Answerable</th><th>Where</th><th>About</th><th>Title</th><th>Answer from</th></tr></thead>
<tbody>${f.queries.map(row).join("\n")}</tbody></table></body></html>
`;
}

/** The owner's page lives at /search/<key>: unguessable, unlinked and noindex, like the stream-asks page. */
export function searchKey(secret: string): string {
  return crypto
    .createHmac("sha256", `pulse-search:${secret || "unset"}`)
    .update("searchq")
    .digest("base64url")
    .slice(0, 22);
}
