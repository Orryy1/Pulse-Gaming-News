const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Regression coverage for the 2026-04-20 `/stories` static-mount
// removal. The previous mount `app.use("/stories", express.static(
// output/stories))` duplicated every file `/api/story-image/:id`
// serves, but without the draft-vs-published gate. So anyone
// guessing a story id could fetch the IG Story PNG for an
// unpublished story at `/stories/<id>_story.png`, completely
// bypassing the work we just did on `/api/story-image`.
//
// Two cheap assertions that lock this in:
//   1. server.js doesn't re-introduce the mount.
//   2. server.js doesn't mount any OTHER public static root over
//      `output/` — the artefact files live under output/ and every
//      legitimate consumer already goes through the gated
//      handlers, so a public static root over output/ would be a
//      regression regardless of which URL prefix it picks.

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");

test("server.js does not mount a public static /stories route", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  // Strip block comments so we don't fail on the explanatory
  // "NOTE: the former app.use(...) was removed" block.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Also drop single-line comments, otherwise a // explaining the
  // removal would trip the check.
  const codeNoComments = code
    .split("\n")
    .map((line) => line.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
  // Any `app.use("/stories"` or `app.use('/stories'` in live code is
  // a regression.
  assert.strictEqual(
    /app\s*\.\s*use\s*\(\s*['"]\/stories['"]/i.test(codeNoComments),
    false,
    "server.js re-introduced a public /stories mount — drafts would leak via /stories/<id>_story.png",
  );
});

test("server.js does not mount a public static root over output/", () => {
  // Belt and braces: no `express.static(.../output...)` mount at
  // all. The legitimate artefact files (story cards, MP4s) live
  // under output/ and must flow through /api/story-image/:id or
  // /api/download/:id so the isPubliclyVisible gate applies.
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const codeNoComments = code
    .split("\n")
    .map((line) => line.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
  const staticOverOutput =
    /express\s*\.\s*static\s*\([^)]*["']output["']/i.test(codeNoComments) ||
    /express\s*\.\s*static\s*\([^)]*output[/\\]stories/i.test(codeNoComments);
  assert.strictEqual(
    staticOverOutput,
    false,
    "server.js has a public static mount over output/ — use the gated /api/story-image or /api/download handlers instead",
  );
});

test("server.js still mounts the dist/ SPA and the whitelisted static roots we do want", () => {
  // Sanity: make sure the removal didn't accidentally also drop the
  // Vite `dist` mount (that would break the dashboard) or the
  // `/branding` mount (that would break the favicons). These are
  // the ONLY static roots we expect in server.js.
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  assert.match(
    src,
    /express\.static\(path\.join\(__dirname,\s*["']dist["']\)\)/,
    "dist/ SPA static mount should still be present",
  );
  assert.match(
    src,
    /express\.static\(path\.join\(__dirname,\s*["']branding["']\)\)/,
    "branding/ static mount should still be present",
  );
});
