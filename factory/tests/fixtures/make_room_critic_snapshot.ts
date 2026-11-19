// Writes tests/fixtures/room_critic_requests.json: the exact requests the writers' room sends to "room.critic" and
// "room.viewer" (site, tier, effort, system, content and the schema as JSON Schema), directly and through a full run
// (three drafts read, one edit, a voice pass, the three versions read side by side). Taken from the room as it stood on
// claude/stage (19 Nov, the room live at a 0.5 share) before its critics moved onto the shared blind panel
// (src/panel/panel.ts); tests/panel.test.ts holds the refactored room to it.
//
// To retake it from another copy of the room: `npx tsx tests/fixtures/make_room_critic_snapshot.ts <path to room.ts>`
// (a copy beside src/editorial/room.ts so its imports resolve). With no path, the room in src/editorial is used.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type * as RoomModule from "../../src/editorial/room.ts";
import type {
  EditorRead,
  FactPack,
  ViewerRead,
} from "../../src/editorial/room.ts";
import type { Llm } from "../../src/editorial/llm.ts";
import { ROOM_SNAPSHOT_DRAFTS } from "./room_critic_drafts.ts";

type Room = Pick<typeof RoomModule, "readEditor" | "readViewer" | "runRoom">;

const recorder = (
  seen: unknown[],
  schema: boolean,
  answer: (req: any) => unknown,
) =>
  ({
    structured: async (req: any) => {
      seen.push({
        site: req.site,
        tier: req.tier,
        effort: req.effort,
        maxTokens: req.maxTokens,
        cache: req.cache,
        system: req.system,
        content: req.content,
        ...(schema ? { schema: z.toJSONSchema(req.schema) } : {}),
      });
      return answer(req);
    },
  }) as unknown as Llm;

export async function roomCriticRequests(room: Room): Promise<unknown[]> {
  const seen: unknown[] = [];
  const llm = recorder(seen, true, () => ({ reads: [], pick: "" }));
  for (const drafts of ROOM_SNAPSHOT_DRAFTS) {
    await room.readEditor(llm, drafts);
    await room.readViewer(llm, drafts);
  }
  return seen;
}

const editorRead = (label: string, overall: number): EditorRead =>
  ({
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
    drop_reason: "",
  }) as unknown as EditorRead;

const viewerRead = (label: string, overall: number): ViewerRead =>
  ({
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
    drop_reason: "",
  }) as unknown as ViewerRead;

/**
 * Every request a full room run sends to the critics, in order: the three drafts, then the pick, its edit and its
 * voiced version side by side.
 */
export async function roomRunRequests(room: Room): Promise<unknown[]> {
  const seen: unknown[] = [];
  const llm = recorder(seen, false, (req) => {
    const labels = [...String(req.content).matchAll(/^DRAFT (\S+)/gm)].map(
      (m) => m[1]!,
    );
    const overall = (l: string) => (l === "B" ? 7 : 6);
    return req.site === "room.critic"
      ? { reads: labels.map((l) => editorRead(l, overall(l))), pick: "B" }
      : { reads: labels.map((l) => viewerRead(l, overall(l))) };
  });
  const [three] = ROOM_SNAPSHOT_DRAFTS;
  await room.runRoom({
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
          first_line_shape: "contradiction",
          ending: "reveal",
        })),
      }) as never,
    editor: (drafts: any) => room.readEditor(llm, drafts),
    viewer: (drafts: any) => room.readViewer(llm, drafts),
    edit: async (draft: any) => ({
      title: draft.title,
      narration: `${draft.narration} Edited once.`,
    }),
    voice: async (draft: any) => ({
      form: "in_order",
      title: `${draft.title} (voiced)`,
      narration: `Said by ear: ${draft.narration}`,
      answer_line: "",
      first_line_shape: "plain_surprise",
      ending: "dry_line",
    }),
    check: () => ({ findings: [], counts: {} }),
    rounds: 1,
    min: 8,
  } as never);
  return seen;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const from = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(import.meta.dirname, "..", "..", "src", "editorial", "room.ts");
  const room = (await import(pathToFileURL(from).href)) as Room;
  const out = path.join(import.meta.dirname, "room_critic_requests.json");
  const snapshot = {
    from: "claude/stage room.ts, before the shared panel",
    direct: await roomCriticRequests(room),
    run: await roomRunRequests(room),
  };
  fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`wrote ${out} from ${from}`);
}
