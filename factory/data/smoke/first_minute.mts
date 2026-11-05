// The first minute of real long videos against the audit's ask ("you", a named promise, no date opener), on a copy of
// the database. No voice is ever made. Reads for free; --write also rewrites the opening of the listed documentaries
// with the Inspiration settings on, from their own published chapters (one or two writer calls each):
//   node --import tsx data/smoke/first_minute.mts <db copy> [--write ep_a,ep_b]
import { PGlite } from "@electric-sql/pglite";
import { loadConfig } from "../../src/config.ts";
import { createServices } from "../../src/services.ts";
import type { Db } from "../../src/db.ts";
import type { Script } from "../../src/editorial/schema.ts";
import {
  validateBookends,
  writeBookends,
} from "../../src/editorial/documentary.ts";
import {
  hookStackProblems,
  longRulesFor,
  scriptMeasures,
  youPer1000,
} from "../../src/editorial/longrules.ts";

const pg = new PGlite(process.argv[2]!);
const db = {
  query: async <T,>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  exec: async (sql: string) => void (await pg.exec(sql)),
  close: () => pg.close(),
} as Db;
const writeIdx = process.argv.indexOf("--write");
const toWrite = writeIdx > 0 ? process.argv[writeIdx + 1]!.split(",") : [];
const rows = await db.query<{
  id: string;
  script_json: Script;
  f: string;
  views: number;
}>(
  `SELECT e.id, e.script_json, e.script_json->>'evergreen_format' f FROM episodes e WHERE lane='longform' AND status='published' ORDER BY created_at DESC`,
);
const firstMinute = (intro: string, more: string, words = 165) =>
  `${intro} ${more}`.trim().split(/\s+/).slice(0, words).join(" ");
const DATE =
  /\b(?:1[89]|20)\d\d\b|\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/;
const measure = (intro: string, more: string, chapters: string[]) => {
  const fm = firstMinute(intro, more);
  const sentence = (intro.match(/[^.!?]+[.!?]/) ?? [intro])[0]!.trim();
  return {
    first_sentence: sentence.slice(0, 110),
    date_opener: DATE.test(sentence),
    you_first_minute: (
      fm.match(/\b(you|your|you're|you'll|yours|yourself)\b/gi) ?? []
    ).length,
    you_per_1000_whole: Math.round(
      youPer1000([intro, more, ...chapters].join(" ")),
    ),
    hook_problems: hookStackProblems(intro, undefined, 5, chapters).filter(
      (p) => !p.startsWith("Fill"),
    ).length,
  };
};
const chaptersOf = (sc: Script) => {
  const by: string[][] = [];
  for (const b of sc.beats) {
    if (b.visual?.kind === "chapter" || !by.length) by.push([]);
    by[by.length - 1]!.push(b.narration);
  }
  return by.map((c) => c.join(" "));
};
for (const r of rows) {
  const sc = r.script_json;
  const chapters = chaptersOf(sc);
  const m = scriptMeasures([sc.hook, ...chapters].join(" "));
  console.log(
    JSON.stringify({
      ep: r.id,
      title: sc.youtube.title,
      format: r.f,
      ...measure(sc.hook, chapters[0] ?? "", chapters),
      sentence_mean: m.sentenceMean,
    }),
  );
}
if (toWrite.length) {
  process.loadEnvFile("C:/PulseFactory/factory/.env");
  const cfg = {
    ...loadConfig(),
    dryRun: true,
    longYouPer1000: 25,
    guideYouPer1000: 35,
    longSentenceGate: 14,
    longHookStack: 5,
    longHookYouMin: 6,
    longOpenLoopsMax: 8,
    loopNamePayoff: true,
    longVerdictStamps: true,
    longGuideFormat: true,
    guideChapterAction: true,
  };
  const s = createServices(db, cfg);
  for (const id of toWrite) {
    const r = rows.find((x) => x.id === id)!;
    const sc = r.script_json;
    const texts = chaptersOf(sc);
    const rules = longRulesFor(cfg, "documentary", false);
    // The published chapters, in the shape the writer's digest reads: claims from the script's own claim list.
    const perChapter = texts.map((text, i) => {
      const entry = sc.entries?.[i];
      return {
        plan: {
          chapter_title:
            (
              sc.beats.filter((b) => b.visual?.kind === "chapter")[i]
                ?.visual as { primary?: string }
            )?.primary ?? `Chapter ${i + 1}`,
          game_title: entry?.game_title ?? sc.game_title,
          year: entry?.year ?? 0,
        },
        chapter: {
          paragraphs: [{ narration: text }],
          claims: (text.match(/[^.!?]+[.!?]/g) ?? [])
            .filter((x) => /\d|[A-Z][a-z]+ [A-Z]/.test(x))
            .slice(0, 6)
            .map((claim) => ({ claim: claim.trim() })),
        },
      };
    });
    const outline = { title: sc.youtube.title, question: sc.headline } as never;
    const ends = { rules, chapters: texts };
    let b = await writeBookends(s.llm, outline, perChapter as never, "", ends);
    let problems = validateBookends(b, ends);
    let attempts = 1;
    if (problems.length) {
      b = await writeBookends(s.llm, outline, perChapter as never, "", {
        ...ends,
        feedback: problems,
      });
      problems = validateBookends(b, ends);
      attempts = 2;
    }
    console.log(
      JSON.stringify({
        ep: id,
        with_settings: true,
        attempts,
        ...measure(b.intro.narration, texts[0] ?? "", texts),
        named_surprises: b.intro.hook_stack?.surprises.length ?? 0,
        saved_promise: b.intro.hook_stack?.saved?.tease,
        problems_left: problems,
      }),
    );
    console.log("OPENING:", b.intro.narration);
  }
}
await pg.close();
process.exit(0);
