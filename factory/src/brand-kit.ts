// Renders the channel brand stills (banner, avatar, sample thumbnail) into
// factory/brand/ from the same tokens the Shorts use. Run with `npm run brand`.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "render", "index.ts");
const PUBLIC_DIR = path.join(here, "..", "public");
const OUT = path.join(here, "..", "brand");
// Inlined (not imported from Brand.tsx) because that module loads fonts for the browser.
const SAMPLE_THUMB = { headline: "Slips to 2027", kicker: "Delayed", game: "Starfield", imageSrc: null, accent: "#FF3B3B" };

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true });
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: PUBLIC_DIR,
    onProgress: () => undefined,
  });
  const gl =
    (process.env.REMOTION_GL as "angle" | "swangle" | undefined) ?? "swangle";
  const jobs: Array<{
    id: string;
    file: string;
    props?: Record<string, unknown>;
  }> = [
    { id: "PulseBanner", file: "channel-banner-2560x1440.png" },
    { id: "PulseAvatar", file: "avatar-800x800.png" },
    {
      id: "PulseThumb",
      file: "thumbnail-template-1280x720.png",
      props: SAMPLE_THUMB as unknown as Record<string, unknown>,
    },
  ];
  for (const job of jobs) {
    const composition = await selectComposition({
      serveUrl,
      id: job.id,
      inputProps: job.props ?? {},
    });
    const output = path.join(OUT, job.file);
    await renderStill({
      composition,
      serveUrl,
      output,
      inputProps: job.props ?? {},
      imageFormat: "png",
      chromiumOptions: { gl },
    });
    console.log("wrote", output);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
