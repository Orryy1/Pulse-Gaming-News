import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  cliArgs,
  cliEnv,
  cliJsonSchema,
  createMaxLlm,
  maxFailureKind,
  maxGate,
  mergeWeek,
  parseStream,
  weekFromEvents,
  runClaudeCli,
  weekReader,
  type MaxReply,
  type MaxRequest,
} from "../src/editorial/maxplan.ts";
import {
  createCodexLlm,
  routeHintNow,
  withCodexCap,
  withRoute,
  type CodexRequest,
} from "../src/editorial/codex.ts";
import {
  claudeSpend,
  tapUsage,
  usageCost,
  type Llm,
  type UsageLine,
} from "../src/editorial/llm.ts";
import { budgetView, createLibraryServer } from "../src/assets/gamelibserve.ts";
import { loadConfig } from "../src/config.ts";

const Answer = z.object({
  title: z.string(),
  score: z.number(),
  note: z.string().optional(),
});
const call = {
  system: "You rate things.",
  content: "Rate this.",
  schema: Answer,
  site: "doc.chapter",
};
const ok = (out: unknown): MaxReply => ({
  type: "result",
  subtype: "success",
  is_error: false,
  structured_output: out,
});
const HOUR = 3600_000;

/** The layer below (Codex's router, the API key): records each call and the route hint it saw. */
function fakeNext(reply: unknown = { title: "next", score: 0 }) {
  const calls: Array<{ hint: string | undefined; o: unknown }> = [];
  const llm: Llm = {
    structured: async (o) => {
      calls.push({ hint: routeHintNow(), o });
      return reply as never;
    },
  };
  return { llm, calls };
}

/** A CLI stand-in: answers in order, records each request, never spawns a process. */
function fakeRun(replies: Array<MaxReply | Error>) {
  const seen: MaxRequest[] = [];
  const run = async (req: MaxRequest) => {
    seen.push(req);
    const r = replies.shift();
    if (!r) throw new Error("no reply left");
    if (r instanceof Error) throw r;
    return r;
  };
  return { run, seen };
}

const base = {
  enabled: true,
  models: {
    top: "claude-opus-5-5",
    mid: "claude-sonnet-5-5",
    low: "claude-haiku-5-5",
  },
};

test("nothing changes when off: the layer below is returned as is and the CLI is never run", async () => {
  const next = fakeNext();
  const cli = fakeRun([ok({ title: "max", score: 1 })]);
  const llm = createMaxLlm(next.llm, { ...base, enabled: false, run: cli.run });
  assert.equal(llm, next.llm);
  assert.deepEqual(await llm.structured(call), { title: "next", score: 0 });
  assert.equal(cli.seen.length, 0);
  assert.equal(loadConfig().claudeViaMax, false);
  assert.equal(loadConfig().maxWeekCapPercent, 60);
  const services = fs.readFileSync(
    path.join(import.meta.dirname, "../src/services.ts"),
    "utf8",
  );
  assert.match(
    services,
    /createMaxLlm\(routed, \{\s*enabled: cfg\.claudeViaMax,/,
  );
  assert.match(services, /withVoiceTags\(maxed\)/);
});

test("Max answers a text call with the tier's own model, no tools, and a priced-at-nothing usage line", async () => {
  const next = fakeNext();
  const cli = fakeRun([ok({ title: "max", score: 7 })]);
  const lines: UsageLine[] = [];
  const untap = tapUsage((l) => lines.push(l));
  try {
    const llm = createMaxLlm(next.llm, { ...base, run: cli.run });
    assert.deepEqual(
      await llm.structured({ ...call, tier: "mid", effort: "high" }),
      { title: "max", score: 7 },
    );
    // The second run has no reply left (the fake throws), so the call goes below; its model is still the low tier's.
    assert.deepEqual(await llm.structured({ ...call, tier: "low" }), {
      title: "next",
      score: 0,
    });
  } finally {
    untap();
  }
  assert.equal(cli.seen[0]!.model, "claude-sonnet-5-5");
  assert.equal(cli.seen[0]!.effort, "high");
  assert.equal(cli.seen[0]!.system, "You rate things.");
  assert.equal(cli.seen[0]!.input, "Rate this.");
  assert.ok(!cli.seen[0]!.jsonSchema.includes("$schema"));
  assert.equal(cli.seen[1]!.model, "claude-haiku-5-5");
  const maxLine = lines.find((l) => l.provider === "max")!;
  assert.equal(maxLine.site, "doc.chapter");
  assert.equal(maxLine.model, "claude-sonnet-5-5");
  assert.equal(usageCost({ ...maxLine, in: 1e6, out: 1e6 }), 0);
});

test("an answer that does not fit the schema is asked for once more, then the call goes below", async () => {
  const next = fakeNext();
  const cli = fakeRun([ok({ title: "x" }), ok({ title: "fixed", score: 2 })]);
  const llm = createMaxLlm(next.llm, { ...base, run: cli.run });
  assert.deepEqual(await llm.structured(call), { title: "fixed", score: 2 });
  assert.match(cli.seen[1]!.input, /previous reply was not valid: score/);
  assert.equal(next.calls.length, 0);

  const twice = fakeRun([ok({ title: "x" }), ok({ nope: 1 })]);
  const viaCodex = createMaxLlm(next.llm, {
    ...base,
    run: twice.run,
    viaCodex: true,
  });
  assert.deepEqual(await viaCodex.structured(call), {
    title: "next",
    score: 0,
  });
  assert.equal(
    next.calls.at(-1)!.hint,
    "codex",
    "with Codex below, a failed call goes Codex first",
  );
});

test("a plain-text JSON answer is accepted when the CLI gives no structured output", async () => {
  const cli = fakeRun([
    {
      subtype: "success",
      is_error: false,
      result: '```json\n{"title":"t","score":1}\n```',
    },
  ]);
  const llm = createMaxLlm(fakeNext().llm, { ...base, run: cli.run });
  assert.deepEqual(await llm.structured(call), { title: "t", score: 1 });
});

test("without Codex below, a failure goes straight to the API key (no route hint)", async () => {
  const next = fakeNext();
  const llm = createMaxLlm(next.llm, {
    ...base,
    run: fakeRun([new Error("claude -p timed out after 900 s")]).run,
  });
  await llm.structured(call);
  assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0]!.hint, undefined);
});

