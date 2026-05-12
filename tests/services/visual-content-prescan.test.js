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

test("computeSignalsFromSample: white CTA text on black raises promo-card likelihood", () => {
  const dim = 64;
  const buf = buildBuffer(dim, (x, y) => {
    const inTitleStripe = y >= 18 && y <= 24 && x >= 8 && x <= 56 && x % 4 < 2;
    const inCtaStripe = y >= 42 && y <= 47 && x >= 18 && x <= 46 && x % 3 < 2;
    return inTitleStripe || inCtaStripe ? [245, 245, 245] : [5, 5, 5];
  });
  const sig = v.computeSignalsFromSample(buf, dim);

  assert.ok(sig.dark_pixel_ratio > 0.75);
  assert.ok(sig.bright_pixel_ratio > 0.05);
  assert.ok(sig.white_text_on_dark_likelihood > 0.5);
});

test("computeSignalsFromSample: letterboxed cinematic frame is not treated as white-text card", () => {
  const dim = 96;
  const buf = buildBuffer(dim, (x, y) => {
    if (y < 14 || y >= dim - 14) return [0, 0, 0];
    const warmSky = x < dim * 0.58;
    if (warmSky) return [220 - Math.floor(x * 0.8), 142 - Math.floor(x * 0.35), 54];
    return [82, 42, 28];
  });

  const sig = v.computeSignalsFromSample(buf, dim);

  assert.ok(sig.letterbox_bar_ratio >= 0.2);
  assert.ok(sig.central_dark_pixel_ratio < sig.dark_pixel_ratio);
  assert.ok(sig.white_text_on_dark_likelihood < 0.35);
});

test("classifyTrailerFrameTaste: rejects white-on-dark title and rating slates", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0.08,
    white_text_on_dark_likelihood: 0.82,
    edge_density: 0.16,
    saturation_mean: 0.28,
    bright_pixel_ratio: 0.07,
    dark_pixel_ratio: 0.72,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "white_text_on_dark_card");
});

test("classifyTrailerFrameTaste: rejects OCR-detected PEGI and ESRB rating cards", () => {
  for (const detected_text of [
    "PEGI 18 www.pegi.info",
    "ESRB Mature 17+ Blood and Gore",
  ]) {
    const taste = v.classifyTrailerFrameTaste({
      detected_text,
      text_overlay_likelihood: 0.08,
      white_text_on_dark_likelihood: 0.2,
      edge_density: 0.2,
      saturation_mean: 0.4,
      bright_pixel_ratio: 0.08,
      dark_pixel_ratio: 0.45,
    });

    assert.equal(taste.verdict, "fail");
    assert.equal(taste.reason, "rating_board_text_frame");
  }
});

test("classifyTrailerFrameTaste: accepts letterboxed colourful official gameplay frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0,
    white_text_on_dark_likelihood: 0.72,
    edge_density: 0.08,
    saturation_mean: 0.65,
    bright_pixel_ratio: 0.08,
    dark_pixel_ratio: 0.54,
    letterbox_bar_ratio: 0.26,
    central_dark_pixel_ratio: 0.18,
    central_bright_pixel_ratio: 0.12,
  });

  assert.notEqual(taste.verdict, "fail");
  assert.equal(taste.reason, "taste_passed");
  assert.ok(taste.tags.includes("letterboxed_cinematic_candidate"));
});

test("classifyTrailerFrameTaste: rejects dead dark low-detail frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0.02,
    edge_density: 0.04,
    saturation_mean: 0.12,
    bright_pixel_ratio: 0.01,
    dark_pixel_ratio: 0.91,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "dead_dark_frame");
});

test("classifyTrailerFrameTaste: rejects washed low-detail flash frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0.06,
    edge_density: 0.05,
    saturation_mean: 0.16,
    bright_pixel_ratio: 0.66,
    dark_pixel_ratio: 0.02,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "washed_low_detail_frame");
});

test("classifyTrailerFrameTaste: rejects pale monochrome transition frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0,
    edge_density: 0.16,
    saturation_mean: 0.08,
    bright_pixel_ratio: 0.25,
    dark_pixel_ratio: 0,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "washed_low_detail_frame");
});

test("classifyTrailerFrameTaste: rejects ultra-dark low-detail game frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0,
    edge_density: 0.02,
    saturation_mean: 0.52,
    bright_pixel_ratio: 0,
    dark_pixel_ratio: 0.82,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "dead_dark_frame");
});

test("classifyTrailerFrameTaste: rejects muddy dark low-colour trailer frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0.04,
    white_text_on_dark_likelihood: 0,
    edge_density: 0.125,
    saturation_mean: 0.14,
    bright_pixel_ratio: 0,
    dark_pixel_ratio: 0.79,
  });

  assert.equal(taste.verdict, "fail");
  assert.equal(taste.reason, "muddy_dark_low_energy_frame");
});

test("classifyTrailerFrameTaste: accepts colourful detailed gameplay-like frames", () => {
  const taste = v.classifyTrailerFrameTaste({
    text_overlay_likelihood: 0.12,
    edge_density: 0.24,
    saturation_mean: 0.52,
    bright_pixel_ratio: 0.08,
    dark_pixel_ratio: 0.18,
  });

  assert.equal(taste.verdict, "pass");
  assert.equal(taste.reason, "taste_passed");
  assert.ok(taste.tags.includes("gameplay_candidate"));
});

test("classifyTrailerFrameTaste: missing metrics stays neutral for legacy QA records", () => {
  const taste = v.classifyTrailerFrameTaste({});

  assert.equal(taste.verdict, "unknown");
  assert.equal(taste.reason, "taste_not_scanned");
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
