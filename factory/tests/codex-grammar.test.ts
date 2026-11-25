// CODEX_GRAMMAR_FALLBACK (19 Nov 2026): Claude turned the writers' room layout down three times with "The compiled
// grammar is too large", and the Short failed. A format too big for Claude now goes to Codex instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createCodexLlm, isGrammarTooLarge } from "../src/editorial/codex.ts";
import type { Llm } from "../src/editorial/llm.ts";

// The real error text Anthropic returned on 19 Nov (request id dropped).
const GRAMMAR =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools."}}';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "grammar-"));

function rig(o: { fallback?: boolean; codex?: string[]; claudeError?: string; vision?: boolean }) {
  const counts = { claude: 0, codex: 0 };
  const routed: string[] = [];
  const claude = {
    structured: async () => {
      counts.claude++;
      throw new Error(o.claudeError ?? GRAMMAR);
    },
  } as unknown as Llm;
  const answers = [...(o.codex ?? ['{"ok":true}'])];
  const llm = createCodexLlm(claude, {
    enabled: true,
    sites: ["doc"],
    vision: o.vision,
    tmpDir: tmp(),
    grammarFallback: o.fallback,
    onGrammarRouted: (s) => routed.push(s),
    run: async () => {
      counts.codex++;
      const a = answers.shift();
      if (a === undefined) throw new Error("codex exec failed (exit 1)");
      return a;
    },
  });
  return { llm, counts, routed };
}

const call = { system: "s", content: "c", schema: z.object({ ok: z.boolean() }), site: "room.layout" } as any;

test("the grammar refusal is recognised, and other errors are not", () => {
  assert.equal(isGrammarTooLarge(new Error(GRAMMAR)), true);
  assert.equal(isGrammarTooLarge(new Error("400 reduce the number of strict tools")), true);
  assert.equal(isGrammarTooLarge(new Error("529 overloaded")), false);
  assert.equal(isGrammarTooLarge(new Error("Claude usage limit reached")), false);
  assert.equal(isGrammarTooLarge(undefined), false);
});

test("on: a format too big for Claude is answered by Codex, and the step is named once a call", async () => {
  const { llm, counts, routed } = rig({ fallback: true });
  assert.deepEqual(await llm.structured(call), { ok: true });
  assert.equal(counts.claude, 1);
  assert.equal(counts.codex, 1);
  assert.deepEqual(routed, ["room.layout"]);
});

test("off: the grammar error stands, as before", async () => {
  const { llm, counts } = rig({ fallback: false });
  await assert.rejects(llm.structured(call), /compiled grammar is too large/);
  assert.equal(counts.codex, 0);
});

test("Codex failing too ends the call without asking Claude again (no loop)", async () => {
  const { llm, counts } = rig({ fallback: true, codex: [] });
  await assert.rejects(llm.structured(call), /codex exec failed/);
  assert.equal(counts.claude, 1);
  assert.equal(counts.codex, 1);
});

test("Codex's first answer off-schema gets its one retry, then the answer is kept", async () => {
  const { llm, counts } = rig({ fallback: true, codex: ['{"ok":"yes"}', '{"ok":false}'] });
  assert.deepEqual(await llm.structured(call), { ok: false });
  assert.equal(counts.codex, 2);
});

test("other Claude errors are untouched by the setting", async () => {
  const { llm, counts } = rig({ fallback: true, claudeError: "529 overloaded" });
  await assert.rejects(llm.structured(call), /529/);
  assert.equal(counts.codex, 0);
});

test("a picture call stays off Codex unless CODEX_VISION allows images", async () => {
  const img = {
    ...call,
    content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }, { type: "text", text: "c" }],
  };
  const off = rig({ fallback: true });
  await assert.rejects(off.llm.structured(img), /compiled grammar/);
  assert.equal(off.counts.codex, 0);
  const on = rig({ fallback: true, vision: true });
  assert.deepEqual(await on.llm.structured(img), { ok: true });
});
