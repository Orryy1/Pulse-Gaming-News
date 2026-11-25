// Writer and narrator per episode, and WRITER_SPLIT's routing (19 Nov 2026 audit, upgrade 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { testConfig } from "./helpers.ts";
import {
  captureCalls,
  narratorOf,
  writerRecord,
  writerSplit,
} from "../src/editorial/authorship.ts";
import { recordUsage, type Llm, type UsageLine } from "../src/editorial/llm.ts";
import {
  createCodexLlm,
  withRoute,
  type CodexRequest,
} from "../src/editorial/codex.ts";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "authorship-"));

const Answer = z.object({ title: z.string() });
const line = (model: string, provider?: "codex"): UsageLine => ({
  t: new Date().toISOString(),
  model,
  job: "news Short",
  in: 0,
  out: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...(provider ? { provider } : {}),
});

test("the writer record names the last answer's provider and spots a fallback", () => {
  const opus = line("claude-opus-5-5");
  const codex = line("codex:frontier", "codex");
  assert.deepEqual(writerRecord([codex]), {
    provider: "codex",
    model: "codex:frontier",
    calls: { claude: 0, codex: 1 },
  });
  const fell = writerRecord([opus], "codex", "rest");
  assert.equal(fell.provider, "claude");
  assert.equal(fell.fallback, true, "meant for Codex, answered by Claude");
  assert.equal(fell.split, "rest");
  assert.equal(writerRecord([codex, opus], "claude").fallback, undefined);
  assert.equal(writerRecord([]).provider, "unknown");
});

test("captureCalls collects only its own scope's calls, nested scopes both see them", async () => {
  const a: UsageLine[] = [];
  const b: UsageLine[] = [];
  await Promise.all([
    captureCalls(a, async () => {
      recordUsage(line("claude-opus-5-5"));
      await new Promise((r) => setTimeout(r, 5));
      recordUsage(line("claude-opus-5-5"));
    }),
    captureCalls(b, async () => {
      await new Promise((r) => setTimeout(r, 1));
      recordUsage(line("codex:frontier", "codex"));
    }),
  ]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  const outer: UsageLine[] = [];
  const inner: UsageLine[] = [];
  await captureCalls(outer, () =>
    captureCalls(inner, async () => recordUsage(line("x"))),
  );
  assert.equal(outer.length, 1);
  assert.equal(inner.length, 1);
});

test("the narrator: the ElevenLabs voice by name, or the local Liam fallback", () => {
  assert.equal(
    narratorOf({ provider: "elevenlabs", id: "z", name: "Brit Creator M" }),
    "elevenlabs: Brit Creator M",
  );
  assert.equal(
    narratorOf({ provider: "local", id: "l", name: "Liam (local clone)" }),
    "local (Liam/VoxCPM)",
  );
  assert.equal(narratorOf(undefined), undefined);
});

test("WRITER_SPLIT: Claude for series, fit-length and strong-fandom Shorts, Codex for the rest", () => {
  assert.deepEqual(
    writerSplit({ serial: true, maxSeconds: 60, strongFandom: false }),
    { route: "claude", why: "series" },
  );
  assert.equal(
    writerSplit({ serial: false, maxSeconds: 35, strongFandom: false }).why,
    "fit length",
  );
  assert.equal(
    writerSplit({ serial: false, maxSeconds: 45, strongFandom: true }).why,
    "strong fandom",
  );
  assert.deepEqual(
    writerSplit({ serial: false, maxSeconds: 45, strongFandom: false }),
    { route: "codex", why: "rest" },
  );
  assert.equal(
    writerSplit({ serial: false, strongFandom: false }).route,
    "codex",
  );
  assert.equal(testConfig("/tmp/x").writerSplit, false);
});

test("withRoute overrides CODEX_CALLS for its calls; a Codex failure still falls back to Claude", async () => {
  const claudeCalls: unknown[] = [];
  const claude: Llm = {
    structured: async (o) => {
      claudeCalls.push(o);
      return { title: "claude" } as never;
    },
  };
  const answers = [JSON.stringify({ title: "codex" })];
  const seen: CodexRequest[] = [];
  const llm = createCodexLlm(claude, {
    enabled: true,
    sites: ["*"],
    run: async (req) => {
      seen.push(req);
      const a = answers.shift();
      if (a === undefined) throw new Error("codex exec failed");
      return a;
    },
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), "route-")),
  });
  const ask = () =>
    llm.structured({
      system: "S",
      content: "C",
      schema: Answer,
      site: "editorial",
    });
  assert.deepEqual(
    await withRoute("claude", ask),
    { title: "claude" },
    "listed, but sent to Claude",
  );
  assert.equal(seen.length, 0);
  assert.deepEqual(
    await ask(),
    { title: "codex" },
    "no hint: CODEX_CALLS=* as before",
  );
  const off = createCodexLlm(claude, {
    enabled: true,
    sites: [],
    run: async () => {
      throw new Error("down");
    },
    tmpDir: os.tmpdir(),
  });
  const r = await withRoute("codex", () =>
    off.structured({
      system: "S",
      content: "C",
      schema: Answer,
      site: "editorial",
    }),
  );
  assert.deepEqual(
    r,
    { title: "claude" },
    "routed to Codex, which failed: Claude answers",
  );
});
