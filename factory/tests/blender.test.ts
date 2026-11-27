import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  blenderSettings,
  blenderKey,
  contentKey,
  lookVersion,
  inShare,
  planBlender,
  timelineItems,
  fetchBlenderClips,
  EST_MINUTES,
  type BlenderPlanInput,
  type BlenderRequest,
} from "../src/render/blender.ts";
import { parseDetect, encodeArgs } from "../src/render/blenderrun.ts";
import { createBlenderServer, safeParams } from "../src/render/blenderserve.ts";
import type { Segment } from "../src/render/timeline.ts";
import { tmpDir } from "./helpers.ts";

const seg = (
  kind: Segment["kind"],
  start: number,
  end: number,
  visual?: Segment["visual"],
): Segment => ({
  kind,
  text: "",
  start,
  end,
  visual,
});
const rank = (n: number, title: string) => ({
  kind: "rank" as const,
  primary: title,
  secondary: "",
  value_a: n,
  items: ["2018", "PS4"],
});

function rankingInput(over: Partial<BlenderPlanInput> = {}): BlenderPlanInput {
  const segments = [
    seg("hook", 0, 20),
    seg("beat", 20, 80, rank(3, "Third")),
    seg("beat", 80, 140, rank(2, "Second")),
    seg("beat", 140, 200, rank(1, "First")),
    seg("take", 200, 230),
  ];
  return {
    episodeId: "ep_test",
    documentary: false,
    segments,
    entryOf: (i) => (i >= 1 && i <= 3 ? i - 1 : undefined),
    durationSeconds: 236,
    narrationEnd: 230,
    settings: { share: 1, capMinutes: 30 },
    ...over,
  };
}

test("settings: off by default, share clamped, the PC address by platform", () => {
  const off = blenderSettings({}, "darwin");
  assert.equal(off.on, false);
  assert.equal(off.share, 1);
  assert.equal(off.waitMinutes, 8);
  assert.equal(off.url, "http://10.77.0.1:8797");
  assert.equal(blenderSettings({}, "win32").url, "http://127.0.0.1:8797");
  const on = blenderSettings(
    {
      BLENDER_SCENES: "true",
      BLENDER_SHARE: "3",
      BLENDER_CAP_MINUTES: "4",
      BLENDER_URL: "http://x:1/",
    },
    "darwin",
  );
  assert.deepEqual(
    [on.on, on.share, on.capMinutes, on.url],
    [true, 1, 4, "http://x:1"],
  );
});

