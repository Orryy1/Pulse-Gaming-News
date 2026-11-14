import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  BACK_ALERT,
  PAUSED_ALERT,
  VisionPausedError,
  createVisionRelay,
  hasImages,
  isVisionPaused,
  whenVisionPaused,
  withVisionGuard,
} from "../src/assets/visionrelay.ts";
import {
  createModelCheck,
  hasVisionModel,
  localVisionDown,
  relayModels,
} from "../src/assets/localvision.ts";
import { createCodexLlm, type CodexRequest } from "../src/editorial/codex.ts";
import type { Llm, LlmContent } from "../src/editorial/llm.ts";
import { VISION_SKIPPED, visionQa } from "../src/qa/vision.ts";
import { scoreShots, type GateShot } from "../src/qa/releaseGate.ts";

const Answer = z.object({ title: z.string(), score: z.number() });

const picture: LlmContent = [
  { type: "text", text: "Frame 1 of 1" },
  {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "/9j/" },
  },
];

/** A paid-Claude stand-in that counts every call that reached it. */
function paidClaude(reply: unknown = { title: "claude", score: 1 }) {
  const calls: unknown[] = [];
  const llm: Llm = {
    structured: async (o) => {
      calls.push(o);
      return reply as never;
    },
  };
  return { llm, calls };
}

const down = async () => true;
const up = async () => false;

test("images are told apart from text-only calls", () => {
  assert.equal(hasImages("plain text"), false);
  assert.equal(hasImages([{ type: "text", text: "x" }]), false);
  assert.equal(hasImages(picture), true);
});

test("guard: a picture call never reaches paid Claude while the relay is down", async () => {
  const claude = paidClaude();
  const llm = withVisionGuard(claude.llm, {
    paidFallback: false,
    relayDown: down,
  });
  await assert.rejects(
    llm.structured({ system: "S", content: picture, schema: Answer }),
    (err) => isVisionPaused(err),
  );
  assert.equal(claude.calls.length, 0);
  // Text work is never held back by the relay.
  await llm.structured({ system: "S", content: "words", schema: Answer });
  assert.equal(claude.calls.length, 1);
});

test("guard: pictures go to Claude while the relay answers, or with VISION_PAID_FALLBACK on", async () => {
  const claude = paidClaude();
  await withVisionGuard(claude.llm, {
    paidFallback: false,
    relayDown: up,
  }).structured({ system: "S", content: picture, schema: Answer });
  await withVisionGuard(claude.llm, {
    paidFallback: true,
    relayDown: down,
  }).structured({ system: "S", content: picture, schema: Answer });
  assert.equal(claude.calls.length, 2);
});

test("guard: a relay check that throws counts as down, never as a licence to spend", async () => {
  const claude = paidClaude();
  const llm = withVisionGuard(claude.llm, {
    paidFallback: false,
    relayDown: async () => {
      throw new Error("probe broke");
    },
  });
  await assert.rejects(
    llm.structured({ system: "S", content: picture, schema: Answer }),
    VisionPausedError,
  );
  assert.equal(claude.calls.length, 0);
});

