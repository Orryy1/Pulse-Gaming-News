// The Pulse Gaming community bot: XP and levels (with level roles), /rank profiles, /leaderboard,
// /daily streaks, welcomes, live server stats, a live leaderboard, and the Pulse Live feeds
// (new videos, checked news, daily deals, the weekly release radar, Steam's most played and the
// Epic freebies). Runs as its own process beside the factory so neither can take the other down.
// Channel and role ids come from data/discord/layout.json, written by src/tools/discord-setup.ts.
// Usage: node --import tsx src/discord/bot.ts
process.loadEnvFile(".env");
import fs from "node:fs";
import path from "node:path";
import {
  ActivityType,
  ApplicationCommandType,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import {
  bar,
  claimDaily,
  compact,
  dayOf,
  levelOf,
  LEVEL_ROLES,
  MESSAGE_XP,
  nextRole,
  roleFor,
  VOICE_XP,
} from "./levels.ts";
import { fresh, parseNewsRss, parseYouTubeFeed } from "./feeds.ts";
import { steamDeals } from "../discovery/deals.ts";
import { freeGames, releaseRadar } from "../discovery/weekly.ts";
import { fetchWithTimeout } from "../lib/util.ts";

const TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const GUILD = process.env.DISCORD_GUILD_ID ?? "";
const YT_CHANNEL = process.env.YOUTUBE_CHANNEL_ID || "UCvgNDjtTezrpxL8oUe6mYwA";
const SITE = "https://pulsegmg.com";
const BRAND = 0xff6b1a;
const DIR = path.resolve("data/discord");
const LINKS = `[YouTube](https://youtube.com/@PulseGMG) · [TikTok](https://www.tiktok.com/@pulsegamingnews) · [Instagram](https://instagram.com/pulse.gmg) · [X](https://x.com/Pulse_GMG) · [pulsegmg.com](${SITE})`;
if (!TOKEN || !GUILD)
  throw new Error("DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set");

const layout = JSON.parse(
  fs.readFileSync(path.join(DIR, "layout.json"), "utf8"),
) as {
  channels: Record<string, string>;
  roles: Record<string, string>;
};
const ch = layout.channels;
const roleId = layout.roles;

// ---------------------------------------------------------------- state (one JSON file, written atomically)
interface Member {
  xp: number;
  msgs: number;
  voiceMin: number;
  lastXpAt: number;
  daily?: { last: string; streak: number; best: number };
}
interface State {
  members: Record<string, Member>;
  seenVideos?: string[];
  seenNews?: string[];
  posted: Record<string, string>; // feed -> the day or week it last posted
  newsPings: number[];
  leaderboardMsg?: string;
  stats: Record<string, string>;
}
const STATE_FILE = path.join(DIR, "state.json");
const state: State = fs.existsSync(STATE_FILE)
  ? {
      posted: {},
      newsPings: [],
      stats: {},
      ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")),
    }
  : { members: {}, posted: {}, newsPings: [], stats: {} };
let saveTimer: NodeJS.Timeout | undefined;
const save = (now = false) => {
  const write = () => {
    saveTimer = undefined;
    fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  };
  if (now) return write();
  saveTimer ??= setTimeout(write, 5_000);
};
const member = (id: string): Member =>
  (state.members[id] ??= { xp: 0, msgs: 0, voiceMin: 0, lastXpAt: 0 });
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const safe = (what: string, fn: () => Promise<unknown>) =>
  fn().catch((e: unknown) =>
    log(`${what} failed: ${e instanceof Error ? e.message : String(e)}`),
  );

// One bot at a time: a second copy would double-count XP and double-post feeds. The running bot
// touches its lock every 30 seconds; a lock left by a killed bot goes stale after 90 (process ids
// get reused, so the id alone proves nothing).
const LOCK = path.join(DIR, "bot.lock");
try {
  const pid = Number(fs.readFileSync(LOCK, "utf8"));
  if (pid && pid !== process.pid && Date.now() - fs.statSync(LOCK).mtimeMs < 90_000) {
    console.log(`another bot is running (pid ${pid}); exiting`);
    process.exit(0);
  }
} catch {
  /* no lock */
}
fs.writeFileSync(LOCK, String(process.pid));
setInterval(() => {
  try {
    fs.writeFileSync(LOCK, String(process.pid));
  } catch {
    /* next time */
  }
}, 30_000).unref();
process.once("exit", () => {
  if (saveTimer) save(true);
  try {
    if (fs.readFileSync(LOCK, "utf8") === String(process.pid))
      fs.unlinkSync(LOCK);
  } catch {
    /* gone */
  }
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.once(sig, () => process.exit(0));

// ---------------------------------------------------------------- client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
let guild: Guild;
const text = (id: string | undefined) =>
  id ? (guild.channels.cache.get(id) as TextChannel | undefined) : undefined;

// ---------------------------------------------------------------- levels
async function grantXp(
  m: GuildMember,
  amount: number,
  why: string,
): Promise<void> {
  if (m.user.bot) return;
  const rec = member(m.id);
  const before = levelOf(rec.xp).level;
  rec.xp += amount;
  save();
  const after = levelOf(rec.xp).level;
  if (after > before) await levelUp(m, after, why);
}

async function syncLevelRole(
  m: GuildMember,
  level: number,
): Promise<string | undefined> {
  const want = roleFor(level);
  const levelRoleIds = LEVEL_ROLES.map(([, r]) => roleId[r]).filter(
    Boolean,
  ) as string[];
  const wantId = want ? roleId[want] : undefined;
  const drop = levelRoleIds.filter(
    (id) => id !== wantId && m.roles.cache.has(id),
  );
  if (drop.length) await m.roles.remove(drop, "level role moved up");
  if (wantId && !m.roles.cache.has(wantId)) {
    await m.roles.add(wantId, `reached level ${level}`);
    return want;
  }
  return undefined;
}

async function levelUp(
  m: GuildMember,
  level: number,
  why: string,
): Promise<void> {
  const earned = await syncLevelRole(m, level).catch(() => undefined);
  const next = nextRole(level);
  const line = earned
    ? `🎉 ${m} just hit **level ${level}** and earned the **${earned}** role!`
    : `⬆️ ${m} reached **level ${level}**${why === "daily" ? " with their daily bonus" : ""}.`;
  const tail = next
    ? ` Next up: **${next.role}** at level ${next.at}.`
    : " That is the top role. Legendary.";
  await text(ch["level-ups"])?.send({
    content: line + tail,
    allowedMentions: { users: [m.id] },
  });
}

function ranked(): Array<[string, Member]> {
  return Object.entries(state.members)
    .filter(([id, r]) => r.xp > 0 && guild.members.cache.has(id))
    .sort((a, b) => b[1].xp - a[1].xp);
}

function rankEmbed(m: GuildMember): EmbedBuilder {
  const rec = member(m.id);
  const { level, into, need } = levelOf(rec.xp);
  const order = ranked();
  const place = order.findIndex(([id]) => id === m.id);
  const next = nextRole(level);
  const platforms = ["PlayStation", "Xbox", "Nintendo", "PC Gamer"].filter(
    (r) => roleId[r] && m.roles.cache.has(roleId[r]!),
  );
  const e = new EmbedBuilder()
    .setColor(BRAND)
    .setAuthor({ name: m.displayName, iconURL: m.displayAvatarURL() })
    .setThumbnail(m.displayAvatarURL({ size: 256 }))
    .setTitle(`Level ${level}${roleFor(level) ? ` · ${roleFor(level)}` : ""}`)
    .setDescription(
      `${bar(into, need)}  **${into.toLocaleString("en-US")}** / ${need.toLocaleString("en-US")} XP`,
    )
    .addFields(
      {
        name: "Rank",
        value: place >= 0 ? `#${place + 1} of ${order.length}` : "Unranked",
        inline: true,
      },
      { name: "Total XP", value: rec.xp.toLocaleString("en-US"), inline: true },
      {
        name: "Messages",
        value: rec.msgs.toLocaleString("en-US"),
        inline: true,
      },
      {
        name: "Daily streak",
        value: rec.daily
          ? `🔥 ${rec.daily.streak} (best ${rec.daily.best})`
          : "Claim /daily",
        inline: true,
      },
      {
        name: "Voice",
        value: `${Math.round(rec.voiceMin / 60)}h ${rec.voiceMin % 60}m`,
        inline: true,
      },
      {
        name: "Next role",
        value: next ? `${next.role} at level ${next.at}` : "Top role reached",
        inline: true,
      },
    );
  if (platforms.length)
    e.addFields({ name: "Plays on", value: platforms.join(" · ") });
  if (m.joinedAt)
    e.setFooter({
      text: `Member since ${m.joinedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
    });
  return e;
}

function leaderboardEmbed(): EmbedBuilder {
  const medals = ["🥇", "🥈", "🥉"];
  const rows = ranked()
    .slice(0, 15)
    .map(([id, r], i) => {
      const { level } = levelOf(r.xp);
      return `${medals[i] ?? `\`${String(i + 1).padStart(2)}\``} <@${id}> · level **${level}** · ${r.xp.toLocaleString("en-US")} XP`;
    });
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🏆 Pulse Gaming leaderboard")
    .setDescription(
      rows.join("\n") || "Nobody yet. Send a message to get on the board!",
    )
    .setFooter({
      text: "Updated every 10 minutes · /rank for your own card · /daily for bonus XP",
    })
    .setTimestamp(new Date());
}

// ---------------------------------------------------------------- commands
const COMMANDS = [
  {
    name: "rank",
    description: "Your level, XP, rank and streak (or someone else's)",
    options: [
      {
        type: 6,
        name: "member",
        description: "Whose card to show",
        required: false,
      },
    ],
  },
  { name: "leaderboard", description: "The top members by XP" },
  {
    name: "daily",
    description: "Claim your daily XP bonus and build a streak",
  },
  { name: "levels", description: "How XP, levels and level roles work" },
  { name: "links", description: "Where to find Pulse Gaming" },
  { name: "View rank", type: ApplicationCommandType.User },
];

async function onCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName === "rank") {
    const user = i.options.getUser("member") ?? i.user;
    const m = await guild.members.fetch(user.id).catch(() => undefined);
    if (!m)
      return void (await i.reply({
        content: "I could not find that member.",
        ephemeral: true,
      }));
    if (m.user.bot)
      return void (await i.reply({
        content: "Bots do not level up. Yet.",
        ephemeral: true,
      }));
    await i.reply({ embeds: [rankEmbed(m)] });
  } else if (i.commandName === "leaderboard") {
    await i.reply({
      embeds: [leaderboardEmbed()],
      allowedMentions: { users: [] },
    });
  } else if (i.commandName === "daily") {
    const m = await guild.members.fetch(i.user.id);
    const rec = member(m.id);
    const r = claimDaily(rec.daily?.last, rec.daily?.streak ?? 0, new Date());
    if (!r.ok)
      return void (await i.reply({
        content: `Already claimed today. Come back <t:${Math.floor(r.next.getTime() / 1000)}:R> to keep your 🔥 ${rec.daily?.streak} day streak.`,
        ephemeral: true,
      }));
    rec.daily = {
      last: dayOf(new Date()),
      streak: r.streak,
      best: Math.max(r.streak, rec.daily?.best ?? 0),
    };
    await i.reply({
      content: `✅ **+${r.xp} XP**${r.streak > 1 ? ` · 🔥 ${r.streak} day streak` : " · day one of your streak"}. See you tomorrow!`,
    });
    await grantXp(m, r.xp, "daily");
  } else if (i.commandName === "levels") {
    await i.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND)
          .setTitle("How levels work")
          .setDescription(
            [
              `💬 **Chat:** ${MESSAGE_XP.min} to ${MESSAGE_XP.max} XP per message, once a minute (spamming earns nothing extra)`,
              `🔊 **Voice:** ${VOICE_XP} XP every five minutes in voice with someone else`,
              "📅 **/daily:** 100 XP, plus 10 more for every day of your streak (up to +100)",
              "",
              "**Level roles**",
              ...LEVEL_ROLES.map(([at, r]) => `Level ${at}: **${r}**`),
              "",
              "Check yours with **/rank** and see the top members in the leaderboard channel.",
            ].join("\n"),
          ),
      ],
    });
  } else if (i.commandName === "links") {
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND)
          .setTitle("Pulse Gaming")
          .setDescription(LINKS),
      ],
    });
  }
}

async function onUserCommand(
  i: UserContextMenuCommandInteraction,
): Promise<void> {
  const m = await guild.members.fetch(i.targetId).catch(() => undefined);
  if (!m || m.user.bot)
    return void (await i.reply({
      content: "No rank card for that one.",
      ephemeral: true,
    }));
  await i.reply({ embeds: [rankEmbed(m)], ephemeral: true });
}

// ---------------------------------------------------------------- live stats and leaderboard
async function setName(
  key: string,
  id: string | undefined,
  name: string,
): Promise<void> {
  const c = id ? guild.channels.cache.get(id) : undefined;
  if (!c || state.stats[key] === name) return;
  await c.setName(name, "live stats");
  state.stats[key] = name;
  save();
}

async function refreshStats(): Promise<void> {
  const humans = guild.members.cache.filter((m) => !m.user.bot).size;
  await safe("members counter", () =>
    setName("members", ch.members, `👥 Members: ${compact(humans)}`),
  );
  // YouTube counts every six hours (4 quota units a day): the daily quota belongs to uploads.
  // Read with the factory's own YouTube login, so there is no extra key to keep alive.
  if (Date.now() - Number(state.stats.ytAt ?? 0) < 6 * 3600_000) return;
  state.stats.ytAt = String(Date.now());
  const tok = (await (
    await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: process.env.YOUTUBE_CLIENT_ID ?? "",
          client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
          refresh_token: process.env.YOUTUBE_REFRESH_TOKEN ?? "",
          grant_type: "refresh_token",
        }),
      },
      15_000,
    )
  ).json()) as { access_token?: string };
  if (!tok.access_token) throw new Error("YouTube login refused");
  const res = await fetchWithTimeout(
    "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
    { headers: { authorization: `Bearer ${tok.access_token}` } },
    15_000,
  );
  const s = res.ok
    ? (
        (await res.json()) as {
          items?: Array<{
            statistics: { subscriberCount?: string; videoCount?: string };
          }>;
        }
      ).items?.[0]?.statistics
    : undefined;
  if (s?.subscriberCount)
    await safe("subs counter", () =>
      setName(
        "subs",
        ch.subs,
        `▶️ YouTube: ${compact(Number(s.subscriberCount))} subs`,
      ),
    );
  if (s?.videoCount)
    await safe("videos counter", () =>
      setName(
        "videos",
        ch.videos,
        `🎬 Videos: ${compact(Number(s.videoCount))}`,
      ),
    );
}

async function refreshLeaderboard(): Promise<void> {
  const c = text(ch.leaderboard);
  if (!c) return;
  const embed = leaderboardEmbed();
  const old = state.leaderboardMsg
    ? await c.messages.fetch(state.leaderboardMsg).catch(() => undefined)
    : undefined;
  if (old) await old.edit({ embeds: [embed], allowedMentions: { users: [] } });
  else {
    const msg = await c.send({
      embeds: [embed],
      allowedMentions: { users: [] },
    });
    state.leaderboardMsg = msg.id;
    save();
  }
}

// ---------------------------------------------------------------- Pulse Live feeds
const getText = async (url: string) => {
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "user-agent": "PulseGamingDiscord/1.0 (+https://pulsegmg.com)",
      },
    },
    20_000,
  );
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
};
const announce = async (
  c: TextChannel | undefined,
  payload: Parameters<TextChannel["send"]>[0],
) => {
  if (!c) return;
  const msg = await c.send(payload);
  if ((c.type as ChannelType) === ChannelType.GuildAnnouncement)
    await msg.crosspost().catch(() => undefined);
};

async function videoFeed(): Promise<void> {
  const videos = parseYouTubeFeed(
    await getText(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`,
    ),
  );
  const { post, seen } = fresh(videos, (v) => v.id, state.seenVideos);
  state.seenVideos = seen;
  save();
  for (const v of post.slice(-3)) {
    await announce(text(ch["video-drops"]), {
      content: `<@&${roleId["Video Pings"]}> 🎬 **${v.title}**\nhttps://youtu.be/${v.id}`,
      allowedMentions: { roles: [roleId["Video Pings"]!] },
    });
    log(`video drop: ${v.title}`);
  }
}

async function newsFeed(): Promise<void> {
  const stories = parseNewsRss(await getText(`${SITE}/rss.xml`));
  const { post, seen } = fresh(stories, (s) => s.guid, state.seenNews);
  state.seenNews = seen;
  save();
  for (const s of post.slice(-4)) {
    // At most one ping every four hours, so the role stays worth having.
    const now = Date.now();
    const ping = !state.newsPings.some((t) => now - t < 4 * 3600_000);
    if (ping)
      state.newsPings = [
        ...state.newsPings.filter((t) => now - t < 86_400_000),
        now,
      ];
    const embed = new EmbedBuilder()
      .setColor(BRAND)
      .setTitle(s.title.slice(0, 256))
      .setURL(s.link)
      .setDescription(
        `${s.summary}\n\n[Sources and the full story](${s.link})${s.videoId ? ` · [Watch](https://youtu.be/${s.videoId})` : ""}`,
      )
      .setFooter({ text: "Pulse Gaming · checked before posting" });
    if (s.image) embed.setImage(s.image);
    if (s.published) embed.setTimestamp(new Date(s.published));
    await announce(text(ch["breaking-news"]), {
      content: ping ? `<@&${roleId["Breaking News Pings"]}>` : undefined,
      embeds: [embed],
      allowedMentions: { roles: ping ? [roleId["Breaking News Pings"]!] : [] },
    });
    log(`news: ${s.title}`);
  }
}

const weekOf = (d: Date) => {
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return dayOf(t); // the Monday
};
/** True once per period, from the given UTC hour (and weekday for weekly ones, 1 = Monday). */
const due = (key: string, now: Date, hour: number, weekday?: number) => {
  const period = weekday === undefined ? dayOf(now) : weekOf(now);
  if (state.posted[key] === period) return false;
  if (!state.posted[key]) return true; // first run: fill the new channel straight away
  if (weekday !== undefined && ((now.getUTCDay() + 6) % 7) + 1 < weekday)
    return false;
  return now.getUTCHours() >= hour;
};
const mark = (key: string, now: Date, weekly: boolean) => {
  state.posted[key] = weekly ? weekOf(now) : dayOf(now);
  save();
};

async function dealsFeed(now: Date): Promise<void> {
  if (!due("deals", now, 15)) return;
  const deals = await steamDeals([], 6);
  if (!deals.length) return;
  const lines = deals.map((d) => {
    const others = [d.gbp, d.eur].filter(Boolean).join(" · ");
    return `**[${d.name}](https://store.steampowered.com/app/${d.appId})**\n${d.usd.final} ~~${d.usd.initial}~~ **-${d.usd.pct}%**${others ? ` · ${others}` : ""} · 👍 ${d.rating}% of ${d.reviews.toLocaleString("en-US")} reviews`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`💸 Today's best Steam deals`)
    .setDescription(lines.join("\n\n"))
    .setImage(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${deals[0]!.appId}/header.jpg`,
    )
    .setFooter({
      text: "Prices checked on Steam today; sales end without warning.",
    })
    .setTimestamp(now);
  await announce(text(ch.deals), {
    content: `<@&${roleId["Deals Pings"]}>`,
    embeds: [embed],
    allowedMentions: { roles: [roleId["Deals Pings"]!] },
  });
  mark("deals", now, false);
  log(`deals: ${deals.length}`);
}

async function freeFeed(now: Date): Promise<void> {
  if (!due("free", now, 16, 4)) return; // Epic swaps its free game on Thursdays
  const { now: live, next } = await freeGames(now);
  if (!live.length) return;
  const ts = (iso?: string) =>
    iso ? ` until <t:${Math.floor(new Date(iso).getTime() / 1000)}:D>` : "";
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("🎁 Free to keep on the Epic Games Store")
    .setDescription(
      [
        ...live.map(
          (g) =>
            `**[${g.title}](${g.url})**${g.originalPrice ? ` ~~${g.originalPrice}~~` : ""} free${ts(g.until)}`,
        ),
        ...(next.length
          ? ["", `**Next week:** ${next.map((g) => g.title).join(", ")}`]
          : []),
      ].join("\n"),
    );
  if (live[0]?.imageUrl) embed.setImage(live[0].imageUrl);
  await announce(text(ch.deals), { embeds: [embed] });
  mark("free", now, true);
}

async function radarFeed(now: Date): Promise<void> {
  if (!due("radar", now, 13, 1)) return;
  const games = await releaseRadar(now, 7, 10);
  if (!games.length) return;
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("📅 Release radar: out this week on Steam")
    .setDescription(
      games
        .map(
          (g) =>
            `<t:${Math.floor(new Date(`${g.date}T12:00:00Z`).getTime() / 1000)}:D> · **[${g.name}](https://store.steampowered.com/app/${g.appId})**${g.developer ? ` · ${g.developer}` : ""}${g.price ? ` · ${g.price}` : ""}`,
        )
        .join("\n"),
    )
    .setImage(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${games[0]!.appId}/header.jpg`,
    )
    .setFooter({
      text: "The most-wishlisted games releasing in the next seven days",
    });
  await announce(text(ch["release-radar"]), { embeds: [embed] });
  mark("radar", now, true);
}

async function trendingFeed(now: Date): Promise<void> {
  if (!due("trending", now, 14, 1)) return;
  const chart = JSON.parse(
    await getText(
      "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/",
    ),
  ) as {
    response?: {
      ranks?: Array<{
        rank: number;
        appid: number;
        last_week_rank?: number;
        peak_in_game: number;
      }>;
    };
  };
  const rows: string[] = [];
  for (const r of chart.response?.ranks ?? []) {
    if (rows.length >= 10) break;
    const d = JSON.parse(
      await getText(
        `https://store.steampowered.com/api/appdetails?appids=${r.appid}&cc=us&l=english&filters=basic`,
      ).catch(() => "{}"),
    )?.[String(r.appid)]?.data;
    if (
      !d ||
      d.type !== "game" ||
      /wallpaper engine|steamvr|banana/i.test(String(d.name))
    )
      continue;
    const move =
      !r.last_week_rank || r.last_week_rank < 0
        ? "🆕"
        : r.last_week_rank > r.rank
          ? `⬆️${r.last_week_rank - r.rank}`
          : r.last_week_rank < r.rank
            ? `⬇️${r.rank - r.last_week_rank}`
            : "➖";
    rows.push(
      `\`${String(rows.length + 1).padStart(2)}\` **[${d.name}](https://store.steampowered.com/app/${r.appid})** · peak ${r.peak_in_game.toLocaleString("en-US")} players ${move}`,
    );
  }
  if (!rows.length) return;
  await announce(text(ch["trending-games"]), {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND)
        .setTitle("🔥 Most played on Steam this week")
        .setDescription(rows.join("\n"))
        .setFooter({
          text: "Daily peak concurrent players; arrows compare with last week",
        })
        .setTimestamp(now),
    ],
  });
  mark("trending", now, true);
}

// ---------------------------------------------------------------- events
client.once(Events.ClientReady, async (c) => {
  guild = await c.guilds.fetch(GUILD);
  await guild.members.fetch();
  await guild.commands.set(COMMANDS as never);
  c.user.setPresence({
    activities: [{ name: "gaming news · /rank", type: ActivityType.Watching }],
  });
  log(`ready as ${c.user.tag} in ${guild.name} (${guild.memberCount} members)`);

  // Everyone gets Viewer, and level roles match the XP already earned.
  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;
    if (roleId.Viewer && !m.roles.cache.has(roleId.Viewer))
      await safe("viewer role", () => m.roles.add(roleId.Viewer!, "member"));
    await safe("level role", () =>
      syncLevelRole(m, levelOf(member(m.id).xp).level),
    );
  }

  const fast = async () => {
    await safe("video feed", videoFeed);
    await safe("news feed", newsFeed);
    await safe("leaderboard", refreshLeaderboard);
  };
  const slow = async () => {
    const now = new Date();
    await safe("stats", refreshStats);
    await safe("deals", () => dealsFeed(now));
    await safe("free games", () => freeFeed(now));
    await safe("release radar", () => radarFeed(now));
    await safe("trending", () => trendingFeed(now));
  };
  await fast();
  await slow();
  setInterval(() => void fast(), 10 * 60_000);
  setInterval(() => void slow(), 30 * 60_000);
  setInterval(() => void voiceTick(), 5 * 60_000);
});

