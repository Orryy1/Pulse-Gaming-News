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
