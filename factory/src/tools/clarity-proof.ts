// The clarity proof (13 Nov 2026): rewrites real Shorts the way the factory now writes them and scores both versions
// with a separate blind judge, so the owner can hear the difference before anything is deployed. For each episode it
// takes the published script, has the news writer revise it under the new rules (the house checks plus a first cold
// read as feedback, the facts held by the friend pass's guard in place of a fact check against sources this tool
// doesn't have), runs the new friend pass and then the clarity gate, and finally asks a blind judge, which never sees
// which version is which, to score each one on its own. Every call goes to Codex (the Anthropic API is at its limit
// until 1 Dec): a Codex failure stops that episode rather than spending Claude.
//
//   node --import tsx src/tools/clarity-proof.ts <episodes.json> <out-dir>
//   node --import tsx src/tools/clarity-proof.ts --report <out-dir> <results.json>...
//
// episodes.json: rows of { id, lane, script_json, story_json } (the episodes table, or /admin/export). Nothing is
// written to the database, no voice is made and nothing is uploaded.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createCodexLlm } from "../editorial/codex.ts";
import { withVoiceTags, type Llm } from "../editorial/llm.ts";
import {
  ScriptSchema,
  narrationOf,
  wordCount,
  type Script,
} from "../editorial/schema.ts";
import {
  scriptPrompt,
  validateScript,
  WORDS_MAX,
  type ScriptLength,
} from "../editorial/editorial.ts";
import { reviseByEdits } from "../editorial/revise.ts";
import {
  pulseCheckProblems,
  pulseCheckRule,
  PULSE_CHECK_LABEL,
} from "../editorial/newssegment.ts";
import {
  ENDING_RULE,
  ENDING_RULE_FOLLOW,
  STAKE_RULE,
  endingProblems,
  videoPlugProblems,
} from "../editorial/shortrules.ts";
import { whyBrief, whyFollowProblems } from "../editorial/why.ts";
import {
  factDrift,
  friendShort,
  friendShortProblems,
  newProblems,
  shortText,
} from "../editorial/friendpass.ts";
import {
  clarityGate,
  clarityNotes,
  clarityRewriteShort,
  clarityShortProblems,
  judgeClarity,
  shortLines,
  type ClarityOutcome,
} from "../editorial/clarity.ts";
import { PERSONAL_VOICE } from "../pipeline.ts";

const [, , inFile, outArg] = process.argv;
if (!inFile || !outArg) {
  console.error("usage: clarity-proof.ts <episodes.json> <out-dir>");
  process.exit(2);
}
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
process.env.DATA_DIR ||= path.join(outDir, "data");

const noClaude: Llm = {
  async structured() {
    throw new Error(
      "Codex failed and the Anthropic API is not used here (at its limit until 1 Dec)",
    );
  },
};
const llm = withVoiceTags(
  createCodexLlm(noClaude, {
    enabled: true,
    sites: ["*"],
    timeoutMs: Number(process.env.CODEX_TIMEOUT_MINUTES || 25) * 60_000,
    python: process.env.CODEX_PYTHON || "python",
    runnerDir: process.env.CODEX_RUNNER_DIR || "C:\\Claude\\orchestrator",
    tmpDir: path.join(outDir, "codex-tmp"),
  }),
);

// ---------------------------------------------------------------- the blind judge (not the gate's judge)

const BlindSchema = z.object({
  point: z
    .string()
    .describe(
      "What this Short is telling you, in one sentence, as you'd tell a friend",
    ),
  point_stated: z
    .boolean()
    .describe(
      "True when the Short itself says that point plainly somewhere, not just hints at it",
    ),
  clarity: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("1 lost, 10 every line clear and following the last"),
  non_sequiturs: z
    .array(
      z.object({
        line: z.string().describe("The line, copied exactly"),
        why: z.string().describe("Why it doesn't follow, in a few words"),
      }),
    )
    .describe(
      "Lines that don't follow from what came before, or that you can't make sense of",
    ),
  natural_pronouns: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "How natural the 'you/your' and 'I' sound: 10 like a person talking, 1 forced into odd places",
    ),
  pronoun_notes: z
    .string()
    .describe(
      "Any 'you', 'your' or 'I' that sounds forced, quoted; empty if none",
    ),
});
type Blind = z.infer<typeof BlindSchema>;

