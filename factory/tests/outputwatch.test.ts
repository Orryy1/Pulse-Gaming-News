import { test } from "node:test";
import assert from "node:assert/strict";
import { quietTooLong } from "../src/outputwatch.ts";

const tz = "Europe/London";
test("a quiet spell is said only inside the working day and after four hours", () => {
  const at = (s: string) => new Date(s);
  assert.equal(quietTooLong(at("2026-11-06T11:45:00Z"), at("2026-11-06T17:00:00Z"), tz), true); // 6 Nov
  assert.equal(quietTooLong(at("2026-11-06T15:00:00Z"), at("2026-11-06T17:00:00Z"), tz), false);
  assert.equal(quietTooLong(at("2026-11-06T01:00:00Z"), at("2026-11-06T08:00:00Z"), tz), false); // before 10:00
  assert.equal(quietTooLong(at("2026-11-06T09:00:00Z"), at("2026-11-06T11:00:00Z"), tz), false); // day just began
});
