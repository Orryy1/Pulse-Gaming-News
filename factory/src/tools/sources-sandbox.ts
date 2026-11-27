// The primary-sources sandbox (13 Nov 2026): proves the new credit rules on a real documentary without touching the
// factory. It reads a published long video's script, rewrites its opening and its first chapters the way the lane now
// does (cited research with the originals read, the writer under ATTRIBUTION_RULE, the credit check sent back once,
// the fact check against the originals, Wikipedia scrubbed, the friend pass varying what repeats) and writes a JSON
// and an HTML report with before and after counts. Every writer and checker call goes to Codex (the Anthropic API is
// at its limit until 1 Dec): a Codex failure stops the run rather than spending Claude.
//
//   node --import tsx src/tools/sources-sandbox.ts <old-script.json> <plan.json> <out-dir>
//
// plan.json: { "title", "wiki", "angle", "chapters": [{ "chapter_title", "focus" }], "sources": [{ "url", "source" }] }
// Nothing is written to the database, no voice is made and nothing is uploaded.

import fs from "node:fs";
import path from "node:path";
import { createCodexLlm } from "../editorial/codex.ts";
import { withVoiceTags, type Llm } from "../editorial/llm.ts";
import { researchGame, type WikiArticle } from "../discovery/wikipedia.ts";
import { fetchArticle } from "../discovery/article.ts";
import {
  marksIn,
  refMark,
  stripRefMarks,
  type WikiRef,
} from "../discovery/wikirefs.ts";
import {
  DOC_CHAPTER_SOURCE_CHARS,
  DOC_OUTLINE_SOURCE_CHARS,
  checkChapterItems,
  validateBookends,
  validateChapter,
  writeBookends,
  writeChapter,
  type DocChapter,
  type DocChapterPlan,
  type DocOutline,
} from "../editorial/documentary.ts";
import { longRulesFor } from "../editorial/longrules.ts";
import {
  attributionCounts,
  attributionProblems,
  scrubNarration,
  scrubWikipedia,
} from "../editorial/attribution.ts";
import {
  friendChapter,
  friendChapterProblems,
  friendPass,
  newProblems,
} from "../editorial/friendpass.ts";
import { sentencesIn } from "../editorial/voice.ts";

interface Plan {
  title: string;
  wiki: string;
  angle: string;
  year?: number;
  platforms?: string;
  chapters: Array<{ chapter_title: string; focus: string }>;
  sources?: Array<{ url: string; source: string }>;
}

const [oldPath = "", planPath = "", outDir = ""] = process.argv.slice(2);
if (!oldPath || !planPath || !outDir) {
  console.error(
    "usage: sources-sandbox.ts <old-script.json> <plan.json> <out-dir>",
  );
  process.exit(2);
}
const old = JSON.parse(fs.readFileSync(oldPath, "utf8"));
const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- before

/** The old script's opening and chapters, as the voice read them. */
function oldParts(s: any): {
  opening: string;
  chapters: Array<{ title: string; text: string }>;
} {
  const chapters: Array<{ title: string; text: string }> = [];
  for (const b of s.beats ?? []) {
    if (b.visual?.kind === "chapter" || !chapters.length)
      chapters.push({ title: b.visual?.primary ?? "", text: "" });
    chapters[chapters.length - 1]!.text += ` ${b.narration}`;
  }
  return {
    opening: s.hook ?? "",
    chapters: chapters.map((c) => ({ ...c, text: c.text.trim() })),
  };
}
const was = oldParts(old);
const n = plan.chapters.length;
const beforeText = [
  was.opening,
  ...was.chapters.slice(0, n).map((c) => c.text),
].join(" ");
const wholeOld = [
  was.opening,
  ...was.chapters.map((c) => c.text),
  old.pulse_take?.narration ?? "",
].join(" ");

// ---------------------------------------------------------------- Codex only

const noClaude: Llm = {
  async structured() {
    throw new Error(
      "Codex failed and the Anthropic API is not used in this sandbox (at its limit until 1 Dec)",
    );
  },
};
const sites = (process.env.CODEX_CALLS ?? "").trim()
  ? process.env.CODEX_CALLS!.split(",").map((x) => x.trim())
  : ["*"];
