import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forecastAlert,
  forecastBackup,
  forecastCodex,
  forecastDisk,
  forecastElevenLabs,
  forecastOllama,
  forecastYouTubeQuota,
  forecastYouTubeToken,
  hoursToPacificMidnight,
  weekStart,
} from "../src/forecast.ts";
import { gatherForecasts, forecastChecks } from "../src/doctor.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";

const now = new Date("2026-11-14T12:00:00Z");

test("ElevenLabs: a balance that runs out before the reset is said days ahead, with the local voice as fallback", () => {
  const f = forecastElevenLabs(
    {
      left: 60_000,
      resetAt: new Date("2026-11-30T00:00:00Z"),
      pacePerDay: 20_000,
    },
    now,
    3,
  );
  assert.equal(f.level, "warn");
  assert.ok(Math.abs((f.daysLeft ?? 0) - 3) < 0.01);
  assert.match(f.fallback ?? "", /local voice/);
  assert.equal(
    forecastElevenLabs(
      {
        left: 900_000,
        resetAt: new Date("2026-11-20T00:00:00Z"),
        pacePerDay: 20_000,
      },
      now,
      3,
    ).level,
    "ok",
  );
  assert.equal(
    forecastElevenLabs(
      {
        left: 10_000,
        resetAt: new Date("2026-11-30T00:00:00Z"),
        pacePerDay: 20_000,
      },
      now,
      3,
    ).level,
    "urgent",
  );
});

test("YouTube quota and login", () => {
  assert.ok(
    hoursToPacificMidnight(now) > 0 && hoursToPacificMidnight(now) <= 24,
  );
  assert.equal(
    forecastYouTubeQuota({
      units: 100,
      unitLimit: 10_000,
      uploads: 2,
      uploadLimit: 100,
      now,
    }).level,
    "ok",
  );
  assert.equal(
    forecastYouTubeQuota({
      units: 10_000,
      unitLimit: 10_000,
      uploads: 2,
      uploadLimit: 100,
      now,
    }).level,
    "urgent",
  );
  // 04:00 Pacific with 5,000 units gone: the pace says the day runs out.
  assert.equal(
    forecastYouTubeQuota({
      units: 5_000,
      unitLimit: 10_000,
      uploads: 2,
      uploadLimit: 100,
      now,
    }).level,
    "warn",
  );
  const lapsing = forecastYouTubeToken({
    savedAt: new Date("2026-11-09T12:00:00Z"),
    lifetimeDays: 7,
    now,
    horizonDays: 3,
  });
  assert.equal(lapsing.level, "warn");
  assert.match(lapsing.line, /lapses in 2 days/);
  assert.equal(
    forecastYouTubeToken({
      refreshOk: false,
      refreshDetail: "refresh failed: invalid_grant",
      lifetimeDays: 0,
      now,
      horizonDays: 3,
    }).level,
    "urgent",
  );
});

test("Codex, disks, Ollama and backups", () => {
  assert.equal(weekStart(now, 1).toISOString(), "2026-11-09T00:00:00.000Z");
  // Five days in, 450 of 500 used: runs out in about half a day, well before Monday.
  const c = forecastCodex({
    calls: 450,
    failures: 0,
    budget: 500,
    now,
    resetDay: 1,
    horizonDays: 3,
  });
  assert.equal(c.level, "urgent");
  assert.equal(
    forecastCodex({
      calls: 10,
      failures: 0,
      budget: 0,
      now,
      resetDay: 1,
      horizonDays: 3,
    }).level,
    "ok",
  );
  const samples = [0, 1, 2, 3].map((d) => ({
    at: new Date(now.getTime() - (4 - d) * 86_400_000).toISOString(),
    freeGb: 60 - d * 8,
  }));
  const disk = forecastDisk({
    machine: "Mac",
    freeGb: 28,
    samples,
    floorGb: 20,
    now,
    horizonDays: 3,
  });
  assert.equal(disk.level, "urgent");
  assert.match(disk.line, /falling 8\.0 GB a day/);
  assert.equal(
    forecastDisk({
      machine: "Mac",
      freeGb: 66,
      samples: samples.map((s) => ({ ...s, freeGb: 66 })),
      floorGb: 20,
      now,
      horizonDays: 3,
    }).level,
    "ok",
  );
  assert.equal(
    forecastOllama({
      downNow: true,
      downSince: new Date(now.getTime() - 3 * 3_600_000),
      outagesLastDay: 1,
      now,
    }).level,
    "urgent",
  );
  assert.equal(
    forecastBackup({ lastAt: new Date(now.getTime() - 30 * 3_600_000), now })
      .level,
    "warn",
  );
  assert.equal(
    forecastBackup({ lastAt: new Date(now.getTime() - 8 * 3_600_000), now })
      .level,
    "ok",
  );
});

test("each dependency is said once a day per level, and clears when it recovers", () => {
  const warn = [
    {
      id: "disk_mac",
      level: "warn" as const,
      line: "Mac disk: falling",
      daysLeft: 2,
    },
  ];
  const a = forecastAlert(warn, {}, "2026-11-14");
  assert.match(a.text ?? "", /Heads-up/);
  assert.equal(
    forecastAlert(warn, a.sent, "2026-11-14").text,
    undefined,
    "said already today",
  );
  assert.match(
    forecastAlert([{ ...warn[0]!, level: "urgent" }], a.sent, "2026-11-14")
      .text ?? "",
    /Running out soon/,
  );
  const cleared = forecastAlert(
    [{ id: "disk_mac", level: "ok", line: "fine" }],
    a.sent,
    "2026-11-14",
  );
  assert.equal(cleared.sent.disk_mac, undefined);
});

test("the readers gather every forecast from the database without the network", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    forecastEnabled: true,
    codexLlm: true,
    codexWeeklyCalls: 100,
  });
  await db.query(
    `INSERT INTO events (episode_id, kind, detail, created_at) VALUES (NULL, 'backup', '{}', $1)`,
    [new Date(now.getTime() - 40 * 3_600_000)],
  );
  const fs = await gatherForecasts(db, cfg, {
    creditPlan: async () => ({
      left: 5_000,
      resetAt: new Date("2026-11-30T00:00:00Z"),
      pacePerDay: 10_000,
    }),
    visionDown: async () => true,
    freeGb: async () => 50,
    now,
  });
  const by = Object.fromEntries(fs.map((f) => [f.id, f.level]));
  assert.equal(by.elevenlabs, "urgent");
  assert.equal(by.backup, "warn");
  assert.equal(by.ollama, "warn");
  assert.equal(by.youtube_quota, "ok");
  assert.equal(fs.find((f) => f.id.startsWith("disk"))?.level, "ok");
  assert.equal(by.codex, "ok");
  assert.ok(forecastChecks(fs).every((c) => c.name.startsWith("forecast_")));
  await db.close();
});
