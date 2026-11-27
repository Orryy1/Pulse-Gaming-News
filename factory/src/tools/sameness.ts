// How alike the newest Shorts are, from the database, as a table for the weekly report (src/qa/sameness.ts).
//
//   node --import tsx src/tools/sameness.ts [--db <PGlite folder>] [--n 30] [--simulate] [--json]
//
// --db reads a copy of the embedded database (never the live one while the factory holds it); without it the
// factory's own database (DATABASE_URL, or DATA_DIR/db when the factory is stopped). Read only: SELECTs.
// --simulate runs the newest N stored Shorts, oldest first, through the sparse sound plan and the layout picker
// (src/render/untemplate.ts) with the channel's memory rolling forward, at shares 0.5 and 1, and prints the score
// before and after. It reuses the stored plans, words and scripts: no voice, no model, no render.

import { loadConfig } from "../config.ts";
import { createEmbeddedDb, openDb, type Db } from "../db.ts";
import {
  recordOf,
  samenessScore,
  samenessTable,
  type SameRecord,
} from "../qa/sameness.ts";
import {
  FIRST_SHOT_MIN,
  firstShotArm,
  holdFirstShot,
  layoutArm,
  lowerLine,
  pickShape,
  planSparseSfx,
  soundArm,
  type ShortShape,
} from "../render/untemplate.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = Math.max(5, Number(opt("--n") ?? 30) || 30);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = { id: string; assets: any; script: any; created_at: string };

