"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSubjectGraph } = require("../../lib/exact-subject-matching");

test("subject graph treats canonical game from governed manifests as a required media subject", () => {
  const graph = buildSubjectGraph({
    id: "canonical_story",
    title: "The Secret Problem Is Getting Louder",
    full_script: "Players are debating the new update.",
    canonical_game: "Crimson Desert",
    canonical_subject: "Crimson Desert",
  });

  assert.ok(graph.games.includes("Crimson Desert"));
  assert.ok(graph.required_subject_groups.includes("Crimson Desert"));
});

test("subject graph keeps Xbox hardware products separate from the Xbox platform", () => {
  const graph = buildSubjectGraph({
    id: "xbox_controller_story",
    title: "Xbox Controller Deal Has One Catch",
    full_script: "Xbox controller deals are getting aggressive, but the catch is the retailer.",
    canonical_game: "Xbox Controller",
    canonical_subject: "Xbox Controller",
  });

  assert.ok(graph.games.includes("Xbox Controller"));
  assert.deepEqual(graph.required_subject_groups, ["Xbox Controller"]);
});
