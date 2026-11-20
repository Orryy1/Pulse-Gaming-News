// The long ranking lane went quiet for a week (20 Nov 2026) and its log said nothing: every exit now names its reason
// once, a demand check can never empty the shortlist, and a long ranking is picked for Saturday's 17:00 slot as soon
// as its window opens (30 hours ahead, Friday 11:00 UK) even while YouTube search is paused by the bot check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evergreenDue, evergreenWhyNot } from "../src/lanes.ts";
import {
  longShortlist,
  maybeSelectLongform,
  quietLog,
  type Services,
} from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";

const PLAN = {
  days: ["sat"],
  slot: "17:00",
  leadMinutes: 30 * 60,
  graceMinutes: 30,
  timeZone: "Europe/London",
};

test("evergreenWhyNot names the next slot and when its window opens", () => {
  // Thursday 19 Nov 12:00 UK with a Saturday-only lane: the Thursday slot never existed.
  const thu = new Date("2026-11-19T12:00:00Z");
  assert.equal(evergreenDue(thu, PLAN, []), undefined);
  const why = evergreenWhyNot(thu, PLAN, []);
  assert.equal(why.reason, "the next slot is not open yet");
  assert.equal(why.slot?.toISOString(), "2026-11-21T17:00:00.000Z");
  assert.equal(why.opensAt?.toISOString(), "2026-11-20T11:00:00.000Z");
  // Friday 12:00: due; a taken slot is named as taken.
  const fri = new Date("2026-11-20T12:00:00Z");
  assert.equal(
    evergreenDue(fri, PLAN, [])?.toISOString(),
    "2026-11-21T17:00:00.000Z",
  );
  const taken = evergreenWhyNot(fri, PLAN, [new Date("2026-11-21T17:00:00Z")]);
  assert.equal(
    taken.reason,
    "the next slot is already taken by another episode",
  );
  assert.equal(
    evergreenWhyNot(fri, { ...PLAN, days: [] }, []).reason,
    "no days set for this lane",
  );
});

test("quietLog says a reason once, again when it changes, and again after its interval", () => {
  const t0 = 1_000_000;
  assert.equal(quietLog("test lane", "a", {}, t0), true);
  assert.equal(quietLog("test lane", "a", {}, t0 + 60_000), false);
  assert.equal(quietLog("test lane", "b", {}, t0 + 120_000), true);
  assert.equal(
    quietLog("test lane", "b", {}, t0 + 120_000 + 6 * 3_600_000),
    true,
  );
});

test("the demand check alone never empties the long shortlist", () => {
  assert.deepEqual(longShortlist([], ["a", "b"]), {
    list: ["a", "b"],
    demandIgnored: true,
  });
  assert.deepEqual(longShortlist(["b"], ["a", "b"]), {
    list: ["b"],
    demandIgnored: false,
  });
  assert.deepEqual(longShortlist([], []), { list: [], demandIgnored: false });
});

async function rig(days: string[], at: string) {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    longformEnabled: true,
    longformDays: days,
    longformSlot: "17:00",
    longLeadMinutes: 30 * 60,
    timezone: "Europe/London",
    demandCheck: true,
    sequelWinners: false,
  });
  const asked: string[] = [];
  const llm: Llm = {
    async structured(o) {
      asked.push(o.site ?? "?");
      return {
        candidate_index: 0,
        format: "ranking",
        theme: "The Legend of Zelda",
        title_idea: "Ranking EVERY Zelda Game",
        criterion: "how well each one holds up today",
        reason: "a big series with a clear order to argue about",
      } as never;
    },
  };
  const clock = new Date(at);
  const s = {
    db,
    cfg,
    llm,
    now: () => clock,
    notify: async () => undefined,
    trending: async () => [],
    discoverEvergreen: async () => [
      { name: "The Legend of Zelda", source: "franchise seed" },
      { name: "Resident Evil", source: "franchise seed" },
    ],
    // YouTube's bot check: every demand search fails, as on 18-20 Nov.
    searchDemand: async () => {
      throw new Error("YouTube fetch skipped: YouTube asked for a bot check");
    },
  } as unknown as Services;
  return { db, s, asked };
}

test("a Saturday long ranking is picked from Friday 11:00 even with every demand search failing", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (l: string) => lines.push(String(l));
  try {
    // Before the window: nothing, said once with the reason and when the window opens.
    {
      const { db, s, asked } = await rig(["sat"], "2026-11-19T12:00:00Z");
      assert.equal(await maybeSelectLongform(s), undefined);
      assert.equal(await maybeSelectLongform(s), undefined);
      assert.deepEqual(asked, []);
      const quiet = lines.filter((l) =>
        l.includes("long ranking: nothing picked"),
      );
      assert.equal(quiet.length, 1, lines.join("\n"));
      assert.match(quiet[0]!, /not open yet/);
      assert.match(quiet[0]!, /2026-11-20T11:00:00.000Z/);
      await db.close();
    }
    // Friday 12:00 with mon,thu,sat: picked for Saturday 17:00 UK.
    {
      const { db, s, asked } = await rig(
        ["mon", "thu", "sat"],
        "2026-11-20T12:00:00Z",
      );
      const id = await maybeSelectLongform(s);
      assert.ok(id, lines.join("\n"));
      assert.deepEqual(asked, ["longform.topic"]);
      const [ep] = await db.query<{ lane: string; slot_at: Date }>(
        `SELECT lane, slot_at FROM episodes WHERE id = $1`,
        [id],
      );
      assert.equal(ep!.lane, "longform");
      assert.equal(
        new Date(ep!.slot_at).toISOString(),
        "2026-11-21T17:00:00.000Z",
      );
      await db.close();
    }
    // Every topic freshly measured at no demand: the check is set aside rather than leaving the slot empty.
    {
      const { db, s, asked } = await rig(["sat"], "2026-11-20T12:00:00Z");
      for (const q of ["The Legend of Zelda", "Resident Evil"])
        await db.query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [
          `demand:${q.toLowerCase()}`,
          JSON.stringify({
            query: q,
            views: 0,
            hits: 0,
            level: "none",
            at: "2026-11-20T11:00:00.000Z",
          }),
        ]);
      assert.ok(await maybeSelectLongform(s), lines.join("\n"));
      assert.deepEqual(asked, ["longform.topic"]);
      assert.ok(lines.some((l) => l.includes("demand check is set aside")));
      await db.close();
    }
  } finally {
    console.log = orig;
  }
});
