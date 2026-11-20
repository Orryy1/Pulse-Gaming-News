// Types for soundtags.mjs (plain JavaScript, so the highlight finder can run it under plain node).
export interface SoundWindow {
  t: number;
  d: number;
  top: Array<[string, number]>;
}
export interface SpeechSpan {
  from: number;
  to: number;
}
export type SoundTag =
  | "explosion"
  | "gunfire"
  | "crash"
  | "laughter"
  | "crowd"
  | "shout"
  | "engine"
  | "music"
  | "speech";
export const SOUND_TAGS: Record<SoundTag, string[]>;
export const TAG_WEIGHTS: Record<SoundTag, number>;
export const MIN_CONFIDENCE: number;
export function tagsPerSecond(
  windows: SoundWindow[] | undefined,
  seconds?: number,
  minConfidence?: number,
): SoundTag[][];
export function soundBonus(tags: SoundTag[][]): number[];
export function speechSpans(
  windows: SoundWindow[] | undefined,
  min?: number,
  gap?: number,
): SpeechSpan[];
export function speechShare(spans: SpeechSpan[], seconds: number): number;
export function soundTagsOn(raw?: string): boolean;
export function soundCommand(
  platform: string,
  wav: string,
  python?: string,
): { cmd: string; args: string[] } | undefined;
export function classifySound(
  file: string,
  o?: {
    platform?: string;
    python?: string;
    ffmpeg?: string;
    from?: number;
    seconds?: number;
  },
): Promise<SoundWindow[] | undefined>;
