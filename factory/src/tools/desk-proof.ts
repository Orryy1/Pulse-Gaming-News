// The editor's desk proof (top creator gap plan, writer check, 18 Nov 2026).
//
// Free, deterministic, no model call:
//   npx tsx src/tools/desk-proof.ts --checks <scripts.json> [<more.json> ...] [--out <file.json>]
// Each file is rows of { code, title, narration } (the blind test's blind_scripts.json, rewrites.json) or episodes
// ({ id, script_json }). Counts each deterministic finding per file. A flat row carries no game title, so the full-name
// check reads the longest name of two words or more that the title and the narration share.
//
// Paid (spends model credit; the owner approves first):
//   npx tsx src/tools/desk-proof.ts --run <episodes.json> <out-dir> --yes-spend --max-usd <dollars> [--ids a,b] [--min 7] [--rounds 2]
// <episodes.json>: rows of { id, lane, script_json, story_json } (the episodes table, or /admin/export). For each: the
// desk's full loop in fix mode on the published script, exactly as the factory runs it (the editor's read on the mid
// tier, one instruction a round through the edit-based reviser, the fact guard, the fact check against the story's own
// sources, read again, best version kept). Stops before the next Short once the spend passes --max-usd (Claude's price
// table; a Codex call costs nothing). PROOF_LLM=claude (default) or codex. Writes desk-proof.json in <out-dir>;
// nothing reaches the database, no voice, no upload.

import fs from "node:fs";
import path from "node:path";
import {
  DESK_RULES,
  deskChecks,
  deskLines,
  judgeDesk,
  runDesk,
  type DeskFinding,
  type DeskLoopResult,
  type DeskRule,
} from "../editorial/desk.ts";
import { firstFrameText } from "../editorial/payoff.ts";
import type { Script } from "../editorial/schema.ts";
import type { Llm } from "../editorial/llm.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------------------------------------------------------------- the checks (free)

interface FlatRow {
  code?: string;
  id?: string;
  title?: string;
  narration?: string;
  script_json?: Script;
}

/**
 * A flat row's game (pure, proof only): the longest run of two or more capitalised words (a numeral may close it)
 * that the title and the narration share; empty when none.
 */
