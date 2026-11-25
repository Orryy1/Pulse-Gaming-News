import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  FILL_GEN_PIXELS,
  fillGeometry,
  fillPrompt,
  keptBox,
  marginProblems,
} from "../src/gpuvis/fill.ts";
import { FILL_LABEL } from "../src/gpuvis/label.ts";
import { fillLabelTop } from "../src/render/components/Background.tsx";
import {
  isPixelArt,
  laplacianEnergy,
  pixelArtStats,
  seamScore,
} from "../src/gpuvis/pixels.ts";
import { upscalePlan } from "../src/gpuvis/upscale.ts";
import {
  extendWidth,
  rankScored,
  RUBRIC,
  rubricScore,
} from "../src/gpuvis/thumbs.ts";
import { thumbCandidateStep, thumbOrder } from "../src/gpuvis/thumbstep.ts";
import {
  derivedName,
  framedStills,
  gpuvisUp,
  MAX_PICTURES,
  prepareImages,
  wantsFill,
  type PreparedImage,
  callLimit,
} from "../src/gpuvis/client.ts";
import { stack } from "../src/gpuvis/sheet.ts";
import {
  fillWorkflow,
  plateWorkflow,
  upscaleWorkflow,
  KLEIN,
  permittedModel,
} from "../src/gpuvis/workflows.ts";

test("fillGeometry: a 16:9 still in a Short spans the width at the hero band", () => {
  const g = fillGeometry(1920, 1080, 1080, 1920, "hero")!;
  assert.equal(g.w, 1080);
  assert.equal(g.h, 608);
  assert.equal(g.x, 0);
  assert.equal(g.y, 360);
  assert.equal(g.genW % 16, 0);
  assert.equal(g.genH % 16, 0);
  assert.ok(
    Math.abs(g.genW * g.genH - FILL_GEN_PIXELS) / FILL_GEN_PIXELS < 0.05,
  );
  assert.ok(g.gy > 0 && g.gy + g.gh < g.genH);
});

test("fillGeometry: centred, portrait into wide, sideways placement, and a fit needs nothing", () => {
  const c = fillGeometry(1920, 1080, 1080, 1920, "centre")!;
  assert.equal(c.y, Math.round((1920 - 608) / 2));
  const p = fillGeometry(528, 704, 1920, 1080)!;
  assert.equal(p.h, 1080);
  assert.equal(p.w, 810);
  assert.equal(p.x, 556); // even pixels
  const r = fillGeometry(1920, 1080, 3200, 1080, "right")!;
  assert.equal(r.x, 3200 - 1920);
  const l = fillGeometry(1920, 1080, 3200, 1080, "left")!;
  assert.equal(l.x, 0);
  assert.equal(fillGeometry(1920, 1080, 1920, 1080), undefined);
  assert.equal(fillGeometry(1000, 1000, 1050, 1000), undefined);
});

test("keptBox: insets only the sides that meet a new margin", () => {
  // Wide picture across the full width of a tall canvas: top and bottom meet margins, left and right are edges.
  assert.deepEqual(keptBox({ x: 0, y: 100, w: 400, h: 200 }, 400, 700, 8), {
    x: 0,
    y: 108,
    w: 400,
    h: 184,
  });
  // Explicit sides: frame-edge sides run out to the padded canvas edge.
  assert.deepEqual(
    keptBox({ x: 40, y: 40, w: 100, h: 50 }, 180, 130, 10, {
      left: false,
      right: false,
      top: true,
      bottom: true,
    }),
    {
      x: 0,
      y: 50,
      w: 180,
      h: 30,
    },
  );
});

test("fillPrompt keeps pixel art in its own style and never asks for figures or writing", () => {
  assert.match(fillPrompt("A dungeon room.", true), /pixel-art/);
  assert.match(
    fillPrompt("A street at night", false),
    /no figures, no lettering/,
  );
  assert.equal(FILL_LABEL, "EDGES EXTENDED BY AI");
});

test("marginProblems reads the margin check", () => {
  assert.deepEqual(
    marginProblems({ figures: false, writing: false, broken: false }),
    [],
  );
  assert.deepEqual(
    marginProblems({ figures: true, writing: true, broken: false }),
    ["a figure in the new margins", "writing in the new margins"],
  );
  assert.deepEqual(marginProblems({}), ["the margin check gave no answer"]);
});