test("the cache key ignores key order and changes with the parameters", () => {
  const a = blenderKey("podium", { rank: 1, title: "A" }, 4.5);
  assert.equal(a, blenderKey("podium", { title: "A", rank: 1 }, 4.5));
  assert.notEqual(a, blenderKey("podium", { rank: 2, title: "A" }, 4.5));
  assert.notEqual(a, blenderKey("podium", { rank: 1, title: "A" }, 4));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("a desk's key follows its pictures' contents, not their names", () => {
  const r: BlenderRequest = {
    key: "1111111111111111",
    scene: "desk",
    role: "desk",
    params: { title: "T" },
    images: ["a.jpg"],
    at: 0,
    seconds: 5,
  };
  assert.equal(contentKey(r, []), r.key);
  assert.notEqual(contentKey(r, ["aaaa"]), contentKey(r, ["bbbb"]));
  assert.equal(
    contentKey(r, ["aaaa"]),
    contentKey({ ...r, images: ["other/name.jpg"] }, ["aaaa"]),
  );
});

test("the share is decided the same way every time for the same beat", () => {
  assert.equal(inShare("ep", "rank:1", 0), false);
  assert.equal(inShare("ep", "rank:1", 1), true);
  const picks = Array.from({ length: 400 }, (_, i) =>
    inShare(`ep${i}`, "rank:1", 0.5),
  );
  assert.deepEqual(
    picks,
    Array.from({ length: 400 }, (_, i) => inShare(`ep${i}`, "rank:1", 0.5)),
  );
  const n = picks.filter(Boolean).length;
  assert.ok(n > 140 && n < 260, `about half picked, got ${n}`);
});

test("a ranking gets a podium on every entry reveal and no ident over its end line", () => {
  const plan = planBlender(rankingInput());
  assert.deepEqual(
    plan.map((r) => r.scene),
    ["podium", "podium", "podium"],
  );
  const first = plan[0]!;
  assert.equal(first.at, 20);
  assert.equal(first.segment, 1);
  assert.deepEqual(first.params, {
    rank: 3,
    title: "Third",
    meta: "2018 | PS4",
    kicker: "Number 3 of 3",
  });
});

test("the cap keeps the most valuable clips", () => {
  const plan = planBlender(
    rankingInput({
      settings: { share: 1, capMinutes: EST_MINUTES.podium * 2 },
    }),
  );
  assert.deepEqual(
    plan.map((r) => r.scene),
    ["podium", "podium"],
  );
  assert.deepEqual(
    planBlender(rankingInput({ settings: { share: 1, capMinutes: 0 } })),
    [],
  );
});

function docInput(
  breakLen: number,
  over: Partial<BlenderPlanInput> = {},
): BlenderPlanInput {
  const ch = (n: number, t: string) => ({
    kind: "chapter" as const,
    primary: t,
    secondary: "The Game",
    value_a: n,
    items: ["2001"],
  });
  return {
    episodeId: "ep_doc",
    documentary: true,
    segments: [
      seg("hook", 0, 30),
      seg("beat", 30, 200, ch(1, "Beginnings")),
      seg("beat", 200, 400, ch(2, "The Turn")),
    ],
    breaks: [
      { start: 30, end: 30 + breakLen },
      { start: 200, end: 200 + breakLen },
    ],
    images: [
      { file: "entry_0/assets/photo_1.jpg", kind: "photo", beatIndex: 0 },
      {
        file: "entry_0/assets/screenshot_2.jpg",
        kind: "screenshot",
        beatIndex: 0,
      },
      { file: "entry_1/assets/capsule.jpg", kind: "capsule", beatIndex: 1 },
    ],
    entryOf: (i) => (i >= 1 ? i - 1 : undefined),
    durationSeconds: 420,
    narrationEnd: 400,
    settings: { share: 1, capMinutes: 30 },
    ...over,
  };
}

test("a documentary's breathers get the chapter card, exactly their length", () => {
  const plan = planBlender(docInput(5));
  const cards = plan.filter((r) => r.scene === "chapter");
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0]!.at, cards[0]!.seconds], [30, 5]);
  assert.equal(cards[0]!.params.title, "Beginnings");
  // A breather too long for a card keeps its own graphic.
  assert.equal(
    planBlender(docInput(12)).filter((r) => r.scene === "chapter").length,
    0,
  );
});

test("the title drop's breather gets no 3D card", () => {
  const cards = planBlender(docInput(5, { titleDrop: true })).filter(
    (r) => r.scene === "chapter",
  );
  assert.deepEqual(
    cards.map((r) => r.at),
    [200],
  );
});

test("the case-file desk opens a chapter that has two or more pictures, after its breather", () => {
  const plan = planBlender(docInput(5));
  const desks = plan.filter((r) => r.scene === "desk");
  assert.equal(desks.length, 1);
  assert.equal(desks[0]!.at, 35);
  assert.deepEqual(desks[0]!.images, [
    "entry_0/assets/photo_1.jpg",
    "entry_0/assets/screenshot_2.jpg",
  ]);
});

