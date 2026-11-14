import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesCoverOf } from "../src/seriescover.ts";
import { stripText } from "../src/render/seriesstrip.ts";
import { pulseLabSettings } from "../src/pulselab/settings.ts";
import { goodScript, testDb } from "./helpers.ts";

const cfg = {
  seriesCoverStyle: "strip" as const,
  seriesEpisodeNumbers: true,
  pulseLab: pulseLabSettings({ PULSE_LAB: "true", PULSE_LAB_TALLY: "true" }),
};

test("every series Short's strip carries its season tally; the control and the Lab off carry none", async () => {
  const db = await testDb();
  for (const id of ["w1", "w2", "v1", "n1"])
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, lane, story_json) VALUES ($1, $1, 'rendered', 'news', '{}')`,
      [id],
    );
  const why = goodScript({ series: "why" } as never);
  const a = await seriesCoverOf(db, cfg, { id: "w1", story_hash: "w1" }, why);
  await new Promise((r) => setTimeout(r, 5));
  const b = await seriesCoverOf(db, cfg, { id: "w2", story_hash: "w2" }, why);
  assert.equal(a!.tally, "The Why: 1 answered");
  assert.equal(b!.tally, "The Why: 2 answered");
  assert.equal(
    stripText(b!),
    "THE WHY #1",
    "the strip's own words are unchanged",
  );
  const again = await seriesCoverOf(
    db,
    cfg,
    { id: "w2", story_hash: "w2" },
    why,
  );
  assert.equal(again!.tally, "The Why: 2 answered", "a re-render counts once");
  const verdict = goodScript({ series: "verdict" } as never);
  (verdict.pulse_take as { stamp?: { text: string } }).stamp = { text: "WAIT" };
  const v = await seriesCoverOf(
    db,
    cfg,
    { id: "v1", story_hash: "v1" },
    verdict,
  );
  assert.equal(v!.tally, "Verdicts: 0 buy, 1 wait, 0 skip");
  assert.equal(
    await seriesCoverOf(
      db,
      cfg,
      { id: "n1", story_hash: "n1" },
      goodScript({ series: "news_control" } as never),
    ),
    undefined,
  );
  const off = await seriesCoverOf(
    db,
    { ...cfg, pulseLab: pulseLabSettings({}) },
    { id: "w1", story_hash: "w1" },
    why,
  );
  assert.equal(off!.tally, undefined);
  await db.close();
});
