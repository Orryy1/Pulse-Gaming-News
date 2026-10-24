// Narration via ElevenLabs /with-timestamps: the response carries character
// level timings, so captions need no separate speech-recognition pass.

import fs from "node:fs/promises";
import { fetchWithTimeout, FatalError } from "../lib/util.ts";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Narration {
  audioPath: string;
  words: Word[];
  durationSeconds: number;
}

/** Collapses character timings into word timings (punctuation stays attached). */
export function wordsFromAlignment(a: Alignment): Word[] {
  const words: Word[] = [];
  let cur: Word | undefined;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i]!;
    const start = a.character_start_times_seconds[i] ?? 0;
    const end = a.character_end_times_seconds[i] ?? start;
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = undefined;
      continue;
    }
    if (!cur) cur = { text: ch, start, end };
    else {
      cur.text += ch;
      cur.end = end;
    }
  }
  if (cur) words.push(cur);
  return words;
}

export interface VoiceOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  /** Delivery: lower stability and higher style give more rise and fall (measured on Liam, 24 Oct 2026). */
  settings?: Partial<VoiceSettings>;
}

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.05 };

export async function synthesise(text: string, outPath: string, opts: VoiceOptions): Promise<Narration> {
  if (!opts.apiKey) throw new FatalError("ELEVENLABS_API_KEY is not set");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "xi-api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        text,
        model_id: opts.modelId,
        language_code: opts.modelId.includes("multilingual") ? undefined : "en",
        voice_settings: { ...DEFAULT_VOICE_SETTINGS, ...(opts.settings ?? {}) },
      }),
    },
    120_000,
  );
  if (res.status === 401 || res.status === 403) throw new FatalError(`ElevenLabs rejected the credentials (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { audio_base64: string; alignment?: Alignment; normalized_alignment?: Alignment };
  const alignment = body.alignment ?? body.normalized_alignment;
  if (!alignment) throw new Error("ElevenLabs response had no alignment");
  await fs.writeFile(outPath, Buffer.from(body.audio_base64, "base64"));
  const words = wordsFromAlignment(alignment);
  const durationSeconds = (alignment.character_end_times_seconds.at(-1) ?? 0) + 0.15;
  return { audioPath: outPath, words, durationSeconds };
}
