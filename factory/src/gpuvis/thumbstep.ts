// THUMB_CANDIDATES in the long-video release: after the usual designs are rendered and checked, the main poster's art
// gets GPU treatments (extended sideways for room, relit on the words' side; thumbs.ts) through the PC's GPU picture
// service, each drawn as the same poster; then every candidate that passed the checks, old and new, is scored by the
// local vision model on the rubric (thumbs.ts RUBRIC), and the top three become thumb.jpg and the Test & compare
// variants. The factory's own first design keeps its place unless a candidate beats it on the rubric.

import fs from "node:fs/promises";
import path from "node:path";
import { log } from "../lib/util.ts";
import { remoteFill, remotePlate, gpuvisUp } from "./client.ts";
import { probeSize } from "./pixels.ts";
import {
  extendWidth,
  rankScored,
  relight,
  rankByGrid,
  type Scored,
} from "./thumbs.ts";
import type { Ask } from "./vision.ts";

export interface PosterThumb {
  layout?: string;
  headline?: string;
  imageFile?: string | null;
  imageAspect?: number;
  subjectX?: number;
  subjectY?: number;
  [k: string]: unknown;
}

export interface ThumbOrder {
  /** The file that should become thumb.jpg (may already be thumb.jpg). */
  main: string;
  /** The Test & compare variants, in order. */
  variants: string[];
}

/** The release's thumbnail order from the ranked candidates (pure): the best first, then the next two. */
export function thumbOrder(
  ranked: Array<{ name: string; problems?: string[]; family?: string }>,
  fallback: ThumbOrder,
): ThumbOrder {
  const ok = ranked.filter((r) => !r.problems?.length);
  if (!ok.length) return fallback;
  // Test & compare learns most from different pictures: a variant drawn from the same art as one already chosen
  // (the poster and its extended or relit copy look almost alike) waits until no different design is left.
  const picked = [ok[0]!];
  const seen = new Set([ok[0]!.family ?? ok[0]!.name]);
  for (const r of ok.slice(1))
    if (picked.length < 3 && !seen.has(r.family ?? r.name)) {
      picked.push(r);
      seen.add(r.family ?? r.name);
    }
  for (const r of ok.slice(1))
    if (picked.length < 3 && !picked.includes(r)) picked.push(r);
  return {
    main: picked[0]!.name,
    variants: picked.slice(1).map((r) => r.name),
  };
}

export interface ThumbStepDeps {
  url: string;
  ask: Ask;
  /** The light plate's seed (the episode's own, so every video's relit candidate has its own light). */
  seed?: number;
  /** Draws a poster thumbnail with the factory's renderer (renderLongThumbs). */
  render: (file: string, thumb: PosterThumb) => Promise<void>;
  /** The factory's own rule on a drawn poster (designProblems + posterProblems). */
  check: (file: string, thumb: PosterThumb) => Promise<string[]>;
}

/**
 * Runs the step in an episode's folder. existing: the rendered designs that passed the release's checks, the main one
 * first (thumb.jpg). Returns the new order, or undefined when nothing changed (switch off upstream, no poster, the
 * service down or every new candidate failed). Moves files so thumb.jpg is the winner; the old thumb.jpg is kept as
 * thumb_prev.jpg when it is not in the top three.
 */
export async function thumbCandidateStep(
  dir: string,
  main: PosterThumb,
  existing: string[],
  deps: ThumbStepDeps,
): Promise<
  (ThumbOrder & { scores: Record<string, number | undefined> }) | undefined
