// The shot plan panel proof (SHOT_PLAN_PANEL, src/render/planpanel.ts). Runs the panel on stored episodes' plans and
// prints each plan card, its measurements and, when allowed to spend, the picture editor critic's marks. Never
// renders, never downloads, never writes to the database or the episodes: it reads one JSON export and prints.
//
// Free (no model call): the plan cards and measurements, the candidates and the measurements' pick:
//   npx tsx src/tools/planpanel-proof.ts <episodes.json> [--mode check|on] [--ids a,b] [--candidates 3]
// Paid (spends model credit; the owner approves first):
//   npx tsx src/tools/planpanel-proof.ts <episodes.json> --yes-spend --max-usd <dollars> [--mid <model id>] ...
// <episodes.json>: rows of the episodes table or /admin/export ({ id, lane, script_json, assets_json, story_json }),
// with assets_json carrying words, durationSeconds, images and clips. "check" reads the plan as stored (what
// rendered); "on" rebuilds the plan from the stored media and runs the candidates. Stops before the next episode once
// the spend passes --max-usd (Claude's price table).

import fs from "node:fs";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import type { PlanInput, RenderPlan } from "../render/plan.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

type Row = {
  id: string;
  lane?: string;
  script_json?: Script | string | null;
  assets_json?: Record<string, any> | string | null;
};
const parse = <T>(v: unknown): T =>
  (typeof v === "string" ? JSON.parse(v) : v) as T;

