// The long-video proof (18 Nov 2026, top creator gap plan gaps 3 and 4): measures finished long videos under
// LONG_OPENING_CONTRACT and LONG_ARGUES, and optionally shows what the writers would do with the rules.
//
// Free by default: the deterministic checks on each stored script (opening, question, finish line, length, takes,
// hand-overs, a ranking's "I", verdicts, invitation, unequal time and thumbnail) and the plan's two speeds (the stored
// plan and, with --replan, today's planner with and without the two-speed opening). No model is called.
//
// With --llm it rewrites ONLY each documentary's opening (cold open to the first chapter) with its finish line, and a
// ranking's intro, thumbnail words and first three entries, under the "fix" rules, with one send-back each like the
// factory; then measures before and after. It spends real Claude credit (about $0.10 to $0.25 a video on the default
// models; it stops before a call once --max-usd is spent, default 3) and prints the spend. No voice, no render, nothing
// written to any database.
//
//   node --import tsx src/tools/longform-proof.ts <episode.json>... --out=<dir> [--replan] [--llm] [--max-usd=3]
//
// episode.json: a row of the episodes table ({ id, script_json, assets_json, factcheck_json }), exported from a COPY of
// the database, never the live one.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  createClaude,
  tapUsage,
  type Llm,
  type UsageLine,
} from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import { voiceFor } from "../editorial/voice.ts";
import { sentencesOf } from "../editorial/longform.ts";
import { findPayoff, findPlant } from "../editorial/openloops.ts";
import {
  FINISH_LINE_RULE,
  contractOpeningRule,
  contractReport,
  isBuyerGuide,
  longDocOfScript,
  type ContractReport,
  type LongDoc,
  type LongDocKind,
} from "../editorial/longcontract.ts";
import {
  ARGUES_PLAN_RULE,
  arguesEntryRule,
  entryWordRange,
  iPer1000,
  inviteProblems,
  rankingReport,
  thumbVerdictProblems,
} from "../editorial/argues.ts";
import { arguesEntryProblems } from "../editorial/longform.ts";
import { openingPace, type OpeningPace } from "../render/structure.ts";
import type { LongPlan } from "../render/longplan.ts";

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const files = args.filter((a) => !a.startsWith("--"));
const outDir = path.resolve(flag("out") ?? "longform-proof");
const useLlm = args.includes("--llm");
const replanOn = args.includes("--replan");
const maxUsd = Number(flag("max-usd") ?? 3);
if (!files.length) {
  console.error(
    "usage: longform-proof.ts <episode.json>... --out=<dir> [--replan] [--llm] [--max-usd=3]",
  );
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
// Any usage log this run writes stays beside its results, never in the factory's own data folder.
process.env.DATA_DIR ||= path.join(outDir, "data");

// ---------------------------------------------------------------- spend

// $ per million tokens, as src/editorial/llm.ts prices them: input, output, cache read, cache write.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 8],
  "claude-sonnet-5-5": [2, 10, 0.2, 4],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.2],
};
let spent = 0;
const calls: UsageLine[] = [];
tapUsage((line) => {
  const [i, o, cr, cw] = PRICES[line.model] ?? PRICES["claude-opus-5-5"]!;
  spent +=
    (line.in * i + line.out * o + line.cacheRead * cr + line.cacheWrite * cw) /
    1e6;
  calls.push(line);
});

/** The model, behind the budget: a call that would start past it is refused. */
function budgeted(llm: Llm): Llm {
  return {
    async structured(o) {
      if (spent >= maxUsd)
        throw new Error(`budget of $${maxUsd} spent ($${spent.toFixed(2)})`);
      return llm.structured(o);
    },
  };
}

// ---------------------------------------------------------------- reading an episode

interface Row {
  id: string;
  script_json: Script;
  assets_json?: {
    words?: Array<{ start: number }>;
    longPlan?: LongPlan;
    durationSeconds?: number;
  } & Record<string, unknown>;
  factcheck_json?: {
    topic?: {
      format?: string;
      kind?: string;
      angle?: string;
      title_idea?: string;
    };
  } & Record<string, unknown>;
}

function kindOf(r: Row): LongDocKind {
  const s = r.script_json;
  if (s.beats.some((b) => b.visual?.kind === "rank")) return "ranking";
  const f = r.factcheck_json?.topic?.format;
  return f === "guide" ? "guide" : f === "claims" ? "claims" : "documentary";
}

const wc = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const first = (t: string, n = 60) =>
  t.trim().split(/\s+/).slice(0, n).join(" ");

