import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin.ts";
import {
  shrinkArgs,
  visionImage,
  VISION_MAX_SIDE,
} from "../src/assets/localvision.ts";

function hasFfmpeg(): boolean {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** Width and height of a JPEG from its SOF marker. */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no SOF");
}

test("shrinkArgs fits the picture inside the max side and never enlarges", () => {
  const args = shrinkArgs("in.png", 1600);
  const vf = args[args.indexOf("-vf") + 1]!;
  assert.match(vf, /min\(1600,iw\)/);
  assert.match(vf, /force_original_aspect_ratio=decrease/);
  assert.equal(args.at(-1), "pipe:1");
});

test(
  "a 4K frame reaches the vision model at most VISION_MAX_SIDE wide; a small one keeps its size",
  { skip: !hasFfmpeg() },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vshrink-"));
    const big = path.join(dir, "big.png");
    const small = path.join(dir, "small.png");
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=3840x2160",
      "-frames:v",
      "1",
      big,
    ]);
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360",
      "-frames:v",
      "1",
      small,
    ]);
    const b = jpegSize(Buffer.from(await visionImage(big), "base64"));
    assert.equal(b.w, VISION_MAX_SIDE);
    assert.equal(b.h, 900);
    const s = jpegSize(Buffer.from(await visionImage(small), "base64"));
    assert.deepEqual(s, { w: 640, h: 360 });
    fs.rmSync(dir, { recursive: true, force: true });
  },
);

test("a file ffmpeg cannot read goes as its original bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vshrink-"));
  const junk = path.join(dir, "junk.png");
  fs.writeFileSync(junk, "not a picture");
  assert.equal(
    Buffer.from(await visionImage(junk), "base64").toString(),
    "not a picture",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
