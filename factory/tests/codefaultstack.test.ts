import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFaultStack } from "../src/lib/util.ts";

// 22-23 Nov: "Cannot read properties of undefined (reading 'primary')" lost two news Shorts and the log had no trace.
test("a code fault keeps where it broke; an ordinary failure adds nothing", () => {
  let fault: unknown;
  try {
    (undefined as unknown as { primary: string }).primary;
  } catch (e) {
    fault = e;
  }
  const out = codeFaultStack(fault);
  assert.ok(out.stack?.includes("codefaultstack.test.ts"), String(out.stack));
  assert.deepEqual(codeFaultStack(new Error("QA failed: frame 3")), {});
  assert.deepEqual(codeFaultStack("plain string"), {});
});
