// Picks the narrator: the local Codex voice first, ElevenLabs only as a
// fallback when it is configured and has the credits for this script.
// Every take then goes through the voice polish chain Codex used.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import type { Config } from "../config.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { synthesise as synthesiseElevenLabs, type Narration } from "./elevenlabs.ts";
import { synthesiseLocal } from "./local.ts";

const run = promisify(execFile);

/** Characters left this month on the ElevenLabs plan, or undefined if unknown. */
export async function elevenLabsCreditsLeft(apiKey: string): Promise<number | undefined> {
  try {
    const res = await fetchWithTimeout("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey } }, 15_000);
    if (!res.ok) return undefined;
    const s = (await res.json()) as { character_count?: number; character_limit?: number };
    if (s.character_limit == null || s.character_count == null) return undefined;
    return s.character_limit - s.character_count;
  } catch {
    return undefined;
  }
}

/** Highpass, gentle compression and a limiter: the narration chain from the Codex mix. */
export async function polishVoice(file: string): Promise<void> {
  const tmp = `${file}.polished.mp3`;
  await run(FFMPEG, [
    "-loglevel", "error", "-y", "-i", file,
    "-af", "highpass=f=70,acompressor=threshold=-30dB:ratio=5.5:attack=5:release=120:makeup=4,alimiter=limit=0.95,loudnorm=I=-17:TP=-2.5:LRA=5",
    "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", tmp,
  ]);
  await fs.rename(tmp, file);
}

export async function narrate(cfg: Config, text: string, outPath: string): Promise<Narration> {
  const order: Array<"local" | "elevenlabs"> =
    cfg.voiceProvider === "elevenlabs" ? ["elevenlabs"] : cfg.voiceProvider === "local" ? ["local"] : ["local", "elevenlabs"];
  const errors: string[] = [];
  for (const provider of order) {
    try {
      let n: Narration;
      if (provider === "local") {
        n = await synthesiseLocal(text, outPath, {
          baseUrl: cfg.localTtsUrl,
          voiceId: cfg.localVoiceId,
          speakingRate: cfg.localSpeakingRate,
          startScript: cfg.localTtsStart || undefined,
        });
      } else {
        if (!cfg.elevenLabsApiKey) throw new Error("ElevenLabs is not configured");
        const left = await elevenLabsCreditsLeft(cfg.elevenLabsApiKey);
        if (left !== undefined && left < text.length * 1.2) throw new Error(`ElevenLabs has ${left} characters left this month`);
        n = await synthesiseElevenLabs(text, outPath, { apiKey: cfg.elevenLabsApiKey, voiceId: cfg.elevenLabsVoiceId, modelId: cfg.elevenLabsModel });
      }
      await polishVoice(outPath);
      log("info", "narration ready", { provider, seconds: n.durationSeconds.toFixed(1) });
      return n;
    } catch (err) {
      errors.push(`${provider}: ${errorMessage(err)}`);
      log("warn", "narrator unavailable", { provider, error: errorMessage(err) });
    }
  }
  throw new Error(`no narrator available (${errors.join("; ")})`);
}
