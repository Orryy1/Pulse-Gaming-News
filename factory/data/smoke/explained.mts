// "The week's biggest gaming story, explained", proved on a database COPY, offline (1 Nov 2026):
// 1. this week's story ranked from the copy's own data (news Shorts, clusters, breaking scores, our Shorts'
//    views and retention; the YouTube demand check reads only the copy's 24-hour cache, so offline every story
//    is "unknown", the neutral half score), with every story's scoring line;
// 2. the weekly shape test's arm for the next weekly slot, from the copy's own record;
// 3. the explainer written through the real step (src/explainedstep.ts) with a STUB writer: no model call, no
//    network. The packaging, chapters, bookends and shot list are built from the sources by rules below, so
//    the words are placeholders; the outline (the fixed five-part shape), the grounding, the documentary
//    conversion and the checks are the real ones. The episode goes into the copy only.
// Usage: node --import tsx data/smoke/explained.mts [db copy dir] [out json]
import fs from "node:fs";
import { createEmbeddedDb } from "../../src/db.ts";
import { testConfig } from "../../tests/helpers.ts";
import type { Llm } from "../../src/editorial/llm.ts";
import type { Services } from "../../src/pipeline.ts";
import { getEpisode } from "../../src/episodes.ts";
import { chooseWeekStory, selectExplainedEpisode, stepScriptExplained } from "../../src/explainedstep.ts";
import { scoreLine, EXPLAINED_PARTS } from "../../src/editorial/explained.ts";
import { nextArm, readWeeklyState, ARM_LABEL } from "../../src/weeklytest.ts";
import { dayKey, localTime } from "../../src/lanes.ts";

const dbDir = process.argv[2] ?? "data/smoke/dbcopy/db";
const outJson = process.argv[3] ?? "data/smoke/explained_out.json";
const db = await createEmbeddedDb(dbDir);
const now = new Date("2026-11-01T14:00:00Z"); // Sunday 1 Nov, 14:00 London
const tz = "Europe/London";
const cfg = testConfig("/tmp", { weeklyExplainedTest: true, recapLong: true, longformEnabled: true, demandCheck: false, timezone: tz });

console.log("1. This week's stories (7 days to Sunday 1 Nov 14:00), best first:");
const { pick, ranked } = await chooseWeekStory({ db, cfg }, now);
for (const r of ranked.slice(0, 12))
  console.log(`   ${r === pick ? "PICK " : "     "}${r.story.headline.slice(0, 78)}\n          ${scoreLine(r)}`);
console.log(`   ${ranked.length} stories in all; ${ranked.filter((r) => r.score.excluded).length} skipped.`);

console.log("\n2. The weekly shape test on the copy:");
const st = await readWeeklyState(db);
console.log(`   record: ${st.since ? `started ${st.since}, ${st.entries.length} weeks` : "not started (the first weekly slot after the merge starts it)"}`);
console.log(`   next weekly slot runs: ${ARM_LABEL[nextArm(st.entries)]}`);

if (!pick) {
  console.log("   no story qualifies: the round-up would run.");
  process.exit(0);
}

