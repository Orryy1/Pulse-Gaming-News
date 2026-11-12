// Who is talking in a clip, by Apple's Sound Analysis on the Mac mini (APPLE_SOUND_TAGS, 12 Nov 2026). The built-in
// classifier hears speech in about a second for a ten-minute file, without a model or the speech recogniser:
//   - talk.ts keepGameSound: plain speech means the clip is muted at once, no speech at all keeps its game sound;
//     anything in between still goes to the speech recogniser, as before;
//   - cutscenes.ts: each downloaded section's spoken lines, so a cutscene clip that cuts into a line is flagged.
// The tagging itself lives in mac/gameplay/soundtags.mjs, shared with the highlight finder. Off, anywhere but the
// Mac, under test or on any failure it hears nothing and every caller does what it did before.
import { FFMPEG } from "../lib/bin.ts";
import {
  classifySound,
  soundTagsOn,
  speechShare,
  speechSpans,
  type SpeechSpan,
} from "../../mac/gameplay/soundtags.mjs";

export type { SpeechSpan };

export interface HeardSpeech {
  spans: SpeechSpan[];
  /** The share of the audio with someone talking, 0-1. */
  share: number;
  seconds: number;
}

/** Above this share of speech a clip is talk (commentary, dialogue), not game sound. */
export const TALK_SHARE = 0.35;

/** What Apple's hearing says about keeping a clip's sound (pure): talk, clean (not a word), or ask the recogniser. */
export function talkVerdict(
  heard: HeardSpeech | undefined,
): "talk" | "clean" | "unsure" {
  if (!heard) return "unsure";
  if (heard.share >= TALK_SHARE) return "talk";
  // No window at even low speech confidence: game sound only.
  return heard.spans.length === 0 && heard.share === 0 ? "clean" : "unsure";
}

/** True when any spoken line overlaps [from, to) seconds (pure). */
export function overlapsSpeech(
  spans: SpeechSpan[],
  from: number,
  to: number,
): boolean {
  return spans.some((s) => s.from < to && s.to > from);
}

/** Whether Apple's hearing runs here: the setting on, on the Mac, not under test. */
export function appleSoundReady(
  enabled = soundTagsOn(),
  platform = process.platform,
): boolean {
  return enabled && platform === "darwin" && !process.env.NODE_TEST_CONTEXT;
}

/**
 * The spoken lines in a file's audio (or a stretch of it), or undefined when Apple's hearing is off or failed.
 * Speech is counted from confidence 0.3 for the "clean" verdict, so a quiet line is never mistaken for silence.
 */
export async function appleSpeech(
  file: string,
  o: { enabled?: boolean; from?: number; seconds?: number } = {},
): Promise<HeardSpeech | undefined> {
  if (!appleSoundReady(o.enabled ?? soundTagsOn())) return undefined;
  const windows = await classifySound(file, {
    ffmpeg: FFMPEG,
    from: o.from,
    seconds: o.seconds,
  });
  if (!windows) return undefined;
  const seconds = o.seconds ?? Math.max(0, ...windows.map((w) => w.t + w.d));
  const spans = speechSpans(windows, 0.5);
  const faint = speechSpans(windows, 0.3);
  return {
    spans: spans.length ? spans : faint,
    share: speechShare(spans, seconds),
    seconds,
  };
}
