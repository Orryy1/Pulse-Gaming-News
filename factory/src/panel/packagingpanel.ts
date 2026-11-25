// The packaging panel (PACKAGING_PANEL, top creator gap plan, 19 Nov 2026), long videos only: the evidence says a
// Short's title barely matters and a long video's title and thumbnail do. It takes the candidates the factory already
// makes (the Packaging Lab's top five when PACKAGING_LAB is on, otherwise the title variants and the current title,
// and the thumbnail-text candidates) and asks the audience critic which it would tap, blind ("packaging.viewer", one
// call a video). The titles are shuffled among reference titles from other channels when
// data/frontier/reference_titles.json exists (an optional JSON array of {title, channel, views} a weekly task keeps),
// so the critic cannot tell which are ours; without the file, the candidates alone.
//   check: the panel's order is recorded beside what the factory chose. Nothing changes.
//   on:    the panel's first choice among the factory's own candidates is used, never a reference title; the current
//          title or words win ties, and the caller may hold a candidate out (a strand's frame).
// Pure but the call helper and runPackagingPanel, whose call is injected.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import {
  hookCandidates,
  type CandidateSource,
} from "../packaging/candidates.ts";
import {
  panelPick,
  runPanel,
  seededShuffle,
  type PanelCandidate,
  type PanelRule,
} from "./panel.ts";

// ---------------------------------------------------------------- the numbers, in one place

export const PACKAGING_PANEL = {
  /** The factory's own title candidates shown at most (the lab's top five). */
  titlesMax: 5,
  /** Thumbnail-text candidates shown at most. */
  thumbsMax: 4,
  /** Reference titles mixed in at most. */
  referencesMax: 8,
  /** One call a video. */
  calls: 1,
  markMin: 1,
  markMax: 10,
} as const;

export const PACKAGING_VIEWER_SITE = "packaging.viewer";
/** Under the data directory. */
export const REFERENCE_TITLES_FILE = path.join(
  "frontier",
  "reference_titles.json",
);

export type PackagingPanelMode = "off" | "check" | "on";

/** Whether the panel runs (pure): PACKAGING_PANEL on or check, a long video (never a Short), not already read. */
export function packagingPanelRuns(
  mode: PackagingPanelMode,
  o: { long: boolean; script: Pick<Script, "packaging_panel"> },
): mode is Exclude<PackagingPanelMode, "off"> {
  return mode !== "off" && o.long && !o.script.packaging_panel;
}

// ---------------------------------------------------------------- the candidates

export interface PackagingCandidates {
  /** Where the titles came from: the lab's ranking or the variants and the current title. */
  source: "lab" | "variants";
  titles: Array<{ text: string; origin: string }>;
  thumbs: Array<{ text: string; origin: string }>;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$£€%]/g, "");

/**
 * The factory's own candidates (pure): the lab's top titles when it ranked them (passing its clarity check), else the
 * current title and its variants; the current title always among them, first. Thumbnail words: the current ones first,
 * then the lab's hook-word candidates drawn from the video.
 */
export function packagingCandidates(
  script: Script,
  lab?: ReadonlyArray<{ text: string; origin: string }>,
): PackagingCandidates {
  const titles: PackagingCandidates["titles"] = [];
  const seen = new Set<string>();
  const add = (
    list: typeof titles,
    s: Set<string>,
    text: string | undefined,
    origin: string,
    max: number,
  ) => {
    const t = (text ?? "").replace(/\s+/g, " ").trim();
    if (!t || s.has(norm(t)) || list.length >= max) return;
    s.add(norm(t));
    list.push({ text: t, origin });
  };
  add(titles, seen, script.youtube.title, "current", PACKAGING_PANEL.titlesMax);
  const source = lab?.length ? "lab" : "variants";
  if (lab?.length)
    for (const c of lab)
      add(titles, seen, c.text, c.origin, PACKAGING_PANEL.titlesMax);
  else
    for (const v of script.youtube.title_variants ?? [])
      add(titles, seen, v, "variant", PACKAGING_PANEL.titlesMax);
  const thumbs: PackagingCandidates["thumbs"] = [];
  const seenT = new Set<string>();
  add(
    thumbs,
    seenT,
    script.youtube.thumb_text,
    "current",
    PACKAGING_PANEL.thumbsMax,
  );
  const s = script as unknown as Record<string, any>;
  const src: CandidateSource = {
    title: script.youtube.title,
    variants: script.youtube.title_variants ?? [],
    headline: s.headline,
    hook: s.hook,
    game: s.game_title || undefined,
    rumour: s.is_rumour === true,
    thumbText: script.youtube.thumb_text,
  };
  for (const c of hookCandidates(src, PACKAGING_PANEL.thumbsMax + 2))
    add(
      thumbs,
      seenT,
      c.text,
      c.origin === "writer" ? "current" : c.origin,
      PACKAGING_PANEL.thumbsMax,
    );
  return { source, titles, thumbs };
}

