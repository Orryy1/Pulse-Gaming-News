"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const v = require("../../lib/visual-content-prescan");

// 2026-04-30 audit P1 #1/#3: pixel-level prescan that improves on
// the URL/metadata-only thumbnail-safety heuristics. Pin the pure
// scoring functions and the composite verdicts on synthetic
// pixel buffers — no real image files needed for these tests.

// ── isSkinTone ───────────────────────────────────────────────────

test("isSkinTone: classic skin pixels classify as skin", () => {
  // Approximate skin RGB values
  assert.equal(v.isSkinTone(220, 180, 150), true);
  assert.equal(v.isSkinTone(196, 153, 130), true);
  assert.equal(v.isSkinTone(170, 130, 110), true);
});

test("isSkinTone: grey / blue / green pixels classify as non-skin", () => {
  assert.equal(v.isSkinTone(128, 128, 128), false);
  assert.equal(v.isSkinTone(50, 100, 200), false);
  assert.equal(v.isSkinTone(30, 200, 30), false);
});

test("isSkinTone: pure black + pure white classify as non-skin", () => {
  assert.equal(v.isSkinTone(0, 0, 0), false);
  assert.equal(v.isSkinTone(255, 255, 255), false);
});

// ── computeSignalsFromSample ────────────────────────────────────

function buildBuffer(dim, paint) {
  const buf = Buffer.alloc(dim * dim * 3);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const i = (y * dim + x) * 3;
      const [r, g, b] = paint(x, y, dim);
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    }
  }
  return buf;
}

test("computeSignalsFromSample: all-skin centre yields high skin_tone_ratio", () => {
  const dim = 32;
  const buf = buildBuffer(dim, () => [220, 180, 150]);
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.ok(sig.skin_tone_ratio > 0.9);
});

test("computeSignalsFromSample: all-grey image yields ~0 skin_tone_ratio", () => {
  const dim = 32;
  const buf = buildBuffer(dim, () => [128, 128, 128]);
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.equal(sig.skin_tone_ratio < 0.05, true);
});

test("computeSignalsFromSample: bright centre on dark background lifts oval correlation", () => {
  const dim = 32;
  const cx = dim / 2;
  const cy = dim / 2;
  const r = dim * 0.3;
  const buf = buildBuffer(dim, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy < r * r ? [220, 180, 150] : [10, 10, 10];
  });
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.ok(sig.central_luminance_oval > 0.6);
});

test("computeSignalsFromSample: high-frequency noise yields high edge density", () => {
  const dim = 32;
  const buf = buildBuffer(dim, (x, y) => {
    const v = ((x * 17 + y * 31) & 1) === 0 ? 240 : 10;
    return [v, v, v];
  });
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.ok(sig.edge_density > 0.5);
});

test("computeSignalsFromSample: solid-colour image yields zero edges", () => {
  const dim = 32;
  const buf = buildBuffer(dim, () => [100, 200, 80]);
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.equal(sig.edge_density, 0);
});

test("computeSignalsFromSample: saturation_mean approaches 0 on grey, high on saturated", () => {
  const dim = 32;
  const grey = buildBuffer(dim, () => [128, 128, 128]);
  const sat = buildBuffer(dim, () => [255, 0, 0]);
  assert.ok(v.computeSignalsFromSample(grey, dim).saturation_mean < 0.05);
  assert.ok(v.computeSignalsFromSample(sat, dim).saturation_mean > 0.9);
});

test("computeSignalsFromSample: striped horizontal contrast lifts text_overlay_likelihood", () => {
  const dim = 32;
  const buf = buildBuffer(dim, (x, y) =>
    Math.floor(x / 2) % 2 === 0 ? [255, 255, 255] : [0, 0, 0],
  );
  const sig = v.computeSignalsFromSample(buf, dim);
  assert.ok(sig.text_overlay_likelihood > 0.3);
});

// ── computeContentHash ───────────────────────────────────────────

test("computeContentHash: deterministic for the same buffer", async () => {
  const buf = Buffer.from("pulse gaming test buffer", "utf-8");
  const a = await v.computeContentHash(buf);
  const b = await v.computeContentHash(buf);
  assert.equal(a, b);
  assert.equal(a.length, 64); // sha256 hex
});

