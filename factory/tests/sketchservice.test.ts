// The concept sketches on FLUX.2 klein 4B (src/assets/illustrate.ts, mac/sketch_server.py, mac/sketch.sh): the
// licence guard, the Mac sketch service's client, and the fail-safe that never lets a sketch hold up a video.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  SKETCH_FAILS_IN_A_ROW,
  SKETCH_PROVENANCE,
  createSketchRun,
  illustrate,
  placeholderPng,
  pngSize,
  sketchReachable,
} from "../src/assets/illustrate.ts";
import { tmpDir } from "./helpers.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFile(path.join(root, f), "utf8");

test("no non-commercial FLUX.1 model can draw a sketch, and the Apache 2.0 evidence is recorded", async () => {
  const wf = JSON.parse(
    await read("src/assets/illustrate.workflow.json"),
  ) as Record<
    string,
    { class_type?: string; inputs?: Record<string, unknown> }
  >;
  const files = Object.values(wf)
    .flatMap((n) => Object.entries(n.inputs ?? {}))
    .map(([, v]) => String(v))
    .filter((v) => /\.(safetensors|gguf|ckpt|pt|bin)$/i.test(v));
  assert.deepEqual(files.sort(), [
    "flux-2-klein-4b.safetensors",
    "flux2-klein-vae.safetensors",
    "qwen3-4b-flux2-klein.safetensors",
  ]);
  for (const f of files) assert.doesNotMatch(f, /flux1|flux-1|fill/i);
  assert.match(SKETCH_PROVENANCE, /FLUX\.2 klein 4B, Apache 2\.0/);
  // The service and its installer use the klein repository at the commit the licence was checked on.
  const doc = await read("docs/licences/flux2-klein-4b.md");
  const sh = await read("mac/sketch.sh");
  const server = await read("mac/sketch_server.py");
  const rev = sh.match(/^REVISION=([0-9a-f]{40})/m)?.[1];
  assert.ok(rev, "sketch.sh pins a revision");
  assert.ok(doc.includes(rev!), "the licence record names the same commit");
  assert.match(doc, /apache-2\.0/);
  assert.match(sh, /REPO=black-forest-labs\/FLUX\.2-klein-4B\b/);
  assert.match(sh, /grep -q "Apache License"/);
  assert.match(server, /LICENCE = "apache-2\.0"/);
  for (const text of [sh, server])
    assert.doesNotMatch(text, /FLUX\.1-(dev|Fill)|flux1-dev|flux1-fill/i);
});

