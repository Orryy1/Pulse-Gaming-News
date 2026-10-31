// Picks the narrator according to VOICE_PROVIDER (see config.ts). ElevenLabs
// is only ever used when the month's remaining characters cover the script,
// so the plan is never pushed past what has already been paid for.
// Every take then goes through the voice polish chain Codex used.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
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
/** The speed-up a take needs to reach `minWpm` (never more than 25%, never for a take under 15 words); 1 when none. */
export function paceFactor(words: number, seconds: number, minWpm: number): number {
  if (!minWpm || words < 15 || seconds <= 0) return 1;
  const wpm = (words / seconds) * 60;
  if (wpm >= minWpm) return 1;
  return Math.min(1.25, (minWpm + 3) / wpm);
}

/** Plays the file faster without changing its pitch. */
export async function speedUp(file: string, factor: number): Promise<void> {
  const tmp = `${file}.paced.mp3`;
  await run(FFMPEG, ["-loglevel", "error", "-y", "-i", file, "-af", `atempo=${factor.toFixed(4)}`, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
  await fs.rename(tmp, file);
}

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
  if (!cfg.voicePool.length) return { id: cfg.elevenLabsVoiceId, name: cfg.narratorName || cfg.elevenLabsVoiceId };
  return cfg.voicePool[Math.floor(Math.max(0, ordinal) / cfg.voiceRotation) % cfg.voicePool.length]!;
}

/** The episode a narration file belongs to: data/episodes/<id>/..., or undefined for any other path. */
export function episodeIdOf(dataDir: string, file: string): string | undefined {
  const rel = path.relative(path.join(dataDir, "episodes"), file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(/[\\/]/);
  return parts.length >= 2 && parts[0] ? parts[0] : undefined;
}

export interface NarrationWithVoice extends Narration {
  voice: { provider: "local" | "elevenlabs"; id: string; name: string };
}

export async function narrate(
  cfg: Config,
  text: string,
  outPath: string,
  voice?: { id: string; name: string },
  hooks: { onEvent?: (kind: string, detail: Record<string, unknown>) => Promise<void> | void } = {},
): Promise<NarrationWithVoice> {
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
        // Re-voicing a stray take spends extra characters, only out of what the balance holds beyond this job and the reserve.
        const revoiceChars = left === undefined ? undefined : Math.max(0, left - text.length * 1.2 - cfg.elevenLabsReserve);
        n =
          text.length > LONG_TEXT_CHARS
            ? await synthesiseElevenLabsLong(text, outPath, { ...elOpts, takeCheck: cfg.voiceTakeCheck, revoiceChars, onEvent: hooks.onEvent })
            : await synthesiseElevenLabs(text, outPath, elOpts);
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
      // Never a sleepy read: the newer voice model ignores the speed setting, and Alice came out at 109-129 words
      // a minute on 28 Oct (Liam ran 142-151). A slow take is sped up, pitch kept, its timings scaled to match.
      const factor = paceFactor(n.words.length, n.durationSeconds, cfg.minWordsPerMinute);
      if (factor > 1) {
        await speedUp(outPath, factor);
        n = {
          ...n,
          words: n.words.map((w) => ({ ...w, start: w.start / factor, end: w.end / factor })),
          durationSeconds: n.durationSeconds / factor,
        };
        log("info", "narration sped up", { factor: factor.toFixed(3) });
      }
      const used = provider === "local" ? { provider, id: cfg.localVoiceId, name: `${cfg.narratorName} (local clone)` } : { provider, id: voice?.id ?? cfg.elevenLabsVoiceId, name: voice?.name ?? cfg.elevenLabsVoiceId };
      log("info", "narration ready", { provider, voice: used.name, seconds: n.durationSeconds.toFixed(1) });
      return { ...n, voice: used };
    } catch (err) {
      errors.push(`${provider}: ${errorMessage(err)}`);
      log("warn", "narrator unavailable", { provider, error: errorMessage(err) });
    }
  }
  throw new Error(`no narrator available (${errors.join("; ")})`);
}
