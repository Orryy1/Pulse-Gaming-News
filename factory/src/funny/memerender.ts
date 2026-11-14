// Draws a meme (src/funny/meme.ts) as one PNG through the PulseMeme still (src/render/Meme.tsx). The frames are
// served from their own folder, as every other still's pictures are.

import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import { getBundle, serveDir, webPath } from "../render/render.ts";
import type { MemePick } from "./meme.ts";
import type { MemeProps } from "../render/Meme.tsx";

export async function renderMeme(input: {
  /** The folder the frames are in (served for the render). */
  dir: string;
  meme: MemePick;
  outFile: string;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
}): Promise<void> {
  const serveUrl = await getBundle();
  const files = await serveDir(input.dir);
  const browserExecutable = input.browserExecutable || undefined;
  try {
    const inputProps: MemeProps = {
      layout: input.meme.layout,
      lines: input.meme.lines,
      frames: input.meme.frames.map(
        (f) => `${files.url}/${webPath(path.relative(input.dir, f))}`,
      ),
      accent: "#FF6B1A",
    };
    const still = await selectComposition({
      serveUrl,
      id: "PulseMeme",
      inputProps,
      browserExecutable,
    });
    await renderStill({
      composition: still,
      serveUrl,
      output: input.outFile,
      inputProps,
      imageFormat: "png",
      browserExecutable,
      chromiumOptions: { gl: input.gl ?? "swangle" },
    });
  } finally {
    await files.close();
  }
}