const BLIND_PROMPT = `You review short-form video scripts for a media company. You will get the narration of one 30-60 second gaming Short, the words exactly as a voice reads them. Imagine hearing it once while scrolling, with no other context.

Score it honestly and on its own; you are not comparing it with anything:
- point: what is this Short telling you? One sentence.
- point_stated: does the Short actually say that point plainly, or do you have to piece it together?
- clarity: 1-10. Does every line follow from the one before? Would a casual gamer understand it on one hearing?
- non_sequiturs: every line that doesn't follow, or that you can't make sense of (a joke or metaphor whose link you have to guess counts).
- natural_pronouns: 1-10. Do "you", "your" and "I" sit where a person would say them, or are they forced into odd places ("your East Coast unlock")?
Be strict and specific. Plain is fine; plain is not a fault.`;

async function blind(s: Script): Promise<Blind> {
  return llm.structured({
    site: "clarity.blind",
    tier: "mid",
    effort: "medium",
    system: BLIND_PROMPT,
    content: `NARRATION:\n${shortLines(s).join("\n")}`,
    schema: BlindSchema,
  });
}

// ---------------------------------------------------------------- the factory's steps, without the database

interface Row {
  id: string;
  lane: string;
  script_json: Script & {
    claims?: Array<{ claim: string; source_url?: string }>;
  };
  story_json: any;
}

const strip = (s: Script): Script => {
  const { voice_tags: _t, ...rest } = s as Script & { voice_tags?: unknown };
  return rest as Script;
};

function briefFor(row: Row, segment: boolean): string {
  const st = row.story_json ?? {};
  const items = (st.items ?? [])
    .map(
      (i: any, n: number) =>
        `<source index="${n}" outlet="${i.source}" url="${i.url}">\n<headline>${i.title}</headline>\n<body>${i.summary || "(headline only)"}</body>\n</source>`,
    )
    .join("\n");
  const claims = (row.script_json.claims ?? [])
    .map((c) => `- ${c.claim}${c.source_url ? ` (${c.source_url})` : ""}`)
    .join("\n");
  const why = st.why
    ? `\n\n${whyBrief(st.why.question, st.why.angle, st.why.follow, true)}`
    : "";
  return `Sources:\n${items}\n\nFacts the fact check already verified for this story (use only these and the sources):\n${claims}${row.script_json.is_rumour ? "\nThis story is NOT confirmed. Keep is_rumour true and attribute every claim." : ""}${why}\n\n${STAKE_RULE}\n\n${ENDING_RULE} ${ENDING_RULE_FOLLOW}\n\n${PERSONAL_VOICE}${segment ? `\n\n${pulseCheckRule()}` : ""}`;
}

function lengthFor(s: Script): ScriptLength {
  const n = wordCount(narrationOf(s));
  return {
    seconds: { min: 25, max: 60 },
    wordsMin: Math.round(n * 0.8),
    wordsMax: Math.max(WORDS_MAX, Math.round(n * 1.12)),
    beatsMax: Math.max(4, s.beats.length),
  };
}

function house(
  s: Script,
  row: Row,
  segment: boolean,
  length: ScriptLength,
): string[] {
  return [
    ...validateScript(s, undefined, length),
    ...(segment ? pulseCheckProblems(s) : []),
    ...videoPlugProblems(narrationOf(s)),
    ...endingProblems(s.loop_line),
    ...(row.story_json?.why
      ? whyFollowProblems(s.loop_line, row.story_json.why.follow, true)
      : []),
  ];
}