// The sandbox routes the writer too: the brief lists every step this run makes.
const llm = withVoiceTags(
  createCodexLlm(noClaude, {
    enabled: true,
    sites: sites.includes("*") ? sites : [...sites, "doc", "friend"],
    timeoutMs: Number(process.env.CODEX_TIMEOUT_MINUTES || 25) * 60_000,
    python: process.env.CODEX_PYTHON || "python",
    runnerDir: process.env.CODEX_RUNNER_DIR || "C:\\Claude\\orchestrator",
    tmpDir: path.join(outDir, "codex-tmp"),
  }),
);

// ---------------------------------------------------------------- research

const read = (url: string) => fetchArticle(url);
async function runSourcesText(): Promise<string> {
  const parts: string[] = [];
  for (const u of plan.sources ?? []) {
    if (/wikipedia\.org/.test(u.url)) continue;
    const a = await read(u.url).catch(() => undefined);
    if (a?.text?.trim())
      parts.push(`[${u.source}] ${a.title}\n${a.text.slice(0, 2500)}`);
  }
  return parts.join("\n\n");
}

const rules = longRulesFor(
  {
    longGuideFormat: true,
    longYouPer1000: 25,
    guideYouPer1000: 35,
    longSentenceGate: 14,
    longHookStack: 5,
    longHookYouMin: 0,
    longOpenLoopsMax: 8,
    loopNamePayoff: true,
    longVerdictStamps: true,
    guideChapterAction: true,
  } as any,
  "documentary",
  true,
);

const plans: DocChapterPlan[] = plan.chapters.map((c) => ({
  chapter_title: c.chapter_title,
  game_title: plan.wiki,
  wiki_title: plan.wiki,
  steam_search_term: "",
  year: plan.year ?? 2026,
  platforms: plan.platforms ?? "PS5, Xbox Series X/S",
  focus: c.focus,
  photo_searches: [],
}));
// The rest of the old video's chapters, so the writer knows what comes later and doesn't take it.
const later = was.chapters.slice(n).map((c) => ({
  chapter_title: c.title,
  game_title: plan.wiki,
  wiki_title: plan.wiki,
  steam_search_term: "",
  year: plan.year ?? 2026,
  platforms: plan.platforms ?? "PS5, Xbox Series X/S",
  focus: c.title,
  photo_searches: [],
}));
const outline = {
  question: plan.title,
  title: plan.title,
  kicker: old.kicker ?? "",
  franchise_wiki_title: plan.wiki,
  chapters: [...plans, ...later],
  open_loops: [],
  youtube: old.youtube ?? { title: plan.title, description: "", tags: [] },
} as unknown as DocOutline;

// ---------------------------------------------------------------- write

interface ChapterRun {
  plan: DocChapterPlan;
  source: WikiArticle;
  chapter: DocChapter;
  attempts: Array<{ problems: string[]; unsupported: string[] }>;
  scrubbed: number;
  friend: { kept: boolean; why: string[] };
  finalCheck: Array<{ quote: string; problem: string }>;
}

const text = (c: DocChapter) => c.paragraphs.map((p) => p.narration).join(" ");

