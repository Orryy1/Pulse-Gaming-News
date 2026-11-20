// Meaning-based matching by hand (MATCH_SEMANTIC, src/semantic):
//   npx tsx src/tools/semantic.ts index "<game>" [--limit N]      embed a scene index's shots (kept beside the index)
//   npx tsx src/tools/semantic.ts vod <vod-id> [--limit N]         embed a stream index's shots
//   npx tsx src/tools/semantic.ts probe "<game>" "<line>" [--top 8] the shots a line means, best first
//   npx tsx src/tools/semantic.ts vodfind "<game>" "<line>"        the owner's tagged stream moments for a line
// --data <dir> reads another data folder (a sandbox copy). On the Mac run it through ~/orch/macrun.sh; on the PC through
// C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --priority 20 --est <min>.

import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { Embedder } from "../semantic/embed.ts";
import { lineQuery, meanVector } from "../semantic/match.ts";
import {
  embedShots,
  loadShotVectors,
  shotMeaning,
  vectorFile,
} from "../semantic/shots.ts";
import { loadSceneIndex, sceneIndexDir } from "../sceneindex/schema.ts";
import {
  loadVodIndex,
  vodIndexDir,
  listVodIndexes,
} from "../vodindex/schema.ts";
import { findVodMoments } from "../vodindex/tags.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const [cmd, a1, a2] = plain;
const cfg = loadConfig();
const dataDir = path.resolve(flag("data") ?? cfg.dataDir);
const s = cfg.semantic;
const embedder = new Embedder({
  python: s.python,
  model: s.model,
  device: s.device,
  cacheDir: path.join(dataDir, "semantic"),
  idleSeconds: 30,
  priority: Number(flag("priority") ?? 20),
});
const limit = Number(flag("limit") ?? 100000);
const t0 = Date.now();

try {
  if (cmd === "index" && a1) {
    const index = await loadSceneIndex(dataDir, a1);
    if (!index) throw new Error(`no scene index for ${a1}`);
    const dir = sceneIndexDir(dataDir, index.game);
    const r = await embedShots({
      shots: index.shots,
      video: path.join(dir, index.proxy?.file || "proxy.mp4"),
      vectorsFile: vectorFile(dir, s.model),
      embedder,
      model: s.model,
      work: os.tmpdir(),
      limit,
    });
    console.log(
      `${index.game}: ${r.added} shots embedded, ${r.total} in all, ${r.left} left, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  } else if (cmd === "vod" && a1) {
    const v = await loadVodIndex(dataDir, a1);
    if (!v) throw new Error(`no stream index ${a1}`);
    const r = await embedShots({
      shots: v.shots,
      video: v.file,
      vectorsFile: vectorFile(vodIndexDir(dataDir, v.vodId), s.model),
      embedder,
      model: s.model,
      work: os.tmpdir(),
      limit,
    });
    console.log(
      `${v.vodId}: ${r.added} shots embedded, ${r.total} in all, ${r.left} left, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  } else if (cmd === "probe" && a1 && a2) {
    const index = await loadSceneIndex(dataDir, a1);
    if (!index) throw new Error(`no scene index for ${a1}`);
    const vecs = await loadShotVectors(
      vectorFile(sceneIndexDir(dataDir, index.game), s.model),
    );
    const q = meanVector(
      (await embedder.texts(lineQuery(a2, flag("note")))) ?? [],
    );
    if (!q) throw new Error("the model is not answering");
    const m = shotMeaning(index.shots, vecs, q);
    const top = [...m.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, Number(flag("top") ?? 8));
    for (const [id, score] of top) {
      const shot = index.shots[id]!;
      console.log(
        `${score.toFixed(2)}  ${shot.start.toFixed(1)}s  ${shot.desc}`,
      );
    }
  } else if (cmd === "vodfind" && a1 && a2) {
    const vods = (await listVodIndexes(dataDir)).filter((v) => v.game === a1);
    const hits = await findVodMoments(
      vods,
      { key: "probe", text: a2 },
      { embedder, model: s.model, dataDir, now: new Date() },
    );
    for (const h of hits)
      console.log(
        `${h.score.toFixed(2)}  ${h.vodId} ${h.start.toFixed(1)}s  ${h.label}${h.held ? `  (held: ${h.held})` : ""}`,
      );
  } else {
    console.error(
      'usage: semantic.ts index "<game>" | vod <vod-id> | probe "<game>" "<line>" | vodfind "<game>" "<line>"',
    );
    process.exitCode = 2;
  }
} finally {
  embedder.close();
}
