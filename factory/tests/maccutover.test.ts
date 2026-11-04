// The full move to the Mac (4 Nov 2026): what a Mac factory reads and serves differently, and what the kit promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lanRequestAllowed, macReservationsDoc } from "../src/pcschedule.ts";
import { creditAlertDue, creditWarning } from "../src/voice/creditalert.ts";
import { audioFilterScriptArgs, ffmpegMajor } from "../src/lib/bin.ts";
import { missingFilters } from "../src/doctor.ts";
import {
  relocateJson,
  relocateString,
  toMacRules,
  toPcRules,
} from "../src/tools/relocate-paths.ts";
import { vodsToClear } from "../src/macgameplay.ts";
import { defaultCodexRunnerDir } from "../src/platform.ts";
import { codexRunnerPresent } from "../src/editorial/codex.ts";

const BS = String.fromCharCode(92);
const MAC_DATA = "/Users/MORR/PulseFactory/factory/data";
const HOME = "/Users/MORR";

test("reservations: empty in normal running, fresh, and only windows set by agreement", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const quiet = macReservationsDoc({ keepFreeWindows: "" }, now);
  assert.deepEqual(quiet.windows, []);
  assert.equal(quiet.project, "pulse");
  assert.equal(quiet.class, "heavy");
  assert.equal(quiet.updated, now.getTime() / 1000);
  const launch = macReservationsDoc(
    {
      keepFreeWindows:
        "gta launch|2026-11-18T10:00:00Z|2026-11-19T03:00:00Z;gta launch|2026-11-20T10:00:00Z|2026-11-21T01:00:00Z",
    },
    now,
  );
  // Within the 48 hours the file has always looked ahead; the far one comes later.
  assert.equal(launch.windows.length, 1);
  assert.equal(launch.windows[0]!.from, "2026-11-18T10:00:00.000Z");
});

test("the network reaches only the reservations page; this machine and the tunnel reach everything", () => {
  assert.equal(
    lanRequestAllowed("192.168.0.93", "/orch/reservations.json"),
    true,
  );
  assert.equal(lanRequestAllowed("192.168.0.93", "/admin/qa-notes"), false);
  assert.equal(lanRequestAllowed("192.168.0.93", "/routine/abtest"), false);
  assert.equal(lanRequestAllowed("192.168.0.93", "/health"), false);
  assert.equal(lanRequestAllowed("127.0.0.1", "/admin/qa-notes"), true);
  assert.equal(lanRequestAllowed("::ffff:127.0.0.1", "/health"), true);
  assert.equal(lanRequestAllowed("::1", "/health"), true);
});

test("ffmpeg 9 lost -filter_script: the argument follows the version", () => {
  assert.equal(ffmpegMajor("ffmpeg version 9.0.2 Copyright"), 9);
  assert.equal(ffmpegMajor("ffmpeg version 6.1.1-essentials_build-www"), 6);
  assert.equal(ffmpegMajor("something else"), 0);
  assert.deepEqual(audioFilterScriptArgs("f.txt", 6), [
    "-filter_script:a",
    "f.txt",
  ]);
  assert.deepEqual(audioFilterScriptArgs("f.txt", 9), ["-/filter:a", "f.txt"]);
  assert.deepEqual(audioFilterScriptArgs("f.txt", 0), ["-/filter:a", "f.txt"]);
});

test("nothing in the factory's own code still uses the options ffmpeg 9 removed", () => {
  const seen: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && e.name !== "bin.ts") {
        const t = fs.readFileSync(p, "utf8");
        if (/"-vsync"|"-filter_script|"-filter_complex_script"/.test(t))
          seen.push(p);
      }
    }
  };
  walk("src");
  assert.deepEqual(seen, []);
});

test("the doctor names the filters a slim ffmpeg lacks", () => {
  const full = [
    " .. zscale  V->V x",
    " .S tonemap V->V x",
    " .. rubberband A->A x",
    " .. loudnorm A->A x",
  ].join("\n");
  assert.deepEqual(missingFilters(full), []);
  assert.deepEqual(missingFilters(" .. loudnorm A->A x\n .S tonemap V->V x"), [
    "zscale",
    "rubberband",
  ]);
});

