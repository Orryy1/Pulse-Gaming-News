import { test } from "node:test";
import assert from "node:assert/strict";
import { keyTime, momentKeys, momentWindows } from "../src/render/longplan.ts";

const say = (text: string, from = 0, step = 0.4) =>
  text.split(" ").map((t, i) => ({ text: t, start: from + i * step, end: from + i * step + 0.3 }));

test("a key is found where the narrator says it, spoken forms included", () => {
  const w = say("It launched at fifty-nine dollars ninety-nine and sold sixteen thousand nine hundred eighty-one copies");
  assert.equal(keyTime(w, 0, w.length, "$59.99"), w[3]!.start);
  assert.equal(keyTime(w, 0, w.length, "16,981 copies"), w[8]!.start);
  const g = say("Two years later Rockstar went from one city to an entire state with Grand Theft Auto 5");
  assert.equal(keyTime(g, 0, g.length, "GTA V"), undefined);
  assert.equal(keyTime(g, 0, g.length, "Grand Theft Auto V"), g[13]!.start);
  assert.equal(keyTime(g, 0, g.length, "Rockstar"), g[3]!.start);
  assert.equal(keyTime(g, 0, g.length, "Liberty City"), undefined);
});

test("moment keys: the graphic's figure, then the caption, the person and the names in the shot", () => {
  assert.deepEqual(
    momentKeys({
      show: "Tommy Vercetti driving through Vice City at night",
      graphic: { kind: "stat", primary: "16,981 players", secondary: "on Steam right now" },
      emphasis: "pure PS2",
      person: "Tommy Vercetti",
    }),
    ["16,981 players", "pure PS2", "Tommy Vercetti", "Tommy Vercetti", "Vice City"],
  );
  assert.deepEqual(momentKeys({ show: "a list", graphic: { kind: "list", primary: "Cities", secondary: "", items: ["Liberty City", "Vice City"] }, emphasis: "" }), ["Liberty City", "Vice City"]);
});

test("each sentence's moment is anchored on its key word; the first stays on the rank card", () => {
  const segText = "Vice City is next. It is a long sentence that only later mentions Tommy Vercetti by name. Short one.";
  const words = say(segText, 10, 0.3);
  const segments = [{ kind: "beat", text: segText, start: 10, end: 10 + words.length * 0.3 } as never];
  const keys = [[["Vice City"], ["Tommy Vercetti"], ["nothing here"]]];
  const ws = momentWindows(segments, words, [3], keys);
  assert.equal(ws.length, 3);
  assert.equal(ws[0]!.at, ws[0]!.start);
  const tommy = words.findIndex((w) => w.text === "Tommy");
  assert.equal(ws[1]!.at, words[tommy]!.start);
  assert.ok(ws[1]!.at > ws[1]!.start + 1);
  assert.equal(ws[2]!.at, ws[2]!.start);
});
