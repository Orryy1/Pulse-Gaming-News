"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const v = require("../../lib/render-input-validation");

// 2026-04-30 reported issue: "Tales Of remaster" rendered as
// legacy_single_image_fallback at 10:03 UTC despite 8 visuals
// available — multi-image filter graph crashed silently. This test
// suite pins the pre-flight validator + ffmpeg-stderr classifier
// that prevents AND diagnoses the next occurrence.

// ── classifyFfmpegError ──────────────────────────────────────────

test("classifyFfmpegError: 'No such file' → input_no_such_file", () => {
  assert.equal(
    v.classifyFfmpegError(
      "[image2 @ 0x55] /tmp/x.jpg: No such file or directory",
    ),
    "input_no_such_file",
  );
});

test("classifyFfmpegError: 'Invalid data found' → input_invalid_data", () => {
  assert.equal(
    v.classifyFfmpegError("Invalid data found when processing input"),
    "input_invalid_data",
  );
});

test("classifyFfmpegError: 'Could not decode' → input_decode_error", () => {
  assert.equal(
    v.classifyFfmpegError("Could not decode the JPEG header"),
    "input_decode_error",
  );
});

test("classifyFfmpegError: filter graph parse error", () => {
  assert.equal(
    v.classifyFfmpegError("Error parsing filtergraph: invalid scale option"),
    "filter_graph_parse_error",
  );
});

test("classifyFfmpegError: filter label not found", () => {
  assert.equal(
    v.classifyFfmpegError(
      "[Parsed_xfade_3] Cannot find a matching stream for [v3]",
    ),
    "filter_label_not_found",
  );
});

test("classifyFfmpegError: ASS path error (the 2026-04-25 hotfix class)", () => {
  // The hotfix comment in assemble.js mentions [auto_scale_N] but
  // the closer pattern was the [Parsed_ass_*] failure path.
  assert.equal(
    v.classifyFfmpegError("[Parsed_ass_5 @ 0x55] could not load font"),
    "ass_path_error",
  );
});

test("classifyFfmpegError: drawtext failure", () => {
  assert.equal(
    v.classifyFfmpegError("[drawtext @ 0x7] Failed to load font"),
    "drawtext_error",
  );
});

test("classifyFfmpegError: SIGKILL → killed_by_signal", () => {
  assert.equal(
    v.classifyFfmpegError("ffmpeg process: received signal SIGKILL"),
    "killed_by_signal",
  );
});

test("classifyFfmpegError: out of memory", () => {
  assert.equal(v.classifyFfmpegError("Cannot allocate memory"), "memory_error");
});

test("classifyFfmpegError: timeout", () => {
  assert.equal(v.classifyFfmpegError("ffmpeg operation timed out"), "timeout");
});

test("classifyFfmpegError: unrecognised → ffmpeg_unknown", () => {
  assert.equal(v.classifyFfmpegError("strange happenings"), "ffmpeg_unknown");
});

test("classifyFfmpegError: null/undefined input", () => {
  assert.equal(v.classifyFfmpegError(null), "ffmpeg_unknown");
  assert.equal(v.classifyFfmpegError(undefined), "ffmpeg_unknown");
});

test("classifyFfmpegError: accepts Error object via .stderr", () => {
  const err = new Error("ffmpeg fail");
  err.stderr = "Cannot allocate memory";
  assert.equal(v.classifyFfmpegError(err), "memory_error");
});

test("classifyFfmpegError: accepts Error object via .message fallback", () => {
  const err = new Error("ffmpeg killed by signal");
  assert.equal(v.classifyFfmpegError(err), "killed_by_signal");
});

// ── validateImageFile (mocked sharp) ─────────────────────────────

function fakeSharp(metadata) {
  return (_path) => ({
    async metadata() {
      if (metadata && metadata.__throw) throw metadata.__throw;
      return metadata || {};
    },
  });
}

