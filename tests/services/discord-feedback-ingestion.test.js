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

test("classifies Discord bot operations reports as actionable feedback jobs", () => {
  const report = buildDiscordFeedbackIngestionReport({
    generatedAt: "2026-06-18T12:50:00.000Z",
    messages: [
      {
        id: "bot-publish-held",
        timestamp: "2026-06-18T12:46:00.000Z",
        author: { username: "Pulse Gaming", bot: true },
        content:
          "Pulse Gaming Publish Held (job #47698)\nPublish held before upload.\nReason: publish_window_watchdog_red\nSafe: no\nBlockers: publish_readiness: local_restart_readiness: public script-validation fallback rows need repair before a clean resume",
      },
      {
        id: "bot-supply",
        timestamp: "2026-06-18T12:46:30.000Z",
        author: { username: "Pulse Gaming", bot: true },
        content:
          "Pulse Candidate Supply Monitor\nStatus: AMBER\nGREEN-ready: 1/10\nDurable GREEN: 1/10\nWarnings: green_ready_candidates_below_target:1/10; source_safe_candidates_below_target:1/6",
      },
    ],
  });

  assert.equal(report.summary.actionable_count, 2);
  assert.equal(report.summary.blocking_count, 1);
  assert.deepEqual(report.items[0].categories, ["publish_stalled", "readiness_blocked"]);
  assert.equal(report.items[0].state, "operational_feedback_blocker");
  assert.equal(report.items[0].blocks_publishing, true);
  assert.deepEqual(report.items[1].categories, ["candidate_supply_low"]);
  assert.equal(report.items[1].state, "operational_feedback_job");
  assert.equal(report.items[1].blocks_publishing, false);
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

test("reads pulse-gaming as well as generic video-drops feedback channel", async () => {
  const calls = [];
  const report = await fetchDiscordChannelMessages({
    env: { DISCORD_BOT_TOKEN: "present", DISCORD_CHANNEL_NAME: "video-drops" },
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
            { id: "drops-1", name: "video-drops", type: 0 },
            { id: "pulse-1", name: "pulse-gaming", type: 0 },
          ],
        };
      }
      if (url.includes("/channels/drops-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m-drops", content: "new video posted", timestamp: "2026-06-17T10:12:00.000Z" }],
        };
      }
      if (url.includes("/channels/pulse-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m-pulse", content: "latest short transcript is confusing", timestamp: "2026-06-17T10:13:00.000Z" }],
        };
      }
      return { ok: false, status: 404, statusText: "not found", json: async () => ({}) };
    },
  });

  assert.equal(report.capability.status, "loaded");
  assert.equal(report.capability.channel_count, 2);
  assert.match(report.capability.channel_name, /video-drops/);
  assert.match(report.capability.channel_name, /pulse-gaming/);
  assert.equal(report.messages.length, 2);
  assert.equal(calls.some((url) => url.includes("/channels/drops-1/messages")), true);
  assert.equal(calls.some((url) => url.includes("/channels/pulse-1/messages")), true);
});

test("discovers feedback, suggestions and video-drops by default", async () => {
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
            { id: "feedback-1", name: "feedback", type: 0 },
            { id: "suggestions-1", name: "suggestions", type: 0 },
            { id: "drops-1", name: "video-drops", type: 0 },
          ],
        };
      }
      if (url.includes("/channels/feedback-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m-feedback", content: "latest short transcript is confusing", timestamp: "2026-06-17T10:13:00.000Z" }],
        };
      }
      if (url.includes("/channels/suggestions-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m-suggestions", content: "make titles clearer", timestamp: "2026-06-17T10:14:00.000Z" }],
        };
      }
      if (url.includes("/channels/drops-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m-drops", content: "new video posted", timestamp: "2026-06-17T10:15:00.000Z" }],
        };
      }
      return { ok: false, status: 404, statusText: "not found", json: async () => ({}) };
    },
  });

  assert.equal(report.capability.status, "loaded");
  assert.equal(report.capability.channel_count, 3);
  assert.match(report.capability.channel_name, /feedback/);
  assert.match(report.capability.channel_name, /suggestions/);
  assert.match(report.capability.channel_name, /video-drops/);
  assert.equal(report.messages.length, 3);
  assert.equal(calls.some((url) => url.includes("/channels/feedback-1/messages")), true);
  assert.equal(calls.some((url) => url.includes("/channels/suggestions-1/messages")), true);
  assert.equal(calls.some((url) => url.includes("/channels/drops-1/messages")), true);
});