async function main() {
  log("reading the run's own sources");
  const runText = await runSourcesText();
  const runs: ChapterRun[] = [];
  for (const [index, p] of plans.entries()) {
    log(`chapter ${index + 1}: research (cited, originals read)`);
    const article = await researchGame(
      p.wiki_title,
      `${p.game_title} video game`,
      DOC_CHAPTER_SOURCE_CHARS,
      undefined,
      `${p.chapter_title} ${p.focus}`,
      {
        cited: true,
        read,
        primaries: 4,
      },
    );
    if (!article) throw new Error(`no article for ${p.wiki_title}`);
    const source: WikiArticle = runText
      ? { ...article, text: `${article.text}\n\n${runText}` }
      : article;
    log(
      `  ${source.refs?.length ?? 0} references, ${source.primaries?.length ?? 0} originals read: ${(source.primaries ?? []).map((x) => x.outlet).join(", ")}`,
    );
    const earlier = runs.map((r) => ({ plan: r.plan, chapter: r.chapter }));
    const beforeWords = runs.map((r) => text(r.chapter)).join(" ");
    let chapter: DocChapter | undefined;
    let feedback: string[] = [];
    const attempts: ChapterRun["attempts"] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      log(`  write, attempt ${attempt + 1}`);
      chapter = await writeChapter(llm, {
        franchise: plan.wiki,
        plan: p,
        index,
        outline,
        source,
        previousEnding: runs.at(-1)?.chapter.paragraphs.at(-1)?.narration,
        feedback,
        earlier,
        draft: attempt > 0 ? chapter : undefined,
        loops: [],
        rules,
      });
      const problems = validateChapter(chapter, {
        earlier,
        chapter: index + 1,
      });
      // The credit check, once, on the first draft (as the pipeline does).
      if (attempt === 0)
        problems.push(
          ...attributionProblems(text(chapter), { before: beforeWords }),
        );
      log("  fact check against the notes and the originals");
      const items = await checkChapterItems(llm, chapter, source);
      const unsupported = items.map((u) => `"${u.quote}": ${u.problem}`);
      attempts.push({ problems, unsupported });
      feedback = [
        ...problems,
        ...unsupported.map(
          (u) => `Not supported by the source, remove or correct it: ${u}`,
        ),
      ];
      log(
        `  ${problems.length} rule problems, ${unsupported.length} unsupported`,
      );
      if (!feedback.length) break;
    }
    const scrub = scrubNarration(chapter!.paragraphs);
    chapter = { ...chapter!, paragraphs: scrub.lines };
    const credits = attributionProblems(text(chapter), { before: beforeWords });
    log(`  friend pass (${credits.length} credits to vary)`);
    const before = chapter;
    const friend = await friendPass({
      before,
      write: () => friendChapter(llm, before, { tier: "mid", credits }),
      guard: (after) => [
        ...friendChapterProblems(before, after),
        ...newProblems(
          attributionProblems(text(before)),
          attributionProblems(text(after)),
        ),
      ],
      check: async (after) =>
        (await checkChapterItems(llm, after, source)).map(
          (u) => `"${u.quote}": ${u.problem}`,
        ),
    });
    chapter = friend.value;
    log(`  friend pass ${friend.kept ? "kept" : "not kept"}; final fact check`);
    const finalCheck = await checkChapterItems(llm, chapter, source);
    runs.push({
      plan: p,
      source,
      chapter,
      attempts,
      scrubbed: scrub.changed,
      friend: { kept: friend.kept, why: friend.why.slice(0, 4) },
      finalCheck,
    });
    fs.writeFileSync(
      path.join(outDir, `chapter-${index + 1}.json`),
      JSON.stringify(runs.at(-1), null, 1),
    );
  }

  log("opening (intro) from the chapters");
  const notes =
    (
      await researchGame(
        plan.wiki,
        plan.wiki,
        DOC_OUTLINE_SOURCE_CHARS,
        undefined,
        undefined,
        { cited: true },
      )
    )?.text ?? "";
  let bookends = await writeBookends(
    llm,
    outline,
    runs.map((r) => ({ plan: r.plan, chapter: r.chapter })),
    notes,
    { rules },
  );
  const chapterTexts = runs.map((r) => text(r.chapter));
  const bookendProblems = [
    ...validateBookends(bookends, { rules, chapters: chapterTexts }),
    ...attributionProblems(bookends.intro.narration),
  ];
  if (bookendProblems.length) {
    log(`  ${bookendProblems.length} opening problems, one more try`);
    bookends = await writeBookends(
      llm,
      outline,
      runs.map((r) => ({ plan: r.plan, chapter: r.chapter })),
      notes,
      { rules, feedback: bookendProblems },
    );
  }
  const opening = scrubWikipedia(bookends.intro.narration);

  // ---------------------------------------------------------------- the report
  const afterText = [opening, ...chapterTexts].join(" ");
  const countsBefore = attributionCounts(beforeText);
  const countsAfter = attributionCounts(afterText);
  const refsOf = (r: ChapterRun) =>
    new Map((r.source.refs ?? []).map((x) => [x.n, x] as [number, WikiRef]));
  // What Wikipedia was credited for in the old opening and chapters, and the original the notes cite for it.
  const wikiLines = sentencesIn(beforeText).filter((x) => /wikipedia/i.test(x));
  const words = (t: string) =>
    new Set(
      stripRefMarks(t)
        .toLowerCase()
        .split(/[^a-z0-9$%]+/)
        .filter((w) => w.length > 3),
    );
  const replaced = wikiLines.map((line) => {
    const want = words(line.replace(/according to wikipedia,?/i, ""));
    let best: { sentence: string; hit: number; refs: WikiRef[] } | undefined;
    for (const r of runs) {
      const byN = refsOf(r);
      for (const sentence of r.source.text
        .split(/\n/)
        .flatMap((l) => l.split(/(?<=⁾)\s+/))) {
        const marks = marksIn(sentence);
        if (!marks.length) continue;
        let hit = 0;
        for (const w of words(sentence)) if (want.has(w)) hit++;
        if (hit >= 3 && (!best || hit > best.hit))
          best = {
            sentence: stripRefMarks(sentence).slice(0, 240),
            hit,
            refs: marks
              .map((m) => byN.get(m))
              .filter((x): x is WikiRef => Boolean(x)),
          };
      }
    }
    return {
      old: line,
      cited: best?.sentence,
      originals: (best?.refs ?? []).map((x) => ({
        outlet: x.outlet,
        title: x.title,
        url: x.url,
        date: x.date,
      })),
    };
  });
  const report = {
    episode: old.youtube?.title ?? plan.title,
    written_by: "Codex (every writer and checker call); no Anthropic API",
    rules:
      "ATTRIBUTION_RULE in PULSE_FACT_RULES, credit check sent back once, scrubWikipedia, friend pass with ATTRIBUTION_VARY",
    before: {
      scope: `opening + first ${n} chapters (${beforeText.split(/\s+/).length} words)`,
      counts: countsBefore,
      problems: attributionProblems(beforeText),
      whole_video: {
        words: wholeOld.split(/\s+/).length,
        counts: attributionCounts(wholeOld),
        problems: attributionProblems(wholeOld),
      },
    },
    after: {
      scope: `opening + first ${n} chapters (${afterText.split(/\s+/).length} words)`,
      counts: countsAfter,
      problems: attributionProblems(afterText),
    },
    wikipedia_lines_and_their_originals: replaced,
    chapters: runs.map((r, i) => ({
      title: r.plan.chapter_title,
      references_in_notes: r.source.refs?.length ?? 0,
      originals_read: r.source.primaries ?? [],
      attempts: r.attempts,
      wikipedia_scrubbed_lines: r.scrubbed,
      friend_pass: r.friend,
      fact_check: {
        passed: r.finalCheck.length === 0,
        unsupported: r.finalCheck,
      },
      before: was.chapters[i]?.text ?? "",
      after: text(r.chapter),
    })),
    opening: { before: was.opening, after: opening, problems: bookendProblems },
  };
  fs.writeFileSync(
    path.join(outDir, "sources-sandbox.json"),
    JSON.stringify(report, null, 1),
  );
  fs.writeFileSync(path.join(outDir, "sources-sandbox.html"), html(report));
  log("done", path.join(outDir, "sources-sandbox.html"));
}

