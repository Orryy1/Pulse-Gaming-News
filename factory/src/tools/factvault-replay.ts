// Replays the factory's recent fact-check failures against the Fact Vault (14 Nov 2026), read-only: the failures come
// from a copy of the live events and episodes tables, the vault from the seed file. Episodes are replayed oldest first,
// as FACT_VAULT=enforce would have met them: the seed, the Steam prices the factory fetched for that episode, and the
// disputes recorded from every earlier failure. No model is called.
//
//   node --import tsx src/tools/factvault-replay.ts <seed.json.gz> <episodes.json> <events.json> <out-dir> [--last 30]
//
// episodes.json: rows of episodes whose last_error names the fact check; events.json: failing 'factcheck' events.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createEmbeddedDb, migrate } from "../db.ts";
import { FactVault, type VaultExport } from "../factvault/store.ts";
import { loadContext } from "../factvault/vault.ts";
import {
  parseBlocker,
  repeatsDispute,
  resolveBlocker,
  type Resolution,
} from "../factvault/check.ts";
import { entityKey } from "../factvault/normalise.ts";
import { SEED_GAMES } from "../factvault/seedlist.ts";

const [seedFile, epFile, evFile, outDir] = process.argv.slice(2);
if (!seedFile || !epFile || !evFile || !outDir) {
  console.error(
    "usage: factvault-replay.ts <seed.json.gz> <episodes.json> <events.json> <out-dir> [--last 30]",
  );
  process.exit(1);
}
const lastN =
  Number(process.argv[process.argv.indexOf("--last") + 1] ?? 30) || 30;

interface EpRow {
  id: string;
  lane: string;
  status: string;
  updated_at: string;
  headline: string;
  last_error: string;
}
interface EvRow {
  id: number;
  episode_id: string;
  created_at: string;
  detail: { attempt?: number; blockers?: string[] };
}

const episodes = (JSON.parse(fs.readFileSync(epFile, "utf8")) as EpRow[]).sort(
  (a, b) => a.updated_at.localeCompare(b.updated_at),
);
const events = JSON.parse(fs.readFileSync(evFile, "utf8")) as EvRow[];

/** Why a blocker stood, in the owner's words (buckets for the report only). */
const BUCKETS: Array<[RegExp, string]> = [
  [
    /\b(no .{0,60}(is |was )?supplied|not supplied|is not among the supplied|no .{0,40}(article|guide|walkthrough|manual|notes|demo|review) (is|was) (supplied|provided))/i,
    "credits a source the writer was never given",
  ],
  [/\b(price|priced|\$\d|rounding|rounded)/i, "price wording"],
  [
    /\b(switch 2|platform|available on|availability|store)/i,
    "platform or availability",
  ],
  [
    /\b(quot|verbatim|paraphras|review attribution|exact quotation)/i,
    "a quote or review attribution",
  ],
  [/\b(sales|sold|copies)/i, "a sales figure"],
  [/\b(release|launch|year|month|date)/i, "a date"],
  [
    /\b(every|nine|all|scope|complete|exhaustive|only|first|best-selling|fastest)/i,
    "scope or a superlative",
  ],
];
const bucketOf = (problem: string) =>
  BUCKETS.find(([re]) => re.test(problem))?.[1] ?? "a gameplay or story detail";

// The time-of-episode Steam price, as FACT_VAULT=write would have stored it from the facts the factory fetched.
const SUPPLIED_PRICE =
  /(?:supplied (?:us )?price is|costs|lowest supplied price is)\s+(\$\d+(?:\.\d\d)?)/i;
const gameNames = [
  ...new Set([
    ...SEED_GAMES.flatMap((g) => [g.name, ...(g.aliases ?? [])]),
    "Borderlands 2",
    "Assassin's Creed 2",
    "Assassin's Creed II",
    "Green Hell",
    "Monster Prom",
    "Finding Paradise",
    "Slime Rancher",
    "Bomber Crew",
  ]),
];
const gameIn = (text: string) => {
  const key = `-${entityKey(text)}-`;
  return gameNames
    .filter((n) => key.includes(`-${entityKey(n)}-`))
    .sort((a, b) => b.length - a.length)[0];
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factvault-replay-"));
const db = await createEmbeddedDb(path.join(dir, "db"));
await migrate(db);
const vault = new FactVault(db);
const seed = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(seedFile)).toString("utf8"),
) as VaultExport;
const imported = await vault.importAll(seed);
const stats = await vault.stats();

const blockersOf = (ep: EpRow) => {
  const evs = events
    .filter((e) => e.episode_id === ep.id)
    .sort((a, b) => (a.detail.attempt ?? 0) - (b.detail.attempt ?? 0));
  if (evs.length)
    return {
      first: evs[0]!.detail.blockers ?? [],
      final: evs.at(-1)!.detail.blockers ?? [],
    };
  const final = ep.last_error
    .split(" | ")
    .filter((b) => b.startsWith("Fact-check:"));
  return { first: [] as string[], final };
};

interface BlockerResult {
  blocker: string;
  outcome: "passed" | "fixed" | "warned" | "stands";
  why: string;
  fixes?: Array<{ from: string; to: string }>;
  source?: string;
  bucket: string;
  reconstructed?: string;
}
interface EpisodeResult {
  id: string;
  when: string;
  lane: string;
  headline: string;
  outcome: "saved" | "warned" | "partly" | "fails";
  blockers: BlockerResult[];
}