test("a usage-limit refusal holds Max for an hour: later calls skip the CLI, one note each way", async () => {
  const next = fakeNext();
  const notes: string[] = [];
  const cli = fakeRun([
    {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Claude AI usage limit reached|1795700000",
    },
  ]);
  const llm = createMaxLlm(next.llm, {
    ...base,
    run: cli.run,
    viaCodex: true,
    onState: (t) => notes.push(t),
  });
  await llm.structured(call);
  await llm.structured(call);
  await llm.structured(call);
  assert.equal(cli.seen.length, 1, "held: the CLI is not asked again");
  assert.equal(next.calls.length, 3);
  assert.ok(next.calls.every((c) => c.hint === "codex"));
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /usage limit/);
});

test("signed out (an ssh session) holds Max like a limit", async () => {
  const cli = fakeRun([
    {
      subtype: "success",
      is_error: true,
      result: "Not logged in · Please run /login",
    },
  ]);
  const next = fakeNext();
  const llm = createMaxLlm(next.llm, { ...base, run: cli.run });
  await llm.structured(call);
  await llm.structured(call);
  assert.equal(cli.seen.length, 1);
});

test("the weekly guard: at the cap Max is skipped for Codex, under it Max answers", async () => {
  const now = Date.now();
  const reading = {
    weekly: 61,
    resets_at: new Date(now + 48 * HOUR).toISOString(),
    read_at: now / 1000,
  };
  const next = fakeNext();
  const cli = fakeRun([ok({ title: "max", score: 1 })]);
  let r: typeof reading = reading;
  const llm = createMaxLlm(next.llm, {
    ...base,
    run: cli.run,
    viaCodex: true,
    capPercent: 60,
    week: async () => r,
  });
  await llm.structured(call);
  assert.equal(cli.seen.length, 0);
  assert.equal(next.calls[0]!.hint, "codex");
  r = { ...reading, weekly: 40 };
  assert.deepEqual(await llm.structured(call), { title: "max", score: 1 });
});

