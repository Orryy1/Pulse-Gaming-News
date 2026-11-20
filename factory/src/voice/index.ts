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
import {
  errorMessage,
  FatalError,
  fetchWithTimeout,
  log,
} from "../lib/util.ts";
import { writerNoteHits } from "../editorial/writernotes.ts";
import {
  synthesise as synthesiseElevenLabs,
  type Narration,
} from "./elevenlabs.ts";
import { synthesiseElevenLabsLong, LONG_TEXT_CHARS } from "./elevenlabsLong.ts";
import { decodedSeconds, synthesiseLocal } from "./local.ts";
import { quietBreaths } from "./breaths.ts";
import { dropTagWords, stripVoiceTags } from "./tags.ts";
import { bestHook, hookOf } from "./hooktakes.ts";
import { MAX_REVOICES } from "./takecheck.ts";

const run = promisify(execFile);

/** The order narrators are tried in for a VOICE_PROVIDER setting. */
export function providerOrder(
  provider: VoiceProvider,
): Array<"local" | "elevenlabs"> {
  switch (provider) {
    case "elevenlabs":
      return ["elevenlabs"];
    case "local":
      return ["local"];
    case "elevenlabs-first":
      return ["elevenlabs", "local"];
    default:
      return ["local", "elevenlabs"];
  }
}

/** The last balance ElevenLabs gave, so one unanswered check does not stop the narrator. */
let lastCredits: { left: number; at: number } | undefined;
/** How long a known balance stands in for an unanswered check (job spend since then is subtracted by the caller's cushion). */
const CREDITS_STALE_MS = 2 * 60 * 60 * 1000;
/**
 * Spend the factory cannot see (sandbox runs on the PC, a manual voice test) is assumed at this many characters a day
 * when a balance read from disk stands in: the older the reading, the more is taken off it.
 */
export const UNSEEN_CHARS_PER_DAY = 50_000;

/** Test hook: forget the remembered balance. */
export function resetElevenLabsCreditsCache(): void {
  lastCredits = undefined;
}

export interface ElevenLabsBalance {
  left: number;
  /** live: the API answered now; memory: a reading from the last two hours; disk: an older reading kept across restarts. */
  source: "live" | "memory" | "disk";
  /** Age of the reading in milliseconds (0 when live). */
  ageMs: number;
}

export interface CreditsOpts {
  tries?: number;
  waitMs?: number;
  now?: () => number;
  /**
   * ELEVENLABS_BALANCE_STALE_HOURS: the balance is kept in this file, so a factory restart during an ElevenLabs blip
   * does not leave the narrator with no balance at all (18 Nov: two restarts while the subscription check was not
   * answering stopped 5 Shorts over 3.5 hours with 619,000 characters left, while voicing itself still worked).
   */
  file?: string;
  /** How old a reading from the file may be and still stand in; 0 or unset never reads the file. */
  staleMs?: number;
}

async function readBalanceFile(
  file: string,
): Promise<{ left: number; at: number } | undefined> {
  try {
    const j = JSON.parse(await fs.readFile(file, "utf8")) as {
      left?: unknown;
      at?: unknown;
    };
    if (
      typeof j.left === "number" &&
      typeof j.at === "number" &&
      Number.isFinite(j.left) &&
      Number.isFinite(j.at)
    )
      return { left: j.left, at: j.at };
  } catch {
    /* no file yet, or unreadable */
  }
  return undefined;
}

/** Every write of the balance file goes through this one chain, so jobs finishing together never lose a spend. */
let balanceChain: Promise<unknown> = Promise.resolve();
let balanceTmpSeq = 0;
function serialBalance<T>(fn: () => Promise<T>): Promise<T> {
  const next = balanceChain.then(fn, fn);
  balanceChain = next.catch(() => undefined);
  return next;
}