client.on(Events.MessageCreate, async (msg: Message) => {
  if (!msg.inGuild() || msg.guildId !== GUILD || msg.author.bot || msg.system)
    return;
  const rec = member(msg.author.id);
  rec.msgs++;
  const now = Date.now();
  if (now - rec.lastXpAt >= MESSAGE_XP.cooldownMs) {
    rec.lastXpAt = now;
    const m =
      msg.member ??
      (await guild.members.fetch(msg.author.id).catch(() => undefined));
    if (m)
      await safe("xp", () =>
        grantXp(
          m,
          MESSAGE_XP.min +
            Math.floor(Math.random() * (MESSAGE_XP.max - MESSAGE_XP.min + 1)),
          "chat",
        ),
      );
  }
  save();
  if (msg.channelId === ch.introductions)
    await msg.react("👋").catch(() => undefined);
});

client.on(Events.ThreadCreate, async (thread, isNew) => {
  if (!isNew || thread.parentId !== ch.suggestions) return;
  const starter = await thread.fetchStarterMessage().catch(() => undefined);
  for (const e of ["👍", "👎"]) await starter?.react(e).catch(() => undefined);
});

client.on(Events.GuildMemberAdd, async (m) => {
  if (m.guild.id !== GUILD || m.user.bot) return;
  if (roleId.Viewer)
    await safe("viewer role", () => m.roles.add(roleId.Viewer!, "new member"));
  await safe("welcome", async () => {
    await text(ch.general)?.send({
      content: `👋 Welcome to Pulse Gaming, ${m}! Tell us what you are playing in <#${ch.introductions}>, and pick your platforms and pings in **Channels & Roles**.`,
      allowedMentions: { users: [m.id] },
    });
  });
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) await onCommand(i);
    else if (i.isUserContextMenuCommand()) await onUserCommand(i);
  } catch (e) {
    log(
      `command ${i.isCommand() ? i.commandName : "?"} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    if (i.isRepliable() && !i.replied)
      await i
        .reply({
          content: "Something went wrong there. Try again in a moment.",
          ephemeral: true,
        })
        .catch(() => undefined);
  }
});

async function voiceTick(): Promise<void> {
  for (const c of guild.channels.cache.values()) {
    if (!c.isVoiceBased() || c.id === ch.afk) continue;
    const people = c.members.filter((m) => !m.user.bot);
    if (people.size < 2) continue;
    for (const m of people.values()) {
      if (m.voice.selfDeaf || m.voice.serverDeaf) continue;
      member(m.id).voiceMin += 5;
      await safe("voice xp", () => grantXp(m, VOICE_XP, "voice"));
    }
  }
}

client.on(Events.Error, (e) => log(`client error: ${e.message}`));
process.on("unhandledRejection", (e) =>
  log(`unhandled: ${e instanceof Error ? e.message : String(e)}`),
);
await client.login(TOKEN);
