import { test } from "node:test";
import assert from "node:assert/strict";
import { SHORT_DEPTH_LAYERS, edgesCovered, shortDepthTransform } from "../src/render/shortdepth.ts";
import { SHORT_DEPTH_MAX, shortDepthArm, shortDepthWanted } from "../src/render/parallax.ts";
import fs from "node:fs";
import { moveTransform, type MovePreset } from "../src/render/motion.ts";
import { loadConfig } from "../src/config.ts";

const img = (
  file: string,
  kind: string,
  aspect: number,
  extra: object = {},
) => ({ file, kind, aspect, ...extra });

test("only wide, full-bleed stills without layers are layered, in order", () => {
  const got = shortDepthWanted([
    img("a.jpg", "hero", 16 / 9),
    img("box.jpg", "boxart", 0.75),
    img("tall.jpg", "screenshot", 1.0),
    img("done.jpg", "screenshot", 16 / 9, {
      layers: { bg: "x", mid: "y", fg: "z" },
    }),
    img("pad.jpg", "article", 1.5, { noDepth: true }),
    img("b.jpg", "screenshot", 16 / 9),
  ]);
  assert.deepEqual(
    got.map((i) => i.file),
    ["a.jpg", "b.jpg"],
  );
});

test("a Short layers at most SHORT_DEPTH_MAX stills", () => {
  const many = Array.from({ length: 20 }, (_, n) =>
    img(`s${n}.jpg`, "screenshot", 16 / 9),
  );
  assert.equal(shortDepthWanted(many).length, SHORT_DEPTH_MAX);
  assert.equal(shortDepthWanted(many, 0).length, 0);
});

test("nearer layers travel further, and the back layer only follows the still's own move", () => {
  const base = { scale: 1.04, x: 0, y: 0 };
  const at = (k: number) => shortDepthTransform(k, 1, 1, base);
  assert.equal(at(0).x, 0);
  assert.ok(at(0.6).x > 0 && at(1.4).x > at(0.6).x);
  // The truck runs the other way for the other direction.
  assert.ok(shortDepthTransform(1.4, 1, -1, base).x < 0);
  // Centred halfway through the shot.
  assert.equal(shortDepthTransform(1.4, 0.5, 1, base).x, 0);
});

test("no layer ever shows its edge, on every ambient move, the whole length of the shot", () => {
  const presets: MovePreset[] = [
    "pushIn",
    "pullBack",
    "pushPan",
    "driftDown",
    "settle",
    "twoStage",
  ];
  for (const preset of presets)
    for (let f = 0; f <= 100; f++) {
      const p = f / 100;
      const m = moveTransform(preset, p);
      for (const { k } of SHORT_DEPTH_LAYERS)
        for (const dir of [1, -1] as const) {
          const t = shortDepthTransform(k, p, dir, m, 1080);
          assert.ok(
            edgesCovered(1080, t),
            `${preset} p=${p} k=${k} dir=${dir}: ${JSON.stringify(t)}`,
          );
          assert.ok(t.scale >= m.scale, "never smaller than the flat still");
        }
    }
});

test("the motion is gentle: under 30 px of relative travel and under 15% zoom", () => {
  const base = moveTransform("pushPan", 0);
  const a = shortDepthTransform(1.4, 0, 1, base);
  const b = shortDepthTransform(1.4, 1, 1, base);
  const back = shortDepthTransform(0, 1, 1, base);
  assert.ok(
    Math.abs(b.x - back.x) - Math.abs(base.x - moveTransform("pushPan", 1).x) <=
      30,
  );
  assert.ok(a.scale < 1.15 && b.scale < 1.15);
});

test("SHORT_PARALLAX_SHARE is off unless set, and clamped", () => {
  const prev = process.env.SHORT_PARALLAX_SHARE;
  delete process.env.SHORT_PARALLAX_SHARE;
  assert.equal(loadConfig().shortParallaxShare, 0);
  process.env.SHORT_PARALLAX_SHARE = "0.5";
  assert.equal(loadConfig().shortParallaxShare, 0.5);
  process.env.SHORT_PARALLAX_SHARE = "7";
  assert.equal(loadConfig().shortParallaxShare, 1);
  if (prev === undefined) delete process.env.SHORT_PARALLAX_SHARE;
  else process.env.SHORT_PARALLAX_SHARE = prev;
});

test("the test arm is stable per episode and splits about evenly at 0.5", () => {
  assert.equal(shortDepthArm("ep_x", 0), "flat");
  assert.equal(shortDepthArm("ep_x", 1), "depth");
  assert.equal(shortDepthArm("ep_20261114_f0622fa4", 0.5), shortDepthArm("ep_20261114_f0622fa4", 0.5));
  let depth = 0;
  for (let n = 0; n < 1000; n++) if (shortDepthArm(`ep_20261115_${n.toString(16).padStart(8, "0")}`, 0.5) === "depth") depth++;
  assert.ok(depth > 440 && depth < 560, `${depth} of 1000`);
});

test("the drawing half never imports node modules (it runs in the Remotion browser bundle)", () => {
  const src = fs.readFileSync(new URL("../src/render/shortdepth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from "node:|parallax.ts"/);
});