// ---- 3. the stub writer ----------------------------------------------------------------------------
const sentencesOf = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"])/).filter((x) => x.split(" ").length >= 6);
let source = "";
const stub: Llm = {
  async structured(o: any) {
    const site: string = o.site ?? "";
    const text = typeof o.content === "string" ? o.content : "";
    if (site !== "doc.check" && text.includes("SOURCES:")) source = text.split("SOURCES:\n")[1] ?? source;
    const pool = sentencesOf(source.replace(/\[[^\]]+\]/g, " "));
    const take = (n: number, from: number) => Array.from({ length: n }, (_, i) => pool[(from + i) % Math.max(1, pool.length)] ?? "The sources say little more.");
    if (site === "doc.explained.package") {
      const g = (text.match(/Game or company: ([^\n]+)/)?.[1] ?? "the story").trim();
      return {
        question: `What really happened to ${g}?`,
        title: `What Really Happened to ${g}`,
        kicker: "The story behind the headlines",
        chapter_titles: ["The Announcement", "Behind the Decision", "What Players Lose", "What Comes Next"],
        youtube: {
          title: `What Really Happened to ${g}`.slice(0, 69),
          thumb_text: "THE REAL REASON",
          description: `The biggest gaming story of the past few days, explained: what happened to ${g}, why, what it means for players and what to watch next.`,
          tags: [g],
        },
      };
    }
    if (site === "doc.explained.chapter") {
      const i = Number(text.match(/(\d)\. [^\n]*<- this chapter/)?.[1] ?? 1) - 1;
      const paras = Array.from({ length: 5 }, (_, k) => ({
        narration: take(4, i * 20 + k * 4).join(" "),
        callout: { kind: "none", primary: "", secondary: "" },
        footage: { want: "gameplay", keywords: ["gameplay"] },
      }));
      return { paragraphs: paras, claims: take(3, i * 7).map((c) => ({ claim: c.slice(0, 120), section: "Eurogamer" })) };
    }
    if (site === "doc.check") return { unsupported: [] };
    if (site === "doc.shots") {
      const n = Number(text.match(/Return exactly (\d+) moments/)?.[1] ?? 1);
      const passage = pool.find((p) => p.split(" ").length >= 14 && p.split(" ").length <= 50) ?? "";
      return {
        moments: Array.from({ length: n }, (_, k) => ({
          show: "the game's key art",
          keywords: ["gameplay"],
          broll: k === 5 ? "server room" : "",
          graphic:
            k === 2 && passage
              ? { kind: "source", primary: passage, secondary: "", items: [passage.split(" ").slice(2, 6).join(" ")] }
              : k === 4
                ? { kind: "headline", primary: (pool[1] ?? "").split(" ").slice(0, 9).join(" ").replace(/[.,;]$/, ""), secondary: "", items: [] }
                : { kind: "none", primary: "", secondary: "", items: [] },
          emphasis: "",
          person: "",
        })),
      };
    }
    if (site === "doc.explained.bookends")
      return {
        intro: { narration: take(7, 3).join(" "), on_screen: "The story behind the headlines" },
        outro: { label: "WHAT TO WATCH", narration: take(6, 9).join(" "), on_screen: "What to watch next" },
      };
    throw new Error(`stub writer has no answer for ${site}`);
  },
};
const notices: string[] = [];
const s = {
  db,
  cfg,
  llm: stub,
  now: () => now,
  notify: async (m: { content?: string }) => void notices.push(m.content ?? ""),
  fetchArticle: async () => undefined, // offline: the step writes from the cluster summaries and our Shorts
  research: async () => undefined,
} as unknown as Services;
const today = dayKey(now, tz);
const made = await selectExplainedEpisode(s, now, localTime(today, "20:00", tz), today);
console.log(`\n3. Selected on the copy: ${made.id ?? made.reason}`);
const ep = await getEpisode(db, made.id!);
await stepScriptExplained(s, ep!, (ep!.factcheck_json as any).story, { segmentInputs: () => [] });
const done = await getEpisode(db, made.id!);
const sc = done!.script_json!;
const fc = done!.factcheck_json as any;
console.log(`   status ${done!.status}; ${sc.evergreen_format}, explained=${sc.explained}, rumour=${sc.is_rumour}`);
console.log(`   YouTube title: ${sc.youtube.title}`);
console.log(`   chapters: ${sc.beats.filter((b) => b.visual.kind === "chapter").map((b, i) => `${i + 1}. ${b.visual.primary} (${EXPLAINED_PARTS[i]!.label})`).join(" | ")}`);
console.log(`   words ${fc.words} (stub text); evidence on screen: ${sc.entries!.flatMap((e) => e.moments ?? []).filter((m) => m.graphic.kind !== "none").map((m) => m.graphic.kind).join(", ")}`);
console.log(`   warnings: ${fc.warnings.length} (the stub's placeholder words, as expected), e.g. ${fc.warnings.slice(0, 2).join(" / ")}`);
console.log(`   notices: ${notices.map((n) => n.split("\n")[0]).join(" || ")}`);
fs.writeFileSync(outJson, JSON.stringify({ id: made.id, script: sc, ranked: ranked.slice(0, 12).map((r) => ({ headline: r.story.headline, line: scoreLine(r) })) }, null, 1));
console.log(`   script written to ${outJson}`);
await db.close();
