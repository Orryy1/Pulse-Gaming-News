// Proof for multi-take hooks (src/voice/hooktakes.ts): real Pulse hooks, each read once in context (the hook and the
// sentence after it, as the narration voices it) and three times alone, scored, the best spliced in, and the
// result finished by the factory's own voice chain. Spends only what it prints; refuses to start if the plan would
// pass the cap. Writes the takes, the before and after narrations and report.json into the output folder.
//
// Through the PC orchestrator (Whisper runs on the GPU):
//   orch.cmd run --class gpu --project pulse --job "hook takes proof" --priority 20 --est 10 --
//     node --import tsx src/tools/hooktakes-proof.ts <out dir> <env file> [cap]
import fs from "node:fs/promises";
import path from "node:path";
import { synthesise } from "../voice/elevenlabs.ts";
import { bestHook, hookOf } from "../voice/hooktakes.ts";
import {
  elevenLabsCreditsLeft,
  micChainFilter,
  filterVoice,
  polishVoice,
  speedUp,
} from "../voice/index.ts";

// Five hooks from Shorts the factory made on 14 Nov 2026 (their captions on the Mac), each with the line after it.
const HOOKS: Array<{ episode: string; hook: string; next: string }> = [
  {
    episode: "ep_20261114_effb7d2b",
    hook: "Rockstar is giving you GTA 6's map for free.",
    next: "The printable Leonida map arrives on the official site.",
  },
  {
    episode: "ep_20261114_4424dd72",
    hook: "Why does GTA 6 give you less room to drive?",
    next: "Edge calls the narrower streets more believable.",
  },
  {
    episode: "ep_20261114_bc828a48",
    hook: "New Zealand plays GTA 6 hours before you do.",
    next: "On the US East Coast, you're well behind.",
  },
  {
    episode: "ep_20261114_b8b57ffa",
    hook: "Buy GTA 6 tomorrow and miss the bonus offer.",
    next: "Better still, you don't need to pre-order.",
  },
  {
    episode: "ep_20261114_6fc3256b",
    hook: "Xbox Cloud Gaming adds free access with ads alongside subscriptions.",
    next: "The new tier is free and supported by ads.",
  },
];
const TAKES = 3;
const VOICE = "ZdW8WDOvcczZch9YH5mg"; // Brit Creator M (owner's pick, 12 Nov 2026)
const MODEL = "eleven_v4";
const STABILITY = 0.45;
const SPEED = 1.1; // SHORT_SPEED on the Mac
const WHISPER = "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe";

async function keyFrom(envFile: string): Promise<string> {
  const line = (await fs.readFile(envFile, "utf8"))
    .split(/\r?\n/)
    .find((l) => l.startsWith("ELEVENLABS_API_KEY="));
  return (line ?? "")
    .slice("ELEVENLABS_API_KEY=".length)
    .trim()
    .replace(/^"|"$/g, "");
}

async function main() {
  const [out, envFile, capArg] = process.argv.slice(2);
  if (!out || !envFile)
    throw new Error("usage: hooktakes-proof.ts <out dir> <env file> [cap]");
  const cap = Number(capArg ?? 1950);
  const apiKey = await keyFrom(envFile);
  if (!apiKey) throw new Error("no ElevenLabs key in the env file");
  const plan = HOOKS.reduce(
    (n, h) => n + h.hook.length + 1 + h.next.length + TAKES * h.hook.length,
    0,
  );
  console.log(`planned characters: ${plan} (cap ${cap})`);
  if (plan > cap) throw new Error("the plan would pass the cap");
  await fs.mkdir(out, { recursive: true });
  const before = await elevenLabsCreditsLeft(apiKey);
  const opts = {
    apiKey,
    voiceId: VOICE,
    modelId: MODEL,
    settings: { stability: STABILITY },
  };
  const rows: unknown[] = [];
  let spent = 0;
  for (const [i, h] of HOOKS.entries()) {
    const dir = path.join(out, `${i + 1}_${h.episode}`);
    await fs.mkdir(dir, { recursive: true });
    const spoken = `${h.hook} ${h.next}`;
    if (hookOf(spoken) !== h.hook)
      throw new Error(`hook not found as the first sentence: ${h.hook}`);
    const audio = path.join(dir, "narration.mp3");
    const n = await synthesise(spoken, audio, opts);
    spent += spoken.length;
    await fs.copyFile(audio, path.join(dir, "before_raw.mp3"));
    const r = await bestHook({
      audio,
      words: n.words,
      spoken,
      takes: TAKES,
      speed: SPEED,
      targetWpm: 175,
      whisperPython: WHISPER,
      voice: (t, o) => synthesise(t, o, opts),
      ledger: path.join(out, "hooktakes.jsonl"),
      meta: { episode: h.episode, voice: VOICE, model: MODEL, proof: true },
      keep: true,
    });
    if (!r) throw new Error(`no result for ${h.hook}`);
    spent += r.characters;
    // Both versions through the factory's chain as a Short gets it: polish, SHORT_SPEED, the creator mic.
    for (const [src, name] of [
      [path.join(dir, "before_raw.mp3"), "before.mp3"],
      [audio, "after.mp3"],
    ] as const) {
      const dest = path.join(dir, name);
      await fs.copyFile(src, dest);
      await polishVoice(dest);
      await speedUp(dest, SPEED);
      await filterVoice(dest, micChainFilter({ voiceMicChain: true })!);
    }
    rows.push({
      episode: h.episode,
      hook: h.hook,
      characters: { context: spoken.length, takes: r.characters },
      chosen: r.chosen === 0 ? "narration" : `take ${r.chosen}`,
      scores: r.scores,
      measures: r.measures,
    });
    console.log(
      `${i + 1}. ${h.hook}\n   chosen: ${r.chosen === 0 ? "the in-context read" : `take ${r.chosen}`}; ${r.scores.map((s) => `${s.label} ${s.total.toFixed(3)}${s.out ? " OUT " + s.out : ""}`).join(" | ")}`,
    );
  }
  const after = await elevenLabsCreditsLeft(apiKey);
  const report = {
    at: new Date().toISOString(),
    voice: VOICE,
    model: MODEL,
    stability: STABILITY,
    takesPerHook: TAKES,
    charactersCounted: spent,
    charactersPlanned: plan,
    creditsBefore: before,
    creditsAfter: after,
    creditsUsed:
      before !== undefined && after !== undefined ? before - after : undefined,
    rows,
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 1),
  );
  console.log(
    `characters counted ${spent}; account counter moved ${report.creditsUsed ?? "unknown"} (it can lag)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
