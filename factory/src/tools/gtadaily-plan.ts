// GTA 6 Day N's dry run (src/gtadaily.ts): plans Day 1 to 3 of the launch week from data already on this machine, with
// the real code paths (numbering, the day claim, the spoiler gate, titles, the playlist, the description's links, the
// first comment and the "Next:" line written back onto the day before), against a throwaway database in the output
// folder. Nothing is uploaded, no model is called and the factory's own database is never opened.
//
// GTA VI is not out yet, so the inbox has no GTA VI clips: each day's episode is built from that day's top stream ask
// (the asks list, else the seed list docs/streamasks-seed-gta6.md) with a stand-in clip from the inbox named, as the
// reviewer would hand it over after the night's stream. The database is closed and opened again between Day 2 and
// Day 3 (a restart), and a fourth pass skips Day 4 to show Day 5 keeps its own number.
//
// Usage: node --import tsx src/tools/gtadaily-plan.ts [outDir] [--root <GAMEPLAY_ROOT>]
import fsp from "node:fs/promises";
import path from "node:path";
import { loadConfig, type Config } from "../config.ts";
import { createEmbeddedDb, migrate, type Db } from "../db.ts";
import { createEpisode, getEpisode, type Episode } from "../episodes.ts";
import { gameplayScript, readMeta, type GameplayReview } from "../gameplay.ts";
import {
  applyGtaDaily,
  gtaDailyComment,
  linkGtaDaily,
  refreshGtaDailyLinks,
  seriesFor,
  videoMetadata,
  type Services,
} from "../pipeline.ts";
import {
  claimedDays,
  dailySpoilerProblems,
  gtaDailyFrom,
  gtaDailySummary,
  isGtaVi,
  slotOfDay,
  GTA_DAILY_PLAYLIST,
} from "../gtadaily.ts";
import { readAsks } from "../streamasks/job.ts";
import { parseSeed } from "../streamasks/seed.ts";
import type { StreamAsk } from "../streamasks/asks.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root") ??
    "gtadaily-proof",
);

const base = loadConfig();
const cfg: Config = {
  ...base,
  // The proof plans with the daily on, as the owner would switch it; nothing here reaches the live factory.
  gtaDaily: true,
  gtaDailyStart: process.env.GTA_DAILY_START || "2026-11-19",
  gtaDailySlot: process.env.GTA_DAILY_SLOT || "21:00",
  gameplayEnabled: true,
  gameplayRoot: flag("--root") ?? base.gameplayRoot,
  dryRun: false,
};
const maybeDaily = gtaDailyFrom(cfg);
if (!maybeDaily)
  throw new Error(
    `the daily would not run with these settings: ${gtaDailySummary(cfg)}`,
  );
const daily = maybeDaily;

interface InboxClip {
  id: string;
  status: string;
  game: string;
  kind: string;
  title: string;
}

async function inbox(root: string): Promise<InboxClip[]> {
  const dir = path.join(root, "inbox");
  const out: InboxClip[] = [];
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    const m = await readMeta(path.join(dir, name));
    if (!m) continue;
    out.push({
      id: m.id,
      status: m.status,
      game: m.review?.game ?? "",
      kind: m.source?.kind ?? "",
      title: m.source?.title ?? "",
    });
  }
  return out;
}

async function asks(): Promise<{ from: string; list: StreamAsk[] }> {
  const store = await readAsks(cfg.dataDir);
  const open = store.asks.filter((a) => a.status === "open" && isGtaVi(a.game));
  if (open.length)
    return { from: `${cfg.dataDir}/streamasks/asks.json`, list: open };
  const seedFile = cfg.streamAsks.seedFile;
  const md = await fsp.readFile(seedFile, "utf8").catch(() => "");
  return {
    from: seedFile,
    list: parseSeed(md, "Grand Theft Auto VI", new Date().toISOString()),
  };
}

function standInReview(ask: StreamAsk): GameplayReview {
  const q = ask.question.replace(/^"|"$/g, "");
  return {
    keep: true,
    score: 8,
    reason: "Stand-in: the reviewer fills this from the night's clip.",
    game_title: "Grand Theft Auto VI",
    real_test: true,
    experiment_number: 0,
    question: q.toUpperCase(),
    result_line: "RESULT FROM THE CLIP",
    result: "The reviewer writes what the clip shows here.",
    start_seconds: 0,
    end_seconds: 30,
    youtube_title: `GTA 6: ${q}`,
    description: `${ask.claim.slice(0, 160)} We tested it on our own copy.`,
    hashtags: ["#GTA6", "#GTA"],
    radio_audible: false,
    spoiler: false,
    strong_language: false,
    captions_ok: false,
  };
}

