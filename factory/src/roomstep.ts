// The writers' room in the pipeline (SCRIPT_ROOM, src/editorial/room.ts). Every step it needs from the factory is
// injected (the writer's sources, the fact check, the house safety checks, the vault, the air-time check), so it is
// tested without a model or a database.
//   "on", the room's arm: the pack, the writer, the critics, the edits and the layout. The laid-out script then meets
//   the same blocking checks as any Short (the fact check, rumour labelling, air-time words) and the house safety
//   checks; anything they flag gets one edits-only repair ("room.repair"). Facts still blocked, or rumour labelling
//   off, and the normal writer writes the Short instead. A kill, a drop by both critics, a failed step or a layout
//   that changes the words also falls back. The record says which.
//   "check", the room's arm: the pack alone, recorded beside the normal script with what that script used of it.

import type { Llm } from "./editorial/llm.ts";
import { tapUsage } from "./editorial/llm.ts";
import type { FactCheck, Script } from "./editorial/schema.ts";
import { narrationOf } from "./editorial/schema.ts";
import type { ArticleText } from "./discovery/article.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { ScriptLength } from "./editorial/editorial.ts";
import { WORDS_MAX, WORDS_MIN, writeScript } from "./editorial/editorial.ts";
import {
  ROOM,
  buildPack,
  editRoom,
  factoryHosts,
  noCalls,
  numberCorpus,
  packUsed,
  primaryLinks,
  quoteCorpus,
  readEditor,
  readViewer,
  roomChecks,
  roomEditProblems,
  roomRecord,
  runLayout,
  runRoom,
  writeRoom,
  voiceRoom,
  type FactPack,
  type RecentShape,
  type RoomText,
  type PackInput,
  type RoomArm,
  type RoomCalls,
  type RoomRecord,
  type RoomRun,
} from "./editorial/room.ts";

export interface RoomStepInput {
  llm: Llm;
  cfg: {
    scriptRoomViewer: boolean;
    scriptRoomRounds: number;
    scriptRoomMin: number;
    scriptRoomLinks: boolean;
    /** SCRIPT_ROOM_VOICE: the voice pass after the edit (absent counts as on). */
    scriptRoomVoice?: boolean;
  };
  /** The last room Shorts' shapes, newest first (variety memory, from their records). */
  recent?: readonly RecentShape[];
  cluster: StoryCluster;
  articles: ArticleText[];
  storeData?: string;
  /** The vault's brief for the writer and the layout (or the credit rule when the vault knows nothing). */
  vaultBrief?: string;
  /** The vault's note for the pack (FACT_VAULT), when it has one. */
  vaultNote?: string;
  length?: ScriptLength;
  mustLabelRumour: boolean;
  /** Primary sources: the factory's own feeds' URLs mark the hosts it already reads. */
  feedUrls?: readonly string[];
  fetchLinks?: (url: string) => Promise<string[]>;
  fetchArticle?: (url: string) => Promise<ArticleText | undefined>;
}

/** The pack's input, with primary sources followed when SCRIPT_ROOM_LINKS is on (never on a host the factory doesn't read). */
export async function packInput(o: RoomStepInput): Promise<PackInput> {
  const base: PackInput = {
    cluster: o.cluster,
    articles: o.articles,
    ...(o.vaultNote ? { vault: o.vaultNote } : {}),
    ...(o.storeData ? { storeData: o.storeData } : {}),
  };
  if (!o.cfg.scriptRoomLinks || !o.fetchLinks || !o.fetchArticle) return base;
  const allowed = factoryHosts([
    ...(o.feedUrls ?? []),
    ...o.cluster.items.map((i) => i.url),
  ]);
  const skip = o.cluster.items.map((i) => i.url);
  const links: string[] = [];
  for (const a of o.articles) {
    if (links.length >= ROOM.linksMax) break;
    const out = await o.fetchLinks(a.url).catch(() => []);
    links.push(
      ...primaryLinks(out, allowed, [...skip, ...links]).slice(
        0,
        ROOM.linksMax - links.length,
      ),
    );
  }
  const primaries = (
    await Promise.all(
      links.map((l) => o.fetchArticle!(l).catch(() => undefined)),
    )
  ).filter((a): a is ArticleText => !!a);
  return primaries.length ? { ...base, primaries } : base;
}

const wordsOf = (o: RoomStepInput) => ({
  min: o.length?.wordsMin ?? WORDS_MIN,
  max: o.length?.wordsMax ?? WORDS_MAX,
});