test("computeContentHash: different buffers → different hashes", async () => {
  const a = await v.computeContentHash(Buffer.from("a"));
  const b = await v.computeContentHash(Buffer.from("b"));
  assert.notEqual(a, b);
});

test("computeContentHash: returns null for invalid input", async () => {
  assert.equal(await v.computeContentHash(null), null);
  assert.equal(await v.computeContentHash(123), null);
});

// ── prescanImage with mocked sharp ───────────────────────────────

function fakeSharp(metadataObj, rawBuffer) {
  const factory = (_path) => {
    return {
      async metadata() {
        return metadataObj;
      },
      resize() {
        return this;
      },
      removeAlpha() {
        return this;
      },
      raw() {
        return this;
      },
      async toBuffer() {
        return rawBuffer;
      },
    };
  };
  return factory;
}

test("prescanImage: missing path returns structured error", async () => {
  const r = await v.prescanImage(null);
  assert.equal(r.error, "no_path");
});

test("prescanImage: bright skin oval composite triggers likely_has_face", async () => {
  const dim = v.SAMPLE_DIM;
  const cx = dim / 2;
  const cy = dim / 2;
  const r = dim * 0.3;
  const buf = Buffer.alloc(dim * dim * 3);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const i = (y * dim + x) * 3;
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy < r * r;
      const [rr, gg, bb] = inside ? [220, 180, 150] : [20, 20, 20];
      buf[i] = rr;
      buf[i + 1] = gg;
      buf[i + 2] = bb;
    }
  }
  // We need a real file path so fs.stat succeeds. Use this test file
  // itself as the stand-in path; the fake sharp ignores the path.
  const fakeFs = require("fs-extra");
  const tmp = require("node:os").tmpdir();
  const tmpPath = require("node:path").join(
    tmp,
    `pulse-prescan-${Date.now()}.bin`,
  );
  await fakeFs.writeFile(tmpPath, "x");

  try {
    const result = await v.prescanImage(tmpPath, {
      sharp: fakeSharp({ width: 800, height: 800 }, buf),
    });
    assert.equal(result.error, null);
    assert.equal(result.likely_has_face, true);
    assert.equal(result.aspect_ratio, 1);
  } finally {
    await fakeFs.remove(tmpPath).catch(() => {});
  }
});

test("prescanImage: stock-person hint flips likely_is_stock_person when face also detected", async () => {
  const dim = v.SAMPLE_DIM;
  const cx = dim / 2;
  const cy = dim / 2;
  const r = dim * 0.3;
  const buf = Buffer.alloc(dim * dim * 3);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const i = (y * dim + x) * 3;
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy < r * r;
      const [rr, gg, bb] = inside ? [220, 180, 150] : [20, 20, 20];
      buf[i] = rr;
      buf[i + 1] = gg;
      buf[i + 2] = bb;
    }
  }
  const fakeFs = require("fs-extra");
  const tmpPath = require("node:path").join(
    require("node:os").tmpdir(),
    `pulse-prescan2-${Date.now()}.bin`,
  );
  await fakeFs.writeFile(tmpPath, "x");
  try {
    const result = await v.prescanImage(tmpPath, {
      sharp: fakeSharp({ width: 800, height: 1200 }, buf),
      sourceTypeHint: "pexels",
    });
    assert.equal(result.likely_has_face, true);
    assert.equal(result.likely_is_stock_person, true);
  } finally {
    await fakeFs.remove(tmpPath).catch(() => {});
  }
});

test("prescanImage: solid-colour image lights nothing", async () => {
  const dim = v.SAMPLE_DIM;
  const buf = Buffer.alloc(dim * dim * 3, 80);
  const fakeFs = require("fs-extra");
  const tmpPath = require("node:path").join(
    require("node:os").tmpdir(),
    `pulse-prescan3-${Date.now()}.bin`,
  );
  await fakeFs.writeFile(tmpPath, "x");
  try {
    const result = await v.prescanImage(tmpPath, {
      sharp: fakeSharp({ width: 100, height: 100 }, buf),
    });
    assert.equal(result.likely_has_face, false);
    assert.equal(result.likely_is_screenshot, false);
    assert.equal(result.edge_density, 0);
  } finally {
    await fakeFs.remove(tmpPath).catch(() => {});
  }
});
