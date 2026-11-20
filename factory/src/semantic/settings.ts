// The settings of meaning-based matching (MATCH_SEMANTIC) and the stream tags (VOD_TAGS), read in one place (pure: the
// environment is passed in) so the rest of the config stays untouched.

import fs from "node:fs";
import os from "node:os";

export interface SemanticSettings {
  /** MATCH_SEMANTIC: lines are matched to pictures and shots by what they mean as well as the names they share. Off until proven. */
  enabled: boolean;
  /** SEMANTIC_MODEL: the picture-and-words model (SigLIP 2 base, Apache 2.0). */
  model: string;
  /** SEMANTIC_PYTHON: a Python with torch and transformers (the parallax venv on the Mac). */
  python: string;
  /** SEMANTIC_DEVICE: auto (MPS on the Mac, CUDA on the PC), mps, cuda or cpu. */
  device: string;
  /** SEMANTIC_IDLE_SECONDS: the model's process ends after this long without a question. */
  idleSeconds: number;
  /** SEMANTIC_PRIORITY: the orchestrator priority of a batch on the PC (60 production, 20 tests). */
  priority: number;
  /** SEMANTIC_MIN_SCORE: a picture is pinned to a line only from this meaning score up (0-1). */
  minScore: number;
  /** SEMANTIC_MARGIN: and only when it beats the line's next best picture by this much. */
  margin: number;
  /** SEMANTIC_SHOTS_PER_TURN: scene index shots embedded in one background turn. */
  shotsPerTurn: number;
  /** VOD_TAGS: every stretch of the owner's recordings tagged with place, activity, vehicle, brands, time of day and spoilers. On by default. */
  vodTags: boolean;
  /** VOD_TAGS_BATCH: shots tagged in one piece of work. */
  vodTagsBatch: number;
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};
const num = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const n = Number(env[name]);
  return env[name] === undefined || env[name] === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

/** The Python that has torch and transformers on this machine (the parallax venv), or plain python3. */
export function defaultSemanticPython(
  home = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const venvs = [
    "D:/pulse-tools/parallax-venv/Scripts/python.exe",
    `${home}/PulseFactory/parallax/bin/python`,
  ];
  return (
    venvs.find((p) => exists(p)) ??
    (process.platform === "win32" ? "python" : "python3")
  );
}

export function semanticSettings(
  env: NodeJS.ProcessEnv,
  exists?: (p: string) => boolean,
): SemanticSettings {
  return {
    enabled: bool(env, "MATCH_SEMANTIC", false),
    model: env.SEMANTIC_MODEL || "google/siglip2-base-patch16-224",
    python: env.SEMANTIC_PYTHON || defaultSemanticPython(os.homedir(), exists),
    device: env.SEMANTIC_DEVICE || "auto",
    idleSeconds: num(env, "SEMANTIC_IDLE_SECONDS", 90, 10, 3600),
    priority: Math.round(num(env, "SEMANTIC_PRIORITY", 60, 1, 100)),
    minScore: num(env, "SEMANTIC_MIN_SCORE", 0.5, 0.05, 1),
    margin: num(env, "SEMANTIC_MARGIN", 0.1, 0, 1),
    shotsPerTurn: Math.round(
      num(env, "SEMANTIC_SHOTS_PER_TURN", 600, 10, 20000),
    ),
    vodTags: bool(env, "VOD_TAGS", true),
    vodTagsBatch: Math.round(num(env, "VOD_TAGS_BATCH", 200, 5, 5000)),
  };
}

/** One line for the boot summary. */
export function semanticSummary(s: SemanticSettings): string {
  return `meaning match ${s.enabled ? `on (${s.model}, pin from ${s.minScore})` : "off"}; stream tags ${s.vodTags ? "on" : "off"}`;
}
