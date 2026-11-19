// SIGNED_LIGHT_INDEX (19 Nov 2026): an age-gated upload's details and captions read again signed in, skip-download only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lightSignedOptions } from "../src/sceneindex/light.ts";
import { signedPull } from "../src/lib/ytsignin.ts";
import { currentYtPurpose } from "../src/lib/ytguard.ts";

const URL = "https://www.youtube.com/watch?v=byDw86z-oZo";
const AGE =
  "ERROR: [youtube] byDw86z-oZo: Sign in to confirm your age. This video may be inappropriate for some users.";
const COOKIES = ["--cookies", "/data/yt_cookies.txt"];
const DETAILS = [
  "--encoding",
  "utf-8",
  "--no-warnings",
  "--no-playlist",
  "--skip-download",
  "--dump-single-json",
  URL,
];

test("light index: the switch is off by default and read from the environment", () => {
  assert.equal(lightSignedOptions({}).enabled, false);
  assert.equal(
    lightSignedOptions({ SIGNED_LIGHT_INDEX: "true" }).enabled,
    true,
  );
  assert.equal(
    lightSignedOptions({ SIGNED_LIGHT_INDEX: "true" }).purpose,
    "clip",
    "the same share as the clips",
  );
});

test("light index: an age-gated upload's details are read again signed in, without a download", async () => {
  const seen: Array<{ args: string[]; purpose: string }> = [];
  const attempt = async (args: string[]) => {
    seen.push({ args, purpose: currentYtPurpose() });
    if (args[0] !== "--cookies")
      throw Object.assign(new Error("Command failed: yt-dlp"), { stderr: AGE });
    return { stdout: '{"id":"byDw86z-oZo"}', stderr: "" };
  };
  const deps = { cookies: async () => COOKIES, knownGated: () => false };
  const r = await signedPull(
    DETAILS,
    attempt,
    lightSignedOptions({ SIGNED_LIGHT_INDEX: "true" }),
    deps,
  );
  assert.equal(JSON.parse(r.stdout).id, "byDw86z-oZo");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1]!.args, [...COOKIES, ...DETAILS]);
  assert.ok(seen[1]!.args.includes("--skip-download"));
  assert.equal(seen[1]!.purpose, "clip");
  const off: string[][] = [];
  await assert.rejects(
    signedPull(
      DETAILS,
      async (a) => (
        off.push(a),
        Promise.reject(Object.assign(new Error("x"), { stderr: AGE }))
      ),
      lightSignedOptions({}),
      deps,
    ),
  );
  assert.equal(off.length, 1, "off: the skip stays a skip");
});