/** Facts a rewrite may not add; dropping a weaker figure or name is a fair edit, adding one is not. */
// A figure or name the verified claims or the sources already carry is not new (the stand-in for the fact check).
const ADDED = /^The rewrite adds the (?:figure|name) (.+)\.$/;
const addsFacts = (before: Script, after: Script, row: Row) => {
  const known = [
    ...(row.script_json.claims ?? []).map((c) => c.claim),
    ...(row.story_json?.items ?? []).map(
      (i: any) => `${i.title} ${i.summary ?? ""}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
  return factDrift(shortText(before), shortText(after)).filter((p) => {
    if (/ drops the (figure|name) /.test(p)) return false;
    const m = p.match(ADDED);
    return (
      !m || !m[1]!.split(", ").every((x) => known.includes(x.toLowerCase()))
    );
  });
};

interface Result {
  id: string;
  lane: string;
  segment: boolean;
  before: { lines: string[]; words: number; blind?: Blind };
  after?: {
    lines: string[];
    words: number;
    point?: string;
    blind?: Blind;
    on_screen: string;
  };
  steps: Array<Record<string, unknown>>;
  gate?: Pick<ClarityOutcome<Script>, "steps"> & {
    first?: number;
    last?: number;
    point?: string;
  };
  house_before: string[];
  house_after?: string[];
  error?: string;
}

async function prove(row: Row): Promise<Result> {
  const before = strip(row.script_json);
  const length = lengthFor(before);
  // The Pulse Check ran on the news Shorts whose take carried its label (the argument test's half has no labelled take).
  const segment = before.pulse_take.label.toUpperCase() === PULSE_CHECK_LABEL;
  const r: Result = {
    id: row.id,
    lane: row.lane,
    segment,
    before: {
      lines: shortLines(before),
      words: wordCount(narrationOf(before)),
    },
    steps: [],
    house_before: house(before, row, segment, length),
  };
  try {
    // 1. The writer revises under the new rules: the house checks it now fails plus a first cold read.
    const first = await judgeClarity(llm, {
      lines: shortLines(before),
      title: before.youtube.title,
    });
    r.steps.push({
      step: "first read",
      score: first.score,
      point: first.point,
      flagged: first.issues,
    });
    const problems = [
      ...r.house_before,
      ...clarityNotes(first),
      `Fill in "point": the Short's one point in one plain sentence.`,
      ...(segment && before.pulse_take.label.toUpperCase() !== PULSE_CHECK_LABEL
        ? [
            `Set pulse_take.label to "${PULSE_CHECK_LABEL}" and start pulse_take.on_screen with the reading.`,
          ]
        : []),
    ];
    const system = scriptPrompt(false, length);
    const content = briefFor(row, segment);
    let written =
      (await reviseByEdits(llm, {
        site: "proof.write",
        system,
        content,
        schema: ScriptSchema,
        draft: before,
        problems,
        job: "clarity proof",
      })) ??
      (await llm.structured({
        site: "proof.write",
        system,
        content: `${content}\n\nA previous draft was rejected. Fix every one of these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nTHE PREVIOUS DRAFT (JSON):\n${JSON.stringify(before, null, 1)}`,
        schema: ScriptSchema,
        effort: "medium",
      }));
    written = strip(written);
    const added = addsFacts(before, written, row);
    r.steps.push({
      step: "writer (new rules)",
      kept: !added.length,
      why: added,
      text: shortText(written),
    });
    let current = added.length ? before : written;

    // 2. The new friend pass on the settled script.
    try {
      const friend = strip(
        await friendShort(llm, current, {
          tier: "top",
          segment,
          endStatement: true,
          wordsMin: length.wordsMin,
          wordsMax: length.wordsMax,
        }),
      );
      const why = [
        ...friendShortProblems(current, friend, length),
        ...newProblems(
          house(current, row, segment, length),
          house(friend, row, segment, length),
        ),
      ];
      r.steps.push({
        step: "friend pass",
        kept: !why.length,
        why,
        text: shortText(friend),
      });
      if (!why.length) current = friend;
    } catch (err) {
      r.steps.push({ step: "friend pass", kept: false, why: [String(err)] });
    }

    // 3. The clarity gate: cold read, rewrite what is flagged (plainly if still under 8).
    const gate = await clarityGate<Script>({
      value: current,
      judge: (v) =>
        judgeClarity(llm, {
          lines: shortLines(v),
          intended: v.point,
          title: v.youtube.title,
        }),
      rewrite: (v, j, plain) =>
        clarityRewriteShort(llm, v, j, { plain, wordsMax: length.wordsMax }),
      accept: async (b, a) => [
        ...clarityShortProblems(b, a, length),
        ...newProblems(
          house(b, row, segment, length),
          house(a, row, segment, length),
        ),
      ],
    });
    current = gate.value;
    r.gate = {
      steps: gate.steps,
      first: gate.first?.score,
      last: gate.last?.score,
      point: gate.last?.point,
    };
    r.after = {
      lines: shortLines(current),
      words: wordCount(narrationOf(current)),
      point: current.point,
      on_screen: current.pulse_take.on_screen,
    };
    r.house_after = house(current, row, segment, length);

    // 4. The blind judge, each version on its own, in random order.
    const order =
      Math.random() < 0.5 ? ["before", "after"] : ["after", "before"];
    for (const which of order) {
      if (which === "before") r.before.blind = await blind(before);
      else r.after.blind = await blind(current);
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

// ---------------------------------------------------------------- the report

const esc = (t: unknown) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function scoreBox(b?: Blind): string {
  if (!b) return `<div class="scores">not scored</div>`;
  return `<div class="scores"><span>Clarity <b>${b.clarity}</b>/10</span><span>Point stated <b>${b.point_stated ? "yes" : "no"}</b></span><span>Non-sequiturs <b>${b.non_sequiturs.length}</b></span><span>Natural pronouns <b>${b.natural_pronouns}</b>/10</span></div>
<p class="point"><i>Judge heard:</i> ${esc(b.point)}</p>${
    b.non_sequiturs.length
      ? `<ul class="flags">${b.non_sequiturs.map((n) => `<li>"${esc(n.line)}": ${esc(n.why)}</li>`).join("")}</ul>`
      : ""
  }${b.pronoun_notes ? `<p class="pron"><i>Pronouns:</i> ${esc(b.pronoun_notes)}</p>` : ""}`;
}

function html(results: Result[]): string {
  const ok = results.filter((r) => r.before.blind && r.after?.blind);
  const avg = (f: (r: Result) => number) =>
    ok.length ? (ok.reduce((a, r) => a + f(r), 0) / ok.length).toFixed(1) : "-";
  const cards = results
    .map(
      (r) =>
        `<section><h2>${esc(r.id)} <small>${esc(r.lane)}${r.segment ? " · Pulse Check" : ""}</small></h2>${
          r.error ? `<p class="err">Stopped: ${esc(r.error)}</p>` : ""
        }<div class="cols"><div class="col"><h3>Before (live, ${r.before.words} words)</h3><ol>${r.before.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>${scoreBox(r.before.blind)}</div><div class="col"><h3>After (${r.after?.words ?? "-"} words)</h3>${
          r.after
            ? `<p class="intended"><i>Intended point:</i> ${esc(r.after.point)}</p><ol>${r.after.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol><p class="card"><i>Card:</i> ${esc(r.after.on_screen)}</p>${scoreBox(r.after.blind)}`
            : ""
        }</div></div><details><summary>How it got there</summary><ul>${r.steps
          .map(
            (s) =>
              `<li><b>${esc(s.step)}</b>${s.score !== undefined ? ` score ${esc(s.score)}` : ""}${s.kept !== undefined ? ` ${s.kept ? "kept" : "not kept"}` : ""}${Array.isArray(s.why) && s.why.length ? `: ${esc((s.why as string[]).join("; "))}` : ""}</li>`,
          )
          .join(
            "",
          )}${r.gate ? `<li><b>clarity gate</b> ${esc(r.gate.first)} → ${esc(r.gate.last)}: ${esc(r.gate.steps.map((s) => `${s.step}${s.score !== undefined ? ` ${s.score}` : ""}${s.kept !== undefined ? (s.kept ? " kept" : " not kept") : ""}`).join(", "))}</li>` : ""}</ul></details></section>`,
    )
    .join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pulse Shorts: clarity before and after (13 Nov 2026)</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px;max-width:1300px;margin:auto}h1{font-size:22px}section{background:#1b1b1b;border-radius:10px;padding:16px;margin:18px 0}h2{font-size:16px;margin:0 0 8px}small{color:#999;font-weight:400}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.col{background:#222;border-radius:8px;padding:12px}h3{font-size:14px;margin:0 0 6px;color:#ff8a3d}ol{padding-left:20px;margin:6px 0}li{margin:3px 0}.scores{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0;font-size:13px}.scores span{background:#333;padding:3px 8px;border-radius:5px}.flags{color:#ffb4a8;font-size:13px}.point,.intended,.card,.pron{font-size:13px;color:#ccc}.err{color:#ff6b6b}table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid #333;text-align:left}details{margin-top:8px;font-size:13px;color:#bbb}</style></head><body>
<h1>Pulse Shorts: clarity before and after (13 Nov 2026)</h1>
<p>Eight real Shorts from 12-13 Nov, the live narration on the left and the same story under the new rules on the right (the news writer's revision, the new friend pass, then the clarity gate). Every call went to Codex. A separate blind judge scored each version on its own, never knowing which was which.</p>
<table><tr><th></th><th>Before</th><th>After</th></tr>
<tr><td>Clarity (1-10, average)</td><td>${avg((r) => r.before.blind!.clarity)}</td><td>${avg((r) => r.after!.blind!.clarity)}</td></tr>
<tr><td>Point stated plainly</td><td>${ok.filter((r) => r.before.blind!.point_stated).length}/${ok.length}</td><td>${ok.filter((r) => r.after!.blind!.point_stated).length}/${ok.length}</td></tr>
<tr><td>Non-sequiturs (total)</td><td>${ok.reduce((a, r) => a + r.before.blind!.non_sequiturs.length, 0)}</td><td>${ok.reduce((a, r) => a + r.after!.blind!.non_sequiturs.length, 0)}</td></tr>
<tr><td>Natural pronouns (1-10, average)</td><td>${avg((r) => r.before.blind!.natural_pronouns)}</td><td>${avg((r) => r.after!.blind!.natural_pronouns)}</td></tr></table>
${cards}
</body></html>`;
}

// --report <out-dir> <results.json>...: merge earlier results (a later file replaces an episode it repeats) and write
// the report again, so one episode can be rerun after a Codex timeout without rerunning the rest.
if (inFile === "--report") {
  const byId = new Map<string, Result>();
  for (const f of process.argv.slice(4))
    for (const r of JSON.parse(fs.readFileSync(f, "utf8")) as Result[]) if (r) byId.set(r.id, r);
  const merged = [...byId.values()];
  fs.writeFileSync(path.join(outDir, "clarity-proof.json"), JSON.stringify(merged, null, 2));
  fs.writeFileSync(path.join(outDir, "index.html"), html(merged));
  console.log(`wrote ${path.join(outDir, "index.html")}`);
  process.exit(0);
}
const rows: Row[] = JSON.parse(fs.readFileSync(inFile, "utf8"));
const results: Result[] = new Array(rows.length);
const CONCURRENCY = Number(process.env.PROOF_CONCURRENCY || 4);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      const i = next++;
      const row = rows[i]!;
      console.log(`start ${row.id}`);
      results[i] = await prove(row);
      console.log(
        `done ${row.id}${results[i]!.error ? ` (error: ${results[i]!.error})` : ""}`,
      );
      fs.writeFileSync(
        path.join(outDir, "clarity-proof.json"),
        JSON.stringify(results.filter(Boolean), null, 2),
      );
    }
  }),
);
fs.writeFileSync(
  path.join(outDir, "clarity-proof.json"),
  JSON.stringify(results, null, 2),
);
fs.writeFileSync(path.join(outDir, "index.html"), html(results));
console.log(`wrote ${path.join(outDir, "index.html")}`);