test("maxGate (pure): limits, fresh and stale readings, resets", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const reset = "2026-12-02T11:00:00Z";
  assert.equal(maxGate(undefined, now, 60).open, true);
  assert.equal(
    maxGate({ weekly: 59, resets_at: reset, read_at: now / 1000 }, now, 60)
      .open,
    true,
  );
  assert.equal(
    maxGate({ weekly: 60, resets_at: reset, read_at: now / 1000 }, now, 60)
      .open,
    false,
  );
  // an old reading still counts up to the reset it named
  assert.equal(
    maxGate(
      { weekly: 80, resets_at: reset, read_at: now / 1000 - 3 * 86400 },
      now,
      60,
    ).open,
    false,
  );
  // after that reset it no longer does
  assert.equal(
    maxGate(
      {
        weekly: 80,
        resets_at: "2026-11-25T11:00:00Z",
        read_at: now / 1000 - 3600,
      },
      now,
      60,
    ).open,
    true,
  );
  // stale with no reset named: no guard from it
  assert.equal(
    maxGate({ weekly: 80, read_at: now / 1000 - 13 * 3600 }, now, 60).open,
    true,
  );
  assert.equal(
    maxGate({ weekly: 10, limited_until: "2026-11-25T13:00:00Z" }, now, 60)
      .open,
    false,
  );
  assert.equal(
    maxGate(
      {
        weekly: 10,
        limited_until: "2026-11-25T11:00:00Z",
        read_at: now / 1000,
      },
      now,
      60,
    ).open,
    true,
  );
});

test("maxFailureKind tells a limit and a sign-in from any other failure", () => {
  assert.equal(
    maxFailureKind("Claude AI usage limit reached|1795700000"),
    "limit",
  );
  assert.equal(
    maxFailureKind("You've hit your weekly limit · resets Dec 2"),
    "limit",
  );
  assert.equal(maxFailureKind("Not logged in · Please run /login"), "auth");
  assert.equal(
    maxFailureKind("error_max_structured_output_retries"),
    undefined,
  );
  assert.equal(maxFailureKind("API Error: 529 overloaded"), undefined);
});

test("pictures and WRITER_SPLIT's Codex calls are routed as before, untouched", async () => {
  const next = fakeNext();
  const cli = fakeRun([]);
  const llm = createMaxLlm(next.llm, { ...base, run: cli.run, viaCodex: true });
  await llm.structured({
    ...call,
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAA" },
      },
      { type: "text", text: "what is this" },
    ],
  });
  await withRoute("codex", () => llm.structured(call));
  assert.equal(cli.seen.length, 0);
  assert.equal(
    next.calls[0]!.hint,
    undefined,
    "a picture call keeps today's routing",
  );
  assert.equal(next.calls[1]!.hint, "codex");
});

test("a Short's CODEX_SHORT_TIMEOUT_MINUTES cap bounds a Max run too", async () => {
  const cli = fakeRun([
    ok({ title: "a", score: 1 }),
    ok({ title: "b", score: 1 }),
  ]);
  const llm = createMaxLlm(fakeNext().llm, {
    ...base,
    run: cli.run,
    timeoutMs: 15 * 60_000,
  });
  await withCodexCap(5 * 60_000, () => llm.structured(call));
  await llm.structured(call);
  assert.equal(cli.seen[0]!.timeoutMs, 5 * 60_000);
  assert.equal(cli.seen[1]!.timeoutMs, 15 * 60_000);
});

test("MAX_CONCURRENCY: runs beyond the limit wait their turn", async () => {
  let active = 0;
  let peak = 0;
  const run = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return ok({ title: "t", score: 1 });
  };
  const llm = createMaxLlm(fakeNext().llm, { ...base, run, concurrency: 2 });
  await Promise.all(Array.from({ length: 5 }, () => llm.structured(call)));
  assert.equal(peak, 2);
});