test("fallback order: relay down sends a picture to Codex (CODEX_VISION on) even off CODEX_CALLS", async () => {
  const claude = paidClaude();
  const seen: CodexRequest[] = [];
  const llm = createCodexLlm(
    withVisionGuard(claude.llm, { paidFallback: false, relayDown: down }),
    {
      enabled: true,
      sites: ["doc"],
      vision: true,
      outage: down,
      tmpDir: await fs.mkdtemp(path.join(os.tmpdir(), "vg-")),
      run: async (req) => {
        seen.push(req);
        return '{"title":"codex","score":2}';
      },
    },
  );
  const r = await llm.structured({
    site: "clipscore",
    system: "S",
    content: picture,
    schema: Answer,
  });
  assert.deepEqual(r, { title: "codex", score: 2 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.images?.length, 1);
  assert.equal(claude.calls.length, 0);
});

test("fallback order: Codex failing on a picture is skipped, not passed to paid Claude", async () => {
  const claude = paidClaude();
  let runs = 0;
  const llm = createCodexLlm(
    withVisionGuard(claude.llm, { paidFallback: false, relayDown: down }),
    {
      enabled: true,
      sites: ["*"],
      vision: true,
      outage: down,
      tmpDir: await fs.mkdtemp(path.join(os.tmpdir(), "vg-")),
      run: async () => {
        runs++;
        throw new Error("codex exec failed (exit 1)");
      },
    },
  );
  await assert.rejects(
    llm.structured({
      site: "vision",
      system: "S",
      content: picture,
      schema: Answer,
    }),
    (err) => isVisionPaused(err),
  );
  assert.ok(runs >= 1);
  assert.equal(claude.calls.length, 0);
});

test("fallback order: with CODEX_VISION off a picture is skipped outright while the relay is down", async () => {
  const claude = paidClaude();
  let runs = 0;
  const llm = createCodexLlm(
    withVisionGuard(claude.llm, { paidFallback: false, relayDown: down }),
    {
      enabled: true,
      sites: ["*"],
      vision: false,
      outage: down,
      run: async () => {
        runs++;
        return '{"title":"codex","score":2}';
      },
    },
  );
  await assert.rejects(
    llm.structured({
      site: "vision",
      system: "S",
      content: picture,
      schema: Answer,
    }),
    (err) => isVisionPaused(err),
  );
  assert.equal(runs, 0);
  assert.equal(claude.calls.length, 0);
  // Text calls are routed exactly as before.
  await llm.structured({
    site: "doc.chapter",
    system: "S",
    content: "t",
    schema: Answer,
  });
  assert.equal(runs, 1);
});

test("fallback order: relay up, an unlisted picture call is Claude's as before", async () => {
  const claude = paidClaude();
  let runs = 0;
  const llm = createCodexLlm(
    withVisionGuard(claude.llm, { paidFallback: false, relayDown: up }),
    {
      enabled: true,
      sites: ["doc"],
      vision: true,
      outage: up,
      run: async () => {
        runs++;
        return '{"title":"codex","score":2}';
      },
    },
  );
  await llm.structured({
    site: "clipscore",
    system: "S",
    content: picture,
    schema: Answer,
  });
  assert.equal(runs, 0);
  assert.equal(claude.calls.length, 1);
});

test("whenVisionPaused gives the fallback for a paused call and rethrows anything else", async () => {
  assert.equal(
    await Promise.reject(new VisionPausedError()).catch(
      whenVisionPaused("rule"),
    ),
    "rule",
  );
  await assert.rejects(
    Promise.reject(new Error("overloaded")).catch(whenVisionPaused("rule")),
    /overloaded/,
  );
});

test("callers: the final picture check is skipped as a pass with a note, never a hold", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-"));
  const f = path.join(dir, "f.jpg");
  await fs.writeFile(f, "jpeg");
  const claude = paidClaude({ verdict: "fail", problems: ["x"], notes: "" });
  const llm = withVisionGuard(claude.llm, {
    paidFallback: false,
    relayDown: down,
  });
  const r = await visionQa(llm, [f], { headline: "h", gameTitle: "g" });
  assert.deepEqual(r, VISION_SKIPPED);
  assert.equal(r.verdict, "pass");
  assert.match(r.notes, /Not checked/);
  assert.equal(claude.calls.length, 0);
  // Any other failure is still the caller's to handle, as before.
  const broken: Llm = {
    structured: async () => {
      throw new Error("overloaded");
    },
  };
  await assert.rejects(
    visionQa(broken, [f], { headline: "h", gameTitle: "g" }),
    /overloaded/,
  );
});

test("callers: the release gate stops asking after the first paused batch and leaves the rest unscored", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-"));
  const shots: GateShot[] = Array.from({ length: 20 }, (_, i) => ({
    index: i,
    start: i * 5,
    end: i * 5 + 5,
    seconds: 5,
    frame: i * 150 + 75,
    words: `line ${i}`,
    chapter: "GTA (2001)",
  }));
  let asked = 0;
  let framed = 0;
  const llm: Llm = {
    structured: async () => {
      asked++;
      throw new VisionPausedError();
    },
  };
  const scored = await scoreShots(shots, {
    llm,
    headline: "h",
    game: "g",
    frame: async (s) => {
      framed++;
      const f = path.join(dir, `s${s.index}.jpg`);
      await fs.writeFile(f, "jpeg");
      return f;
    },
  });
  assert.equal(asked, 1);
  assert.equal(framed, 8);
  assert.equal(scored.length, 20);
  assert.ok(
    scored.every((s) => s.score === undefined && s.reason === "not scored"),
  );
});

test("relay: one alert when it goes down and one when it is back, however many checks in between", async () => {
  let t = 0;
  let answering = false;
  let probes = 0;
  const alerts: string[] = [];
  let ups = 0;
  const relay = createVisionRelay({
    probe: async () => {
      probes++;
      return answering;
    },
    alert: (text) => alerts.push(text),
    onUp: () => ups++,
    now: () => t,
    probeEveryMs: 60_000,
  });
  assert.equal(relay.state(), "unknown");
  assert.equal(await relay.down(), true);
  assert.deepEqual(alerts, [PAUSED_ALERT]);
  // Within the minute the answer stands: no new probe, no new alert.
  for (let i = 0; i < 5; i++) assert.equal(await relay.down(), true);
  assert.equal(probes, 1);
  // A day of checks and failed calls: still the one alert.
  for (let i = 0; i < 50; i++) {
    t += 61_000;
    await relay.down();
    relay.report(false, "connection refused");
  }
  assert.deepEqual(alerts, [PAUSED_ALERT]);
  // Back: one alert, and local screening resumes.
  answering = true;
  relay.report(true);
  assert.equal(await relay.down(), false);
  assert.deepEqual(alerts, [PAUSED_ALERT, BACK_ALERT]);
  assert.equal(ups, 1);
  for (let i = 0; i < 10; i++) {
    t += 61_000;
    await relay.down();
    relay.report(true);
  }
  assert.deepEqual(alerts, [PAUSED_ALERT, BACK_ALERT]);
  // A later outage is a new one, alerted once again.
  answering = false;
  t += 61_000;
  await relay.down();
  await relay.down();
  assert.deepEqual(alerts, [PAUSED_ALERT, BACK_ALERT, PAUSED_ALERT]);
});

