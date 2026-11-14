// The Pulse Lab's dry run and stills (src/pulselab). GTA VI is not out yet, so there is no GTA VI footage and no footage
// verdict: this plans every format with the real code paths against the real stored claims (the stream-asks list, the
// previews' seed list, The GTA File's run) and the owner's real GTA V clips, with each stand-in marked as one:
//   - the ledger is built and synced into a throwaway database in the output folder, and written as ledger.md;
//   - the split screen's real library search runs for every open ask (and reports that each skips today);
//   - each format is planned for a GTA V stand-in clip with a SIMULATED verdict, the plan written as JSON;
//   - the tally is counted across simulated earlier Shorts (and survives the database being closed and reopened);
//   - stills of each format are rendered from the real composition (PulseGameplayShort) on the real footage, with a
//     "STAND-IN FOOTAGE" mark; --video also renders one short example.
// Nothing is uploaded, no model is called and the factory's own database is never opened.
//
// Usage: DATA_DIR=<scratch data with streamasks/asks.json> GAMEPLAY_ROOT=<inbox root>
//          node --import tsx src/tools/pulselab-proof.ts <outDir> [--video]

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { loadConfig, type Config } from "../config.ts";
import { createEmbeddedDb, migrate } from "../db.ts";
import { FFMPEG } from "../lib/bin.ts";
import { readAsks } from "../streamasks/job.ts";
import { readMeta } from "../gameplay.ts";
import { cropX } from "../gameplaydirect.ts";
import { getBundle, serveDir, webPath } from "../render/render.ts";
import type { GameplayShortProps } from "../render/GameplayShort.tsx";
import type { LabOverlay } from "../render/labplan.ts";
import { pulseLabSettings } from "../pulselab/settings.ts";
import { buildLedger } from "../pulselab/apply.ts";
import {
  ledgerCounts,
  ledgerMarkdown,
  readLedger,
  syncLedger,
  type LabClaim,
} from "../pulselab/ledger.ts";
import {
  planLab,
  planProblems,
  type LabInput,
  type LabPlan,
} from "../pulselab/plan.ts";
import { claimTally, dayTally, tallyLine } from "../pulselab/tally.ts";
import {
  counterpartWindow,
  findCounterpart,
  libraryClips,
  versusCounterpartArgs,
  versusPrimaryArgs,
  VERSUS_FILES,
} from "../pulselab/versus.ts";
import { listVodIndexes } from "../vodindex/schema.ts";
import { labPoll } from "../pulselab/asked.ts";
import type { StreamAsk } from "../streamasks/asks.ts";

const run = promisify(execFile);
const args = process.argv.slice(2);
const outDir = path.resolve(
  args.find((a) => !a.startsWith("--")) ?? "pulselab-proof",
);
const VIDEO = args.includes("--video");
const MARK = "STAND-IN FOOTAGE: GTA V, SIMULATED VERDICT";

const base = loadConfig();
const cfg: Config = {
  ...base,
  gameplayDirect: true,
  gameplayEnabled: true,
  seriesGtaFileRunFile:
    base.seriesGtaFileRunFile || path.resolve("gta_file_run.json"),
  pulseLab: pulseLabSettings({
    PULSE_LAB: "true",
    PULSE_LAB_RECEIPTS: "true",
    PULSE_LAB_MEASURED: "true",
    PULSE_LAB_TALLY: "true",
    PULSE_LAB_ASKED: "true",
    PULSE_LAB_VERSUS: "true",
  }),
};
const lab = cfg.pulseLab;

/** The stand-in clips: the owner's own GTA V stream clips in the inbox. */
const JUMP = "gp_9aedcbbfac"; // a motorbike off the Maze Bank roof, then the freefall
const SKYDIVE = "gp_d7e6931092"; // a skydive over the city
const TAXI = "gp_50fc132151"; // a taxi stuck on a rocky slope