export interface ReferenceTitle {
  title: string;
  channel?: string;
  views?: number;
}

/** The reference titles (never throws): absent, unreadable or malformed reads as none. */
export function loadReferenceTitles(dataDir: string): ReferenceTitle[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, REFERENCE_TITLES_FILE), "utf8"),
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.title === "string" && r.title.trim())
      .map((r) => ({
        title: String(r.title).replace(/\s+/g, " ").trim(),
        ...(typeof r.channel === "string" ? { channel: r.channel } : {}),
        ...(typeof r.views === "number" && Number.isFinite(r.views)
          ? { views: r.views }
          : {}),
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- the critic

const tap = z
  .number()
  .int()
  .min(PACKAGING_PANEL.markMin)
  .max(PACKAGING_PANEL.markMax)
  .describe("1 to 10: how likely you are to tap it");

export const PackagingReadSchema = z.object({
  titles: z.array(
    z.object({
      label: z.string(),
      tap,
      why: z.string().describe("One plain line"),
    }),
  ),
  thumbs: z.array(
    z.object({
      label: z.string(),
      tap,
      why: z.string().describe("One plain line"),
    }),
  ),
});
export type PackagingRead = z.infer<typeof PackagingReadSchema>;

export function packagingPrompt(): string {
  return `You are a gamer browsing YouTube on your TV in the evening with time for one longer video. You play a few big games and follow the news loosely. You see a list of video titles from different gaming channels, then a list of words that could sit on a thumbnail. You know nothing else about them.

For every title, give tap (1 to 10: how likely you are to tap it) and why (one plain line). Then do the same for every set of thumbnail words: how likely those words on a thumbnail would make you tap.

Be honest: you skip most videos, and 5 is an ordinary title. Don't reward length or hype; a title you would not trust to deliver gets a low mark.`;
}

export async function readPackaging(
  llm: Llm,
  content: string,
): Promise<PackagingRead> {
  return llm.structured({
    site: PACKAGING_VIEWER_SITE,
    tier: "mid",
    effort: "low",
    system: packagingPrompt(),
    content,
    schema: PackagingReadSchema,
  });
}

// ---------------------------------------------------------------- the record

export interface PackagingPanelRecord {
  mode: Exclude<PackagingPanelMode, "off">;
  source: PackagingCandidates["source"];
  /** Reference titles mixed in. */
  references: number;
  /** The factory's own titles in the panel's order (best first), each with its tap mark. */
  titles: Array<{ text: string; origin: string; tap?: number }>;
  thumbs: Array<{ text: string; origin: string; tap?: number }>;
  /** The reference titles' mean tap mark, beside ours. */
  reference_mean?: number;
  /** What the factory chose (before the panel), the panel's first choice among the factory's own and what went out. */
  factory: { title: string; thumb?: string };
  panel: { title?: string; thumb?: string };
  used: { title: string; thumb?: string };
  /** The panel's rank of the title that went out (1 is its first choice). */
  used_rank?: number;
  /** The tap mark of the title that went out: the number set against click-through. */
  used_tap?: number;
  why?: string;
  changed: boolean;
  calls: number;
  error?: string;
}

export function packagingPanelEvent(
  r: PackagingPanelRecord,
): Record<string, unknown> {
  return {
    mode: r.mode,
    source: r.source,
    references: r.references,
    factory: r.factory.title,
    panel: r.panel.title,
    used: r.used.title,
    ...(r.used_rank !== undefined ? { rank: r.used_rank } : {}),
    ...(r.used_tap !== undefined ? { tap: r.used_tap } : {}),
    changed: r.changed,
    calls: r.calls,
    ...(r.error ? { error: r.error } : {}),
  };
}

// ---------------------------------------------------------------- the run

const ownRule = (currentId: string): PanelRule => ({
  name: "the most taps",
  ties: [{ by: "prefer", id: currentId }, { by: "order" }],
});

/** The ids in the panel's order (pure): best mean tap first, the current one ahead on ties. */
function orderOf(
  ids: string[],
  verdict: Parameters<typeof panelPick>[1],
  currentId: string,
): string[] {
  const out: string[] = [];
  let rest = [...ids];
  while (rest.length) {
    const p = panelPick(rest, verdict, ownRule(currentId)).pick;
    if (p === undefined) break;
    out.push(p);
    rest = rest.filter((x) => x !== p);
  }
  return out;
}

/**
 * One long video's packaging panel. Never throws: a failed call leaves the packaging as it was, recorded. Under "on"
 * the script's title (the old one kept first among the Test & compare variants) and thumbnail words may change;
 * `eligible` holds a candidate out of use, never out of the read.
 */
export async function runPackagingPanel(o: {
  script: Script;
  mode: Exclude<PackagingPanelMode, "off">;
  episodeId: string;
  candidates: PackagingCandidates;
  references: readonly ReferenceTitle[];
  read: (content: string) => Promise<PackagingRead>;
  eligible?: { title?: (t: string) => boolean; thumb?: (t: string) => boolean };
}): Promise<{ script: Script; record: PackagingPanelRecord }> {
  const factory = {
    title: o.script.youtube.title,
    ...(o.script.youtube.thumb_text
      ? { thumb: o.script.youtube.thumb_text }
      : {}),
  };
  const refs = seededShuffle(
    o.references.filter(
      (r) => !o.candidates.titles.some((c) => norm(c.text) === norm(r.title)),
    ),
    `packaging-refs:${o.episodeId}`,
  ).slice(0, PACKAGING_PANEL.referencesMax);
  type Item = {
    id: string;
    text: string;
    kind: "own" | "ref" | "thumb";
    origin: string;
  };
  const titleItems: Item[] = seededShuffle(
    [
      ...o.candidates.titles.map((c) => ({
        text: c.text,
        kind: "own" as const,
        origin: c.origin,
      })),
      ...refs.map((r) => ({
        text: r.title,
        kind: "ref" as const,
        origin: "reference",
      })),
    ],
    `packaging:${o.episodeId}`,
  ).map((x, i) => ({ ...x, id: `T${i + 1}` }));
  const thumbItems: Item[] = seededShuffle(
    o.candidates.thumbs.map((c) => ({
      text: c.text,
      kind: "thumb" as const,
      origin: c.origin,
    })),
    `packaging-thumbs:${o.episodeId}`,
  ).map((x, i) => ({ ...x, id: `W${i + 1}` }));
  const items = [...titleItems, ...thumbItems];
  const candidates: PanelCandidate[] = items.map((x) => ({
    id: x.id,
    view: `${x.id}: ${x.text}`,
  }));
  const content = (cs: readonly PanelCandidate[]) => {
    const t = cs.filter((c) => c.id.startsWith("T")).map((c) => c.view);
    const w = cs.filter((c) => c.id.startsWith("W")).map((c) => c.view);
    return `TITLES\n${t.join("\n")}${w.length ? `\n\nTHUMBNAIL WORDS\n${w.join("\n")}` : ""}`;
  };
  const base = {
    mode: o.mode,
    source: o.candidates.source,
    references: refs.length,
    factory,
  };
  const panel = await runPanel({
    candidates,
    critics: [
      {
        name: "audience",
        required: true,
        judge: async (cs) => {
          const r = await o.read(content(cs));
          return {
            raw: r,
            reads: [...r.titles, ...r.thumbs].map((x) => ({
              id: x.label.trim(),
              marks: { tap: x.tap },
              overall: x.tap,
              fault: x.why,
            })),
          };
        },
      },
    ],
    caps: { calls: PACKAGING_PANEL.calls },
  });
  const verdicts = [
    {
      critic: "audience",
      required: true,
      ...(panel.verdicts.audience ? { verdict: panel.verdicts.audience } : {}),
    },
  ];
  const tapOf = (id: string) => panel.marks.find((m) => m.id === id)?.overall;
  const own = titleItems.filter((x) => x.kind === "own");
  const currentTitle =
    own.find((x) => norm(x.text) === norm(factory.title)) ?? own[0]!;
  const currentThumb = thumbItems.find(
    (x) => factory.thumb && norm(x.text) === norm(factory.thumb),
  );
  if (!panel.verdicts.audience) {
    return {
      script: o.script,
      record: {
        ...base,
        titles: own.map((x) => ({ text: x.text, origin: x.origin })),
        thumbs: thumbItems.map((x) => ({ text: x.text, origin: x.origin })),
        panel: {},
        used: factory,
        changed: false,
        calls: panel.calls,
        error: Object.values(panel.failed)[0] ?? panel.why,
      },
    };
  }
  const titleOrder = orderOf(
    own.map((x) => x.id),
    verdicts,
    currentTitle.id,
  );
  const thumbOrder = orderOf(
    thumbItems.map((x) => x.id),
    verdicts,
    currentThumb?.id ?? "",
  );
  const byId = new Map(items.map((x) => [x.id, x]));
  const firstTitle = titleOrder[0] ? byId.get(titleOrder[0]) : undefined;
  const firstThumb = thumbOrder[0] ? byId.get(thumbOrder[0]) : undefined;
  let script = o.script;
  let changed = false;
  if (o.mode === "on") {
    const useTitle = titleOrder
      .map((id) => byId.get(id)!)
      .find((x) => !o.eligible?.title || o.eligible.title(x.text));
    const useThumb = thumbOrder
      .map((id) => byId.get(id)!)
      .find((x) => !o.eligible?.thumb || o.eligible.thumb(x.text));
    const yt = { ...script.youtube };
    if (useTitle && norm(useTitle.text) !== norm(factory.title)) {
      yt.title = useTitle.text;
      // The old title stays in the Test & compare: it is the strongest control there is.
      yt.title_variants = [
        factory.title,
        ...(yt.title_variants ?? []).filter(
          (t) => norm(t) !== norm(useTitle.text),
        ),
      ].slice(0, 2);
      changed = true;
    }
    if (useThumb && norm(useThumb.text) !== norm(factory.thumb ?? "")) {
      yt.thumb_text = useThumb.text;
      changed = true;
    }
    if (changed) script = { ...script, youtube: yt };
  }
  const usedTitle = script.youtube.title;
  const usedItem = own.find((x) => norm(x.text) === norm(usedTitle));
  const rank = usedItem ? titleOrder.indexOf(usedItem.id) : -1;
  const refTaps = titleItems
    .filter((x) => x.kind === "ref")
    .map((x) => tapOf(x.id))
    .filter((v): v is number => typeof v === "number");
  return {
    script,
    record: {
      ...base,
      titles: titleOrder.map((id) => {
        const x = byId.get(id)!;
        const t = tapOf(id);
        return {
          text: x.text,
          origin: x.origin,
          ...(t !== undefined ? { tap: t } : {}),
        };
      }),
      thumbs: thumbOrder.map((id) => {
        const x = byId.get(id)!;
        const t = tapOf(id);
        return {
          text: x.text,
          origin: x.origin,
          ...(t !== undefined ? { tap: t } : {}),
        };
      }),
      ...(refTaps.length
        ? {
            reference_mean: Number(
              (refTaps.reduce((a, v) => a + v, 0) / refTaps.length).toFixed(2),
            ),
          }
        : {}),
      panel: {
        ...(firstTitle ? { title: firstTitle.text } : {}),
        ...(firstThumb ? { thumb: firstThumb.text } : {}),
      },
      used: {
        title: usedTitle,
        ...(script.youtube.thumb_text
          ? { thumb: script.youtube.thumb_text }
          : {}),
      },
      ...(rank >= 0 ? { used_rank: rank + 1 } : {}),
      ...(usedItem && tapOf(usedItem.id) !== undefined
        ? { used_tap: tapOf(usedItem.id) }
        : {}),
      why: panel.why,
      changed,
      calls: panel.calls,
    },
  };
}

// ---------------------------------------------------------------- the weekly report

export const PACKAGING_PANEL_VERDICT_MIN = 20;

/**
 * The weekly report's packaging-panel line (pure): how often the panel agreed with the factory's title and, from
 * PACKAGING_PANEL_VERDICT_MIN long videos with a click-through reading, the rank correlation of the tap mark of the title
 * that went out with click-through.
 */
export function packagingPanelLinesForReport(
  rows: Array<{ mode?: string; agreed?: boolean; tap?: number; ctr?: number }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const all = rows.filter((r) => r.mode);
  if (!all.length) return [];
  const agreed = all.filter((r) => r.agreed).length;
  const paired = all.filter(
    (r) =>
      typeof r.tap === "number" &&
      typeof r.ctr === "number" &&
      Number.isFinite(r.ctr),
  );
  const rho =
    paired.length >= PACKAGING_PANEL_VERDICT_MIN
      ? corr(
          paired.map((r) => r.tap!),
          paired.map((r) => r.ctr!),
        )
      : undefined;
  return [
    `Packaging panel (PACKAGING_PANEL, long videos): its first choice matched the factory's title on ${agreed} of ${all.length}; tap mark against click-through: ${
      paired.length < PACKAGING_PANEL_VERDICT_MIN
        ? `${paired.length} of ${PACKAGING_PANEL_VERDICT_MIN} videos so far`
        : `rank correlation ${rho === undefined ? "n/a" : rho.toFixed(2)} over ${paired.length} videos`
    }.`,
  ];
}
