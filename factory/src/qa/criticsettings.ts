// The finished-video critic's settings (CRITIC, src/criticstep.ts): a leaf module with no imports, so src/config.ts
// can read them without pulling in the critic itself.

/** CRITIC: off; report scores the finished video and logs it; fix also runs one timeline fix pass or blocks. */
export type CriticMode = "off" | "report" | "fix";

export function criticMode(raw: string | undefined): CriticMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "fix" || v === "on" || v === "true" || v === "1") return "fix";
  if (v === "report" || v === "log") return "report";
  return "off";
}

export interface CriticSettings {
  mode: CriticMode;
  /** The vision model the critic asks (CRITIC_VISION_MODEL); empty: the factory's LOCAL_VISION_MODEL. */
  model: string;
  /**
   * Models that take most of the PC: loaded only inside an orchestrator heavy turn, unloaded after. Ollama 0.40 on the
   * PC loads with mmap off, so a big model needs its full size in system RAM as well as on the card (orchestrator
   * chat, 14 Nov 2026). Any tag of 20B or more counts as big even when it is not listed.
   */
  bigModels: string[];
  /** GB of graphics memory a big model's turn asks the orchestrator for. */
  leaseVram: number;
  /** GB of system memory a big model's turn asks the orchestrator for (mmap off: the whole model). */
  leaseRam: number;
  /** A frame every this many seconds, besides one at every cut. */
  everySeconds: number;
  /** At most this many judged frames a video (the two-second grid widens past it). */
  maxFrames: number;
  /** Time-weighted mean picture-to-line score (0-3) under which the pictures do not follow the words. */
  minMatch: number;
  /** Share of judged screen time scored 0 (wrong, broken, unrelated) over which the video is blocked. */
  maxZeroShare: number;
  /** Seconds of true silence in the mix that count as dead air (Shorts; long videos double it). */
  maxSilence: number;
  /** Seconds the narration may pause outside a planned break before it is dead air on a Short (long: double). */
  maxNarrationGap: number;
  /** Seconds a picture may stand frozen (not planned) before it is a fault. */
  maxFrozen: number;
}

export const DEFAULT_BIG_MODELS = [
  "qwen3-vl:30b",
  "qwen3-vl:32b",
  "qwen3.6:27b",
  "qwen3.6:35b",
  "gemma4:31b",
  "gemma4:26b",
];

export const DEFAULT_CRITIC: CriticSettings = {
  mode: "off",
  model: "",
  bigModels: DEFAULT_BIG_MODELS,
  leaseVram: 21,
  leaseRam: 22,
  everySeconds: 2,
  maxFrames: 1200,
  minMatch: 1.4,
  maxZeroShare: 0.2,
  maxSilence: 1.0,
  maxNarrationGap: 1.6,
  maxFrozen: 2.0,
};

/** Whether a model name is one of the big ones (pure; the tag must match, ":latest" when absent). */
export function isBigModel(model: string, big: readonly string[]): boolean {
  const norm = (n: string) => {
    const t = n.trim().toLowerCase();
    return t.includes(":") ? t : `${t}:latest`;
  };
  const m = norm(model);
  if (big.some((b) => norm(b) === m)) return true;
  // "gemma4:31b", "qwen3-vl:30b-a3b-instruct-q4_K_M": a size of 20B or more in the tag.
  const size = m.slice(m.indexOf(":") + 1).match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)b(?![a-z])/);
  return !!size && Number(size[1]) >= 20;
}