const services = (
  db: Db,
  now: Date,
  rewrites: Array<{ video: string; after: string }>,
): Services =>
  ({
    db,
    cfg,
    now: () => now,
    youtube: () => ({
      rewriteDescriptions: async (
        id: string,
        fn: (d: string, l: string) => string,
      ) => {
        rewrites.push({
          video: id,
          after: fn(`(the live description of ${id})\n\n...`, "en"),
        });
        return 1;
      },
    }),
  }) as unknown as Services;

async function main() {
  await fsp.mkdir(outDir, { recursive: true });
  const dbDir = path.join(outDir, "db");
  await fsp.rm(dbDir, { recursive: true, force: true });
  await fsp.rm(`${dbDir}.lock`, { force: true });
  let db = await createEmbeddedDb(dbDir);
  await migrate(db);

  const clips = await inbox(cfg.gameplayRoot);
  const gta6 = clips.filter((c) => isGtaVi(`${c.game} ${c.title}`));
  const standIns = clips.filter((c) => !isGtaVi(`${c.game} ${c.title}`));
  const { from: askSource, list } = await asks();
  // The asks a daily may answer: open, early-game, no story (the gate is run again on the final words below).
  const usable = list.filter((a) => a.earlyGame && !a.spoiler);
  const rejectedAsks = list
    .map((a) => ({
      a,
      why: dailySpoilerProblems(
        daily,
        [a.question, a.claim],
        new Date("2026-11-20T12:00:00Z"),
      ),
    }))
    .filter((x) => x.why.length)
    .map((x) => ({ question: x.a.question, why: x.why }));

  const days: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  const plan = async (dayDate: string, label: string) => {
    const now = new Date(`${dayDate}T12:00:00Z`);
    const ask = usable.find(
      (a) =>
        !used.has(a.id) &&
        !dailySpoilerProblems(daily, [a.question, a.claim], now).length,
    );
    if (!ask) return;
    used.add(ask.id);
    const review = standInReview(ask);
    const id = `sim_${dayDate.replace(/-/g, "")}`;
    const clip = standIns[days.length % Math.max(1, standIns.length)];
    await createEpisode(
      db,
      id,
      {
        hash: `gameplay:${id}`,
        headline: review.question,
        items: [],
        sources: ["Pulse Gaming"],
        hasOfficial: true,
        corroborated: true,
        rumourSignals: false,
        newestAt: now.toISOString(),
        score: review.score,
        gameHint: review.game_title,
        gameplay: { id, dir: "", review },
      },
      { lane: "gameplay", priority: 10 },
    );
    const script = gameplayScript(review, id, []);
    const rewrites: Array<{ video: string; after: string }> = [];
    const s = services(db, now, rewrites);
    const meta = {
      stream_ask: {
        question: ask.question,
        claim: ask.claim,
        rumour: ask.rumour,
        verdict: "proved" as const,
        confidence: 0.8,
        reason: "stand-in",
      },
    };
    await applyGtaDaily(s, (await getEpisode(db, id))!, script, meta);
    await db.query(
      `UPDATE episodes SET script_json = $2, status = 'approved' WHERE id = $1`,
      [id, JSON.stringify(script)],
    );
    let ep = (await getEpisode(db, id))!;
    ep = await refreshGtaDailyLinks(s, ep);
    // The upload, simulated: published and scheduled for the daily slot, with a made-up video id.
    const videoId = `SIM_${id.slice(4)}`;
    await db.query(
      `UPDATE episodes SET status = 'published', youtube_video_id = $2, publish_at = slot_at WHERE id = $1`,
      [id, videoId],
    );
    ep = (await getEpisode(db, id))! as Episode;
    const metaOut = videoMetadata(ep, "public", true, undefined, false, now);
    const story = ep.story_json.gtaDaily;
    // After the slot: the first comment and the forward link on the day before.
    const after = new Date(
      (story ? slotOfDay(daily, story.day) : now).getTime() + 20 * 60_000,
    );
    const s2 = services(db, after, rewrites);
    const comment = await gtaDailyComment(s2, ep);
    await linkGtaDaily(s2, ep);
    // The playlist exists once the first episode is filed (addToSeries); simulated after Day 1.
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, 'PL_SIMULATED') ON CONFLICT (key) DO NOTHING`,
      [`playlist:${GTA_DAILY_PLAYLIST}`],
    );
    days.push({
      label,
      planned_on: now.toISOString(),
      episode: id,
      day: story?.day ?? null,
      slot_at: ep.slot_at ? new Date(ep.slot_at).toISOString() : null,
      title: metaOut.title,
      answers_ask: ask.question,
      ask_rumour: ask.rumour,
      theme: story?.theme,
      footage: clip
        ? `stand-in clip ${clip.id} (${clip.game || clip.kind}, ${clip.status}); after launch: the night's GTA VI clip`
        : "none in the inbox",
      playlist: seriesFor(cfg, ep, after).map((x) => x.title),
      previous: story?.previous ?? null,
      description_daily_lines: metaOut.description
        .split("\n")
        .filter((l) => /^(Previous: GTA 6 Day|Every day so far)/.test(l)),
      first_comment_line: comment,
      next_link_written_on_day_before: rewrites.map((r) => ({
        video: r.video,
        line: r.after.split("\n").find((l) => l.startsWith("Next:")) ?? "",
      })),
    });
  };

  await plan(daily.start, "Day 1 (launch day)");
  await plan(addDay(daily.start, 1), "Day 2");
  // A restart: the database is closed and opened again; the claims and numbers must still be there.
  const claimsBefore = [...(await claimedDays(db))];
  await db.close();
  db = await createEmbeddedDb(dbDir);
  const claimsAfter = [...(await claimedDays(db))];
  await plan(addDay(daily.start, 2), "Day 3 (after a restart)");
  // Day 4 is skipped (no clip). Day 5 keeps its own number and links back to Day 3.
  await plan(addDay(daily.start, 4), "Day 5 (Day 4 skipped)");
  // The comments made at Day 1 to 3's go-live could not promise a day not yet made; read now, Day 1's promises Day 2.
  const day1 = (await getEpisode(db, days[0]!.episode as string))!;
  const day1CommentNow = await gtaDailyComment(
    services(db, new Date(), []),
    day1,
  );
  const claimsEnd = [...(await claimedDays(db))];
  await db.close();

  const report = {
    generated_at: new Date().toISOString(),
    settings: {
      GTA_DAILY: "true",
      GTA_DAILY_START: daily.start,
      GTA_DAILY_SLOT: daily.slot,
      GTA_DAILY_DAYS: String(daily.days),
      GAMEPLAY_SLOTS: cfg.gameplaySlots.join(","),
      SPOILER_WINDOW_DAYS: String(daily.spoilerDays),
    },
    summary: gtaDailySummary(cfg),
    data: {
      gameplay_root: cfg.gameplayRoot,
      inbox_clips: clips.length,
      gta6_clips: gta6.length,
      stream_asks_from: askSource,
      stream_asks: list.length,
      usable_asks: usable.length,
      asks_blocked_by_spoiler_gate: rejectedAsks,
    },
    restart: {
      claims_before: claimsBefore,
      claims_after: claimsAfter,
      same: JSON.stringify(claimsBefore) === JSON.stringify(claimsAfter),
    },
    days,
    day1_comment_if_written_now: day1CommentNow,
    claims_at_end: claimsEnd,
    uploads: 0,
    model_calls: 0,
  };
  await fsp.writeFile(
    path.join(outDir, "gtadaily-plan.json"),
    JSON.stringify(report, null, 2),
  );
  await fsp.writeFile(path.join(outDir, "gtadaily-plan.md"), markdown(report));
  await fsp.rm(dbDir, { recursive: true, force: true });
  console.log(`wrote ${path.join(outDir, "gtadaily-plan.md")}`);
}

