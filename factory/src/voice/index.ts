// Picks the narrator according to VOICE_PROVIDER (see config.ts). ElevenLabs
// is only ever used when the month's remaining characters cover the script,
// so the plan is never pushed past what has already been paid for.
// Every take then goes through the voice polish chain Codex used.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import type { Config, VoiceProvider } from "../config.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { synthesise as synthesiseElevenLabs, type Narration } from "./elevenlabs.ts";
import { synthesiseLocal } from "./local.ts";

const run = promisify(execFile);

/** The order narrators are tried in for a VOICE_PROVIDER setting. */
export function providerOrder(provider: VoiceProvider): Array<"local" | "elevenlabs"> {
  switch (provider) {
    case "elevenlabs": return ["elevenlabs"];
    case "local": return ["local"];
    case "elevenlabs-first": return ["elevenlabs", "local"];
    default: return ["local", "elevenlabs"];
  }
}

/** Characters left this month on the ElevenLabs plan, or undefined if unknown (bad key, API down). */
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
    "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,highpass=f=70,acompressor=threshold=-30dB:ratio=5.5:attack=5:release=120:makeup=4,alimiter=limit=0.95,loudnorm=I=-17:TP=-2.5:LRA=5",
    "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", tmp,
  ]);
  await fs.rename(tmp, file);
}

export async function narrate(cfg: Config, text: string, outPath: string): Promise<Narration> {
  const order = providerOrder(cfg.voiceProvider);
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
        // Unknown balance (invalid key, API down) is a refusal when ElevenLabs is merely preferred:
        // the point of elevenlabs-first is to use paid-for credits, not to risk a bill.
        if (left === undefined && cfg.voiceProvider === "elevenlabs-first") throw new Error("ElevenLabs balance unknown (check the API key)");
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