test("the full order with the setting on: Max, then Codex, then the API key", async () => {
  const api = fakeNext({ title: "api", score: 9 });
  const codexAnswers: string[] = [];
  const codexRun = async (_req: CodexRequest) => {
    const a = codexAnswers.shift();
    if (!a) throw new Error("codex runner exit 1");
    return a;
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-test-"));
  // An unlisted site: today it would go to the API key first.
  const router = createCodexLlm(api.llm, {
    enabled: true,
    sites: ["evergreen"],
    run: codexRun,
    tmpDir,
  });
  const replies: Array<MaxReply | Error> = [];
  const llm = createMaxLlm(router, {
    ...base,
    run: fakeRun(replies).run,
    viaCodex: true,
  });

  replies.push(ok({ title: "max", score: 1 }));
  assert.equal((await llm.structured(call)).title, "max");

  replies.push(new Error("claude -p exit 1: boom"));
  codexAnswers.push('{"title":"codex","score":2,"note":null}');
  assert.equal((await llm.structured(call)).title, "codex");
  assert.equal(api.calls.length, 0);

  replies.push(new Error("claude -p exit 1: boom"));
  assert.equal((await llm.structured(call)).title, "api");
  assert.equal(api.calls.length, 1);
});

test("weekReader caches a reading and gives undefined when the PC cannot be read", async () => {
  let n = 0;
  const good = (async () => {
    n++;
    return new Response(JSON.stringify({ weekly: 30 }), { status: 200 });
  }) as unknown as typeof fetch;
  const read = weekReader("http://pc/claude-budget", good);
  assert.deepEqual(await read(), { weekly: 30 });
  await read();
  assert.equal(n, 1);
  const bad = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  assert.equal(await weekReader("http://pc/claude-budget", bad)(), undefined);
  const missing = (async () =>
    new Response("", { status: 404 })) as unknown as typeof fetch;
  assert.equal(
    await weekReader("http://pc/claude-budget", missing)(),
    undefined,
  );
});

test("budgetView passes only the guard's fields from the orchestrator's file", () => {
  assert.deepEqual(
    budgetView({
      weekly: 11,
      resets_at: "2026-12-02T10:59:59Z",
      read_at: 1795615878,
      source: "cli",
      fable: 0,
      limited_by: "explainer",
      reason: "x",
    }),
    { weekly: 11, resets_at: "2026-12-02T10:59:59Z", read_at: 1795615878 },
  );
  assert.deepEqual(budgetView(null), {});
});

test("the CLI's flags and environment: no tools, no settings, never the API key", () => {
  const args = cliArgs(
    { model: "claude-opus-5-5", effort: "medium", jsonSchema: "{}" },
    "/tmp/s.txt",
  );
  assert.deepEqual(args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5-5");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "");
  assert.ok(
    args.includes("--no-session-persistence") &&
      args.includes("--strict-mcp-config"),
  );
  const env = cliEnv(
    { ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "u", PATH: "/bin" },
    64000,
  );
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "64000");
  assert.equal(cliEnv({}, 8000).CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined);
  const schema = JSON.parse(cliJsonSchema(Answer));
  assert.equal(schema.$schema, undefined);
  assert.deepEqual(schema.required, ["title", "score"]);
});

test("runClaudeCli against a fake CLI: stdin in, JSON out, empty folder, no API key, folder removed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-cli-"));
  const fake = path.join(dir, "fake-claude.mjs");
  fs.writeFileSync(
    fake,
    `import fs from "node:fs";
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const sys = args[args.indexOf("--system-prompt-file") + 1];
  const out = {
    type: "result", subtype: "success", is_error: false,
    structured_output: { title: input, score: fs.readdirSync(process.cwd()).length },
    result: JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, sys: fs.readFileSync(sys, "utf8"), model: args[args.indexOf("--model") + 1] }),
  };
  process.stdout.write(JSON.stringify(out) + "\\n");
});
`,
  );
  const tmpRoot = path.join(dir, "tmp");
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  try {
    const reply = await runClaudeCli(
      {
        system: "SYS",
        input: "hello",
        model: "claude-haiku-5-5",
        effort: "low",
        jsonSchema: "{}",
        timeoutMs: 30_000,
      },
      { bin: process.execPath, binArgs: [fake], tmpRoot },
    );
    assert.deepEqual(reply.structured_output, { title: "hello", score: 0 });
    assert.deepEqual(JSON.parse(reply.result!), {
      key: null,
      sys: "SYS",
      model: "claude-haiku-5-5",
    });
    assert.deepEqual(
      fs.readdirSync(tmpRoot),
      [],
      "the run's folder is removed",
    );
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
});

test("runClaudeCli kills a hung CLI at its timeout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-hang-"));
  const fake = path.join(dir, "hang.mjs");
  fs.writeFileSync(fake, "setInterval(() => {}, 1000);\n");
  await assert.rejects(
    runClaudeCli(
      {
        system: "s",
        input: "i",
        model: "m",
        effort: "low",
        jsonSchema: "{}",
        timeoutMs: 500,
      },
      {
        bin: process.execPath,
        binArgs: [fake],
        tmpRoot: path.join(dir, "tmp"),
      },
    ),
    /timed out/,
  );
});

