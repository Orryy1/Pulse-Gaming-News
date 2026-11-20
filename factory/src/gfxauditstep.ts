// The render steps' calls into the graphics audit (src/qa/gfxaudit.ts), kept out of src/pipeline.ts so the steps'
// edits stay a few lines. GRAPHICS_AUDIT=report measures and logs; =fix also applies the fixes the renderer reads
// (cards moved or held through visual.span, trimmed or dropped, word moments and shelf strips dropped, fillers that
// cut a card taken off) and fails the render only for a wrong graphic it cannot drop. Every fix is its own
// `graphics_fix` event and the audit's totals a `graphics_audit` event, which the alert digest sums each morning.
// GRAPHICS_FRAME_CHECK adds the after-render half: each card's settled frame goes to the picture checker for text
// that is cut off, overlapping or unreadable, and a faulted card is dropped from the retry's plan.

import type { Services } from "./pipeline.ts";
import { logEvent } from "./episodes.ts";
import type { Db } from "./db.ts";
import type { RenderPlan } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import { FatalError, log } from "./lib/util.ts";
import {
  auditLongGraphics,
  auditShortGraphics,
  fixShortGraphics,
  graphicsDigestLine,
  gfxSummary,
  readNeed,
  READ_PER_WORD_MIN,
  shortElements,
  type ShortGfxInput,
} from "./qa/gfxaudit.ts";
import { framesNamed } from "./qa/vision.ts";

/** What the Short's render goes on with: the audited segments, stamps, shelf and craft. */
export interface ShortGateOut {
  segments: Segment[];
  stamps: ShortGfxInput["stamps"];
  shelf: RenderPlan["shelf"];
  craft: RenderPlan["craft"];
  summary: string;
}

/**
 * The gate on a Short, before its render. `muted`: cards the frame check faulted on an earlier render (keys
 * "card3"), dropped first. Throws a FatalError in fix mode when a wrong graphic is left.
 */
export async function graphicsGateShort(
  s: Pick<Services, "db" | "cfg">,
  episodeId: string,
  input: ShortGfxInput,
  muted: string[] = [],
): Promise<ShortGateOut | undefined> {
  const mode = s.cfg.graphicsAudit;
  if (mode === "off") return undefined;
  // The frame check's faults from the last render: those cards are not drawn again.
  const segments = input.segments.map((g, i) =>
    muted.includes(`card${i}`) && g.kind !== "take" && g.visual?.kind !== "rank"
      ? { ...g, visual: undefined }
      : g,
  );
  for (const k of muted)
    await logEvent(s.db, episodeId, "graphics_fix", {
      key: k,
      action: "drop",
      detail: "the frame check found its text cut off or overlapping",
    });
  const start = { ...input, segments };
  if (mode === "report") {
    const audit = auditShortGraphics(start);
    await logEvent(s.db, episodeId, "graphics_audit", {
      mode,
      stats: audit.stats,
      findings: audit.findings.slice(0, 40),
      unreadableBefore: audit.stats.unreadable,
      unreadableAfter: audit.stats.unreadable,
      fixes: 0,
      dropped: 0,
      wrong: audit.stats.wrong,
    });
    return undefined;
  }
  const r = fixShortGraphics(start);
  const summary = gfxSummary(r);
  for (const f of r.fixes)
    await logEvent(s.db, episodeId, "graphics_fix", { ...f });
  const failed = r.wrong.length > 0;
  await logEvent(s.db, episodeId, "graphics_audit", {
    mode,
    summary,
    before: r.before.stats,
    after: r.after.stats,
    findings: r.before.findings.filter((f) => f.level !== "warn").slice(0, 40),
    unreadableBefore: r.before.stats.unreadable,
    unreadableAfter: r.after.stats.unreadable,
    fixes: r.fixes.length + muted.length,
    dropped: r.fixes.filter((f) => f.action === "drop").length + muted.length,
    wrong: r.wrong.length,
    failed,
  });
  log("info", "graphics audit", {
    episode: episodeId,
    summary,
  });
  if (failed)
    throw new FatalError(
      `graphics audit: ${r.wrong.map((w) => `${w.t} s ${w.key}: ${w.detail}`).join("; ")}`,
    );
  return {
    segments: r.segments,
    stamps: r.stamps,
    shelf: r.shelf,
    craft: r.craft,
    summary,
  };
}

/**
 * A long video's sentence graphics, before its render: report mode logs; fix mode also mutes the graphics that
 * would be gone in under half their reading time (a flash nobody can read) or show a wrong figure. Returns the keys
 * to mute (they join assets.quietMoments, which the renderer and the graphics check already read).
 */
export async function graphicsGateLong(
  s: Pick<Services, "db" | "cfg">,
  episodeId: string,
  input: Parameters<typeof auditLongGraphics>,
): Promise<string[]> {
  const mode = s.cfg.graphicsAudit;
  if (mode === "off") return [];
  const audit = auditLongGraphics(...input);
  const mute =
    mode === "fix"
      ? audit.elements
          .filter(
            (e) =>
              (e.shown > 0 &&
                e.shown < 0.5 * readNeed(e.words, READ_PER_WORD_MIN)) ||
              audit.findings.some(
                (f) => f.key === e.key && f.level === "wrong",
              ),
          )
          .map((e) => e.key)
      : [];
  for (const key of mute) {
    const why = audit.findings.find(
      (f) => f.key === key && (f.level === "wrong" || f.check === "reading"),
    );
    await logEvent(s.db, episodeId, "graphics_fix", {
      key,
      action: "drop",
      detail: why?.detail ?? "unreadable",
    });
  }
  await logEvent(s.db, episodeId, "graphics_audit", {
    mode,
    long: true,
    stats: audit.stats,
    findings: audit.findings.filter((f) => f.level !== "warn").slice(0, 60),
    unreadableBefore: audit.stats.unreadable,
    unreadableAfter: Math.max(0, audit.stats.unreadable - mute.length),
    fixes: mute.length,
    dropped: mute.length,
    wrong: audit.stats.wrong,
  });
  return mute;
}

/** The frames the after-render check looks at: each card's settled moment (a second in, or its middle). */
export function cardCheckTimes(
  input: ShortGfxInput,
  max = 6,
): Array<{ key: string; t: number }> {
  const fps = input.plan.fps;
  return shortElements(input)
    .elements.filter(
      (e) =>
        (e.kind === "card" || e.kind === "take" || e.kind === "entry") &&
        e.to - e.from >= 12,
    )
    .map((e) => ({
      key: e.key,
      t: (e.from + Math.min(30, Math.floor((e.to - e.from) / 2))) / fps,
    }))
    .slice(0, max);
}

/** The keys of the cards whose frames the checker faulted ("Frame 2: ..." is the second card checked). */
export function faultedCards(
  problems: string[],
  checked: Array<{ key: string }>,
): string[] {
  return framesNamed(problems)
    .map((n) => checked[n - 1]?.key)
    .filter((k): k is string => !!k);
}

/** The alert digest's graphics line for the last day (undefined on a day without an audit). */
export async function graphicsDigest(
  db: Db,
  now: Date,
): Promise<string | undefined> {
  const rows = await db.query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM events WHERE kind = 'graphics_audit' AND created_at > $1`,
    [new Date(now.getTime() - 24 * 3_600_000).toISOString()],
  );
  return graphicsDigestLine(
    rows.map(
      (r) => r.detail as Parameters<typeof graphicsDigestLine>[0][number],
    ),
  );
}
