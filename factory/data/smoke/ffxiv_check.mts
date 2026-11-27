// FFXIV repair, step 1: the new chapter text against every deterministic check, then the fact check on the real
// sources (one Claude call a chapter, no Codex). Writes nothing. Usage: node --import tsx data/smoke/ffxiv_check.mts <new_chapters.json> <ep.json> [--factcheck]
process.env.PULSE_ENV_FILE = "C:/PulseFactory/factory/.env";
Object.assign(process.env, { CODEX_LLM: "false", DATA_DIR: process.argv[4] ?? "./data/smoke/_nowhere" });
import fs from "node:fs";
const { validateChapter, checkChapterItems, groundCallouts, DOC_WIDE_SOURCE_CHARS } = await import("../../src/editorial/documentary.ts");
const { writerNoteHits } = await import("../../src/editorial/writernotes.ts");
const { researchGame, mergeArticles } = await import("../../src/discovery/wikipedia.ts");
const [file, epFile] = process.argv.slice(2);
const fresh = JSON.parse(fs.readFileSync(file!, "utf8"));
const ep = JSON.parse(fs.readFileSync(epFile!, "utf8"));
const s = ep.script_json;
// The chapters as they stand, by the chapter cards.
const starts = s.beats.flatMap((b: any, i: number) => (b.visual?.kind === "chapter" ? [i] : []));
const chapterOf = (c: number) => s.beats.slice(starts[c], starts[c + 1] ?? s.beats.length).map((b: any) => ({ narration: b.narration, callout: { kind: "none", primary: "", secondary: "" }, footage: b.footage }));
const paragraphs = (c: number) => fresh[String(c)]?.paragraphs ?? chapterOf(c);
const asChapter = (c: number) => ({ paragraphs: paragraphs(c), claims: [] });
for (const c of [4, 5]) {
  const earlier = Array.from({ length: c }, (_, i) => asChapter(i));
  const problems = validateChapter(asChapter(c) as never, { earlier: earlier as never, chapter: c + 1 });
  const words = paragraphs(c).reduce((n: number, p: any) => n + p.narration.trim().split(/\s+/).length, 0);
  console.log(`chapter ${c}: ${words} words; writer's notes: ${writerNoteHits(paragraphs(c).map((p: any) => p.narration).join(" ")).length}; problems: ${problems.length}`);
  for (const p of problems) console.log("  -", p.slice(0, 300));
  // A later chapter must not now repeat these.
  for (const later of [6, 7, 8]) {
    const again = validateChapter(asChapter(later) as never, { earlier: [asChapter(c)] as never }).filter((p: string) => /repeats wording/.test(p));
    for (const p of again) console.log(`  later chapter ${later}:`, p.slice(0, 200));
  }
}
const wider = mergeArticles(
  (await Promise.all(["Final Fantasy XIV (2010 video game)", "Final Fantasy XIV"].map((t) => researchGame(t, t, 60000)))).filter(Boolean) as never,
)!;
console.log("source characters", wider.text.length, "also", wider.also);
for (const c of [4, 5]) {
  const g = groundCallouts(asChapter(c) as never, wider);
  console.log(`chapter ${c} callouts removed:`, g.removed);
}
if (process.argv.includes("--factcheck")) {
  const { loadConfig } = await import("../../src/config.ts");
  const { createServices } = await import("../../src/services.ts"); const { openDb, migrate } = await import("../../src/db.ts");
  const cfg = loadConfig();
  const db = await openDb(cfg.databaseUrl, cfg.dataDir); await migrate(db); const llm = createServices(db, cfg).llm;
  for (const c of [4, 5]) {
    const items = await checkChapterItems(llm as never, asChapter(c) as never, wider);
    console.log(`chapter ${c} fact check: ${items.length} disputed`);
    for (const u of items) console.log("  -", u.quote, "=>", u.problem);
  }
}
