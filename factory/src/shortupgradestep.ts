// The long videos' 3D and look craft in Shorts, the pipeline's side (rules and drawing: src/render/shortupgrades.ts).
// Two calls from the Short's render step (src/pipeline.ts stepRender):
//   - shortBlenderStep, early: asks the 3D clip service for a ranking's vertical podium and says whether the Short
//     waits for it (only with a slot far enough off; never a news Short). It never fails a Short: no clip, the card.
//   - shortUpgradesFor, just before the render: the game map (staged into the episode's folder), the depth type,
//     the orbit, the compare wipe and the look, placed round the overlays the Short already keeps.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import { errorMessage, log } from "./lib/util.ts";
import {
  gameMapFor,
  gameMapGraphic,
  insideCrop,
  placesIn,
  stageGameMaps,
} from "./assets/gamemaps.ts";
import { blenderKey, fetchBlenderClips, type BlenderClip, type BlenderRequest } from "./render/blender.ts";
import { keyTime } from "./render/longplan.ts";
import { cardWindow } from "./render/shortcraft.ts";
import { fetchWithTimeout } from "./lib/util.ts";
import type { MentionSlot } from "./render/mentions.ts";
import type { Segment } from "./render/timeline.ts";
import {
  blenderLeadOk,
  blenderWaitVerdict,
  lookTitleAt,
  placeShortMap,
  shortBlenderBeats,
  shortCompareWipe,
  shortDepthTypes,
  shortOrbit,
  type ShortBlenderMoment,
  type ShortMapMoment,
  type ShortUpgrades,
  type TakenSpan,
  type UpgradeImage,
  type UpgradeShot,
} from "./render/shortupgrades.ts";

type Cfg = Pick<
  Config,
  | "mapPins"
  | "gameLook"
  | "blender"
  | "box3d"
  | "depthType"
  | "compareWipe"
  | "depthOrbit"
  | "parallaxDeep"
  | "dataDir"
  | "shortUpgrades"
>;

/** Which devices are on for Shorts: each SHORT_* switch only with its long-video switch (pure). */
export function shortUpgradesOn(cfg: Cfg): {
  maps: boolean;
  look: boolean;
  blender: boolean;
  box3d: boolean;
  depthType: boolean;
  compareWipe: boolean;
  orbit: boolean;
} {
  const su = cfg.shortUpgrades;
  return {
    maps: cfg.mapPins && su.mapPins,
    look: cfg.gameLook && su.gameLook,
    blender: cfg.blender.on && su.blender,
    box3d: cfg.box3d && su.box3d,
    depthType: cfg.depthType && su.depthType,
    compareWipe: cfg.compareWipe && su.compareWipe,
    orbit: cfg.depthOrbit && cfg.parallaxDeep && su.depthOrbit,
  };
}

/** What the Short remembers of its 3D clip ask (assets.shortBlender): when it first asked, for the wait's limit. */
export interface ShortBlenderState {
  askedAt: string;
  keys: string[];
}

/** The vertical podium requests for a Short's segments (pure; the key is the cache name, the same on every retry). */
export function shortBlenderRequests(
  segments: readonly Segment[],
): BlenderRequest[] {
  return shortBlenderBeats(segments).map((b) => ({
    key: blenderKey("podium", { ...b.params, images: [] }, b.seconds),
    scene: "podium" as const,
    role: "rank" as const,
    params: b.params,
    at: b.at,
    seconds: b.seconds,
    segment: b.segment,
  }));
}

/** Whether a clip file is upright: an old 3D service that dropped the vertical flag renders landscape. */
async function upright(
  file: string,
  probe: (f: string) => Promise<{ width: number; height: number }>,
): Promise<boolean> {
  const p = await probe(file).catch(() => undefined);
  return !!p && p.height > p.width;
}

/**
 * SHORT_BLENDER: the Short's 3D clips, asked for now. Clips already made (a re-render, or back since the last try) come
 * straight back; otherwise a Short with a slot far enough off waits for them ("wait": come back at `retryAt`), and any
 * other Short renders with its flat cards. Never throws.
 */
export async function shortBlenderStep(o: {
  cfg: Cfg;
  episodeDir: string;
  segments: readonly Segment[];
  now: Date;
  slotAt?: string | null;
  state?: ShortBlenderState;
  probe: (f: string) => Promise<{ width: number; height: number }>;
  fetchClips?: typeof fetchBlenderClips;
  /** The service's health and job status (tests stub it). */
  http?: typeof fetchWithTimeout;
  fps?: number;
}): Promise<
  | { verdict: "render"; clips: ShortBlenderMoment[]; asked: number }
  | { verdict: "wait"; retryAt: Date; state: ShortBlenderState }
