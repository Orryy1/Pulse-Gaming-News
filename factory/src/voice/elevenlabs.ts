// Narration via ElevenLabs /with-timestamps: the response carries character
// level timings, so captions need no separate speech-recognition pass.

import fs from "node:fs/promises";
import { fetchWithTimeout, FatalError, log } from "../lib/util.ts";

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

// Owner's pick of 29 Oct 2026 (sample B of three): on eleven_v3, stability 1.0 is the "robust" delivery, which
// breathes far less audibly than 0.4; style 0 with it. The pace stays at 1.05.
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { stability: 1.0, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true, speed: 1.05 };

/**
 * Continuity for one take of a long narration (30 Oct 2026): the neighbouring takes' text, the earlier
 * takes' request ids, and a seed. ElevenLabs reads them to keep the voice's pitch and colour steady across
 * separate requests; without them every take sampled the voice afresh and the Halo ranking's takes drifted
 * apart in pitch and brightness. All optional; a field the model refuses is dropped (see `unsupported`).
 */
export interface TakeContext {
  previousText?: string;
  nextText?: string;
  /** At most 3 (the API's limit). Request stitching is not available on eleven_v3 (ElevenLabs docs). */
  previousRequestIds?: string[];
  nextRequestIds?: string[];
  /** 0 to 4294967295; best-effort deterministic sampling. */
  seed?: number;
}

export interface SynthOptions extends VoiceOptions {
  context?: TakeContext;
  /** Fields the API refused earlier in this run; never sent again. Filled in by synthesise. */
  unsupported?: Set<string>;
  /** Tests point this at a stand-in server. */
  baseUrl?: string;
}

/** The optional continuity fields, as the API names them. */
export const CONTEXT_FIELDS = ["previous_text", "next_text", "previous_request_ids", "next_request_ids", "seed"] as const;

/** The JSON body of a with-timestamps request (pure, for tests). */
export function requestBody(text: string, opts: Pick<SynthOptions, "modelId" | "settings" | "context" | "unsupported">): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text,
    model_id: opts.modelId,
    // Multilingual models (v2 multilingual, v3) detect the language themselves: the twin channel speaks Spanish.
    language_code: opts.modelId.includes("multilingual") || opts.modelId.startsWith("eleven_v3") ? undefined : "en",
    voice_settings: { ...DEFAULT_VOICE_SETTINGS, ...(opts.settings ?? {}) },
  };
  const c = opts.context;
  if (c) {
    const put = (field: string, value: unknown) => {
      if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
      if (opts.unsupported?.has(field)) return;
      body[field] = value;
    };
    put("previous_text", c.previousText);
    put("next_text", c.nextText);
    put("previous_request_ids", c.previousRequestIds?.slice(-3));
    put("next_request_ids", c.nextRequestIds?.slice(0, 3));
    put("seed", c.seed === undefined ? undefined : Math.max(0, Math.min(4294967295, Math.floor(c.seed))));
  }
  return body;
}

/**
 * The continuity fields a 400/422 answer refuses: those it names, or, when it names none of those sent, every one
 * that was sent (a narration is never lost over an optional field).
 */
export function refusedFields(status: number, message: string, sent: string[]): string[] {
  if (status !== 400 && status !== 422) return [];
  const opt = sent.filter((f) => (CONTEXT_FIELDS as readonly string[]).includes(f));
  if (!opt.length) return [];
  // eleven_v3 answers "Providing previous_text or next_text is not yet supported" (31 Oct 2026): every field the
  // message names is refused, sent this time or not, so the next take does not trip over the other one.
  const named = CONTEXT_FIELDS.filter((f) => message.includes(f));
  return named.some((f) => opt.includes(f)) ? [...named] : opt;
}

export async function synthesise(text: string, outPath: string, opts: SynthOptions): Promise<Narration & { requestId?: string }> {
  if (!opts.apiKey) throw new FatalError("ELEVENLABS_API_KEY is not set");
  const base = opts.baseUrl ?? "https://api.elevenlabs.io";
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const unsupported = opts.unsupported ?? new Set<string>();
  const send = (body: Record<string, unknown>) =>
    fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "xi-api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      },
      180_000, // a long-form take is up to about 3,000 characters
    );
  let body = requestBody(text, { ...opts, unsupported });
  let res = await send(body);
  if (res.status === 400 || res.status === 422) {
    const message = await res.text();
    const refused = refusedFields(res.status, message, Object.keys(body));
    if (!refused.length) throw new Error(`ElevenLabs HTTP ${res.status}: ${message.slice(0, 300)}`);
    // Retry once without the refused fields, and never send them again in this run.
    for (const f of refused) unsupported.add(f);
    log("warn", "ElevenLabs refused a continuity field; retrying without it", { fields: refused.join(","), model: opts.modelId, status: res.status, error: message.slice(0, 200) });
    body = requestBody(text, { ...opts, unsupported });
    res = await send(body);
  }
  if (res.status === 401 || res.status === 403) throw new FatalError(`ElevenLabs rejected the credentials (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const requestId = res.headers.get("request-id") ?? undefined;
  const json = (await res.json()) as { audio_base64: string; alignment?: Alignment; normalized_alignment?: Alignment };
  const alignment = json.alignment ?? json.normalized_alignment;
  if (!alignment) throw new Error("ElevenLabs response had no alignment");
  await fs.writeFile(outPath, Buffer.from(json.audio_base64, "base64"));
  const words = wordsFromAlignment(alignment);
  const durationSeconds = (alignment.character_end_times_seconds.at(-1) ?? 0) + 0.15;
  return { audioPath: outPath, words, durationSeconds, requestId };
}
