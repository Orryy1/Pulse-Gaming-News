import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_CHECK_LABEL,
  pulseCheckProblems,
  pulseCheckReading,
  pulseCheckRule,
} from "../src/editorial/newssegment.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import { goodScript } from "./helpers.ts";

const script = (narration: string, over: object = {}) =>
  goodScript({
    pulse_take: {
      label: PULSE_CHECK_LABEL,
      narration,
      on_screen: "STEADY: nothing changes yet",
    },
    ...over,
  });

test("the reading is read from the take's last sentence", () => {
  assert.equal(
    pulseCheckReading("You can wait. Pulse check: weak, if you buy day one."),
    "weak",
  );
  assert.equal(pulseCheckReading("Pulse check: steady."), "steady");
  assert.equal(
    pulseCheckReading("Pulse check: steady. You can wait."),
    undefined,
  );
  assert.equal(pulseCheckReading("Pulse check: great."), undefined);
  assert.equal(pulseCheckReading("You can wait."), undefined);
});

test("a right Pulse Check passes", () => {
  assert.deepEqual(
    pulseCheckProblems(script("You can wait a week. Pulse check: steady.")),
    [],
  );
});

test("a rumor can only read faint, so a report is never rated as if it were confirmed", () => {
  const strong = script("It looks real. Pulse check: strong.", {
    is_rumour: true,
    pulse_take: {
      label: PULSE_CHECK_LABEL,
      narration: "It looks real. Pulse check: strong.",
      on_screen: "STRONG: it looks real",
    },
  });
  assert.match(pulseCheckProblems(strong).join(), /reads faint/);
  const faint = script(
    "Sony has not said. Pulse check: faint, until it does.",
    {
      is_rumour: true,
      pulse_take: {
        label: PULSE_CHECK_LABEL,
        narration: "Sony has not said. Pulse check: faint, until it does.",
        on_screen: "FAINT: Sony has not said",
      },
    },
  );
  assert.deepEqual(pulseCheckProblems(faint), []);
});

test("it sends back a take that drops it, is only the reading, runs long, repeats it or mislabels the card", () => {
  assert.match(pulseCheckProblems(script("You can wait.")).join(), /must end/);
  assert.match(
    pulseCheckProblems(script("Pulse check: steady.")).join(),
    /only sentence/,
  );
  assert.match(
    pulseCheckProblems(
      script(
        "You can wait. Pulse check: steady, because nothing about this changes what you should do next.",
      ),
    ).join(),
    /keep it to/,
  );
  assert.match(
    pulseCheckProblems(
      script("You can wait. Pulse check: steady.", {
        loop_line: "Pulse check on the next one?",
      }),
    ).join(),
    /once/,
  );
  assert.match(
    pulseCheckProblems(
      goodScript({
        pulse_take: {
          label: "THE VERDICT",
          narration: "You can wait. Pulse check: steady.",
          on_screen: "nothing changes",
        },
      }),
    ).join(),
    /label[\s\S]*on-screen/,
  );
});

test("the rule keeps the word limit, the loop line and the desk order, and scripts stay American", () => {
  const rule = pulseCheckRule();
  assert.match(rule, /word limit stands/);
  assert.match(rule, /loop_line still follows/);
  assert.match(rule, /answer the desk question/);
  assert.match(rule, /rumor/);
  assert.doesNotMatch(rule.replace(/is_rumour/g, ""), /rumour/);
  assert.doesNotMatch(rule, /—/);
});

test("the writer gets the rule only when asked, and the system prompt never changes", async () => {
  const seen: Array<{ system: string; content: string }> = [];
  const llm = {
    structured: async (o: any) => {
      seen.push(o);
      return goodScript();
    },
  } as any;
  const cluster = {
    hash: "x",
    headline: "h",
    items: [],
    sources: [],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: "2026-11-04T00:00:00Z",
    score: 1,
  } as any;
  await writeScript(llm, cluster, [], { mustLabelRumour: false });
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    segment: true,
  });
  assert.doesNotMatch(seen[0]!.content, /Pulse check/i);
  assert.match(seen[1]!.content, /Pulse check/i);
  assert.equal(seen[0]!.system, seen[1]!.system);
});