> {
  const on = shortUpgradesOn(o.cfg);
  const reqs = on.blender ? shortBlenderRequests(o.segments) : [];
  if (!reqs.length) return { verdict: "render", clips: [], asked: 0 };
  const now = o.now.getTime();
  const slotAt = o.slotAt ? new Date(o.slotAt).getTime() : undefined;
  const su = o.cfg.shortUpgrades;
  const dir = path.join(o.episodeDir, "assets", "blender");
  const cached = async (k: string) =>
    ((await fs.stat(path.join(dir, `${k}.mp4`)).catch(() => undefined))?.size ??
      0) > 10_000;
  const have = await Promise.all(reqs.map((r) => cached(r.key)));
  // Nothing made yet and no time to make it: no ask at all, so the 3D queue only holds clips that will be used.
  const askable = blenderLeadOk({
    now,
    slotAt,
    waitMinutes: su.blenderWaitMinutes,
    marginMinutes: su.blenderMarginMinutes,
  });
  // An earlier ask counts only inside its own wait: a re-render hours later never asks again.
  const live = !!o.state && now < new Date(o.state.askedAt).getTime() + su.blenderWaitMinutes * 60_000;
  let wanted = reqs.filter((_, k) => have[k] || askable || live);
  if (!wanted.length) return { verdict: "render", clips: [], asked: 0 };
  // A service that does not answer, or a clip it failed to make, ends the wait at once: the card it is.
  const http = o.http ?? fetchWithTimeout;
  const uncached = wanted.filter((r) => !have[reqs.indexOf(r)]);
  if (uncached.length) {
    const up = await http(`${o.cfg.blender.url}/health`, {}, 5_000)
      .then((r) => r.ok)
      .catch(() => false);
    if (!up) wanted = wanted.filter((r) => have[reqs.indexOf(r)]);
    else if (live)
      for (const r of uncached) {
        const st = await http(`${o.cfg.blender.url}/status/${r.key}`, {}, 5_000)
          .then((x) => (x.ok ? (x.json() as Promise<{ state?: string }>) : undefined))
          .catch(() => undefined);
        if (st?.state === "failed") wanted = wanted.filter((x) => x !== r);
      }
    if (!wanted.length) {
      log("info", "Short 3D clip not to be had (service down or render failed); the card stays", { keys: uncached.map((r) => r.key) });
      return { verdict: "render", clips: [], asked: 0 };
    }
  }
  const fetch = o.fetchClips ?? fetchBlenderClips;
  let made: BlenderClip[] = await fetch(
    wanted,
    { url: o.cfg.blender.url, waitMinutes: 0.03 },
    o.episodeDir,
    { pollMs: 600 },
  ).catch((err): BlenderClip[] => {
    log("warn", "Short 3D clips not asked", { error: errorMessage(err) });
    return [];
  });
  const ok: BlenderClip[] = [];
  for (const c of made) {
    if (await upright(path.join(o.episodeDir, c.file), o.probe)) ok.push(c);
    else {
      log(
        "warn",
        "Short 3D clip is not upright (the 3D service may predate vertical clips); the card stays",
        { file: c.file },
      );
      await fs
        .rm(path.join(o.episodeDir, c.file), { force: true })
        .catch(() => undefined);
    }
  }
  made = ok;
  const v = blenderWaitVerdict({
    now,
    slotAt,
    askedAt: o.state ? new Date(o.state.askedAt).getTime() : undefined,
    pending: wanted.length - made.length,
    waitMinutes: su.blenderWaitMinutes,
    marginMinutes: su.blenderMarginMinutes,
  });
  if (v.verdict === "wait")
    return {
      verdict: "wait",
      retryAt: new Date(v.retryAt),
      state: o.state ?? {
        askedAt: o.now.toISOString(),
        keys: wanted.map((r) => r.key),
      },
    };
  const fps = o.fps ?? 30;
  return {
    verdict: "render",
    asked: wanted.length,
    clips: made.map((c) => ({
      key: `blender${c.segment ?? 0}`,
      from: Math.round(c.at * fps),
      len: Math.round(c.seconds * fps),
      role: "rank" as const,
      segment: c.segment ?? 0,
      file: c.file,
    })),
  };
}

