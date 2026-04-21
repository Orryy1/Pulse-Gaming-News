const { test } = require("node:test");
const assert = require("node:assert");

const {
  runVideoQa,
  classifyVideoQa,
  parseFfprobeDuration,
  parseBlackdetectOutput,
  DEFAULT_MIN_DURATION_SECONDS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
} = require("../../lib/services/video-qa");

// ---------- ffprobe output parsing ----------

test("parseFfprobeDuration: extracts the duration from normal output", () => {
  const out = "duration=50.437100\n";
  assert.strictEqual(parseFfprobeDuration(out), 50.4371);
});

test("parseFfprobeDuration: case-insensitive + tolerates whitespace", () => {
  assert.strictEqual(parseFfprobeDuration("DURATION=12.5\n"), 12.5);
});

test("parseFfprobeDuration: returns null on empty / malformed / non-string", () => {
  assert.strictEqual(parseFfprobeDuration(""), null);
  assert.strictEqual(parseFfprobeDuration("garbage"), null);
  assert.strictEqual(parseFfprobeDuration(null), null);
  assert.strictEqual(parseFfprobeDuration(undefined), null);
  assert.strictEqual(parseFfprobeDuration("duration=NaN"), null);
});

// ---------- blackdetect output parsing ----------

test("parseBlackdetectOutput: parses a single black segment", () => {
  const stderr = `
    [blackdetect @ 0x123] black_start:0 black_end:1.234 black_duration:1.234
  `;
  assert.deepStrictEqual(parseBlackdetectOutput(stderr), [
    { start: 0, end: 1.234, duration: 1.234 },
  ]);
});

test("parseBlackdetectOutput: parses multiple segments", () => {
  const stderr = `
    [blackdetect @ 0x123] black_start:0.5 black_end:1.1 black_duration:0.6
    [blackdetect @ 0x456] black_start:8.0 black_end:12.0 black_duration:4.0
  `;
  const segs = parseBlackdetectOutput(stderr);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].duration, 0.6);
  assert.strictEqual(segs[1].duration, 4);
});

test("parseBlackdetectOutput: returns empty array on empty/no-match input", () => {
  assert.deepStrictEqual(parseBlackdetectOutput(""), []);
  assert.deepStrictEqual(parseBlackdetectOutput("some unrelated log"), []);
  assert.deepStrictEqual(parseBlackdetectOutput(null), []);
});

// ---------- classifyVideoQa: duration branch ----------

test("classifyVideoQa: a 50s video with no black segments → pass", () => {
  const r = classifyVideoQa({ durationSeconds: 50.5, blackSegments: [] });
  assert.strictEqual(r.result, "pass");
  assert.deepStrictEqual(r.failures, []);
  assert.deepStrictEqual(r.warnings, []);
});

test("classifyVideoQa: duration below min → fail:duration_too_short", () => {
  const r = classifyVideoQa({ durationSeconds: 12.0, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("duration_too_short")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: duration above max → fail:duration_too_long", () => {
  const r = classifyVideoQa({ durationSeconds: 120, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("duration_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: unknown duration → fail:duration_unknown", () => {
  const r = classifyVideoQa({ durationSeconds: null, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("duration_unknown"));
});

// ---------- classifyVideoQa: blackdetect branch ----------

test("classifyVideoQa: 4s mid-video black segment → fail", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 10, end: 14, duration: 4 }],
  });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("black_segment_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: 1s opening black → warn:opening_black", () => {
  // Opening-only black between the 0.5s xfade floor and the hard
  // 2s bound: a soft warning, not a fail.
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 0, end: 1.0, duration: 1.0 }],
  });
  assert.strictEqual(r.result, "warn");
  assert.ok(
    r.warnings.some((w) => w.startsWith("opening_black")),
    `got: ${r.warnings.join(", ")}`,
  );
});

