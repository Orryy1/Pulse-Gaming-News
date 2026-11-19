// Writes tests/fixtures/room_critic_requests.json: the exact requests the writers' room sends to "room.critic" and
// "room.viewer" (site, tier, effort, system, content and the schema as JSON Schema) for a fixed set of drafts. Run once
// before the critics moved onto the shared blind panel (src/panel/panel.ts); tests/room.test.ts holds the room to it.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  readEditor,
  readViewer,
  runRoom,
  type EditorRead,
  type FactPack,
  type ViewerRead,
} from "../../src/editorial/room.ts";
import type { Llm } from "../../src/editorial/llm.ts";
import { ROOM_SNAPSHOT_DRAFTS } from "./room_critic_drafts.ts";

export async function roomCriticRequests(): Promise<unknown[]> {
  const seen: unknown[] = [];
  const llm = {
    structured: async (req: any) => {
      seen.push({
        site: req.site,
        tier: req.tier,
        effort: req.effort,
        maxTokens: req.maxTokens,
        cache: req.cache,
        system: req.system,
        content: req.content,
        schema: z.toJSONSchema(req.schema),
      });
      return { reads: [], pick: "" };
    },
  } as unknown as Llm;
  for (const drafts of ROOM_SNAPSHOT_DRAFTS) {
    await readEditor(llm, drafts);
    await readViewer(llm, drafts);
  }
  return seen;
}

const marks = (label: string, overall: number) => ({
  editor: {
    label,
    clarity: 7,
    hook: 7,
    payoff: 6,
    voice: 7,
    human: 7,
    promise_kept: 6,
    overall,
    swipe: 2,
    weakness: `"${label}" opens on background`,
    fix: "Open on the price.",
    second_thread: "",
    drop: false,
  } as EditorRead,
  viewer: {
    label,
    stop: 6,
    stay: 6,
    got_it: 7,
    worth_it: 6,
    comment: 4,
    share: 3,
    overall,
    swipe: 3,
    lost_me: "eight years on",
    fix: "Say the price first.",
    drop: false,
  } as ViewerRead,
});

/**
 * The same requests as the room's own run makes them: three drafts read, the pick edited twice, each edit read again
 * (every request the room sends to "room.critic" and "room.viewer", in order, with the drafts it passed).
 */
export async function roomRunRequests(): Promise<unknown[]> {
  const seen: unknown[] = [];
  const llm = {
    structured: async (req: any) => {
      seen.push({
        site: req.site,
        tier: req.tier,
        effort: req.effort,
        maxTokens: req.maxTokens,
        cache: req.cache,
        system: req.system,
        content: req.content,
      });
      const content = String(req.content);
      const labels = [...content.matchAll(/^DRAFT (\S+)/gm)].map((m) => m[1]!);
      const round = seen.length;
      const overall = (l: string) =>
        (l === "B" ? 7 : 6) +
        (labels.length === 1 ? Math.min(1, round % 3) : 0);
      if (req.site === "room.critic")
        return {
          reads: labels.map((l) => marks(l, overall(l)).editor),
          pick: "B",
        };
      return { reads: labels.map((l) => marks(l, overall(l)).viewer) };
    },
  } as unknown as Llm;
  const [three] = ROOM_SNAPSHOT_DRAFTS;
  let edits = 0;
  await runRoom({
    pack: async () => ({
      pack: {} as FactPack,
      drops: { quotes: [], numbers: [] } as never,
    }),
    write: async () =>
      ({
        angles: [],
        best: 0,
        second: 1,
        kill: false,
        kill_reason: "",
        point: "Silksong costs $20.",
        drafts: three!.map((d) => ({
          ...d,
          angle: 0,
          structure: "contradiction",
          answer_line: "",
        })),
      }) as never,
    editor: (drafts) => readEditor(llm, drafts),
    viewer: (drafts) => readViewer(llm, drafts),
    edit: async (draft) => ({
      title: draft.title,
      narration: `${draft.narration} Edit ${++edits}.`,
    }),
    check: () => ({ findings: [], counts: {} as never }),
    rounds: 2,
    min: 8,
  });
  return seen;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const out = path.join(import.meta.dirname, "room_critic_requests.json");
  const snapshot = {
    direct: await roomCriticRequests(),
    run: await roomRunRequests(),
  };
  fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
