// The blind writer test: can Codex (the owner's ChatGPT plan) write a news Short as well as Claude? From a
// database COPY it takes the most recent published news Shorts, rebuilds the inputs the factory gave the
// writer (the story cluster, its source articles fetched again by URL, the stored Steam facts, the earlier
// Shorts' shapes, the lessons and the retention-test rules as of that day) and runs the factory's own
// writeScript twice with identical inputs: once through Claude (the live tier) and once through Codex at
// kind "frontier". Two judges then read each pair blind, in a random A/B order: Claude on the top tier and
// Codex at kind "review", each scoring the factory's own criteria and naming a preference. Everything is
// written to data/smoke/codex_blind_out/<stamp>/ (not committed) and a table is printed.
//
// Usage (from factory/, never against the live data/db):
//   node --import tsx data/smoke/codex_blind.mts [--db data/smoke/dbcopy/db] [--n 6] [--cap 1.50] [--vision]
// --vision adds one side-by-side of the graphics vision check (src/qa/vision.ts) on real frames.
// Claude spend is estimated before any call and the run aborts over the cap; the actual spend is printed.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const DB_DIR = flag("db", "data/smoke/dbcopy/db");
const N = Number(flag("n", "6"));
const CAP = Number(flag("cap", "1.50"));
const VISION = args.includes("--vision");
const CONCURRENCY = Number(flag("concurrency", "3"));
const LIVE_EPISODES = "C:/PulseFactory/factory/data/episodes";

// The live install's Claude key, read only (nothing else is taken from it); the usage log goes to our own folder.
const OUT_ROOT = path.resolve("data/smoke/codex_blind_out");
process.env.DATA_DIR = OUT_ROOT;
if (!process.env.ANTHROPIC_API_KEY) {
  const envFile = "C:/PulseFactory/factory/.env";
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID|CLAUDE_MODEL|CLAUDE_MODEL_MID|CLAUDE_MODEL_LOW)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
  }
}

const { createClaude, claudeSpend } = await import("../../src/editorial/llm.ts");
const { createCodexLlm, runCodex, strictJsonSchema, dropNulls, extractJson } = await import("../../src/editorial/codex.ts");
const { writeScript, validateScript, scriptPrompt } = await import("../../src/editorial/editorial.ts");
const { narrationOf, wordCount } = await import("../../src/editorial/schema.ts");
const { factsText } = await import("../../src/assets/steam.ts");
const { fetchArticle } = await import("../../src/discovery/article.ts");
const { hookLessons, socialLessons } = await import("../../src/analytics.ts");
const { growthDefaults, growthNotes } = await import("../../src/growth.ts");
const { segmentInputs } = await import("../../src/pipeline.ts");
const { visionQa } = await import("../../src/qa/vision.ts");
const { FFMPEG } = await import("../../src/lib/bin.ts");
type Script = import("../../src/editorial/schema.ts").Script;
type RecentShapes = import("../../src/editorial/editorial.ts").RecentShapes;
type Db = import("../../src/db.ts").Db;
type Llm = import("../../src/editorial/llm.ts").Llm;

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join(OUT_ROOT, stamp);
fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(OUT, "tmp");
fs.mkdirSync(TMP, { recursive: true });
const save = (name: string, data: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));

// ------------------------------------------------------------------ the database copy
const pgl = new PGlite(DB_DIR);
const db = {
  query: async <T,>(sql: string, params: unknown[] = []) => (await pgl.query(sql, params)).rows as T[],
  exec: async (sql: string) => {
    await pgl.exec(sql);
  },
  snapshot: async () => Buffer.alloc(0),
  close: async () => pgl.close(),
} as unknown as Db;

interface Row {
  id: string;
  lane: string;
  created_at: string;
  publish_at: string | null;
  youtube_video_id: string | null;
  story_json: any;
  script_json: Script;
  assets_json: any;
}
const rows = await db.query<Row>(
  `SELECT id, lane, created_at, publish_at, youtube_video_id, story_json, script_json, assets_json FROM episodes
     WHERE status='published' AND lane IN ('news','news_breaking') AND coalesce(script_json->>'runtime','short') <> 'long'
       AND script_json IS NOT NULL
     ORDER BY coalesce(publish_at, updated_at) DESC LIMIT $1`,
  [N],
);
console.log(`${rows.length} published news Shorts from the copy:`);
for (const r of rows) console.log(`  ${r.id}  ${r.lane}  ${r.story_json.headline}`);

