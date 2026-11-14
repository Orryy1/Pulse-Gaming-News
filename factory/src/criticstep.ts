// CRITIC: the finished-video critic, between the render and the upload (src/qa/criticcore.ts holds the rules).
//
// runCritic watches one finished MP4: full-frame-rate measurements (black and white flashes, frozen pictures, cuts,
// true silence), the first seven seconds through the opening's ad-safety screen (src/openingstep.ts, the gate the
// strategy work builds on), a frame at every cut and every two seconds judged by a local vision model against the
// line spoken over it (and for another game, a fan mod, someone else's watermark), and each graphic read off its
// settled frame (Windows or Apple OCR, the model as a second opinion). It writes report.json, report.md and the
// frames into the episode's qa/critic folder and returns the report.
//
// criticStep is the pipeline's call, at release (src/pipeline.ts stepRequestApproval), under CRITIC:
// - off: nothing runs;
// - report: the report is written and logged, the video carries on;
// - fix: a clean video carries on; faults the renderer can mend get one timeline fix pass (a faulted shot's clip or
//   still leaves the episode so the re-plan picks another, a card is held for its reading time, an unreadable graphic
//   is dropped) and the episode goes back to render; anything else, or anything left after that pass, holds the video
//   for the owner with the reasons, and the faulted pictures leave the episode's media so the shot picker never
//   offers them again.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { logEvent, transition, type Episode } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { dropOffending } from "./qa/retry.ts";
import { readText } from "./assets/ocr.ts";
import {
  AD_SAFE_SECONDS,
  adSafeProblem,
  lookOpeningFrame,
  type OpeningLook,
} from "./openingstep.ts";
import {
  chapterGameAt,
  findingsOf,
  graphicAt,
  graphicTiming,
  lineAt,
  ocrShare,
  openingTimes,
  reportMarkdown,
  sampleTimes,
  scoresOf,
  verdictOf,
  type CriticFixPlan,
  type CriticReport,
  type CriticSettings,
  type CriticTimeline,
  type CriticWord,
  type FrameJudgement,
  type GraphicCheck,
  type JudgedSample,
  type Measurements,
  type OpeningCheck,
} from "./qa/criticcore.ts";
import { framesAt, measureVideo } from "./qa/criticmeasure.ts";
import {
  graphicVisible,
  judgeFrame,
  withCriticModel,
  type ModelChoice,
} from "./qa/criticvision.ts";
import { criticTimeline, type TimelineDeps } from "./qa/critictimeline.ts";

/** What runCritic calls for the slow parts; tests replace them. */
export interface CriticDeps {
  measure: (video: string) => Promise<Measurements>;
  frames: (
    video: string,
    dir: string,
    times: number[],
    prefix: string,
  ) => Promise<string[]>;
  /** The opening's ad-safety look at one frame (undefined: not screened). */
  opening: (file: string) => Promise<OpeningLook | undefined>;
  /** Words read off each picture (file to its words). */
  ocr: (files: string[]) => Promise<Map<string, string[]>>;
  /** Runs the judging with the model ready (a big one inside a gpu turn). */
  withModel: <T>(fn: (choice: ModelChoice) => Promise<T>) => Promise<T>;
  judge: (
    model: string,
    file: string,
    ask: { line: string; game: string; chapterGame?: string; graphic?: string },
  ) => Promise<FrameJudgement | undefined>;
  visible: (
    model: string,
    file: string,
    text: string,
  ) => Promise<boolean | undefined>;
  now: () => Date;
}

