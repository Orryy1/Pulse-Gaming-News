import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditLaneOf,
  auditMessage,
  causeOf,
  outputAudit,
  plannedCounts,
} from "../src/outputaudit.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

// Sunday 22 Nov 2026, 23:00 GMT (local time = UTC). LONGFORM_DAYS is about to become mon,thu,sat on the Mac.
const now = new Date("2026-11-22T23:00:00Z");
const plan = {
  timezone: "Europe/London",
  newsSlots: ["17:00", "22:00"],
  slotLeadMinutes: 75,
  whyEnabled: true,
  whyDays: ["tue", "fri"],
  whySlots: ["12:00"],
  evergreenEnabled: false,
  weeklyEnabled: false,
  dealsDays: [],
  cutdownsEnabled: false,
  longformEnabled: true,
  longformDays: ["mon", "thu", "sat"],
  longformSlot: "19:00",
  longformSkip: [],
  docEnabled: false,
};

test("the plan for the week gone counts every lane's slots, three long rankings on mon, thu and sat", async () => {
  const cfg = testConfig(await tmpDir(), plan as never);
  const p = plannedCounts(cfg, now);
  assert.equal(p.get("news"), 14);
  assert.equal(p.get("why"), 2);
  assert.equal(p.get("longform"), 3);
  assert.equal(p.get("documentary"), undefined);
  // A skipped day is not planned.
  const skip = plannedCounts(
    testConfig(await tmpDir(), {
      ...plan,
      longformSkip: ["2026-11-19"],
    } as never),
    now,
  );
  assert.equal(skip.get("longform"), 2);
});

test("episodes count toward the lane that planned them, and causes fold numbers and quotes away", () => {
  assert.equal(
    auditLaneOf({ lane: "longform", story_hash: "documentary:2026-11-18:gta" }),
    "documentary",
  );
  assert.equal(
    auditLaneOf({ lane: "longform", story_hash: "longform:2026-11-16:halo" }),
    "longform",
  );
  assert.equal(
    auditLaneOf({
      lane: "longform",
      story_hash: "weekly:explained:2026-11-21",
    }),
    "weekly",
  );
  assert.equal(
    auditLaneOf({ lane: "evergreen", story_hash: "why:san-andreas" }),
    "why",
  );
  assert.equal(
    auditLaneOf({ lane: "evergreen", story_hash: "daily:deals:2026-11-20" }),
    "deals",
  );
  assert.equal(auditLaneOf({ lane: "news", story_hash: "abc" }), "news");
  assert.equal(
    auditLaneOf({ lane: "news_breaking", story_hash: "abc" }),
    "news_breaking",
  );
  assert.equal(
    causeOf(
      "documentary chapter 7 refused after widening its sources: The writer reported missing evidence",
    ),
    causeOf(
      "documentary chapter 3 refused after widening its sources: nothing on the 1997 map",
    ),
  );
  assert.equal(
    causeOf("documentary chapter 7 refused after widening its sources: x"),
    "documentary chapter # refused after widening its sources",
  );
  assert.equal(causeOf(null), "no error recorded");
});

test("a healthy week sends nothing", () => {
  assert.equal(
    auditMessage(
      {
        planned: new Map([
          ["news", 14],
          ["longform", 3],
        ]),
        published: new Map([
          ["news", 12],
          ["longform", 2],
        ]),
        failures: [],
        skips: [],
        lastLong: {
          title: "Every Halo Game Ranked",
          at: new Date("2026-11-21T19:00:00Z"),
        },
        longAttempts: [],
        droughtDays: 7,
        longPlanned: true,
        timeZone: "Europe/London",
      },
      now,
    ),
    undefined,
  );
});

