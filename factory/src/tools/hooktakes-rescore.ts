// Re-scores a hook-takes proof folder (src/tools/hooktakes-proof.ts, run with keep) under the current rules, with
// no new spend: each kept read is re-cut at the quietest frame near its old cut (quietCut), measured again with
// Whisper's clarity reused from the ledger, and the chosen take is spliced into a fresh copy of the in-context
// read and finished by the factory's chain. Writes rescore.json, with the level around every seam.
//   node --import tsx src/tools/hooktakes-rescore.ts <proof dir>
import fs from "node:fs/promises";
import path from "node:path";
import {
  chooseHook,
  cutAudio,
  measureHook,
  quietCut,
  scoreHooks,
  spliceAudio,
  type HookMeasure,
} from "../voice/hooktakes.ts";
import { envelope } from "../voice/breathcheck.ts";
import { measureTake } from "../voice/takecheck.ts";
import { decodedSeconds } from "../voice/local.ts";
import {
  filterVoice,
  micChainFilter,
  polishVoice,
  speedUp,
} from "../voice/index.ts";

const SPEED = 1.1;

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: hooktakes-rescore.ts <proof dir>");
  const ledger = (await fs.readFile(path.join(dir, "hooktakes.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(
      (l) =>
        JSON.parse(l) as {
          episode: string;
          hook: string;
          measures: HookMeasure[];
        },
    );
  const rows = [];
  const seams = [];
  for (const sub of (await fs.readdir(dir))
    .filter((d) => /^\d_/.test(d))
    .sort()) {
    const d = path.join(dir, sub);
    const led = ledger.find((l) => sub.endsWith(l.episode))!;
    const sources = [
      path.join(d, "before_raw.mp3"),
      ...[1, 2, 3].map((n) => path.join(d, `hooktake_${n}.mp3`)),
    ];
    const files: string[] = [];
    const cuts: number[] = [];
    for (const [i, src] of sources.entries()) {
      const old = await decodedSeconds(path.join(d, `hooktake_${i}.wav`));
      const cut = quietCut(
        await envelope(src),
        old - (i === 0 ? 0.35 : 0.45),
        old + (i === 0 ? 0 : 0.15),
      );
      const f = path.join(d, `recut_${i}.wav`);
      await cutAudio(src, f, 0, cut);
      files.push(f);
      cuts.push(cut);
    }
    const norm = await measureTake(files[0]!);
    const measures: HookMeasure[] = [];
    for (const [i, f] of files.entries()) {
      const { measure: _m, ...m } = await measureHook(
        f,
        i === 0 ? "narration" : `take ${i}`,
        led.hook,
        SPEED,
        { norm },
      );
      const clarity = led.measures[i]?.clarity;
      measures.push(clarity === undefined ? m : { ...m, clarity });
    }
    const scores = scoreHooks(measures, 175);
    const chosen = chooseHook(scores);
    const after = path.join(d, "after.mp3");
    await fs.copyFile(path.join(d, "before_raw.mp3"), after);
    if (chosen > 0) {
      await spliceAudio(after, sources[chosen]!, cuts[0]!, cuts[chosen]!);
      // The raw splice is kept too, to check the seam lands in silence.
      await fs.copyFile(after, path.join(d, "after_raw.mp3"));
      const env = await envelope(after);
      const at = Math.round(cuts[chosen]! / 0.02);
      seams.push({
        hook: led.hook,
        cut: Math.round(cuts[chosen]! * 1000) / 1000,
        dbAround: env.slice(at - 3, at + 4).map((v) => Math.round(v)),
      });
    }
    await polishVoice(after);
    await speedUp(after, SPEED);
    await filterVoice(after, micChainFilter({ voiceMicChain: true })!);
    rows.push({
      episode: led.episode,
      hook: led.hook,
      chosen: chosen === 0 ? "narration" : `take ${chosen}`,
      scores,
      measures,
    });
    console.log(
      `${sub.slice(0, 1)}. ${led.hook}\n   chosen: ${chosen === 0 ? "the in-context read" : `take ${chosen}`}; ${scores.map((s) => `${s.label} ${s.total.toFixed(3)}${s.out ? " OUT " + s.out : ""}`).join(" | ")}`,
    );
  }
  await fs.writeFile(
    path.join(dir, "rescore.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        rules:
          "quiet-frame cuts, centroid match against the in-context read, IQR intonation",
        rows,
        seams,
      },
      null,
      1,
    ),
  );
  console.log(
    "seams (dB around each cut, 20 ms frames):",
    JSON.stringify(seams),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
