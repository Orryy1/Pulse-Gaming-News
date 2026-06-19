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

function resolveWebhookUrl(env = process.env) {
  return clean(env.DISCORD_WEBHOOK_URL || env.PULSE_DISCORD_WEBHOOK_URL);
}

function defaultSleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res, payload = null) {
  const headerValue = res?.headers?.get ? res.headers.get("retry-after") || res.headers.get("Retry-After") : null;
  const raw = headerValue || payload?.retry_after || payload?.retryAfter || null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(0, Math.round(numeric * 1000));
  }
  return 1000;
}

async function readJsonPayload(res) {
  try {
    return await res.json();
  } catch (_err) {
    return null;
  }
}

async function fetchDiscordJson(fetchImpl, url, token, { sleepMs = defaultSleepMs, maxRetries = 1 } = {}) {
  let rateLimitRetries = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(token),
        "User-Agent": "PulseGamingFeedbackIngestion/1.0",
      },
    });
    const payload = res && res.ok ? await readJsonPayload(res) : res?.status === 429 ? await readJsonPayload(res) : null;
    if (res?.status === 429 && attempt < maxRetries) {
      rateLimitRetries += 1;
      await sleepMs(parseRetryAfterMs(res, payload));
      continue;
    }
    if (!res || !res.ok) {
      return {
        ok: false,
        status: res?.status || null,
        statusText: res?.statusText || "discord_read_failed",
        payload: null,
        rate_limit_retries: rateLimitRetries,
      };
    }
    return {
      ok: true,
      status: res.status || 200,
      statusText: res.statusText || "OK",
      payload,
      rate_limit_retries: rateLimitRetries,
    };
  }
  return {
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    payload: null,
    rate_limit_retries: rateLimitRetries,
  };
}

async function inspectDiscordWebhookTarget({ env = process.env, fetchImpl = global.fetch, sleepMs = defaultSleepMs } = {}) {
  const webhookUrl = resolveWebhookUrl(env);
  if (!webhookUrl) return { status: "missing_webhook_url" };
  if (typeof fetchImpl !== "function") return { status: "missing_fetch_impl" };
  let rateLimitRetries = 0;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "GET",
        headers: { "User-Agent": "PulseGamingWebhookTargetCheck/1.0" },
      });
      const payload = res && res.ok ? await readJsonPayload(res) : res?.status === 429 ? await readJsonPayload(res) : null;
      if (res?.status === 429 && attempt === 0) {
        rateLimitRetries += 1;
        await sleepMs(parseRetryAfterMs(res, payload));
        continue;
      }
      if (!res || !res.ok) {
        return {
          status: "read_failed",
          status_code: res?.status || null,
          reason: res?.statusText || "webhook_target_read_failed",
          rate_limit_retries: rateLimitRetries,
        };
      }
      return {
        status: "loaded",
        id: clean(payload?.id),
        name: clean(payload?.name),
        type: payload?.type ?? null,
        guild_id: clean(payload?.guild_id),
        channel_id: clean(payload?.channel_id),
        matches_configured_guild:
          payload?.guild_id && env.DISCORD_GUILD_ID ? clean(payload.guild_id) === clean(env.DISCORD_GUILD_ID) : null,
        rate_limit_retries: rateLimitRetries,
      };
    } catch (err) {
      return {
        status: "read_failed",
        reason: err.message || "webhook_target_read_failed",
        rate_limit_retries: rateLimitRetries,
      };
    }
  }
  return { status: "read_failed", status_code: 429, reason: "webhook_target_rate_limited", rate_limit_retries: rateLimitRetries };
}

function applyWebhookFeedbackHealth(capability = {}, { webhookTarget = {}, discoveredChannelIds = [], configuredChannelId = "" } = {}) {
  if (!webhookTarget || webhookTarget.status === "missing_webhook_url") return capability;
  const ids = new Set(asArray(discoveredChannelIds).map(clean).filter(Boolean));
  const configured = clean(configuredChannelId);
  if (configured) ids.add(configured);
  const webhookChannelDiscovered = webhookTarget.channel_id ? ids.has(clean(webhookTarget.channel_id)) : null;
  const next = {
    ...capability,
    webhook_target: webhookTarget,
    webhook_channel_discovered: webhookChannelDiscovered,
  };
  if (webhookTarget.status === "loaded" && webhookTarget.channel_id && webhookChannelDiscovered === false) {
    next.status = capability.status === "loaded" ? "loaded_with_feedback_channel_gap" : capability.status;
    next.feedback_gap = "webhook_channel_not_readable_by_bot_token";
    next.operator_actions = [
      `Set DISCORD_FEEDBACK_CHANNEL_ID to ${webhookTarget.channel_id} with a bot token that can read it, or install the feedback-ingestion bot in the webhook guild/channel.`,
    ];
  }
  return next;
}

