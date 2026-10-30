import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  buildCommand,
  buildPrompt,
  createCodexLlm,
  dropNulls,
  extractJson,
  kindFor,
  routeToCodex,
  siteOf,
  strictJsonSchema,
  type CodexRequest,
} from "../src/editorial/codex.ts";
import type { Llm } from "../src/editorial/llm.ts";

const Answer = z.object({
  title: z.string(),
  score: z.number(),
  note: z.string().optional(),
});

/** A Claude stand-in that records what reached it. */
function fakeClaude(reply: unknown = { title: "claude", score: 1 }) {
  const calls: unknown[] = [];
  const llm: Llm = {
    structured: async (o) => {
      calls.push(o);
      return reply as never;
    },
  };
  return { llm, calls };
}

/** A runner stand-in: answers in order, records each request, never spawns a process. */
function fakeRunner(answers: string[]) {
  const seen: CodexRequest[] = [];
  const run = async (req: CodexRequest) => {
    seen.push(req);
    const a = answers.shift();
    if (a === undefined) throw new Error("codex exec failed (exit 1)");
    return a;
  };
  return { run, seen };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));

test("tiers map to Codex kinds: top writing gets the frontier model", () => {
  assert.equal(kindFor("top"), "frontier");
  assert.equal(kindFor("mid"), "bulk");
  assert.equal(kindFor("low"), "quick");
  assert.equal(kindFor(undefined), "frontier");
});

test("a call's site is its tag, else the calling module's file name", () => {
  assert.equal(siteOf("doc.chapter"), "doc.chapter");
  const stack = [
    "Error",
    "    at siteOf (file:///C:/f/src/editorial/codex.ts:60:20)",
    "    at Object.structured (file:///C:/f/src/editorial/codex.ts:200:20)",
    "    at writeEvergreen (file:///C:/f/src/editorial/evergreen.ts:229:14)",
    "    at stepScript (file:///C:/f/src/pipeline.ts:3700:3)",
  ].join("\n");
  assert.equal(siteOf(undefined, stack), "evergreen");
  assert.equal(
    siteOf(undefined, "Error\n    at x (node:internal/foo:1:1)"),
    "unknown",
  );
});

test("routing: off by default, listed sites only, families and *, images need the vision switch", () => {
  assert.equal(
    routeToCodex({ enabled: false, sites: ["*"] }, "doc.chapter", false),
    false,
  );
  assert.equal(
    routeToCodex({ enabled: true, sites: [] }, "doc.chapter", false),
    false,
  );
  assert.equal(
    routeToCodex(
      { enabled: true, sites: ["doc.chapter"] },
      "doc.chapter",
      false,
    ),
    true,
  );
  assert.equal(
    routeToCodex(
      { enabled: true, sites: ["doc.chapter"] },
      "doc.outline",
      false,
    ),
    false,
  );
  assert.equal(
    routeToCodex({ enabled: true, sites: ["doc"] }, "doc.outline", false),
    true,
  );
  assert.equal(
    routeToCodex(
      { enabled: true, sites: [" Evergreen "] },
      "evergreen.write",
      false,
    ),
    true,
  );
  assert.equal(
    routeToCodex({ enabled: true, sites: ["*"] }, "editorial", false),
    true,
  );
  // The news Short writer is never listed by family "doc"; a vision check waits for CODEX_VISION.
  assert.equal(
    routeToCodex({ enabled: true, sites: ["doc"] }, "editorial", false),
    false,
  );
  assert.equal(
    routeToCodex({ enabled: true, sites: ["*"] }, "vision", true),
    false,
  );
  assert.equal(
    routeToCodex({ enabled: true, sites: ["*"], vision: true }, "vision", true),
    true,
  );
});

test("the strict schema requires every key, forbids extras and makes optional fields nullable", () => {
  const js = strictJsonSchema(z.toJSONSchema(Answer)) as any;
  assert.equal(js.$schema, undefined);
  assert.deepEqual(js.required, ["title", "score", "note"]);
  assert.equal(js.additionalProperties, false);
  assert.deepEqual(js.properties.note, {
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  // Nested objects inside arrays are made strict too, and size keywords OpenAI rejects are dropped.
  const nested = strictJsonSchema(
    z.toJSONSchema(
      z.object({
        rows: z.array(z.object({ a: z.string().optional() })).max(3),
      }),
    ),
  ) as any;
  assert.equal(nested.properties.rows.maxItems, undefined);
  assert.deepEqual(nested.properties.rows.items.required, ["a"]);
  assert.equal(nested.properties.rows.items.additionalProperties, false);
  assert.deepEqual(dropNulls({ a: null, b: [{ c: null, d: 1 }] }), {
    b: [{ d: 1 }],
  });
});

test("the answer's JSON is found inside fences or prose", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('Here you go: {"a":1} done'), '{"a":1}');
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test("the prompt carries the instructions, the input and the JSON-only rule; the command is python -c", () => {
  const p = buildPrompt("SYS", "IN");
  assert.match(p, /<instructions>\nSYS\n<\/instructions>/);
  assert.match(p, /<input>\nIN\n<\/input>/);
  assert.match(p, /one JSON object only/);
  const c = buildCommand("py", "C:\\orch", "C:\\req.json");
  assert.equal(c.cmd, "py");
  assert.equal(c.args[0], "-c");
  assert.match(c.args[1]!, /codex_runner\.ask\(/);
  assert.deepEqual(c.args.slice(2), ["C:\\orch", "C:\\req.json"]);
});

test("a listed site is answered by Codex with the tier's kind and a schema file; the usage log gets a $0 codex line", async () => {
  const dir = tmp();
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const claude = fakeClaude();
    const runner = fakeRunner(['{"title":"codex","score":2,"note":null}']);
    const llm = createCodexLlm(claude.llm, {
      enabled: true,
      sites: ["doc.chapter"],
      run: runner.run,
      tmpDir: dir,
    });
    const r = await llm.structured({
      site: "doc.chapter",
      system: "S",
      content: "C",
      schema: Answer,
      tier: "mid",
    });
    assert.deepEqual(r, { title: "codex", score: 2 });
    assert.equal(claude.calls.length, 0);
    assert.equal(runner.seen.length, 1);
    assert.equal(runner.seen[0]!.kind, "bulk");
    assert.equal(runner.seen[0]!.images, undefined);
    assert.match(runner.seen[0]!.prompt, /<instructions>\nS\n/);
    const lines = fs
      .readdirSync(path.join(dir, "usage"))
      .flatMap((f) =>
        fs
          .readFileSync(path.join(dir, "usage", f), "utf8")
          .trim()
          .split("\n"),
      )
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].provider, "codex");
    assert.equal(lines[0].model, "codex:bulk");
    assert.equal(lines[0].site, "doc.chapter");
    assert.equal(
      lines[0].in + lines[0].out + lines[0].cacheRead + lines[0].cacheWrite,
      0,
    );
    assert.equal(typeof lines[0].ms, "number");
    // The schema file is gone after the call.
    assert.equal(
      fs.readdirSync(dir).filter((f) => f.startsWith("schema_")).length,
      0,
    );
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
  }
});

