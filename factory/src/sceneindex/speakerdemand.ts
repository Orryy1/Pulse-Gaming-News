// Speakers on demand (GAME_SPEECH_DIALOGUE, 20 Nov 2026). A quote needs a speaker the game names or the dialogue makes
// plain (src/sceneindex/quotepick.ts), and most heard lines have none: on 20 Nov GTA V's full index had 7,639 heard
// lines without a speaker and 79 quotable, San Andreas 3,140 without, and not one light index had a speaker at all.
// The by-hand pass (src/sceneindex/speakers.ts, "speakers" in the scene index tool) costs a call per 150 lines over a
// whole game, so it had been run almost nowhere. Here it runs only where a video needs it: the speakerless lines that
// fit the story (and would be quotable once someone is named) are asked about once, with the lines around each as
// context, in one "sceneindex.speakers" call. Only sure answers that name someone on the cast list are kept.
//
// The answers are kept beside the index (<slug>/speakers_demand.json), never written into index.json: a build turn
// may be saving the index at the same moment. withDemandSpeakers lays them over the loaded index, so the quote's
// check before the voice (verifyQuote) sees the same speaker the writer was offered. A rebuild from another upload
// leaves the file unused (its videoId no longer matches).

import fs from "node:fs/promises";
import path from "node:path";
import type { Llm } from "../editorial/llm.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { DialogueLine, SceneIndex } from "./schema.ts";
import { sceneIndexDir } from "./schema.ts";
import {
  applySpeakers,
  needsSpeaker,
  SPEAKER_SYSTEM,
  SpeakerAnswerSchema,
  speakerPrompt,
} from "./speakers.ts";
import {
  quoteCandidates,
  unquotable,
  type QuoteCandidateOptions,
} from "./quotepick.ts";

export const DEMAND_FILE = "speakers_demand.json";
/** Story-fitting lines asked about in one call, and the heard lines around each given as context. */
export const DEMAND_LINES = 14;
export const DEMAND_AROUND = 5;

export interface DemandSpeakers {
  videoId: string;
  /** Line ID ("q" and its start in tenths) to the speaker named from the dialogue. */
  named: Record<string, string>;
  /** Line IDs already asked about, named or not: never asked again. */
  asked: string[];
  updatedAt: string;
}

const lineId = (l: Pick<DialogueLine, "start">) =>
  `q${Math.round(l.start * 10)}`;

/** The index with the kept answers laid over it (pure): only lines that still need a speaker, from the same upload. */
export function overlayDemand(
  index: SceneIndex,
  d: DemandSpeakers | undefined,
): SceneIndex {
  if (!d || d.videoId !== index.source.videoId || !Object.keys(d.named).length)
    return index;
  let changed = false;
  const lines = index.lines.map((l) => {
    const name = d.named[lineId(l)];
    if (!name || !needsSpeaker(l)) return l;
    changed = true;
    const { speakerGuessed: _g, ...rest } = l;
    return { ...rest, speaker: name, speakerFrom: "context" as const };
  });
  return changed ? { ...index, lines } : index;
}

export async function readDemand(
  dataDir: string,
  game: string,
): Promise<DemandSpeakers | undefined> {
  try {
    const raw = JSON.parse(
      await fs.readFile(
        path.join(sceneIndexDir(dataDir, game), DEMAND_FILE),
        "utf8",
      ),
    );
    if (typeof raw?.videoId !== "string" || typeof raw?.named !== "object")
      return undefined;
    return {
      videoId: raw.videoId,
      named: raw.named ?? {},
      asked: Array.isArray(raw.asked) ? raw.asked : [],
      updatedAt: String(raw.updatedAt ?? ""),
    };
  } catch {
    return undefined;
  }
}

async function writeDemand(
  dataDir: string,
  game: string,
  d: DemandSpeakers,
): Promise<void> {
  const file = path.join(sceneIndexDir(dataDir, game), DEMAND_FILE);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(d, null, 1));
  await fs.rename(tmp, file);
}

/** The index with any kept on-demand speakers laid over it. Never throws. */
export async function withDemandSpeakers(
  dataDir: string,
  index: SceneIndex,
): Promise<SceneIndex> {
  return overlayDemand(index, await readDemand(dataDir, index.game));
}

/** Whether a line would be quotable once someone is named (pure): heard, timed and clean in every other way. */
export function quotableOnceNamed(
  index: SceneIndex,
  l: DialogueLine,
  verbatim = true,
): boolean {
  if (!needsSpeaker(l) || !l.words?.length) return false;
  const { speakerGuessed: _g, ...rest } = l;
  return unquotable(index, { ...rest, speaker: "Someone" }, { verbatim }) === undefined;
}

/**
 * The speakerless lines worth asking about for this story (pure): those quotable once named, ranked by the same story
 * fit the quote picker uses, story fits only, at most `max`, none already asked about.
 */