// ---------------------------------------------------------------- the page

const esc = (t: unknown) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
/** Credits highlighted in a narration, Wikipedia in red. */
function marked(t: string): string {
  return esc(t)
    .replace(/\b(Wikipedia)\b/gi, '<mark class="bad">$1</mark>')
    .replace(
      /\b((?:[Aa]ccording to|told|says|said|reports|reported|confirms|confirmed|put it|measured|lists|in an? (?:\d{4} )?interview with|records show)\b)/g,
      '<mark class="credit">$1</mark>',
    );
}
function html(r: any): string {
  const row = (label: string, b: unknown, a: unknown) =>
    `<tr><td>${esc(label)}</td><td>${esc(b)}</td><td>${esc(a)}</td></tr>`;
  const top = (c: any) =>
    Object.entries(c.byKey as Record<string, number>)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([k, v]) => `${k} ×${v}`)
      .join(", ");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Primary sources, before and after</title>
<style>
body{font:15px/1.5 Inter,system-ui,sans-serif;margin:0;background:#0f1115;color:#e8e6e1}
main{max-width:1180px;margin:0 auto;padding:28px}
h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:32px 0 8px;color:#ffb36b} h3{font-size:15px;margin:18px 0 6px}
.sub{color:#9aa0aa;margin:0 0 20px}
table{border-collapse:collapse;width:100%;margin:8px 0}
td,th{border:1px solid #2a2e36;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#1a1d24}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.box{background:#161920;border:1px solid #2a2e36;border-radius:8px;padding:12px 14px;white-space:pre-wrap}
mark.bad{background:#7a1f1f;color:#fff;padding:0 2px} mark.credit{background:#2b3d5a;color:#fff;padding:0 2px}
.ok{color:#7bd88f} .no{color:#ff7b7b} a{color:#8ab4ff} li{margin:4px 0}
</style></head><body><main>
<h1>Primary sources over Wikipedia: ${esc(r.episode)}</h1>
<p class="sub">${esc(r.written_by)}. Rules: ${esc(r.rules)}.</p>
<h2>Attribution counts</h2>
<table><tr><th></th><th>Before (${esc(r.before.scope)})</th><th>After (${esc(r.after.scope)})</th></tr>
${row('"Wikipedia" said on air', r.before.counts.wikipedia, r.after.counts.wikipedia)}
${row("Credit frames (all)", r.before.counts.frames, r.after.counts.frames)}
${row('"According to" frames', r.before.counts.accordingTo, r.after.counts.accordingTo)}
${row("Most-used frames", top(r.before.counts), top(r.after.counts))}
${row("Credit problems the validator flags", r.before.problems.length, r.after.problems.length)}
</table>
<p>Whole old video (${esc(r.before.whole_video.words)} words): Wikipedia on air ${esc(r.before.whole_video.counts.wikipedia)} times, ${esc(r.before.whole_video.counts.frames)} credit frames, ${esc(r.before.whole_video.counts.accordingTo)} "according to", ${esc(r.before.whole_video.problems.length)} validator flags.</p>
<h3>What the validator flags</h3>
<div class="cols"><div class="box">${r.before.problems.map((x: string) => `• ${esc(x)}`).join("\n") || "none"}</div><div class="box">${r.after.problems.map((x: string) => `• ${esc(x)}`).join("\n") || "none"}</div></div>
<h2>Which originals replaced Wikipedia</h2>
<table><tr><th>Old line (credited to Wikipedia)</th><th>What the article cites for it</th></tr>
${r.wikipedia_lines_and_their_originals
  .map(
    (x: any) =>
      `<tr><td>${marked(x.old)}</td><td>${x.originals.length ? x.originals.map((o: any) => `<a href="${esc(o.url)}">${esc(o.outlet)}</a>${o.title ? `, "${esc(o.title)}"` : ""}${o.date ? ` (${esc(String(o.date).slice(0, 10))})` : ""}`).join("<br>") : "<i>no matching footnote: said plainly or left out</i>"}</td></tr>`,
  )
  .join("\n")}
</table>
${r.chapters
  .map(
    (c: any, i: number) => `<h2>Chapter ${i + 1}: ${esc(c.title)}</h2>
<p>${c.references_in_notes} references in the notes. Originals read and added to the brief: ${c.originals_read.map((o: any) => `<a href="${esc(o.url)}">${esc(o.outlet)}</a>`).join(", ") || "none"}.
Fact check (against the notes and the originals): <b class="${c.fact_check.passed ? "ok" : "no"}">${c.fact_check.passed ? "passed" : `${c.fact_check.unsupported.length} unsupported`}</b>.
Writer attempts: ${c.attempts.length}. Friend pass: ${c.friend_pass.kept ? "kept" : `not kept (${esc(c.friend_pass.why.join("; "))})`}.</p>
${c.fact_check.unsupported.length ? `<ul>${c.fact_check.unsupported.map((u: any) => `<li>${esc(u.quote)}: ${esc(u.problem)}</li>`).join("")}</ul>` : ""}
<div class="cols"><div><h3>Before</h3><div class="box">${marked(c.before)}</div></div><div><h3>After</h3><div class="box">${marked(c.after)}</div></div></div>`,
  )
  .join("\n")}
<h2>Opening</h2>
<div class="cols"><div><h3>Before</h3><div class="box">${marked(r.opening.before)}</div></div><div><h3>After</h3><div class="box">${marked(r.opening.after)}</div></div></div>
</main></body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