async function seed() {
  const db = await testDb();
  const put = async (
    id: string,
    o: {
      hash: string;
      lane: string;
      status: string;
      at: Date;
      title?: string;
      error?: string;
      vid?: boolean;
    },
  ) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, youtube_video_id, publish_at, updated_at, created_at, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8)`,
      [
        id,
        o.hash,
        o.status,
        JSON.stringify({ headline: o.title ?? id, items: [] }),
        o.lane,
        o.vid ? `v_${id}` : null,
        o.at,
        o.error ?? null,
      ],
    );
  const day = (d: number, h = 17) => new Date(Date.UTC(2026, 10, d, h));
  // News went out at every slot; Why on both days.
  for (let d = 16; d <= 22; d++) {
    await put(`n${d}a`, {
      hash: `n${d}a`,
      lane: "news",
      status: "published",
      at: day(d, 17),
      vid: true,
    });
    await put(`n${d}b`, {
      hash: `n${d}b`,
      lane: "news",
      status: "published",
      at: day(d, 22),
      vid: true,
    });
  }
  await put("w1", {
    hash: "why:a",
    lane: "evergreen",
    status: "published",
    at: day(17, 12),
    vid: true,
  });
  await put("w2", {
    hash: "why:b",
    lane: "evergreen",
    status: "published",
    at: day(20, 12),
    vid: true,
  });
  // The last long video went public on 10 Nov; since then every long attempt failed.
  await put("l0", {
    hash: "longform:2026-11-10:re",
    lane: "longform",
    status: "published",
    at: day(10, 19),
    title: "Every Resident Evil Game Ranked",
    vid: true,
  });
  await put("d1", {
    hash: "documentary:2026-11-18:gta",
    lane: "longform",
    status: "failed",
    at: day(18, 3),
    title: "GTA 6 Map Explained: Leonida",
    error:
      "documentary chapter 7 refused after widening its sources: The writer reported missing evidence",
  });
  await put("d2", {
    hash: "longform:2026-11-19:cod",
    lane: "longform",
    status: "failed",
    at: day(19, 9),
    title: "Every Call of Duty Ranked",
    error: "documentary chapter 3 refused after widening its sources: nothing",
  });
  await put("d3", {
    hash: "longform:2026-11-21:halo",
    lane: "longform",
    status: "failed",
    at: day(21, 9),
    title: "Every Halo Ranked",
    error: "render failed: out of memory",
  });
  for (let i = 0; i < 3; i++)
    await db.query(
      `INSERT INTO events (episode_id, kind, detail, created_at) VALUES (NULL, 'long_topic_skipped', $1, $2)`,
      [
        JSON.stringify({
          reason:
            "The explicit 100% poll winner is missing from the shortlist.",
          // Two ticks on the Monday slot, one on the Thursday slot: two slots.
          slot_at:
            i < 2 ? "2026-11-16T19:00:00.000Z" : "2026-11-19T19:00:00.000Z",
        }),
        day(16, 8 + i),
      ],
    );
  return db;
}

test("a week without long videos warns once with the plan, the drought, the last attempts and the causes counted", async () => {
  const db = await seed();
  const cfg = testConfig(await tmpDir(), plan as never);
  const m = await outputAudit(db, cfg, now);
  const text = m?.content ?? "";
  assert.match(text, /Output audit, last 7 days/);
  assert.match(text, /news 14\/14/);
  assert.match(text, /why 2\/2/);
  assert.match(text, /Under half the plan:\n• longform: 0 of 3 went public/);
  assert.doesNotMatch(text, /• news:/, "news met its plan");
  assert.match(
    text,
    /Long videos: none since "Every Resident Evil Game Ranked" on 10 Nov \(12 days\); the alarm is at 7 days/,
  );
  assert.match(
    text,
    /"GTA 6 Map Explained: Leonida" \(18 Nov\): documentary chapter 7 refused after widening/,
  );
  assert.match(
    text,
    /• 2x documentary chapter # refused after widening its sources \[documentary, longform\]/,
  );
  assert.match(text, /• 1x render failed/);
  assert.match(
    text,
    /• 2x long ranking topic picker chose nothing \(latest: The explicit 100% poll winner/,
  );
  assert.ok(text.length <= 1990);
  assert.equal(
    await outputAudit(db, { ...cfg, outputAudit: false }, now),
    undefined,
    "OUTPUT_AUDIT off",
  );
  await db.close();
});

test("with long videos switched off there is no drought alarm", async () => {
  const db = await seed();
  const cfg = testConfig(await tmpDir(), {
    ...plan,
    longformEnabled: false,
  } as never);
  assert.equal(await outputAudit(db, cfg, now), undefined);
  await db.close();
});

test("the long-video alarm alone fires after LONG_DROUGHT_DAYS, and a long video yesterday quietens it", () => {
  const input = {
    planned: new Map([["news", 14]]),
    published: new Map([["news", 14]]),
    failures: [],
    skips: [],
    lastLong: {
      title: "Every Resident Evil Game Ranked",
      at: new Date("2026-11-13T19:00:00Z"),
    },
    longAttempts: [],
    droughtDays: 7,
    longPlanned: true,
    timeZone: "Europe/London",
  };
  const text = auditMessage(input, now) ?? "";
  assert.doesNotMatch(text, /Under half the plan/);
  assert.match(
    text,
    /Long videos: none since "Every Resident Evil Game Ranked" on 13 Nov \(9 days\)/,
  );
  assert.match(text, /No long attempt in that time/);
  assert.equal(
    auditMessage(
      {
        ...input,
        lastLong: {
          title: "Every Halo Game",
          at: new Date("2026-11-21T19:00:00Z"),
        },
      },
      now,
    ),
    undefined,
  );
});