/** The shapes the writer was shown that day: the Shorts written before this one (recentShapes in pipeline.ts). */
async function recentBefore(ep: Row): Promise<RecentShapes> {
  const where = `script_json IS NOT NULL AND id <> $1 AND created_at < $2 AND status NOT IN ('failed','rejected') AND COALESCE(script_json->>'runtime', 'short') = 'short'`;
  const takes = await db.query<{ take: string | null; loop: string | null }>(
    `SELECT script_json->'pulse_take'->>'narration' AS take, script_json->>'loop_line' AS loop FROM episodes WHERE ${where} ORDER BY created_at DESC LIMIT 8`,
    [ep.id, ep.created_at],
  );
  const full = await db.query<{ script: Script }>(
    `SELECT script_json AS script FROM episodes WHERE ${where} ORDER BY created_at DESC LIMIT 20`,
    [ep.id, ep.created_at],
  );
  const scripts = full.flatMap((r) => {
    try {
      return r.script?.hook && r.script.pulse_take ? [narrationOf({ ...r.script, beats: r.script.beats ?? [] })] : [];
    } catch {
      return [];
    }
  });
  return {
    takes: takes.map((r) => (r.take ?? "").trim().split(/\s+/).slice(0, 4).join(" ")).filter(Boolean),
    loops: takes.map((r) => (r.loop ?? "").trim()).filter(Boolean),
    scripts,
  };
}

// ------------------------------------------------------------------ the writer's inputs
interface Inputs {
  ep: Row;
  cluster: any;
  articles: Array<{ url: string; title: string; text: string }>;
  storeData?: string;
  recent: RecentShapes;
  lessons: string;
  variantNote: string;
  mustLabelRumour: boolean;
}
const defaults = await growthDefaults(db).catch(() => []);
const inputs: Inputs[] = [];
for (const ep of rows) {
  const cluster = ep.story_json;
  const items = [...cluster.items]
    .sort((a: any, b: any) => (a.sourceKind === "official" ? -1 : 1) - (b.sourceKind === "official" ? -1 : 1))
    .slice(0, 4);
  const articles = (await Promise.all(items.map((i: any) => fetchArticle(i.url).catch(() => undefined)))).filter(Boolean) as Inputs["articles"];
  const when = new Date(ep.created_at);
  const lessons = [
    await hookLessons(db, when, segmentInputs).catch(() => ""),
    await socialLessons(db, when).catch(() => ""),
  ]
    .filter(Boolean)
    .join("\n\n");
  inputs.push({
    ep,
    cluster,
    articles,
    storeData: ep.assets_json?.steam?.facts ? factsText(ep.assets_json.steam.facts) : undefined,
    recent: await recentBefore(ep),
    lessons,
    variantNote: growthNotes(ep.assets_json?.test, defaults),
    mustLabelRumour: !cluster.corroborated,
  });
  console.log(`  inputs for ${ep.id}: ${articles.length}/${items.length} articles fetched, steam ${ep.assets_json?.steam ? "yes" : "no"}, recent ${inputs.at(-1)!.recent.takes.length} takes, lessons ${lessons.length} chars`);
}
save("inputs.json", inputs.map((i) => ({ ...i, ep: { id: i.ep.id, headline: i.ep.story_json.headline, published: i.ep.script_json } })));

// ------------------------------------------------------------------ the judges
const Criteria = z.object({
  hook: z.number().describe("1-10: 5-10 words, game named early, opens a gap, no hype, no banned opener"),
  viewer: z.number().describe("1-10: talks to the viewer (you/your at least twice) about their money, console or weekend"),
  freshness: z.number().describe("1-10: no stock phrases, no repeated shapes, the take adds something the headline lacks"),
  numbers: z.number().describe("1-10: rounded, spoken figures; a date or price said at most twice; a card carries the figure"),
  language: z.number().describe("1-10: American English, no em dashes, advertiser-safe wording, natural spoken rhythm"),
  facts: z.number().describe("1-10: every claim is in the sources; rumours attributed; nothing invented"),
  overall: z.number().describe("1-10: would this Short hold a cold viewer for 40 seconds and read as a human creator's"),
});
const JudgeSchema = z.object({
  a: Criteria,
  b: Criteria,
  preference: z.enum(["A", "B", "tie"]),
  reason: z.string().describe("Two or three sentences on what decided it"),
});
type Judgement = z.infer<typeof JudgeSchema>;