test("bar charts, timelines and maps become 3D data and the globe, inside their sentences", () => {
  const graphics: Record<
    string,
    { kind: string; primary: string; secondary: string; items: string[] }
  > = {
    "0:1": {
      kind: "bars",
      primary: "Consoles sold",
      secondary: "",
      items: ["PS2: 160 million", "DS: 154 million", "Switch: 150 million"],
    },
    "0:2": {
      kind: "timeline",
      primary: "",
      secondary: "",
      items: ["2013: GTA V", "2023: First trailer", "2026: Launch"],
    },
    "1:0": { kind: "map", primary: "", secondary: "", items: ["Edinburgh"] },
    "1:1": { kind: "map", primary: "", secondary: "", items: ["Nowhere Town"] },
    "2:0": {
      kind: "bars",
      primary: "Too short",
      secondary: "",
      items: ["A: 1 million", "B: 2 million"],
    },
  };
  const plan = planBlender(
    rankingInput({
      windows: [
        { entry: 0, moment: 1, start: 30, end: 36 },
        { entry: 0, moment: 2, start: 40, end: 46 },
        { entry: 1, moment: 0, start: 90, end: 96 },
        { entry: 1, moment: 1, start: 100, end: 106 },
        { entry: 2, moment: 0, start: 150, end: 154 },
      ],
      graphicOf: (e, m) => graphics[`${e}:${m}`],
    }),
  );
  const data = plan.filter((r) => r.scene === "data");
  assert.equal(
    data.length,
    2,
    "a sentence too short for a clip keeps its graphic",
  );
  assert.ok(
    data.every((r) => r.seconds <= 6),
    "a clip never runs past its sentence",
  );
  assert.equal((data[0]!.params.items as unknown[]).length, 3);
  assert.equal(data[1]!.params.mode, "timeline");
  const globes = plan.filter((r) => r.scene === "globe");
  assert.equal(globes.length, 1, "an unknown place is never guessed");
  assert.equal(
    (globes[0]!.params.pins as Array<{ label: string }>)[0]!.label,
    "Edinburgh",
  );
  assert.deepEqual(globes[0]!.params.countries, ["United Kingdom"]);
});

test("clips never overlap: the earlier one wins", () => {
  const plan = planBlender(
    rankingInput({
      windows: [{ entry: 0, moment: 0, start: 21, end: 27 }],
      graphicOf: () => ({
        kind: "bars",
        primary: "",
        secondary: "",
        items: ["A: 1 million", "B: 2 million"],
      }),
    }),
  );
  for (const [i, a] of plan.entries())
    for (const b of plan.slice(i + 1))
      assert.ok(a.at + a.seconds <= b.at, `${a.scene} overlaps ${b.scene}`);
});

test("timeline items must all read as years and events", () => {
  assert.deepEqual(timelineItems(["2013: A", "2014 - B", "2015: C"]), [
    { year: "2013", label: "A" },
    { year: "2014", label: "B" },
    { year: "2015", label: "C" },
  ]);
  assert.equal(timelineItems(["2013: A", "B", "2015: C"]), undefined);
  assert.equal(timelineItems(["2013: A", "2015: C"]), undefined);
});

const req = (
  key: string,
  role: BlenderRequest["role"] = "rank",
): BlenderRequest => ({
  key,
  scene: role === "chapter" ? "chapter" : "podium",
  role,
  params: { rank: 1 },
  at: 10,
  seconds: 4,
  segment: 1,
});

test("a PC that does not answer leaves every beat with its graphic, at once", async () => {
  const dir = await tmpDir();
  const t0 = Date.now();
  let calls = 0;
  const clips = await fetchBlenderClips(
    [req("aaaaaaaaaaaaaaaa"), req("abababababababab")],
    { url: "http://127.0.0.1:9", waitMinutes: 5 },
    dir,
    {
      fetchImpl: async () => {
        calls++;
        throw new Error("ECONNREFUSED");
      },
    },
  );
  assert.deepEqual(clips, []);
  assert.equal(
    calls,
    1,
    "the rest are not asked once the service is found down",
  );
  assert.ok(Date.now() - t0 < 2000);
});