> {
  if (main.layout !== "poster" || !main.imageFile) return undefined;
  if (!(await gpuvisUp(deps.url))) return undefined;
  const art = main.imageFile;
  const sx = main.subjectX ?? 0.65;
  const stem = art.replace(/\.[a-z0-9]+$/i, "");
  const made: Array<{ name: string; thumb: PosterThumb }> = [];
  const size = await probeSize(path.join(dir, art));
  // Extended: the art continued sideways so the subject lands where the poster wants it without zooming in.
  let relitArt = art;
  let relitX = sx;
  const ext = extendWidth(size.width, sx);
  if (ext) {
    const file = `${stem}.thumbext.jpg`;
    const scale = 1080 / size.height;
    if (
      (await remoteFill(deps.url, path.join(dir, art), path.join(dir, file), {
        outW: Math.round(ext.outW * scale),
        outH: 1080,
        place: ext.place,
      }).catch(() => "busy")) === "ok"
    ) {
      const w = (await probeSize(path.join(dir, file))).width;
      const origW = Math.round(size.width * scale);
      const x0 = ext.place === "right" ? w - origW : 0;
      relitX = (x0 + sx * origW) / w;
      relitArt = file;
      made.push({
        name: "thumb_gpu_ext.jpg",
        thumb: {
          ...main,
          imageFile: file,
          imageAspect: w / 1080,
          subjectX: relitX,
        },
      });
    }
  }
  // Relit: a light plate (atmosphere only) screened over the words' side of the art (or of the extended art).
  const plate = path.join(dir, `${stem}.plate.png`);
  const seed = deps.seed ?? 1100;
  if (
    (await remotePlate(deps.url, plate, seed, seed % 2).catch(() => "busy")) ===
    "ok"
  ) {
    const file = `${stem}.thumbrelit.jpg`;
    await relight(
      path.join(dir, relitArt),
      plate,
      path.join(dir, file),
      relitX,
    );
    const s2 = await probeSize(path.join(dir, file));
    made.push({
      name: "thumb_gpu_relit.jpg",
      thumb: {
        ...main,
        imageFile: file,
        imageAspect: s2.width / s2.height,
        subjectX: relitX,
      },
    });
  }
  // The art the candidates were drawn from is not needed once they are drawn (or failed); unchosen candidates go too.
  const scratch = [
    plate,
    ...made.map((m) => path.join(dir, String(m.thumb.imageFile))),
  ].filter((f) => f !== path.join(dir, art));
  const tidy = async (keep: string[]) => {
    for (const f of scratch) await fs.rm(f, { force: true });
    for (const m of made)
      if (!keep.includes(m.name))
        await fs.rm(path.join(dir, m.name), { force: true });
  };
  if (!made.length) {
    await tidy([]);
    return undefined;
  }
  // The main design and the GPU candidates share one art (their family); every other design is its own.
  const cands: Array<Scored & { name: string; family: string }> = existing.map(
    (name, k) => ({
      name,
      file: path.join(dir, name),
      label: name,
      family: k === 0 ? art : name,
    }),
  );
  for (const m of made) {
    const file = path.join(dir, m.name);
    try {
      await deps.render(file, m.thumb);
      cands.push({
        name: m.name,
        file,
        label: m.name,
        family: art,
        problems: await deps.check(file, m.thumb),
      });
    } catch (err) {
      log("warn", "a GPU thumbnail candidate did not render", {
        name: m.name,
        error: String(err),
      });
    }
  }
  // Only a new candidate that passed every check may change the order: with none, the factory's own order stands
  // (the ranking is not run just to reshuffle the designs that were already chosen).
  if (
    !cands.some(
      (c) => made.some((m) => m.name === c.name) && !c.problems?.length,
    )
  ) {
    await tidy([]);
    return undefined;
  }
  await rankByGrid(cands, deps.ask, path.join(dir, "qa", "thumbrank"), 3);
  // A failed score on the factory's own design must not demote it: no score for it, no change.
  if (cands[0]?.score === undefined) {
    await tidy([]);
    return undefined;
  }
  const ranked = rankScored(cands);
  const order = thumbOrder(ranked, {
    main: existing[0]!,
    variants: existing.slice(1, 3),
  });
  const scores = Object.fromEntries(cands.map((c) => [c.name, c.score]));
  await tidy([order.main, ...order.variants]);
  if (
    order.main === existing[0] &&
    order.variants.join() === existing.slice(1, 3).join()
  )
    return { ...order, scores };
  // Make the winner thumb.jpg, keeping the old main design under its own name if it is still in the order.
  if (order.main !== "thumb.jpg") {
    await fs.copyFile(
      path.join(dir, "thumb.jpg"),
      path.join(dir, "thumb_prev.jpg"),
    );
    await fs.copyFile(path.join(dir, order.main), path.join(dir, "thumb.jpg"));
    order.variants = order.variants.map((v) =>
      v === "thumb.jpg" ? "thumb_prev.jpg" : v,
    );
    order.main = "thumb.jpg";
  }
  return { ...order, scores };
}
