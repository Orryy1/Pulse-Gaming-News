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
import { synthesiseElevenLabsLong, LONG_TEXT_CHARS } from "./elevenlabsLong.ts";
import { decodedSeconds, synthesiseLocal } from "./local.ts";
import { quietBreaths } from "./breaths.ts";

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

/**
 * Highpass, gentle compression and a limiter: the narration chain from the Codex mix. Returns the
 * seconds of leading silence it trimmed, which the word timings must lose too.
 */
export async function polishVoice(file: string): Promise<number> {
  const tmp = `${file}.polished.mp3`;
  const before = await decodedSeconds(file);
  await run(FFMPEG, [
    "-loglevel", "error", "-y", "-i", file,
    "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,highpass=f=70,acompressor=threshold=-30dB:ratio=5.5:attack=5:release=120:makeup=4,alimiter=limit=0.95,loudnorm=I=-17:TP=-2.5:LRA=5",
    "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", tmp,
  ]);
  await fs.rename(tmp, file);
  return Math.max(0, before - (await decodedSeconds(file)));
}

/** The ElevenLabs voice for the n-th Short (0-based): the pool rotates every `rotation` Shorts, the configured voice when the pool is empty. */
export function pickVoice(cfg: Config, ordinal: number): { id: string; name: string } {
  if (!cfg.voicePool.length) return { id: cfg.elevenLabsVoiceId, name: cfg.elevenLabsVoiceId };
  return cfg.voicePool[Math.floor(Math.max(0, ordinal) / cfg.voiceRotation) % cfg.voicePool.length]!;
}

export interface NarrationWithVoice extends Narration {
  voice: { provider: "local" | "elevenlabs"; id: string; name: string };
}

export async function narrate(cfg: Config, text: string, outPath: string, voice?: { id: string; name: string }): Promise<NarrationWithVoice> {
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
        // Never into overage: the job plus a cushion must fit the balance, or the local voice takes it.
        if (left !== undefined && left < text.length * 1.2 + cfg.elevenLabsReserve) throw new Error(`ElevenLabs has ${left} characters left this month`);
        const elOpts = { apiKey: cfg.elevenLabsApiKey, voiceId: voice?.id ?? cfg.elevenLabsVoiceId, modelId: cfg.elevenLabsModel };
        // A long-form script is spoken in takes: the timestamps endpoint takes a few thousand characters at a time.
        n = text.length > LONG_TEXT_CHARS ? await synthesiseElevenLabsLong(text, outPath, elOpts) : await synthesiseElevenLabs(text, outPath, elOpts);
      }
      // ElevenLabs voices breathe audibly between lines; its timestamps say where, so those gaps go quiet.
      if (provider === "elevenlabs") await quietBreaths(outPath, n.words);
      const trimmed = await polishVoice(outPath);
      if (trimmed > 0.005)
        n = {
          ...n,
          words: n.words.map((w) => ({ ...w, start: Math.max(0, w.start - trimmed), end: Math.max(0, w.end - trimmed) })),
          durationSeconds: n.durationSeconds - trimmed,
        };
      const used = provider === "local" ? { provider, id: cfg.localVoiceId, name: "Liam (local clone)" } : { provider, id: voice?.id ?? cfg.elevenLabsVoiceId, name: voice?.name ?? cfg.elevenLabsVoiceId };
      log("info", "narration ready", { provider, voice: used.name, seconds: n.durationSeconds.toFixed(1) });
      return { ...n, voice: used };
    } catch (err) {
      errors.push(`${provider}: ${errorMessage(err)}`);
      log("warn", "narrator unavailable", { provider, error: errorMessage(err) });
    }
  }
  throw new Error(`no narrator available (${errors.join("; ")})`);
}
