// Item 13: the "why it died" strand, its topics from the news desk and a concrete loss in every title.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE,
  WHY_DIED_MINUTES,
  lossPhrase,
  lossThumb,
  pickWhyDied,
  whyDiedDue,
  whyDiedProposals,
  whyDiedTitle,
  whyDiedTopic,
  type NewsStory,
} from "../src/whydied.ts";
import { strandTitleProblems } from "../src/strandframe.ts";
import { outlineDoc } from "../src/editorial/documentary.ts";

const now = new Date("2026-11-14T12:00:00Z");
const story = (headline: string, game: string, daysAgo: number): NewsStory => ({
  headline,
  game,
  at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
});

test("failure headlines, and the ones that are not", () => {
  assert.ok(FAILURE.test("Concord servers go offline two weeks after launch"));
  assert.ok(FAILURE.test("Studio closes after its shooter flopped"));
  assert.ok(FAILURE.test("XDefiant player count drops 90% in a month"));
  assert.ok(!FAILURE.test("GTA 6 trailer breaks YouTube records"));
});

test("the loss a headline states, as the title says it", () => {
  assert.equal(
    lossPhrase(["Player count drops 90% in two months"]),
    "90% of Its Players in 2 Months",
  );
  assert.equal(lossPhrase(["Sony takes a $200 million hit"]), "$200 Million");
  assert.equal(
    lossPhrase(["Servers shut down after 12 days"]),
    "Its Players in 12 Days",
  );
  assert.equal(lossPhrase(["The studio is closing"]), undefined);
  assert.equal(lossThumb("90% of Its Players in 2 Months"), "90%");
  assert.equal(lossThumb("$200 Million"), "$200M");
  assert.equal(lossThumb("Its Players in 12 Days"), "12 DAYS");
});

test("the title is in the strand's frame", () => {
  const t = whyDiedTitle("Concord", "Its Players in 12 Days")!;
  assert.equal(t, "How Concord Lost Its Players in 12 Days");
  assert.deepEqual(strandTitleProblems("whydied", t, "Concord"), []);
  assert.equal(
    whyDiedTitle("A".repeat(60), "$200 Million"),
    undefined,
    "over 70 characters",
  );
});

test("proposals: two or more failure stories, recent, with a stated loss, not already made", () => {
  const stories = [
    story("Concord servers go offline after 12 days", "Concord", 400),
    story("Sony refunds every Concord buyer", "Concord", 398),
    story("Concord is great", "Concord", 10),
    story("XDefiant player count drops 90% in two months", "XDefiant", 200),
    story("Ubisoft confirms XDefiant shut down", "XDefiant", 150),
    story("Anthem servers shut down for good", "Anthem", 700), // too old
    story("Anthem servers shut down after 6 years", "Anthem", 650),
    story("Skull and Bones layoffs", "Skull and Bones", 30), // one story only
    story("Hyenas cancelled after $200 million", "Hyenas", 90),
    story("Hyenas studio layoffs", "Hyenas", 80),
  ];
  const got = whyDiedProposals(stories, now, ["Hyenas"]);
  assert.deepEqual(
    got.map((p) => p.game),
    ["XDefiant", "Concord"],
  );
  assert.equal(
    got[0]!.title,
    "How XDefiant Lost 90% of Its Players in 2 Months",
  );
  assert.equal(got[1]!.loss, "Its Players in 12 Days");
  assert.equal(
    got[1]!.stories.length,
    2,
    "the non-failure story is not counted",
  );
});

test("cadence and the topic it makes", () => {
  assert.equal(whyDiedDue(undefined, now, 14), true);
  assert.equal(whyDiedDue("2026-11-05T00:00:00Z", now, 14), false);
  assert.equal(whyDiedDue("2026-10-20T00:00:00Z", now, 14), true);
  const topic = whyDiedTopic({
    game: "Concord",
    title: "How Concord Lost Its Players in 12 Days",
    loss: "Its Players in 12 Days",
    stories: ["a", "b"],
    newest: now.toISOString(),
    score: 2,
  });
  assert.equal(topic.kind, "story");
  assert.equal(topic.title_idea, "How Concord Lost Its Players in 12 Days");
  assert.deepEqual(topic.why_died?.minutes, WHY_DIED_MINUTES);
});

test("pickWhyDied: off does nothing; on reads the desk and writes the proposals", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "whydied-"));
  const db = {
    query: async (sql: string) => {
      if (/max\(created_at\)/.test(sql)) return [{ at: null }];
      if (/->>'game' AS game/.test(sql)) return [];
      return [
        story("Concord servers go offline after 12 days", "Concord", 400),
        story("Sony refunds every Concord buyer", "Concord", 398),
      ];
    },
  } as never;
  const cfg = {
    whyDied: false,
    whyDiedFile: "",
    whyDiedEveryDays: 14,
    dataDir: dir,
  };
  assert.equal(await pickWhyDied({ db, cfg }, now, []), undefined);
  const got = await pickWhyDied(
    { db, cfg: { ...cfg, whyDied: true } },
    now,
    [],
  );
  assert.equal(
    got?.topic.title_idea,
    "How Concord Lost Its Players in 12 Days",
  );
  const file = JSON.parse(
    await fs.readFile(path.join(dir, "whydied_slate.json"), "utf8"),
  );
  assert.equal(file.proposals[0].game, "Concord");
  assert.equal(
    await pickWhyDied({ db, cfg: { ...cfg, whyDied: true } }, now, ["Concord"]),
    undefined,
    "already made",
  );
});

test("the outline writer is told the strand's rule only for a why-it-died topic", async () => {
  const seen: string[] = [];
  const llm = {
    structured: async (o: { system: string }) => (seen.push(o.system), {}),
  } as never;
  const topic = whyDiedTopic({
    game: "Concord",
    title: "How Concord Lost Its Players in 12 Days",
    loss: "x",
    stories: [],
    newest: "",
    score: 0,
  });
  await outlineDoc(llm, topic, "notes");
  await outlineDoc(llm, { ...topic, why_died: undefined }, "notes");
  assert.match(seen[0]!, /"why it died" film/);
  assert.match(seen[0]!, /25 to 35 minutes/);
  assert.doesNotMatch(seen[1]!, /"why it died" film/);
});
