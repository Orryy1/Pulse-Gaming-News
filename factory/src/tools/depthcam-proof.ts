// A real render of a Short's depth-camera shots (PARALLAX_DEEP; components/DepthCam.tsx), for before-and-after proofs
// of the depth camera: the same stills, 3D photo maps, shot lengths and shot places as the published Short, drawn by
// the factory's own composition (PulseDepthProof), so a change is judged on the factory's pixels. Run it through the
// orchestrator (it uses the GPU):
//   C:\Claude\orchestrator\orch.cmd run --class heavy --project pulse --job "depthcam proof" --priority 20 --est 10 --
//     node --import tsx src/tools/depthcam-proof.ts <spec.json> <out.mp4>
// spec.json: { "dir": episode folder, "width": 1080, "height": 1920, "items": [{ "src", "aspect", "focusX",
//   "mesh": { "depth", "far", "farDepth", "pivot" }, "index", "frames" }] } with paths relative to the folder.

import fs from "node:fs/promises";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getBundle, serveDir } from "../render/render.ts";
import type { DepthProofItem, DepthProofProps } from "../render/DepthProof.tsx";

interface Spec {
  dir: string;
  width?: number;
  height?: number;
  gl?: "angle" | "swangle";
  items: DepthProofItem[];
}

async function main(): Promise<void> {
  const [specFile, out] = process.argv.slice(2);
  if (!specFile || !out)
    throw new Error("usage: depthcam-proof.ts <spec.json> <out.mp4>");
  const spec = JSON.parse(await fs.readFile(specFile, "utf8")) as Spec;
  const files = await serveDir(spec.dir);
  try {
    const url = (p: string) => `${files.url}/${p.replace(/^\/+/, "")}`;
    const props: DepthProofProps = {
      width: spec.width ?? 1080,
      height: spec.height ?? 1920,
      seconds: 3,
      mode: "deep",
      items: spec.items.map((it) => ({
        ...it,
        src: url(it.src),
        ...(it.mesh
          ? {
              mesh: {
                ...it.mesh,
                depth: url(it.mesh.depth),
                far: url(it.mesh.far),
                farDepth: url(it.mesh.farDepth),
              },
            }
          : {}),
      })),
    };
    const serveUrl = await getBundle();
    const composition = await selectComposition({
      serveUrl,
      id: "PulseDepthProof",
      inputProps: props,
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 12,
      outputLocation: out,
      inputProps: props,
      muted: true,
      chromiumOptions: { gl: spec.gl ?? "angle" },
    });
    console.log(`wrote ${out} (${composition.durationInFrames} frames)`);
  } finally {
    await files.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