async function rows(db: Db, limit: number): Promise<Row[]> {
  const res = await db.query<Row>(
    `SELECT id, assets_json AS assets, script_json AS script, created_at FROM episodes
      WHERE assets_json ? 'plan' AND lane NOT IN ('longform','twin','cutdown','gameplay')
        AND status NOT IN ('failed','rejected')
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return res;
}

async function simulate(
  all: Row[],
  share: number,
): Promise<{ records: SameRecord[]; notes: Record<string, number> }> {
  const { buildSegments } = await import("../render/timeline.ts");
  const { segmentInputs, stampsFor } = await import("../pipeline.ts");
  const { TAIL_SECONDS } = await import("../render/plan.ts");
  const { wordSoundCue } = await import("../render/wordlook.ts");
  // History newest first; the window is the newest N, simulated oldest first so each sees the ones before it.
  const history: SameRecord[] = all.map((r) => recordOf(r));
  const notes = {
    askedNone: 0,
    noArrivals: 0,
    noneFresh: 0,
    takeGapMaxMs: 0,
    sparse: 0,
    layouts: 0,
    silences: 0,
    firstShortBefore: 0,
    firstShortAfter: 0,
    failed: 0,
  };
  // The shapes the simulated test chose, newest first: the opening cap counts only these (src/untemplatestep.ts).
  const chosen: Array<Pick<ShortShape, "open" | "close">> = [];
  for (let k = Math.min(N, all.length) - 1; k >= 0; k--) {
    const row = all[k]!;
    const memory = history.slice(k + 1, k + 1 + 30);
    const rec = { ...history[k]! };
    const a = row.assets ?? {};
    const plan = a.plan;
    const first = plan?.shots?.[0];
    if (first && first.end - first.start < FIRST_SHOT_MIN)
      notes.firstShortBefore++;
    let shape: ShortShape | undefined;
    if (layoutArm(row.id, true, share) === "on") {
      shape = pickShape({
        id: row.id,
        recent: chosen.slice(0, 30),
        rumour: Boolean(row.script?.is_rumour),
        line: lowerLine(row.script?.headline ?? "", row.script?.youtube?.thumb_text),
      });
      chosen.unshift({ open: shape.open, close: shape.close });
      rec.open = shape.open;
      rec.close = shape.close;
      notes.layouts++;
    }
    // SHORT_FIRST_SHOT_MIN_S=1.5 is its own split (its own salt; simulated here at the same share), never tied to the
    // layout arm.
    if (firstShotArm(row.id, FIRST_SHOT_MIN / 30, share) === "held") {
      const held = holdFirstShot(plan?.shots ?? []);
      if (held[0] && held[0].end - held[0].start < FIRST_SHOT_MIN)
        notes.firstShortAfter++;
    } else if (first && first.end - first.start < FIRST_SHOT_MIN)
      notes.firstShortAfter++;
    if (soundArm(row.id, "sparse", share) === "sparse" && plan && row.script) {
      try {
        const words = a.words ?? [];
        const duration = (a.durationSeconds ?? 30) + TAIL_SECONDS;
        const segments = buildSegments(
          segmentInputs(row.script, Boolean(a.desk)),
          words,
          duration,
        );
        const r = planSparseSfx({
          id: row.id,
          plan,
          segments,
          words,
          stamps: stampsFor(row.script, words),
          clean: true,
          stampSound: wordSoundCue(plan.wordLook),
          recent: memory.map((m) => m.sfx.join(">")),
          shape,
        });
        rec.sfx = r.sequence ? r.sequence.split(">") : [];
        if (r.silence) notes.silences++;
        if (!r.wanted) notes.askedNone++;
        else if (!r.arrivals) notes.noArrivals++;
        else if (!r.sequence) notes.noneFresh++;
        // The voice's own gap before the verdict line (the silence beat needs 0.7 s of it).
        const take = [...segments].reverse().find((g) => g.kind === "take");
        const firstW = take ? words.findIndex((w: { start: number }) => w.start >= take.start - 0.05) : -1;
        if (firstW > 0) notes.takeGapMaxMs = Math.max(notes.takeGapMaxMs, Math.round((words[firstW].start - words[firstW - 1].end) * 1000));
        notes.sparse++;
      } catch (err) {
        notes.failed++;
        console.error(`simulate ${row.id}: ${(err as Error).message}`);
      }
    }
    history[k] = rec;
  }
  return { records: history.slice(0, N), notes };
}

const day = (t: unknown) => (t ? new Date(t as string).toISOString().slice(0, 10) : "?");

async function main() {
  const dbDir = opt("--db");
  const db = dbDir
    ? await createEmbeddedDb(dbDir)
    : await (async () => {
        const cfg = loadConfig();
        return openDb(cfg.databaseUrl, cfg.dataDir);
      })();
  try {
    const all = await rows(db, N + 30);
    const now = samenessScore(
      all.map((r) => recordOf(r)),
      N,
    );
    const range = `${day(all[Math.min(N, all.length) - 1]?.created_at)} to ${day(all[0]?.created_at)}`;
    if (!args.includes("--simulate")) {
      if (args.includes("--json")) console.log(JSON.stringify(now, null, 1));
      else
        console.log(
          `Sameness of the newest ${now.n} Shorts (${range})\n\n${samenessTable(now)}`,
        );
      return;
    }
    const out: Record<string, unknown> = { now };
    for (const share of [0.5, 1]) {
      const sim = await simulate(all, share);
      const after = samenessScore(sim.records, N);
      out[`share_${share}`] = { after, notes: sim.notes };
      if (!args.includes("--json"))
        console.log(
          `\nSimulated: the newest ${now.n} Shorts (${range}) with SHORT_SOUND_PLAN=sparse and SHORT_LAYOUTS=on at share ${share}\n` +
            `(sparse sound on ${sim.notes.sparse}, chosen layouts on ${sim.notes.layouts}, silence beats ${sim.notes.silences}, ` +
            `first shot under 1.5 s: ${sim.notes.firstShortBefore} before, ${sim.notes.firstShortAfter} after${sim.notes.failed ? `, ${sim.notes.failed} not simulated` : ""}; no effect: ${sim.notes.askedNone} by the id's draw, ${sim.notes.noArrivals} with nothing arriving on screen, ${sim.notes.noneFresh} for want of a fresh sequence; longest pause before a verdict ${sim.notes.takeGapMaxMs} ms)\n\n` +
            samenessTable(now, after, ["Stored", `Share ${share}`]),
        );
    }
    if (args.includes("--json")) console.log(JSON.stringify(out, null, 1));
  } finally {
    await db.close();
  }
}

await main();
