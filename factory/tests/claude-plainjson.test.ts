// 19 Nov 2026: Claude refused ep_20261119_aeff0c03's script three times with 400 "The compiled grammar is too large"
// (the writers' room layout, then the writer's desk and payoff format). The same call now goes once more without the
// strict format, with the schema in the prompt, and the answer is checked against the schema here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  createClaude,
  isGrammarTooLarge,
  parsePlainJson,
} from "../src/editorial/llm.ts";

const GRAMMAR = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message:
      "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
  },
};

const Schema = z.object({ title: z.string(), beats: z.array(z.string()) });

function message(text: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

/** createClaude on a fake fetch: the first answer per call is `first`, then `then` (the plain retry). */
async function withFakeApi(
  answers: Array<{ status: number; body: unknown }>,
  fn: (bodies: any[]) => Promise<void>,
) {
  const bodies: any[] = [];
  const origFetch = globalThis.fetch;
  const origKey = process.env.ANTHROPIC_API_KEY;
  const origData = process.env.DATA_DIR;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "plainjson-"));
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const a = answers.shift() ?? {
      status: 500,
      body: { error: "no more answers" },
    };
    return new Response(JSON.stringify(a.body), {
      status: a.status,
      headers: {
        "content-type": "application/json",
        "x-should-retry": "false",
      },
    });
  }) as typeof fetch;
  try {
    await fn(bodies);
  } finally {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origKey;
    if (origData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origData;
  }
}

test("a grammar-too-large 400 is answered once more as plain JSON, checked against the schema", async () => {
  await withFakeApi(
    [
      { status: 400, body: GRAMMAR },
      {
        status: 200,
        body: message(
          'Here it is:\n{"title":"GTA 6 goes digital","beats":["one","two"]}',
        ),
      },
    ],
    async (bodies) => {
      const llm = createClaude("claude-opus-5-5");
      const out = await llm.structured({
        system: "You write.",
        content: "Write it.",
        schema: Schema,
        site: "room.layout",
      });
      assert.deepEqual(out, {
        title: "GTA 6 goes digital",
        beats: ["one", "two"],
      });
      assert.equal(bodies.length, 2);
      assert.ok(bodies[0].output_config.format, "the first call is strict");
      assert.equal(
        bodies[1].output_config.format,
        undefined,
        "the retry has no strict format",
      );
      assert.match(JSON.stringify(bodies[1].messages), /JSON Schema/);
    },
  );
});

test("when the plain answer does not fit the schema, the grammar error stands (so the Codex router can take it)", async () => {
  await withFakeApi(
    [
      { status: 400, body: GRAMMAR },
      { status: 200, body: message('{"title": 5}') },
    ],
    async (bodies) => {
      const llm = createClaude("claude-opus-5-5");
      await assert.rejects(
        llm.structured({ system: "s", content: "c", schema: Schema }),
        (err: unknown) => isGrammarTooLarge(err),
      );
      assert.equal(bodies.length, 2);
    },
  );
});

test("any other 400 is not retried", async () => {
  await withFakeApi(
    [
      {
        status: 400,
        body: {
          type: "error",
          error: { type: "invalid_request_error", message: "bad" },
        },
      },
    ],
    async (bodies) => {
      const llm = createClaude("claude-opus-5-5");
      await assert.rejects(
        llm.structured({ system: "s", content: "c", schema: Schema }),
      );
      assert.equal(bodies.length, 1);
    },
  );
});

test("parsePlainJson takes the JSON object out of the answer and rejects what does not fit", () => {
  const ok = parsePlainJson(Schema, {
    stop_reason: "end_turn",
    content: [{ type: "text", text: '```json\n{"title":"a","beats":[]}\n```' }],
  });
  assert.deepEqual(ok, { ok: true, value: { title: "a", beats: [] } });
  assert.equal(
    parsePlainJson(Schema, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "no" }],
    }).ok,
    false,
  );
  assert.equal(
    parsePlainJson(Schema, { stop_reason: "max_tokens", content: [] }).ok,
    false,
  );
});