test("a cached clip is used without asking the PC", async () => {
  const dir = await tmpDir();
  await fs.mkdir(path.join(dir, "assets", "blender"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "assets", "blender", "bbbbbbbbbbbbbbbb.mp4"),
    Buffer.alloc(20_000),
  );
  let calls = 0;
  const clips = await fetchBlenderClips(
    [req("bbbbbbbbbbbbbbbb")],
    { url: "http://x", waitMinutes: 1 },
    dir,
    {
      fetchImpl: async () => {
        calls++;
        throw new Error("no");
      },
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(clips, [
    {
      file: "assets/blender/bbbbbbbbbbbbbbbb.mp4",
      at: 10,
      seconds: 4,
      role: "rank",
      segment: 1,
    },
  ]);
});

function fakeService(states: Record<string, string>, clock: { t: number }) {
  return (async (url: string) => {
    const u = String(url);
    if (u.endsWith("/render")) return new Response("{}", { status: 202 });
    const st = /status\/(\w+)/.exec(u);
    if (st) {
      clock.t += 20_000;
      return new Response(JSON.stringify({ state: states[st[1]!] }));
    }
    return new Response(Buffer.alloc(30_000), {
      status: 200,
      headers: { "content-length": "30000" },
    });
  }) as never;
}

test("clips come back when done; failed, lost or late ones are left out", async () => {
  const dir = await tmpDir();
  const clock = { t: 0 };
  const states = {
    cccccccccccccccc: "done",
    dddddddddddddddd: "failed",
    eeeeeeeeeeeeeeee: "rendering",
    ffffffffffffffff: "unknown",
  };
  const clips = await fetchBlenderClips(
    [
      req("cccccccccccccccc"),
      req("dddddddddddddddd"),
      req("eeeeeeeeeeeeeeee"),
      req("ffffffffffffffff"),
    ],
    { url: "http://x", waitMinutes: 1 },
    dir,
    { fetchImpl: fakeService(states, clock), pollMs: 1, now: () => clock.t },
  );
  assert.deepEqual(
    clips.map((c) => c.file),
    ["assets/blender/cccccccccccccccc.mp4"],
  );
  assert.equal(
    (await fs.stat(path.join(dir, "assets", "blender", "cccccccccccccccc.mp4")))
      .size,
    30_000,
  );
});

test("chapter cards come as a set: one missing drops them all", async () => {
  const dir = await tmpDir();
  const clock = { t: 0 };
  const states = { "1010101010101010": "done", "2020202020202020": "failed" };
  const clips = await fetchBlenderClips(
    [req("1010101010101010", "chapter"), req("2020202020202020", "chapter")],
    { url: "http://x", waitMinutes: 1 },
    dir,
    { fetchImpl: fakeService(states, clock), pollMs: 1, now: () => clock.t },
  );
  assert.deepEqual(clips, []);
});

test("FFmpeg's black and freeze reports are read", () => {
  const log = [
    "[blackdetect @ 0x1] black_start:0 black_end:0.4 black_duration:0.4",
    "lavfi.freezedetect.freeze_start: 2.5",
    "lavfi.freezedetect.freeze_duration: 1.3",
    "lavfi.freezedetect.freeze_end: 3.8",
  ].join("\n");
  assert.deepEqual(parseDetect(log), {
    black: [[0, 0.4]],
    frozen: [[2.5, 3.8]],
  });
});

test("opaque clips are H.264 with grain and vignette; alpha clips ProRes 4444", () => {
  const o = encodeArgs("f_%04d.png", "o.mp4", false).join(" ");
  assert.match(o, /libx264/);
  assert.match(o, /noise=c0s=7/);
  assert.match(o, /vignette/);
  const a = encodeArgs("f_%04d.png", "o.mov", true).join(" ");
  assert.match(a, /prores_ks -profile:v 4 -pix_fmt yuva444p10le/);
});

test("a request can only set its scene's own fields: no file paths, sizes or outputs", () => {
  assert.deepEqual(
    safeParams("desk", {
      title: "T",
      images: ["C:/secret.jpg"],
      scale: 900,
      out: "C:/x",
      still: [1],
      accent: "#FF6B1A",
    }),
    { title: "T", accent: "#FF6B1A" },
  );
});

async function withServer(
  opts: Parameters<typeof createBlenderServer>[0],
  fn: (base: string) => Promise<void>,
) {
  const server = createBlenderServer(opts);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  } finally {
    server.close();
  }
}

test("the service turns away bad requests and knows nothing of an unmade clip", async () => {
  const dir = await tmpDir();
  await withServer(
    {
      cacheDir: dir,
      render: async () => {
        throw new Error("not in tests");
      },
      turn: async () => () => {},
    },
    async (base) => {
      const bad = await fetch(`${base}/render`, {
        method: "POST",
        body: JSON.stringify({ scene: "nope", key: "x" }),
      });
      assert.equal(bad.status, 400);
      const nul = await fetch(`${base}/render`, {
        method: "POST",
        body: JSON.stringify({
          scene: "podium",
          key: "0123456789abcdef",
          seconds: 4,
          params: null,
        }),
      });
      assert.equal(nul.status, 400);
      assert.deepEqual(
        await (await fetch(`${base}/status/ffffffffffffffff`)).json(),
        { state: "unknown" },
      );
      assert.equal(
        (await fetch(`${base}/clip/ffffffffffffffff.mp4`)).status,
        404,
      );
    },
  );
});

test("a clip with black frames fails and is not kept; a render takes a turn first", async () => {
  const dir = await tmpDir();
  const order: string[] = [];
  await withServer(
    {
      cacheDir: dir,
      turn: async () => {
        order.push("turn");
        return () => order.push("release");
      },
      render: async (r) => {
        order.push("render");
        await fs.writeFile(r.outFile, Buffer.alloc(20_000));
        return {
          file: r.outFile,
          renderSeconds: 1,
          encodeSeconds: 1,
          frames: 10,
          info: {},
          black: [[0, 1]],
          frozen: [],
        };
      },
    },
    async (base) => {
      const res = await fetch(`${base}/render`, {
        method: "POST",
        body: JSON.stringify({
          scene: "podium",
          key: "0123456789abcdef",
          seconds: 4,
          params: { rank: 1 },
        }),
      });
      assert.equal(res.status, 202);
      let st: { state: string } = { state: "" };
      for (let i = 0; i < 50 && st.state !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 20));
        st = (await (
          await fetch(`${base}/status/0123456789abcdef`)
        ).json()) as { state: string };
      }
      assert.equal(st.state, "failed");
      assert.equal(
        await fs
          .stat(path.join(dir, "0123456789abcdef.mp4"))
          .catch(() => undefined),
        undefined,
      );
      assert.deepEqual(order, ["turn", "render", "release"]);
    },
  );
});

