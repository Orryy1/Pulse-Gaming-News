// Blind judge for the writer side-by-side, plus a planted-error test of each model's fact check.
// Usage: node --import tsx fable_judge.mts <items.json> <out dir> <ids,...> <models,...>
process.loadEnvFile("C:/PulseFactory/factory/.env");
import fs from "node:fs";
import path from "node:path";
const { z } =
  await import("file:///C:/PulseFactory/factory/node_modules/zod/index.js");
const F = "file:///C:/PulseFactory/factory/src/";
const { createClaude } = await import(F + "editorial/llm.ts");
const { factCheck } = await import(F + "editorial/editorial.ts");

const [ITEMS, OUT, IDS, MODELS] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(ITEMS, "utf8"));
const ids = IDS.split(",");
const models = MODELS.split(",");
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const metrics = (t: string) => {
  const w = words(t);
  const sent = t.split(/[.!?]+\s/).filter((s) => s.trim());
  const per100 = (re: RegExp) =>
    +((100 * (t.match(re) || []).length) / Math.max(1, w.length)).toFixed(1);
  return {
    words: w.length,
    wordsPerSentence: +(w.length / Math.max(1, sent.length)).toFixed(1),
    you: per100(/\byou(r|'re|'ll|'d)?\b/gi),
    i: per100(/\b(I|I'm|I'd|I've|I'll|my)\b/g),
  };
};
const Verdict = z.object({
  ranking: z.array(z.string()).describe("Labels best first"),
  scores: z.array(
    z.object({
      label: z.string(),
      hook: z.number(),
      voice: z.number(),
      clarity: z.number(),
      accuracy_risk: z.number(),
      overall: z.number(),
    }),
  ),
  reason: z.string(),
});
const judges = ["claude-sonnet-5-5", "claude-opus-5-5"];
const results: any[] = [];
for (const id of ids) {
  const ep = all.find((e: any) => e.id === id);
  const articles = JSON.parse(
    fs.readFileSync(path.join(OUT, `${id}.articles.json`), "utf8"),
  );
  const arms = models.map((m) =>
    JSON.parse(fs.readFileSync(path.join(OUT, `${id}.${m}.json`), "utf8")),
  );
  const order = [...arms].sort(() => Math.random() - 0.5);
  const labels = order.map((_, i) => String.fromCharCode(65 + i));
  const sources = articles
    .map((a: any) => `${a.title}\n${a.text.slice(0, 3000)}`)
    .join("\n---\n");
  const row: any = { id, title: ep.script_json?.youtube?.title, arms: {} };
  for (const a of arms)
    row.arms[a.model] = {
      ...metrics(a.text),
      finalPass: a.finalPass,
      attempts: a.attempts,
      friendKept: a.friendKept,
      problems: a.problems.length,
      secs: a.secs,
      judge: [] as number[],
    };
  for (const j of judges) {
    const llm = createClaude({ top: j });
    const v = await llm.structured({
      system: `You judge YouTube Shorts scripts for Pulse Gaming, a gaming news channel whose voice is the viewer's friend: a flat verdict with one owned first-person line, "you" often, short sentences, no hype, no invented facts. Score each 1-10 (accuracy_risk: 10 means no risk). Judge only the text; you do not know who wrote which.`,
      content: `Sources:\n${sources}\n\n${order.map((a, i) => `Script ${labels[i]}\nTitle: ${a.title}\nOn-screen headline: ${a.headline}\nSpoken: ${a.text}`).join("\n\n")}`,
      schema: Verdict,
      effort: "medium",
      maxTokens: 6000,
    });
    for (const s of v.scores) {
      const arm = order[labels.indexOf(s.label)];
      if (arm) row.arms[arm.model].judge.push(s.overall);
    }
    row[`reason_${j}`] = v.reason;
  }
  // Planted error: the Opus final script with one figure changed; does each model's check block it?
  const base = arms.find((a) => a.model === "claude-opus-5-5") ?? arms[0];
  const s = JSON.parse(JSON.stringify(base.script));
  const plant = (str: string) =>
    str.replace(/\d[\d,.]*/, (n) =>
      String(Math.round(parseFloat(n.replace(/,/g, "")) * 3 + 7)),
    );
  let planted = "";
  for (const b of s.beats) {
    const t = plant(b.narration ?? b.text ?? "");
    if (t !== (b.narration ?? b.text)) {
      planted = t;
      if (b.narration !== undefined) b.narration = t;
      else b.text = t;
      break;
    }
  }
  row.planted = planted;
  for (const m of models) {
    if (!planted) break;
    const c = await factCheck(
      createClaude({ top: m }),
      s,
      ep.story_json,
      articles,
    );
    row.arms[m].caughtPlant =
      c.verdict !== "pass" ||
      c.issues.some((i: any) => i.severity === "blocker");
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(
  path.join(OUT, "judge.json"),
  JSON.stringify(results, null, 1),
);
