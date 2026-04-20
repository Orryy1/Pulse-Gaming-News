const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Pins the whitelist of public static mounts on server.js so a
// future refactor can't re-introduce an untracked one. The 2026-04-20
// audit removed /stories (leaking draft IG Story PNGs) and the
// 2026-04-21 audit removed /generated (empty, zero consumers).
// Anything that IS allowed to serve files without auth must be an
// explicit entry in ALLOWED_STATIC_MOUNTS below.

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

// Strip comments so "// Note: the removed /generated mount" style
// prose doesn't trip the scan.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
const codeNoComments = code
  .split("\n")
  .map((line) => line.replace(/\/\/[^\n]*$/, ""))
  .join("\n");

// The set of static mounts the server is allowed to register. "root"
// is the no-prefix express.static(dist) mount for the Vite SPA.
const ALLOWED_STATIC_MOUNTS = new Set(["/branding", "/blog", "root"]);

// Extract every `app.use("<prefix>"?, express.static(...))` call.
// Regex captures the optional prefix; if no prefix, we tag it "root".
function extractStaticMounts(source) {
  const re =
    /app\s*\.\s*use\s*\(\s*(?:["']([^"']+)["']\s*,\s*)?express\s*\.\s*static\s*\(/g;
  const mounts = [];
  let m;
  while ((m = re.exec(source)) != null) {
    mounts.push(m[1] || "root");
  }
  return mounts;
}

test("server.js: every public static mount is on the whitelist", () => {
  const found = extractStaticMounts(codeNoComments);
  assert.ok(found.length > 0, "expected at least one static mount");
  for (const prefix of found) {
    assert.ok(
      ALLOWED_STATIC_MOUNTS.has(prefix),
      `unauthorised public static mount: ${prefix} — add to ALLOWED_STATIC_MOUNTS with a reviewer's note, or gate behind requireAuth`,
    );
  }
});

test("server.js: no static mount over output/ in any form", () => {
  const re = /express\s*\.\s*static\s*\([^)]*["']output["']/i;
  const re2 = /express\s*\.\s*static\s*\([^)]*output[/\\]/i;
  assert.strictEqual(
    re.test(codeNoComments) || re2.test(codeNoComments),
    false,
    "server.js still mounts something over output/ — use the gated /api/story-image or /api/download handlers",
  );
});

test("server.js: no /generated or /stories mount (both removed)", () => {
  for (const prefix of ["/generated", "/stories"]) {
    const re = new RegExp(
      `app\\.use\\(\\s*["']${prefix}["']\\s*,\\s*express\\.static`,
      "i",
    );
    assert.strictEqual(
      re.test(codeNoComments),
      false,
      `${prefix} mount is back — see the 2026-04-20/21 removals`,
    );
  }
});

test("server.js: still mounts the dashboard SPA (dist) and /branding", () => {
  // Sanity — we need these to keep working.
  assert.match(
    src,
    /express\.static\(path\.join\(__dirname,\s*["']dist["']\)\)/,
    "dist/ SPA mount must remain",
  );
  assert.match(
    src,
    /app\.use\(\s*["']\/branding["']\s*,\s*express\.static/,
    "/branding mount must remain (outgoing video composition uses these assets)",
  );
});
