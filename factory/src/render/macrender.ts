// The Short and the long video's thumbnails as Mac worker jobs (src/macworker.ts): turns the
// render inputs, whose paths are this PC's, into a job the Mac can run from its own copy of the episode.
// Chrome's Skia crash on the Mac only hits long renders about 10 minutes in, so a Short runs with the GPU
// rasteriser on (it takes well under a minute; a crash fails the job and the PC renders it).
import path from "node:path";
import { macRenderJob, type MacSettings } from "../macworker.ts";
import type {
  LongThumbsInput,
  RenderInput,
} from "./render.ts";

/** Browser and machine settings that mean nothing on the other machine (pure). */
function portable<
  T extends { browserExecutable?: string; onProgress?: unknown },
>(input: T): Omit<T, "browserExecutable" | "onProgress"> {
  const { browserExecutable: _b, onProgress: _p, ...rest } = input;
  return rest;
}

/** The Mac's Short job description from a render input (pure). */
export function shortJob(input: RenderInput, concurrency: number) {
  const outName = path.basename(input.outFile);
  const posterName = path.basename(input.posterFile);
  const thumbName = input.thumbFile
    ? path.basename(input.thumbFile)
    : undefined;
  const {
    episodeDir: _e,
    outFile: _o,
    posterFile: _f,
    thumbFile: _t,
    ...rest
  } = portable(input);
  return {
    outName,
    posterName,
    thumbName,
    needGb: 3,
    want: {
      seconds: input.props.durationSeconds,
      width: 1080,
      height: 1920,
    },
    input: { ...rest, concurrency, gl: "angle" as const },
  };
}

export async function macRenderShort(
  m: MacSettings,
  input: RenderInput,
): Promise<void> {
  const job = shortJob(input, m.concurrency);
  await macRenderJob(m, {
    kind: "short",
    episodeDir: input.episodeDir,
    job,
    env: { REMOTION_GPU_RASTER: "true" },
    onProgress: input.onProgress,
    places: {
      [job.outName]: input.outFile,
      [job.posterName]: input.posterFile,
      ...(job.thumbName ? { [job.thumbName]: input.thumbFile! } : {}),
    },
  });
}

/** The pictures a set of thumbnails names, each once, relative to the episode (pure). */
export function thumbFiles(thumbs: LongThumbsInput["thumbs"]): string[] {
  const out = new Set<string>();
  for (const { thumb } of thumbs)
    for (const f of [
      thumb.imageFile,
      thumb.image2File,
      thumb.fgFile,
      ...(thumb.pictureFiles ?? []),
    ])
      if (f) out.add(f.replace(/\\/g, "/"));
  return [...out];
}

export async function macRenderThumbs(
  m: MacSettings,
  input: LongThumbsInput,
): Promise<void> {
  const thumbs = input.thumbs.map((t, i) => ({
    name: `thumb_${i}${path.extname(t.file) || ".jpg"}`,
    thumb: t.thumb,
    file: t.file,
  }));
  await macRenderJob(m, {
    kind: "thumbs",
    episodeDir: input.episodeDir,
    files: thumbFiles(input.thumbs),
    job: {
      needGb: 1,
      gl: "angle",
      thumbs: thumbs.map(({ name, thumb }) => ({ name, thumb })),
    },
    places: Object.fromEntries(thumbs.map((t) => [t.name, t.file])),
  });
}
