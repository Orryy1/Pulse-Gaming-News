// Measures the Inspiration rules on finished long videos, with no model call (reports/Inspiration playlist forensics.md).
// Reads a COPY of the database: robocopy data\db somewhere first; never the live one.
// Usage: node --import tsx src/tools/long-measures.ts <db copy dir> <episode id>... [--transcripts=<dir>]
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Script } from "../editorial/schema.ts";
import { scriptMeasures } from "../editorial/longrules.ts";
import {
  buildLongPlan,
  momentKeys,
  momentWindows,
  openChaptersAtBreaks,
  LONG_TAIL_SECONDS,
  usefulGraphic,
  type LongPlan,
} from "../render/longplan.ts";
import { buildSegments } from "../render/timeline.ts";
import { segmentInputs, variantOf, chapterSentences } from "../pipeline.ts";
import { pictureMeasures } from "../render/picturecap.ts";
import { sentenceSpan } from "../render/momentspan.ts";

/** The narration of a stored long video: the hook, every beat and the outro. */
export function scriptText(script: Script): string {
  return [
    script.hook,
    ...script.beats.map((b) => b.narration),
    script.pulse_take?.narration ?? "",
  ].join(" ");
}

function replan(id: string, script: any, a: any, opts: { cap?: number }): { plan: LongPlan; mediaKey: (s: any) => string } {
  const words = a.words ?? [];
  const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(segmentInputs(script, Boolean(a.desk)), words, duration),
    a.breaks,
  );
  const moments = [...(script.entries ?? [])]
    .sort((x: any, y: any) => y.rank - x.rank)
    .map((e: any) => e.moments ?? []);
  const doc = script.evergreen_format === "documentary";
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images: a.images.map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
    clips: a.clips.map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, span: c.span })),
    noRepeats: true,
    variant: variantOf(id),
    realPinnedOnly: true,
    momentCounts: moments.map((m: any[]) => m.length),
    momentKeys: moments.map((e: any[]) => e.map(momentKeys)),
    momentFillers: moments.map((e: any[]) => e.map((m: any) => m.filler)),
    momentShows: moments.map((e: any[], i: number) => {
      const said = chapterSentences(script, i);
      return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
    }),
    takeEntry: script.take_entry,
    rhythm: true,
    entryPace: !doc,
    bookend: true,
    coldOpenFrames: 90,
    samePictureMaxSeconds: opts.cap,
  });
  void momentWindows;
  return { plan, mediaKey: () => "" };
}

const args = process.argv.slice(2);
const dir = args.find((x) => x.startsWith("--transcripts="))?.split("=")[1];
const ids = args.filter((x) => !x.startsWith("--"));
const dbDir = ids.shift()!;
if (dir)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".txt")))
    console.log(f, JSON.stringify(scriptMeasures(fs.readFileSync(path.join(dir, f), "utf8"))));
if (dbDir && ids.length) {
  const db = new PGlite(dbDir);
  for (const id of ids) {
    const [ep] = (await db.query<any>(`SELECT script_json, assets_json FROM episodes WHERE id = $1`, [id])).rows;
    if (!ep?.script_json) continue;
    const s = ep.script_json, a = ep.assets_json;
    console.log(`\n${id} ${s.youtube?.title ?? s.headline}`);
    console.log(" script", JSON.stringify(scriptMeasures(scriptText(s))));
    console.log(" first sentence:", s.hook.split(/(?<=[.!?])\s/)[0]);
    console.log(" loops", (s.open_loops ?? []).length);
    const stored: LongPlan | undefined = a.longPlan;
    const moments = [...(s.entries ?? [])].sort((x: any, y: any) => y.rank - x.rank).map((e: any) => e.moments ?? []);
    const words = a.words ?? [];
    const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
    const segments = openChaptersAtBreaks(buildSegments(segmentInputs(s, Boolean(a.desk)), words, duration), a.breaks);
    const windows = momentWindows(segments, words, moments.map((m: any[]) => m.length), moments.map((e: any[]) => e.map(momentKeys)));
    const look = (plan: LongPlan) => {
      const fillers = new Map(
        plan.shots
          .filter((x) => x.media.type === "filler")
          .map((x) => [`${x.media.entry}:${x.media.index}`, x.start]),
      );
      const spanLook = {
        moment: (e: number, m: number) => moments[e]?.[m],
        fillerStart: (e: number, m: number) => fillers.get(`${e}:${m}`),
        shares: (e: number, m: number) =>
          ["stat", "date", "list", "compare", "score"].includes(moments[e]?.[m]?.graphic.kind ?? ""),
      };
      return windows.flatMap((w: any, k: number) => {
        const g = moments[w.entry]?.[w.moment]?.graphic;
        if (!g || !usefulGraphic(g) || ["map", "bars", "share", "specs", "lineage", "stat", "date", "list", "compare", "score"].includes(g.kind)) return [];
        if (fillers.has(`${w.entry}:${w.moment}`)) return [];
        const sp = sentenceSpan(windows, k, plan.fps, spanLook as any);
        return sp.short ? [] : [{ start: sp.from / plan.fps, end: (sp.from + sp.len) / plan.fps }];
      });
    };
    const tell = (name: string, plan: LongPlan) =>
      console.log(` ${name}`, JSON.stringify(pictureMeasures(plan, a, look(plan))));
    if (stored) tell("stored plan", stored);
    tell("today's planner", replan(id, s, a, {}).plan);
    tell("capped at 12 s", replan(id, s, a, { cap: 12 }).plan);
  }
  await db.close();
}