test("an unlisted site goes straight to Claude without a Codex run", async () => {
  const claude = fakeClaude();
  const runner = fakeRunner(['{"title":"codex","score":2}']);
  const llm = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["doc"],
    run: runner.run,
    tmpDir: tmp(),
  });
  const r = await llm.structured({
    site: "editorial",
    system: "S",
    content: "C",
    schema: Answer,
  });
  assert.deepEqual(r, { title: "claude", score: 1 });
  assert.equal(runner.seen.length, 0);
});

test("an answer that misses the schema is asked for once more with the error, then Claude answers", async () => {
  const claude = fakeClaude();
  const runner = fakeRunner([
    "not json at all",
    '{"title":"fixed","score":"high"}',
  ]);
  const llm = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["*"],
    run: runner.run,
    tmpDir: tmp(),
  });
  const r = await llm.structured({
    site: "doc.chapter",
    system: "S",
    content: "C",
    schema: Answer,
  });
  assert.equal(runner.seen.length, 2);
  assert.match(
    runner.seen[1]!.prompt,
    /previous reply was not valid: not JSON/,
  );
  // The second answer parsed as JSON but failed Zod (score is a string), so Claude took the call.
  assert.deepEqual(r, { title: "claude", score: 1 });
  assert.equal(claude.calls.length, 1);
});

test("a retry that fits the schema is accepted and names the Zod problem in its prompt", async () => {
  const claude = fakeClaude();
  const runner = fakeRunner([
    '{"title":"x"}',
    '{"title":"x","score":3,"note":null}',
  ]);
  const llm = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["*"],
    run: runner.run,
    tmpDir: tmp(),
  });
  const r = await llm.structured({
    site: "doc.chapter",
    system: "S",
    content: "C",
    schema: Answer,
  });
  assert.deepEqual(r, { title: "x", score: 3 });
  assert.match(runner.seen[1]!.prompt, /score/);
  assert.equal(claude.calls.length, 0);
});

test("a Codex failure (the runner raising) falls back to Claude for that call", async () => {
  const claude = fakeClaude();
  const runner = fakeRunner([]);
  const llm = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["*"],
    run: runner.run,
    tmpDir: tmp(),
  });
  const r = await llm.structured({
    site: "doc.chapter",
    system: "S",
    content: "C",
    schema: Answer,
  });
  assert.deepEqual(r, { title: "claude", score: 1 });
  assert.equal(runner.seen.length, 1);
  assert.equal(claude.calls.length, 1);
});

test("images go to Claude unless CODEX_VISION is on, then travel as files beside the text", async () => {
  const dir = tmp();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const content = [
    { type: "text" as const, text: "Frame 1 of 1" },
    {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/png" as const,
        data: png.toString("base64"),
      },
    },
    { type: "text" as const, text: "Headline: X" },
  ];
  const claude = fakeClaude();
  const runner = fakeRunner([
    '{"title":"seen","score":1}',
    '{"title":"seen","score":1}',
  ]);
  const off = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["*"],
    run: runner.run,
    tmpDir: dir,
  });
  await off.structured({
    site: "vision",
    system: "S",
    content,
    schema: Answer,
  });
  assert.equal(runner.seen.length, 0);
  assert.equal(claude.calls.length, 1);
  // With the switch on, the runner sees the decoded image on disk while it runs.
  let bytesSeen: Buffer | undefined;
  const peek = async (req: CodexRequest) => {
    bytesSeen = fs.readFileSync(req.images![0]!);
    return runner.run(req);
  };
  const peeking = createCodexLlm(claude.llm, {
    enabled: true,
    sites: ["*"],
    vision: true,
    run: peek,
    tmpDir: dir,
  });
  const r = await peeking.structured({
    site: "vision",
    system: "S",
    content,
    schema: Answer,
  });
  assert.deepEqual(r, { title: "seen", score: 1 });
  assert.equal(runner.seen.length, 1);
  const req = runner.seen[0]!;
  assert.equal(req.images?.length, 1);
  assert.match(req.images![0]!, /\.png$/);
  assert.deepEqual(bytesSeen, png);
  assert.match(req.prompt, /Frame 1 of 1\nHeadline: X/);
  assert.doesNotMatch(req.prompt, /iVBOR/);
  // The image file was written for the run and removed after it.
  assert.equal(fs.existsSync(req.images![0]!), false);
});
