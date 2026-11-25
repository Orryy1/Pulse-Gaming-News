import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_VOD_DIR, USB_VOD_DIR, vodDirectory } from "../src/voddir.ts";

test("stream recordings stay at home unless VOD_DIR opts in; usb falls back when not writable", () => {
  let probed = false;
  assert.equal(
    vodDirectory({}, () => {
      probed = true;
      return true;
    }),
    HOME_VOD_DIR,
  );
  assert.equal(probed, false, "no default probe of /Volumes");
  assert.equal(vodDirectory({ VOD_DIR: "usb" }, () => true), USB_VOD_DIR);
  assert.equal(vodDirectory({ VOD_DIR: "usb" }, () => false), HOME_VOD_DIR);
  assert.equal(vodDirectory({ VOD_DIR: "/x/y" }, () => true), "/x/y");
});

test("the drive test answers within its time limit: a folder it can write is true, an impossible one false", async () => {
  const { writableDir } = await import("../src/voddir.ts");
  const os = await import("node:os");
  const path = await import("node:path");
  const ok = path.join(os.tmpdir(), `vodtest-${process.pid}`);
  assert.equal(writableDir(ok, 5000), true);
  const bad = process.platform === "win32" ? "Z:\\nope\\x" : "/proc/nope/x";
  const t0 = Date.now();
  assert.equal(writableDir(bad, 2000), false);
  assert.ok(Date.now() - t0 < 4000);
});
