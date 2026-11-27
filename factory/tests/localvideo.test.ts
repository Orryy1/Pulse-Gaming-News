import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  JUMPY_YDIF,
  LOCALVIDEO_PROVENANCE,
  MOTION_NEGATIVE,
  STILL_YDIF,
  VIDEO_FRAMES,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  animate,
  createLocalVideoRun,
  isLocalVideo,
  judgeMotion,
  localVideoNotice,
  localVideoWorkflow,
  localvideoFor,
  localvideoVerdict,
  measureClip,
  measureOf,
  motionOf,
  motionPrompt,
  pickForVideo,
  videoSeed,
  type LocalVideoItem,
  type LocalVideoClip,
  type MotionMeasure,
} from "../src/assets/localvideo.ts";
import { placeholderPng, sketchSeed } from "../src/assets/illustrate.ts";
import {
  MIN_RATE,
  clipTiming,
  printTilt,
  pushScale,
  treatmentFor,
} from "../src/render/components/localvideo/plan.ts";
import { FFPROBE } from "../src/lib/bin.ts";
import { tmpDir } from "./helpers.ts";

const run = promisify(execFile);
const ch = { game: "Grand Theft Auto: Vice City", year: 2002 };
const bare = (show: string, extra: Record<string, unknown> = {}) => ({
  show,
  person: "",
  broll: "",
  graphic: { kind: "none" },
  ...extra,
});

test("lines with movement in a sketchable scene are taken; still scenes, named people and sensitive lines are not", () => {
  const boxes = localvideoFor(
    "By the spring the whole team had packed the office into boxes and moved across town.",
    bare("Developers carrying boxes out of the old office"),
    ch,
  );
  assert.ok(boxes);
  assert.equal(boxes.family, "carrying and shipping");
  assert.equal(boxes.needs, "sketch");
  assert.equal(boxes.tag, "ILLUSTRATION");
  assert.ok(boxes.confidence >= 0.7, `confidence ${boxes.confidence}`);
  assert.match(boxes.reason, /shot note/);

  const desks = localvideoFor(
    "For months the artists worked late nights to finish the city before the deadline.",
    bare("Team crunching at their desks at night in the studio"),
    ch,
  );
  assert.equal(desks?.family, "late nights at the desks");

  // A still scene: the sketch's own animated treatments serve it.
  const still = localvideoVerdict(
    "The studio was a modest building on the edge of the city centre.",
    bare("Exterior of the studio building"),
    ch,
  );
  assert.equal(still.take, false);
  assert.match((still as { reason: string }).reason, /still scene/);

  // The sketch rules come first: a named person, a sensitive subject, the game itself.
  for (const [s, show] of [
    [
      "Sam Houser drove to the office every morning that winter.",
      "Sam Houser at his desk",
    ],
    [
      "The lawsuit dragged the team into court for months of meetings.",
      "Team in a meeting",
    ],
    [
      "The team drove through Miami filming streets for the game's city.",
      "Gameplay footage of Ocean Drive",
    ],
  ] as const) {
    const v = localvideoVerdict(s, bare(show), ch);
    assert.equal(v.take, false, s);
    assert.match((v as { reason: string }).reason, /sketch rules/);
  }
  assert.equal(
    localvideoVerdict(
      "The team moved offices.",
      bare("Team carrying boxes"),
      ch,
      true,
    ).take,
    false,
  );
});

test("movement in the shot note outranks movement only in the sentence; short lines rank lower", () => {
  const fromShow = motionOf(
    "They met the publisher.",
    "Team drove to the publisher's office",
  );
  assert.equal(fromShow?.from, "show");
  assert.equal(fromShow?.family, "journey by road or rail");
  const fromSentence = localvideoFor(
    "That autumn the founders drove down to London to meet the people who would publish it.",
    bare("The founders in a small office"),
    ch,
  );
  assert.equal(fromSentence?.confidence, 0.55);
  const shortShow = localvideoFor(
    "Then the team moved offices again.",
    bare("Team carrying boxes in the office"),
    ch,
  );
  assert.equal(shortShow?.confidence, 0.65);
  // In the sentence alone only strong words count: "worked" is the story's (Vice City, entry 1 #29), and a
  // recording booth is not a crowd (entry 1 #25).
  assert.equal(
    localvideoFor(
      "Once the team worked inside it, they realized a real model gave them more to say.",
      bare("Team studying real New York"),
      ch,
    ),
    undefined,
  );
  assert.equal(
    localvideoFor(
      "Even the voice work was hard to count.",
      bare("Recording booth with voice actor"),
      ch,
    ),
    undefined,
  );
  assert.equal(
    motionOf("The whole team worked late nights that summer.", "the studio")
      ?.family,
    "late nights at the desks",
  );
  // A line the graphics pass gave a graphic is covered.
  assert.equal(
    localvideoVerdict(
      "For months the artists worked late nights to finish the city.",
      bare("Team crunching at desks", { graphic: { kind: "years" } }),
      ch,
    ).take,
    false,
  );
  // A short line whose movement is only in the sentence falls under the bar.
  const v = localvideoVerdict(
    "So the team drove to work.",
    bare("The team in the office"),
    ch,
  );
  assert.equal(v.take, false);
});

