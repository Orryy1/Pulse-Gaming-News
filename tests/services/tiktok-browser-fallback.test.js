const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Task 5 coverage: the browser-fallback TikTok uploader
// (upload_tiktok_browser.js) is off by default in production.
// Opt in via TIKTOK_BROWSER_FALLBACK=true. When disabled, the
// real API error must surface to result.errors.tiktok (redacted
// of any Bearer/access_token values) and upload_tiktok_browser
// must NOT be require()d.
//
// Source-scan over live-boot because the publishNextStory call
// chain touches SQLite, uploaders, Discord, and retry middleware —
// the specific branch we're pinning is a pure if/else on the env
// flag, so source-level assertions are the right tool.

const PUBLISHER_PATH = path.join(__dirname, "..", "..", "publisher.js");
const src = fs.readFileSync(PUBLISHER_PATH, "utf8");

test("publisher.js: TikTok browser fallback is gated on TIKTOK_BROWSER_FALLBACK", () => {
  // Every require("./upload_tiktok_browser") must sit inside a
  // TIKTOK_BROWSER_FALLBACK-guarded branch, not at top level
  // or in an unconditional catch.
  const matches = [
    ...src.matchAll(/require\(["']\.\/upload_tiktok_browser["']\)/g),
  ];
  assert.ok(
    matches.length >= 2,
    `expected ≥2 require()s of upload_tiktok_browser, got ${matches.length}`,
  );
  for (const m of matches) {
    // Look back up to ~3000 chars from the require() for the env
    // guard. The per-story branch has a ~2KB if/else with all
    // the safeMsg redaction + error-assignment code between the
    // wantBrowserFallback declaration and the require. The
    // legacy batch branch is smaller (~600 chars). 3000 covers
    // both.
    const start = Math.max(0, m.index - 3000);
    const window = src.slice(start, m.index);
    assert.match(
      window,
      /TIKTOK_BROWSER_FALLBACK/,
      `upload_tiktok_browser require at offset ${m.index} is NOT gated on TIKTOK_BROWSER_FALLBACK — would execute in production`,
    );
    assert.match(
      window,
      /wantBrowserFallback/,
      `upload_tiktok_browser require at offset ${m.index} must be inside the wantBrowserFallback branch`,
    );
  }
});

test("publisher.js: when fallback disabled, logs the safe (redacted) API error", () => {
  // The "browser fallback disabled" log line is our signal to
  // operators that the real API error followed. Pin the text so
  // a future refactor doesn't silently drop it.
  assert.match(
    src,
    /browser fallback disabled/,
    "expected a 'browser fallback disabled' log line so operators see why the fallback isn't firing",
  );
});

test("publisher.js: error messages are scrubbed of Bearer + access_token", () => {
  // Even if TikTok's error body echoes a URL with an access_token
  // query param, we must not let it land in Discord / error
  // recorded on the story. The scrub regexes guard the
  // exfiltration path.
  assert.match(src, /Bearer\\s\+\[\^\\s"']\+/);
  assert.match(src, /access_token=\[\^\\s&"']\+/);
});

test("publisher.js: per-story fallback-disabled branch records error on story + result", () => {
  // Confirm the per-story path populates story.tiktok_error +
  // result.errors.tiktok when the browser fallback is disabled
  // so the publish summary + platform_posts row get a real
  // reason instead of a silent drop.
  //
  // The legacy batch branch in publishToAllPlatforms doesn't
  // touch a per-story object (it operates on result.tiktok
  // array), so we scan all disabled branches and require that
  // AT LEAST ONE populates story.tiktok_error.
  const branches = [
    ...src.matchAll(
      /if \(!wantBrowserFallback\) \{[\s\S]*?(?=\n\s{0,4}else \{|\n\s{0,4}\})/g,
    ),
  ];
  assert.ok(branches.length >= 1, "at least one disabled branch must exist");
  const hasPerStory = branches.some(
    (b) =>
      /story\.tiktok_error = safeMsg/.test(b[0]) &&
      /result\.errors\.tiktok = safeMsg/.test(b[0]),
  );
  assert.ok(
    hasPerStory,
    "per-story disabled branch must set story.tiktok_error and result.errors.tiktok",
  );
});

// Also pin that upload_tiktok_browser.js itself can load
// (no silently broken require graph) and exposes the expected
// shape. The module only spawns Playwright when its functions
// run, so requiring it is cheap.
test("upload_tiktok_browser: module loads + exposes uploadShort/uploadAll", () => {
  const mod = require("../../upload_tiktok_browser");
  assert.strictEqual(typeof mod.uploadShort, "function");
  assert.strictEqual(typeof mod.uploadAll, "function");
});

test("publisher.js: TIKTOK_BROWSER_FALLBACK read from env + lower-cased (dev flag idiom)", () => {
  // The canonical check is
  //   (process.env.TIKTOK_BROWSER_FALLBACK || "").toLowerCase() === "true"
  // Pin both places this pattern appears so future refactors
  // keep the case-insensitive idiom rather than an exact "true"
  // match that would break the common "True"/"TRUE" env values.
  const occurrences = [
    ...src.matchAll(
      /\(process\.env\.TIKTOK_BROWSER_FALLBACK \|\| ""\)\.toLowerCase\(\) === "true"/g,
    ),
  ];
  assert.strictEqual(
    occurrences.length,
    2,
    `expected 2 uses of the case-insensitive TIKTOK_BROWSER_FALLBACK check (per-story + legacy batch path); got ${occurrences.length}`,
  );
});
