import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { markLibraryFaults } from "../src/assets/shortlibrary.ts";
import { readLibrary, writeLibrary, libraryRoot } from "../src/assets/gamelib.ts";

test("a faulted library scene is marked unusable and a still is ruled out", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "libfault-"));
  const root = libraryRoot(dataDir);
  const lib = (await readLibrary(root, "Grand Theft Auto VI")) ?? undefined;
  assert.equal(lib, undefined);
  const { LIBRARY_VERSION } = (await import("../src/assets/gamelib.ts")) as any;
  await writeLibrary(root, {
    version: LIBRARY_VERSION,
    game: "Grand Theft Auto VI",
    updatedAt: "",
    items: [
      { id: "v1", kind: "video", file: "videos/v1.mp4", sourceUrl: "u1", provenance: "p", source: "Rockstar Games", named: ["trailer"], tags: [], seen: "", addedAt: "", scenes: [{ at: 143.83, end: 147, tags: ["people"], seen: "couple kissing in dimly lit room" }] },
      { id: "s1", kind: "still", file: "stills/s1.jpg", sourceUrl: "u2", provenance: "p", source: "Rockstar Games", named: [], tags: [], seen: "a beach", addedAt: "" },
    ],
  } as any);
  const n = await markLibraryFaults(dataDir, "Grand Theft Auto VI", ["v1@143.83", "s1"], "suggestive close-up");
  assert.equal(n, 2);
  const after = (await readLibrary(root, "Grand Theft Auto VI"))!;
  assert.ok(after.items[0]!.scenes![0]!.seen.startsWith("unusable"));
  assert.ok(after.items[1]!.unusable);
  assert.equal(await markLibraryFaults(dataDir, "Grand Theft Auto VI", ["v1@143.83"], "again"), 0);
});