test("reports when the outbound Discord webhook target is not readable by feedback ingestion", async () => {
  const webhookUrl = "https://discord.com/api/webhooks/123456/redacted";
  const report = await fetchDiscordChannelMessages({
    env: {
      DISCORD_BOT_TOKEN: "present",
      DISCORD_WEBHOOK_URL: webhookUrl,
      DISCORD_GUILD_ID: "configured-guild",
    },
    fetchImpl: async (url) => {
      if (url === webhookUrl) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "webhook-1",
            name: "Pulse Gaming",
            guild_id: "webhook-guild",
            channel_id: "pulse-channel",
          }),
        };
      }
      if (url.endsWith("/users/@me/guilds")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "configured-guild", name: "Public Community" }],
        };
      }
      if (url.endsWith("/guilds/configured-guild/channels")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "feedback-1", name: "feedback", type: 0 }],
        };
      }
      if (url.includes("/channels/feedback-1/messages")) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        };
      }
      return { ok: false, status: 404, statusText: "not found", json: async () => ({}) };
    },
  });

  assert.equal(report.capability.status, "loaded_with_feedback_channel_gap");
  assert.equal(report.capability.webhook_target.channel_id, "pulse-channel");
  assert.equal(report.capability.webhook_target.matches_configured_guild, false);
  assert.equal(report.capability.webhook_channel_discovered, false);
  assert.equal(report.capability.feedback_gap, "webhook_channel_not_readable_by_bot_token");
  assert.match(report.capability.operator_actions[0], /DISCORD_FEEDBACK_CHANNEL_ID/);
});

test("builds ingestion health and missed-cycle alerts for webhook channel gaps", () => {
  const report = buildDiscordFeedbackIngestionReport({
    capability: {
      status: "loaded_with_feedback_channel_gap",
      channel_count: 4,
      messages_returned: 50,
      webhook_channel_discovered: false,
      feedback_gap: "webhook_channel_not_readable_by_bot_token",
      operator_actions: [
        "Set DISCORD_FEEDBACK_CHANNEL_ID to webhook-channel with a bot token that can read it.",
      ],
      rate_limit_retries: 1,
    },
    messages: [],
  });

  assert.equal(report.ingestion_health.status, "amber");
  assert.equal(report.ingestion_health.can_read_operational_alerts, false);
  assert.equal(report.ingestion_health.rate_limit_retries, 1);
  assert.deepEqual(report.ingestion_health.missed_cycle_alerts, [
    "discord_ingestion_loaded_with_feedback_channel_gap",
    "webhook_channel_not_readable_by_bot_token",
    "operational_alert_channel_not_ingested",
  ]);
  assert.match(report.ingestion_health.operator_actions[0], /DISCORD_FEEDBACK_CHANNEL_ID/);
});

test("Discord feedback ingestion retries message reads after 429 Retry-After", async () => {
  const calls = [];
  const slept = [];
  let messageReadAttempts = 0;
  const report = await fetchDiscordChannelMessages({
    env: { DISCORD_BOT_TOKEN: "present" },
    sleepMs: async (ms) => {
      slept.push(ms);
    },
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
          json: async () => [{ id: "feedback-1", name: "feedback", type: 0 }],
        };
      }
      if (url.includes("/channels/feedback-1/messages")) {
        messageReadAttempts += 1;
        if (messageReadAttempts === 1) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: { get: (name) => (String(name).toLowerCase() === "retry-after" ? "0.01" : null) },
            json: async () => ({ retry_after: 0.01 }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "m1", content: "latest short transcript is confusing", timestamp: "2026-06-18T10:13:00.000Z" }],
        };
      }
      return { ok: false, status: 404, statusText: "not found", json: async () => ({}) };
    },
  });

  assert.equal(report.capability.status, "loaded");
  assert.equal(report.messages.length, 1);
  assert.equal(messageReadAttempts, 2);
  assert.deepEqual(slept, [10]);
  assert.equal(report.capability.rate_limit_retries, 1);
  assert.equal(calls.some((url) => url.includes("/channels/feedback-1/messages")), true);
});