function solid(
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number],
): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, bl] = f(x, y);
      const i = (y * w + x) * 3;
      b[i] = r;
      b[i + 1] = g;
      b[i + 2] = bl;
    }
  return b;
}

test("pixel art: big flat blocks with hard edges count; a smooth gradient with noise does not", () => {
  const blocks = solid(64, 64, (x, y) =>
    ((x >> 3) + (y >> 3)) % 2 ? [250, 40, 40] : [20, 20, 90],
  );
  assert.equal(isPixelArt(pixelArtStats(blocks, 64, 64)), true);
  let seed = 7;
  const rnd = () =>
    ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 30;
  const photo = solid(64, 64, (x, y) => [
    Math.min(255, x * 3 + rnd()),
    Math.min(255, y * 3 + rnd()),
    120,
  ]);
  assert.equal(isPixelArt(pixelArtStats(photo, 64, 64)), false);
});

test("seamScore: a pasted box that matches is about 1, a hard border is high", () => {
  const w = 60;
  const h = 60;
  const rect = { x: 0, y: 20, w: 60, h: 20 };
  const smooth = solid(w, h, (_x, y) => [y * 4, y * 4, y * 4]);
  const hard = solid(w, h, (_x, y) =>
    y >= 20 && y < 40 ? [250, 250, 250] : [y, y, y],
  );
  assert.ok(seamScore(smooth, w, h, rect) < 1.5);
  assert.ok(seamScore(hard, w, h, rect) > 5);
});

test("laplacianEnergy is zero on a flat picture and higher on detail", () => {
  assert.equal(
    laplacianEnergy(
      solid(10, 10, () => [100, 100, 100]),
      10,
      10,
    ),
    0,
  );
  assert.ok(
    laplacianEnergy(
      solid(10, 10, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0])),
      10,
      10,
    ) > 100,
  );
});

test("upscalePlan: none when it covers, pixel for pixel art, esrgan when it must grow, old games always", () => {
  assert.equal(
    upscalePlan({
      width: 1920,
      height: 1080,
      frameW: 1920,
      frameH: 1080,
      pixel: false,
    }).method,
    "none",
  );
  assert.deepEqual(
    upscalePlan({
      width: 640,
      height: 480,
      frameW: 1920,
      frameH: 1080,
      pixel: true,
    }),
    { method: "pixel", scale: 3 },
  );
  assert.equal(
    upscalePlan({
      width: 960,
      height: 540,
      frameW: 1920,
      frameH: 1080,
      pixel: false,
    }).method,
    "esrgan",
  );
  assert.equal(
    upscalePlan({
      width: 1700,
      height: 956,
      frameW: 1920,
      frameH: 1080,
      pixel: false,
    }).method,
    "lanczos",
  );
  // An old game takes the network for any growth, but nothing beyond the frame: a 1080p shot needs nothing.
  assert.equal(
    upscalePlan({
      width: 1920,
      height: 1080,
      frameW: 1920,
      frameH: 1080,
      pixel: false,
      year: 2004,
    }).method,
    "none",
  );
  const old = upscalePlan({
    width: 1700,
    height: 956,
    frameW: 1920,
    frameH: 1080,
    pixel: false,
    year: 2004,
  });
  assert.equal(old.method, "esrgan");
  assert.ok(Math.abs(old.scale - 1080 / 956) < 0.001);
});

test("rubricScore weighs the six points to 0-10 and refuses a partial answer", () => {
  assert.equal(
    Math.round(RUBRIC.reduce((s, r) => s + r.weight, 0) * 100) / 100,
    1,
  );
  const all = Object.fromEntries(RUBRIC.map((r) => [r.key, 10]));
  assert.equal(rubricScore(all), 10);
  assert.equal(rubricScore({ ...all, subject: 0 }), 7.8);
  assert.equal(rubricScore({ subject: 5 }), undefined);
});

test("rankScored: rule problems sink, then score, ties keep the factory's order", () => {
  const r = rankScored([
    { file: "a", label: "a", score: 6 },
    { file: "b", label: "b", score: 9, problems: ["words too small"] },
    { file: "c", label: "c", score: 7 },
    { file: "d", label: "d", score: 6 },
    { file: "e", label: "e" },
  ]);
  assert.deepEqual(
    r.map((x) => x.file),
    ["c", "a", "d", "e", "b"],
  );
});

