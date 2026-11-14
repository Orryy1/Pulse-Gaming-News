import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { libraryFiles, recordingsOf } from "../src/assets/library.ts";

test("own recordings are found by the recorder's folder-and-name pattern and matched to exactly the right game", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lib-"));
  const put = async (dir: string, file: string) => {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, file), "x");
  };
  await put("Half-Life 2 RTX", "Half-Life 2 RTX 2026.08.13 - 11.24.46.01.mp4");
  await put("Call of Duty 4 Modern Warfare", "Call of Duty 4 Modern Warfare 2026.10.20 - 21.00.00.01.mp4");
  await put("Call of Duty Modern Warfare 2", "Call of Duty Modern Warfare 2 2026.10.20 - 22.00.00.01.mp4");
  await put("After Effects", "Orryy Intro.mp4"); // not a recording: the name does not start with the folder's
  const files = await libraryFiles(root);
  assert.equal(files.length, 3);
  assert.deepEqual(recordingsOf(files, "Call of Duty 4: Modern Warfare", "Call of Duty").map((f) => f.game), ["Call of Duty 4 Modern Warfare"]);
  assert.deepEqual(recordingsOf(files, "Call of Duty: Modern Warfare 2", "Call of Duty").map((f) => f.game), ["Call of Duty Modern Warfare 2"]);
  assert.deepEqual(recordingsOf(files, "Half-Life 2 RTX", "Half-Life").map((f) => f.game), ["Half-Life 2 RTX"]);
  assert.deepEqual(recordingsOf(files, "Saros", "Saros"), []);
  await fs.rm(root, { recursive: true, force: true });
});