async function main(file: string): Promise<void> {
  const spend = args.includes("--yes-spend");
  const maxUsd = Number(flag("--max-usd"));
  if (spend && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
    console.error("--yes-spend needs a --max-usd cap.");
    process.exit(2);
  }
  const mode = flag("--mode") === "check" ? "check" : "on";
  const ids = flag("--ids")?.split(",").filter(Boolean);
  const candidates = Math.max(
    1,
    Math.min(3, Number(flag("--candidates") ?? 3) || 3),
  );
  const { loadConfig } = await import("../config.ts");
  const { buildPlan, TAIL_SECONDS } = await import("../render/plan.ts");
  const { buildSegments } = await import("../render/timeline.ts");
  const { scorePlan } = await import("../qa/rubric.ts");
  const { segmentInputs, variantOf } = await import("../pipeline.ts");
  const { panelContext } = await import("../planpanelstep.ts");
  const { planCard, measurePlan, measuresLine, planSignature } =
    await import("../render/plancards.ts");
  const { readPlan, runPanel } = await import("../render/planpanel.ts");
  const cfg = loadConfig();
  let spent = 0;
  let llm: Llm | undefined;
  let untap: (() => void) | undefined;
  if (spend) {
    const { withVoiceTags, createClaude, tapUsage, usageCost } =
      await import("../editorial/llm.ts");
    untap = tapUsage((line) => {
      spent += usageCost(line);
    });
    llm = withVoiceTags(
      createClaude({
        top: cfg.anthropicModel,
        mid: flag("--mid") ?? cfg.claudeModelMid,
        low: cfg.claudeModelLow,
      }),
    );
  }
  const rows = (parse<Row[]>(fs.readFileSync(file, "utf8")) ?? []).filter(
    (r) => !ids || ids.includes(String(r.id)),
  );
  const recent = rows
    .map(
      (r) =>
        parse<Record<string, any> | null>(r.assets_json)?.plan as
          | RenderPlan
          | undefined,
    )
    .filter((p): p is RenderPlan => !!p && Array.isArray(p.shots))
    .map((p) => planSignature(p));
  for (const [k, row] of rows.entries()) {
    if (spend && spent >= maxUsd) {
      console.log(`stopped: spent $${spent.toFixed(2)} of the $${maxUsd} cap`);
      break;
    }
    const script = parse<Script | null>(row.script_json);
    const assets = parse<Record<string, any> | null>(row.assets_json);
    if (!script || !assets?.words?.length) {
      console.log(`\n### ${row.id}: skipped (no script or no words)`);
      continue;
    }
    const duration = Number(assets.durationSeconds ?? 30) + TAIL_SECONDS;
    const segments = buildSegments(
      segmentInputs(script, Boolean(assets.desk)),
      assets.words,
      duration,
    );
    const input: PlanInput = {
      segments,
      words: assets.words,
      durationSeconds: duration,
      images: (assets.images ?? []).map((i: any) => ({
        kind: i.kind,
        aspect: i.aspect,
        beatIndex: i.beatIndex,
        wordy: i.wordy,
        luma: i.luma,
        aesthetic: i.aesthetic,
        frame: i.frame,
        then: i.then,
        forWords: i.forWords,
        role: i.role,
      })),
      clips: (assets.clips ?? []).map((c: any) => ({
        durationSeconds: c.durationSeconds,
        motion: c.motion,
        luma: c.luma,
        beatIndex: c.beatIndex,
        role: c.role,
        cutsceneMatch: c.cutsceneMatch,
        ...(c.forWords ? { forWords: c.forWords } : {}),
      })),
      storyType: script.is_rumour ? "rumour" : script.story_type,
      isRumour: script.is_rumour,
      attribution: script.attribution,
      variant: variantOf(row.id),
      openOnClip: cfg.openOnMotion,
      footageFirst: cfg.shortFootageFirst,
      preferBright: cfg.shortBright,
    };
    const footageSeconds = (assets.clips ?? []).reduce(
      (n: number, c: any) => n + Number(c.durationSeconds ?? 0),
      0,
    );
    const rubric = (plan: RenderPlan) =>
      scorePlan({
        plan,
        segments,
        words: assets.words,
        footageSeconds,
        footageBudgetSeconds: Math.max(20, footageSeconds),
        hookWords: script.hook.split(/\s+/).filter(Boolean).length,
        plateShareMax: cfg.shortPlateMax,
        plateFirstSeconds: cfg.shortPlateFirstSeconds,
        shelfOptional: cfg.shortLabelsClean,
      });
    const ctx = panelContext(script, segments, assets);
    const others = recent.filter((_, j) => j !== k);
    const base: RenderPlan =
      mode === "check" && assets.plan?.shots ? assets.plan : buildPlan(input);
    console.log(`\n### ${row.id} (${row.lane ?? "?"}): ${script.headline}`);
    const { plan, record } = await runPanel({
      mode,
      arm: "panel",
      input,
      base,
      ctx,
      recent: others,
      candidates,
      rubric,
      read: llm ? (card) => readPlan(llm!, card) : undefined,
      now: new Date(),
    });
    const built =
      mode === "on"
        ? (await import("../render/planpanel.ts")).buildCandidates(
            input,
            candidates,
            base,
          )
        : [];
    for (const c of record.candidates) {
      const p =
        c.label === "A"
          ? base
          : built.find((b) => b.spec.label === c.label)?.plan;
      console.log(
        `\n--- plan ${c.label}: ${c.how} [${c.grade}]${c.dropped ? ` dropped: ${c.dropped}` : ""}`,
      );
      if (p) console.log(planCard(p, ctx));
      console.log(
        `measures: ${measuresLine(c.measures)}; measurements' mark ${c.measure_mark}`,
      );
      if (c.critic)
        console.log(
          `critic: overall ${c.critic.overall}; lines ${c.critic.lines.join(" ")}; weakest ${c.critic.weakest}: ${c.critic.should_show}`,
        );
      if (c.mark !== undefined) console.log(`panel mark ${c.mark}`);
    }
    console.log(
      `\npick: ${record.pick ?? "none"}${record.note ? ` (${record.note})` : ""}; reads ${record.calls.critic}`,
    );
    if (record.fix)
      console.log(
        `fix: line ${record.fix.line}, ${record.fix.from} -> ${record.fix.to} (${record.fix.kept ? "kept" : "not kept"}); after: ${record.fix.measures ? measuresLine(record.fix.measures) : "n/a"}`,
      );
    if (plan !== base && mode === "on")
      console.log(
        `kept plan measures: ${measuresLine(measurePlan(plan, ctx, others))}`,
      );
    if (record.error) console.log(`critic error: ${record.error}`);
  }
  untap?.();
  if (spend) console.log(`\nspent about $${spent.toFixed(2)}`);
}

const file = args.find(
  (a, i) =>
    !a.startsWith("--") &&
    !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--yes-spend"),
);
if (!file) {
  console.error(
    "usage: planpanel-proof.ts <episodes.json> [--mode check|on] [--ids a,b] [--candidates 3] [--yes-spend --max-usd <dollars> [--mid <id>]]",
  );
  process.exit(2);
}
await main(file);
