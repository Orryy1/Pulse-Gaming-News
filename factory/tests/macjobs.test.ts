import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstErrorLine,
  gameplayDue,
  macPath,
  renderProblems,
  roomProblem,
  skipForRender,
  sweepPlan,
} from "../src/macjobs.ts";
import { macOrLocal, shq, workerLine } from "../src/macworker.ts";
import { footageOnMac } from "../src/assets/footagemac.ts";
import { shortJob, thumbFiles } from "../src/render/macrender.ts";
import {
  allowRoutineLan,
  lanRoutineRequest,
  routineAllowed,
} from "../src/routines.ts";
import type { FootageFirstDeps } from "../src/assets/footagefirst.ts";

const stats = {
  durationSeconds: 50,
  hasAudio: true,
  width: 1080,
  height: 1920,
  lufs: -20,
  blackSeconds: 0,
  flashes: 0,
};
const want = { seconds: 50, width: 1080, height: 1920 };

test("a good Mac render passes; each fault fails it", () => {
  assert.deepEqual(renderProblems(stats, want), []);
  assert.equal(
    renderProblems({ ...stats, durationSeconds: 45 }, want).length,
    1,
  );
  assert.equal(renderProblems({ ...stats, hasAudio: false }, want).length, 1);
  assert.equal(renderProblems({ ...stats, lufs: -70 }, want).length, 1);
  assert.equal(renderProblems({ ...stats, lufs: Number.NaN }, want).length, 1);
  assert.equal(renderProblems({ ...stats, blackSeconds: 2 }, want).length, 1);
  assert.equal(renderProblems({ ...stats, flashes: 1 }, want).length, 1);
  assert.equal(renderProblems({ ...stats, width: 720 }, want).length, 1);
});

test("outputs and scratch stay home; the media travels", () => {
  for (const f of [
    "short.mp4",
    "instagram.mp4",
    "qa/frame.jpg",
    "entry_0/ff_work/src_0.mp4",
    ".mac_out/x/a.mp4",
    "assets/a.part",
  ])
    assert.equal(skipForRender(f), true, f);
  for (const f of [
    "voice.mp3",
    "assets/clip_0.mp4",
    "assets\\hero_0.jpg",
    "poster.jpg",
  ])
    assert.equal(skipForRender(f), false, f);
});

test("a PC path keeps its whole shape under the job folder", () => {
  assert.equal(
    macPath("/j", "C:\\data\\ep\\entry_1\\a.mp4"),
    "/j/C/data/ep/entry_1/a.mp4",
  );
});

test("a heavy job needs the disk floor and a quarter of the memory free", () => {
  assert.equal(roomProblem({ freeGb: 100, memFreePct: 50 }, 40), undefined);
  assert.match(roomProblem({ freeGb: 41, memFreePct: 50 }, 40, 3)!, /GB free/);
  assert.match(roomProblem({ freeGb: 100, memFreePct: 20 }, 40)!, /memory/);
});

test("the sweep takes day-old jobs, and more only while under the floor", () => {
  const now = 10 * 86_400_000;
  const jobs = [
    { name: "old", mtimeMs: now - 2 * 86_400_000, bytes: 5e9 },
    { name: "recent", mtimeMs: now - 1000, bytes: 5e9 },
  ];
  assert.deepEqual(sweepPlan(jobs, 100e9, 40, now), ["old"]);
  assert.deepEqual(sweepPlan(jobs, 30e9, 40, now), ["old", "recent"]);
});

test("the gameplay timetable: the finder hourly, the VODs once from 04:30", () => {
  const at = (hour: number, minute: number) => ({
    day: "2026-11-02",
    hour,
    minute,
  });
  assert.equal(gameplayDue({}, at(4, 0)).vods, false);
  assert.equal(gameplayDue({}, at(4, 30)).vods, true);
  assert.equal(gameplayDue({ day: "2026-11-02" }, at(9, 0)).vods, false);
  assert.equal(gameplayDue({ hour: "2026-11-02T09" }, at(9, 40)).finder, false);
  assert.equal(gameplayDue({ hour: "2026-11-02T09" }, at(10, 0)).finder, true);
});

test("remote words: job folders under $HOME stay expandable, others are quoted", () => {
  assert.equal(shq("$HOME/a b"), '"$HOME/a b"');
  assert.equal(shq("it's"), `'it'\\''s'`);
  const line = workerLine({ minFreeGb: 40, waitMinutes: 10 }, ["short", "/x"]);
  assert.match(line, /MAC_MIN_FREE_GB=40/);
  assert.match(line, /mac\/worker\.mts 'short' '\/x'/);
});

test("the Mac failing means the PC does the job and the owner hears, once", async () => {
  const told: string[] = [];
  const f = macOrLocal(
    "a test job",
    async (x: number) => {
      throw new Error(`no Mac ${x}`);
    },
    async (x: number) => x * 2,
    (m) => told.push(m),
  );
  assert.equal(await f(2), 4);
  assert.equal(await f(3), 6);
  assert.equal(told.length, 1);
  assert.match(told[0]!, /to the PC instead/);
  const ok = macOrLocal(
    "another job",
    async () => "mac",
    async () => "pc",
    () => assert.fail("no notice when the Mac did it"),
  );
  assert.equal(await ok(), "mac");
});

