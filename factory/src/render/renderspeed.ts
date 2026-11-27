// Render speed and resume settings (14 Nov 2026), every part off by default.
//   RENDER_CHUNKED=true          long videos render in frame-range chunks that survive a failure or a stop
//                                (src/render/chunked.ts): the next attempt resumes at the first missing chunk.
//   RENDER_CHUNKED_SHORTS=true   the same for Shorts.
//   RENDER_CHUNK_SECONDS=60      chunk length in seconds of video (10 to 600).
//   RENDER_KEEP_CHUNKS=true      keep the chunk folder after a successful join (for proofs); removed by default.
//   RENDER_HW_MASTER=true        final masters through Apple's VideoToolbox encoder at RENDER_HW_BITRATE instead
//                                of libx264 CRF (Mac only; ignored elsewhere). Measured in
//                                previews/2026-11-14-renderspeed before it is switched on.
//   RENDER_HW_BITRATE=16M        the hardware encoder's target bitrate.

export interface RenderSpeed {
  chunkedLong: boolean;
  chunkedShorts: boolean;
  chunkSeconds: number;
  keepChunks: boolean;
  hwMaster: boolean;
  hwBitrate: string;
}

const ON_RE = /^(1|true|yes|on)$/i;
const BITRATE_RE = /^\d+(\.\d+)?[kKmM]$/;

/** The settings from the environment (pure). */
export function renderSpeedFrom(
  env: Record<string, string | undefined>,
): RenderSpeed {
  const secs = Number.parseInt(env.RENDER_CHUNK_SECONDS ?? "", 10);
  const bitrate = (env.RENDER_HW_BITRATE ?? "").trim();
  return {
    chunkedLong: ON_RE.test(env.RENDER_CHUNKED ?? ""),
    chunkedShorts: ON_RE.test(env.RENDER_CHUNKED_SHORTS ?? ""),
    chunkSeconds: Number.isFinite(secs)
      ? Math.min(600, Math.max(10, secs))
      : 60,
    keepChunks: ON_RE.test(env.RENDER_KEEP_CHUNKS ?? ""),
    hwMaster: ON_RE.test(env.RENDER_HW_MASTER ?? ""),
    hwBitrate: BITRATE_RE.test(bitrate) ? bitrate : "16M",
  };
}

/** Encoder options for a final master (pure): VideoToolbox at the bitrate on a Mac with RENDER_HW_MASTER, else x264 CRF. */
export function masterEncoder(
  s: Pick<RenderSpeed, "hwMaster" | "hwBitrate">,
  crf: number,
  platform: string = process.platform,
):
  | { crf: number }
  | { hardwareAcceleration: "if-possible"; videoBitrate: string } {
  return s.hwMaster && platform === "darwin"
    ? { hardwareAcceleration: "if-possible", videoBitrate: s.hwBitrate }
    : { crf };
}