/** The first place a line names in its game's map, with when it is said (pure apart from the map tables). */
export function shortMapCandidates(o: {
  segments: readonly Segment[];
  words: ReadonlyArray<{ text: string; start: number }>;
  game: string;
}): Array<{
  segment: number;
  wordAt: number;
  graphic: ShortMapMoment["graphic"];
}> {
  const out: Array<{
    segment: number;
    wordAt: number;
    graphic: ShortMapMoment["graphic"];
  }> = [];
  o.segments.forEach((s, i) => {
    if (s.kind !== "beat") return;
    // A line with its own explainer keeps it: the explainer is drawn for the whole line (claude/explainers).
    if (s.explainer) return;
    // A rank card stays up for its whole entry: a map would cover it.
    if (s.visual?.kind === "rank") return;
    const game = lookTitleAt(o.segments, i, o.game);
    const table = gameMapFor(game);
    if (!table) return;
    const places = placesIn(s.text, table).filter((p) => insideCrop(table, p));
    if (!places.length) return;
    const lo = Math.max(
      0,
      o.words.findIndex((w) => w.start >= s.start - 0.05),
    );
    let hi = o.words.findIndex((w) => w.start >= s.end);
    if (hi < 0) hi = o.words.length;
    const wordAt = keyTime([...o.words], lo, hi, places[0]!.name);
    if (wordAt === undefined) return;
    out.push({
      segment: i,
      wordAt,
      graphic: {
        primary: table.name,
        secondary: game,
        items: places.map((p) => p.name),
        gameMap: gameMapGraphic(table, game, places),
      },
    });
  });
  return out;
}

/**
 * The upgrades a Short draws (src/render/shortupgrades.ts), planned round the overlays it already keeps (`kept`: the
 * clean frame's spans, or every planned span on a Short in the full chrome). The game map's picture is staged into
 * the episode's folder; a map that cannot be had is left out. Mention insets of the place the map pins give way to
 * it. Never throws: whatever fails is left out and logged.
 */
