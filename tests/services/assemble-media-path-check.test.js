/**
 * tests/services/assemble-media-path-check.test.js
 *
 * 2026-04-24 emergency regression test.
 *
 * Bug: assemble.js's main loop checked
 *   `if (!(await fs.pathExists(story.audio_path)))`
 * directly — bypassing lib/media-paths. When `story.audio_path`
 * is a relative string like `output/audio/abc.mp3`, Node's
 * fs.pathExists resolves it against CWD (`/app` in the Railway
 * container), not under MEDIA_ROOT. This morning's 08:00 UTC
 * produce_morning generated 41 stories' audio on
 * `/data/media/output/audio/...` but assemble looked in
 * `/app/output/audio/...`, missed every one, wrote 0 MP4s, and
 * left every story in `approved_not_produced`. 09:00 UTC
 * publish_morning therefore had nothing fresh to ship.
 *
 * The same class of bug also hit:
 *   - story.image_path existence check
 *   - story.downloaded_images[].path per-image check
 *
 * Fix: route all three through mediaPaths.pathExists /
 * resolveExisting so MEDIA_ROOT is honoured.
 *
 * These tests source-scan assemble.js to prove every direct
 * `fs.pathExists(story.*)` has been removed from the production
 * loop. A regression that reintroduces any of them will stop
 * the morning produce cycle in exactly the same way.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ASSEMBLE = fs.readFileSync(
  path.join(__dirname, "..", "..", "assemble.js"),
  "utf8",
);

// Strip single-line `//` and block `/* */` comments so the regex
// below only inspects actual CODE lines. Without this, the
// in-source comment that documents the old buggy pattern would
// itself match and fail the negative assertions.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/[^\n]*/g, "$1");
}
const ASSEMBLE_CODE = stripComments(ASSEMBLE);

test("assemble.js: audio existence check routes through mediaPaths.pathExists", () => {
  assert.doesNotMatch(
    ASSEMBLE_CODE,
    /fs\.pathExists\(story\.audio_path\)/,
    "assemble.js must NOT call fs.pathExists directly on story.audio_path — route through mediaPaths.pathExists",
  );
  assert.match(
    ASSEMBLE_CODE,
    /mediaPaths\.pathExists\(story\.audio_path\)/,
    "assemble.js must use mediaPaths.pathExists(story.audio_path) for the audio check",
  );
});

test("assemble.js: image_path existence check routes through mediaPaths", () => {
  assert.doesNotMatch(
    ASSEMBLE_CODE,
    /fs\.pathExists\(story\.image_path\)/,
    "assemble.js must NOT call fs.pathExists directly on story.image_path",
  );
  assert.match(
    ASSEMBLE_CODE,
    /mediaPaths\.resolveExisting\(story\.image_path\)/,
    "assemble.js must resolve story.image_path through mediaPaths before pathExists",
  );
});

test("assemble.js: downloaded_images[].path check routes through mediaPaths", () => {
  assert.doesNotMatch(
    ASSEMBLE_CODE,
    /\(await fs\.pathExists\(img\.path\)\)/,
    "assemble.js must NOT call fs.pathExists directly on img.path",
  );
  assert.match(
    ASSEMBLE_CODE,
    /mediaPaths\.resolveExisting\(img\.path\)/,
    "assemble.js must resolve img.path through mediaPaths first",
  );
});

test("assemble.js: no duplicate mediaPaths declaration inside the same block scope", () => {
  // Node's strict mode refuses duplicate `const` in the SAME
  // block — this was caught during the 2026-04-24 emergency fix
  // when I accidentally redeclared inside the for-loop body
  // (same scope as the outer `assemble()` function). Legal
  // duplicates (different functions) are fine:
  //   - one inside `assemble()` top for the self-heal pre-pass
  //   - one inside `generateSubtitles()` for the timestamps path
  //   - etc.
  //
  // Pin: no two declarations in the SAME lexical block.
  //
  // Approximate check: find every `const mediaPaths = require(...)`
  // and make sure no two share a containing function via a rough
  // line-proximity heuristic. If two appear within 200 lines of
  // each other AND the one between them doesn't declare a new
  // function, fail.
  const re =
    /^\s*const mediaPaths = require\(["']\.\/lib\/media-paths["']\);\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(ASSEMBLE)) !== null) {
    // Line number of the match
    const line = ASSEMBLE.slice(0, m.index).split("\n").length;
    matches.push(line);
  }
  // For each pair of declarations, check there's a `function`
  // keyword between them (different scopes).
  for (let i = 1; i < matches.length; i++) {
    const startLine = matches[i - 1];
    const endLine = matches[i];
    const slice = ASSEMBLE.split("\n")
      .slice(startLine, endLine - 1)
      .join("\n");
    const hasFunctionBoundary =
      /\bfunction\s+\w+\s*\(/.test(slice) ||
      /^\s*\w+\s*\([^)]*\)\s*\{/m.test(slice);
    assert.ok(
      hasFunctionBoundary,
      `assemble.js has two 'const mediaPaths' at lines ${startLine} and ${endLine} with no function boundary between them — will shadow-redeclare and crash`,
    );
  }
});
