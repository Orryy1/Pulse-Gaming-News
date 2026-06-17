"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDiscordFeedbackIngestionReport,
  classifyDiscordFeedbackMessage,
  fetchDiscordChannelMessages,
} = require("../../lib/ops/discord-feedback-ingestion");

test("classifies Discord feedback about wrong footage, stretched TTS and confusing transcript", () => {
  const item = classifyDiscordFeedbackMessage({
    id: "m1",
    timestamp: "2026-06-17T10:12:00.000Z",
    author: { username: "Martin" },
    content:
      "fresh_xbox_fable_living_population_20260610 latest Short has wrong Fable clips, the TTS sounds slowed and the transcript is confusing.",
  });

  assert.equal(item.actionable, true);
  assert.equal(item.story_id, "fresh_xbox_fable_living_population_20260610");
  assert.deepEqual(item.categories, ["wrong_visuals", "tts_voice_quality", "transcript_confusing"]);
  assert.equal(item.severity, "high");
});

test("builds a blocking ingestion report when recent feedback targets selected story", () => {
  const report = buildDiscordFeedbackIngestionReport({
    generatedAt: "2026-06-17T10:20:00.000Z",
    selectedStoryIds: ["fresh_xbox_fable_living_population_20260610"],
    candidateReport: {
      candidates: [{ id: "fresh_xbox_fable_living_population_20260610", title: "Fable Has A Footage Problem" }],
    },
    messages: [
      {
        id: "m1",
        timestamp: "2026-06-17T10:12:00.000Z",
        author: { username: "Martin" },
        content:
          "fresh_xbox_fable_living_population_20260610 newest upload has wrong clips and the narration sounds stretched.",
      },
    ],
  });

  assert.equal(report.capability.status, "loaded");
  assert.equal(report.summary.actionable_count, 1);
  assert.equal(report.summary.blocking_count, 1);
  assert.equal(report.items[0].state, "current_selected_feedback_blocker");
  assert.equal(report.items[0].blocks_publishing, true);
});

test("reports missing Discord channel ID without attempting a read when discovery is disabled", async () => {
  let called = false;
  const report = await fetchDiscordChannelMessages({
    env: { DISCORD_BOT_TOKEN: "present", DISCORD_FEEDBACK_CHANNEL_DISCOVERY: "false" },
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => [] };
    },
  });

  assert.equal(called, false);
  assert.equal(report.capability.status, "missing_channel_id");
  assert.deepEqual(report.messages, []);
});

test("discovers pulse-gaming channel by name when only a bot token is configured", async () => {
  const calls = [];
  const report = await fetchDiscordChannelMessages({
    env: { DISCORD_BOT_TOKEN: "present" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/users/@me/guilds")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "guild-1", name: "Pulse Gaming" }],
        };
      }
      if (url.endsWith("/guilds/guild-1/channels")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "general-1", name: "general", type: 0 },
            { id: "pulse-1", name: "pulse-gaming", type: 0 },
          ],
        };
      }
      if (url.includes("/channels/pulse-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m1", content: "latest short transcript is confusing", timestamp: "2026-06-17T10:12:00.000Z" }],
        };
      }
      return { ok: false, status: 404, statusText: "not found", json: async () => ({}) };
    },
  });

  assert.equal(report.capability.status, "loaded");
  assert.equal(report.capability.channel_id_configured, false);
  assert.equal(report.capability.channel_id_discovered, true);
  assert.equal(report.capability.channel_name, "pulse-gaming");
  assert.equal(report.messages.length, 1);
  assert.equal(calls.some((url) => url.includes("/channels/pulse-1/messages")), true);
});