test("the motion prompt is the scene, the movement and the fixed sketch style; the negative bars text and faces", () => {
  const { prompt, negative } = motionPrompt(
    "And the team packed everything into boxes.",
    ch,
    "Developers carrying boxes out of the old office",
    "people carry boxes across the room",
  );
  assert.match(
    prompt,
    /^A concept sketch of a scene: Developers carrying boxes out of the old office\. The moment: The team packed everything into boxes\. Around 2002\. People carry boxes/,
  );
  assert.match(prompt, /cream paper/);
  assert.match(prompt, /No new objects, no text/);
  assert.equal(negative, MOTION_NEGATIVE);
  assert.match(negative, /recognisable face/);
  assert.match(negative, /logo/);
  assert.match(negative, /flicker/);
  assert.doesNotMatch(prompt + negative, /—/);
});

test("clip seeds are deterministic and not the sketch's own", () => {
  const s = "The team packed the office into boxes.";
  assert.equal(videoSeed("ep_1", s), videoSeed("ep_1", s));
  assert.notEqual(videoSeed("ep_1", s), sketchSeed("ep_1", s));
  assert.notEqual(videoSeed("ep_1", s), videoSeed("ep_2", s));
  assert.ok(videoSeed("ep_1", s) >= 0);
});

test("the workflow gets only its five documented inputs substituted", async () => {
  const raw = JSON.parse(
    await fs.readFile(
      new URL("../src/assets/localvideo.workflow.json", import.meta.url),
      "utf8",
    ),
  );
  delete raw._comment;
  const wf = await localVideoWorkflow(
    "pulse/sketch.png",
    "PROMPT X",
    "NEG Y",
    42,
    "pulse/test",
  );
  assert.equal(wf["1"]!.inputs.image, "pulse/sketch.png");
  assert.equal(wf["6"]!.inputs.text, "PROMPT X");
  assert.equal(wf["7"]!.inputs.text, "NEG Y");
  assert.equal(wf["9"]!.inputs.seed, 42);
  assert.equal(wf["12"]!.inputs.filename_prefix, "pulse/test");
  for (const [id, n] of [
    ["1", "image"],
    ["6", "text"],
    ["7", "text"],
    ["9", "seed"],
    ["12", "filename_prefix"],
  ] as const)
    raw[id].inputs[n] = (wf[id]!.inputs as Record<string, unknown>)[n];
  assert.deepEqual(wf, raw);
  // The model files are the ones on this PC, the size and length the proven run used.
  assert.equal(wf["3"]!.inputs.unet_name, "wan2.2_ti2v_5B_fp16.safetensors");
  assert.equal(wf["8"]!.inputs.width, VIDEO_WIDTH);
  assert.equal(wf["8"]!.inputs.height, VIDEO_HEIGHT);
  assert.equal(wf["8"]!.inputs.length, VIDEO_FRAMES);
  assert.equal((VIDEO_FRAMES - 1) % 4, 0);
});