async function main() {
  await fsp.mkdir(path.join(outDir, "stills"), { recursive: true });
  const notes: string[] = [];
  const now = new Date();
  // 1. The ledger, into a throwaway database that is closed and opened again (a restart).
  const dbDir = path.join(outDir, "db");
  await fsp.rm(dbDir, { recursive: true, force: true });
  let db = await createEmbeddedDb(dbDir);
  await migrate(db);
  const built = await buildLedger(cfg, db, now);
  await syncLedger(db, built);
  await db.close();
  db = await createEmbeddedDb(dbDir);
  await migrate(db);
  const ledger = await readLedger(db, lab.game);
  await fsp.writeFile(
    path.join(outDir, "ledger.md"),
    ledgerMarkdown(ledger, now),
  );
  const counts = ledgerCounts(ledger);
  notes.push(
    `Ledger: ${ledger.length} claims after a restart (${counts.open} open, ${counts.held} held, ${counts.TRUE + counts.FALSE + counts.PARTLY} graded; GTA VI is not out, so no footage verdict exists yet).`,
  );
  const byKind = new Map<string, number>();
  for (const c of ledger) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  notes.push(`Labels: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}.`);

  // 2. The split screen's real library search: GTA V footage of each open ask's test.
  const store = await readAsks(cfg.dataDir);
  const asks = store.asks;
  const metas = [];
  for (const name of await fsp
    .readdir(path.join(cfg.gameplayRoot, "inbox"))
    .catch(() => [] as string[])) {
    const m = await readMeta(path.join(cfg.gameplayRoot, "inbox", name));
    if (m) metas.push(m);
  }
  const library = {
    vods: await listVodIndexes(cfg.dataDir).catch(() => []),
    clips: libraryClips(cfg.gameplayRoot, metas),
  };
  const versusRows = asks
    .filter((a) => a.status === "open")
    .map((a) => {
      const hit = findCounterpart(a, lab.compareGame, library);
      return `| ${a.question.replace(/\|/g, "/")} | ${hit ? `GTA V found: ${hit.why}` : "no GTA V footage of this test"} | skips: no GTA VI footage yet |`;
    });
  await fsp.writeFile(
    path.join(outDir, "versus-library.md"),
    [
      `# 6 vs 5: the library search (${now.toISOString().slice(0, 16)} UTC)`,
      "",
      `${library.clips.length} inbox clips (${library.clips.filter((c) => /grand theft auto v$/i.test(c.game)).length} GTA V) and ${library.vods.length} indexed streams searched for each open ask.`,
      "",
      "| Ask | GTA V side | Format |",
      "| --- | --- | --- |",
      ...versusRows,
    ].join("\n"),
  );
  notes.push(
    `6 vs 5: ${versusRows.filter((r) => r.includes("GTA V found")).length} of ${versusRows.length} open asks have GTA V footage; every one skips itself today because there is no GTA VI footage.`,
  );
  const poll = labPoll(asks);
  if (poll)
    notes.push(
      `Lab poll this week: "${poll.question}" ${poll.options.map((o) => `[${o.text}]`).join(" ")}`,
    );

  // 3. The stand-in cuts (the rebuilt Short's own crop) and the plans.
  const clip = (id: string) =>
    path.join(cfg.gameplayRoot, "inbox", id, "clip.mp4");
  const work = path.join(outDir, "work");
  await fsp.mkdir(work, { recursive: true });
  const jumpCut = {
    segments: [{ start: 30, end: 39.8 }],
    seconds: 9.8,
    payoffAt: 9.4,
  };
  const taxiCut = {
    segments: [{ start: 6, end: 18 }],
    seconds: 12,
    payoffAt: 9,
  };
  await cutPortrait(
    clip(JUMP),
    jumpCut.segments[0]!,
    path.join(work, "jump.mp4"),
    0.5,
    0.5,
  );
  await cutPortrait(
    clip(TAXI),
    taxiCut.segments[0]!,
    path.join(work, "taxi.mp4"),
    0.5,
    0.5,
  );

  const pick = (pred: (c: LabClaim) => boolean) => ledger.find(pred);
  const unofficial =
    pick(
      (c) =>
        c.status === "open" &&
        (c.kind === "leak" || c.kind === "rumour" || c.kind === "myth"),
    ) ?? ledger[0]!;
  const fuel = pick((c) => c.topic === "fuel") ?? ledger[0]!;
  const askOf = (c: LabClaim) => asks.find((a) => a.id === c.askId);
  const lines = {
    hook: "Can you survive this jump?",
    setup: "Most players bail before the edge.",
    payoff_line: "Straight down. No parachute.",
  };
  const jumpTiming = {
    segments: jumpCut.segments,
    actionStart: 35,
    payoff: 39.4,
    payoffAt: jumpCut.payoffAt,
  };
  const taxiTiming = {
    segments: taxiCut.segments,
    actionStart: 7,
    payoff: 15,
    payoffAt: taxiCut.payoffAt,
  };
  const simVerdict = (
    c: LabClaim,
    verdict: "proved" | "disproved",
    reason: string,
  ) => ({
    question: c.question,
    claim: c.claim,
    rumour: c.kind !== "preview" && c.kind !== "official",
    verdict,
    confidence: 0.91,
    reason: `SIMULATED for the proof: ${reason}`,
  });
  const baseInput = (o: Partial<LabInput>): LabInput => ({
    settings: lab,
    game: lab.game,
    question: "CAN YOU SURVIVE THIS JUMP?",
    resultLine: "STRAIGHT DOWN",
    ledger,
    asks,
    timing: jumpTiming,
    lines,
    ...o,
  });
  const only = (f: string) => ({
    ...lab,
    versus: f === "versus",
    receipts: f === "receipts",
    measured: f === "measured",
    asked: f === "asked",
  });
  const viewerAsk: StreamAsk = {
    ...(askOf(fuel) ?? asks[0]!),
    id: "proof-viewer",
    question: "How long is the fall off the tallest building?",
    kind: "question",
    topic: undefined,
    mentions: [
      {
        source: "viewers",
        name: "Pulse viewers",
        at: now.toISOString(),
        text: "how long is the fall off the tallest building?",
        engagement: 5,
        handle: "@pulse_viewer_demo",
      },
    ],
  };
  const plans: Record<string, LabPlan> = {
    receipts: planLab(
      baseInput({
        settings: only("receipts"),
        timing: taxiTiming,
        question: unofficial.question,
        streamAsk: simVerdict(
          unofficial,
          "disproved",
          "the frames show the opposite",
        ),
        lines: {
          hook: unofficial.question,
          setup: "",
          payoff_line: "Not even close.",
        },
      }),
    ),
    receipts_preview: planLab(
      baseInput({
        settings: only("receipts"),
        question: fuel.question,
        streamAsk: simVerdict(fuel, "proved", "Some cars, but not every one."),
        lines: {
          hook: "Can you really run dry?",
          setup: "",
          payoff_line: "Dead.",
        },
      }),
    ),
    measured: planLab(
      baseInput({
        settings: only("measured"),
        question: "How long is the fall off the tallest building?",
      }),
    ),
    asked: planLab(
      baseInput({
        settings: only("asked"),
        asks: [viewerAsk, ...asks],
        liveAsk: viewerAsk.question,
        question: viewerAsk.question,
      }),
    ),
    versus_skip: planLab(
      baseInput({
        settings: only("versus"),
        question: "Can you jump a bike off the tallest building?",
      }),
    ),
    versus: planLab(
      baseInput({
        settings: only("versus"),
        question: "Can you jump off the tallest building?",
        counterpart: {
          kind: "inbox",
          file: clip(SKYDIVE),
          peak: 24,
          duration: 40,
          why: `STAND-IN: inbox clip ${SKYDIVE} (GTA V) for the GTA 6 side's place`,
          ref: SKYDIVE,
        },
      }),
    ),
  };
  const report: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(plans))
    report[k] = {
      ...p,
      problems: planProblems(p, jumpCut.payoffAt, jumpCut.seconds),
    };
  await fsp.writeFile(
    path.join(outDir, "plans.json"),
    JSON.stringify(report, null, 1),
  );

  // 4. The tally across simulated earlier Shorts, through a restart.
  for (let i = 1; i <= 13; i++) {
    const id = `sim_${String(i).padStart(2, "0")}`;
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, lane, story_json) VALUES ($1, $1, 'published', 'gameplay', '{}') ON CONFLICT DO NOTHING`,
      [id],
    );
    await claimTally(
      db,
      "receipts",
      lab.season,
      id,
      i % 3 === 0 ? "FALSE" : i % 5 === 0 ? "PARTLY" : "TRUE",
    );
    await claimTally(db, "myths", lab.season, id, i % 2 ? "proved" : "busted");
  }
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, lane, story_json) VALUES ('proof', 'proof', 'rendered', 'gameplay', '{}') ON CONFLICT DO NOTHING`,
  );
  await db.close();
  db = await createEmbeddedDb(dbDir);
  await migrate(db);
  const receiptsCount = await claimTally(
    db,
    "receipts",
    lab.season,
    "proof",
    plans.receipts!.claim?.grade ?? "FALSE",
  );
  const mythsCount = await claimTally(
    db,
    "myths",
    lab.season,
    "proof",
    "busted",
  );
  const tally = tallyLine("receipts", receiptsCount)!;
  notes.push(
    `Tally after a restart: "${tally.line}" (${tally.sub ?? ""}); "${tallyLine("myths", mythsCount)!.line}"; Day N shows "${dayTally(12).line}".`,
  );
  await db.close();

  // 5. Stills from the real composition.
  const withMark = (
    o: LabOverlay | undefined,
    extra: Partial<LabOverlay> = {},
  ): LabOverlay => ({ ...(o as LabOverlay), ...extra, proofMark: MARK });
  await fsp.copyFile(clip(SKYDIVE), path.join(work, "skydive.mp4"));
  await run(
    FFMPEG,
    versusPrimaryArgs(
      clip(JUMP),
      jumpCut.segments,
      path.join(work, VERSUS_FILES.primary),
    ),
    { maxBuffer: 1 << 24 },
  );
  await run(
    FFMPEG,
    versusCounterpartArgs(
      clip(SKYDIVE),
      counterpartWindow(
        { peak: 24, duration: 40 },
        jumpCut.payoffAt,
        jumpCut.seconds + 2,
      ),
      path.join(work, VERSUS_FILES.counterpart),
    ),
    { maxBuffer: 1 << 24 },
  );
  const shots: Array<{
    name: string;
    video: string;
    seconds: number;
    payoffAt: number;
    hook: string;
    result: string;
    lab: LabOverlay;
    at: number[];
  }> = [
    {
      name: "receipts",
      video: "taxi.mp4",
      seconds: taxiCut.seconds,
      payoffAt: taxiCut.payoffAt,
      hook: plans.receipts!.lines?.hook ?? "",
      result: "",
      lab: withMark(plans.receipts!.overlay, {
        tag: { segment: "RECEIPTS", number: receiptsCount.total },
        tally,
      }),
      at: [0.4, 6, 9.8],
    },
    {
      name: "receipts-partly",
      video: "jump.mp4",
      seconds: jumpCut.seconds,
      payoffAt: jumpCut.payoffAt,
      hook: plans.receipts_preview!.lines?.hook ?? "",
      result: "",
      lab: withMark(plans.receipts_preview!.overlay, {
        tag: { segment: "RECEIPTS", number: 15 },
        tally: {
          line: "Receipts: 15 graded",
          sub: "Day 12 · 9 true, 4 false, 2 partly",
        },
      }),
      at: [9.7],
    },
    {
      name: "measured",
      video: "jump.mp4",
      seconds: jumpCut.seconds,
      payoffAt: jumpCut.payoffAt,
      hook: "How long is the fall?",
      result: "",
      lab: withMark(plans.measured!.overlay, {
        tag: { segment: "I MEASURED IT", number: 7 },
        tally: { line: "Lab: 7 measured" },
      }),
      at: [0.4, 7.2, 9.7],
    },
    {
      name: "asked",
      video: "jump.mp4",
      seconds: jumpCut.seconds,
      payoffAt: jumpCut.payoffAt,
      hook: "How long is the fall?",
      result: "STRAIGHT DOWN",
      lab: withMark(plans.asked!.overlay, {
        tag: { segment: "YOU ASKED", number: 5 },
        tally: { line: "You asked: 5 tested" },
      }),
      at: [1.2, 7],
    },
    {
      name: "versus",
      video: "",
      seconds: jumpCut.seconds,
      payoffAt: jumpCut.payoffAt,
      hook: "Tallest building, both games",
      result: "BOTH SURVIVE THE DROP",
      lab: withMark(plans.versus!.overlay, {
        tag: { segment: "6 VS 5", number: 4 },
        tally: { line: "GTA 6 vs 5: 4 tests" },
        versus: {
          ...plans.versus!.overlay!.versus!,
          aLabel: "GTA 6 (STAND-IN)",
          aResult: "OFF THE ROOF",
          bResult: "SKYDIVE",
        },
      }),
      at: [0.4, 9.8],
    },
    {
      name: "tally-day",
      video: "taxi.mp4",
      seconds: taxiCut.seconds,
      payoffAt: taxiCut.payoffAt,
      hook: "Can a taxi climb this?",
      result: "STUCK FOR GOOD",
      lab: {
        format: "tally",
        tally: { line: "Myths: 9 proved, 6 busted", sub: "Day 12" },
        proofMark: MARK,
      },
      at: [0.4],
    },
  ];
  const serveUrl = await getBundle();
  const files = await serveDir(work);
  const rendered: string[] = [];
  try {
    for (const shot of shots) {
      const props: GameplayShortProps = {
        videoSrc: shot.video ? `${files.url}/${webPath(shot.video)}` : "",
        voiceSrc: null,
        words: [],
        durationSeconds: shot.seconds,
        hook: shot.hook.toUpperCase(),
        hookEnd: 2.4,
        resultLine: shot.result,
        payoffAt: shot.payoffAt,
        voiced: [],
        accent: "#FF6B1A",
        lab: shot.lab.versus
          ? {
              ...shot.lab,
              versus: {
                ...shot.lab.versus,
                aSrc: `${files.url}/${VERSUS_FILES.primary}`,
                bSrc: `${files.url}/${VERSUS_FILES.counterpart}`,
              },
            }
          : shot.lab,
      };
      const composition = await selectComposition({
        serveUrl,
        id: "PulseGameplayShort",
        inputProps: props,
      });
      for (const t of shot.at) {
        const out = path.join(
          outDir,
          "stills",
          `${shot.name}-${t.toFixed(1)}s.jpg`,
        );
        await renderStill({
          composition,
          serveUrl,
          output: out,
          inputProps: props,
          frame: Math.min(
            composition.durationInFrames - 1,
            Math.round(t * composition.fps),
          ),
          imageFormat: "jpeg",
          jpegQuality: 88,
        });
        rendered.push(out);
      }
      if (VIDEO && shot.name === "receipts") {
        const out = path.join(outDir, "receipts-example.mp4");
        await renderMedia({
          composition,
          serveUrl,
          codec: "h264",
          crf: 20,
          pixelFormat: "yuv420p",
          outputLocation: out,
          inputProps: props,
          concurrency: 2,
        });
        rendered.push(out);
      }
    }
  } finally {
    await files.close();
  }
  notes.push(`Rendered ${rendered.length} files.`);
  await fsp.writeFile(
    path.join(outDir, "notes.md"),
    [
      "# Pulse Lab dry run",
      "",
      ...notes.map((n) => `- ${n}`),
      "",
      "Stills:",
      ...rendered.map((r) => `- ${path.basename(r)}`),
    ].join("\n"),
  );
  console.log(notes.join("\n"));
}

/** The rebuilt Short's crop of a 16:9 clip stretch to 1080x1920 (src/gameplaydirect.ts cropX), game sound kept. */
async function cutPortrait(
  src: string,
  seg: { start: number; end: number },
  out: string,
  f0: number,
  f1: number,
) {
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      String(seg.start),
      "-t",
      String(seg.end - seg.start),
      "-i",
      src,
      "-vf",
      `scale=-2:1920,crop=1080:1920:x='${cropX(f0, f1, 1)}':y=0,fps=30,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      out,
    ],
    { maxBuffer: 1 << 24 },
  );
}

await main();