test("a Short's job carries no PC paths and the Mac's own settings", () => {
  const job = shortJob(
    {
      episodeDir: "C:/ep",
      outFile: "C:/ep/render_raw.mp4",
      posterFile: "C:/ep/poster.jpg",
      thumbFile: "C:/ep/thumb_short.jpg",
      concurrency: 2,
      gl: "swangle",
      browserExecutable: "C:/chrome.exe",
      props: { durationSeconds: 48 } as never,
    },
    6,
  );
  assert.equal(job.outName, "render_raw.mp4");
  assert.equal(job.input.concurrency, 6);
  assert.equal(job.input.gl, "angle");
  assert.equal(job.want.seconds, 48);
  assert.ok(!JSON.stringify(job).includes("C:/"));
});

test("thumbnails ship each picture they name once", () => {
  const thumb = {
    imageFile: "a.jpg",
    image2File: null,
    fgFile: "b.png",
    pictureFiles: ["a.jpg", "c\\d.jpg"],
  };
  assert.deepEqual(thumbFiles([{ file: "x", thumb: thumb as never }]), [
    "a.jpg",
    "b.png",
    "c/d.jpg",
  ]);
});

test("footage routing: work follows the file; the looks never leave the PC", async () => {
  const calls: string[] = [];
  const local = {
    search: async () => (calls.push("local search"), []),
    frames: async () => (calls.push("local frames"), []),
    look: async () => (calls.push("look"), []),
    cut: async () => (calls.push("local cut"), 3),
    compose: async () => undefined,
    ocr: async () => new Map(),
  } as unknown as FootageFirstDeps;
  let up = true;
  const here = new Set<string>();
  const d = footageOnMac(
    local,
    async (m, ...a) => {
      calls.push(`mac ${m}`);
      if (m === "frames") return [`${a[3]}_01.jpg`];
      if (m === "ocr")
        return [["/j/f.jpg", { width: 1, height: 1, words: [] }]];
      return [];
    },
    (f) => `/j/${f}`,
    () => up,
    (f) => here.has(f),
  );
  await d.search("q");
  assert.deepEqual(await d.frames("src.mp4", 0, 3, "seg"), ["seg_01.jpg"]);
  const pages = await d.ocr(["f.jpg"]);
  assert.ok(pages.has("f.jpg"));
  await d.look(["seg.jpg"]);
  assert.deepEqual(calls, ["mac search", "mac frames", "mac ocr", "look"]);
  calls.length = 0;
  here.add("mine.mp4");
  await d.frames("mine.mp4", 0, 3, "p");
  up = false;
  await d.search("q");
  assert.deepEqual(calls, ["local frames", "local search"]);
  // After the Mac has gone, a file only it had is simply not there to work on.
});

const req = (o: {
  port: number;
  from: string;
  host: string;
  headers?: Record<string, string>;
}) =>
  ({
    socket: { localPort: o.port, remoteAddress: o.from },
    headers: { host: o.host, ...o.headers },
  }) as never;

test("the routine LAN path: listed address on its own port only, never proxied or public", () => {
  allowRoutineLan(8081, ["192.168.0.157"]);
  const good = {
    port: 8081,
    from: "::ffff:192.168.0.157",
    host: "DESKTOP-D3EI9PV.local:8081",
  };
  assert.equal(lanRoutineRequest(req(good)), true);
  assert.equal(routineAllowed(req(good)), true);
  // Another machine on the LAN; the main port; a public name; a tunnel's headers.
  assert.equal(
    lanRoutineRequest(req({ ...good, from: "192.168.0.50" })),
    false,
  );
  assert.equal(lanRoutineRequest(req({ ...good, port: 8080 })), false);
  assert.equal(
    lanRoutineRequest(req({ ...good, host: "pulsegmg.com" })),
    false,
  );
  assert.equal(
    lanRoutineRequest(req({ ...good, headers: { "cf-ray": "x" } })),
    false,
  );
  assert.equal(routineAllowed(req({ ...good, port: 8080 })), false);
  // The tunnel still fails the old rule.
  assert.equal(
    routineAllowed(
      req({ port: 8080, from: "127.0.0.1", host: "pulsegmg.com" }),
    ),
    false,
  );
  allowRoutineLan(0, []);
});

test("a failed job's log line is its first error, not the tail of the stack", () => {
  const stderr = [
    "file:///Users/MORR/PulseFactory/worker/mac/worker.mts:1",
    "Error: A delayRender() \"Loading <Img>\" was called but not cleared after 180000ms.",
    "    at bundle.js:1:1",
    "{",
    "  stackFrame: [",
    "    {",
    "      columnNumber: 39,",
    "      fileName: 'http://localhost:3000/bundle.js',",
    "      lineNumber: 107257",
    "    }",
    "  ],",
    "  frame: 267,",
    "  chunk: null",
    "}",
    "",
    "Node.js v26.13.0",
  ].join("\n");
  const line = firstErrorLine(stderr);
  assert.match(line, /^Error: A delayRender/);
  assert.match(line, /\(frame 267\)$/);
  assert.equal(firstErrorLine("no word from the Mac for 8 min\nsomething"), "no word from the Mac for 8 min");
  assert.equal(firstErrorLine(""), "");
});
