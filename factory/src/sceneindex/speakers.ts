// Who says each heard line, from the dialogue around it (upgrade queue item 26). Some games never print a speaker's
// name: GTA's cutscene subtitles are bare lines, so San Andreas's index heard thousands of lines and could quote none
// (a quote needs a speaker the game showed; one guessed from the picture is wrong whenever the speaker is off
// screen). A text model reads the transcript in order with the game's cast list and names the speaker of each line
// where the conversation makes it plain ("Carl, tell him!" answered by the next line, a name said back), and says
// when it is sure. Only sure answers that name someone on the cast list (or already speaking in the index) are kept,
// marked speakerFrom "context". One "sceneindex.speakers" call per chunk of lines, mid tier: CODEX_CALLS can route it.
// Run by hand through the scene index tool ("speakers"), never by the build: it costs a call per 150 lines.

import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { DialogueLine, SceneIndex } from "./schema.ts";

/** Lines per call: long enough for the conversation to name people, short enough to answer every line. */
export const SPEAKER_CHUNK = 150;
/** Lines of labelled context before a chunk. */
const CONTEXT_LINES = 12;

export const SpeakerAnswerSchema = z.object({
  lines: z.array(
    z.object({
      id: z.number().int().describe("The line's id from the list"),
      speaker: z
        .string()
        .describe(
          "The character who says it, spelt as on the cast list; empty when unknown",
        ),
      sure: z
        .boolean()
        .describe(
          "True only when the dialogue itself makes the speaker plain (they are named, answered or named back). A guess from the story is false",
        ),
    }),
  ),
});
export type SpeakerAnswer = z.infer<typeof SpeakerAnswerSchema>;

/** A line that still needs a speaker: heard, and with none the game showed. */
export function needsSpeaker(l: DialogueLine): boolean {
  return l.via !== "textbox" && (!l.speaker || Boolean(l.speakerGuessed));
}

/** The chunks of lines to ask about inside [from, to) (pure), each with the lines before it as context. */
export function speakerChunks(
  index: SceneIndex,
  from = 0,
  to = Infinity,
  size = SPEAKER_CHUNK,
): Array<{ ask: DialogueLine[]; context: DialogueLine[] }> {
  const heard = index.lines.filter(
    (l) => l.via !== "textbox" && l.start >= from && l.start < to,
  );
  const out: Array<{ ask: DialogueLine[]; context: DialogueLine[] }> = [];
  for (let i = 0; i < heard.length; i += size) {
    const part = heard.slice(i, i + size);
    if (!part.some(needsSpeaker)) continue;
    out.push({
      ask: part,
      context: heard.slice(Math.max(0, i - CONTEXT_LINES), i),
    });
  }
  return out;
}

const SYSTEM = `You label who speaks each line of a video game's cutscene transcript. The lines are in the order they are heard, with the second they start. Speakers are the game's characters; use the cast list's spelling. Name a speaker only when the conversation makes it plain: the speaker is named or addressed by the line before or after ("Carl, tell him!" then CJ answers), they answer a question put to them by name, or the scene's two people alternate and one is already known. Mark "sure" true only then. A line whose speaker you would be guessing gets sure false (and may have an empty speaker). The words are machine-heard and sometimes wrong; judge from what they plainly say. Answer for every line id in the list.`;

/** One chunk's prompt (pure). */
export function speakerPrompt(
  index: Pick<SceneIndex, "game" | "cast">,
  chunk: { ask: DialogueLine[]; context: DialogueLine[] },
  plot = "",
): string {
  const row = (l: DialogueLine) =>
    `${l.id} [${Math.round(l.start)}s] ${l.speaker && !l.speakerGuessed ? `(${l.speaker}) ` : ""}${l.text}`;
  return `Game: ${index.game}\nCast: ${index.cast.slice(0, 80).join(", ")}${plot ? `\n\nStory (Wikipedia, for who is who):\n${plot.slice(0, 3000)}` : ""}${chunk.context.length ? `\n\nJust before (context, already labelled where known):\n${chunk.context.map(row).join("\n")}` : ""}\n\nLines to label:\n${chunk.ask.map(row).join("\n")}`;
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The index with the sure answers written in (pure): a speaker is kept only when it is on the cast list or already
 * speaks somewhere in the index, spelt as there; a line the game labelled is never changed.
 */
export function applySpeakers(
  index: SceneIndex,
  answers: SpeakerAnswer["lines"],
): { index: SceneIndex; named: number } {
  const known = new Map<string, string>();
  for (const n of index.cast) known.set(key(n), n);
  for (const l of index.lines)
    if (l.speaker && !l.speakerGuessed) known.set(key(l.speaker), l.speaker);
  const by = new Map<number, string>();
  for (const a of answers) {
    if (!a.sure || !a.speaker.trim()) continue;
    const name = known.get(key(a.speaker));
    if (name) by.set(a.id, name);
  }
  let named = 0;
  const lines = index.lines.map((l) => {
    const name = by.get(l.id);
    if (!name || !needsSpeaker(l)) return l;
    named++;
    const { speakerGuessed: _g, ...rest } = l;
    return { ...rest, speaker: name, speakerFrom: "context" as const };
  });
  return { index: { ...index, lines }, named };
}

/** Labels the speakers of [from, to) chunk by chunk, saving after each through `save`. Never throws on one chunk's failure. */
export async function attributeSpeakers(
  llm: Llm,
  index: SceneIndex,
  o: {
    from?: number;
    to?: number;
    plot?: string;
    size?: number;
    save?: (index: SceneIndex) => Promise<void>;
    log?: (line: string) => void;
  } = {},
): Promise<{
  index: SceneIndex;
  named: number;
  asked: number;
  failed: number;
}> {
  let cur = index;
  let named = 0;
  let asked = 0;
  let failed = 0;
  const chunks = speakerChunks(index, o.from ?? 0, o.to ?? Infinity, o.size);
  for (const [i, chunk] of chunks.entries()) {
    asked += chunk.ask.length;
    try {
      const r = await llm.structured({
        site: "sceneindex.speakers",
        tier: "mid",
        system: SYSTEM,
        content: speakerPrompt(cur, chunk, o.plot),
        schema: SpeakerAnswerSchema,
        effort: "low",
        maxTokens: 8000,
      });
      const ids = new Set(chunk.ask.map((l) => l.id));
      const applied = applySpeakers(
        cur,
        r.lines.filter((x) => ids.has(x.id)),
      );
      cur = applied.index;
      named += applied.named;
      o.log?.(
        `chunk ${i + 1}/${chunks.length}: ${applied.named} of ${chunk.ask.length} lines named`,
      );
      await o.save?.(cur);
    } catch (err) {
      failed++;
      o.log?.(
        `chunk ${i + 1}/${chunks.length} failed: ${(err as Error).message?.slice(0, 200)}`,
      );
    }
  }
  return { index: cur, named, asked, failed };
}