function addDay(d: string, n: number): string {
  return new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function markdown(r: any): string {
  const lines = [
    `# GTA 6 Day N: dry-run plan`,
    ``,
    `Generated ${r.generated_at}. No uploads, no model calls, a throwaway database.`,
    ``,
    `Settings: ${Object.entries(r.settings)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    ``,
    `Data: ${r.data.inbox_clips} inbox clips (${r.data.gta6_clips} GTA VI), ${r.data.stream_asks} stream asks from ${r.data.stream_asks_from} (${r.data.usable_asks} usable).`,
    `Restart between Day 2 and Day 3: claims before ${JSON.stringify(r.restart.claims_before)}, after ${JSON.stringify(r.restart.claims_after)} (same: ${r.restart.same}).`,
    ``,
  ];
  for (const d of r.days) {
    lines.push(
      `## ${d.label}`,
      ``,
      `- Day number: ${d.day}  |  slot: ${d.slot_at}`,
      `- Title: ${d.title}`,
      `- Answers: ${d.answers_ask}${d.ask_rumour ? " (rumour, labelled)" : ""}  |  theme: ${d.theme}`,
      `- Footage: ${d.footage}`,
      `- Playlist: ${d.playlist.join(", ")}`,
      `- Description lines: ${d.description_daily_lines.join("  /  ")}`,
      `- First comment line: ${d.first_comment_line}`,
      `- Next link written on the day before: ${d.next_link_written_on_day_before.map((x: any) => `${x.video}: ${x.line}`).join("; ") || "none (first day)"}`,
      ``,
    );
  }
  lines.push(
    `Day 1's first comment if written now (Day 2 exists): ${r.day1_comment_if_written_now}`,
    ``,
  );
  if (r.data.asks_blocked_by_spoiler_gate.length) {
    lines.push(`Asks the spoiler gate keeps out of the daily:`, ``);
    for (const a of r.data.asks_blocked_by_spoiler_gate)
      lines.push(`- ${a.question}: ${a.why[0]}`);
  }
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