const JUDGE_PROMPT = `You are the editor of Pulse Gaming News, a YouTube Shorts channel about video game news, judging two draft scripts for the same story written from the same sources. You do not know who wrote which.

The channel's quality bar (every criterion is scored 1-10, 10 being the best Short the channel has published):
- hook: 5-10 words, the game or company named in the first five, opens a gap the Short closes; never a bare announcement, never hype words (biggest, insane, massive), never opening with So, Today, Hey, Welcome.
- viewer: at least two sentences say "you" or "your" about what the news does to the viewer (their money, console, pre-order, weekend); the loop line is a specific question the viewer can answer in five words, or a complete dry closing line.
- freshness: no stock phrases ("let me know in the comments", "you won't believe", "our read"), the take adds context or a framed opinion the headline does not have, the beats each add a new concrete detail, the first beat is the most surprising fact.
- numbers: figures rounded the way people say them ("almost 350,000", never "346,258"), no date or price said more than twice, no list of specs read out.
- language: American spelling, no em dashes anywhere, advertiser-safe wording (no death, kill, war, crisis, attack, shocking, horror), short spoken sentences, 70-100 words in total.
- facts: every claim is supported by the sources given; a rumour is attributed to who reported it; nothing invented.
- overall: would it hold a cold viewer for 40 seconds and read as a human creator's work, not a bulletin.

Read both, score each criterion for A and for B, then state which Short the channel should publish, or "tie" when they are equally good. Be exact and unsentimental; a draft that breaks a hard rule (word count, hype hook, invented fact) scores low on that criterion however good the rest is.`;

function judgeContent(inp: Inputs, a: Script, b: Script): string {
  const sources = inp.articles.map((x, i) => `<source ${i} url="${x.url}">\n${x.title}\n${x.text.slice(0, 3000)}\n</source>`).join("\n");
  const show = (s: Script) =>
    `Hook: ${s.hook}\n${s.beats.map((b, i) => `Beat ${i + 1}: ${b.narration} [card: ${b.visual.kind} "${b.visual.primary}"]`).join("\n")}\n${s.desk_question ? `Desk question: ${s.desk_question}\n` : ""}Take: ${s.pulse_take.narration}\nLoop line: ${s.loop_line}\nSpoken words: ${wordCount(narrationOf(s))}\nYouTube title: ${s.youtube.title}\nHeadline card: ${s.headline}\nRumour: ${s.is_rumour}`;
  return `Story: ${inp.cluster.headline}\n\nSources:\n${sources}${inp.storeData ? `\n\nSteam facts given to the writers:\n${inp.storeData}` : ""}\n\n=== Short A ===\n${show(a)}\n\n=== Short B ===\n${show(b)}`;
}