/** Steps 1 to 4 for one Short, with the model that wrote the drafts noted from the usage meter. */
export async function roomRun(
  o: RoomStepInput,
): Promise<{ run: RoomRun; model?: string; primaries?: number }> {
  const input = await packInput(o);
  const words = wordsOf(o);
  const corpora = { quotes: quoteCorpus(input), numbers: numberCorpus(input) };
  let model: string | undefined;
  const untap = tapUsage((line) => {
    if (line.site === "room.write")
      model = line.provider === "codex" ? "codex" : line.model;
  });
  try {
    let game = o.cluster.gameHint ?? "";
    let company = "";
    const run = await runRoom({
      pack: async () => {
        const p = await buildPack(o.llm, input);
        game = p.pack.game.trim() || game;
        company = p.pack.company.trim();
        return p;
      },
      write: (pack) =>
        writeRoom(
          o.llm,
          pack,
          words,
          o.mustLabelRumour
            ? "This story is not confirmed by an official source or two independent outlets: label it as a report in the first two sentences and keep it labeled."
            : "",
          o.recent,
        ),
      editor: (drafts) => readEditor(o.llm, drafts),
      ...(o.cfg.scriptRoomViewer
        ? {
            viewer: (drafts: Parameters<typeof readViewer>[1]) =>
              readViewer(o.llm, drafts),
          }
        : {}),
      edit: (draft, instruction, pack) =>
        editRoom(o.llm, { draft, problems: [instruction], pack, words }),
      ...(o.cfg.scriptRoomVoice !== false
        ? {
            voice: (draft: RoomText, pack: FactPack) =>
              voiceRoom(o.llm, { draft, pack, words, recent: o.recent }),
          }
        : {}),
      accept: (before, after) => roomEditProblems(after, corpora, before),
      game: () => game,
      ...(o.recent ? { recent: o.recent } : {}),
      check: (narration, answerLine, shape) =>
        roomChecks({
          narration,
          answerLine,
          ...(shape ? { shape } : {}),
          ...(o.recent ? { recent: o.recent } : {}),
          game,
          company,
          outlets: o.cluster.items.map((i) => i.source),
          words,
        }),
      rounds: o.cfg.scriptRoomRounds,
      min: o.cfg.scriptRoomMin,
    });
    return {
      run,
      ...(model ? { model } : {}),
      ...(input.primaries ? { primaries: input.primaries.length } : {}),
    };
  } finally {
    untap();
  }
}

export interface RoomWriteDeps {
  /** The house safety checks a room script answers to (no style rules): flagged lines go to the one repair. */
  safety: (sc: Script) => string[];
  /** The normal fact check. */
  factCheck: (sc: Script) => Promise<FactCheck>;
  /** Time words that would be false when the Short airs. */
  airTime: (sc: Script) => string[];
  /** FACT_VAULT=enforce: blockers the vault settles. */
  settle?: (
    sc: Script,
    blockers: string[],
  ) => Promise<{ script: Script; remaining: string[] }>;
  /** CREDIT_SCRUB: a credit to an outlet the writer was not given comes off. */
  scrub?: (sc: Script) => Script;
}

export interface RoomWriteResult {
  script?: Script;
  check?: FactCheck;
  record: RoomRecord;
  /** House safety problems still standing after the repair (accepted with a warning, as the normal path does). */
  warnings?: string[];
}

const blockersOf = (c: FactCheck) =>
  c.issues
    .filter((i) => i.severity === "blocker")
    .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);

