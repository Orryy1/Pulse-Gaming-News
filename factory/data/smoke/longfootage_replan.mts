// 13 Nov 2026, plan only: a long video's moving share as it rendered, as the planner would plan it again today with
// LONG_MOVING_FIRST off, and with it on (src/qa/movingshare.ts). Reads a COPY of the database; renders nothing, gathers
// nothing (the clips are the ones the video already had). Fillers and the cold-open previews are planned as the
// render step plans them; the IGDB top-up for thin entries is not run.
//   node --import tsx data/smoke/longfootage_replan.mts <db copy dir> <out dir> [episode id ...]
// With no id it takes the five most recent long videos that have a plan. Writes <out>/replan.json.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
const { segmentInputs, variantOf, chapterSentences, sameGameGroups, linesNamingPeople } = await import("../../src/pipeline.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { openChaptersAtBreaks, LONG_TAIL_SECONDS, LONG_FPS, buildLongPlan, momentKeys } = await import("../../src/render/longplan.ts");
const { movingShare } = await import("../../src/qa/movingshare.ts");
const { longCraft } = await import("../../src/longformat.ts");
const { coldOpenTiming } = await import("../../src/render/bookends.ts");
const { loadConfig } = await import("../../src/config.ts");
const [dbDir, out, ...ids] = process.argv.slice(2) as [string, string, ...string[]];
fs.mkdirSync(out, { recursive: true });
const cfg = loadConfig();
const db = new PGlite(dbDir);
const rows = ids.length
  ? (await db.query<any>(`SELECT id, lane, script_json, assets_json, factcheck_json, updated_at FROM episodes WHERE id = ANY($1)`, [ids])).rows
  : (
      await db.query<any>(
        `SELECT id, lane, script_json, assets_json, factcheck_json, updated_at FROM episodes
          WHERE lane IN ('longform','documentary') AND assets_json->'longPlan' IS NOT NULL AND id NOT LIKE 'retro%'
          ORDER BY updated_at DESC LIMIT 5`,
      )
    ).rows;
await db.close();
const res: any[] = [];
for (const ep of rows) {
  const script = ep.script_json, a = ep.assets_json;
  const words = a.words ?? [];
  const duration = (a.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(buildSegments(segmentInputs(script, Boolean(a.desk)), words, duration), a.breaks);
  const moments = [...(script.entries ?? [])].sort((x: any, y: any) => y.rank - x.rank).map((e: any) => e.moments ?? []);
  const hasMoments = moments.some((m: any[]) => m.length);
  const craft = longCraft(script, cfg);
  const fillerAt = (e: number, m: number) =>
    cfg.fillers && !(a.quietMoments ?? []).includes(`${e}:${m}`) ? moments[e]?.[m]?.filler : undefined;
  const input = (movingFirst: boolean, clipRemainders = false) => ({
    segments,
    words,
    durationSeconds: duration,
    images: (a.images ?? []).map((i: any) => ({ kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, moment: i.moment, file: i.file })),
    clips: (a.clips ?? []).map((c: any) => ({ durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, cutsceneMatch: c.cutsceneMatch, span: c.span, stock: c.stock })),
    noRepeats: cfg.footageFirst,
    sameGame: sameGameGroups(script),
    noStockOn: cfg.longStockNotOnPeople ? moments.map((e: any[], i: number) => linesNamingPeople(e, chapterSentences(script, i), moments.flat())) : undefined,
    samePictureMaxSeconds: cfg.longSamePictureMaxSeconds,
    variant: variantOf(ep.id),
    realPinnedOnly: cfg.realPhotosPinnedOnly,
    momentCounts: hasMoments ? moments.map((m: any[]) => m.length) : undefined,
    momentKeys: hasMoments ? moments.map((e: any[]) => e.map(momentKeys)) : undefined,
    momentFillers: hasMoments ? moments.map((e: any[], ei: number) => e.map((_: any, mi: number) => fillerAt(ei, mi))) : undefined,
    momentShows: hasMoments
      ? moments.map((e: any[], i: number) => {
          const said = chapterSentences(script, i);
          return e.map((m: any, k: number) => `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`);
        })
      : undefined,
    takeEntry: script.take_entry,
    rhythm: craft.rhythm,
    entryPace: craft.entryPace,
    bookend: craft.bookend,
    coldOpenFrames: craft.coldOpen ? coldOpenTiming(LONG_FPS).frames : 0,
    movingFirst,
    accentStillFrames: Math.round(cfg.longAccentStillSeconds * LONG_FPS),
    clipRemainders,
  });
  const measure = (plan: any) => movingShare({ shots: plan.shots, fps: plan.fps, words, clips: a.clips ?? [] });
  const row = {
    id: ep.id,
    lane: ep.lane,
    title: script.youtube?.title ?? script.headline,
    format: script.evergreen_format ?? script.runtime,
    minutes: Math.round(((a.durationSeconds ?? 0) / 60) * 10) / 10,
    clips: (a.clips ?? []).length,
    clipSeconds: Math.round((a.clips ?? []).reduce((n: number, c: any) => n + (c.durationSeconds ?? 0), 0)),
    images: (a.images ?? []).length,
    rendered: a.longPlan ? measure(a.longPlan) : null,
    replanned: measure(buildLongPlan(input(false))),
    movingFirst: measure(buildLongPlan(input(true))),
    // 13 Nov 2026 (LONG_CLIP_REMAINDERS): a clip cut short keeps its unseen rest for a later shot.
    remainders: measure(buildLongPlan(input(true, true))),
    // A retrospective is one game: its opening and closing may play its chapters' footage.
    ...(ep.factcheck_json?.topic?.retro ? { oneGame: measure(buildLongPlan({ ...input(true, true), oneGame: true })) } : {}),
  };
  res.push(row);
  console.log(JSON.stringify({ id: row.id, title: row.title, minutes: row.minutes, clips: row.clips, clipSeconds: row.clipSeconds, rendered: row.rendered?.movingShare, replanned: row.replanned.movingShare, movingFirst: row.movingFirst.movingShare, remainders: row.remainders.movingShare, oneGame: (row as any).oneGame?.movingShare, stills: [row.rendered?.stillShare, row.replanned.stillShare, row.movingFirst.stillShare, row.remainders.stillShare] }));
}
fs.writeFileSync(path.join(out, "replan.json"), JSON.stringify(res, null, 2));
