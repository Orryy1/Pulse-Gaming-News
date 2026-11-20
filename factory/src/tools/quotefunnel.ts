// The character quote funnel (GAME_SPEECH_DIALOGUE, 20 Nov 2026): for the last Shorts and the long videos, how many
// could take a quote, what the factory did, and what today's scene indexes and trailer lines would offer each one now.
// Read-only: no model call, no download, nothing written.
//   node --import tsx src/tools/quotefunnel.ts [--shorts=100] [--since=2026-11-01] [--export=FILE --events=FILE]
// On the Mac it reads the admin API (127.0.0.1:8080, ADMIN_TOKEN from the environment); with --export and --events it
// reads saved copies of /admin/export?days=30 and /admin/events?kinds=character_quote,... instead. DATA_DIR picks the
// scene indexes (data/sceneindex) and GAME_LIBRARY_DIR the trailer lines.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quoteIndexFor } from "../charquotestep.ts";
import { trailerIndexes } from "../assets/trailerlines.ts";
import { quoteCandidates } from "../sceneindex/quotepick.ts";
import { demandLines } from "../sceneindex/speakerdemand.ts";
import { indexFitsRelease } from "../sceneindex/footage.ts";
import {
  spoilerWindow,
  windowFor,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import { narrationOf, type Script } from "../editorial/schema.ts";

interface Row {
  id: string;
  lane: string;
  live_at: string;
  script_json: Script | null;
}
interface Ev {
  episode_id: string;
  kind: string;
  created_at: string;
  detail: Record<string, unknown>;
}

/** What the factory did with an episode's quote, from its events (pure). */
export function stageOf(
  e: Pick<Row, "id" | "lane">,
  script: Script | null,
  evs: readonly Ev[],
  liveSince = "",
): string {
  const placed = evs.find((x) => x.kind === "character_quote_placed");
  if (placed) return "shipped";
  const dropped = evs.find((x) => x.kind === "character_quote_dropped");
  if (dropped)
    return `dropped before the voice: ${String(dropped.detail.why ?? "").slice(0, 70)}`;
  if (evs.some((x) => x.kind === "character_quote" && x.detail.used))
    return "placed, not shipped";
  const first = evs.find((x) => x.kind === "character_quote");
  if (first) {
    const why = String(first.detail.why ?? "");
    if (why.startsWith("no scene index"))
      return "no source (no scene index, no trailer lines)";
    if (why.startsWith("declined")) return "writer declined";
    if (why.startsWith("the quote failed")) return "failed its check";
    return (
      why.replace(/^.*?:\s*/, (m) => (m.length > 60 ? "" : m)).slice(0, 70) ||
      "skipped"
    );
  }
  // CHARACTER_QUOTES went live with its first event: an episode made before that day never had the step.
  const day = e.id.match(/^ep_(\d{4})(\d{2})(\d{2})_/);
  if (day && liveSince && `${day[1]}-${day[2]}-${day[3]}` < liveSince.slice(0, 10))
    return "before CHARACTER_QUOTES was on";
  if (script?.entries?.length && e.lane !== "longform") return "a ranking (takes no quote)";
  if (script?.every_game || script?.gameplay || script?.cutdown || script?.twin)
    return "a format that takes no quote";
  return e.lane === "longform"
    ? "no event (long step logged nothing)"
    : "no event (step not reached)";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string) =>
    args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const dataDir = process.env.DATA_DIR || "data";
  const read = async <T>(file: string | undefined, url: string): Promise<T> => {
    if (file) return JSON.parse(await fs.readFile(file, "utf8")) as T;
    const res = await fetch(`http://127.0.0.1:8080${url}`, {
      headers: { "x-admin-key": process.env.ADMIN_TOKEN ?? "" },
    });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return (await res.json()) as T;
  };
  const rows = await read<Row[]>(flag("export"), "/admin/export?days=30");
  const evs = await read<Ev[]>(
    flag("events"),
    "/admin/events?kinds=character_quote,character_quote_dropped,character_quote_placed,character_quote_fallback&hours=720",
  );
  const liveSince = evs.filter((e) => e.kind === "character_quote").map((e) => e.created_at).sort()[0] ?? "";
  const by = new Map<string, Ev[]>();
  for (const e of evs)
    by.set(e.episode_id, [...(by.get(e.episode_id) ?? []), e]);
  const shorts = rows
    .filter((r) => r.lane !== "longform")
    .sort((a, b) => b.live_at.localeCompare(a.live_at))
    .slice(0, Number(flag("shorts") ?? 100));
  const longs = rows.filter(
    (r) =>
      r.lane === "longform" && r.live_at >= (flag("since") ?? "2026-11-01"),
  );
  const launches = JSON.parse(
    await fs.readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "launches.json",
      ),
      "utf8",
    ),
  ) as Array<{ game: string; launch: string }>;
  const windows = launches
    .map((l) =>
      spoilerWindow(l.game, l.launch, { days: 28, openingShare: 0.1 }),
    )
    .filter((w): w is SpoilerWindow => !!w);
  const now = new Date();
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) =>
    m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of [...shorts, ...longs]) {
    const kind = r.lane === "longform" ? "long" : "short";
    const s = r.script_json;
    bump(before, `${kind} | ${stageOf(r, s, by.get(r.id) ?? [], liveSince)}`);
    // Today: what the sources would offer this script now (the writer may still decline every line). A long ranking
    // takes its quotes chapter by chapter, from each entry's game.
    const games = kind === "long" && s?.entries?.length ? s.entries.map((x) => x.game_title) : [s?.game_title ?? ""];
    if (!s || !games.some((g) => g?.trim()) || (kind === "short" && s.entries?.length) || s.every_game || s.gameplay || s.cutdown || s.twin) {
      bump(after, `${kind} | takes no quote (format or no game)`);
      continue;
    }
    const story = `${s.headline ?? ""} ${narrationOf({ ...s, voice_tags: undefined } as Script)}`;
    const recent = /\b(remake|remaster(?:ed)?|reimagined)\b/i.test(story);
    const use = kind === "long" ? ("long" as const) : ("short" as const);
    let sourced = false;
    let fits = 0;
    let named = 0;
    for (const game of games.filter((g) => g?.trim())) {
      let index = await quoteIndexFor(dataDir, game);
      if (index && !indexFitsRelease(index, recent)) index = undefined;
      const trailers = await trailerIndexes(dataDir, game);
      if (!index && !trailers.length) continue;
      sourced = true;
      const window = index ? windowFor(windows, game, now) : undefined;
      fits += [index, ...trailers]
        .filter((x) => !!x)
        .flatMap((x) => quoteCandidates(x!, story, { window: x === index ? window : undefined, use, max: 10, general: 0 })).length;
      named += index ? demandLines(index, story, new Set(), { window, use }).length : 0;
    }
    if (!sourced) bump(after, `${kind} | no source (no scene index, no trailer lines)`);
    else if (fits) bump(after, `${kind} | lines that fit the story on offer (writer decides)`);
    else if (named) bump(after, `${kind} | lines that fit once speakers are named (GAME_SPEECH_DIALOGUE)`);
    else bump(after, `${kind} | a source, but no line fits the story`);
  }
  const table = (title: string, m: Map<string, number>) => {
    console.log(`\n${title}`);
    for (const [k, n] of [...m.entries()].sort())
      console.log(`  ${String(n).padStart(4)}  ${k}`);
  };
  console.log(
    `${shorts.length} Shorts (oldest ${shorts.at(-1)?.live_at.slice(0, 10)}), ${longs.length} long videos`,
  );
  table("What the factory did (events)", before);
  table("What today's sources would offer the same scripts", after);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