/** SCRIPT_ROOM=on for the room's arm: the room's script and its passed fact check, or a record of why it fell back. */
export async function roomWriteStep(
  o: RoomStepInput,
  deps: RoomWriteDeps,
  skipped: string[] = [],
): Promise<RoomWriteResult> {
  const { run, model, primaries } = await roomRun(o);
  const calls: RoomCalls = { ...noCalls(), ...run.calls };
  const record = (extra: { fallback?: string; wrote: boolean }) =>
    roomRecord({
      arm: "room",
      mode: "on",
      run,
      ...(run.pack && run.drops
        ? {
            pack: {
              pack: run.pack,
              drops: run.drops,
              ...(primaries !== undefined ? { primaries } : {}),
            },
          }
        : {}),
      ...extra,
      ...(extra.wrote ? { skipped } : {}),
      calls,
      ...(model ? { model } : {}),
    });
  if (!run.final) {
    const why =
      run.stop === "killed"
        ? `killed: ${run.kill?.why ?? ""}`
        : run.stop === "dropped"
          ? `both critics dropped the story: ${run.drop?.why ?? ""}`
          : run.stop === "unread"
            ? "the critics' read failed"
            : `the room failed: ${run.error ?? "no draft"}`;
    return { record: record({ fallback: why, wrote: false }) };
  }
  const final = run.final;
  const layout = await runLayout({
    narration: final.narration,
    layout: (feedback) =>
      writeScript(o.llm, o.cluster, o.articles, {
        mustLabelRumour: o.mustLabelRumour,
        storeData: o.storeData,
        ...(o.vaultBrief ? { vault: o.vaultBrief } : {}),
        ...(o.length ? { length: o.length } : {}),
        ...(feedback ? { feedback: [feedback] } : {}),
        layout: { title: final.title, narration: final.narration },
      }),
  });
  calls.layout = layout.calls;
  if (!layout.script)
    return {
      record: record({
        fallback: `layout: ${layout.fallback ?? "no script"}`,
        wrote: false,
      }),
    };
  let script: Script = layout.script;
  if (deps.scrub) script = deps.scrub(script);
  const assess = async (sc: Script) => {
    let c = await deps.factCheck(sc);
    const blockers = [...blockersOf(c), ...deps.airTime(sc)];
    let out = sc;
    if (deps.settle && blockers.length) {
      const settled = await deps.settle(sc, blockers);
      if (settled.remaining.length < blockers.length) {
        out = settled.script;
        blockers.splice(0, blockers.length, ...settled.remaining);
        if (!blockers.length && c.verdict === "fail")
          c = {
            ...c,
            verdict: "pass",
            issues: c.issues.filter((i) => i.severity !== "blocker"),
          };
      }
    }
    const factsOk = c.verdict === "pass" && !blockers.length;
    return {
      script: out,
      check: c,
      blockers,
      factsOk,
      rumourOk: c.rumour_labelling_ok,
      safety: deps.safety(out),
    };
  };
  let a = await assess(script);
  if (!a.rumourOk)
    return { record: record({ fallback: "rumour labelling", wrote: false }) };
  if (!a.factsOk || a.safety.length) {
    calls.repair++;
    let repaired: Script | undefined;
    try {
      repaired = await writeScript(o.llm, o.cluster, o.articles, {
        mustLabelRumour: o.mustLabelRumour,
        storeData: o.storeData,
        ...(o.vaultBrief ? { vault: o.vaultBrief } : {}),
        ...(o.length ? { length: o.length } : {}),
        draft: a.script,
        feedback: [...a.blockers, ...a.safety],
        layout: {
          title: final.title,
          narration: final.narration,
          repair: true,
        },
      });
    } catch {
      repaired = undefined;
    }
    if (repaired) {
      const b = await assess(deps.scrub ? deps.scrub(repaired) : repaired);
      // The repair is kept when its facts pass; a repair that broke rumour labelling is never kept.
      if (b.factsOk && b.rumourOk) a = b;
    }
    if (!a.factsOk)
      return {
        record: record({
          fallback: `fact check: ${a.blockers.slice(0, 3).join(" | ")}`.slice(
            0,
            600,
          ),
          wrote: false,
        }),
      };
  }
  return {
    script: a.script,
    check: { ...a.check, verdict: "pass" },
    record: record({ wrote: true }),
    ...(a.safety.length ? { warnings: a.safety } : {}),
  };
}

/** SCRIPT_ROOM=check for the room's arm: the pack alone (one call) and what the published script used of it. */
export async function roomCheckStep(
  o: RoomStepInput,
  published: Script,
): Promise<RoomRecord> {
  const input = await packInput(o);
  try {
    const p = await buildPack(o.llm, input);
    return roomRecord({
      arm: "room",
      mode: "check",
      pack: {
        ...p,
        ...(input.primaries ? { primaries: input.primaries.length } : {}),
      },
      used: packUsed(p.pack, narrationOf(published)),
      calls: { pack: 1 },
    });
  } catch (err) {
    return roomRecord({
      arm: "room",
      mode: "check",
      fallback:
        `the pack failed: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          300,
        ),
      calls: { pack: 1 },
    });
  }
}

/** The control arm's record: no calls, the arm only, so the weekly report can compare. */
export function roomControlRecord(mode: "check" | "on"): RoomRecord {
  return roomRecord({ arm: "control" as RoomArm, mode });
}

/** The event the pipeline logs for every covered Short (pure). */
export function roomEvent(r: RoomRecord): Record<string, unknown> {
  return {
    arm: r.arm,
    mode: r.mode,
    ...(r.wrote !== undefined ? { wrote: r.wrote } : {}),
    ...(r.fallback ? { fallback: r.fallback } : {}),
    ...(r.stop ? { stop: r.stop } : {}),
    ...(r.pick ? { pick: r.pick } : {}),
    ...(r.editor_overall !== undefined ? { editor: r.editor_overall } : {}),
    ...(r.viewer_overall !== undefined ? { viewer: r.viewer_overall } : {}),
    ...(r.rounds ? { marks: r.rounds.map((x) => x.mean ?? null) } : {}),
    ...(r.pack ? { pack: r.pack } : {}),
    ...(r.used ? { used: r.used } : {}),
    ...(r.kill ? { kill: r.kill.why } : {}),
    ...(r.drop ? { drop: r.drop } : {}),
    ...(r.won ? { won: r.won } : {}),
    ...(r.form ? { form: r.form } : {}),
    ...(r.ending ? { ending: r.ending } : {}),
    calls: r.calls,
    ...(r.model ? { model: r.model } : {}),
  };
}

/** The variety memory from stored records (pure): the room Shorts' kept shapes, newest first. */
export function recentShapesFrom(
  records: ReadonlyArray<RoomRecord | null | undefined>,
): RecentShape[] {
  return records
    .filter((r): r is RoomRecord => !!r && r.wrote === true)
    .slice(0, ROOM.recentSeen)
    .map((r) => ({
      ...(r.form ? { form: r.form } : {}),
      ...(r.first_line ? { first_line: r.first_line } : {}),
      ...(r.ending ? { ending: r.ending } : {}),
      i_think: !!r.i_think,
    }));
}