test("every asset file a scene loads is in the manifest, and a render checks the manifest before it builds", async () => {
  // The Mac once lacked a wood texture and nothing said so: the kit must know every file it needs and stop by name.
  const kit = path.join(import.meta.dirname, "..", "blender");
  const man = JSON.parse(
    await fs.readFile(path.join(kit, "assets", "manifest.json"), "utf8"),
  ) as {
    files: Array<{ file: string }>;
    made: Array<{ file: string }>;
  };
  const listed = new Set([
    ...man.files.map((f) => f.file),
    ...man.made.flatMap((f) => f.file.split(",").map((s) => s.trim())),
  ]);
  const dir = path.join(kit, "pulse3d");
  const used = new Set<string>();
  for (const name of await fs.readdir(dir)) {
    if (!name.endsWith(".py")) continue;
    const src = await fs.readFile(path.join(dir, name), "utf8");
    for (const m of src.matchAll(
      /["']((?:tex|hdri|geo|fonts)\/[\w.-]+\.\w+)["']/g,
    ))
      used.add(m[1]!);
  }
  assert.ok(used.size >= 6, `found only ${[...used].join(", ")}`);
  for (const f of used)
    assert.ok(
      listed.has(f),
      `${f} is loaded by a scene but missing from assets/manifest.json`,
    );
  const entry = await fs.readFile(path.join(kit, "render_scene.py"), "utf8");
  assert.ok(
    entry.indexOf("check_assets(ctx)") > 0 &&
      entry.indexOf("check_assets(ctx)") < entry.indexOf("mod.build(ctx)"),
    "render_scene.py checks the asset folder before building the scene",
  );
});

test("the vertical podium's own look version leaves every other scene's cached key alone", () => {
  assert.equal(lookVersion("podium", { vertical: true }), 2);
  assert.equal(lookVersion("podium", { rank: 1 }), undefined);
  assert.equal(lookVersion("chapter", { vertical: true }), undefined);
  // A landscape podium keeps the key it had before the vertical look changed (KIT_VERSION 1, no look version).
  assert.equal(blenderKey("podium", { rank: 1, title: "A" }, 4.5), "1edc6e19b2f255d5");
  assert.notEqual(
    blenderKey("podium", { rank: 1, title: "A", vertical: true }, 3),
    blenderKey("podium", { rank: 1, title: "A", vertical: false }, 3),
  );
});
