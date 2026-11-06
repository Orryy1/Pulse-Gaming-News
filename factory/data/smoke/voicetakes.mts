// One small real check of the long narrator (31 Oct 2026): three short documentary paragraphs, one take
// each, through the new path (context, seed, take check) with the channel's live voice settings.
// Run from factory\ with PULSE_ENV_FILE pointing at the live .env (read only; the key is never printed).
import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig } from "../../src/config.ts";
import {
  synthesiseElevenLabsLong,
  chunkTakes,
} from "../../src/voice/elevenlabsLong.ts";
import {
  measureTake,
  normOf,
  spread,
  deviation,
} from "../../src/voice/takecheck.ts";

const cfg = loadConfig();
const text = [
  "In the autumn of 2001, a small studio outside Seattle was running out of time. The game they had promised for years had changed shape three times, and the console it would launch beside was weeks away.",
  "The team slept under their desks. Levels were cut, then rebuilt, then cut again. What survived was a single idea: thirty seconds of fun, repeated, until the player forgot to put the controller down.",
  "When it finally shipped, nobody on the team expected what came next. Within a year, millions of people knew the name, and a story that began in a cramped office had become one of the biggest in gaming.",
].join("\n\n");
const out = path.resolve("data/smoke/voice_out/voice.mp3");
await fs.mkdir(path.dirname(out), { recursive: true });
console.log(
  "model",
  cfg.elevenLabsModel,
  "voice",
  cfg.elevenLabsVoiceId,
  "words",
  text.split(/\s+/).length,
  "takes",
  chunkTakes(text, 400).length,
);
let event: Record<string, unknown> | undefined;
await synthesiseElevenLabsLong(text, out, {
  apiKey: cfg.elevenLabsApiKey,
  voiceId: cfg.elevenLabsVoiceId,
  modelId: cfg.elevenLabsModel,
  takeCheck: true,
  takeChars: 400,
  onEvent: (_kind, detail) => {
    event = detail;
  },
});
const dir = path.join(path.dirname(out), "takes");
const ms = [];
for (let i = 0; i < 3; i++)
  ms.push(
    await measureTake(path.join(dir, `take_${String(i).padStart(3, "0")}.mp3`)),
  );
const norm = normOf(ms);
ms.forEach((m, i) => {
  const d = deviation(m, norm);
  console.log(
    `take ${i}: pitch ${m.pitchHz.toFixed(1)} Hz (${(d.pitch * 100).toFixed(1)}%), centroid ${m.centroidHz.toFixed(0)} Hz (${(d.centroid * 100).toFixed(1)}%), high band ${(m.highShare * 100).toFixed(2)}%`,
  );
});
console.log("final spread", spread(ms));
console.log("event", JSON.stringify(event));