// ---------------------------------------------------------------- the plan's two speeds

async function replanPaces(
  r: Row,
): Promise<{ today?: OpeningPace; twoSpeed?: OpeningPace; error?: string }> {
  try {
    const {
      buildLongPlan,
      momentKeys,
      openChaptersAtBreaks,
      LONG_TAIL_SECONDS,
    } = await import("../render/longplan.ts");
    const { buildSegments } = await import("../render/timeline.ts");
    const { segmentInputs, variantOf, chapterSentences } =
      await import("../pipeline.ts");
    const s = r.script_json as any;
    const a = r.assets_json as any;
    const words = a.words ?? [];
    const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
    const segments = openChaptersAtBreaks(
      buildSegments(segmentInputs(s, Boolean(a.desk)), words, duration),
      a.breaks,
    );
    const moments = [...(s.entries ?? [])]
      .sort((x: any, y: any) => y.rank - x.rank)
      .map((e: any) => e.moments ?? []);
    const doc = s.evergreen_format === "documentary";
    const input = {
      segments,
      words,
      durationSeconds: duration,
      images: (a.images ?? []).map((i: any) => ({
        kind: i.kind,
        aspect: i.aspect,
        beatIndex: i.beatIndex,
        moment: i.moment,
        file: i.file,
      })),
      clips: (a.clips ?? []).map((c: any) => ({
        durationSeconds: c.durationSeconds,
        beatIndex: c.beatIndex,
        role: c.role,
        moment: c.moment,
        span: c.span,
      })),
      noRepeats: true,
      variant: variantOf(r.id),
      realPinnedOnly: true,
      momentCounts: moments.map((m: any[]) => m.length),
      momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
      momentFillers: moments.map((e: any[]) => e.map((m: any) => m.filler)),
      momentShows: moments.map((e: any[], i: number) => {
        const said = chapterSentences(s, i);
        return e.map(
          (m: any, k: number) =>
            `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`,
        );
      }),
      takeEntry: s.take_entry,
      rhythm: true,
      entryPace: !doc,
      bookend: true,
      coldOpenFrames: 90,
      movingFirst: true,
      clipRemainders: true,
    };
    return {
      today: openingPace(buildLongPlan(input)),
      twoSpeed: openingPace(buildLongPlan({ ...input, twoSpeed: true })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- the rewrites (--llm)

const OpeningSchema = z.object({
  intro: z
    .string()
    .describe(
      "The new opening, spoken words only, from the first line to the hand-over into chapter 1",
    ),
  finish_line: z.object({
    question: z
      .string()
      .describe(
        "The one question the video drives towards, 5-16 words, ending in a question mark",
      ),
    payoff: z
      .string()
      .describe(
        "The sentence, from the last chapter or a new last line of the outro, that answers it",
      ),
  }),
});
type Opening = z.infer<typeof OpeningSchema>;

function openingDoc(d: LongDoc, o: Opening): LongDoc {
  const hook = sentencesOf(o.intro);
  const lastIdx = d.chapters.length - 1;
  const lastSentences = sentencesOf(d.chapters[lastIdx]?.text ?? "");
  let at = findPayoff(o.finish_line.question, lastSentences);
  const chapters = d.chapters.map((c) => ({ ...c }));
  if (at < 0) {
    // A payoff the writer added as the outro's new last line: it becomes the last chapter's last sentence here.
    chapters[lastIdx] = {
      ...chapters[lastIdx]!,
      text: `${chapters[lastIdx]!.text} ${o.finish_line.payoff}`,
    };
    at = lastSentences.length;
  }
  const plant = Math.max(0, findPlant(o.finish_line.question, hook, true));
  return {
    ...d,
    hook: o.intro,
    chapters,
    times: undefined,
    loops: [
      {
        question: o.finish_line.question,
        plant: { entry: -1, moment: plant },
        payoff: { entry: lastIdx, moment: at },
        finish: true,
      },
    ],
  };
}

async function rewriteOpening(
  llm: Llm,
  r: Row,
  d: LongDoc,
): Promise<{ opening?: Opening; after?: ContractReport; error?: string }> {
  const title = d.title;
  const system = `${voiceFor("documentary")}

You rewrite only the opening of a finished long documentary: from its first line to the hand-over into chapter 1. Every fact comes from the opening and chapter notes given; never invent a quote, number or event.
${contractOpeningRule({ title, buyer: isBuyerGuide(title, d.kind) })}
${FINISH_LINE_RULE.replace('mark exactly one of the open loops with "finish_line": true. It is', "name in finish_line")} Give the sentence that answers it in the last chapter, copied from its text, or, if no sentence there answers it, one new last line for the outro.`;
  const digest = d.chapters
    .map((c, i) => {
      const s = sentencesOf(c.text);
      return `${i + 1}. ${c.title}: ${[...s.slice(0, 2), s.at(-1) ?? ""].join(" ")}`;
    })
    .join("\n");
  const content = `Title: ${title}\nWhat it answers: ${r.factcheck_json?.topic?.angle ?? title}\n\nThe opening as published:\n${d.hook}\n\nChapters (first lines and last line):\n${digest}\n\nThe last chapter in full:\n${d.chapters.at(-1)?.text ?? ""}\n\nThe outro:\n${d.outro}`;
  try {
    let o = await llm.structured({
      site: "proof.opening",
      system,
      content,
      schema: OpeningSchema,
      effort: "medium",
      maxTokens: 4000,
    });
    let after = contractReport(openingDoc(d, o));
    const misses = after.problems.filter(
      (p) => !/^Chapter \d+ has|hand over on the same/.test(p),
    );
    if (misses.length) {
      o = await llm.structured({
        site: "proof.opening",
        system,
        content: `${content}\n\nYour draft:\n${JSON.stringify(o)}\n\nIt was sent back for these problems; fix every one:\n${misses.map((m) => `- ${m}`).join("\n")}`,
        schema: OpeningSchema,
        effort: "medium",
        maxTokens: 4000,
      });
      after = contractReport(openingDoc(d, o));
    }
    return { opening: o, after };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const RankingSchema = z.object({
  intro: z.string().describe("The new intro, spoken words only"),
  thumb_text: z
    .string()
    .describe("1-4 words in capitals that show the verdict"),
  entries: z
    .array(z.object({ title: z.string(), narration: z.string() }))
    .describe(
      "The first three entries spoken (the lowest ranks), rewritten, in the order given",
    ),
});
type RankingRewrite = z.infer<typeof RankingSchema>;

function rankingProblems(d: LongDoc, w: RankingRewrite): string[] {
  const titles = d.chapters.map((c) => c.title);
  return [
    ...inviteProblems(w.intro, titles),
    ...thumbVerdictProblems(w.thumb_text, d.title, titles),
    ...w.entries.flatMap((e, i) =>
      arguesEntryProblems(
        e.narration,
        e.title,
        entryWordRange(i, d.chapters.length),
      ),
    ),
  ];
}

async function rewriteRanking(
  llm: Llm,
  d: LongDoc,
): Promise<{ rewrite?: RankingRewrite; problems?: string[]; error?: string }> {
  const n = d.chapters.length;
  const three = d.chapters.slice(0, 3);
  const system = `${voiceFor("longform")}

You rewrite part of a finished long ranking under new rules: the intro, the thumbnail words and the first three entries spoken (the lowest ranks). Keep every fact as it is in the text given; never invent a number, a date or a quote. Keep each game where it is.
${ARGUES_PLAN_RULE}
${three.map((c, i) => `Entry ${i + 1} (${c.title}): ${arguesEntryRule(entryWordRange(i, n))}`).join("\n")}`;
  const content = `Title: ${d.title}\nThe full order, lowest first:\n${d.chapters.map((c, i) => `${n - i}. ${c.title}`).join("\n")}\n\nThe intro as published:\n${d.hook}\n\nThumbnail words as published: ${d.thumbText ?? "(none)"}\n\nThe first three entries as published:\n${three.map((c) => `${c.title}:\n${c.text}`).join("\n\n")}`;
  try {
    let w = await llm.structured({
      site: "proof.ranking",
      system,
      content,
      schema: RankingSchema,
      effort: "medium",
      maxTokens: 6000,
    });
    let problems = rankingProblems(d, w);
    if (problems.length) {
      w = await llm.structured({
        site: "proof.ranking",
        system,
        content: `${content}\n\nYour draft:\n${JSON.stringify(w)}\n\nIt was sent back for these problems; fix every one:\n${problems.map((m) => `- ${m}`).join("\n")}`,
        schema: RankingSchema,
        effort: "medium",
        maxTokens: 6000,
      });
      problems = rankingProblems(d, w);
    }
    return { rewrite: w, problems };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- run

const llm = useLlm
  ? budgeted(
      createClaude({
        top: process.env.CLAUDE_MODEL || "claude-opus-5-5",
        mid: process.env.CLAUDE_MODEL_MID || "claude-sonnet-5-5",
      }),
    )
  : undefined;
const results: Array<Record<string, unknown>> = [];

for (const file of files) {
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as Row;
  const kind = kindOf(r);
  const d = longDocOfScript(r.script_json, {
    kind,
    words: r.assets_json?.words,
  });
  const all = [d.hook, ...d.chapters.map((c) => c.text), d.outro].join(" ");
  const contract = contractReport(d);
  const ranking = kind === "ranking" ? rankingReport(d) : undefined;
  const stored = r.assets_json?.longPlan
    ? openingPace(r.assets_json.longPlan)
    : undefined;
  const replan =
    replanOn && r.assets_json?.longPlan ? await replanPaces(r) : undefined;
  const out: Record<string, unknown> = {
    id: r.id,
    title: d.title,
    kind,
    words: wc(all),
    iPer1000: Math.round(iPer1000(all) * 10) / 10,
    contract,
    ...(ranking ? { ranking } : {}),
    pace: { stored, ...(replan ?? {}) },
    opening: first(d.hook),
  };
  console.log(`\n${r.id}  ${d.title}  (${kind})`);
  console.log(`  opening, first 60 words: ${first(d.hook)}`);
  console.log(
    `  opening ${contract.measures.hookWords} words; question at word ${contract.measures.questionAtWords ?? "never"}; first chapter at ${contract.measures.firstChapterSeconds} s; "I" ${out.iPer1000} per 1,000 words`,
  );
  if (stored)
    console.log(
      `  stored plan: ${stored.openingPerMinute} cuts/min in the first 2 min against ${stored.bodyPerMinute} after (x${stored.ratio}), longest opening shot ${stored.longestOpeningSeconds} s`,
    );
  if (replan?.today)
    console.log(
      `  today's planner ${replan.today.openingPerMinute}/${replan.today.bodyPerMinute} (x${replan.today.ratio}); with two speeds ${replan.twoSpeed!.openingPerMinute}/${replan.twoSpeed!.bodyPerMinute} (x${replan.twoSpeed!.ratio}), longest ${replan.twoSpeed!.longestOpeningSeconds} s`,
    );
  if (replan?.error) console.log(`  replan failed: ${replan.error}`);
  console.log(`  contract: ${contract.pass ? "PASS" : "FAIL"}`);
  for (const p of contract.problems) console.log(`   - ${p}`);
  if (ranking) {
    console.log(
      `  argues: ${ranking.pass ? "PASS" : "FAIL"} (entries ${ranking.measures.entrySeconds.join(", ")} s; verdicts ${ranking.measures.verdictEntries}/${ranking.measures.entries})`,
    );
    for (const p of ranking.problems) console.log(`   - ${p}`);
  }
  if (llm) {
    if (kind === "ranking") {
      const w = await rewriteRanking(llm, d);
      out.rewrite = w;
      if (w.rewrite) {
        console.log(`  AFTER intro: ${first(w.rewrite.intro)}`);
        console.log(`  AFTER thumbnail: ${w.rewrite.thumb_text}`);
        for (const e of w.rewrite.entries)
          console.log(
            `  AFTER ${e.title} verdict: ${sentencesOf(e.narration).slice(-2).join(" ")}`,
          );
        console.log(
          `  still missing: ${w.problems?.length ? w.problems.join(" | ") : "nothing"}`,
        );
      } else console.log(`  rewrite failed: ${w.error}`);
    } else {
      const w = await rewriteOpening(llm, r, d);
      out.rewrite = w;
      if (w.opening) {
        console.log(`  AFTER opening: ${first(w.opening.intro)}`);
        console.log(
          `  AFTER finish line: ${w.opening.finish_line.question} / paid: ${w.opening.finish_line.payoff}`,
        );
        console.log(
          `  still missing: ${w.after?.problems.filter((p) => !/^Chapter \d+ has|same feeling/.test(p)).join(" | ") || "nothing"}`,
        );
      } else console.log(`  rewrite failed: ${w.error}`);
    }
  }
  results.push(out);
}

const summary = {
  spentUsd: Math.round(spent * 100) / 100,
  calls: calls.length,
  maxUsd,
  results,
};
fs.writeFileSync(
  path.join(outDir, "longform-proof.json"),
  JSON.stringify(summary, null, 1),
);
console.log(
  `\nmodel calls: ${calls.length}, spend: $${spent.toFixed(2)}${useLlm ? ` (budget $${maxUsd})` : " (no model used)"}`,
);
console.log(`results: ${path.join(outDir, "longform-proof.json")}`);
