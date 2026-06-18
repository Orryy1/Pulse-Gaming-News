"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUT = path.join(ROOT, "output", "discord-feedback-ingestion");
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_FEEDBACK_CHANNEL_NAMES = "feedback,suggestions,pulse-gaming,gaming-talk,video-drops";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(later, earlier) {
  const a = parseDate(later);
  const b = parseDate(earlier);
  if (!a || !b) return null;
  return Math.max(0, (a.getTime() - b.getTime()) / 36e5);
}

function authHeader(token = "") {
  const text = clean(token);
  if (!text) return "";
  return /^bot\s+/i.test(text) ? text : `Bot ${text}`;
}

function resolveChannelId(env = process.env) {
  return clean(
    env.DISCORD_FEEDBACK_CHANNEL_ID ||
      env.DISCORD_CHANNEL_ID ||
      env.DISCORD_PUBLIC_FEEDBACK_CHANNEL_ID,
  );
}

function resolveChannelNames(env = process.env) {
  const feedbackSpecific = clean(env.DISCORD_FEEDBACK_CHANNEL_NAME || env.DISCORD_PUBLIC_FEEDBACK_CHANNEL_NAME);
  const generic = clean(env.DISCORD_CHANNEL_NAME);
  const raw = feedbackSpecific || [generic, DEFAULT_FEEDBACK_CHANNEL_NAMES].filter(Boolean).join(",");
  const seen = new Set();
  return clean(raw)
    .split(/[,\n;]/)
    .map((name) => clean(name).replace(/^#/, "").toLowerCase())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function channelDiscoveryEnabled(env = process.env) {
  return clean(env.DISCORD_FEEDBACK_CHANNEL_DISCOVERY || "true").toLowerCase() !== "false";
}

function resolveBotToken(env = process.env) {
  return clean(env.DISCORD_BOT_TOKEN || env.PULSE_DISCORD_BOT_TOKEN);
}

async function fetchDiscordJson(fetchImpl, url, token) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(token),
      "User-Agent": "PulseGamingFeedbackIngestion/1.0",
    },
  });
  if (!res || !res.ok) {
    return {
      ok: false,
      status: res?.status || null,
      statusText: res?.statusText || "discord_read_failed",
      payload: null,
    };
  }
  return {
    ok: true,
    status: res.status || 200,
    statusText: res.statusText || "OK",
    payload: await res.json(),
  };
}

