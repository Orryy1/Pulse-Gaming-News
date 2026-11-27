// The depth camera stays sharp and its cut edges smooth (owner, 26 Nov 2026: "stills look pixely / jaggy with a
// blurry pass going across them at times"). The rack focus swept a mip-level blur across the frame; the depth maps
// were saved at 1,024 px by nearest neighbour and sampled by nearest neighbour, so the subject's cut stepped.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { depthCamPlan, shotLens } from "../src/render/depthcam.ts";
import { depthProofTimeline } from "../src/render/DepthProof.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, "..", p), "utf8");

test("depth camera: no blur and no leak at any moment of any shot unless the cinema lens is asked for", () => {
  for (let i = 0; i < 12; i++) {
    const plan = depthCamPlan(i, 90, 40);
    for (let k = 0; k <= 20; k++) {
      const l = shotLens(plan, k / 20, 0.7);
      assert.equal(l.strength, 0, `shot ${i} at ${k / 20}`);
      assert.equal(l.leak, 0);
      assert.equal(l.focus, 0.7);
    }
  }
  // Asked for, the old lens still works: the rack lands on the subject and a leak shot glows round the word.
  const rack = shotLens(depthCamPlan(0, 100, 50), 0.55, 0.7, true);
  assert.ok(Math.abs(rack.focus - 0.7) < 1e-9 && rack.strength > 0.9);
  assert.ok(shotLens(depthCamPlan(1, 100, 50), 0.5, 0.7, true).leak > 0.9);
});

test("depth surfaces: the depth map is sampled bilinearly and the tear is feathered with alpha to coverage", () => {
  for (const file of [
    "src/render/components/DepthCam.tsx",
    "src/render/components/DepthOrbit.tsx",
  ]) {
    const src = read(file);
    // The old one-texel hard cut only when the canvas has no multisampling (alpha to coverage would do nothing).
    assert.match(src, /if \(uHard > 0\.5\) \{\s*if \(gap > uTear\) discard;/, `${file}: hard cut only as fallback`);
    assert.match(src, /gl\.getParameter\(gl\.SAMPLES\) > 0 \? 0 : 1/, `${file}: fallback follows the canvas`);
    assert.match(
      src,
      /smoothstep\(uTear \* 0\.5, uTear, gap\)/,
      `${file}: feathered tear`,
    );
    assert.match(src, /SAMPLE_ALPHA_TO_COVERAGE/, `${file}: alpha to coverage`);
    assert.match(
      src,
      /colorMask\(true, true, true, false\)/,
      `${file}: canvas alpha kept opaque`,
    );
    assert.match(
      src,
      /const CELLS_X = 480;/,
      `${file}: grid fine enough for a Short's crop`,
    );
  }
  assert.match(
    read("src/render/components/DepthCam.tsx"),
    /depth: texture\(gl, dm!, "linear"\)/,
  );
  assert.match(
    read("src/render/components/DepthOrbit.tsx"),
    /depth: texture\(gl, dm!, true\)/,
  );
});

test("3D photo maps: the depth map is saved at the picture's working size, never shrunk by nearest neighbour", () => {
  const py = read("src/render/parallax.py");
  assert.ok(!/MESH_W/.test(py), "no separate, smaller depth-map width");
  const saves = py
    .split("\n")
    .filter((l) => /depth\.png"\)|fardepth\.png"\)/.test(l));
  assert.equal(saves.length, 2);
  for (const l of saves) assert.ok(!l.includes("resize"), l);
});

test("depth proof reel: each shot keeps its own length, one after another", () => {
  const t = depthProofTimeline(
    [
      { src: "a", aspect: 1.7, frames: 92 },
      { src: "b", aspect: 1.7 },
      { src: "c", aspect: 1.7, frames: 70 },
    ],
    3,
    30,
  );
  assert.deepEqual(t, [
    { from: 0, len: 92 },
    { from: 92, len: 90 },
    { from: 182, len: 70 },
  ]);
});