test("validateImageFile: missing path → ok=false", async () => {
  const r = await v.validateImageFile(null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_path");
});

test("validateImageFile: file missing → stat_failed", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-no-${Date.now()}.jpg`);
  const r = await v.validateImageFile(tmp);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^stat_failed/);
});

test("validateImageFile: too-small file → too_small", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-tiny-${Date.now()}.jpg`);
  await fs.writeFile(tmp, "x");
  try {
    const r = await v.validateImageFile(tmp, { sharp: fakeSharp({}) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^too_small/);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("validateImageFile: 0×0 dims → zero_dimensions", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-zero-${Date.now()}.jpg`);
  await fs.writeFile(tmp, "x".repeat(500));
  try {
    const r = await v.validateImageFile(tmp, {
      sharp: fakeSharp({ width: 0, height: 0 }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "zero_dimensions");
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("validateImageFile: tiny dims (8×8) → dim_too_small", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-tiny-dim-${Date.now()}.jpg`);
  await fs.writeFile(tmp, "x".repeat(500));
  try {
    const r = await v.validateImageFile(tmp, {
      sharp: fakeSharp({ width: 8, height: 8 }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^dim_too_small:8x8/);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("validateImageFile: sharp throws → sharp_decode reason", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-throw-${Date.now()}.jpg`);
  await fs.writeFile(tmp, "x".repeat(500));
  try {
    const r = await v.validateImageFile(tmp, {
      sharp: fakeSharp({ __throw: new Error("bad jpeg marker") }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^sharp_decode/);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("validateImageFile: healthy 1080×1920 image passes", async () => {
  const tmp = path.join(os.tmpdir(), `pulse-good-${Date.now()}.jpg`);
  await fs.writeFile(tmp, "x".repeat(50000));
  try {
    const r = await v.validateImageFile(tmp, {
      sharp: fakeSharp({ width: 1080, height: 1920 }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.width, 1080);
    assert.equal(r.height, 1920);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

// ── validateImageBatch ──────────────────────────────────────────

test("validateImageBatch: drops bad images, keeps good in original order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-batch-"));
  try {
    const a = path.join(dir, "a.jpg"); // good
    const b = path.join(dir, "b.jpg"); // missing
    const c = path.join(dir, "c.jpg"); // tiny
    await fs.writeFile(a, "x".repeat(50000));
    // b not written
    await fs.writeFile(c, "x"); // tiny
    const dynamicSharp = (p) => ({
      async metadata() {
        if (p === a) return { width: 1080, height: 1920 };
        return { width: 4, height: 4 };
      },
    });
    const r = await v.validateImageBatch([a, b, c], { sharp: dynamicSharp });
    assert.deepEqual(r.good, [a]);
    assert.equal(r.bad.length, 2);
    const reasons = r.bad.map((x) => x.reason);
    assert.ok(reasons.some((s) => s.startsWith("stat_failed")));
    assert.ok(reasons.some((s) => s.startsWith("too_small")));
  } finally {
    await fs.remove(dir).catch(() => {});
  }
});

test("validateImageBatch: empty input returns empty arrays", async () => {
  const r = await v.validateImageBatch([]);
  assert.deepEqual(r.good, []);
  assert.deepEqual(r.bad, []);
});

// ── buildFallbackReason ─────────────────────────────────────────

test("buildFallbackReason: includes class + counts + truncated detail", () => {
  const out = v.buildFallbackReason({
    errorClass: "filter_graph_parse_error",
    detail: "Error parsing filtergraph: invalid scale=0:0",
    inputsValidated: 5,
    inputsBad: 2,
  });
  assert.match(out, /class=filter_graph_parse_error/);
  assert.match(out, /inputs_validated=5/);
  assert.match(out, /inputs_bad=2/);
  assert.match(out, /detail=Error parsing/);
});

test("buildFallbackReason: caps total length at 400 chars", () => {
  const longDetail = "x".repeat(2000);
  const out = v.buildFallbackReason({
    errorClass: "ffmpeg_unknown",
    detail: longDetail,
  });
  assert.ok(out.length <= 400);
});

test("buildFallbackReason: missing args still produces a usable string", () => {
  const out = v.buildFallbackReason();
  assert.equal(out, "class=ffmpeg_unknown");
});

test("buildFallbackReason: omits inputs_bad when zero", () => {
  const out = v.buildFallbackReason({
    errorClass: "input_decode_error",
    inputsValidated: 8,
    inputsBad: 0,
  });
  assert.match(out, /inputs_validated=8/);
  assert.doesNotMatch(out, /inputs_bad=/);
});

// ── FFMPEG_ERROR_CLASSES registry sanity ────────────────────────

test("FFMPEG_ERROR_CLASSES: every entry has class + re", () => {
  for (const e of v.FFMPEG_ERROR_CLASSES) {
    assert.equal(typeof e.class, "string");
    assert.ok(e.re instanceof RegExp);
  }
});

test("FFMPEG_ERROR_CLASSES: classes are unique strings", () => {
  const names = v.FFMPEG_ERROR_CLASSES.map((e) => e.class);
  assert.equal(names.length, new Set(names).size);
});