export function demandLines(
  index: SceneIndex,
  storyText: string,
  asked: ReadonlySet<string>,
  o: Pick<
    QuoteCandidateOptions,
    "window" | "now" | "use" | "warned" | "placedAt" | "verbatim"
  > & { max?: number } = {},
): DialogueLine[] {
  const open = index.lines.filter(
    (l) => quotableOnceNamed(index, l, o.verbatim ?? true) && !asked.has(lineId(l)),
  );
  if (!open.length) return [];
  const ids = new Set(open.map((l) => l.id));
  // The picker scores a line by the story words it shares; a placeholder speaker adds no words of its own.
  const probe: SceneIndex = {
    ...index,
    lines: index.lines.map((l) =>
      ids.has(l.id)
        ? { ...l, speaker: "Someone", speakerGuessed: undefined }
        : l,
    ),
  };
  const fits = quoteCandidates(probe, storyText, {
    ...o,
    max: o.max ?? DEMAND_LINES,
    general: 0,
  });
  const want = new Set(fits.filter((c) => ids.has(c.line)).map((c) => c.line));
  return index.lines.filter((l) => want.has(l.id));
}

/** One chunk for the speaker prompt (pure): each wanted line with the heard lines around it, in order. */
export function demandChunk(
  index: SceneIndex,
  wanted: readonly DialogueLine[],
  around = DEMAND_AROUND,
): { ask: DialogueLine[]; context: DialogueLine[] } {
  const heard = index.lines.filter((l) => l.via !== "textbox");
  const pos = new Map(heard.map((l, i) => [l.id, i]));
  const keep = new Set<number>();
  for (const w of wanted) {
    const i = pos.get(w.id);
    if (i === undefined) continue;
    for (
      let k = Math.max(0, i - around);
      k <= Math.min(heard.length - 1, i + around);
      k++
    )
      keep.add(k);
  }
  const ask = [...keep].sort((a, b) => a - b).map((k) => heard[k]!);
  return { ask, context: [] };
}

/**
 * Names the speakers of the story's best speakerless lines, once per line, and keeps the sure answers beside the
 * index. Returns the index with every kept answer laid over it. Never throws: a failed call leaves the index as it was.
 */
export async function nameSpeakersOnDemand(
  llm: Pick<Llm, "structured">,
  dataDir: string,
  index: SceneIndex,
  storyText: string,
  o: Pick<
    QuoteCandidateOptions,
    "window" | "now" | "use" | "warned" | "placedAt" | "verbatim"
  > & { max?: number } = {},
): Promise<{ index: SceneIndex; asked: number; named: number }> {
  const kept = await readDemand(dataDir, index.game);
  const d: DemandSpeakers =
    kept && kept.videoId === index.source.videoId
      ? kept
      : { videoId: index.source.videoId, named: {}, asked: [], updatedAt: "" };
  const base = overlayDemand(index, d);
  if (!index.cast.length) return { index: base, asked: 0, named: 0 };
  const wanted = demandLines(base, storyText, new Set(d.asked), o);
  if (!wanted.length) return { index: base, asked: 0, named: 0 };
  try {
    const chunk = demandChunk(base, wanted);
    const r = await llm.structured({
      site: "sceneindex.speakers",
      tier: "mid",
      system: SPEAKER_SYSTEM,
      content: speakerPrompt(base, chunk),
      schema: SpeakerAnswerSchema,
      effort: "low",
      maxTokens: 6000,
    });
    const ids = new Set(chunk.ask.map((l) => l.id));
    const applied = applySpeakers(
      base,
      r.lines.filter((x) => ids.has(x.id)),
    );
    const named = { ...d.named };
    const before = new Map(base.lines.map((l) => [l.id, l]));
    let n = 0;
    for (const l of applied.index.lines) {
      const was = before.get(l.id);
      if (
        l.speakerFrom === "context" &&
        ids.has(l.id) &&
        was !== undefined &&
        needsSpeaker(was) &&
        !named[lineId(l)]
      ) {
        named[lineId(l)] = l.speaker!;
        n++;
      }
    }
    const next: DemandSpeakers = {
      videoId: d.videoId,
      named,
      asked: [...new Set([...d.asked, ...wanted.map(lineId)])],
      updatedAt: new Date().toISOString(),
    };
    await writeDemand(dataDir, index.game, next).catch((err) =>
      log("warn", "speakers on demand: could not keep the answers", {
        game: index.game,
        error: errorMessage(err),
      }),
    );
    return {
      index: overlayDemand(index, next),
      asked: wanted.length,
      named: n,
    };
  } catch (err) {
    log("warn", "speakers on demand: the call failed", {
      game: index.game,
      error: errorMessage(err),
    });
    return { index: base, asked: 0, named: 0 };
  }
}
