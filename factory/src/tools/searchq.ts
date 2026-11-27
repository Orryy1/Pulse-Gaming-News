// The search-demand engine by hand (the server runs the harvest when SEARCH_SHORTS is on):
//   npx tsx src/tools/searchq.ts harvest [--out <dir>] [--games "Name@ISO;Name"] [--covered <run.json,...>]
//        read the suggestions (read only, polite), rank them and write queries.json and queries.html to --out
//        (default: the data folder's search/)
//   npx tsx src/tools/searchq.ts write [--out <dir>] [--top 2] [--codex]
//        write sample scripts for the top makeable queries in --out/queries.json through the Short writer and the fact
//        check, saved as script_<n>.json and scripts.md; --codex sends both to Codex (sites search.write and
//        search.check) with no Claude fallback. Nothing is voiced, rendered or posted.

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { createCodexLlm } from "../editorial/codex.ts";
import type { Llm } from "../editorial/llm.ts";
import { fetchArticle } from "../discovery/article.ts";
import { parseSearchGames } from "../searchq/settings.ts";
import { harvestPass, plannedTexts, sameName } from "../searchq/job.ts";
import { factsFileFor, readFacts } from "../searchq/facts.ts";
import { distinctAsks, makeable } from "../searchq/rank.ts";
import { readQueries, searchDir } from "../searchq/store.ts";
import { searchCluster, writeSearchSample } from "../searchq/step.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cfg = loadConfig();
const out = path.resolve(flag("out") ?? searchDir(cfg.dataDir));
const cmd = args[0];

if (cmd === "harvest") {
  const games = flag("games")
    ? parseSearchGames(flag("games")!)
    : cfg.searchShorts.games;
  const covered = plannedTexts(
    (flag("covered") ?? cfg.shortRunFile).split(",").map((s) => s.trim()),
  );
  const file = await harvestPass({
    settings: cfg.searchShorts,
    dataDir: cfg.dataDir,
    outDir: out,
    covered,
    games,
  });
  const kept = file.queries.filter((q) => !q.dropped);
  console.log(
    `${file.requests} requests (${file.failed} failed${file.refused.length ? `, refused by ${file.refused.join(", ")}` : ""}), ${file.observations} suggestions, ${file.queries.length} queries, ${kept.length} makeable`,
  );
  for (const [i, q] of file.queries.slice(0, 25).entries())
    console.log(
      `${String(i + 1).padStart(2)}. ${String(q.score).padStart(3)}  ${q.query}  [${q.game}; ${q.intent}; ${q.kind} ${q.answerable}]${q.dropped ? `  (out: ${q.dropped})` : `  -> "${q.title}"`}`,
    );
  console.log(path.join(out, "queries.html"));
} else if (cmd === "write") {
  const file = await readQueries(out);
  if (!file) throw new Error(`no queries.json in ${out}: run harvest first`);
  const top = Number(flag("top") ?? 2);
  const noClaude: Llm = {
    structured: async () => {
      throw new Error("no Claude from the hand tool (the API is at its limit)");
    },
  };
  const llm = args.includes("--codex")
    ? createCodexLlm(noClaude, {
        enabled: true,
        sites: ["search"],
        python: cfg.codexPython,
        runnerDir: cfg.codexRunnerDir,
        timeoutMs: cfg.codexTimeoutMinutes * 60_000,
        tmpDir: path.join(out, "codex-tmp"),
      })
    : noClaude;
  const picks = distinctAsks(makeable(file.queries, cfg.searchShorts.minScore), top);
  const md: string[] = [
    `# Search Short samples (${new Date().toISOString().slice(0, 16)} UTC)`,
    "",
  ];
  for (const [i, q] of picks.entries()) {
    console.log(`writing ${i + 1}/${picks.length}: ${q.query}`);
    const cluster = searchCluster(
      q,
      new Date(),
      false,
      readFacts(factsFileFor(cfg.searchShorts.facts, q.game, sameName)),
    );
    const r = await writeSearchSample(llm, cluster, fetchArticle);
    await fs.writeFile(
      path.join(out, `script_${i + 1}.json`),
      `${JSON.stringify(r, null, 2)}\n`,
    );
    md.push(...r.markdown, "");
    console.log(
      `  ${r.verdict}: "${r.script?.youtube.title ?? "(no script)"}"${r.problems.length ? ` (${r.problems.length} problems)` : ""}`,
    );
  }
  await fs.writeFile(path.join(out, "scripts.md"), `${md.join("\n")}\n`);
  await fs.rm(path.join(out, "codex-tmp"), { recursive: true, force: true });
  console.log(path.join(out, "scripts.md"));
} else {
  console.error(
    "usage: searchq.ts harvest|write [--out <dir>] [--games ...] [--top N] [--codex]",
  );
  process.exit(2);
}
