// Voices one audition job list through the factory's own narration chain, so every candidate is heard exactly as a
// Short would be (12 Nov 2026 voice audition). For each job: the with-timestamps take, the gap breath softener, the
// polish, the Short speed-up (SHORT_SPEED, with the words-a-minute floor), the creator mic chain, then the
// envelope breath ducker the voice step runs. Writes <out>.raw.mp3, <out>.mp3 and <out>.json (timings, breaths, pace).
//
//   ELEVENLABS_API_KEY=... node --import tsx data/smoke/voice_audition.mts jobs.json
//
// jobs.json: [{ "label", "voiceId", "model", "settings": { "stability", "style", ... }, "text", "out", "speed"? }]
// A job whose <out>.json already exists is skipped, so a rerun spends nothing twice.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { synthesise } from "../../src/voice/elevenlabs.ts";
import { quietBreaths } from "../../src/voice/breaths.ts";
import { dropTagWords } from "../../src/voice/tags.ts";
import { MIC_CHAIN, VOICE_LOUDNORM, filterVoice, paceFactor, polishVoice, speedUp } from "../../src/voice/index.ts";
import { breathReport, turnDownBreaths, wordsPerMinute } from "../../src/voice/breathcheck.ts";

interface Job {
  label: string;
  voiceId: string;
  model: string;
  settings?: Record<string, number | boolean>;
  text: string;
  out: string;
  speed?: number;
}

const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
const jobs = JSON.parse(await fs.readFile(process.argv[2]!, "utf8")) as Job[];
let spent = 0;
for (const j of jobs) {
  if (existsSync(`${j.out}.json`)) continue;
  try {
    const raw = `${j.out}.raw.mp3`;
    let n = await synthesise(j.text, raw, { apiKey, voiceId: j.voiceId, modelId: j.model, settings: j.settings as never });
    spent += j.text.length;
    const rawBreaths = await breathReport(raw);
    await fs.copyFile(raw, `${j.out}.mp3`);
    const file = `${j.out}.mp3`;
    await quietBreaths(file, n.words);
    n = { ...n, words: dropTagWords(n.words) };
    const trimmed = await polishVoice(file);
    if (trimmed > 0.005)
      n = { ...n, words: n.words.map((w) => ({ ...w, start: Math.max(0, w.start - trimmed), end: Math.max(0, w.end - trimmed) })), durationSeconds: n.durationSeconds - trimmed };
    const factor = Math.min(1.25, Math.max(paceFactor(n.words.length, n.durationSeconds, 145), j.speed ?? 1.1));
    if (factor > 1) {
      await speedUp(file, factor);
      n = { ...n, words: n.words.map((w) => ({ ...w, start: w.start / factor, end: w.end / factor })), durationSeconds: n.durationSeconds / factor };
    }
    await filterVoice(file, `${MIC_CHAIN},${VOICE_LOUDNORM}`);
    const turned = await turnDownBreaths(file);
    const out = {
      label: j.label,
      voiceId: j.voiceId,
      model: j.model,
      settings: j.settings ?? {},
      chars: j.text.length,
      factor,
      seconds: n.durationSeconds,
      wpm: wordsPerMinute(n.words),
      rawBreaths: { perMinute: rawBreaths.loudPerMinute, loud: rawBreaths.loudBreaths, all: rawBreaths.breaths },
      breathsBeforeDuck: turned.before.loudPerMinute,
      breathsAfter: turned.after.loudPerMinute,
      loudestAfter: turned.after.loudest,
      words: n.words,
    };
    await fs.writeFile(`${j.out}.json`, JSON.stringify(out, null, 1));
    console.log(`${j.label}: ${out.seconds.toFixed(1)} s, ${out.wpm} wpm, raw breaths ${rawBreaths.loudPerMinute}/min, after ${turned.after.loudPerMinute}/min`);
  } catch (err) {
    console.log(`${j.label}: FAILED ${(err as Error).message.slice(0, 300)}`);
  }
}
console.log(`characters sent: ${spent}`);