async function writeBalanceFile(
  file: string,
  b: { left: number; at: number },
): Promise<void> {
  try {
    const tmp = `${file}.${process.pid}.${++balanceTmpSeq}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(b));
    await fs.rename(tmp, file);
  } catch (err) {
    log("warn", "could not keep the ElevenLabs balance on disk", {
      error: errorMessage(err),
    });
  }
}

/**
 * Characters just spent on ElevenLabs, taken off the remembered balance (in memory and on disk) so a reading that
 * stands in for an unanswered check is never the balance from before this spend.
 */
export async function noteElevenLabsSpend(
  chars: number,
  file?: string,
): Promise<void> {
  if (!(chars > 0)) return;
  if (lastCredits)
    lastCredits = { ...lastCredits, left: lastCredits.left - chars };
  if (!file) return;
  await serialBalance(async () => {
    const b = await readBalanceFile(file);
    if (b) await writeBalanceFile(file, { left: b.left - chars, at: b.at });
  });
}

/**
 * Characters left this month on the ElevenLabs plan, with where the figure came from, or undefined if unknown (bad
 * key, API down and nothing remembered). The subscription check is asked up to three times (it went unanswered 28
 * times on 18 Nov and stopped every Short it hit); when it still does not answer, a balance read in the last two
 * hours stands in, then (with `file` and `staleMs`) a reading kept on disk, less the unseen-spend allowance for its
 * age. A 401 (bad key) never uses a remembered balance.
 */
export async function elevenLabsBalance(
  apiKey: string,
  opts: CreditsOpts = {},
): Promise<ElevenLabsBalance | undefined> {
  const tries = opts.tries ?? 3;
  const waitMs = opts.waitMs ?? 2_000;
  const now = opts.now ?? Date.now;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs * i));
    try {
      const res = await fetchWithTimeout(
        "https://api.elevenlabs.io/v1/user/subscription",
        { headers: { "xi-api-key": apiKey } },
        15_000,
      );
      if (res.status === 401 || res.status === 403) return undefined;
      if (!res.ok) continue;
      const s = (await res.json()) as {
        character_count?: number;
        character_limit?: number;
      };
      if (s.character_limit == null || s.character_count == null) continue;
      const left = s.character_limit - s.character_count;
      lastCredits = { left, at: now() };
      const reading = lastCredits;
      if (opts.file) {
        const f = opts.file;
        await serialBalance(() => writeBalanceFile(f, reading));
      }
      return { left, source: "live", ageMs: 0 };
    } catch {
      /* try again */
    }
  }
  if (lastCredits && now() - lastCredits.at < CREDITS_STALE_MS)
    return {
      left: lastCredits.left,
      source: "memory",
      ageMs: now() - lastCredits.at,
    };
  if (opts.file && opts.staleMs && opts.staleMs > 0) {
    const b = await readBalanceFile(opts.file);
    const age = b ? now() - b.at : Infinity;
    if (b && age >= 0 && age < opts.staleMs) {
      const unseen = Math.ceil(
        (UNSEEN_CHARS_PER_DAY * Math.max(age, 60 * 60 * 1000)) / 86_400_000,
      );
      return { left: Math.max(0, b.left - unseen), source: "disk", ageMs: age };
    }
  }
  return undefined;
}

/** Where the balance is kept across restarts, or undefined when ELEVENLABS_BALANCE_STALE_HOURS is 0 (the old behaviour). */
export function elevenLabsBalanceFile(
  cfg: Pick<Config, "dataDir" | "elevenLabsBalanceStaleHours">,
): string | undefined {
  return (cfg.elevenLabsBalanceStaleHours ?? 0) > 0
    ? path.join(cfg.dataDir, "elevenlabs_balance.json")
    : undefined;
}

/** Characters left this month on the ElevenLabs plan, or undefined if unknown (see elevenLabsBalance). */
export async function elevenLabsCreditsLeft(
  apiKey: string,
  opts: CreditsOpts = {},
): Promise<number | undefined> {
  return (await elevenLabsBalance(apiKey, opts))?.left;
}

/**
 * Highpass, gentle compression and a limiter: the narration chain from the Codex mix. Returns the
 * seconds of leading silence it trimmed, which the word timings must lose too.
 */
/** The speed-up a take needs to reach `minWpm` (never more than 25%, never for a take under 15 words); 1 when none. */
export function paceFactor(
  words: number,
  seconds: number,
  minWpm: number,
): number {
  if (!minWpm || words < 15 || seconds <= 0) return 1;
  const wpm = (words / seconds) * 60;
  if (wpm >= minWpm) return 1;
  return Math.min(1.25, (minWpm + 3) / wpm);
}

/** Plays the file faster without changing its pitch (atempo: the owner preferred it to Rubber Band by ear, 5 Nov 2026). */
export async function speedUp(file: string, factor: number): Promise<void> {
  const tmp = `${file}.paced.mp3`;
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    file,
    "-af",
    `atempo=${factor.toFixed(4)}`,
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    tmp,
  ]);
  await fs.rename(tmp, file);
}

/** The narration's level after the polish: the mix and the -16 LUFS master are set against it. */
export const VOICE_LOUDNORM = "loudnorm=I=-17:TP=-2.5:LRA=5";

/**
 * The "creator mic" of the owner's sample C (11 Nov 2026): a little warmth at 180 Hz, presence at 4.5 kHz, a
 * gentler second compressor and a faint 22 ms room, so the voice sounds like a person at a good microphone
 * rather than a dry studio read. Sample C ended on loudnorm at -14 LUFS; here it ends back at the polish's
 * -17 instead, because the music mix is balanced against that level and the master sets the final loudness.
 */
export const MIC_CHAIN =
  "highpass=f=80,equalizer=f=180:t=q:w=1:g=2,equalizer=f=4500:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=3,aecho=0.8:0.85:22:0.06";

/** The filter the finished narration gets after the speed-up, or undefined when VOICE_MIC_CHAIN is off. */
export function micChainFilter(
  cfg: Pick<Config, "voiceMicChain">,
): string | undefined {
  return cfg.voiceMicChain ? `${MIC_CHAIN},${VOICE_LOUDNORM}` : undefined;
}

/** Runs a filter over the narration in place; durations and word timings are unchanged. */
export async function filterVoice(file: string, filter: string): Promise<void> {
  const tmp = `${file}.mic.mp3`;
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    file,
    "-af",
    filter,
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    tmp,
  ]);
  await fs.rename(tmp, file);
}

export async function polishVoice(file: string): Promise<number> {
  const tmp = `${file}.polished.mp3`;
  const before = await decodedSeconds(file);
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-i",
    file,
    "-af",
    `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,highpass=f=70,acompressor=threshold=-30dB:ratio=5.5:attack=5:release=120:makeup=4,alimiter=limit=0.95,${VOICE_LOUDNORM}`,
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    tmp,
  ]);
  await fs.rename(tmp, file);
  return Math.max(0, before - (await decodedSeconds(file)));
}

/** The ElevenLabs voice for the n-th Short (0-based): the pool rotates every `rotation` Shorts, the configured voice when the pool is empty. */
export function pickVoice(
  cfg: Config,
  ordinal: number,
): { id: string; name: string } {
  if (!cfg.voicePool.length)
    return {
      id: cfg.elevenLabsVoiceId,
      name: cfg.narratorName || cfg.elevenLabsVoiceId,
    };
  return cfg.voicePool[
    Math.floor(Math.max(0, ordinal) / cfg.voiceRotation) % cfg.voicePool.length
  ]!;
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
  hooks: {
    onEvent?: (
      kind: string,
      detail: Record<string, unknown>,
    ) => Promise<void> | void;
    /** A Short's narration: its hook may be retaken (HOOK_TAKES). */
    hookTakes?: boolean;
  } = {},
): Promise<NarrationWithVoice> {
  // The very last door: nothing that talks about the writing task reaches a voice, whoever is calling.
  if (cfg.writerNotesGuard !== false) {
    const notes = writerNoteHits(stripVoiceTags(text));
    if (notes.length)
      throw new FatalError(
        `writer's notes in the narration, not voiced: "${notes[0]!.sentence.slice(0, 160)}"`,
      );
  }
  const order = providerOrder(cfg.voiceProvider);
  const errors: string[] = [];
  for (const provider of order) {
    // Delivery tags are acted only by eleven_v3; the local clone and older models would read them out.
    const spoken =
      provider === "elevenlabs" &&
      cfg.voiceTags &&
      cfg.elevenLabsModel.startsWith("eleven_v3")
        ? text
        : stripVoiceTags(text);
    try {
      let n: Narration;
      if (provider === "local") {
        n = await synthesiseLocal(spoken, outPath, {
          baseUrl: cfg.localTtsUrl,
          voiceId: cfg.localVoiceId,
          speakingRate: cfg.localSpeakingRate,
          startScript: cfg.localTtsStart || undefined,
        });
      } else {
        if (!cfg.elevenLabsApiKey)
          throw new Error("ElevenLabs is not configured");
        const balanceFile = elevenLabsBalanceFile(cfg);
        const balance = await elevenLabsBalance(cfg.elevenLabsApiKey, {
          file: balanceFile,
          staleMs: (cfg.elevenLabsBalanceStaleHours ?? 0) * 60 * 60 * 1000,
        });
        const left = balance?.left;
        if (balance?.source === "disk") {
          log("info", "ElevenLabs balance: older reading used", {
            left: balance.left,
            hours: (balance.ageMs / 3_600_000).toFixed(1),
          });
          await hooks.onEvent?.("elevenlabs_balance_stale", {
            left: balance.left,
            hours: Number((balance.ageMs / 3_600_000).toFixed(1)),
          });
        }
        // Unknown balance (invalid key, API down) is a refusal when ElevenLabs is merely preferred:
        // the point of elevenlabs-first is to use paid-for credits, not to risk a bill.
        if (left === undefined && cfg.voiceProvider === "elevenlabs-first")
          throw new Error("ElevenLabs balance unknown (check the API key)");
        // Never into overage: the job plus a cushion must fit the balance, or the local voice takes it.
        if (
          left !== undefined &&
          left < spoken.length * 1.2 + cfg.elevenLabsReserve
        )
          throw new Error(`ElevenLabs has ${left} characters left this month`);
        const elOpts = {
          apiKey: cfg.elevenLabsApiKey,
          voiceId: voice?.id ?? cfg.elevenLabsVoiceId,
          modelId: cfg.elevenLabsModel,
          settings: { stability: cfg.voiceStability },
        };
        // A long-form script is spoken in takes: the timestamps endpoint takes a few thousand characters at a time.
        // Re-voicing a stray take spends extra characters, only out of what the balance holds beyond this job and the reserve.
        // An older reading from disk pays for the job itself, never for extra takes (0, not undefined: undefined
        // means no limit to synthesiseElevenLabsLong).
        const revoiceChars =
          balance?.source === "disk"
            ? 0
            : left === undefined
              ? undefined
              : Math.max(0, left - spoken.length * 1.2 - cfg.elevenLabsReserve);
        // What this job may spend at most, taken off the remembered balance even if it fails part-way (an upper
        // bound errs low, which is the safe side; the next live reading corrects it).
        const longJob = spoken.length > LONG_TEXT_CHARS;
        const maxRevoice = longJob
          ? Math.min(revoiceChars ?? Infinity, MAX_REVOICES * LONG_TEXT_CHARS)
          : 0;
        try {
          n = longJob
            ? await synthesiseElevenLabsLong(spoken, outPath, {
                ...elOpts,
                takeCheck: cfg.voiceTakeCheck,
                revoiceChars,
                onEvent: hooks.onEvent,
              })
            : await synthesiseElevenLabs(spoken, outPath, elOpts);
        } finally {
          await noteElevenLabsSpend(spoken.length + maxRevoice, balanceFile);
        }
        // HOOK_TAKES: a Short's hook line voiced again, the best read spliced in (src/voice/hooktakes.ts). Only out
        // of what the balance holds beyond this job and the reserve; an unknown balance spends nothing extra.
        if (
          hooks.hookTakes &&
          cfg.hookTakes > 0 &&
          spoken.length <= LONG_TEXT_CHARS &&
          revoiceChars !== undefined &&
          revoiceChars > 0
        ) {
          const hook = hookOf(spoken);
          if (hook && hook.length * cfg.hookTakes <= revoiceChars) {
            const r = await bestHook({
              audio: outPath,
              words: n.words,
              spoken,
              takes: cfg.hookTakes,
              speed: cfg.speedFactor ?? 1,
              targetWpm: cfg.hookTargetWpm,
              whisperPython: cfg.whisperPython || undefined,
              voice: (t, out) => synthesiseElevenLabs(t, out, elOpts),
              ledger: path.join(cfg.dataDir, "hooktakes.jsonl"),
              meta: {
                episode: episodeIdOf(cfg.dataDir, outPath),
                voice: elOpts.voiceId,
                model: elOpts.modelId,
              },
            })
              .catch((err) => {
                log(
                  "warn",
                  "hook takes failed; keeping the narration's own hook",
                  { error: errorMessage(err) },
                );
                return undefined;
              })
              // The takes' upper bound, spent or not, so a part-way failure is still counted.
              .finally(() =>
                noteElevenLabsSpend(hook.length * cfg.hookTakes, balanceFile),
              );
            if (r) {
              if (r.words && r.shift !== undefined)
                n = {
                  ...n,
                  words: r.words,
                  durationSeconds: n.durationSeconds + r.shift,
                };
              await hooks.onEvent?.("hook_takes", {
                characters: r.characters,
                chosen: r.chosen === 0 ? "narration" : `take ${r.chosen}`,
                scores: r.scores
                  .map(
                    (s) =>
                      `${s.label} ${s.total.toFixed(2)}${s.out ? ` (out: ${s.out})` : ""}`,
                  )
                  .join("; "),
              });
              log("info", "hook takes", {
                characters: r.characters,
                chosen: r.chosen,
              });
            }
          }
        }
      }
      // ElevenLabs voices breathe audibly between lines; its timestamps say where, so those gaps go quiet. The
      // timings still hold the tags here, so the breath pass can leave a chuckle or a sigh alone.
      if (provider === "elevenlabs") await quietBreaths(outPath, n.words);
      // From here on the timings are the words alone: captions, pause trims and the narration check never see a tag.
      n = { ...n, words: dropTagWords(n.words) };
      const trimmed = await polishVoice(outPath);
      if (trimmed > 0.005)
        n = {
          ...n,
          words: n.words.map((w) => ({
            ...w,
            start: Math.max(0, w.start - trimmed),
            end: Math.max(0, w.end - trimmed),
          })),
          durationSeconds: n.durationSeconds - trimmed,
        };
      // Never a sleepy read: the newer voice model ignores the speed setting, and Alice came out at 109-129 words
      // a minute on 28 Oct (Liam ran 142-151). A slow take is sped up, pitch kept, its timings scaled to match.
      const factor = Math.min(
        1.25,
        Math.max(
          paceFactor(n.words.length, n.durationSeconds, cfg.minWordsPerMinute),
          cfg.speedFactor ?? 1,
        ),
      );
      if (factor > 1) {
        await speedUp(outPath, factor);
        n = {
          ...n,
          words: n.words.map((w) => ({
            ...w,
            start: w.start / factor,
            end: w.end / factor,
          })),
          durationSeconds: n.durationSeconds / factor,
        };
        log("info", "narration sped up", { factor: factor.toFixed(3) });
      }
      const mic = micChainFilter(cfg);
      if (mic) await filterVoice(outPath, mic);
      const used =
        provider === "local"
          ? {
              provider,
              id: cfg.localVoiceId,
              name: `${cfg.narratorName} (local clone)`,
            }
          : {
              provider,
              id: voice?.id ?? cfg.elevenLabsVoiceId,
              name: voice?.name ?? cfg.elevenLabsVoiceId,
            };
      log("info", "narration ready", {
        provider,
        voice: used.name,
        seconds: n.durationSeconds.toFixed(1),
      });
      return { ...n, voice: used };
    } catch (err) {
      errors.push(`${provider}: ${errorMessage(err)}`);
      log("warn", "narrator unavailable", {
        provider,
        error: errorMessage(err),
      });
    }
  }
  throw new Error(`no narrator available (${errors.join("; ")})`);
}
