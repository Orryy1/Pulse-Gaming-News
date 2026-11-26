// The reveal classifier and the held gameplay inbox by hand ("Early story free", 26 Nov 2026; the server runs the
// classify step itself each footage pass for the games in SPOILER_EARLY_FREE):
//   npx tsx src/tools/spoilerreveal.ts classify "<index name>" [--data <dir>] [--codex] [--max-calls N]
//       tag the index's scenes as reveal or safe and write reveals.json beside it (--codex: Codex only, no Claude)
//   npx tsx src/tools/spoilerreveal.ts counts "<index name>" [--data <dir>]       the book's tag counts
//   npx tsx src/tools/spoilerreveal.ts inbox-check --inbox <dir> --out <file> [--game "<game>"]
//       the spoiler-held inbox clips' frames shown to the local vision model; verdicts to <file>
//   npx tsx src/tools/spoilerreveal.ts inbox-apply --inbox <dir> --verdicts <file> --until <ISO> [--yes]
//       safe clips back to "new" for the owner's normal review, the rest held until <ISO> (dry without --yes)

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { createCodexLlm } from "../editorial/codex.ts";
import { createClaude, type Llm } from "../editorial/llm.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import {
  classifyReveals,
  framesReveal,
  loadRevealBook,
  recheckHeld,
  revealCounts,
  saveRevealBook,
} from "../sceneindex/reveals.ts";
import { isEarlyFree, mentionsGame, spoilerWindow, storyChapter } from "../sceneindex/spoilers.ts";

/** True when a held clip is of one of SPOILER_EARLY_FREE's games: the reviewer's game, else its stream title names it. */
function earlyFreeClip(meta: GameplayMeta, list: readonly string[]): boolean {
  if (meta.review?.game) return isEarlyFree(meta.review.game, list);
  return list.some((g) => {
    const names = spoilerWindow(g, "2000-01-01", { days: 1, openingShare: 0.1 });
    return Boolean(names && mentionsGame(names, meta.source.title));
  });
}
import type { GameplayMeta } from "../gameplay.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = loadConfig();
const dataDir = path.resolve(flag("data") ?? base.dataDir);
const cmd = args[0];
const now = new Date();

async function heldClips(
  inbox: string,
): Promise<Array<{ dir: string; meta: GameplayMeta }>> {
  const out: Array<{ dir: string; meta: GameplayMeta }> = [];
  for (const name of (await fs.readdir(inbox)).sort()) {
    const dir = path.join(inbox, name);
    const meta = await fs
      .readFile(path.join(dir, "meta.json"), "utf8")
      .then((t) => JSON.parse(t) as GameplayMeta)
      .catch(() => undefined);
    // Only the early-free games' clips: another game's hold keeps its own window.
    if (meta?.status === "rejected" && meta.review?.spoiler_held_until && earlyFreeClip(meta, base.spoilerEarlyFree))
      out.push({ dir, meta });
  }
  return out;
}

if (cmd === "classify" || cmd === "counts") {
  const name = args[1];
  if (!name) throw new Error("give the index name");
  const index = await loadSceneIndex(dataDir, name);
  if (!index) throw new Error(`no scene index for ${name} in ${dataDir}`);
  const prev = await loadRevealBook(dataDir, index.game);
  if (cmd === "counts") {
    if (!prev) throw new Error("no reveal book yet");
    console.log(
      JSON.stringify({
        index: name,
        chapter: storyChapter(index),
        ...revealCounts(prev),
      }),
    );
  } else {
    const noClaude: Llm = {
      structured: async () => {
        throw new Error("Codex only from the hand tool");
      },
    };
    const llm = args.includes("--codex")
      ? createCodexLlm(noClaude, {
          enabled: true,
          sites: ["spoiler"],
          python: base.codexPython,
          runnerDir: base.codexRunnerDir,
          timeoutMs: base.codexTimeoutMinutes * 60_000,
          tmpDir: path.join(dataDir, "tmp", "codex"),
        })
      : createClaude({
          top: base.anthropicModel,
          mid: base.claudeModelMid,
          low: base.claudeModelLow,
        });
    const maxCalls = Number(flag("max-calls") ?? "40");
    const r = await classifyReveals(llm, index, prev, { now, maxCalls });
    await saveRevealBook(dataDir, r.book);
    console.log(
      JSON.stringify({
        index: name,
        chapter: storyChapter(index),
        asked: r.asked,
        calls: r.calls,
        failed: r.failed,
        reused: r.reused,
        ...revealCounts(r.book),
      }),
    );
  }
} else if (cmd === "inbox-check") {
  const inbox = flag("inbox");
  const outFile = flag("out");
  if (!inbox || !outFile) throw new Error("give --inbox and --out");
  const game = flag("game") ?? "Grand Theft Auto VI";
  const verdicts: Record<
    string,
    { reveal: boolean; kind?: string; sure: boolean; why: string }
  > = {};
  for (const { dir, meta } of await heldClips(inbox)) {
    const events = meta.hud?.events?.length
      ? ` The HUD showed: ${meta.hud.events.join("; ")}.`
      : "";
    const context = `The game is ${game}; the stream was titled "${meta.source.title}".${events}`;
    try {
      verdicts[meta.id] = await framesReveal(
        (meta.frames ?? []).map((f) => path.join(dir, f)),
        context,
      );
    } catch (err) {
      console.error(`${meta.id}: not checked (${(err as Error).message})`);
      continue;
    }
    console.log(
      `${meta.id}: ${verdicts[meta.id]!.reveal ? "REVEAL" : "safe"} (${verdicts[meta.id]!.why})`,
    );
  }
  await fs.writeFile(outFile, JSON.stringify(verdicts, null, 2));
  console.log(`${Object.keys(verdicts).length} verdicts written to ${outFile}`);
} else if (cmd === "inbox-apply") {
  const inbox = flag("inbox");
  const file = flag("verdicts");
  const until = flag("until");
  if (!inbox || !file || !until || !Number.isFinite(Date.parse(until)))
    throw new Error("give --inbox, --verdicts and --until <ISO>");
  const verdicts = JSON.parse(await fs.readFile(file, "utf8")) as Record<
    string,
    { reveal: boolean; why: string }
  >;
  const yes = args.includes("--yes");
  const tally = { release: 0, hold: 0, skip: 0 };
  for (const { dir, meta } of await heldClips(inbox)) {
    const r = recheckHeld(
      meta,
      verdicts[meta.id],
      new Date(until).toISOString(),
      now,
    );
    tally[r.action]++;
    console.log(
      `${meta.id}: ${r.action}${r.action === "hold" ? ` until ${until}` : ""}`,
    );
    if (yes && r.action !== "skip") {
      const f = path.join(dir, "meta.json");
      await fs.writeFile(`${f}.tmp`, JSON.stringify(r.meta, null, 2));
      await fs.rename(`${f}.tmp`, f);
    }
  }
  console.log(
    `${yes ? "" : "dry run: "}${tally.release} released, ${tally.hold} held until ${until}`,
  );
} else {
  console.log(
    "commands: classify, counts, inbox-check, inbox-apply (see the top of this file)",
  );
}