export function defaultCriticDeps(
  settings: CriticSettings,
  est: number,
  priority = 60,
): CriticDeps {
  return {
    measure: (video) => measureVideo(video),
    frames: (video, dir, times, prefix) =>
      framesAt(video, dir, times, { prefix, width: 512, parallel: 4 }),
    opening: (file) => lookOpeningFrame(file),
    ocr: async (files) => {
      const pages = await readText(files);
      return new Map(
        [...pages].map(([f, p]) => [f, p.words.map((w) => w.text)]),
      );
    },
    withModel: (fn) =>
      withCriticModel(
        settings,
        { job: "Pulse finished-video critic", est, priority },
        fn,
      ),
    judge: (model, file, ask) => judgeFrame(model, file, ask),
    visible: (model, file, text) => graphicVisible(model, file, text),
    now: () => new Date(),
  };
}

export interface CriticRunInput {
  episode: string;
  video: string;
  /** The report folder (frames go in its frames/ folder). */
  dir: string;
  tl: CriticTimeline;
  words: CriticWord[];
  settings: CriticSettings;
  pass: number;
  /** Clips and stills the episode holds, so the fix pass never starves the re-plan. */
  mediaLeft?: { clips: number; images: number };
  title?: string;
}

/** Runs the 2-at-a-time worker pool over `items`. */
async function pool<T>(
  items: T[],
  n: number,
  fn: (x: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

/** Watches one finished video and writes its report. */
export async function runCritic(
  input: CriticRunInput,
  deps: CriticDeps,
): Promise<{ report: CriticReport; plan: CriticFixPlan }> {
  const started = deps.now().getTime();
  const { tl, settings } = input;
  const framesDir = path.join(input.dir, "frames");
  await fs.rm(input.dir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });
  const notes: string[] = [];
  const rel = (f: string) => (f ? `frames/${path.basename(f)}` : undefined);

  // 1. The picture and the sound at the full frame rate.
  const measured = await deps.measure(input.video);

  // 2. The first seven seconds, for advertisers, through the opening's own screen (before any big model loads).
  const oTimes = openingTimes(tl.duration, AD_SAFE_SECONDS - 0.01, 4);
  const oFiles = await deps.frames(input.video, framesDir, oTimes, "o");
  const opening: OpeningCheck[] = [];
  await pool(oTimes, 2, async (t, i) => {
    const file = oFiles[i];
    const look = file
      ? await deps.opening(file).catch(() => undefined)
      : undefined;
    opening[i] = {
      t,
      screened: !!look,
      problem: look ? adSafeProblem(look) : undefined,
      frame: rel(file ?? ""),
    };
  });
  if (!opening.some((o) => o.screened))
    notes.push(
      "the first 7 seconds were not screened: the picture checker did not answer",
    );

  // 3. Frames at every cut and every few seconds, and each graphic's settled frame.
  const samples: JudgedSample[] = sampleTimes(
    tl,
    settings.everySeconds,
    settings.maxFrames,
  ).map((s) => ({
    ...s,
    line: lineAt(tl.lines, s.t)?.text ?? "",
    graphic: graphicAt(tl.graphics, s.t)?.text,
  }));
  const sFiles = await deps.frames(
    input.video,
    framesDir,
    samples.map((s) => s.t),
    "s",
  );
  samples.forEach((s, i) => (s.frame = rel(sFiles[i] ?? "")));
  const gList = tl.graphics.filter((g) => g.text.trim() && g.to > g.from);
  const gTimes = gList.map((g) =>
    Math.min(g.to - 0.05, g.from + Math.min(0.6, (g.to - g.from) / 3)),
  );
  const gFiles = await deps.frames(input.video, framesDir, gTimes, "g");
  const read = await deps
    .ocr(gFiles.filter(Boolean))
    .catch(() => new Map<string, string[]>());
  const graphics: GraphicCheck[] = gList.map((g, i) => {
    const timing = graphicTiming(g);
    const words = gFiles[i] ? read.get(gFiles[i]!) : undefined;
    return {
      key: g.key,
      kind: g.kind,
      from: g.from,
      to: g.to,
      text: g.text,
      shown: timing.shown,
      need: timing.need,
      ...(words ? { read: ocrShare(g.text, words) } : {}),
      frame: rel(gFiles[i] ?? ""),
    };
  });
  if (gList.length && !read.size)
    notes.push(
      "no picture-text reader on this machine: graphics were checked by the model alone",
    );

  // 4. The model's look at each frame, and at each graphic OCR could not find.
  const model = await deps.withModel(async (choice) => {
    let failures = 0;
    await pool(samples, 2, async (s, i) => {
      const file = sFiles[i];
      if (!file || failures >= 5) return;
      try {
        s.judgement = await deps.judge(choice.model, file, {
          line: s.line,
          game: tl.game,
          chapterGame: chapterGameAt(tl, s.t),
          graphic: s.graphic,
        });
      } catch (err) {
        failures++;
        if (failures === 5)
          notes.push(
            `the vision model stopped answering (${errorMessage(err).slice(0, 120)}): the rest of the frames were not judged`,
          );
      }
    });
    await pool(graphics, 2, async (g, i) => {
      const file = gFiles[gList.findIndex((x) => x.key === g.key)];
      if (!file || (g.read !== undefined && g.read >= 0.5) || failures >= 5)
        return;
      g.visible = await deps
        .visible(choice.model, file, g.text)
        .catch(() => undefined);
      if (g.read === undefined && g.visible === false) g.read = 0;
    });
    return choice;
  });
  notes.push(`judged by ${model.why}`);

  // 5. Findings, scores, the verdict and the fix plan.
  const findings = findingsOf({
    tl,
    samples,
    graphics,
    opening,
    measured,
    settings,
    words: input.words,
  });
  const scores = scoresOf({ tl, samples, graphics }, findings);
  const v = verdictOf(tl, findings, {
    pass: input.pass,
    mediaLeft: input.mediaLeft,
  });
  const report: CriticReport = {
    version: 1,
    episode: input.episode,
    kind: tl.kind,
    model: model.model,
    mode: settings.mode,
    pass: input.pass,
    verdict: v.verdict,
    scores,
    findings,
    samples,
    graphics,
    opening,
    measured,
    reasons: v.reasons,
    notes,
    seconds: (deps.now().getTime() - started) / 1000,
    checkedAt: deps.now().toISOString(),
  };
  await fs.writeFile(
    path.join(input.dir, "report.json"),
    JSON.stringify({ ...report, plan: v.plan }, null, 1),
  );
  await fs.writeFile(
    path.join(input.dir, "report.md"),
    reportMarkdown(report, input.title ?? tl.headline),
  );
  return { report, plan: v.plan };
}

// ---------------------------------------------------------------- the pipeline's step

export interface CriticServices {
  db: Db;
  cfg: Pick<Config, "critic" | "graphicsAudit">;
  notify: (m: DiscordMessage) => Promise<unknown>;
  now: () => Date;
  episodeDir: (id: string) => string;
  /** Replaces the slow parts (tests). */
  deps?: CriticDeps;
}

/** The fix plan applied to an episode's assets (pure apart from the copy it returns): what leaves, what holds. */
export function applyFixPlan(
  assets: NonNullable<Episode["assets_json"]>,
  plan: CriticFixPlan,
  kind: "short" | "long",
): {
  assets: NonNullable<Episode["assets_json"]>;
  dropped: { clips: number; images: number };
  files: string[];
} {
  const a = JSON.parse(JSON.stringify(assets)) as NonNullable<
    Episode["assets_json"]
  > &
    Record<string, any>;
  const files = [
    ...plan.dropClips.map((i) => a.clips?.[i]?.file),
    ...plan.dropImages.map((i) => a.images?.[i]?.file),
  ].filter((f): f is string => typeof f === "string");
  const dropped = dropOffending(
    a as { clips?: unknown[]; images?: unknown[] },
    {
      clips: new Set(plan.dropClips),
      images: new Set(plan.dropImages),
      allClips: false,
    },
  );
  if (kind === "short") {
    if (plan.holds.length)
      a.criticHolds = {
        ...(a.criticHolds ?? {}),
        ...Object.fromEntries(
          plan.holds.map((h) => [h.key, [h.from, h.to] as [number, number]]),
        ),
      };
    if (plan.mutes.length)
      a.gfxMuted = [...new Set([...(a.gfxMuted ?? []), ...plan.mutes])];
  } else if (plan.mutes.length)
    a.quietMoments = [...new Set([...(a.quietMoments ?? []), ...plan.mutes])];
  if (files.length)
    a.criticDropped = [...new Set([...(a.criticDropped ?? []), ...files])];
  return { assets: a, dropped, files };
}

/** The files of the clips and stills a fix plan names (pure). */
export function faultedFiles(assets: NonNullable<Episode["assets_json"]>, plan: Pick<CriticFixPlan, "dropClips" | "dropImages">): string[] {
  const a = assets as { clips?: Array<{ file?: string }>; images?: Array<{ file?: string }> };
  return [...plan.dropClips.map((i) => a.clips?.[i]?.file), ...plan.dropImages.map((i) => a.images?.[i]?.file)].filter(
    (f): f is string => typeof f === "string",
  );
}

/**
 * Before a new plan (src/pipeline.ts stepRender, stepRenderLong): the clips and stills the critic faulted leave the
 * episode's media, never its last still. Returns how many left; the caller saves the assets when any did.
 */
export function dropCriticFaulted(assets: { clips?: Array<{ file?: string }>; images?: Array<{ file?: string }>; criticDropped?: string[] }): number {
  const bad = new Set(assets.criticDropped ?? []);
  if (!bad.size) return 0;
  const clips = (assets.clips ?? []).filter((c) => !bad.has(c.file ?? ""));
  const images = (assets.images ?? []).filter((c) => !bad.has(c.file ?? ""));
  const n = (assets.clips?.length ?? 0) - clips.length + (images.length ? (assets.images?.length ?? 0) - images.length : 0);
  if (assets.clips) assets.clips = clips;
  if (assets.images && images.length) assets.images = images;
  return n;
}

/** The owner's notice for a held video (pure). */
export function blockedNotice(
  title: string,
  report: CriticReport,
  links: { approve: string; reject: string; preview: string },
): DiscordMessage {
  const worst = report.findings.filter((f) => f.level !== "warn").slice(0, 8);
  return {
    ping: true,
    embeds: [
      {
        title: `🎞️ Held by the critic: ${title}`,
        url: links.preview,
        description: [
          `The finished video scored ${report.scores.overall}/100 (pictures ${report.scores.match.toFixed(2)} of 3 against the words).`,
          "**Why:**",
          ...report.reasons.slice(0, 6).map((r) => `• ${r}`),
          ...(worst.length
            ? ["**Where:**", ...worst.map((f) => `• ${f.detail}`)]
            : []),
          "",
          "Approve publishes it exactly as judged. Any re-render leaves the faulted pictures out, so the shot picker chooses others.",
          `▶️ [Watch](${links.preview})  ·  ✅ [Approve as it is](${links.approve})  ·  ❌ [Reject](${links.reject})`,
        ].join("\n"),
      },
    ],
  };
}

/**
 * The critic at release. Returns true when it took the episode out of the release path (sent back to render or
 * held for the owner); false when it goes on to its usual publish path.
 */
export async function criticStep(
  s: CriticServices,
  ep: Episode,
  ctx: {
    links: { approve: string; reject: string; preview: string };
    timeline: Pick<TimelineDeps, "segmentInputs" | "stampsFor">;
  },
): Promise<boolean> {
  const settings = s.cfg.critic;
  if (settings.mode === "off" || ep.lane === "twin") return false;
  const assets = ep.assets_json;
  if (!assets?.video) return false;
  const title =
    ep.script_json?.youtube?.title ?? ep.script_json?.headline ?? ep.id;
  const tl = criticTimeline(ep as never, {
    ...ctx.timeline,
    gfxFix: s.cfg.graphicsAudit === "fix",
  });
  if (!tl) return false;
  const pass = assets.criticPass ?? 0;
  const dir = path.join(s.episodeDir(ep.id), "qa", "critic");
  // The same render is never judged twice (a notice that failed brings the episode back here).
  const prior = (ep.qa_json?.critic ?? undefined) as
    | { for?: unknown; verdict?: string }
    | undefined;
  if (
    prior &&
    prior.for === (ep.qa_json?.checked_at ?? null) &&
    prior.verdict === "pass"
  )
    return false;
  let out: Awaited<ReturnType<typeof runCritic>>;
  try {
    const est = Math.max(3, Math.ceil(tl.duration / 30));
    out = await runCritic(
      {
        episode: ep.id,
        video: path.join(s.episodeDir(ep.id), assets.video),
        dir,
        tl,
        words: (assets.words ?? []) as CriticWord[],
        settings,
        pass,
        mediaLeft: {
          clips: assets.clips?.length ?? 0,
          images: assets.images?.length ?? 0,
        },
        title,
      },
      s.deps ?? defaultCriticDeps(settings, est),
    );
  } catch (err) {
    log("warn", "critic could not run", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "critic", {
      skipped: errorMessage(err).slice(0, 300),
    });
    return false;
  }
  const { report, plan } = out;
  const summary = {
    for: ep.qa_json?.checked_at ?? null,
    verdict: report.verdict,
    pass,
    model: report.model,
    scores: report.scores,
    findings: report.findings.slice(0, 40).map(({ frame: _f, ...f }) => f),
    reasons: report.reasons,
    plan,
  };
  await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify({ ...(ep.qa_json ?? {}), critic: summary }),
  ]);
  await logEvent(s.db, ep.id, "critic", summary);
  log(report.verdict === "pass" ? "info" : "warn", "critic", {
    episode: ep.id,
    verdict: report.verdict,
    overall: report.scores.overall,
    match: report.scores.match,
  });
  if (settings.mode === "report" || report.verdict === "pass") return false;
  if (report.verdict === "fix") {
    const fixed = applyFixPlan(assets, plan, tl.kind);
    const {
      plan: _p,
      longPlan: _lp,
      ...withoutPlan
    } = fixed.assets as typeof fixed.assets & {
      plan?: unknown;
      longPlan?: unknown;
    };
    const moved = await transition(s.db, ep.id, "rendered", "voiced", {
      assets_json: { ...withoutPlan, criticPass: pass + 1 },
    });
    if (!moved) return true;
    await logEvent(s.db, ep.id, "critic_fix", {
      steps: plan.steps,
      dropped: fixed.dropped,
      files: fixed.files,
    });
    await s
      .notify({
        level: "info",
        content: `🎞️ The critic sent "${title}" back for one fix pass: ${plan.steps.slice(0, 6).join("; ")}.`,
      })
      .catch(() => undefined);
    return true;
  }
  // Blocked: the owner decides. The rendered video and its plan stay exactly as they are (Approve publishes what was
  // judged); the faulted pictures are only listed, and any later plan leaves them out (dropCriticFaulted).
  const files = faultedFiles(assets, plan);
  const held = await transition(s.db, ep.id, "rendered", "awaiting_approval", {
    approval_mode: "manual",
    approval_requested_at: s.now(),
    assets_json: {
      ...assets,
      criticBlocked: report.reasons,
      criticDropped: [...new Set([...(assets.criticDropped ?? []), ...files])],
    },
  });
  if (!held) return true;
  await logEvent(s.db, ep.id, "critic_blocked", {
    reasons: report.reasons,
    dropped: files,
  });
  await s
    .notify(blockedNotice(title, report, ctx.links))
    .catch(() => undefined);
  return true;
}