const ordered = episodes.slice(-lastN);
const before = episodes.slice(0, -lastN);
// Disputes from the failures before the window, as write mode would have recorded them.
for (const ep of before) {
  const { first, final } = blockersOf(ep);
  for (const raw of [...first, ...final]) {
    const b = parseBlocker(raw);
    if (b)
      await vault.addDispute({
        claim: b.quote,
        reason: b.problem,
        episodeId: ep.id,
      });
  }
}

// The games a ranking covers, as its fact sheets would have named them: vault games sharing a distinctive word with the
// headline ("Ranking EVERY Fallout Game" covers every Fallout entry).
const allEntities = await vault.allEntities();
const NOT_DISTINCT = new Set(["ranking", "every", "game", "games", "worst", "best", "released", "spin", "offs", "included", "including", "great", "steam", "sale", "right", "that", "this", "week", "exploded", "numbered", "with", "from", "what", "rockstar", "actually"]);
const coveredBy = (headline: string) => {
  const words = new Set(entityKey(headline).split("-").filter((w) => w.length >= 4 && !NOT_DISTINCT.has(w)));
  return allEntities.filter((e) => entityKey(e.name).split("-").some((w) => words.has(w))).map((e) => e.name);
};

const results: EpisodeResult[] = [];
for (const ep of ordered) {
  const now = new Date(ep.updated_at);
  const { first, final } = blockersOf(ep);
  // Disputes from earlier episodes only: the same episode's first attempt was already fed back to its writer.
  const earlier = (
    await db.query<{
      claim: string;
      reason: string;
      episode_id: string | null;
    }>(`SELECT claim, reason, episode_id FROM fact_vault_disputes`)
  ).filter((d) => d.episode_id !== ep.id);
  const out: BlockerResult[] = [];
  for (const raw of final) {
    const b = parseBlocker(raw);
    if (!b) continue;
    let reconstructed: string | undefined;
    const price = b.problem.match(SUPPLIED_PRICE);
    const game = gameIn(b.quote) ?? gameIn(b.problem);
    if (price && game) {
      const amount = Number(price[1]!.slice(1));
      await vault.addFact({
        entity: { kind: "game", name: game },
        kind: "price",
        claim: `${game} costs ${price[1]} on Steam (USD)`,
        value: price[1]!,
        valueJson: { amount, currency: "USD" },
        region: "US",
        sourceUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(game)}`,
        sourceType: "store_page",
        origin: "steam",
        checkedAt: now,
        confidence: 0.9,
      });
      reconstructed = `${game} at ${price[1]}, the Steam price the factory fetched for this episode`;
    }
    const ctx = await loadContext(
      vault,
      [...(game ? [game] : []), ...coveredBy(ep.headline)],
      [ep.headline, b.quote, b.problem],
      now,
    );
    const r: Resolution = resolveBlocker(b, ctx);
    const dispute = repeatsDispute(
      b.quote,
      earlier.map((d, i) => ({
        id: i,
        entity_id: null,
        claim: d.claim,
        reason: d.reason,
        episode_id: d.episode_id,
        times: 1,
        last_at: "",
      })),
    );
    const outcome: BlockerResult["outcome"] =
      r.status === "supported"
        ? "passed"
        : r.status === "fixed"
          ? "fixed"
          : dispute
            ? "warned"
            : "stands";
    out.push({
      blocker: raw,
      outcome,
      why:
        outcome === "warned"
          ? `repeats a claim rejected on ${dispute!.episode_id}: "${dispute!.claim.slice(0, 120)}"`
          : r.why,
      ...(r.fixes.length
        ? { fixes: r.fixes.map((f) => ({ from: f.from, to: f.to })) }
        : {}),
      ...(r.judged[0]?.fact ? { source: r.judged[0].fact.source_url } : {}),
      bucket: bucketOf(b.problem),
      ...(reconstructed ? { reconstructed } : {}),
    });
  }
  // Write mode records every blocker of both attempts as disputes for the episodes after this one.
  for (const raw of [...first, ...final]) {
    const b = parseBlocker(raw);
    if (b)
      await vault.addDispute({
        claim: b.quote,
        reason: b.problem,
        episodeId: ep.id,
      });
  }
  const settled = out.filter(
    (x) => x.outcome === "passed" || x.outcome === "fixed",
  ).length;
  const warned = out.filter((x) => x.outcome === "warned").length;
  results.push({
    id: ep.id,
    when: ep.updated_at,
    lane: ep.lane,
    headline: ep.headline,
    outcome:
      out.length && settled === out.length
        ? "saved"
        : out.length && settled + warned === out.length
          ? "warned"
          : settled + warned > 0
            ? "partly"
            : "fails",
    blockers: out,
  });
}

const all = results.flatMap((r) => r.blockers);
const count = (o: string) => all.filter((b) => b.outcome === o).length;
const buckets = Object.entries(
  all
    .filter((b) => b.outcome === "stands")
    .reduce<
      Record<string, number>
    >((m, b) => ((m[b.bucket] = (m[b.bucket] ?? 0) + 1), m), {}),
).sort((a, b) => b[1] - a[1]);
const summary = {
  vault: { ...stats, imported },
  episodes: results.length,
  saved: results.filter((r) => r.outcome === "saved").length,
  warned: results.filter((r) => r.outcome === "warned").length,
  partly: results.filter((r) => r.outcome === "partly").length,
  fails: results.filter((r) => r.outcome === "fails").length,
  blockers: {
    total: all.length,
    passed: count("passed"),
    fixed: count("fixed"),
    warned: count("warned"),
    stands: count("stands"),
  },
  standing: Object.fromEntries(buckets),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "replay.json"),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
await db.close();