/** A ComfyUI stand-in: upload, prompt, history (done after `ready` polls, or never), view. */
function fakeComfy(opts: { ready?: number; fail?: boolean } = {}) {
  const seen: Array<{ method: string; url: string; body: string }> = [];
  let polls = 0;
  const server = http.createServer(async (rq, rs) => {
    const chunks: Buffer[] = [];
    for await (const c of rq) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("latin1");
    seen.push({ method: rq.method!, url: rq.url!, body });
    const json = (o: unknown) => {
      rs.setHeader("content-type", "application/json");
      rs.end(JSON.stringify(o));
    };
    if (rq.url === "/upload/image")
      return json({ name: "up.png", subfolder: "pulse", type: "input" });
    if (rq.url === "/prompt") return json({ prompt_id: "pid-1" });
    if (rq.url?.startsWith("/history/")) {
      polls++;
      if (opts.fail)
        return json({
          "pid-1": { status: { status_str: "error", messages: ["oom"] } },
        });
      if (opts.ready === undefined || polls < opts.ready) return json({});
      return json({
        "pid-1": {
          outputs: {
            "12": {
              images: [
                {
                  filename: "localvideo_00001_.mp4",
                  subfolder: "pulse",
                  type: "output",
                },
              ],
              animated: [true],
            },
          },
          status: { status_str: "success" },
        },
      });
    }
    if (rq.url?.startsWith("/view?")) return rs.end(Buffer.from("MP4DATA"));
    rs.statusCode = 200;
    rs.end("{}");
  });
  return new Promise<{
    url: string;
    seen: typeof seen;
    close: () => Promise<void>;
  }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

test("the client uploads the sketch, queues the workflow with it, waits and downloads the saved video", async () => {
  const dir = await tmpDir();
  const img = path.join(dir, "sketch.png");
  await fs.writeFile(img, placeholderPng(3, 64, 36));
  const comfy = await fakeComfy({ ready: 1 });
  try {
    const dest = path.join(dir, "out", "localvideo_4.mp4");
    const out = await animate(img, "PROMPT", {
      dest,
      seed: 7,
      url: comfy.url,
      timeoutMs: 20_000,
    });
    assert.equal(out, dest);
    assert.equal(await fs.readFile(dest, "utf8"), "MP4DATA");
    const upload = comfy.seen.find((s) => s.url === "/upload/image")!;
    assert.match(upload.body, /name="image"; filename="localvideo_4_7\.png"/);
    assert.match(upload.body, /name="subfolder"\r\n\r\npulse/);
    const queued = JSON.parse(
      comfy.seen.find((s) => s.url === "/prompt")!.body,
    );
    assert.equal(queued.prompt["1"].inputs.image, "pulse/up.png");
    assert.equal(queued.prompt["6"].inputs.text, "PROMPT");
    assert.equal(queued.prompt["9"].inputs.seed, 7);
    const view = comfy.seen.find((s) => s.url.startsWith("/view?"))!;
    assert.match(view.url, /filename=localvideo_00001_\.mp4/);
  } finally {
    await comfy.close();
  }
});

test("a job past the timeout is dropped and interrupted by its own id only; a failed job throws", async () => {
  const dir = await tmpDir();
  const img = path.join(dir, "sketch.png");
  await fs.writeFile(img, placeholderPng(3, 64, 36));
  const slow = await fakeComfy();
  try {
    await assert.rejects(
      animate(img, "P", {
        dest: path.join(dir, "a.mp4"),
        seed: 1,
        url: slow.url,
        timeoutMs: 1500,
      }),
      /took longer than 2s/,
    );
    const del = slow.seen.find((s) => s.url === "/queue")!;
    assert.deepEqual(JSON.parse(del.body), { delete: ["pid-1"] });
    const intr = slow.seen.find((s) => s.url === "/interrupt")!;
    assert.deepEqual(JSON.parse(intr.body), { prompt_id: "pid-1" });
  } finally {
    await slow.close();
  }
  const bad = await fakeComfy({ fail: true });
  try {
    await assert.rejects(
      animate(img, "P", {
        dest: path.join(dir, "b.mp4"),
        seed: 1,
        url: bad.url,
        timeoutMs: 20_000,
      }),
      /comfyui job failed: \["oom"\]/,
    );
  } finally {
    await bad.close();
  }
});

test("the stub makes a real clip of the model's size and length that the measurement passes", async () => {
  const dir = await tmpDir();
  const img = path.join(dir, "sketch.png");
  await fs.writeFile(img, placeholderPng(11));
  const dest = path.join(dir, "clip", "localvideo_2.mp4");
  await animate(img, "P", { dest, seed: 1, stub: true });
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-count_frames",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,nb_read_frames",
    "-of",
    "csv=p=0",
    dest,
  ]);
  assert.equal(stdout.trim(), `${VIDEO_WIDTH},${VIDEO_HEIGHT},${VIDEO_FRAMES}`);
  const m = await measureClip(dest);
  assert.equal(m.frames, VIDEO_FRAMES);
  assert.ok(judgeMotion(m).ok, JSON.stringify(m));
});

