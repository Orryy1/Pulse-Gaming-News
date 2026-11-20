import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addPremiere,
  isPremiereDoc,
  markPremiereSet,
  premiereNotice,
  premierePosts,
  premierePrivacy,
  premiereWhen,
  premieresToSet,
  readPremieres,
} from "../src/premiere.ts";
import { docRunDue, readRun, type RunDoc } from "../src/shortrun.ts";
import { loadConfig } from "../src/config.ts";
import { tmpDir } from "./helpers.ts";

const at = (iso: string) => new Date(iso);
const RUN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "launch_run.json",
);

test("off by default, and only a documentary whose run entry asked for it is a Premiere", () => {
  const before = { ...process.env };
  delete process.env.PREMIERE_DOCS;
  try {
    assert.equal(loadConfig().premiereDocs, false);
  } finally {
    process.env = before;
  }
  const fc = { doc: true, topic: { premiere: true } };
  assert.equal(isPremiereDoc(false, fc), false);
  assert.equal(isPremiereDoc(true, fc), true);
  assert.equal(isPremiereDoc(true, { doc: true, topic: {} }), false);
  assert.equal(isPremiereDoc(true, { topic: { premiere: true } }), false);
  assert.equal(isPremiereDoc(true, null), false);
  // Private is never scheduled by the upload (src/youtube/upload.ts schedules public uploads only).
  assert.equal(premierePrivacy(true, "public"), "private");
  assert.equal(premierePrivacy(false, "public"), "public");
});

test("the GTA launch documentary on 21 Nov is marked for a Premiere, and the topic carries it", () => {
  const run = readRun(RUN);
  const doc = run.find(
    (e): e is RunDoc => e.kind === "doc" && e.date === "2026-11-21",
  );
  assert.ok(doc);
  assert.equal(doc.premiere, true);
  const due = docRunDue(run, at("2026-11-21T02:00:00Z"), [], "Europe/London");
  assert.equal(
    due?.entry.title,
    "We Tested GTA 6's Biggest Claims on Launch Day",
  );
  assert.equal(due?.topic.premiere, true);
  assert.equal(isPremiereDoc(true, { doc: true, topic: due!.topic }), true);
});

test("the countdown posts and the Discord line: the time in UK and Eastern, the link, no dashes, no subscribe ask", () => {
  const start = at("2026-11-21T17:00:00Z");
  assert.equal(
    premiereWhen(start),
    "Saturday 21 November at 17:00 UK time (12pm Eastern)",
  );
  const p = premierePosts(
    "We Tested GTA 6's Biggest Claims on Launch Day",
    "abc123XYZ",
    start,
  );
  assert.match(
    p.communityPost,
    /premieres Saturday 21 November at 17:00 UK time/,
  );
  assert.match(p.communityPost, /https:\/\/youtu\.be\/abc123XYZ/);
  assert.ok(p.xPost.length <= 280);
  for (const t of [p.communityPost, p.xPost]) {
    assert.doesNotMatch(t, /[–—]/);
    assert.doesNotMatch(t, /subscribe/i);
  }
});

test("the premiere list: added once, set by the browser task, and a start too close is left off the worklist", async () => {
  const dir = await tmpDir();
  const now = at("2026-11-21T02:00:00Z");
  const e = addPremiere(
    dir,
    {
      episode: "ep1",
      videoId: "vid12345",
      title: "T",
      at: at("2026-11-21T17:00:00Z"),
    },
    now,
  );
  addPremiere(
    dir,
    {
      episode: "ep1",
      videoId: "vid12345",
      title: "T",
      at: at("2026-11-21T17:00:00Z"),
    },
    now,
  );
  assert.equal(readPremieres(dir).length, 1);
  assert.equal(e.studioUrl, "https://studio.youtube.com/video/vid12345/edit");
  assert.deepEqual(
    premieresToSet(readPremieres(dir), now).map((x) => x.videoId),
    ["vid12345"],
  );
  assert.deepEqual(
    premieresToSet(readPremieres(dir), at("2026-11-21T16:45:00Z")),
    [],
  );
  assert.match(premiereNotice(e), /PRIVATE for a Premiere/);
  assert.match(premiereNotice(e), /Premiere steps\.md/);
  assert.equal(markPremiereSet(dir, "vid12345", now), true);
  assert.equal(markPremiereSet(dir, "nope0000", now), false);
  assert.deepEqual(premieresToSet(readPremieres(dir), now), []);
});
