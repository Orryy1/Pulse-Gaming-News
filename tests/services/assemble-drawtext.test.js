"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeFootageAttributionText } = require("../../assemble");

test("makeFootageAttributionText avoids drawtext option separators", () => {
  const text = makeFootageAttributionText("Steam: Store");

  assert.equal(text, "Footage - Steam Store");
  assert.equal(text.includes(":"), false);
});