async function discoverDiscordFeedbackChannel({
  env = process.env,
  token = resolveBotToken(env),
  fetchImpl = global.fetch,
} = {}) {
  const channelNames = resolveChannelNames(env);
  if (!channelDiscoveryEnabled(env)) {
    return {
      channelId: "",
      capability: { status: "missing_channel_id", required_env: "DISCORD_FEEDBACK_CHANNEL_ID" },
    };
  }
  if (typeof fetchImpl !== "function") {
    return { channelId: "", capability: { status: "missing_fetch_impl" } };
  }

  try {
    const guildRead = await fetchDiscordJson(fetchImpl, `${DISCORD_API_BASE}/users/@me/guilds`, token);
    if (!guildRead.ok) {
      return {
        channelId: "",
        capability: {
          status: "channel_discovery_failed",
          stage: "guilds",
          status_code: guildRead.status,
          reason: guildRead.statusText,
        },
      };
    }

    const guilds = Array.isArray(guildRead.payload) ? guildRead.payload : [];
    for (const guild of guilds) {
      const guildId = clean(guild.id);
      if (!guildId) continue;
      const channelsRead = await fetchDiscordJson(
        fetchImpl,
        `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/channels`,
        token,
      );
      if (!channelsRead.ok) continue;
      const channels = Array.isArray(channelsRead.payload) ? channelsRead.payload : [];
      const match = channels.find((channel) => {
        const type = Number(channel.type);
        const name = clean(channel.name).replace(/^#/, "").toLowerCase();
        return (type === 0 || type === 5) && channelNames.includes(name);
      });
      if (match?.id) {
        return {
          channelId: clean(match.id),
          capability: {
            status: "discovered_channel",
            channel_id_discovered: true,
            channel_name: clean(match.name),
            guild_id: guildId,
            guild_name: clean(guild.name),
          },
        };
      }
    }
    return {
      channelId: "",
      capability: {
        status: "channel_not_found",
        channel_names: channelNames,
        guilds_seen: guilds.length,
        required_env: "DISCORD_FEEDBACK_CHANNEL_ID",
      },
    };
  } catch (err) {
    return {
      channelId: "",
      capability: {
        status: "channel_discovery_failed",
        reason: err.message || "discord_channel_discovery_failed",
      },
    };
  }
}

async function discoverDiscordFeedbackChannels({
  env = process.env,
  token = resolveBotToken(env),
  fetchImpl = global.fetch,
} = {}) {
  const channelNames = resolveChannelNames(env);
  if (!channelDiscoveryEnabled(env)) {
    return {
      channels: [],
      capability: { status: "missing_channel_id", required_env: "DISCORD_FEEDBACK_CHANNEL_ID" },
    };
  }
  if (typeof fetchImpl !== "function") {
    return { channels: [], capability: { status: "missing_fetch_impl" } };
  }
  try {
    const guildRead = await fetchDiscordJson(fetchImpl, `${DISCORD_API_BASE}/users/@me/guilds`, token);
    if (!guildRead.ok) {
      return {
        channels: [],
        capability: {
          status: "channel_discovery_failed",
          stage: "guilds",
          status_code: guildRead.status,
          reason: guildRead.statusText,
        },
      };
    }
    const byId = new Map();
    const guilds = Array.isArray(guildRead.payload) ? guildRead.payload : [];
    for (const guild of guilds) {
      const guildId = clean(guild.id);
      if (!guildId) continue;
      const channelsRead = await fetchDiscordJson(
        fetchImpl,
        `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/channels`,
        token,
      );
      if (!channelsRead.ok) continue;
      for (const channel of Array.isArray(channelsRead.payload) ? channelsRead.payload : []) {
        const type = Number(channel.type);
        const name = clean(channel.name).replace(/^#/, "").toLowerCase();
        if ((type === 0 || type === 5) && channelNames.includes(name) && clean(channel.id)) {
          byId.set(clean(channel.id), {
            id: clean(channel.id),
            name: clean(channel.name),
            guild_id: guildId,
            guild_name: clean(guild.name),
          });
        }
      }
    }
    const channels = channelNames
      .flatMap((name) => Array.from(byId.values()).filter((channel) => clean(channel.name).toLowerCase() === name))
      .filter((channel, index, list) => list.findIndex((item) => item.id === channel.id) === index);
    if (!channels.length) {
      return {
        channels: [],
        capability: {
          status: "channel_not_found",
          channel_names: channelNames,
          guilds_seen: guilds.length,
          required_env: "DISCORD_FEEDBACK_CHANNEL_ID",
        },
      };
    }
    return {
      channels,
      capability: {
        status: "discovered_channels",
        channel_names: channelNames,
        channel_count: channels.length,
        channels: channels.map((channel) => ({ id: channel.id, name: channel.name })),
      },
    };
  } catch (err) {
    return {
      channels: [],
      capability: {
        status: "channel_discovery_failed",
        reason: err.message || "discord_channel_discovery_failed",
      },
    };
  }
}

function extractStoryId(text = "") {
  const match = clean(text).match(
    /\b((?:fresh|rss)_[a-z0-9_]+|1[a-z0-9]{5,})(?::(?:youtube_shorts|instagram_reels|facebook_reels|tiktok|twitter|x|threads|pinterest))?\b/i,
  );
  return match ? match[1] : "";
}

function categoriesFor(text = "") {
  const value = clean(text);
  const categories = [];
  if (
    /\b(?:wrong|incorrect|not\s+right|does(?:n'?t| not)\s+look\s+like|unrelated)\b.{0,80}\b(?:clips?|footage|video|background|b[- ]?roll|visuals?|images?)\b/i.test(value) ||
    /\b(?:clips?|footage|background(?: vids?| videos?)?)\b.{0,80}\b(?:wrong|incorrect|not\s+right|unrelated)\b/i.test(value) ||
    /\b(?:slow[- ]moving stills?|stills? instead of video|article[- ]dominated|wrong fable clips?)\b/i.test(value)
  ) {
    categories.push("wrong_visuals");
  }
  if (
    /\b(?:tts|voice|narration|audio)\b.{0,90}\b(?:bad|stretched|slowed|slow|underwater|underwatery|cutting off|changes?|inconsistent|unnatural|pause|cadence)\b/i.test(value) ||
    /\b(?:sounds?|sounded)\b.{0,60}\b(?:stretched|slowed|slow|underwater|underwatery|robotic|unnatural)\b/i.test(value)
  ) {
    categories.push("tts_voice_quality");
  }
  if (
    /\b(?:subtitles?|captions?)\b.{0,100}\b(?:wrong|show|showing|say|saying|instead|drift|late|early|g\s*t\s*a|playstation five|twenty twenty)\b/i.test(value) ||
    /\bg\s*t\s*a\s*(?:five|six|5|6)\b/i.test(value)
  ) {
    categories.push("caption_pronunciation");
  }
  if (
    /\b(?:transcript|script|narration script)\b.{0,120}\b(?:confusing|unclear|does(?:n'?t| not)\s+make sense|useless|weak|mass audience|not understandable|hard to follow)\b/i.test(value) ||
    /\b(?:clear|understandable|relatable|viral|mass audience)\b.{0,80}\b(?:transcript|script)\b/i.test(value)
  ) {
    categories.push("transcript_confusing");
  }
  if (
    /\b(?:no publish|no posts?|not posting|nothing posted|miss(?:ed|ing) windows?|empty schedules?|losing traction|losing momentum)\b/i.test(value) ||
    /\bstatus:\s*red\b/i.test(value) && /\boutcome:\s*failed\b/i.test(value)
  ) {
    categories.push("publish_stalled");
  }
  return [...new Set(categories)];
}

function classifyDiscordFeedbackMessage(message = {}, { generatedAt = new Date().toISOString() } = {}) {
  const content = clean(message.content);
  const categories = categoriesFor(content);
  const storyId = extractStoryId(content);
  const author = message.author || {};
  const timestamp = message.timestamp || message.created_at || null;
  const ageHours = hoursBetween(generatedAt, timestamp);
  const latestScope = /\b(?:latest|newest|most recent|just uploaded|new upload|new short|this short|this upload|that upload)\b/i.test(content);
  const highImpact = categories.some((category) =>
    ["wrong_visuals", "tts_voice_quality", "caption_pronunciation", "transcript_confusing", "publish_stalled"].includes(category),
  );

  return {
    message_id: clean(message.id),
    author: clean(author.global_name || author.username || author.name || "unknown"),
    author_is_bot: author.bot === true,
    timestamp,
    age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    story_id: storyId || null,
    latest_scope: latestScope,
    categories,
    severity: highImpact ? "high" : "low",
    actionable: categories.length > 0,
    excerpt: content.slice(0, 280),
  };
}

function candidateIdSet(candidateReport = {}) {
  return new Set(asArray(candidateReport.candidates).map((candidate) => clean(candidate.id)).filter(Boolean));
}

function buildDiscordFeedbackIngestionReport({
  generatedAt = new Date().toISOString(),
  capability = { status: "loaded" },
  messages = [],
  candidateReport = {},
  selectedStoryIds = [],
  maxAgeHours = 24,
} = {}) {
  const candidates = candidateIdSet(candidateReport);
  const selected = new Set(asArray(selectedStoryIds).map(clean).filter(Boolean));
  const items = asArray(messages)
    .map((message) => classifyDiscordFeedbackMessage(message, { generatedAt }))
    .filter((item) => item.actionable)
    .map((item) => {
      const currentCandidate = item.story_id ? candidates.has(item.story_id) : false;
      const selectedForWindow = item.story_id ? selected.has(item.story_id) : false;
      const stale = item.age_hours !== null && item.age_hours > maxAgeHours;
      let state = "unmatched_feedback_needs_triage";
      let blocksPublishing = false;
      let action = "triage_feedback_before_next_quality_pass";

      if (stale) {
        state = "stale_feedback";
        action = "keep_feedback_visible_without_holding_current_window";
      } else if (selectedForWindow) {
        state = "current_selected_feedback_blocker";
        blocksPublishing = true;
        action = "hold_selected_candidate_and_repair_feedback_issue";
      } else if (!item.story_id && item.latest_scope && item.severity === "high") {
        state = "latest_unmatched_feedback_blocker";
        blocksPublishing = true;
        action = "hold_next_candidate_until_latest_feedback_is_mapped";
      } else if (currentCandidate) {
        state = "candidate_backlog_feedback";
        action = "route_candidate_to_repair_lane_without_holding_selected_window";
      }

      return {
        ...item,
        current_candidate: currentCandidate,
        selected_for_window: selectedForWindow,
        stale,
        state,
        blocks_publishing: blocksPublishing,
        action,
      };
    });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_discord_feedback_ingestion",
    capability,
    summary: {
      messages_seen: asArray(messages).length,
      actionable_count: items.length,
      blocking_count: items.filter((item) => item.blocks_publishing).length,
      stale_count: items.filter((item) => item.stale).length,
      unmatched_count: items.filter((item) => !item.story_id).length,
    },
    items,
    safety: {
      read_only: true,
      no_live_publish: true,
      no_discord_post: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      token_redacted: true,
    },
  };
}

async function fetchDiscordChannelMessages({
  env = process.env,
  limit = 50,
  fetchImpl = global.fetch,
} = {}) {
  const token = resolveBotToken(env);
  let channelId = resolveChannelId(env);
  let discoveryCapability = null;
  if (!token) {
    return {
      capability: { status: "missing_bot_token", required_env: "DISCORD_BOT_TOKEN" },
      messages: [],
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      capability: { status: "missing_fetch_impl" },
      messages: [],
    };
  }
  if (!channelId) {
    const discovered = await discoverDiscordFeedbackChannels({ env, token, fetchImpl });
    discoveryCapability = discovered.capability;
    const channelLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const messages = [];
    const readFailures = [];
    for (const channel of asArray(discovered.channels)) {
      const url = `${DISCORD_API_BASE}/channels/${encodeURIComponent(channel.id)}/messages?limit=${channelLimit}`;
      const read = await fetchDiscordJson(fetchImpl, url, token);
      if (!read.ok) {
        readFailures.push({ channel_id: channel.id, channel_name: channel.name || null, status_code: read.status });
        continue;
      }
      messages.push(...asArray(read.payload).map((message) => ({
        ...message,
        channel_id: channel.id,
        channel_name: channel.name || null,
      })));
    }
    if (messages.length || asArray(discovered.channels).length) {
      return {
        capability: {
          ...discoveryCapability,
          status: readFailures.length && !messages.length ? "read_failed" : "loaded",
          channel_id_configured: false,
          channel_id_discovered: true,
          channel_name: asArray(discovered.channels).map((channel) => channel.name).filter(Boolean).join(",") || null,
          channel_count: asArray(discovered.channels).length,
          read_failures: readFailures,
          messages_returned: messages.length,
        },
        messages,
      };
    }
  }
  if (!channelId) {
    return {
      capability: discoveryCapability || { status: "missing_channel_id", required_env: "DISCORD_FEEDBACK_CHANNEL_ID" },
      messages: [],
    };
  }

  const url = `${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages?limit=${Math.max(1, Math.min(100, Number(limit) || 50))}`;
  try {
    const read = await fetchDiscordJson(fetchImpl, url, token);
    if (!read.ok) {
      return {
        capability: {
          status: "read_failed",
          status_code: read.status,
          reason: read.statusText,
          discovery: discoveryCapability,
        },
        messages: [],
      };
    }
    const payload = read.payload;
    return {
      capability: {
        status: "loaded",
        channel_id_configured: Boolean(resolveChannelId(env)),
        channel_id_discovered: Boolean(discoveryCapability?.channel_id_discovered),
        channel_name: discoveryCapability?.channel_name || null,
        messages_returned: Array.isArray(payload) ? payload.length : 0,
      },
      messages: Array.isArray(payload) ? payload : [],
    };
  } catch (err) {
    return {
      capability: {
        status: "read_failed",
        reason: err.message || "discord_read_failed",
      },
      messages: [],
    };
  }
}

function renderDiscordFeedbackIngestionMarkdown(report = {}) {
  const lines = [
    "# Discord Feedback Ingestion",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Capability: ${report.capability?.status || "unknown"}`,
    `Messages seen: ${report.summary?.messages_seen || 0}`,
    `Actionable: ${report.summary?.actionable_count || 0}`,
    `Blocking: ${report.summary?.blocking_count || 0}`,
    "",
    "## Items",
    "",
  ];
  for (const item of asArray(report.items)) {
    lines.push(`- ${item.story_id || "unmatched"}: ${item.categories.join(", ")} -> ${item.state}`);
    lines.push(`  - action: ${item.action}`);
    lines.push(`  - excerpt: ${item.excerpt}`);
  }
  if (!asArray(report.items).length) lines.push("- none");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeDiscordFeedbackIngestionReport(report, { outDir = DEFAULT_OUT } = {}) {
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "discord_feedback_ingestion_report.json");
  const mdPath = path.join(outDir, "discord_feedback_ingestion_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderDiscordFeedbackIngestionMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

async function runDiscordFeedbackIngestion({
  generatedAt = new Date().toISOString(),
  env = process.env,
  fetchImpl = global.fetch,
  limit = 50,
  candidateReport = {},
  selectedStoryIds = [],
  outDir = DEFAULT_OUT,
} = {}) {
  const read = await fetchDiscordChannelMessages({ env, limit, fetchImpl });
  const report = buildDiscordFeedbackIngestionReport({
    generatedAt,
    capability: read.capability,
    messages: read.messages,
    candidateReport,
    selectedStoryIds,
  });
  await writeDiscordFeedbackIngestionReport(report, { outDir });
  return report;
}

module.exports = {
  buildDiscordFeedbackIngestionReport,
  classifyDiscordFeedbackMessage,
  discoverDiscordFeedbackChannel,
  discoverDiscordFeedbackChannels,
  fetchDiscordChannelMessages,
  renderDiscordFeedbackIngestionMarkdown,
  runDiscordFeedbackIngestion,
  writeDiscordFeedbackIngestionReport,
};
