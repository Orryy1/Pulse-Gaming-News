import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { finderEnv } from "../src/macgameplay.ts";

const src = () => fs.readFileSync(new URL("../src/macgameplay.ts", import.meta.url), "utf8");

test("the gameplay finder runs in the Mac turn-taker's short lane", () => {
  const base = { PATH: "/usr/bin", VOD_DIR: "/v" };
  const env = finderEnv(base);
  assert.equal(env.MACRUN_LANE, "short");
  assert.equal(env.MACRUN_SHORT_MAX_MIN, "30");
  assert.equal(env.VOD_DIR, "/v");
  // The VOD download keeps the main lane: the shared env is not changed.
  assert.equal((base as NodeJS.ProcessEnv).MACRUN_LANE, undefined);
  // The finder call itself uses it, and a failure there is caught.
  assert.match(
    src(),
    /behindRenders\("pulse-finder"[^;]*;[^]*?await run\(c, a, \{ \.\.\.opts, env: finderEnv\(env\) \}\)\.catch\(/,
  );
});

test("the finder runs before the VOD download, and either failing still reaches the disk rule", () => {
  const s = src();
  const finder = s.indexOf('behindRenders("pulse-finder"');
  const vods = s.indexOf('behindRenders("pulse-vods"');
  const clear = s.indexOf("vodsToClear(files");
  const finderRethrow = s.indexOf("if (finderError !== undefined) throw finderError;");
  const vodRethrow = s.indexOf("if (vodError !== undefined) throw vodError;");
  assert.ok(finder > 0 && vods > finder, "finder first");
  assert.ok(finderRethrow > clear, "a finder failure still lets the download and disk rule run");
  assert.ok(vodRethrow > finderRethrow, "download error raised after the disk rule");
});