test("claudeSpend leaves Max lines out of the bill", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-spend-"));
  fs.mkdirSync(path.join(dir, "usage"));
  const line = {
    t: "2026-11-25T10:00:00Z",
    model: "claude-opus-5-5",
    job: "j",
    in: 1e6,
    out: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  fs.writeFileSync(
    path.join(dir, "usage", "2026-11-25.jsonl"),
    `${JSON.stringify({ ...line, provider: "max" })}\n${JSON.stringify(line)}\n`,
  );
  assert.equal(claudeSpend(dir, "2026-11-25").live, 4);
});

test("a call with no site is filed under its caller, never under maxplan", async () => {
  const lines: UsageLine[] = [];
  const untap = tapUsage((l) => lines.push(l));
  try {
    const llm = createMaxLlm(fakeNext().llm, { ...base, run: fakeRun([ok({ title: "t", score: 1 })]).run });
    await llm.structured({ system: "s", content: "c", schema: Answer });
  } finally {
    untap();
  }
  assert.equal(lines[0]!.site, "maxplan.test");
  // and Codex's router, below Max, names the caller too
  const seenSites: string[] = [];
  const router = createCodexLlm(fakeNext().llm, {
    enabled: true,
    sites: ["maxplan.test"],
    run: async () => {
      seenSites.push("codex");
      return '{"title":"c","score":1,"note":null}';
    },
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-site-")),
  });
  const llm = createMaxLlm(router, { ...base, run: fakeRun([new Error("boom")]).run, viaCodex: false });
  assert.equal((await llm.structured({ system: "s", content: "c", schema: Answer })).title, "c");
  assert.deepEqual(seenSites, ["codex"], "a listed caller still goes to Codex: the router saw the caller's site");
});

test("a refusal only on stderr holds Max too", async () => {
  const cli = fakeRun([new Error("claude -p exit 1: Not logged in � Please run /login")]);
  const llm = createMaxLlm(fakeNext().llm, { ...base, run: cli.run });
  await llm.structured(call);
  await llm.structured(call);
  assert.equal(cli.seen.length, 1);
});

test("two timeouts in a row hold Max for an hour; one does not", async () => {
  const cli = fakeRun([
    new Error("claude -p timed out after 900 s"),
    ok({ title: "t", score: 1 }),
    new Error("claude -p timed out after 900 s"),
    new Error("claude -p timed out after 900 s"),
  ]);
  const llm = createMaxLlm(fakeNext().llm, { ...base, run: cli.run });
  for (let i = 0; i < 5; i++) await llm.structured(call);
  assert.equal(cli.seen.length, 4);
});

test("a WRITER_SPLIT Claude call that Max cannot take keeps its Claude hint (the API key, never Codex)", async () => {
  const next = fakeNext();
  const llm = createMaxLlm(next.llm, { ...base, run: fakeRun([new Error("boom")]).run, viaCodex: true });
  await withRoute("claude", () => llm.structured(call));
  assert.equal(next.calls[0]!.hint, "claude");
});

test("under a Short's cap with every slot busy, the call skips Max instead of queueing", async () => {
  let releaseRun!: () => void;
  const gate = new Promise<void>((r) => (releaseRun = r));
  const seen: MaxRequest[] = [];
  const run = async (req: MaxRequest) => {
    seen.push(req);
    await gate;
    return ok({ title: "t", score: 1 });
  };
  const next = fakeNext();
  const llm = createMaxLlm(next.llm, { ...base, run, concurrency: 1 });
  const first = llm.structured(call);
  await new Promise((r) => setTimeout(r, 10));
  await withCodexCap(60_000, () => llm.structured(call));
  assert.equal(next.calls.length, 1);
  releaseRun();
  await first;
  assert.equal(seen.length, 1);
});

test("the plan's own reading from a run pauses Max at the cap", async () => {
  const now = Date.now();
  const week = { weekly: 72, resets_at: new Date(now + 48 * HOUR).toISOString(), read_at: now / 1000 };
  const cli = fakeRun([{ ...ok({ title: "t", score: 1 }), week }]);
  const next = fakeNext();
  const notes: string[] = [];
  const llm = createMaxLlm(next.llm, { ...base, run: cli.run, capPercent: 60, onState: (t) => notes.push(t) });
  assert.equal((await llm.structured(call)).title, "t");
  await llm.structured(call);
  assert.equal(cli.seen.length, 1);
  assert.equal(next.calls.length, 1);
  assert.match(notes[0]!, /72% used/);
});

