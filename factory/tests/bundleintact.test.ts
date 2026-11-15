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

test("a bundle missing any listed bed, house or mood, old or new, is not intact", async () => {
  const { BEDS, MOOD_BEDS } = await import("../src/render/soundscape.ts");
  const all = [...BEDS, ...Object.values(MOOD_BEDS).flat()].map((b) => b.file);
  const pub = tmp();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  for (const f of all) {
    for (const root of [pub, path.join(dir, "public")]) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "x");
    }
  }
  assert.equal(bundleIntact(dir, pub), true);
  for (const f of [all.at(-1)!, all.find((x) => x.includes("mood_"))!]) {
    fs.rmSync(path.join(dir, "public", f));
    assert.equal(bundleIntact(dir, pub), false, f);
    fs.writeFileSync(path.join(dir, "public", f), "x");
  }
});