test("the credit warning: early, on either test, and once a day", () => {
  const base = {
    left: 500_000,
    resetAt: new Date("2026-11-20T00:00:00Z"),
    daysLeft: 15,
    pacePerDay: 10_000,
    wasteAtReset: 0,
    surplusPerDay: 0,
  };
  const o = { lowCredits: 100_000, lowDays: 5, reserve: 10_000 };
  assert.equal(creditWarning(base, o), undefined);
  assert.match(
    creditWarning({ ...base, left: 90_000 }, o)!,
    /running low: 80,000/,
  );
  // Plenty by the first test, but under five days of pace with the reset further off.
  const fast = { ...base, left: 210_000, pacePerDay: 60_000 };
  assert.match(creditWarning(fast, o)!, /about 3 days/);
  // The reset comes first: no need to worry.
  assert.equal(creditWarning({ ...fast, daysLeft: 2 }, o), undefined);
  assert.equal(
    creditWarning(
      { ...base, left: 90_000 },
      { ...o, lowCredits: 0, lowDays: 0 },
    ),
    undefined,
  );
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "credit-")),
    "a",
    "s.json",
  );
  const low = { ...base, left: 90_000 };
  assert.ok(creditAlertDue(low, o, file, "2026-11-05"));
  assert.equal(creditAlertDue(low, o, file, "2026-11-05"), undefined);
  assert.ok(creditAlertDue(low, o, file, "2026-11-06"));
  assert.equal(creditAlertDue(undefined, o, file, "2026-11-07"), undefined);
});

test("stored Windows paths: relative ones become forward slashes, data and Videos move, words stay", () => {
  const rules = toMacRules(MAC_DATA, HOME);
  assert.equal(
    relocateString(`assets${BS}clip_0.mp4`, rules),
    "assets/clip_0.mp4",
  );
  assert.equal(
    relocateString(`entry_8${BS}assets${BS}a.jpg`, rules),
    "entry_8/assets/a.jpg",
  );
  assert.equal(
    relocateString(
      `C:${BS}PulseFactory${BS}factory${BS}data${BS}episodes${BS}ep_1${BS}thumb_hero.jpg`,
      rules,
    ),
    `${MAC_DATA}/episodes/ep_1/thumb_hero.jpg`,
  );
  assert.equal(
    relocateString(
      `C:${BS}Users${BS}MORR${BS}Videos${BS}Pulse Gameplay${BS}inbox${BS}x`,
      rules,
    ),
    `${HOME}/Videos/Pulse Gameplay/inbox/x`,
  );
  for (const same of [
    "a sentence with a back\\slash in it",
    "https://store.steampowered.com/app/1",
    "voice.mp3",
    `D:${BS}somewhere${BS}else.mp4`,
  ])
    assert.equal(relocateString(same, rules), same);
  const j = relocateJson(
    { clips: [{ file: `assets${BS}c.mp4`, luma: 1 }], audio: "voice.mp3" },
    rules,
  );
  assert.equal(j.changed, 1);
  assert.deepEqual(j.value, {
    clips: [{ file: "assets/c.mp4", luma: 1 }],
    audio: "voice.mp3",
  });
});

test("and back: the Mac's absolute paths return to the PC's on a rollback", () => {
  const rules = toPcRules(MAC_DATA, HOME);
  assert.equal(
    relocateString(`${MAC_DATA}/episodes/ep_1/thumb.jpg`, rules),
    "C:/PulseFactory/factory/data/episodes/ep_1/thumb.jpg",
  );
  assert.equal(
    relocateString(`${HOME}/Videos/x.mp4`, rules),
    "C:/Users/MORR/Videos/x.mp4",
  );
  assert.equal(relocateString("assets/clip_0.mp4", rules), "assets/clip_0.mp4");
});