test("the measurement drops a clip that barely moves, jumps or is short", () => {
  const steady = measureOf(
    Array.from({ length: 80 }, (_, i) => 1 + (i % 3) * 0.5),
  );
  assert.equal(steady.frames, 81);
  assert.equal(steady.seconds, 5.06);
  assert.equal(judgeMotion(steady).ok, true);
  const frozen = measureOf(Array.from({ length: 80 }, () => STILL_YDIF / 2));
  assert.match(judgeMotion(frozen).reason, /barely moves/);
  const jumpy = measureOf(
    Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? 0.5 : JUMPY_YDIF + 5)),
  );
  assert.match(judgeMotion(jumpy).reason, /jumps or flickers/);
  const short = measureOf(Array.from({ length: 30 }, () => 2));
  assert.match(judgeMotion(short).reason, /long/);
});

const item = (
  entry: number,
  moment: number,
  sentence: string,
  show: string,
): LocalVideoItem => ({
  entry,
  moment,
  sentence,
  shot: bare(show),
  chapter: ch,
  sketch: `entry_${entry}/fill/sketch_${moment}.png`,
});

const ITEMS = [
  item(
    0,
    1,
    "The studio was a modest building on the edge of the city centre.",
    "Exterior of the studio building",
  ),
  item(
    0,
    3,
    "That autumn the founders drove down to London to meet the people who would publish it.",
    "The founders in a small office",
  ),
  item(
    0,
    5,
    "By the spring the whole team had packed the office into boxes and moved across town.",
    "Developers carrying boxes out of the old office",
  ),
  item(
    1,
    2,
    "For months the artists worked late nights to finish the city before the deadline.",
    "Team crunching at their desks at night in the studio",
  ),
];

test("the pick is by confidence then order, within the cap", () => {
  const picked = pickForVideo(ITEMS, 2);
  assert.deepEqual(
    picked.map((p) => `${p.entry}:${p.moment}`),
    ["0:5", "1:2"],
  );
  assert.equal(pickForVideo(ITEMS, 0).length, 0);
  assert.equal(pickForVideo(ITEMS, 9).length, 3); // the still building is never picked
});

test("the run holds the cap across chapters, takes one GPU turn per batch, gates by measurement and pins clip records", async () => {
  const dir = await tmpDir();
  const made: string[] = [];
  const leases: Array<{ job: string; est: number; released: boolean }> = [];
  const measures: Record<string, MotionMeasure> = {
    "localvideo_5.mp4": measureOf(Array.from({ length: 80 }, () => 1.5)),
    "localvideo_2.mp4": measureOf(Array.from({ length: 80 }, () => 0.05)), // barely moves
  };
  const r = createLocalVideoRun({
    dir,
    episodeId: "ep_t",
    url: "http://x",
    max: 2,
    stub: false,
    timeoutMs: 1000,
    lease: async (job, est) => {
      const l = { job, est, released: false };
      leases.push(l);
      return () => {
        l.released = true;
      };
    },
    animate: async (image, prompt, o) => {
      assert.match(image, /sketch_\d+\.png$/);
      assert.match(prompt, /concept sketch/);
      made.push(o.dest);
      if (path.basename(o.dest) === "localvideo_3.mp4")
        throw new Error("comfyui down");
      return o.dest;
    },
    measure: async (f) => measures[path.basename(f)]!,
  });
  const clips: LocalVideoClip[] = [];
  assert.equal(await r.animateAll(ITEMS.slice(2, 3), clips), 1);
  assert.equal(await r.animateAll(ITEMS, clips), 0); // one left under the cap: 1:2, which barely moves
  assert.equal(await r.animateAll(ITEMS, clips), 0); // the cap is spent: no turn taken
  assert.equal(made.length, 2);
  assert.deepEqual(
    leases.map((l) => [l.est, l.released]),
    [
      [3, true],
      [3, true],
    ],
  );
  assert.equal(clips.length, 1);
  const c = clips[0]!;
  assert.equal(c.file, path.join("entry_0", "fill", "localvideo_5.mp4"));
  assert.equal(c.beatIndex, 0);
  assert.equal(c.moment, 5);
  assert.equal(c.provenance, LOCALVIDEO_PROVENANCE);
  assert.equal(c.durationSeconds, 5.06);
  assert.equal(c.audio, false);
  assert.ok(isLocalVideo(c));
  assert.equal(isLocalVideo({ file: "entry_0\\fill\\clip_2.mp4" }), false);
  assert.equal(isLocalVideo({ file: "entry_0\\fill\\localvideo_2.mp4" }), true);
  const sum = r.summary();
  assert.deepEqual(
    { ...sum, seconds: 0 },
    { asked: 2, made: 2, kept: 1, dropped: 1, failed: 0, seconds: 0 },
  );

  // A failed clip is counted and the turn still released.
  const r2 = createLocalVideoRun({
    dir,
    episodeId: "ep_t",
    url: "http://x",
    max: 5,
    stub: false,
    timeoutMs: 1000,
    lease: async () => () => leases.push({ job: "x", est: 0, released: true }),
    animate: async () => {
      throw new Error("comfyui down");
    },
    measure: async () => measureOf([]),
  });
  assert.equal(await r2.animateAll(ITEMS, []), 0);
  assert.equal(r2.summary().failed, 3);
  assert.equal(leases.length, 3);
});

