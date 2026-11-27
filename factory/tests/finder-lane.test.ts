import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { finderEnv } from "../src/macgameplay.ts";

test("the gameplay finder runs in the Mac turn-taker's short lane", () => {
  const base = { PATH: "/usr/bin", VOD_DIR: "/v" };
  const env = finderEnv(base);
  assert.equal(env.MACRUN_LANE, "short");
  assert.equal(env.MACRUN_SHORT_MAX_MIN, "30");
  assert.equal(env.VOD_DIR, "/v");
  // The VOD download keeps the main lane: the shared env is not changed.
  assert.equal((base as NodeJS.ProcessEnv).MACRUN_LANE, undefined);
  // The finder call itself uses it.
  const src = fs.readFileSync(new URL("../src/macgameplay.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /behindRenders\("pulse-finder"[^;]*;\s*await run\(c, a, \{ \.\.\.opts, env: finderEnv\(env\) \}\)/,
  );
});