/** A fake sketch service: answers /health and /draw as told, recording what it was sent. */
async function fakeService(
  draw: (body: Record<string, unknown>, res: http.ServerResponse) => void,
  health = 200,
): Promise<{
  url: string;
  sent: Array<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  const sent: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(health, { "content-type": "application/json" }).end("{}");
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      sent.push(body);
      draw(body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    sent,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

test("the Mac's sketch service is asked for one 1280x720 four-step sketch and its PNG is saved", async () => {
  const dir = await tmpDir();
  const svc = await fakeService((_b, res) =>
    res.writeHead(200, { "content-type": "image/png" }).end(placeholderPng(3)),
  );
  const dest = path.join(dir, "e", "s.png");
  await illustrate("a cramped office at night", {
    dest,
    seed: 77,
    url: `${svc.url}/`,
    timeoutMs: 60_000,
  });
  assert.deepEqual(svc.sent[0], {
    prompt: "a cramped office at night",
    seed: 77,
    width: 1280,
    height: 720,
    steps: 4,
    deadline_s: 55,
  });
  assert.deepEqual(pngSize(await fs.readFile(dest)), {
    width: 1280,
    height: 720,
  });
  await svc.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test("a busy, broken, wrong-sized or late answer throws and writes nothing", async () => {
  const dir = await tmpDir();
  const dest = path.join(dir, "s.png");
  const cases: Array<
    [string, (b: unknown, r: http.ServerResponse) => void, RegExp]
  > = [
    ["busy", (_b, r) => r.writeHead(409).end('{"error":"busy"}'), /409/],
    ["fails", (_b, r) => r.writeHead(500).end('{"error":"mps"}'), /500/],
    [
      "small",
      (_b, r) => r.writeHead(200).end(placeholderPng(1, 64, 64)),
      /64x64/,
    ],
    ["not a png", (_b, r) => r.writeHead(200).end("<html>"), /no PNG/],
    ["late", () => undefined, /longer than/],
  ];
  for (const [name, answer, error] of cases) {
    const svc = await fakeService(answer);
    const t0 = Date.now();
    await assert.rejects(
      illustrate("x", { dest, seed: 1, url: svc.url, timeoutMs: 400 }),
      error,
      name,
    );
    assert.ok(Date.now() - t0 < 5000, `${name} ends at the timeout`);
    await assert.rejects(fs.stat(dest), /ENOENT/, `${name} wrote no file`);
    await svc.close();
  }
  await fs.rm(dir, { recursive: true, force: true });
});

test("reachability asks the service's /health (503 while its weights cannot be read) or ComfyUI's /system_stats", async () => {
  const up = await fakeService(() => undefined, 200);
  const down = await fakeService(() => undefined, 503);
  assert.equal(await sketchReachable(up.url), true);
  assert.equal(await sketchReachable(down.url), false);
  assert.equal(await sketchReachable("http://127.0.0.1:1"), false);
  const asked: string[] = [];
  const f = async (u: string) => (asked.push(u), { ok: true });
  await sketchReachable("http://mac:8798/", "klein", 10, f);
  await sketchReachable("http://pc:8188", "comfy", 10, f);
  assert.deepEqual(asked, [
    "http://mac:8798/health",
    "http://pc:8188/system_stats",
  ]);
  await up.close();
  await down.close();
});

const bare = (show: string) => ({
  show,
  person: "",
  broll: "",
  graphic: { kind: "none" },
});
const chapter = (entry: number) => ({
  entry,
  game: "Grand Theft Auto",
  year: 1997,
  moments: [
    bare("the team's two-room office"),
    bare("the founders' new studio"),
    bare("the crew at the airport"),
    bare("the team's new office"),
    bare("developers at their desks at night"),
  ],
  sentences: [
    "The team crammed into a two-room office above a shop.",
    "The founders rented a bigger studio on the edge of town.",
    "The crew flew to the airport with a demo in a bag.",
    "The team moved offices again before the sequel shipped.",
    "Developers worked late into the night at their desks.",
  ],
});
const judgeNone = {
  structured: async () => ({ images: [], picks: [] }),
} as never;

test("a model that keeps failing is asked three times, then the video goes on without sketches", async () => {
  const dir = await tmpDir();
  let tries = 0;
  const run = createSketchRun({
    llm: judgeNone,
    dir,
    episodeId: "ep_f",
    url: "http://127.0.0.1:1",
    max: 24,
    stub: false,
    timeoutMs: 1000,
    draw: async () => {
      tries++;
      throw new Error("sketch service 500");
    },
  });
  const images: Array<{ file: string; kind: string }> = [];
  assert.equal(await run.forChapter(chapter(0), [0, 1, 2, 3, 4], images), 0);
  assert.equal(await run.forChapter(chapter(1), [0, 1, 2, 3, 4], images), 0);
  assert.equal(tries, SKETCH_FAILS_IN_A_ROW);
  assert.equal(images.length, 0, "every line keeps its normal footage");
  const sum = run.summary();
  assert.equal(sum.asked, 3);
  assert.equal(sum.failed, 3);
  assert.equal(sum.kept, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a success resets the failure count, and no sketch starts that could run past the video's budget", async () => {
  const dir = await tmpDir();
  let clock = 0;
  let n = 0;
  const run = createSketchRun({
    llm: judgeNone,
    dir,
    episodeId: "ep_b",
    url: "http://127.0.0.1:1",
    max: 24,
    stub: true,
    timeoutMs: 100_000,
    budgetMs: 450_000,
    now: () => clock,
    draw: async (prompt, o) => {
      clock += 100_000; // each sketch takes 100 s
      n++;
      if (n % 2 === 0) throw new Error("one bad sketch");
      return illustrate(prompt, { ...o, stub: true });
    },
  });
  const images: Array<{ file: string; kind: string }> = [];
  await run.forChapter(chapter(0), [0, 1, 2, 3, 4], images);
  // Started at 0, 100, 200 and 300 s (each could end by 400 s, inside 450); the fifth could not.
  assert.equal(n, 4);
  assert.equal(
    run.summary().failed,
    2,
    "failures were not in a row, so the run kept going",
  );
  assert.equal(await run.forChapter(chapter(1), [0, 1], images), 0);
  assert.equal(n, 4, "the budget holds across chapters");
  await fs.rm(dir, { recursive: true, force: true });
});

test("the settings: the Mac's service by default, ComfyUI however it is spelt, a budget, and the motion clips' own server", async () => {
  const { loadConfig } = await import("../src/config.ts");
  const keys = [
    "ILLUSTRATE_URL",
    "ILLUSTRATE_BACKEND",
    "ILLUSTRATE_BUDGET_SECONDS",
    "ILLUSTRATE_VIDEO_URL",
  ];
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    let cfg = loadConfig();
    assert.equal(cfg.illustrateUrl, "http://127.0.0.1:8798");
    assert.equal(cfg.illustrateBackend, "klein");
    assert.equal(cfg.illustrateBudgetSeconds, 1500);
    assert.equal(cfg.illustrateVideoUrl, "http://127.0.0.1:8188");
    process.env.ILLUSTRATE_BACKEND = "ComfyUI";
    process.env.ILLUSTRATE_BUDGET_SECONDS = "-5";
    cfg = loadConfig();
    assert.equal(cfg.illustrateBackend, "comfy");
    assert.equal(cfg.illustrateBudgetSeconds, 0);
  } finally {
    keys.forEach((k, i) =>
      saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]),
    );
  }
});

test("the ComfyUI route queues the klein workflow and never calls the sketch service", async () => {
  const dir = await tmpDir();
  const seen: string[] = [];
  let queued: Record<string, { inputs: Record<string, unknown> }> = {};
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url?.split("?")[0]}`);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/prompt") {
        queued = JSON.parse(raw).prompt;
        res.end(JSON.stringify({ prompt_id: "p1" }));
      } else if (req.url?.startsWith("/history/")) {
        res.end(
          JSON.stringify({
            p1: { outputs: { "9": { images: [{ filename: "s.png", subfolder: "pulse", type: "output" }] } } },
          }),
        );
      } else if (req.url?.startsWith("/view")) {
        res.writeHead(200, { "content-type": "image/png" }).end(placeholderPng(5));
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dest = path.join(dir, "c.png");
  await illustrate("an office", { dest, seed: 9, url, backend: "comfy", timeoutMs: 20_000 });
  assert.equal(queued["12"]!.inputs.unet_name, "flux-2-klein-4b.safetensors");
  assert.equal(queued["25"]!.inputs.noise_seed, 9);
  assert.ok(!seen.some((s) => s.includes("/draw")));
  assert.ok((await fs.stat(dest)).size > 0);
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});
