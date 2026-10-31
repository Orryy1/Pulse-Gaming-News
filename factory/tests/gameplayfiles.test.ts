import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newClips, writeMeta, writeWhole } from "../src/gameplay.ts";

async function clip(
  root: string,
  id: string,
  status: string,
  ageMinutes: number,
) {
  const dir = path.join(root, "inbox", id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "meta.json");
  await fs.writeFile(
    file,
    JSON.stringify({ id, status, score: 5, clip: { file: "clip.mp4" } }),
  );
  const t = new Date(Date.now() - ageMinutes * 60_000);
  await fs.utimes(file, t, t);
  return dir;
}

test("a clip left at reviewing by a review that died is looked at again after 30 minutes (27 Oct 2026)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gp-"));
  await clip(root, "gp_new", "new", 1);
  await clip(root, "gp_stuck", "reviewing", 90);
  await clip(root, "gp_busy", "reviewing", 2);
  await clip(root, "gp_done", "rejected", 90);
  const ids = (await newClips(root)).map((c) => c.meta.id).sort();
  assert.deepEqual(ids, ["gp_new", "gp_stuck"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("meta.json is written whole and leaves no temp files behind", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gp-"));
  const dir = await clip(root, "gp_a", "new", 1);
  await writeMeta(dir, { status: "reviewing" });
  assert.equal(
    JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")).status,
    "reviewing",
  );
  assert.deepEqual(
    (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp")),
    [],
  );
  await writeWhole(path.join(dir, "x.json"), "{}");
  assert.equal(await fs.readFile(path.join(dir, "x.json"), "utf8"), "{}");
  await fs.rm(root, { recursive: true, force: true });
});