export function guessGame(title: string, narration: string): string {
  const runs = (t: string) =>
    [
      ...t.matchAll(
        /\b(?:[A-Z][\w'’:-]*\s+){1,4}(?:[A-Z][\w'’-]*|\d+|[IVX]+)\b/g,
      ),
    ].map((m) => m[0].replace(/[:'’]s?$/, "").trim());
  const said = narration.toLowerCase();
  return (
    runs(title)
      .filter(
        (r) => r.split(/\s+/).length >= 2 && said.includes(r.toLowerCase()),
      )
      .sort((a, b) => b.length - a.length)[0] ?? ""
  );
}

/** Each row's findings (pure). */
export function checkRows(
  rows: FlatRow[],
): Array<{ code: string; findings: DeskFinding[] }> {
  return rows.map((r) => {
    if (r.script_json)
      return {
        code: r.id ?? r.code ?? "",
        findings: deskChecks({
          lines: deskLines(r.script_json),
          game: r.script_json.game_title,
        }),
      };
    const narration = r.narration ?? "";
    return {
      code: r.code ?? r.id ?? "",
      findings: deskChecks({
        lines: [narration],
        game: guessGame(r.title ?? "", narration),
      }),
    };
  });
}

/** Counts per rule: scripts with the finding, and findings in all (pure). */
export function countFindings(
  results: Array<{ findings: DeskFinding[] }>,
): Record<DeskRule, { scripts: number; findings: number }> {
  const out = Object.fromEntries(
    DESK_RULES.map((r) => [r, { scripts: 0, findings: 0 }]),
  ) as Record<DeskRule, { scripts: number; findings: number }>;
  for (const r of results) {
    for (const rule of new Set(r.findings.map((f) => f.rule)))
      out[rule].scripts++;
    for (const f of r.findings) out[f.rule].findings++;
  }
  return out;
}

// ---------------------------------------------------------------- the full loop (paid)

interface Row {
  id: string;
  lane?: string;
  script_json: Script;
  story_json?: any;
}

async function run(
  inFile: string,
  outDir: string,
  maxUsd: number,
): Promise<void> {
  const { ScriptSchema, narrationOf, wordCount } =
    await import("../editorial/schema.ts");
  const { scriptPrompt, factCheck, WORDS_MAX } =
    await import("../editorial/editorial.ts");
  const { reviseByEdits } = await import("../editorial/revise.ts");
  const { friendCheckVerdict, shortSettledText } =
    await import("../editorial/friendpass.ts");
  const { withVoiceTags, createClaude, tapUsage, usageCost } =
    await import("../editorial/llm.ts");
  const { deskShortProblems } = await import("../editorial/desk.ts");
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
        top: cfg.anthropicModel,
        mid: cfg.claudeModelMid,
        low: cfg.claudeModelLow,
      }),
    );
  }
  const min = Number(flag("--min") ?? 7);
  const rounds = Number(flag("--rounds") ?? 2);
  const ids = flag("--ids")?.split(",").filter(Boolean);
  const rows = (JSON.parse(fs.readFileSync(inFile, "utf8")) as Row[]).filter(
    (r) => !ids || ids.includes(r.id),
  );
  const results: Array<{
    id: string;
    before: { title: string; lines: string[] };
    after?: { title: string; lines: string[] };
    loop?: Omit<DeskLoopResult<Script>, "value">;
    checks?: number;
    error?: string;
  }> = [];
  for (const row of rows) {
    if (spent >= maxUsd) {
      console.log(
        `stopped before ${row.id}: spent $${spent.toFixed(2)} of the $${maxUsd} cap`,
      );
      break;
    }
    const before = row.script_json;
    const r: (typeof results)[number] = {
      id: row.id,
      before: { title: before.youtube.title, lines: deskLines(before) },
    };
    console.log(`start ${row.id}`);
    try {
      const n = wordCount(narrationOf(before));
      const length = {
        seconds: { min: 25, max: 60 },
        wordsMin: Math.round(n * 0.8),
        wordsMax: Math.max(WORDS_MAX, Math.round(n * 1.12)),
        beatsMax: Math.max(4, before.beats.length),
      };
      const st = row.story_json ?? {};
      const items = (st.items ?? [])
        .map(
          (i: any, k: number) =>
            `<source index="${k}" outlet="${i.source}" url="${i.url}">\n<headline>${i.title}</headline>\n<body>${i.summary || "(headline only)"}</body>\n</source>`,
        )
        .join("\n");
      const content = `Sources:\n${items}`;
      const system = scriptPrompt(false, length);
      let checks = 0;
      const loop = await runDesk<Script>({
        value: before,
        mode: "fix",
        min,
        rounds,
        judge: (v) =>
          judgeDesk(llm, {
            title: v.youtube.title,
            firstFrame: firstFrameText(v),
            narration: deskLines(v),
          }),
        checks: (v) => deskChecks({ lines: deskLines(v), game: v.game_title }),
        rewrite: async (v, instruction) => {
          const out = await reviseByEdits(llm, {
            site: "desk.rewrite",
            system,
            content,
            schema: ScriptSchema,
            draft: v,
            problems: [instruction],
            job: "desk proof",
          });
          if (!out) throw new Error("the desk's edits did not apply");
          return { ...v, ...out };
        },
        accept: async (b, a) => {
          const guard = deskShortProblems(b, a, length);
          if (guard.length) return guard;
          checks++;
          const v = friendCheckVerdict(
            await factCheck(llm, a, st as never, []),
            shortSettledText(b),
          );
          return v.blockers;
        },
      });
      const { value, ...rest } = loop;
      r.after = { title: value.youtube.title, lines: deskLines(value) };
      r.loop = rest;
      r.checks = checks;
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
    results.push(r);
    fs.writeFileSync(
      path.join(outDir, "desk-proof.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      `done ${row.id}${r.error ? ` (error: ${r.error})` : ""}: ${r.loop?.rounds.map((x) => x.scores?.overall ?? "refused").join(" -> ") ?? ""}, kept round ${r.loop?.kept ?? 0}; spent $${spent.toFixed(2)}`,
    );
  }
  untap();
  console.log(
    `wrote ${path.join(outDir, "desk-proof.json")}; spent $${spent.toFixed(2)}`,
  );
}

// ---------------------------------------------------------------- entry

const isMain = process.argv[1] && /desk-proof\.ts$/.test(process.argv[1]);
if (isMain) {
  if (args[0] === "--checks" && args[1]) {
    const files = args
      .slice(1)
      .filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--out");
    const report: Record<string, unknown> = {};
    for (const file of files) {
      const rows = JSON.parse(fs.readFileSync(file, "utf8")) as FlatRow[];
      const results = checkRows(rows);
      const counts = countFindings(results);
      report[file] = { results, counts };
      console.log(
        `${path.basename(path.dirname(file))}/${path.basename(file)}: ${rows.length} scripts`,
      );
      for (const rule of DESK_RULES)
        console.log(
          `  ${rule.padEnd(15)} ${String(counts[rule].scripts).padStart(3)} scripts, ${String(counts[rule].findings).padStart(3)} findings`,
        );
      const clean = results.filter(
        (r) => !r.findings.some((f) => !f.advisory),
      ).length;
      console.log(`  clean (no firm finding) ${clean} of ${rows.length}`);
    }
    const out = flag("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  } else if (args[0] === "--run" && args[1] && args[2]) {
    const max = Number(flag("--max-usd"));
    if (!args.includes("--yes-spend") || !Number.isFinite(max) || max <= 0) {
      console.error(
        "The full loop spends model credit. Add --yes-spend and a --max-usd cap once the owner has approved it.",
      );
      process.exit(2);
    }
    await run(args[1], path.resolve(args[2]), max);
  } else {
    console.error(
      "usage:\n  desk-proof.ts --checks <scripts.json> [<more.json> ...] [--out <file.json>]\n  desk-proof.ts --run <episodes.json> <out-dir> --yes-spend --max-usd <dollars> [--ids a,b] [--min 7] [--rounds 2]",
    );
    process.exit(2);
  }
}