test("extendWidth: a centred subject gets room on the far side, one already at the side gets none", () => {
  const e = extendWidth(1920, 0.5)!;
  assert.equal(e.place, "right");
  // The subject lands at 0.73 of the new width.
  assert.ok(Math.abs((e.outW - 1920 + 0.5 * 1920) / e.outW - 0.73) < 0.002);
  const l = extendWidth(1920, 0.45)!;
  assert.equal(l.place, "left");
  assert.ok(Math.abs((0.45 * 1920) / l.outW - 0.27) < 0.002);
  assert.equal(extendWidth(1920, 0.7), undefined);
  assert.equal(extendWidth(1920, 0.3), undefined);
});

test("thumbOrder: the best passing candidate leads, the next two are the Test & compare variants", () => {
  assert.deepEqual(
    thumbOrder(
      [
        { name: "thumb_gpu_ext.jpg" },
        { name: "x.jpg", problems: ["p"] },
        { name: "thumb.jpg" },
        { name: "thumb_b.jpg" },
        { name: "thumb_c.jpg" },
      ],
      { main: "thumb.jpg", variants: ["thumb_b.jpg", "thumb_c.jpg"] },
    ),
    { main: "thumb_gpu_ext.jpg", variants: ["thumb.jpg", "thumb_b.jpg"] },
  );
  assert.deepEqual(
    thumbOrder([{ name: "a", problems: ["p"] }], {
      main: "thumb.jpg",
      variants: [],
    }),
    {
      main: "thumb.jpg",
      variants: [],
    },
  );
});

test("wantsFill: square to wide pictures in Shorts, tall ones in long videos", () => {
  assert.equal(wantsFill("short", 16 / 9), true);
  assert.equal(wantsFill("short", 1), true);
  assert.equal(wantsFill("short", 4 / 3), true);
  assert.equal(wantsFill("short", 0.75), false);
  assert.equal(wantsFill("long", 0.75), true);
  assert.equal(wantsFill("long", 16 / 9), false);
  assert.equal(wantsFill("short", NaN), false);
});

