// The background turn that gives every scene index its shot vectors (MATCH_SEMANTIC): each pass picks one index with
// a proxy on this machine and shots still without a vector, and embeds up to SEMANTIC_SHOTS_PER_TURN of them in a
// child process (src/tools/semantic.ts index). On the Mac the child waits its turn behind renders (~/orch/macrun.sh);
// on the PC it goes through the orchestrator (class gpu, priority 20: background work). Never two turns at once.

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";
import { loadSceneIndex, sceneSlug } from "../sceneindex/schema.ts";
import type { SemanticSettings } from "./settings.ts";
import { loadFailedShots, loadShotVectors, unembedded, vectorFile } from "./shots.ts";

const TOOL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "semantic.ts",
);

/** The command for one turn (pure): macrun on the Mac, the orchestrator on the PC, plain node elsewhere. */
export function semanticTurnCommand(
  platform: string,
  o: { macrun?: string; orch?: string },
  node: string,
  args: string[],
  estMinutes: number,
): [string, string[]] {
  if (platform === "darwin")
    return o.macrun
      ? ["/bin/bash", [o.macrun, "pulse-semantic", node, ...args]]
      : ["taskpolicy", ["-b", node, ...args]];
  if (o.orch)
    return [
      "cmd.exe",
      [
        "/c",
        o.orch,
        "run",
        "--class",
        "gpu",
        "--project",
        "pulse",
        "--job",
        "semantic shot vectors",
        "--priority",
        "20",
        "--est",
        String(estMinutes),
        "--",
        node,
        ...args,
      ],
    ];
  return [node, args];
}

/** The first index with a proxy here and shots still to embed, or undefined. */
export async function nextIndexToEmbed(
  dataDir: string,
  model: string,
): Promise<string | undefined> {
  const root = path.join(dataDir, "sceneindex");
  for (const slug of (
    await fsp.readdir(root).catch(() => [] as string[])
  ).sort()) {
    const dir = path.join(root, slug);
    const raw = await fsp
      .readFile(path.join(dir, "index.json"), "utf8")
      .catch(() => "");
    if (!raw) continue;
    let game = "";
    try {
      game = String(JSON.parse(raw).game ?? "");
    } catch {
      continue;
    }
    const index = game ? await loadSceneIndex(dataDir, game) : undefined;
    if (!index) continue;
    const proxy = path.join(dir, index.proxy?.file || "proxy.mp4");
    if (
      index.proxy?.released ||
      !(await fsp
        .stat(proxy)
        .then((s) => s.size > 0)
        .catch(() => false))
    )
      continue;
    // The tool writes beside sceneIndexDir(game): a folder named otherwise would be picked every pass.
    if (sceneSlug(index.game) !== slug) continue;
    const file = vectorFile(dir, model);
    if (unembedded(index.shots, await loadShotVectors(file), await loadFailedShots(file)).length) return game;
  }
  return undefined;
}

let running = false;

export async function semanticIndexTick(cfg: {
  dataDir: string;
  semantic: SemanticSettings;
}): Promise<void> {
  if (!cfg.semantic.enabled || running) return;
  running = true;
  try {
    const game = await nextIndexToEmbed(cfg.dataDir, cfg.semantic.model);
    if (!game) return;
    const macrun = path.join(os.homedir(), "orch", "macrun.sh");
    const orch = "C:\\Claude\\orchestrator\\orch.cmd";
    const [cmd, args] = semanticTurnCommand(
      process.platform,
      {
        macrun: fs.existsSync(macrun) ? macrun : undefined,
        orch: fs.existsSync(orch) ? orch : undefined,
      },
      process.execPath,
      [
        "--import",
        "tsx",
        TOOL,
        "index",
        game,
        "--limit",
        String(cfg.semantic.shotsPerTurn),
      ],
      Math.max(2, Math.ceil(cfg.semantic.shotsPerTurn / 200)),
    );
    await new Promise<void>((resolve) =>
      execFile(
        cmd,
        args,
        {
          env: { ...process.env, DATA_DIR: cfg.dataDir, MACRUN_WAIT_MIN: "20" },
          cwd: path.join(path.dirname(TOOL), "..", ".."),
          timeout: 2 * 3_600_000,
          windowsHide: true,
        },
        (err, stdout) => {
          if (err)
            log("warn", "semantic: shot vector turn did not finish", {
              game,
              error: errorMessage(err),
            });
          else
            log("info", "semantic: shot vector turn", {
              game,
              said: String(stdout).trim().split("\n").pop(),
            });
          resolve();
        },
      ),
    );
  } catch (err) {
    log("warn", "semantic: shot vector pass failed", {
      error: errorMessage(err),
    });
  } finally {
    running = false;
  }
}
