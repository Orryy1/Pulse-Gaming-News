// The writers' room proof (SCRIPT_ROOM, src/editorial/room.ts). Runs the room on stored stories and prints what it did;
// never publishes, never voices, never writes to the database.
//
// Paid (spends model credit; the owner approves first):
//   npx tsx src/tools/room-proof.ts <stories.json> <out-dir> --yes-spend --max-usd <dollars> [--model <id>]
//     [--mid <id>] [--ids a,b] [--rounds 2] [--min 8] [--no-viewer] [--links] [--no-fetch] [--layout]
// <stories.json>: rows of episodes ({ id, story_json }, the episodes table or /admin/export) or story clusters
// ({ hash, headline, items, ... }). For each: the sources fetched as the factory fetches them (or the feed summaries
// with --no-fetch), the fact pack, the angles, the three drafts, both critics' marks, each edit round and the final
// narration; with --layout, the laid-out Script too. --model sets the writing tier, --mid the critics' tier (default:
// the factory's own models). PROOF_LLM=codex sends every step to Codex instead. Stops before the next story once the
// spend passes --max-usd (Claude's price table). Writes room-proof.json in <out-dir>.

import fs from "node:fs";
import path from "node:path";
import type { Llm } from "../editorial/llm.ts";
import type { StoryCluster } from "../discovery/cluster.ts";
import type { ArticleText } from "../discovery/article.ts";
import type { RoomRun } from "../editorial/room.ts";
import type { Script } from "../editorial/schema.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The story cluster in a row (pure): an episode's story_json, or the row itself when it is a cluster. */
export function clusterOf(row: unknown): StoryCluster | undefined {
  const r = row as {
    story_json?: StoryCluster;
    items?: unknown[];
    headline?: string;
  };
  const c =
    r.story_json ??
    (Array.isArray(r.items) && r.headline ? (r as StoryCluster) : undefined);
  return c && Array.isArray(c.items) ? c : undefined;
}

/** The run as plain text for the console (pure). */
export function describeRun(id: string, run: RoomRun, script?: Script): string {
  const out: string[] = [
    `=== ${id}: ${run.stop}${run.error ? ` (${run.error})` : ""}`,
  ];
  if (run.pack) {
    out.push(`PACK what happened: ${run.pack.what_happened}`);
    out.push(
      `  why (${run.pack.the_why.stated ? "stated" : "not stated"}): ${run.pack.the_why.reason}`,
    );
    for (const q of run.pack.quotes)
      out.push(`  quote: "${q.text}" (${q.speaker}, ${q.outlet})`);
    for (const n of run.pack.numbers)
      out.push(`  number: ${n.value} = "${n.spoken}" (${n.what})`);
    out.push(`  surprise: ${run.pack.surprise.detail || "(none)"}`);
    out.push(
      `  thin: ${run.pack.thin.thin}${run.pack.thin.reason ? ` (${run.pack.thin.reason})` : ""}`,
    );
    if (run.drops?.dropped.length)
      out.push(`  dropped by code: ${run.drops.dropped.join("; ")}`);
  }
  if (run.writing) {
    run.writing.angles.forEach((a, i) =>
      out.push(`ANGLE ${i}: ${a.question} -> ${a.answer} [${a.solidity}]`),
    );
    out.push(`POINT: ${run.writing.point}`);
    if (run.writing.kill) out.push(`KILL: ${run.writing.kill_reason}`);
  }
  for (const d of run.drafts) {
    out.push(`DRAFT ${d.label}: ${d.title}`);
    out.push(`  ${d.narration}`);
    out.push(
      `  editor ${d.editor ? JSON.stringify(d.editor) : "unread"}; viewer ${d.viewer ? JSON.stringify(d.viewer) : "unread"}; words ${d.counts.words}, names ${d.counts.names}, numbers ${d.counts.numbers}; flags ${d.findings.join(", ") || "none"}`,
    );
  }
  if (run.pick) out.push(`PICK: ${run.pick}`);
  for (const r of run.rounds)
    out.push(
      `ROUND ${r.round}: mean ${r.mean ?? "n/a"}${r.editor ? ` editor ${r.editor.overall}` : ""}${r.viewer ? ` viewer ${r.viewer.overall}` : ""}${r.refused ? ` refused: ${r.refused.join(" ")}` : ""}`,
    );
  if (run.final)
    out.push(`FINAL: ${run.final.title}\n  ${run.final.narration}`);
  if (script)
    out.push(
      `LAYOUT: hook "${script.hook}", ${script.beats.length} beats, title "${script.youtube.title}"`,
    );
  out.push(`CALLS: ${JSON.stringify(run.calls)}`);
  return out.join("\n");
}