test("relay: coming up quietly from unknown sends nothing; concurrent checks share one probe", async () => {
  let probes = 0;
  const alerts: string[] = [];
  const relay = createVisionRelay({
    probe: async () => {
      probes++;
      await new Promise((r) => setTimeout(r, 5));
      return true;
    },
    alert: (text) => alerts.push(text),
  });
  const answers = await Promise.all([relay.down(), relay.down(), relay.down()]);
  assert.deepEqual(answers, [false, false, false]);
  assert.equal(probes, 1);
  assert.deepEqual(alerts, []);
});

test("relay: a failed real call keeps it down even when the server answers the probe, until a call works", async () => {
  let t = 0;
  const alerts: string[] = [];
  const relay = createVisionRelay({
    probe: async () => true,
    alert: (text) => alerts.push(text),
    now: () => t,
  });
  relay.report(false, "ollama 500: out of memory");
  t += 120_000;
  assert.equal(await relay.down(), true);
  assert.deepEqual(alerts, [PAUSED_ALERT]);
  relay.report(true);
  assert.equal(await relay.down(), false);
  assert.deepEqual(alerts, [PAUSED_ALERT, BACK_ALERT]);
});

test("relay: a probe that throws is a down relay, and an alert that throws stops nothing", async () => {
  const relay = createVisionRelay({
    probe: async () => {
      throw new Error("ECONNREFUSED");
    },
    alert: () => {
      throw new Error("discord down");
    },
  });
  assert.equal(await relay.down(), true);
});

test("the production relay check stays out of the way under test and with LOCAL_VISION off", async () => {
  assert.equal(await localVisionDown(), false);
});

test("the relay fails closed when its model list lacks LOCAL_VISION_MODEL: down, alerted once, no paid calls, cached", async () => {
  assert.deepEqual(relayModels({ models: [{ name: "llama3:8b", model: "llama3:8b" }] }), ["llama3:8b", "llama3:8b"]);
  assert.deepEqual(relayModels("nonsense"), []);
  assert.equal(hasVisionModel(["qwen3-vl:8b"], "qwen3-vl:8b"), true);
  assert.equal(hasVisionModel(["Qwen3-VL:8B"], "qwen3-vl:8b"), true);
  assert.equal(hasVisionModel(["qwen3-vl"], "qwen3-vl:latest"), true);
  assert.equal(hasVisionModel(["qwen3-vl:32b", "llava:7b"], "qwen3-vl:8b"), false);

  // Last night's case: some other Ollama on the same port, answering with other models.
  let clock = 0;
  let listed = ["llama3.1:8b", "mistral:7b"];
  let asked = 0;
  const check = createModelCheck({
    model: "qwen3-vl:8b",
    now: () => clock,
    ttlMs: 180_000,
    fetchTags: async () => {
      asked++;
      return { ok: true, json: async () => ({ models: listed.map((name) => ({ name })) }) };
    },
  });
  const alerts: string[] = [];
  const relay = createVisionRelay({
    probe: async () => (await check()) === undefined,
    alert: (t) => alerts.push(t),
    now: () => clock,
    probeEveryMs: 60_000,
  });
  const claude = paidClaude();
  const guarded = withVisionGuard(claude.llm, { paidFallback: false, relayDown: () => relay.down() });
  await assert.rejects(guarded.structured({ system: "", content: picture, schema: Answer } as never), VisionPausedError);
  assert.equal(claude.calls.length, 0, "nothing reaches the paid API");
  assert.deepEqual(alerts, [PAUSED_ALERT], "the same outage alert as a dead relay");
  assert.match((await check())!, /does not list qwen3-vl:8b/);
  assert.equal(asked, 1, "the list is cached");

  // The right model comes back: after the cache and the probe's minute, the relay is up and the alert says so.
  listed = ["qwen3-vl:8b"];
  clock += 120_000;
  assert.equal(await relay.down(), true, "still cached as missing inside the few minutes");
  clock += 120_000;
  assert.equal(await relay.down(), false);
  assert.equal(asked, 2);
  assert.deepEqual(alerts, [PAUSED_ALERT, BACK_ALERT]);

  // A relay that does not answer the list at all is down too.
  const dead = createModelCheck({ model: "qwen3-vl:8b", fetchTags: async () => { throw new Error("ECONNREFUSED"); } });
  assert.match((await dead())!, /did not answer: ECONNREFUSED/);
  const refused = createModelCheck({ model: "qwen3-vl:8b", fetchTags: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.match((await refused())!, /answered 404/);
});