test("classifyVideoQa: 0.5s opening dip → pass (that's the expected xfade)", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 0, end: 0.5, duration: 0.5 }],
  });
  assert.strictEqual(r.result, "pass");
});

test("classifyVideoQa: multiple short mid-segments under 2s each → pass", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [
      { start: 8, end: 8.5, duration: 0.5 },
      { start: 16, end: 16.5, duration: 0.5 },
      { start: 24, end: 24.5, duration: 0.5 },
    ],
  });
  assert.strictEqual(r.result, "pass");
});

test("classifyVideoQa: short duration AND long black → both failures captured", () => {
  const r = classifyVideoQa({
    durationSeconds: 15,
    blackSegments: [{ start: 5, end: 9, duration: 4 }],
  });
  assert.strictEqual(r.result, "fail");
  assert.strictEqual(r.failures.length, 2);
});

// ---------- runVideoQa: mocked exec ----------

function stubExec(handlers) {
  // handlers: function(cmd) → returns { stdout, stderr } OR throws
  return async (cmd, _opts) => handlers(cmd);
}

function fakeFs(existsMap) {
  return {
    async pathExists(p) {
      return !!existsMap[p];
    },
  };
}

test("runVideoQa: missing mp4_path → fail", async () => {
  const r = await runVideoQa("", { fs: fakeFs({}) });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("mp4_path_missing"));
});

test("runVideoQa: file not on disk → fail", async () => {
  const r = await runVideoQa("/tmp/nope.mp4", { fs: fakeFs({}) });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("mp4_not_on_disk"));
});

test("runVideoQa: ffprobe missing → skip, not fail", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec(() => {
      const e = new Error("spawn ffprobe ENOENT");
      e.code = "ENOENT";
      throw e;
    }),
  });
  assert.strictEqual(r.result, "skip");
  assert.strictEqual(r.reason, "ffprobe_missing");
});

test("runVideoQa: healthy video (50s, no black) → pass", async () => {
  let callCount = 0;
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec((cmd) => {
      callCount++;
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.00\n", stderr: "" };
      }
      // ffmpeg blackdetect: no black segments in output
      return { stdout: "", stderr: "" };
    }),
  });
  assert.strictEqual(r.result, "pass");
  assert.strictEqual(callCount, 2);
});

test("runVideoQa: short video (15s) + mid black → fail with both reasons", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=15.00\n", stderr: "" };
      }
      return {
        stdout: "",
        stderr:
          "[blackdetect @ 0x0] black_start:5.0 black_end:9.0 black_duration:4.0\n",
      };
    }),
  });
  assert.strictEqual(r.result, "fail");
  assert.strictEqual(r.failures.length, 2);
});

test("runVideoQa: opening-only black (1s) → warn", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.0\n", stderr: "" };
      }
      return {
        stdout: "",
        stderr:
          "[blackdetect @ 0x0] black_start:0 black_end:1.0 black_duration:1.0\n",
      };
    }),
  });
  assert.strictEqual(r.result, "warn");
  assert.ok(r.warnings.some((w) => w.startsWith("opening_black")));
});

test("runVideoQa: ffmpeg blackdetect exit code non-zero but output parseable → still works", async () => {
  // ffmpeg in some builds exits 1 even though it produced valid
  // blackdetect output. The helper must read err.stderr / err.stdout.
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.0\n", stderr: "" };
      }
      const e = new Error("Command failed");
      e.code = 1;
      e.stdout = "";
      e.stderr =
        "[blackdetect @ 0x0] black_start:2.0 black_end:6.0 black_duration:4.0\n";
      throw e;
    }),
  });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("black_segment_too_long")));
});

// ---------- defaults ----------

test("Thresholds are conservative defaults", () => {
  assert.strictEqual(DEFAULT_MIN_DURATION_SECONDS, 40);
  assert.strictEqual(DEFAULT_MAX_DURATION_SECONDS, 75);
  assert.strictEqual(DEFAULT_MAX_BLACK_SEGMENT_SECONDS, 2);
});