test("without a GPU turn nothing is made, and the stub never asks for one", async () => {
  const dir = await tmpDir();
  let made = 0;
  const r = createLocalVideoRun({
    dir,
    episodeId: "e",
    url: "http://x",
    max: 5,
    stub: false,
    timeoutMs: 1000,
    lease: async () => {
      throw new Error("orchestrator: no turn within 60 min");
    },
    animate: async (_i, _p, o) => {
      made++;
      return o.dest;
    },
    measure: async () => measureOf(Array.from({ length: 80 }, () => 1)),
  });
  assert.equal(await r.animateAll(ITEMS, []), 0);
  assert.equal(made, 0);
  assert.equal(r.summary().asked, 0);
  let asked = 0;
  const stub = createLocalVideoRun({
    dir,
    episodeId: "e",
    url: "http://x",
    max: 1,
    stub: true,
    timeoutMs: 1000,
    lease: async () => {
      asked++;
      return () => {};
    },
    animate: async (_i, _p, o) => o.dest,
    measure: async () => measureOf(Array.from({ length: 80 }, () => 1)),
  });
  assert.equal(await stub.animateAll(ITEMS, []), 1);
  assert.equal(asked, 0);
});

test("the owner's notice is plain English, names the setting and is empty when nothing was tried", () => {
  assert.equal(
    localVideoNotice("Vice City", {
      asked: 0,
      made: 0,
      kept: 0,
      dropped: 0,
      failed: 0,
      seconds: 0,
    }),
    "",
  );
  const n = localVideoNotice("Vice City", {
    asked: 3,
    made: 3,
    kept: 2,
    dropped: 1,
    failed: 0,
    seconds: 480,
  });
  assert.match(n, /2 concept sketches brought to life/);
  assert.match(n, /ILLUSTRATION/);
  assert.match(n, /ILLUSTRATE_VIDEO_ENABLED/);
  assert.doesNotMatch(n, /—|–/);
});

test("the shot plan slows a clip into a longer shot, never below 0.6x, then holds; a short shot cuts it", () => {
  // 81 frames at 16 fps is 151 frames at 30.
  const exact = clipTiming(150, 30, 81 / 16);
  assert.equal(exact.rate, 1);
  assert.equal(exact.playFrames, 150);
  assert.equal(exact.holds, false);
  const longer = clipTiming(200, 30, 81 / 16);
  assert.equal(longer.rate, 0.755);
  assert.equal(longer.playFrames, 199); // the clip's very last frame held for one frame
  const much = clipTiming(600, 30, 81 / 16);
  assert.equal(much.rate, MIN_RATE);
  assert.equal(much.playFrames, Math.floor(151 / MIN_RATE) - 1);
  assert.equal(much.holds, true);
  const short = clipTiming(60, 30, 81 / 16);
  assert.equal(short.rate, 1);
  assert.equal(short.holds, false);
  assert.equal(treatmentFor("sketch"), "print");
  assert.equal(treatmentFor("screenshot"), "bleed");
  assert.notEqual(Math.sign(printTilt(1)), Math.sign(printTilt(2)));
  assert.ok(Math.abs(printTilt(7)) <= 1.4);
  assert.equal(pushScale(0, 100), 1);
  assert.equal(pushScale(100, 100), 1.035);
});
