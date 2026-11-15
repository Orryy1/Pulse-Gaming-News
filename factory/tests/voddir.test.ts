import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_VOD_DIR, USB_VOD_DIR, vodDirectory } from "../src/voddir.ts";

test("stream recordings go to the USB drive when it is writable, else the Mac's own Videos folder", () => {
  assert.equal(
    vodDirectory({}, () => true),
    USB_VOD_DIR,
  );
  assert.equal(
    vodDirectory({}, () => false),
    HOME_VOD_DIR,
  );
  assert.equal(
    vodDirectory({ VOD_DIR: "/x/y" }, () => true),
    "/x/y",
  );
});
