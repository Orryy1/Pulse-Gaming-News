// The payoff proof (top creator gap plan, gap 1, 18 Nov 2026): how today's Shorts measure against the held-answer
// rules, and (paid, only when asked) the same stories rewritten under SHORT_PAYOFF_GATE, before and after.
//
// Free, deterministic, no model call (the baseline):
//   npx tsx src/tools/payoff-proof.ts --baseline <pulse_videos.json> [--episodes <data/episodes dir>] [--out <file.json>]
// <pulse_videos.json> is the self-audit's rows (hook, take, loop line, title, first-frame text, word count per Short).
// Where <episodes dir>/<id>/captions.srt exists the whole narration is read from it; otherwise the beats are counted
// but unseen, and a rule that needs them is reported "unknown" rather than guessed. Today's scripts carry no payoff
// plan, so the held-answer rules are measured on a stand-in: the take's card text and its last sentence as the answer,
// the take's start as where the answer lands. Nothing is written but the output file.
//
// Paid (spends model credit; the owner approves first):
//   npx tsx src/tools/payoff-proof.ts --rewrite <episodes.json> <out-dir> --yes-spend [--ids id1,id2,...]
// <episodes.json>: rows of { id, lane, script_json, story_json } (the episodes table, or /admin/export). For each:
// the plan-free findings on the published script; the news writer's revision under the gate (its rule, the findings
// and the plan to fill in); the friend pass's fact guard; the deterministic rules again, and one more revision with
// the reasons if they fail (the "fix" mode); then the cold read of title, first frame and hook, the clarity judge and
// the factory's fact check against the story's own sources. PROOF_LLM=claude (default, the factory's tiers) or codex.
// Writes payoff-proof.json and index.html in <out-dir>; nothing reaches the database, no voice, no upload.

import fs from "node:fs";
import path from "node:path";
import {
  answerKeys,
  contentTokens,
  earlyAnswer,
  firstFrameText,
  leaksAnswer,
  openerProblems,
  payoffFeedback,
  payoffFindings,
  payoffLines,
  payoffRule,
  pivotAt,
  readFindings,
  readPayoff,
  sideEarly,
  spokenSentences,
  stockOpener,
  verdictLate,
  absenceAnswer,
  heldMark,
  teaseFillers,
  PIVOT_FROM,
  PIVOT_TO,
  PayoffSchema,
  type PayoffFinding,
  type PayoffRead,
} from "../editorial/payoff.ts";
import { endingProblems } from "../editorial/shortrules.ts";
import type { Script } from "../editorial/schema.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------------------------------------------------------------- the baseline (free)

export interface AuditRow {
  episode: string;
  published: string;
  lane: string;
  title: string;
  views?: number;
  first_frame_text?: string;
  hook: string;
  take_narration: string;
  take_on_screen?: string;
  loop_line: string;
  words: number;
}

type Verdict = "pass" | "fail" | "unknown";
const RULES = [
  "leak_title",
  "leak_headline",
  "leak_hook",
  "held_take_position",
  "held_early_in_body",
  "pivot",
  "side",
  "verdict",
  "opener_rotation",
  "stacked_id",
  "tease_filler",
  "absence_answer",
  "ending",
] as const;
type BaseRule = (typeof RULES)[number];

export interface BaseResult {
  id: string;
  published: string;
  lane: string;
  title: string;
  views?: number;
  full: boolean;
  take_at: number;
  rules: Record<BaseRule, Verdict>;
  notes: string[];
}

const PLACE = "~";
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
const flat = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9$%']+/g, " ")
    .trim();