test("prepareImages: off does nothing, a silent or busy service stops the episode, results are kept and not redone", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpuvis-test-"));
  const fresh = (): PreparedImage[] => [
    { file: "a.jpg", aspect: 16 / 9 },
    { file: "b.jpg", aspect: 0.75 },
    { file: "c.jpg", aspect: 16 / 9 },
  ];
  let asked = 0;
  const off = await prepareImages(
    { fillFrame: false, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    fresh(),
    "short",
    {
      up: async () => (asked++, true),
    },
  );
  assert.deepEqual(off, { filled: 0, upscaled: 0 });
  assert.equal(asked, 0);
  const down = await prepareImages(
    { fillFrame: true, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    fresh(),
    "short",
    {
      up: async () => (asked++, false),
      fill: async () => {
        throw new Error("must not be called");
      },
    },
  );
  assert.equal(down.skipped, "service down");
  assert.equal(asked, 1);
  // Busy on the first picture: the rest are not sent.
  let sent = 0;
  const busy = await prepareImages(
    { fillFrame: true, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    fresh(),
    "short",
    {
      up: async () => true,
      fill: async () => (sent++, "busy" as const),
    },
  );
  assert.equal(busy.skipped, "service busy");
  assert.equal(sent, 1);
  const calls: string[] = [];
  const images = fresh();
  const write = async (d: string) => fs.writeFile(d, "x");
  const on = await prepareImages(
    { fillFrame: true, upscaleStills: true, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    {
      up: async () => true,
      upscale: async (_u, src, d) => {
        calls.push(`up:${path.basename(src)}`);
        if (path.basename(src) === "c.jpg") return "none";
        await write(d);
        return "ok";
      },
      fill: async (_u, src, d, o) => {
        calls.push(`fill:${path.basename(src)}:${o.outW}x${o.outH}:${o.place}`);
        await write(d);
        return "ok";
      },
    },
  );
  assert.deepEqual(on, { filled: 2, upscaled: 2 });
  // Fill candidates first; each fill made from the enlarged copy; "nothing needed" remembered as the file itself.
  assert.deepEqual(calls, [
    "up:a.jpg",
    "fill:a_jpg.up.png:1080x1920:hero",
    "up:c.jpg",
    "fill:c.jpg:1080x1920:hero",
    "up:b.jpg",
  ]);
  assert.equal(images[0]!.fillFile, "a_jpg.fill.jpg");
  assert.equal(images[2]!.upFile, "c.jpg");
  const again = await prepareImages(
    { fillFrame: true, upscaleStills: true, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    {
      up: async () => {
        throw new Error("nothing left to do, so no call");
      },
    },
  );
  assert.deepEqual(again, { filled: 0, upscaled: 0 });
  // A copy gone from disk is made again.
  await fs.rm(path.join(dir, "a_jpg.fill.jpg"));
  let refilled = 0;
  await prepareImages(
    { fillFrame: true, upscaleStills: true, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    {
      up: async () => true,
      fill: async (_u, _s, d) => (refilled++, await write(d), "ok" as const),
    },
  );
  assert.equal(refilled, 1);
  assert.equal(
    derivedName("entry_1/assets/x.png", "fill"),
    "entry_1/assets/x_png.fill.jpg",
  );
  assert.ok(MAX_PICTURES >= 20);
  await fs.rm(dir, { recursive: true, force: true });
});

test("stack converts every input to RGB before stacking (the 6.1.1 crash)", () => {
  assert.equal(stack(1, "h"), "[0]format=rgb24");
  assert.equal(
    stack(2, "v", "scale=10:10"),
    "[0]scale=10:10,format=rgb24[s0];[1]scale=10:10,format=rgb24[s1];[s0][s1]vstack=2",
  );
});

test("workflows: klein everywhere, Real-ESRGAN for upscaling, and never a FLUX.1 dev model", () => {
  const fill = fillWorkflow({
    canvas: "c.png",
    mask: "m.png",
    prompt: "p",
    seed: 1,
    width: 784,
    height: 1392,
  });
  const plate = plateWorkflow({
    prompt: "p",
    seed: 1,
    width: 1344,
    height: 768,
  });
  const up = upscaleWorkflow({ image: "i.png", width: 1920, height: 1080 });
  const all = JSON.stringify([fill, plate, up]);
  assert.ok(!/flux1-(dev|fill)/i.test(all));
  assert.equal(fill.unet!.inputs.unet_name, KLEIN.unet);
  assert.match(String(KLEIN.unet), /klein/);
  assert.equal(fill.mask!.inputs.channel, "red");
  assert.match(String(up.model!.inputs.model_name), /esrgan/i);
});

test("framedStills: only stills the plan shows in the framed panel, never clips or full-bleed stills", () => {
  const plan = {
    shots: [
      { framed: true, media: { type: "image", index: 2 } },
      { framed: false, media: { type: "image", index: 0 } },
      { framed: true, media: { type: "clip", index: 1 } },
      { framed: true, media: { type: "image", index: 2 } },
      { framed: true, media: { type: "plate", index: 0 } },
    ],
  };
  assert.deepEqual([...framedStills(plan)], [2]);
});

test("prepareImages: fillOnly limits the fills to the framed stills; the game's year reaches the upscaler", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpuvis-test-"));
  const images: PreparedImage[] = [
    { file: "a.jpg", aspect: 16 / 9 },
    { file: "b.jpg", aspect: 1 },
    { file: "c.jpg", aspect: 16 / 9, year: 2015 },
  ];
  const filled: string[] = [];
  const years: Array<number | undefined> = [];
  await prepareImages(
    { fillFrame: true, upscaleStills: true, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    {
      up: async () => true,
      fill: async (_u, src, d) => (
        filled.push(path.basename(src)),
        await fs.writeFile(d, "x"),
        "ok" as const
      ),
      upscale: async (_u, _s, _d, o) => (years.push(o.year), "none" as const),
    },
    { fillOnly: new Set([1]), year: 2004 },
  );
  assert.deepEqual(filled, ["b.jpg"]);
  assert.equal(images[0]!.fillFile, undefined);
  assert.ok(images[1]!.fillFile);
  assert.deepEqual(years, [2004, 2004, 2015]);
  await fs.rm(dir, { recursive: true, force: true });
});

/** A local port with nothing listening on it (the Mac today: the PC's port 8799 is not relayed). */
async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

test("where nothing answers (the Mac), every feature skips at once and changes nothing", async () => {
  const url = `http://127.0.0.1:${await closedPort()}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpuvis-test-"));
  const t0 = Date.now();
  assert.equal(await gpuvisUp(url), false);
  const images: PreparedImage[] = [
    { file: "a.jpg", aspect: 16 / 9 },
    { file: "b.jpg", aspect: 0.7 },
  ];
  const before = JSON.stringify(images);
  const r = await prepareImages(
    { fillFrame: true, upscaleStills: true, gpuvisUrl: url },
    dir,
    images,
    "short",
  );
  assert.equal(r.skipped, "service down");
  assert.equal(JSON.stringify(images), before);
  let rendered = 0;
  const t = await thumbCandidateStep(
    dir,
    { layout: "poster", imageFile: "art.jpg" },
    ["thumb.jpg"],
    {
      url,
      ask: async () => {
        throw new Error("must not be asked");
      },
      render: async () => {
        rendered++;
      },
      check: async () => [],
    },
  );
  assert.equal(t, undefined);
  assert.equal(rendered, 0);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.ok(Date.now() - t0 < 3000, `gave up in ${Date.now() - t0} ms`);
  await fs.rm(dir, { recursive: true, force: true });
});

test("permittedModel: a setting naming a non-commercial model falls back to klein 4B", () => {
  const d = "flux-2-klein-4b.safetensors";
  assert.equal(permittedModel(undefined, d), d);
  assert.equal(permittedModel("flux1-dev.safetensors", d), d);
  assert.equal(permittedModel("flux1-fill-dev.safetensors", d), d);
  assert.equal(permittedModel("flux-2-klein-9b.safetensors", d), d);
  assert.equal(permittedModel("flux2-dev.safetensors", d), d);
  assert.equal(
    permittedModel("flux-2-klein-4b-fp8.safetensors", d),
    "flux-2-klein-4b-fp8.safetensors",
  );
});

test("prepareImages: a refused fill is not asked again; a step past its time stops", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpuvis-test-"));
  const images: PreparedImage[] = [{ file: "a.jpg", aspect: 16 / 9 }];
  let asked = 0;
  const deps = {
    up: async () => true,
    fill: async () => (asked++, "rejected" as const),
  };
  await prepareImages(
    { fillFrame: true, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    deps,
  );
  await prepareImages(
    { fillFrame: true, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    images,
    "short",
    deps,
  );
  assert.equal(asked, 1);
  assert.equal(images[0]!.fillRejected, true);
  const late = await prepareImages(
    { fillFrame: true, upscaleStills: false, gpuvisUrl: "x" },
    dir,
    [{ file: "b.jpg", aspect: 16 / 9 }],
    "short",
    deps,
    { until: Date.now() - 1 },
  );
  assert.equal(late.skipped, "time limit");
  assert.equal(asked, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("thumbOrder: a variant from the same art as a chosen one waits until no different design is left", () => {
  const ranked = [
    { name: "thumb_gpu_ext.jpg", family: "art.jpg" },
    { name: "thumb.jpg", family: "art.jpg" },
    { name: "thumb_b.jpg", family: "thumb_b.jpg" },
    { name: "thumb_gpu_relit.jpg", family: "art.jpg" },
  ];
  const fb = { main: "thumb.jpg", variants: [] };
  assert.deepEqual(thumbOrder(ranked, fb), {
    main: "thumb_gpu_ext.jpg",
    variants: ["thumb_b.jpg", "thumb.jpg"],
  });
});

test("fillLabelTop: the Short's AI label sits just under the original, never below the credit line", () => {
  assert.equal(fillLabelTop(16 / 9), 360 + 608 + 22);
  assert.equal(fillLabelTop(4 / 3), 360 + 810 + 22);
  assert.equal(fillLabelTop(1), 1462);
  assert.equal(fillLabelTop(0.9), 1560);
});

test("callLimit: a call gets what is left before the deadline, nothing once it has passed", () => {
  const now = 1_000_000;
  assert.equal(callLimit(now - 1, now), 0);
  assert.equal(callLimit(now + 30_000, now), 30_000);
  assert.equal(callLimit(now + 10, now), 1000);
  assert.ok(callLimit(undefined, now) >= 5 * 60_000);
  assert.ok(callLimit(now + 99 * 60_000, now) < 99 * 60_000);
});