test("parseStream and weekFromEvents read the CLI's stream-json (shape seen on the Mac, 25 Nov 2026)", () => {
  const now = Date.parse("2026-11-25T15:30:00Z");
  const stream = [
    '{"type":"system","subtype":"init","model":"claude-haiku-5-5"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1796209200,"rateLimitType":"seven_day","overageStatus":"rejected","isUsingOverage":false,"unifiedWindows":{"seven_day":{"utilization":0.15,"resetsAt":1796209200,"status":"allowed"}}}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"title":"x","score":1}}',
  ].join("\n");
  const r = parseStream(stream, now);
  assert.deepEqual(r.structured_output, { title: "x", score: 1 });
  assert.equal(r.week!.weekly, 15);
  assert.equal(r.week!.resets_at, new Date(1796209200 * 1000).toISOString());
  assert.equal(r.week!.limited_until, undefined, "overage rejected is not a limit");
  const rejected = weekFromEvents(
    [{ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1796209200, rateLimitType: "five_hour" } }],
    now,
  );
  assert.equal(rejected!.limited_until, new Date(1796209200 * 1000).toISOString());
  assert.equal(weekFromEvents([], now), undefined);
  assert.throws(() => parseStream('{"type":"system"}'), /no result/);
});

test("the library server's /claude-budget route serves the trimmed reading, 404 when there is none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxplan-budget-"));
  const before = process.env.ORCH_STATE;
  process.env.ORCH_STATE = dir;
  const server = createLibraryServer(dir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/claude-budget`)).status, 404);
    fs.writeFileSync(path.join(dir, "claude_budget.json"), JSON.stringify({ weekly: 42, reason: "x", source: "cli" }));
    const res = await fetch(`http://127.0.0.1:${port}/claude-budget`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { weekly: 42 });
  } finally {
    server.close();
    if (before === undefined) delete process.env.ORCH_STATE;
    else process.env.ORCH_STATE = before;
  }
});

test("mergeWeek keeps an earlier weekly figure and limit when a run's stream lacks them", () => {
  const old = { weekly: 70, resets_at: "2026-12-02T11:00:00Z", read_at: 1, limited_until: "2026-11-25T20:00:00Z" };
  assert.deepEqual(mergeWeek(old, { read_at: 2 }), { ...old, read_at: 2 });
  assert.deepEqual(mergeWeek(old, { weekly: 72, resets_at: "2026-12-02T11:00:00Z", read_at: 3 }), { ...old, weekly: 72, read_at: 3 });
  assert.deepEqual(mergeWeek(undefined, { weekly: 5, read_at: 4 }), { weekly: 5, read_at: 4 });
});

test("CODEX_CALLS steps stay on Codex and skip Max unless MAX_FOR_CODEX_SITES", async () => {
  const sites = ["doc", "factcheck"];
  // off (the default): a listed step goes straight to the router, untouched; an unlisted one goes to Max
  const next = fakeNext();
  const cli = fakeRun([ok({ title: "max", score: 1 })]);
  const off = createMaxLlm(next.llm, { ...base, run: cli.run, viaCodex: true, codexSites: sites });
  assert.deepEqual(await off.structured(call), { title: "next", score: 0 });
  assert.equal(next.calls[0]!.hint, undefined, "routed as today: the router's own CODEX_CALLS sends it to Codex");
  assert.equal(cli.seen.length, 0);
  assert.equal((await off.structured({ ...call, site: "search.write" })).title, "max");
  // on: Max takes listed steps too
  const on = createMaxLlm(fakeNext().llm, {
    ...base,
    run: fakeRun([ok({ title: "max", score: 2 })]).run,
    viaCodex: true,
    codexSites: sites,
    forCodexSites: true,
  });
  assert.equal((await on.structured(call)).title, "max");
  // without Codex below, a listed step would only reach the API key: Max takes it
  const noCodex = createMaxLlm(fakeNext().llm, {
    ...base,
    run: fakeRun([ok({ title: "max", score: 3 })]).run,
    viaCodex: false,
    codexSites: sites,
  });
  assert.equal((await noCodex.structured(call)).title, "max");
  assert.equal(loadConfig().maxForCodexSites, false);
  const services = fs.readFileSync(path.join(import.meta.dirname, "../src/services.ts"), "utf8");
  assert.match(services, /codexSites: cfg\.codexCalls,\s*forCodexSites: cfg\.maxForCodexSites,/);
});
