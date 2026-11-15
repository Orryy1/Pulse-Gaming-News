import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleIntact } from "../src/render/render.ts";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pulse-test-bundle-"));
}

test("a bundle missing a music bed that public/ has is not intact, so it gets rebuilt", () => {
  const pub = tmp();
  const dir = tmp();
  fs.mkdirSync(path.join(pub, "music"), { recursive: true });
  fs.mkdirSync(path.join(dir, "public", "music"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  for (const n of [1, 2, 3, 4])
    fs.writeFileSync(path.join(pub, "music", `bed_${n}.wav`), "x");
  fs.writeFileSync(path.join(dir, "public", "music", "bed_3.wav"), "x");
  assert.equal(bundleIntact(dir, pub), false);
  for (const n of [1, 2, 4])
    fs.writeFileSync(path.join(dir, "public", "music", `bed_${n}.wav`), "x");
  assert.equal(bundleIntact(dir, pub), true);
  fs.rmSync(path.join(dir, "index.html"));
  assert.equal(bundleIntact(dir, pub), false);
});
