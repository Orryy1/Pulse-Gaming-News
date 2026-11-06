import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import { sendDueNotices } from "../src/notices.ts";

test("a notice goes out once, when it is due", async () => {
  const dataDir = await tmpDir();
  await fs.mkdir(path.join(dataDir, "admin"), { recursive: true });
  const file = path.join(dataDir, "admin", "notices.json");
  await fs.writeFile(file, JSON.stringify([{ at: "2026-10-29T10:30:00Z", content: "Mac day" }, { at: "2026-10-30T10:00:00Z", content: "later" }]));
  const sent: string[] = [];
  const notify = async (m: { content: string }) => sent.push(m.content);
  assert.equal(await sendDueNotices({ dataDir }, new Date("2026-10-29T10:00:00Z"), notify), 0);
  assert.equal(await sendDueNotices({ dataDir }, new Date("2026-10-29T10:31:00Z"), notify), 1);
  assert.equal(await sendDueNotices({ dataDir }, new Date("2026-10-29T10:33:00Z"), notify), 0, "only once");
  assert.deepEqual(sent, ["Mac day"]);
  assert.equal(await sendDueNotices({ dataDir: path.join(dataDir, "missing") }, new Date(), notify), 0, "no file, nothing");
});
