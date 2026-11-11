// Side-by-side: the Short writer, fact check and friend pass on real stories, one model per arm.
// Read-only: no database, nothing published. Usage: node --import tsx fable_ab.mts <items.json> <out dir> <ids,...> <models,...>
process.loadEnvFile("C:/PulseFactory/factory/.env");
import fs from "node:fs";
import path from "node:path";
const F = "file:///C:/PulseFactory/factory/src/";
const { createClaude, withVoiceTags } = await import(F + "editorial/llm.ts");
const { writeScript, factCheck, validateScript, WORDS_MIN, WORDS_MAX } =
  await import(F + "editorial/editorial.ts");
const { narrationOf } = await import(F + "editorial/schema.ts");
const { fetchArticle } = await import(F + "discovery/article.ts");
const {
  friendPass,
  friendShort,
  friendShortProblems,
  newProblems,
  friendCheckVerdict,
  shortText,
} = await import(F + "editorial/friendpass.ts");
const { PERSONAL_VOICE } = await import(F + "pipeline.ts");

const [ITEMS, OUT, IDS, MODELS] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(ITEMS, "utf8"));
const ids = IDS.split(",");
const models = MODELS.split(",");
fs.mkdirSync(OUT, { recursive: true });

for (const id of ids) {
  const ep = all.find((e: any) => e.id === id);
  const cluster = ep.story_json;
  const artFile = path.join(OUT, `${id}.articles.json`);
  let articles: any[];
  if (fs.existsSync(artFile))
    articles = JSON.parse(fs.readFileSync(artFile, "utf8"));
  else {
    const items = [...cluster.items]
      .sort(
        (a: any, b: any) =>
          (a.sourceKind === "official" ? -1 : 1) -
          (b.sourceKind === "official" ? -1 : 1),
      )
      .slice(0, 4);
    articles = (
      await Promise.all(
        items.map((i: any) => fetchArticle(i.url).catch(() => undefined)),
      )
    ).filter(Boolean);
    fs.writeFileSync(artFile, JSON.stringify(articles));
  }
  const mustLabelRumour = !cluster.corroborated;
  await Promise.all(
    models.map(async (model) => {
      const outFile = path.join(OUT, `${id}.${model}.json`);
      if (fs.existsSync(outFile)) return;
      const llm = withVoiceTags(
        createClaude({
          top: model,
          mid: "claude-sonnet-5-5",
          low: "claude-haiku-5-5",
        }),
      );
      const t0 = Date.now();
      let script: any,
        check: any,
        feedback: string[] | undefined,
        attempts = 0;
      const log: any[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts++;
        script = await writeScript(llm, cluster, articles, {
          desk: false,
          variantNote: PERSONAL_VOICE,
          lessons: "",
          mustLabelRumour,
          feedback,
          draft: attempt > 0 ? script : undefined,
          segment: false,
          noSeriesFollow: true,
        });
        const problems = validateScript(script);
        check = await factCheck(llm, script, cluster, articles);
        const blockers = check.issues
          .filter((i: any) => i.severity === "blocker")
          .map((i: any) => `Fact-check: "${i.quote}" - ${i.problem}`);
        log.push({ attempt, problems, blockers, verdict: check.verdict });
        if (
          check.verdict === "pass" &&
          check.rumour_labelling_ok &&
          !blockers.length &&
          !problems.length
        )
          break;
        feedback = [...blockers, ...problems];
      }
      const draftText = narrationOf(script);
      let friendKept = false,
        friendWhy: string[] = [];
      if (
        check.verdict === "pass" &&
        check.rumour_labelling_ok &&
        !check.issues.some((i: any) => i.severity === "blocker")
      ) {
        const before = script;
        const beforeProblems = validateScript(before);
        let afterCheck: any;
        const friend = await friendPass({
          before,
          write: () =>
            friendShort(llm, before, {
              endStatement: true,
              wordsMin: WORDS_MIN,
              wordsMax: WORDS_MAX,
            }),
          guard: (after: any) => [
            ...friendShortProblems(before, after, {
              wordsMin: WORDS_MIN,
              wordsMax: WORDS_MAX,
            }),
            ...newProblems(beforeProblems, validateScript(after)),
          ],
          check: async (after: any) => {
            const v = friendCheckVerdict(
              await factCheck(llm, after, cluster, articles),
              shortText(before),
            );
            afterCheck = v.check;
            return v.blockers;
          },
        });
        friendKept = friend.kept;
        friendWhy = friend.why;
        if (friend.kept && afterCheck) {
          script = friend.value;
          check = afterCheck;
        }
      }
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          {
            id,
            model,
            secs: Math.round((Date.now() - t0) / 1000),
            attempts,
            log,
            friendKept,
            friendWhy,
            finalPass:
              check.verdict === "pass" &&
              check.rumour_labelling_ok &&
              !check.issues.some((i: any) => i.severity === "blocker"),
            problems: validateScript(script),
            draftText,
            text: narrationOf(script),
            title: script.youtube?.title,
            headline: script.headline,
            script,
            check,
          },
          null,
          1,
        ),
      );
      console.log(
        id,
        model,
        "done",
        Math.round((Date.now() - t0) / 1000),
        "s attempts",
        attempts,
        "friend",
        friendKept,
      );
    }),
  ).catch((e) => console.log(id, "ERROR", String(e).slice(0, 400)));
}