export async function shortUpgradesFor(o: {
  cfg: Cfg;
  episodeDir: string;
  game: string;
  segments: readonly Segment[];
  words: ReadonlyArray<{ text: string; start: number }>;
  plan: {
    fps: number;
    totalFrames: number;
    shots: readonly UpgradeShot[];
    /** Code scenes have the screen to themselves (src/render/codescene.ts). */
    scenes?: ReadonlyArray<{ from: number; to: number }>;
  };
  layout: { hookEnd: number; loopFrom: number };
  /** The Short's images as the render gets them (layers only where the Short has them). */
  images: readonly UpgradeImage[];
  stamps: ReadonlyArray<{ at: number; text: string; sub?: string }>;
  kept: ReadonlyArray<TakenSpan & { key: string }>;
  mentions: MentionSlot[];
  blender: ShortBlenderMoment[];
  isRumour: boolean;
  stageMaps?: typeof stageGameMaps;
}): Promise<{
  upgrades: ShortUpgrades;
  mentions: MentionSlot[];
  notes: string[];
}> {
  const on = shortUpgradesOn(o.cfg);
  const { fps } = o.plan;
  const { hookEnd, loopFrom } = o.layout;
  const notes: string[] = [];
  const up: ShortUpgrades = {};
  if (on.look && !o.isRumour) up.look = true;
  if (on.box3d) up.box3d = true;
  const sceneSpans: TakenSpan[] = (o.plan.scenes ?? []).map((x) => ({ kind: "scene", from: x.from, to: x.to }));
  // The podium stands in for its entry's card for 3 s; anything else there (a word moment, an inset, a code scene),
  // or the hook or the loop, keeps the frame and the podium is not shown.
  const podiums = o.blender.filter((b) => {
    const clear =
      b.from >= hookEnd &&
      b.from + b.len <= loopFrom &&
      ![...o.kept, ...sceneSpans].some(
        (k) => k.kind !== "entry" && k.kind !== "shelf" && k.kind !== "hook" && k.from < b.from + b.len && k.to > b.from,
      );
    if (!clear) notes.push(`3D podium left out: another overlay holds its frames`);
    return clear;
  });
  if (podiums.length) up.blender = podiums;
  let mentions = o.mentions;
  if (on.maps) {
    try {
      const segStart = (i: number) =>
        i === 0 ? 0 : Math.round(o.segments[i]!.start * fps);
      const segEnd = (i: number) =>
        i === o.segments.length - 1
          ? o.plan.totalFrames
          : Math.round(o.segments[i + 1]!.start * fps);
      for (const c of shortMapCandidates({
        segments: o.segments,
        words: o.words,
        game: o.game,
      })) {
        // The map may replace its own line's card and an inset of an in-game place (the same noun); everything else
        // keeps its frames.
        const taken = [
          ...o.kept.filter(
            (k) =>
              !(k.kind === "card" && k.key === `card${c.segment}`) &&
              !(
                k.kind === "mention" &&
                mentionKindOf(o.mentions, k.key) === "inworld"
              ),
          ),
          ...sceneSpans,
          ...podiums.map((b) => ({ kind: "podium", from: b.from, to: b.from + b.len })),
        ];
        const at = placeShortMap({
          wordAt: c.wordAt,
          segStart: segStart(c.segment),
          segEnd: segEnd(c.segment),
          hookEnd,
          loopFrom,
          fps,
          taken,
        });
        if (!at) {
          notes.push(
            `map for "${c.graphic.items.join(", ")}" left out: no free ${Math.round((105 / fps) * 10) / 10} s on its words`,
          );
          continue;
        }
        const staged = await (o.stageMaps ?? stageGameMaps)(
          [{ graphic: { kind: "map", ...c.graphic } }],
          o.episodeDir,
          path.join(o.cfg.dataDir, "gamemaps"),
        );
        const gm = staged.moments[0]?.graphic.gameMap;
        if (!gm?.file) {
          notes.push(
            `map ${c.graphic.gameMap.map} left out: ${staged.failed.join("; ") || "picture not staged"}`,
          );
          continue;
        }
        // The line's card as it would be drawn: from its own window, since an in-game place inset may have stood in for
        // it in `kept` (and gives way to the map below, which brings the card back).
        const v = o.segments[c.segment]!.visual;
        const card =
          v && v.kind !== "none" && v.primary.trim()
            ? cardWindow([...o.segments], [...o.words], c.segment, fps, o.plan.totalFrames)
            : undefined;
        const replacesCard =
          !!card && card.from < at.from + at.len && card.from + card.len > at.from;
        up.maps = [
          {
            key: `map${c.segment}`,
            from: at.from,
            len: at.len,
            segment: c.segment,
            replacesCard,
            graphic: { ...c.graphic, gameMap: gm },
          },
        ];
        mentions = mentions.filter(
          (m) =>
            !(
              m.m.kind === "inworld" &&
              m.from < at.from + at.len &&
              m.to > at.from
            ),
        );
        notes.push(
          `map of ${gm.map} on line ${c.segment}: ${c.graphic.items.join(", ")}`,
        );
        break;
      }
    } catch (err) {
      log("warn", "Short game map skipped", { error: errorMessage(err) });
    }
  }
  const stillShots = o.plan.shots;
  if (on.depthType) {
    const d = shortDepthTypes({
      stamps: o.stamps,
      kept: o.kept,
      shots: stillShots,
      images: o.images,
      fps,
      hookEnd,
      loopFrom,
    });
    if (d.length) up.depthTypes = d;
  }
  // The compare wipe before the orbit: neither may hide the other, nor the map, the podium, a depth type or a code scene.
  if (on.compareWipe) {
    const taken: TakenSpan[] = [
      ...o.kept,
      ...sceneSpans,
      ...[...(up.maps ?? []), ...(up.blender ?? []), ...(up.depthTypes ?? [])].map((m) => ({
        kind: "upgrade",
        from: m.from,
        to: m.from + m.len,
      })),
    ];
    const wipe = shortCompareWipe({
      segments: o.segments,
      words: o.words,
      images: o.images,
      fps,
      hookEnd,
      loopFrom,
      taken,
    });
    if (wipe) {
      up.wipes = [wipe];
      notes.push(`compare wipe: ${wipe.leftGame} and ${wipe.rightGame}`);
    }
  }
  if (on.orbit) {
    const blocked = new Set((up.depthTypes ?? []).map((d) => d.from));
    // Not under the map, a 3D clip, the wipe or a code scene, which would hide it.
    for (const m of [...(up.maps ?? []), ...(up.blender ?? []), ...(up.wipes ?? []), ...sceneSpans.map((x) => ({ from: x.from, len: x.to - x.from }))])
      for (const s of stillShots)
        if (s.start < m.from + m.len && s.end > m.from) blocked.add(s.start);
    const orbit = shortOrbit({
      shots: stillShots,
      images: o.images,
      fps,
      hookEnd,
      loopFrom,
      blocked,
    });
    if (orbit) up.orbits = [orbit];
  }
  return { upgrades: up, mentions, notes };
}

const mentionKindOf = (mentions: readonly MentionSlot[], key: string): string =>
  mentions.find((m) => m.key === key)?.m.kind ?? "";