test("VODs on the Mac: never before scoring, after their days, or oldest first when the disk is short", () => {
  const day = 86_400_000;
  const now = 100 * day;
  const vods = [
    { name: "old-scored", mtimeMs: now - 9 * day, bytes: 10e9 },
    { name: "old-unscored", mtimeMs: now - 9 * day, bytes: 10e9 },
    { name: "new-scored", mtimeMs: now - day, bytes: 10e9 },
  ];
  const scored = new Set(["old-scored", "new-scored"]);
  assert.deepEqual(
    vodsToClear(vods, scored, {
      now,
      keepDays: 7,
      freeBytes: 100e9,
      floorGb: 55,
    }),
    ["old-scored"],
  );
  assert.deepEqual(
    vodsToClear(vods, scored, {
      now,
      keepDays: 30,
      freeBytes: 40e9,
      floorGb: 55,
    }),
    ["old-scored", "new-scored"],
  );
});

test("the Mac's Codex helper ships with the code, for macOS's own Python, and needs no timeout command", () => {
  assert.equal(
    defaultCodexRunnerDir("darwin", HOME),
    `${HOME}/PulseFactory/factory/mac/codex`,
  );
  assert.equal(codexRunnerPresent(path.join("mac", "codex")), true);
  const py = fs.readFileSync(
    path.join("mac", "codex", "codex_runner.py"),
    "utf8",
  );
  assert.ok(!/["']timeout["']\s*,/.test(py));
  assert.ok(
    !/orch/.test(
      py
        .split("\n")
        .filter((l) => /^(from|import) /.test(l))
        .join("\n"),
    ),
  );
  assert.match(py, /--ephemeral/);
  assert.match(py, /read-only/);
});

test("migrate.sh turns the PC-to-Mac settings off and refuses without its preflight", () => {
  const sh = fs.readFileSync(path.join("mac", "migrate.sh"), "utf8");
  for (const k of [
    "MAC_RENDER_SHORTS=false",
    "MAC_ASR=false",
    "MAC_FOOTAGE_GATHER=false",
    "MAC_STILLS=false",
    "MAC_GAMEPLAY=false",
    "HOST=0.0.0.0",
  ])
    assert.ok(sh.includes(k), k);
  assert.ok(sh.includes("MAC_[A-Z_]*"));
  assert.ok(sh.includes("ROUTINE_LAN_ALLOW"));
  assert.ok(sh.includes("/opt/homebrew/opt/ffmpeg-full/bin"));
  assert.ok(sh.includes("relocate-paths.ts --write"));
  assert.ok(sh.includes("relink_ids.mts write"));
  // The relink comes after the PC stops and before the copy.
  assert.ok(
    sh.indexOf("stopping the PC side") < sh.indexOf("relink_ids.mts write"),
  );
  assert.ok(
    sh.indexOf("relink_ids.mts write") < sh.indexOf("final copy (database"),
  );
  assert.ok(
    sh.indexOf("final copy (database") <
      sh.indexOf("relocate-paths.ts --write"),
  );
});

test("the deploy hook refuses while the factory is busy, and the rollback stops the Mac before the PC starts", () => {
  const hook = fs.readFileSync(path.join("mac", "post-receive"), "utf8");
  assert.ok(
    hook.indexOf("deploy refused: $why") < hook.indexOf('mkdir -p "$SRC"'),
  );
  assert.ok(/remotion\|chrome-headless-shell/.test(hook));
  assert.ok(hook.includes("hold-restart"));
  const back = fs.readFileSync(path.join("mac", "rollback.sh"), "utf8");
  const stop = back.indexOf("launchctl bootout");
  const start = back.indexOf('//change //tn "Pulse Factory" //enable');
  assert.ok(stop > 0 && stop < start);
  assert.ok(back.includes("still running after the stop"));
});

test("a dry run leaves the owner's real inbox alone unless it asks otherwise", async () => {
  const before = {
    DRY_RUN: process.env.DRY_RUN,
    GAMEPLAY_ENABLED: process.env.GAMEPLAY_ENABLED,
  };
  const { loadConfig } = await import("../src/config.ts");
  try {
    delete process.env.GAMEPLAY_ENABLED;
    process.env.DRY_RUN = "true";
    assert.equal(loadConfig().gameplayEnabled, false);
    process.env.GAMEPLAY_ENABLED = "true";
    assert.equal(loadConfig().gameplayEnabled, true);
    delete process.env.GAMEPLAY_ENABLED;
    process.env.DRY_RUN = "false";
    assert.equal(loadConfig().gameplayEnabled, true);
  } finally {
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
