// The look of a picture or a clip frame (src/render/lookalike.ts): ffmpeg's 9x8 greyscale thumbnail, hashed. A file
// that won't decode gives no hash (it is then its own look).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { dhash } from "../render/lookalike.ts";

const run = promisify(execFile);

/** The difference hash of a picture, or of a video's frame `atSeconds` in. */
export async function lookHash(
  file: string,
  atSeconds?: number,
): Promise<string | undefined> {
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-loglevel",
        "error",
        ...(atSeconds !== undefined ? ["-ss", atSeconds.toFixed(2)] : []),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=9:8:flags=area,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    return dhash(stdout as unknown as Buffer);
  } catch {
    return undefined;
  }
}