/** One Codex call at a chosen kind with a strict schema, parsed with the Zod schema (no Claude fallback here). */
async function askCodexJson<S extends z.ZodType>(kind: "review" | "frontier" | "bulk", system: string, content: string, schema: S, timeoutMs = 20 * 60_000): Promise<z.infer<S>> {
  const file = path.join(TMP, `schema_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
  fs.writeFileSync(file, JSON.stringify(strictJsonSchema(z.toJSONSchema(schema, { unrepresentable: "any" }))));
  try {
    const prompt = `<instructions>\n${system}\n</instructions>\n\n<input>\n${content}\n</input>\n\nReply with one JSON object only, matching the output schema exactly. No prose, no code fence.`;
    const answer = await runCodex({ prompt, kind, schema: file, timeoutMs }, { python: "python", runnerDir: "C:\\Claude\\orchestrator", tmpDir: TMP });
    return schema.parse(dropNulls(JSON.parse(extractJson(answer)))) as z.infer<S>;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ------------------------------------------------------------------ cost estimate (Opus prices, cache on)
const OPUS = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 8 };
const tok = (s: string) => Math.ceil(s.length / 4);
const briefTokens = inputs.map((i) => tok(i.articles.map((a) => a.text).join("") + (i.storeData ?? "") + i.lessons + i.recent.scripts!.join("") + i.variantNote) + 600);
const sysTokens = tok(scriptPrompt());
const writeCost = inputs.reduce((sum, _, k) => sum + ((k === 0 ? sysTokens * OPUS.cacheWrite : sysTokens * OPUS.cacheRead) + briefTokens[k]! * OPUS.in + 1800 * OPUS.out) / 1e6, 0);
const judgeTokens = inputs.map((i) => tok(i.articles.map((a) => a.text.slice(0, 3000)).join("")) + 1200);
const judgeCost = inputs.reduce((sum, _, k) => sum + ((k === 0 ? tok(JUDGE_PROMPT) * OPUS.cacheWrite : tok(JUDGE_PROMPT) * OPUS.cacheRead) + judgeTokens[k]! * OPUS.in + 600 * OPUS.out) / 1e6, 0);
// The vision side-by-side: eight frames on the mid tier (Sonnet) at roughly 1,500 tokens each.
const visionCost = VISION ? (8 * 1500 * 2 + 1500 * 1) / 1e6 * 2 : 0;
const estimate = writeCost + judgeCost + visionCost;
console.log(`\nEstimated Claude spend: $${estimate.toFixed(2)} (writes $${writeCost.toFixed(2)}, judges $${judgeCost.toFixed(2)}, vision $${visionCost.toFixed(2)}); cap $${CAP.toFixed(2)}`);
if (estimate > CAP) {
  console.error("Over the cap; nothing was written. Lower --n or raise --cap.");
  await db.close();
  process.exit(2);
}

// ------------------------------------------------------------------ the writers
const claude = createClaude({
  top: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  mid: process.env.CLAUDE_MODEL_MID || "claude-sonnet-5-5",
  low: process.env.CLAUDE_MODEL_LOW || "claude-haiku-5-5",
});
const noFallback: Llm = {
  structured: async () => {
    throw new Error("codex failed; no fallback in the blind test");
  },
};
const codex = createCodexLlm(noFallback, { enabled: true, sites: ["*"], tmpDir: TMP });

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

interface Written {
  script?: Script;
  ms: number;
  error?: string;
}
async function write(llm: Llm, inp: Inputs): Promise<Written> {
  const t = Date.now();
  try {
    const script = await writeScript(llm, inp.cluster, inp.articles as never, {
      mustLabelRumour: inp.mustLabelRumour,
      storeData: inp.storeData,
      lessons: inp.lessons || undefined,
      recent: inp.recent,
      variantNote: inp.variantNote || undefined,
    });
    return { script, ms: Date.now() - t };
  } catch (err) {
    return { ms: Date.now() - t, error: (err as Error).message.slice(0, 300) };
  }
}

console.log("\nWriting with Claude and Codex (identical inputs)...");
const [claudeWrites, codexWrites] = await Promise.all([
  pool(inputs, CONCURRENCY, (inp) => write(claude, inp)),
  pool(inputs, CONCURRENCY, (inp) => write(codex, inp)),
]);
for (const [k, inp] of inputs.entries()) {
  const c = claudeWrites[k]!;
  const x = codexWrites[k]!;
  console.log(`  ${inp.ep.id}: claude ${c.script ? "ok" : "FAILED " + c.error} ${(c.ms / 1000).toFixed(0)}s | codex ${x.script ? "ok" : "FAILED " + x.error} ${(x.ms / 1000).toFixed(0)}s`);
  save(`${inp.ep.id}.scripts.json`, { claude: c, codex: x });
}

// ------------------------------------------------------------------ blind judging
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
interface Result {
  id: string;
  headline: string;
  order: "claude=A" | "codex=A";
  claude: Written;
  codex: Written;
  claudeJudge?: Judgement;
  codexJudge?: Judgement;
  judgeErrors: string[];
  validation: { claude: string[]; codex: string[] };
}
const results: Result[] = [];
await pool(inputs, CONCURRENCY, async (inp, k) => {
  const c = claudeWrites[k]!;
  const x = codexWrites[k]!;
  const r: Result = {
    id: inp.ep.id,
    headline: inp.cluster.headline,
    order: hash(inp.ep.id) % 2 === 0 ? "claude=A" : "codex=A",
    claude: c,
    codex: x,
    judgeErrors: [],
    validation: {
      claude: c.script ? validateScript(c.script, inp.recent) : ["not written"],
      codex: x.script ? validateScript(x.script, inp.recent) : ["not written"],
    },
  };
  results[k] = r;
  if (!c.script || !x.script) return;
  const [a, b] = r.order === "claude=A" ? [c.script, x.script] : [x.script, c.script];
  const content = judgeContent(inp, a, b);
  const [cj, xj] = await Promise.all([
    claude.structured({ tier: "top", system: JUDGE_PROMPT, content, schema: JudgeSchema, effort: "medium", maxTokens: 4000 }).catch((err) => {
      r.judgeErrors.push(`claude judge: ${(err as Error).message.slice(0, 200)}`);
      return undefined;
    }),
    askCodexJson("review", JUDGE_PROMPT, content, JudgeSchema).catch((err) => {
      r.judgeErrors.push(`codex judge: ${(err as Error).message.slice(0, 200)}`);
      return undefined;
    }),
  ]);
  r.claudeJudge = cj;
  r.codexJudge = xj;
  save(`${inp.ep.id}.judged.json`, { order: r.order, claudeJudge: cj, codexJudge: xj, errors: r.judgeErrors });
});

// ------------------------------------------------------------------ the table
/** A judge's preference and scores translated back from A/B to the writer's name. */
function unblind(r: Result, j: Judgement | undefined) {
  if (!j) return undefined;
  const claudeIsA = r.order === "claude=A";
  const prefers = j.preference === "tie" ? "tie" : (j.preference === "A") === claudeIsA ? "claude" : "codex";
  return { claude: claudeIsA ? j.a : j.b, codex: claudeIsA ? j.b : j.a, prefers, reason: j.reason };
}
const line = (s: string) => console.log(s);
line("\n=== Blind writer test: Claude (live tier) against Codex (frontier) ===");
line(`story | Claude judge: Claude/Codex overall, prefers | Codex judge: Claude/Codex overall, prefers | hook words C/X | validation C/X`);
const tally = { claudeJudge: { claude: 0, codex: 0, tie: 0 }, codexJudge: { claude: 0, codex: 0, tie: 0 } };
const sums = { claude: 0, codex: 0, n: 0 };
for (const r of results) {
  const cj = unblind(r, r.claudeJudge);
  const xj = unblind(r, r.codexJudge);
  if (cj) tally.claudeJudge[cj.prefers as "claude" | "codex" | "tie"]++;
  if (xj) tally.codexJudge[xj.prefers as "claude" | "codex" | "tie"]++;
  for (const j of [cj, xj])
    if (j) {
      sums.claude += j.claude.overall;
      sums.codex += j.codex.overall;
      sums.n++;
    }
  const hw = (w: Written) => (w.script ? String(wordCount(w.script.hook)) : "-");
  const ok = (p: string[]) => (p.length ? `${p.length} problem${p.length > 1 ? "s" : ""}` : "pass");
  line(
    `${r.headline.slice(0, 42).padEnd(42)} | ${cj ? `${cj.claude.overall}/${cj.codex.overall} ${cj.prefers}` : "no judgement"} | ${xj ? `${xj.claude.overall}/${xj.codex.overall} ${xj.prefers}` : "no judgement"} | ${hw(r.claude)}/${hw(r.codex)} | ${ok(r.validation.claude)}/${ok(r.validation.codex)}`,
  );
}
line(`\nPreferences: Claude judge -> claude ${tally.claudeJudge.claude}, codex ${tally.claudeJudge.codex}, tie ${tally.claudeJudge.tie}; Codex judge -> claude ${tally.codexJudge.claude}, codex ${tally.codexJudge.codex}, tie ${tally.codexJudge.tie}`);
if (sums.n) line(`Mean overall: Claude ${(sums.claude / sums.n).toFixed(2)}, Codex ${(sums.codex / sums.n).toFixed(2)} over ${sums.n} judgements`);
line("\nPer-criterion means (Claude writer / Codex writer), both judges pooled:");
const crit = ["hook", "viewer", "freshness", "numbers", "language", "facts", "overall"] as const;
for (const c of crit) {
  let a = 0;
  let b = 0;
  let n = 0;
  for (const r of results)
    for (const j of [unblind(r, r.claudeJudge), unblind(r, r.codexJudge)])
      if (j) {
        a += j.claude[c];
        b += j.codex[c];
        n++;
      }
  if (n) line(`  ${c.padEnd(10)} ${(a / n).toFixed(1)} / ${(b / n).toFixed(1)}`);
}
line("\nHooks:");
for (const r of results) line(`  ${r.id}\n    Claude: ${r.claude.script?.hook ?? "-"}\n    Codex:  ${r.codex.script?.hook ?? "-"}`);
line("\nValidation problems:");
for (const r of results) {
  if (r.validation.claude.length) line(`  ${r.id} Claude: ${r.validation.claude.join(" | ")}`);
  if (r.validation.codex.length) line(`  ${r.id} Codex: ${r.validation.codex.join(" | ")}`);
}
line("\nTimes: " + results.map((r) => `${r.id.slice(-8)} C ${(r.claude.ms / 1000).toFixed(0)}s X ${(r.codex.ms / 1000).toFixed(0)}s`).join("; "));
for (const r of results) if (r.judgeErrors.length) line(`  judge errors ${r.id}: ${r.judgeErrors.join("; ")}`);

// ------------------------------------------------------------------ the vision side-by-side
if (VISION) {
  line("\n=== Vision side-by-side: the graphics check (src/qa/vision.ts GRAPHICS_VISION_PROMPT) ===");
  let frames: string[] = [];
  let ctx = { headline: "", gameTitle: "", format: "graphics" as const };
  const gfxDirs = fs.existsSync(LIVE_EPISODES)
    ? fs
        .readdirSync(LIVE_EPISODES)
        .flatMap((ep) => {
          const qa = path.join(LIVE_EPISODES, ep, "qa");
          if (!fs.existsSync(qa)) return [];
          return fs
            .readdirSync(qa)
            .filter((d) => /^gfx\d+$/.test(d))
            .map((d) => ({ ep, dir: path.join(qa, d) }));
        })
        .sort((p, q) => p.ep.localeCompare(q.ep))
    : [];
  if (gfxDirs.length) {
    const { ep, dir } = gfxDirs.at(-1)!;
    frames = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jpg"))
      .sort((p, q) => Number(p.match(/\d+/)?.[0]) - Number(q.match(/\d+/)?.[0]))
      .slice(0, 8)
      .map((f) => path.join(dir, f));
    const row = (await db.query<{ script_json: Script }>(`SELECT script_json FROM episodes WHERE id = $1`, [ep]))[0];
    ctx = { headline: row?.script_json?.headline ?? ep, gameTitle: row?.script_json?.game_title ?? "", format: "graphics" };
    line(`graphics-check frames of ${ep} (${frames.length} from ${path.basename(dir)}), headline "${ctx.headline}"`);
  } else {
    const ep = inputs[0]!.ep;
    const video = path.join(LIVE_EPISODES, ep.id, "short.mp4");
    const dir = path.join(OUT, "frames");
    fs.mkdirSync(dir, { recursive: true });
    await promisify(execFile)(FFMPEG, ["-loglevel", "error", "-y", "-i", video, "-vf", "fps=6/40,scale=540:-2", "-frames:v", "6", path.join(dir, "frame_%d.jpg")]);
    frames = fs.readdirSync(dir).map((f) => path.join(dir, f));
    ctx = { headline: ep.script_json.headline, gameTitle: ep.script_json.game_title, format: "graphics" };
    line(`six frames of ${ep.id}'s short.mp4`);
  }
  const codexVision = createCodexLlm(noFallback, { enabled: true, sites: ["*"], vision: true, tmpDir: TMP });
  const t1 = Date.now();
  const c = await visionQa(claude, frames, ctx).catch((err) => ({ verdict: "error", problems: [String(err).slice(0, 200)], notes: "" }));
  const t2 = Date.now();
  const x = await visionQa(codexVision, frames, ctx).catch((err) => ({ verdict: "error", problems: [String(err).slice(0, 200)], notes: "" }));
  const t3 = Date.now();
  line(`Claude (mid tier, ${((t2 - t1) / 1000).toFixed(0)}s): ${c.verdict}; problems: ${c.problems.join(" | ") || "none"}; notes: ${c.notes}`);
  line(`Codex (bulk, ${((t3 - t2) / 1000).toFixed(0)}s): ${x.verdict}; problems: ${x.problems.join(" | ") || "none"}; notes: ${x.notes}`);
  save("vision.json", { frames, ctx, claude: { ...c, ms: t2 - t1 }, codex: { ...x, ms: t3 - t2 } });
}

// ------------------------------------------------------------------ spend
const day = new Date().toISOString().slice(0, 10);
const spent = claudeSpend(OUT_ROOT, day);
line(`\nActual Claude spend today in this folder: $${spent.live.toFixed(3)} (estimate was $${estimate.toFixed(2)}; cap $${CAP.toFixed(2)})`);
save("summary.json", { stamp, n: rows.length, estimate, spent: spent.live, tally, results });
line(`Everything is in ${OUT}`);
await db.close();
