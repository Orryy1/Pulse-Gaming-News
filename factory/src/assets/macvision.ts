// Picture checks on the Mac mini itself (MAC_VISION, 12 Nov 2026): mac/vision_server.py runs a small local vision
// model (Qwen3.5, Apache 2.0, 4-bit MLX) behind the same Ollama calls the factory makes to the PC's relay, loading
// it only for a picture, through ~/orch/macrun.sh's turns, and unloading it after idle or when a render starts.
//   MAC_VISION=off       (default) every picture check goes to the PC relay, as before
//   MAC_VISION=on        the Mac answers while the PC relay is down (fallback)
//   MAC_VISION=always    the Mac answers every picture check; the PC relay only when the Mac's server is not up
// Anywhere but the Mac it is always off. MAC_VISION_URL overrides where the server listens.
import { fetchWithTimeout } from "../lib/util.ts";

export type MacVisionMode = "off" | "fallback" | "always";

export const MAC_VISION_URL = (
  process.env.MAC_VISION_URL || "http://127.0.0.1:8878"
).replace(/\/$/, "");

/** The setting as a mode: on, true, yes, 1 and fallback mean fallback; always means always; anything else off. */
export function macVisionMode(
  raw: string | undefined = process.env.MAC_VISION,
): MacVisionMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "always") return "always";
  if (["on", "true", "yes", "1", "fallback"].includes(v)) return "fallback";
  return "off";
}

/**
 * Which machine answers a picture check. The Mac only on the Mac, only while its server answers, and in fallback
 * mode only while the PC relay is down.
 */
export function chooseVisionHost(o: {
  mode: MacVisionMode;
  platform: string;
  pcDown: boolean;
  macUp: boolean;
}): "pc" | "mac" {
  if (o.mode === "off" || o.platform !== "darwin" || !o.macUp) return "pc";
  if (o.mode === "always") return "mac";
  return o.pcDown ? "mac" : "pc";
}

let heard: { at: number; up: boolean } | undefined;

/** The Mac's vision server answers its model list (no model is loaded for this). Cached for a minute. */
export async function macVisionUp(now = Date.now()): Promise<boolean> {
  if (heard && now - heard.at < 60_000) return heard.up;
  const up = await fetchWithTimeout(`${MAC_VISION_URL}/api/tags`, {}, 3_000)
    .then((r) => r.ok)
    .catch(() => false);
  heard = { at: now, up };
  return up;
}

/** Unloads the Mac's model at once (before a render here); a no-op when the setting is off or off the Mac. */
export async function unloadMacVision(): Promise<void> {
  if (macVisionMode() === "off" || process.platform !== "darwin") return;
  await fetchWithTimeout(
    `${MAC_VISION_URL}/api/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep_alive: 0 }),
    },
    10_000,
  ).catch(() => undefined);
}