async function discoverDiscordFeedbackChannel({
  env = process.env,
  token = resolveBotToken(env),
  fetchImpl = global.fetch,
  sleepMs = defaultSleepMs,
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
    const guildRead = await fetchDiscordJson(fetchImpl, `${DISCORD_API_BASE}/users/@me/guilds`, token, { sleepMs });
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
        { sleepMs },
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
  sleepMs = defaultSleepMs,
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
    const guildRead = await fetchDiscordJson(fetchImpl, `${DISCORD_API_BASE}/users/@me/guilds`, token, { sleepMs });
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
        { sleepMs },
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
    /\b(?:publish held|publish held before upload|guarded publish)\b/i.test(value) ||
    /\bstatus:\s*red\b/i.test(value) && /\boutcome:\s*failed\b/i.test(value)
  ) {
    categories.push("publish_stalled");
  }
  if (
    /\b(?:publish_window_watchdog_red|local_restart_readiness|public script-validation fallback rows|readiness(?:\s+|_)?red|publish_readiness)\b/i.test(
      value,
    )
  ) {
    categories.push("readiness_blocked");
  }
  if (
    /\b(?:candidate supply monitor|green[- ]ready:\s*\d+\s*\/\s*\d+|durable green:\s*\d+\s*\/\s*\d+|green_ready_candidates_below_target|source_safe_candidates_below_target|v4_ready_candidates_below_target|runway:\s*\d+\s*\/\s*\d+)\b/i.test(
      value,
    )
  ) {
    categories.push("candidate_supply_low");
  }
  if (/\brender health\b/i.test(value) && /\b(?:no stamped stories|unstamped|pre-\d{4}-\d{2}-\d{2})\b/i.test(value)) {
    categories.push("render_health_gap");
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
  const operationalScope =
    author.bot === true ||
    /\b(?:pulse gaming guarded publish|pulse gaming publish held|pulse candidate supply monitor|render health|scoring digest|publish_window_watchdog)\b/i.test(
      content,
    );
  const highImpact = categories.some((category) =>
    [
      "wrong_visuals",
      "tts_voice_quality",
      "caption_pronunciation",
      "transcript_confusing",
      "publish_stalled",
      "readiness_blocked",
      "render_health_gap",
    ].includes(category),
  );

  return {
    message_id: clean(message.id),
    author: clean(author.global_name || author.username || author.name || "unknown"),
    author_is_bot: author.bot === true,
    timestamp,
    age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    story_id: storyId || null,
    latest_scope: latestScope,
    operational_scope: operationalScope,
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
      } else if (!item.story_id && item.operational_scope && item.severity === "high") {
        state = "operational_feedback_blocker";
        blocksPublishing = true;
        action = "repair_runtime_or_readiness_before_next_window";
      } else if (!item.story_id && item.operational_scope) {
        state = "operational_feedback_job";
        action = "route_operational_feedback_to_repair_queue";
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
  const summary = {
    messages_seen: asArray(messages).length,
    actionable_count: items.length,
    blocking_count: items.filter((item) => item.blocks_publishing).length,
    stale_count: items.filter((item) => item.stale).length,
    unmatched_count: items.filter((item) => !item.story_id).length,
  };

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_discord_feedback_ingestion",
    capability,
    summary,
    ingestion_health: buildDiscordFeedbackIngestionHealth({ capability, summary }),
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

function buildDiscordFeedbackIngestionHealth({ capability = {}, summary = {} } = {}) {
  const capabilityStatus = clean(capability.status || "unknown");
  const missedCycleAlerts = [];
  const operatorActions = [...asArray(capability.operator_actions)];
  let status = "green";

  if (
    [
      "missing_bot_token",
      "missing_fetch_impl",
      "read_failed",
      "channel_discovery_failed",
    ].includes(capabilityStatus)
  ) {
    status = "red";
    missedCycleAlerts.push(`discord_ingestion_${capabilityStatus}`);
  } else if (
    [
      "missing_channel_id",
      "channel_not_found",
      "loaded_with_feedback_channel_gap",
    ].includes(capabilityStatus)
  ) {
    status = "amber";
    missedCycleAlerts.push(`discord_ingestion_${capabilityStatus}`);
  }

  if (capability.feedback_gap) {
    status = status === "red" ? "red" : "amber";
    missedCycleAlerts.push(capability.feedback_gap);
  }

  if (capability.webhook_channel_discovered === false) {
    status = status === "red" ? "red" : "amber";
    missedCycleAlerts.push("operational_alert_channel_not_ingested");
  }

  return {
    status,
    capability_status: capabilityStatus,
    messages_seen: Number(summary.messages_seen || 0),
    actionable_count: Number(summary.actionable_count || 0),
    blocking_count: Number(summary.blocking_count || 0),
    channel_count: Number(capability.channel_count || 0),
    read_failures: asArray(capability.read_failures),
    rate_limit_retries: Number(capability.rate_limit_retries || 0),
    webhook_channel_discovered:
      typeof capability.webhook_channel_discovered === "boolean"
        ? capability.webhook_channel_discovered
        : null,
    can_read_operational_alerts: capability.webhook_channel_discovered !== false,
    missed_cycle_alerts: [...new Set(missedCycleAlerts.filter(Boolean))],
    operator_actions: operatorActions,
  };
}

async function fetchDiscordChannelMessages({
  env = process.env,
  limit = 50,
  fetchImpl = global.fetch,
  sleepMs = defaultSleepMs,
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
    const discovered = await discoverDiscordFeedbackChannels({ env, token, fetchImpl, sleepMs });
    discoveryCapability = discovered.capability;
    const webhookTarget = await inspectDiscordWebhookTarget({ env, fetchImpl, sleepMs });
    const channelLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const messages = [];
    const readFailures = [];
    let rateLimitRetries =
      Number(discoveryCapability?.rate_limit_retries || 0) + Number(webhookTarget?.rate_limit_retries || 0);
    for (const channel of asArray(discovered.channels)) {
      const url = `${DISCORD_API_BASE}/channels/${encodeURIComponent(channel.id)}/messages?limit=${channelLimit}`;
      const read = await fetchDiscordJson(fetchImpl, url, token, { sleepMs });
      rateLimitRetries += Number(read.rate_limit_retries || 0);
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
      const discoveredChannelIds = asArray(discovered.channels).map((channel) => channel.id);
      return {
        capability: applyWebhookFeedbackHealth(
          {
            ...discoveryCapability,
            status: readFailures.length && !messages.length ? "read_failed" : "loaded",
            channel_id_configured: false,
            channel_id_discovered: true,
            channel_name: asArray(discovered.channels).map((channel) => channel.name).filter(Boolean).join(",") || null,
            channel_count: asArray(discovered.channels).length,
            read_failures: readFailures,
            messages_returned: messages.length,
            rate_limit_retries: rateLimitRetries,
          },
          { webhookTarget, discoveredChannelIds },
        ),
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
    const webhookTarget = await inspectDiscordWebhookTarget({ env, fetchImpl, sleepMs });
    const read = await fetchDiscordJson(fetchImpl, url, token, { sleepMs });
    if (!read.ok) {
      return {
        capability: applyWebhookFeedbackHealth(
          {
            status: "read_failed",
            status_code: read.status,
            reason: read.statusText,
            discovery: discoveryCapability,
            rate_limit_retries: Number(read.rate_limit_retries || 0) + Number(webhookTarget?.rate_limit_retries || 0),
          },
          { webhookTarget, configuredChannelId: channelId },
        ),
        messages: [],
      };
    }
    const payload = read.payload;
    return {
      capability: applyWebhookFeedbackHealth(
        {
          status: "loaded",
          channel_id_configured: Boolean(resolveChannelId(env)),
          channel_id_discovered: Boolean(discoveryCapability?.channel_id_discovered),
          channel_name: discoveryCapability?.channel_name || null,
          messages_returned: Array.isArray(payload) ? payload.length : 0,
          rate_limit_retries: Number(read.rate_limit_retries || 0) + Number(webhookTarget?.rate_limit_retries || 0),
        },
        { webhookTarget, configuredChannelId: channelId },
      ),
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
    `Ingestion health: ${report.ingestion_health?.status || "unknown"}`,
    `Messages seen: ${report.summary?.messages_seen || 0}`,
    `Actionable: ${report.summary?.actionable_count || 0}`,
    `Blocking: ${report.summary?.blocking_count || 0}`,
    `Missed-cycle alerts: ${asArray(report.ingestion_health?.missed_cycle_alerts).join(", ") || "none"}`,
    `Operator actions: ${asArray(report.ingestion_health?.operator_actions).join(" | ") || "none"}`,
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
  buildDiscordFeedbackIngestionHealth,
  classifyDiscordFeedbackMessage,
  discoverDiscordFeedbackChannel,
  discoverDiscordFeedbackChannels,
  fetchDiscordChannelMessages,
  renderDiscordFeedbackIngestionMarkdown,
  runDiscordFeedbackIngestion,
  writeDiscordFeedbackIngestionReport,
};