/** The captions' words as one text (pure). */
export function srtText(srt: string): string {
  return srt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((b) =>
      b
        .split("\n")
        .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
        .join(" "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The Short's spoken lines: hook, beats, take, loop line. The beats come from the captions, else placeholders (pure). */
export function auditLines(
  row: AuditRow,
  captions?: string,
): { lines: string[]; full: boolean } {
  const known = wc(row.hook) + wc(row.take_narration) + wc(row.loop_line);
  if (captions) {
    const text = captions;
    const f = flat(text);
    const takeHead = flat(row.take_narration).split(" ").slice(0, 6).join(" ");
    const hookWords = wc(row.hook);
    const at = takeHead ? f.indexOf(takeHead) : -1;
    if (at > 0) {
      // Word offset of the take in the captions' flat text, mapped back to the raw words.
      const takeWord = f.slice(0, at).split(" ").filter(Boolean).length;
      const raw = text.split(/\s+/);
      const beats = raw.slice(hookWords, takeWord).join(" ");
      return {
        lines: [row.hook, beats, row.take_narration, row.loop_line],
        full: true,
      };
    }
  }
  const unseen = Math.max(0, row.words - known);
  return {
    lines: [
      row.hook,
      unseen ? Array(unseen).fill(PLACE).join(" ") : "",
      row.take_narration,
      row.loop_line,
    ],
    full: false,
  };
}

/** The stand-in answer for a script with no plan: the take's card text (label dropped) and its last sentence (pure). */
export function proxyAnswer(
  row: Pick<AuditRow, "take_on_screen" | "take_narration">,
): string {
  const card = (row.take_on_screen ?? "").replace(/^[A-Z ]{3,}:\s*/, "");
  const take = row.take_narration.trim().split(/(?<=[.!?])\s+/);
  const last = (take[take.length - 1] ?? "").replace(
    /^(my verdict|pulse check|my pulse check)\s*[:?,]?\s*/i,
    "",
  );
  return `${card}. ${last}`.trim();
}

/** The words title, first frame and hook all share: the subject (the game), which is premise by definition (pure). */
export function subjectWords(
  row: Pick<AuditRow, "title" | "first_frame_text" | "hook">,
): string {
  const t = new Set(contentTokens(row.title));
  const h = new Set(contentTokens(row.hook));
  const f = row.first_frame_text
    ? new Set(contentTokens(row.first_frame_text))
    : undefined;
  return [...t].filter((w) => h.has(w) || f?.has(w)).join(" ");
}

/** One Short against the plan-free rules and the stand-in held-answer rules (pure). */
export function baselineOf(
  row: AuditRow,
  captions: string | undefined,
  previousTakes: string[],
): BaseResult {
  const { lines, full } = auditLines(row, captions);
  const { sentences, total } = spokenSentences(lines.filter(Boolean));
  const notes: string[] = [];
  const takeStart = wc(lines[0]!) + wc(lines[1]!);
  const take_at = total ? takeStart / total : 0;
  const answer = proxyAnswer(row);
  const plan = { question: "", answer };
  const keys = answerKeys(plan, subjectWords(row));
  const rules = {} as Record<BaseRule, Verdict>;
  const leak = (text: string | undefined): Verdict =>
    !text ? "unknown" : leaksAnswer(text, keys, answer) ? "fail" : "pass";
  rules.leak_title = leak(row.title);
  rules.leak_headline = leak(row.first_frame_text);
  rules.leak_hook = leak(row.hook);
  rules.held_take_position = take_at >= heldMark(total) ? "pass" : "fail";
  const early = earlyAnswer(lines.filter(Boolean), plan, subjectWords(row));
  rules.held_early_in_body = early ? "fail" : full ? "pass" : "unknown";
  if (early) notes.push(`early answer: "${early.text}"`);
  // The turn: found, or not found where every word was seen, or not found with unseen words in the middle third.
  const placeIn = (from: number, to: number) =>
    sentences.some(
      (s) =>
        s.text.startsWith(PLACE) &&
        s.start < to * total &&
        s.start + s.words > from * total,
    );
  rules.pivot =
    pivotAt(lines.filter(Boolean)) !== undefined
      ? "pass"
      : placeIn(PIVOT_FROM, PIVOT_TO)
        ? "unknown"
        : "fail";
  const firstTwo = sentences.slice(0, 2);
  rules.side = sideEarly(lines.filter(Boolean))
    ? "pass"
    : firstTwo.some((s) => s.text.startsWith(PLACE))
      ? "unknown"
      : "fail";
  rules.verdict = verdictLate(lines.filter(Boolean)) ? "pass" : "fail";
  const id = stockOpener(row.take_narration);
  rules.opener_rotation = openerProblems(
    row.take_narration,
    previousTakes,
  ).some((p) => /stock opener/.test(p))
    ? "fail"
    : "pass";
  if (id) notes.push(`take opens on stock opener ${id}`);
  rules.stacked_id = openerProblems(row.take_narration, []).some((p) =>
    /stacks/.test(p),
  )
    ? "fail"
    : "pass";
  rules.ending = endingProblems(row.loop_line).length ? "fail" : "pass";
  // Lines before the take that only stall; unseen beats can't be read.
  const teases = teaseFillers(lines.filter(Boolean), undefined, take_at || heldMark(total), subjectWords(row));
  rules.tease_filler = teases.length ? "fail" : full ? "pass" : "unknown";
  for (const t of teases) notes.push(`tease: "${t}"`);
  // The stand-in answer (the take's card and last line) is only an absence: nothing to hold.
  rules.absence_answer = absenceAnswer(answer) ? "fail" : "pass";
  return {
    id: row.episode,
    published: row.published,
    lane: row.lane,
    title: row.title,
    views: row.views,
    full,
    take_at: Number(take_at.toFixed(3)),
    rules,
    notes,
  };
}

/** Every Short the gate would cover, in publish order, measured (pure but for the captions reader). */
export function baseline(
  rows: AuditRow[],
  captionsOf: (id: string) => string | undefined,
): {
  covered: BaseResult[];
  skipped: number;
  counts: Record<BaseRule, Record<Verdict, number>>;
} {
  const shorts = rows.filter((r) => r.lane !== "longform");
  const covered = shorts
    .filter((r) => r.lane === "news" || r.lane === "news_breaking")
    .sort(
      (a, b) =>
        a.published.localeCompare(b.published) ||
        a.episode.localeCompare(b.episode),
    );
  const out: BaseResult[] = [];
  covered.forEach((r, i) => {
    // The newest takes before this one, newest first (the order the factory's recent list has).
    const prev = covered
      .slice(Math.max(0, i - 8), i)
      .reverse()
      .map((x) => x.take_narration);
    out.push(baselineOf(r, captionsOf(r.episode), prev));
  });
  const counts = Object.fromEntries(
    RULES.map((k) => [
      k,
      {
        pass: out.filter((r) => r.rules[k] === "pass").length,
        fail: out.filter((r) => r.rules[k] === "fail").length,
        unknown: out.filter((r) => r.rules[k] === "unknown").length,
      },
    ]),
  ) as Record<BaseRule, Record<Verdict, number>>;
  return { covered: out, skipped: shorts.length - covered.length, counts };
}

// ---------------------------------------------------------------- the rewrite (paid)

interface Row {
  id: string;
  lane: string;
  script_json: Script;
  story_json: any;
}

interface RewriteResult {
  id: string;
  before: {
    lines: string[];
    title: string;
    headline: string;
    findings: PayoffFinding[];
  };
  after?: {
    lines: string[];
    title: string;
    headline: string;
    payoff?: unknown;
    findings: PayoffFinding[];
    read?: PayoffRead;
    clarity?: number;
    fact?: string;
  };
  steps: Array<Record<string, unknown>>;
  error?: string;
}

async function rewrite(inFile: string, outDir: string): Promise<void> {
  const { ScriptSchema, narrationOf, wordCount } =
    await import("../editorial/schema.ts");
  const { scriptPrompt, factCheck, WORDS_MAX } =
    await import("../editorial/editorial.ts");
  const { reviseByEdits } = await import("../editorial/revise.ts");
  const { factDrift, shortText } = await import("../editorial/friendpass.ts");
  const { judgeClarity, shortLines } = await import("../editorial/clarity.ts");
  const { withVoiceTags, createClaude } = await import("../editorial/llm.ts");
  fs.mkdirSync(outDir, { recursive: true });
  process.env.DATA_DIR ||= path.join(outDir, "data");
  let llm;
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
  const gated = ScriptSchema.extend({
    payoff: PayoffSchema,
  }) as unknown as typeof ScriptSchema;
  const ids = flag("--ids")?.split(",").filter(Boolean);
  const rows = (JSON.parse(fs.readFileSync(inFile, "utf8")) as Row[]).filter(
    (r) => !ids || ids.includes(r.id),
  );
  const results: RewriteResult[] = [];
  for (const row of rows) {
    const before = row.script_json;
    const r: RewriteResult = {
      id: row.id,
      before: {
        lines: shortLines(before),
        title: before.youtube.title,
        headline: firstFrameText(before),
        findings: payoffFindings({ script: before, planned: false }).findings,
      },
      steps: [],
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
      const claims = (before.claims ?? [])
        .map((c) => `- ${c.claim}`)
        .join("\n");
      const content = `Sources:\n${items}\n\nFacts the fact check already verified for this story (use only these and the sources):\n${claims}${before.is_rumour ? "\nThis story is NOT confirmed. Keep is_rumour true and attribute every claim." : ""}\n\n${payoffRule()}`;
      const system = scriptPrompt(false, length);
      const revise = async (draft: Script, problems: string[]): Promise<Script> =>
        (await reviseByEdits(llm, {
          site: "proof.write",
          system,
          content,
          schema: gated,
          draft,
          problems,
          job: "payoff proof",
        })) ??
        (await llm.structured({
          site: "proof.write",
          system,
          content: `${content}\n\nA previous draft was rejected. Fix every one of these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nTHE PREVIOUS DRAFT (JSON):\n${JSON.stringify(draft, null, 1)}`,
          schema: gated,
          effort: "medium",
        }));
      const first = [
        ...payoffFeedback(
          payoffFindings({ script: before, planned: true }).findings,
        ),
      ];
      let current: Script = await revise(before, first);
      const drift = factDrift(shortText(before), shortText(current)).filter(
        (p) => !/ drops the /.test(p),
      );
      r.steps.push({ step: "writer under the gate", drift });
      let found = payoffFindings({ script: current, planned: true });
      if (found.findings.length) {
        // "fix": back to the writer once with the reasons, then accepted with a note.
        const again = await revise(current, [
          ...payoffFeedback(found.findings),
          ...drift,
        ]);
        r.steps.push({
          step: "writer again (fix)",
          reasons: found.findings.map((f) => f.rule),
        });
        current = again;
        found = payoffFindings({ script: current, planned: true });
      }
      const read = current.payoff
        ? await readPayoff(llm, {
            title: current.youtube.title,
            firstFrame: firstFrameText(current),
            hook: current.hook,
            question: current.payoff.question,
            answer: current.payoff.answer,
          })
        : undefined;
      const clarity = await judgeClarity(llm, {
        lines: shortLines(current),
        intended: current.point,
        title: current.youtube.title,
      });
      const fact = await factCheck(llm, current, st as never, []);
      r.after = {
        lines: shortLines(current),
        title: current.youtube.title,
        headline: firstFrameText(current),
        payoff: current.payoff,
        findings: [...found.findings, ...(read ? readFindings(read) : [])],
        read,
        clarity: clarity.score,
        fact: `${fact.verdict}${fact.issues.length ? `: ${fact.issues.map((i) => `${i.severity} ${i.problem}`).join("; ")}` : ""}`,
      };
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
    results.push(r);
    fs.writeFileSync(
      path.join(outDir, "payoff-proof.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(`done ${row.id}${r.error ? ` (error: ${r.error})` : ""}`);
  }
  fs.writeFileSync(path.join(outDir, "index.html"), html(results));
  console.log(`wrote ${path.join(outDir, "index.html")}`);
}

const esc = (t: unknown) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function html(results: RewriteResult[]): string {
  const side = (
    h: string,
    x?: {
      lines: string[];
      title: string;
      headline: string;
      findings: PayoffFinding[];
    },
    extra = "",
  ) =>
    x
      ? `<div class="col"><h3>${h}</h3><p><i>Title:</i> ${esc(x.title)}<br><i>First frame:</i> ${esc(x.headline)}</p><ol>${x.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>${extra}<p class="f">${x.findings.length ? x.findings.map((f) => `${esc(f.rule)}: ${esc(f.problem)}`).join("<br>") : "Every rule held."}</p></div>`
      : `<div class="col"><h3>${h}</h3><p>Not produced.</p></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pulse Shorts: held answer, before and after</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;max-width:1300px;margin:auto;padding:24px}section{background:#1b1b1b;border-radius:10px;padding:16px;margin:18px 0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.col{background:#222;border-radius:8px;padding:12px}h3{color:#ff8a3d;font-size:14px}.f{font-size:13px;color:#ffb4a8}</style></head><body>
<h1>Pulse Shorts: held answer, before and after</h1>
${results
  .map(
    (r) =>
      `<section><h2>${esc(r.id)}</h2>${r.error ? `<p>Stopped: ${esc(r.error)}</p>` : ""}<div class="cols">${side("Before (published)", r.before)}${side(
        "After (under the gate)",
        r.after,
        r.after
          ? `<p><i>Plan:</i> ${esc(JSON.stringify(r.after.payoff))}<br><i>Clarity:</i> ${esc(r.after.clarity)}/10 · <i>Fact check:</i> ${esc(r.after.fact)} · <i>Cold read:</i> ${esc(r.after.read?.about)}${r.after.read?.answer_guess ? ` (guessed: ${esc(r.after.read.answer_guess)})` : ""}</p>`
          : "",
      )}</div></section>`,
  )
  .join("\n")}
</body></html>`;
}

// ---------------------------------------------------------------- entry

const isMain = process.argv[1] && /payoff-proof\.ts$/.test(process.argv[1]);
if (isMain) {
  if (args[0] === "--baseline" && args[1]) {
    const rows = JSON.parse(fs.readFileSync(args[1], "utf8")) as AuditRow[];
    const dir = flag("--episodes");
    const captionsOf = (id: string) => {
      if (!dir) return undefined;
      const f = path.join(dir, id, "captions.srt");
      return fs.existsSync(f) ? srtText(fs.readFileSync(f, "utf8")) : undefined;
    };
    const r = baseline(rows, captionsOf);
    const full = r.covered.filter((x) => x.full).length;
    console.log(
      `Covered Shorts (news and breaking): ${r.covered.length}, ${full} with the whole narration from captions; ${r.skipped} other Shorts (rankings, deals, charts) left alone.`,
    );
    for (const k of RULES) {
      const c = r.counts[k];
      console.log(
        `${k.padEnd(20)} fail ${String(c.fail).padStart(3)}  pass ${String(c.pass).padStart(3)}  unknown ${String(c.unknown).padStart(3)}`,
      );
    }
    const out = flag("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  } else if (args[0] === "--rewrite" && args[1] && args[2]) {
    if (!args.includes("--yes-spend")) {
      console.error(
        "The rewrite spends model credit. Add --yes-spend once the owner has approved it.",
      );
      process.exit(2);
    }
    await rewrite(args[1], path.resolve(args[2]));
  } else {
    console.error(
      "usage:\n  payoff-proof.ts --baseline <pulse_videos.json> [--episodes <dir>] [--out <file.json>]\n  payoff-proof.ts --rewrite <episodes.json> <out-dir> --yes-spend [--ids a,b]",
    );
    process.exit(2);
  }
}