async function main(
  inFile: string,
  outDir: string,
  maxUsd: number,
): Promise<void> {
  const { withVoiceTags, createClaude, tapUsage, usageCost } =
    await import("../editorial/llm.ts");
  const { roomRun } = await import("../roomstep.ts");
  const { runLayout } = await import("../editorial/room.ts");
  const { writeScript, WORDS_MIN, WORDS_MAX } =
    await import("../editorial/editorial.ts");
  const { fetchArticle, fetchOutboundLinks } =
    await import("../discovery/article.ts");
  const { FEEDS } = await import("../discovery/feeds.ts");
  fs.mkdirSync(outDir, { recursive: true });
  process.env.DATA_DIR ||= path.join(outDir, "data");
  let spent = 0;
  const untap = tapUsage((line) => {
    spent += usageCost(line);
  });
  let llm: Llm;
  if ((process.env.PROOF_LLM || "claude") === "codex") {
    const { createCodexLlm } = await import("../editorial/codex.ts");
    llm = withVoiceTags(
      createCodexLlm(
        {
          async structured() {
            throw new Error(
              "Codex failed; this proof does not fall back to Claude",
            );
          },
        },
        {
          enabled: true,
          sites: ["*"],
          timeoutMs: Number(process.env.CODEX_TIMEOUT_MINUTES || 25) * 60_000,
          python: process.env.CODEX_PYTHON || "python",
          runnerDir: process.env.CODEX_RUNNER_DIR || "C:\\Claude\\orchestrator",
          tmpDir: path.join(outDir, "codex-tmp"),
        },
      ),
    );
  } else {
    const { loadConfig } = await import("../config.ts");
    const cfg = loadConfig();
    llm = withVoiceTags(
      createClaude({
        top: flag("--model") ?? cfg.anthropicModel,
        mid: flag("--mid") ?? cfg.claudeModelMid,
        low: cfg.claudeModelLow,
      }),
    );
  }
  const ids = flag("--ids")?.split(",").filter(Boolean);
  const rows = (
    JSON.parse(fs.readFileSync(inFile, "utf8")) as Array<
      Record<string, unknown>
    >
  ).filter((r) => !ids || ids.includes(String(r.id ?? r.hash ?? "")));
  const length = {
    seconds: { min: 30, max: 50 },
    wordsMin: WORDS_MIN + 10,
    wordsMax: WORDS_MAX + 15,
    beatsMax: 6,
  };
  const results: Array<{
    id: string;
    run?: RoomRun;
    script?: Script;
    layout_fallback?: string;
    error?: string;
  }> = [];
  for (const row of rows) {
    if (spent >= maxUsd) {
      console.log(`stopped: spent $${spent.toFixed(2)} of the $${maxUsd} cap`);
      break;
    }
    const id = String(row.id ?? row.hash ?? results.length);
    const cluster = clusterOf(row);
    if (!cluster) {
      results.push({ id, error: "no story in this row" });
      continue;
    }
    try {
      const articles: ArticleText[] = args.includes("--no-fetch")
        ? []
        : (
            await Promise.all(
              cluster.items
                .slice(0, 4)
                .map((i) => fetchArticle(i.url).catch(() => undefined)),
            )
          ).filter((a): a is ArticleText => !!a);
      const input = {
        llm,
        cfg: {
          scriptRoomViewer: !args.includes("--no-viewer"),
          scriptRoomRounds: Number(flag("--rounds") ?? 2),
          scriptRoomMin: Number(flag("--min") ?? 8),
          scriptRoomLinks: args.includes("--links"),
        },
        cluster,
        articles,
        length,
        mustLabelRumour: !cluster.corroborated,
        feedUrls: FEEDS.map((f) => f.url),
        fetchLinks: fetchOutboundLinks,
        fetchArticle,
      };
      const { run } = await roomRun(input);
      const r: (typeof results)[number] = { id, run };
      if (run.final && args.includes("--layout")) {
        const lay = await runLayout({
          narration: run.final.narration,
          layout: (feedback) =>
            writeScript(llm, cluster, articles, {
              mustLabelRumour: input.mustLabelRumour,
              length,
              ...(feedback ? { feedback: [feedback] } : {}),
              layout: {
                title: run.final!.title,
                narration: run.final!.narration,
              },
            }),
        });
        if (lay.script) r.script = lay.script;
        else r.layout_fallback = lay.fallback;
      }
      results.push(r);
      console.log(describeRun(id, run, r.script));
    } catch (err) {
      results.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    fs.writeFileSync(
      path.join(outDir, "room-proof.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(`spent $${spent.toFixed(2)}`);
  }
  untap();
  console.log(
    `wrote ${path.join(outDir, "room-proof.json")}; spent $${spent.toFixed(2)}`,
  );
}

const isMain = process.argv[1] && /room-proof\.ts$/.test(process.argv[1]);
if (isMain) {
  const max = Number(flag("--max-usd"));
  if (!args[0] || !args[1] || args[0].startsWith("--")) {
    console.error(
      "usage: room-proof.ts <stories.json> <out-dir> --yes-spend --max-usd <dollars> [--model <id>] [--mid <id>] [--ids a,b] [--rounds 2] [--min 8] [--no-viewer] [--links] [--no-fetch] [--layout]",
    );
    process.exit(2);
  }
  if (!args.includes("--yes-spend") || !Number.isFinite(max) || max <= 0) {
    console.error(
      "The room spends model credit. Add --yes-spend and a --max-usd cap once the owner has approved it.",
    );
    process.exit(2);
  }
  await main(args[0], path.resolve(args[1]), max);
}
