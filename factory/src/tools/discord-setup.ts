// Lays out the Pulse Gaming community Discord: categories, channels, forums, voice, live stats, roles,
// Community mode, onboarding, welcome screen, AutoMod and the opening posts. Safe to re-run: it reuses
// what exists by name, creates what is missing, and never deletes a channel that holds messages (old
// ones move to a hidden Archive category). The staff channels (#mod-log, #bot-commands, #pulse-ops)
// are never touched.
// Usage: node --import tsx src/tools/discord-setup.ts [--dry-run]
process.loadEnvFile(".env");
import fs from "node:fs";

const TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const G = process.env.DISCORD_GUILD_ID ?? "";
const DRY = process.argv.includes("--dry-run");
if (!TOKEN || !G)
  throw new Error("DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set");

const BRAND = 0xff6b1a;
const STAFF = new Set(["mod-log", "bot-commands", "pulse-ops"]);
const P = {
  VIEW: 1n << 10n,
  SEND: 1n << 11n,
  REACT: 1n << 6n,
  PUB_THREADS: 1n << 35n,
  PRIV_THREADS: 1n << 36n,
  CONNECT: 1n << 20n,
};
const T = {
  text: 0,
  voice: 2,
  category: 4,
  announce: 5,
  stage: 13,
  forum: 15,
} as const;

async function api(method: string, path: string, body?: unknown): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: {
        authorization: `Bot ${TOKEN}`,
        "content-type": "application/json",
        "x-audit-log-reason": "Pulse server layout",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const j = (await res.json()) as { retry_after?: number };
      await new Promise((r) =>
        setTimeout(r, Math.ceil((j.retry_after ?? 1) * 1000) + 250),
      );
      continue;
    }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `${method} ${path}: ${res.status} ${JSON.stringify(j).slice(0, 400)}`,
      );
    return j;
  }
  throw new Error(`${method} ${path}: rate limited`);
}
const log = (s: string) => console.log(DRY ? `[dry] ${s}` : s);
const write = async (
  method: string,
  path: string,
  body?: unknown,
  what = "",
) => {
  log(`${method} ${what || path}`);
  return DRY
    ? { id: `dry-${Math.random().toString(36).slice(2, 8)}` }
    : api(method, path, body);
};

type Chan = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  permission_overwrites?: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
  topic?: string;
};
let roles: Array<{
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  permissions: string;
}> = await api("GET", `/guilds/${G}/roles`);
let chans: Chan[] = await api("GET", `/guilds/${G}/channels`);
const guild = await api("GET", `/guilds/${G}?with_counts=true`);
const byName = (name: string, type?: number) =>
  chans.find((c) => c.name === name && (type === undefined || c.type === type));
const messages = async (id: string) =>
  id.startsWith("dry")
    ? []
    : ((await api("GET", `/channels/${id}/messages?limit=5`)) as unknown[]);

// ---------------------------------------------------------------- roles
const ROLES: Array<{
  name: string;
  was?: string;
  color: number;
  hoist?: boolean;
  mentionable?: boolean;
}> = [
  { name: "Admin", color: 0xe5484d, hoist: true },
  { name: "Moderator", color: 0x3e9bff, hoist: true },
  { name: "Legend", was: "Leaker", color: 0xffc53d, hoist: true },
  { name: "OG", color: 0xff8f3d, hoist: true },
  { name: "Insider", color: 0xff6b1a, hoist: true },
  { name: "Regular", color: 0xd9692f, hoist: true },
  { name: "Viewer", color: 0x9a8f86 },
  { name: "PlayStation", color: 0x2e6db4 },
  { name: "Xbox", color: 0x2f9e44 },
  { name: "Nintendo", color: 0xd63a3a },
  { name: "PC Gamer", color: 0x8a8f98 },
  { name: "Video Pings", color: 0, mentionable: false },
  { name: "Breaking News Pings", color: 0, mentionable: false },
  { name: "Deals Pings", color: 0, mentionable: false },
];
const role: Record<string, string> = {};
for (const r of ROLES) {
  const have =
    roles.find((x) => x.name === r.name) ??
    (r.was ? roles.find((x) => x.name === r.was) : undefined);
  const body = {
    name: r.name,
    color: r.color,
    hoist: r.hoist ?? false,
    mentionable: r.mentionable ?? false,
  };
  if (have) {
    if (have.name !== r.name || have.color !== r.color)
      await write(
        "PATCH",
        `/guilds/${G}/roles/${have.id}`,
        body,
        `role ${have.name} -> ${r.name}`,
      );
    role[r.name] = have.id;
  } else
    role[r.name] = (
      await write("POST", `/guilds/${G}/roles`, body, `role ${r.name}`)
    ).id;
}

// Rank the roles (highest first) beneath the bot's own role, which is as high as it can reach.
if (!DRY) roles = await api("GET", `/guilds/${G}/roles`);
const me = await api("GET", "/users/@me");
const mine = (await api("GET", `/guilds/${G}/members/${me.id}`)) as { roles: string[] };
const ceiling = Math.max(...roles.filter((r) => mine.roles.includes(r.id)).map((r) => r.position));
const ranked = ROLES.map((r) => role[r.name]!).filter((id) => {
  const r = roles.find((x) => x.id === id);
  return r && r.position < ceiling;
});
await write(
  "PATCH",
  `/guilds/${G}/roles`,
  ranked.map((id, i) => ({ id, position: ceiling - 1 - i })),
  `order ${ranked.length} roles under the bot`,
);

// ---------------------------------------------------------------- categories
const CATS: Array<{
  key: string;
  name: string;
  was?: string[];
  hidden?: boolean;
}> = [
  { key: "stats", name: "📊 SERVER STATS" },
  { key: "start", name: "📌 START HERE", was: ["📢 INFORMATION"] },
  { key: "live", name: "📰 PULSE LIVE", was: ["🔥 NEWS FEED"] },
  { key: "community", name: "💬 COMMUNITY" },
  { key: "games", name: "🎮 GAMES" },
  { key: "levels", name: "🏆 LEVELS & EVENTS", was: ["🏆 COMPETITIONS"] },
  { key: "feedback", name: "💡 FEEDBACK", was: ["📊 FEEDBACK"] },
  { key: "voice", name: "🔊 VOICE" },
  { key: "staff", name: "🔇 STAFF" },
  { key: "archive", name: "📦 ARCHIVE", hidden: true },
];
const cat: Record<string, string> = {};
for (const c of CATS) {
  const have = chans.find(
    (x) =>
      x.type === T.category && (x.name === c.name || c.was?.includes(x.name)),
  );
  const overwrites = c.hidden
    ? [{ id: G, type: 0, allow: "0", deny: String(P.VIEW) }]
    : undefined;
  if (have) {
    if (have.name !== c.name)
      await write(
        "PATCH",
        `/channels/${have.id}`,
        { name: c.name },
        `category ${have.name} -> ${c.name}`,
      );
    if (overwrites && c.key !== "staff")
      await write(
        "PATCH",
        `/channels/${have.id}`,
        { permission_overwrites: overwrites },
        `hide ${c.name}`,
      );
    cat[c.key] = have.id;
  } else
    cat[c.key] = (
      await write(
        "POST",
        `/guilds/${G}/channels`,
        { name: c.name, type: T.category, permission_overwrites: overwrites },
        `category ${c.name}`,
      )
    ).id;
}

// ---------------------------------------------------------------- channels
const readOnly = [
  {
    id: G,
    type: 0,
    allow: String(P.VIEW),
    deny: String(P.SEND | P.PUB_THREADS | P.PRIV_THREADS),
  },
];
const open = [{ id: G, type: 0, allow: String(P.VIEW), deny: "0" }];
type Spec = {
  key: string;
  name: string;
  type: number;
  cat: string;
  topic?: string;
  ro?: boolean;
  reuse?: string[];
  fresh?: boolean;
  locked?: boolean;
  tags?: string[];
};
const SPECS: Spec[] = [
  {
    key: "members",
    name: "👥 Members: …",
    type: T.voice,
    cat: "stats",
    locked: true,
  },
  {
    key: "subs",
    name: "▶️ YouTube: …",
    type: T.voice,
    cat: "stats",
    locked: true,
  },
  {
    key: "videos",
    name: "🎬 Videos: …",
    type: T.voice,
    cat: "stats",
    locked: true,
  },
  {
    key: "welcome",
    name: "welcome",
    type: T.text,
    cat: "start",
    ro: true,
    reuse: ["welcome"],
    topic: "Start here: what Pulse Gaming is and where everything lives.",
  },
  {
    key: "rules",
    name: "rules",
    type: T.text,
    cat: "start",
    ro: true,
    fresh: true,
    topic: "The server rules. Read them once; they keep this place good.",
  },
  {
    key: "announcements",
    name: "announcements",
    type: T.text,
    cat: "start",
    ro: true,
    reuse: ["announcements"],
    topic: "Channel news, milestones and server updates.",
  },
  {
    key: "roles",
    name: "roles",
    type: T.text,
    cat: "start",
    ro: true,
    fresh: true,
    topic:
      "Pick your platforms and pings in Channels & Roles. Level roles are earned by chatting.",
  },
  {
    key: "video-drops",
    name: "video-drops",
    type: T.text,
    cat: "live",
    ro: true,
    reuse: ["video-drops"],
    topic: "Every new Pulse Gaming video, the moment it goes live.",
  },
  {
    key: "breaking-news",
    name: "breaking-news",
    type: T.text,
    cat: "live",
    ro: true,
    reuse: ["breaking-news"],
    topic: "Big gaming stories as they break, checked before they are posted.",
  },
  {
    key: "deals",
    name: "deals",
    type: T.text,
    cat: "live",
    ro: true,
    topic: "The best Steam deals of the day, in dollars, pounds and euros.",
  },
  {
    key: "release-radar",
    name: "release-radar",
    type: T.text,
    cat: "live",
    ro: true,
    topic: "What is out this week, every Monday.",
  },
  {
    key: "trending-games",
    name: "trending-games",
    type: T.text,
    cat: "live",
    ro: true,
    topic:
      "What everyone is playing right now: Steam's most played, updated weekly.",
  },
  {
    key: "general",
    name: "general",
    type: T.text,
    cat: "community",
    reuse: ["general"],
    topic: "Anything gaming. Be kind, have fun.",
  },
  {
    key: "introductions",
    name: "introductions",
    type: T.text,
    cat: "community",
    reuse: ["introductions"],
    topic:
      "New here? Say hello: what you play, what on, and your all-time favourite.",
  },
  {
    key: "news-chat",
    name: "news-chat",
    type: T.text,
    cat: "community",
    topic: "Talk about the latest stories and videos from Pulse Live.",
  },
  {
    key: "gaming-talk",
    name: "gaming-talk",
    type: T.text,
    cat: "community",
    reuse: ["gaming-talk"],
    topic: "Deep dives, reviews, recommendations and hot takes.",
  },
  {
    key: "clips",
    name: "clips-and-screenshots",
    type: T.text,
    cat: "community",
    reuse: ["clip-submissions"],
    topic:
      "Your best clips and screenshots. The great ones may get featured on the channel.",
  },
  {
    key: "memes",
    name: "memes",
    type: T.text,
    cat: "community",
    reuse: ["memes"],
    topic: "Gaming memes. Keep it clean.",
  },
  {
    key: "predictions",
    name: "predictions",
    type: T.text,
    cat: "community",
    reuse: ["predictions"],
    topic: "Call it before it happens: release dates, reveals, review scores.",
  },
  {
    key: "game-hub",
    name: "game-hub",
    type: T.forum,
    cat: "games",
    topic:
      "One post per game or topic. Search before you start a new one, and tag it.",
    tags: [
      "GTA VI",
      "Call of Duty",
      "Nintendo",
      "PlayStation",
      "Xbox",
      "PC",
      "Indie",
      "Retro",
      "Esports",
      "Spoilers",
    ],
  },
  {
    key: "lfg",
    name: "looking-for-group",
    type: T.forum,
    cat: "games",
    topic:
      "Find people to play with. Say the game, platform, time zone and what you are after.",
    tags: ["PlayStation", "Xbox", "PC", "Switch", "Mobile", "Cross-play"],
  },
  {
    key: "level-ups",
    name: "level-ups",
    type: T.text,
    cat: "levels",
    ro: true,
    reuse: ["level-ups"],
    topic: "Level-up shout-outs. Every message earns XP.",
  },
  {
    key: "leaderboard",
    name: "leaderboard",
    type: T.text,
    cat: "levels",
    ro: true,
    fresh: true,
    topic: "The top members by XP, updated live. Check your own with /rank.",
  },
  {
    key: "giveaways",
    name: "giveaways",
    type: T.text,
    cat: "levels",
    ro: true,
    fresh: true,
    topic: "Giveaways and community events.",
  },
  {
    key: "suggestions",
    name: "suggestions",
    type: T.forum,
    cat: "feedback",
    topic:
      "Ideas for videos, games to cover or server features. One idea per post; vote with reactions.",
    tags: ["Video idea", "Server", "Bug", "Done"],
  },
  {
    key: "polls",
    name: "polls",
    type: T.text,
    cat: "feedback",
    ro: true,
    fresh: true,
    topic: "Vote on what comes next.",
  },
  {
    key: "feedback",
    name: "feedback",
    type: T.text,
    cat: "feedback",
    reuse: ["feedback"],
    topic: "What is working and what is not. All feedback welcome.",
  },
  {
    key: "lounge",
    name: "🎮 Lounge",
    type: T.voice,
    cat: "voice",
    reuse: ["General"],
  },
  { key: "squad1", name: "🎮 Squad 1", type: T.voice, cat: "voice" },
  { key: "squad2", name: "🎮 Squad 2", type: T.voice, cat: "voice" },
  { key: "watch", name: "📺 Watch Party", type: T.stage, cat: "voice" },
  { key: "afk", name: "💤 AFK", type: T.voice, cat: "voice" },
];
// Old channels with nothing to carry over into the new layout (and old copies of "fresh" ones) go to the archive.
const RETIRE = [
  "leaks",
  "rumours",
  "confirmed",
  "trivia",
  "daily-streak",
  "role-select",
];

const chan: Record<string, string> = {};
const used = new Set<string>();
const archive = async (c: Chan, why: string) => {
  if (STAFF.has(c.name) || used.has(c.id)) return;
  await write(
    "PATCH",
    `/channels/${c.id}`,
    {
      parent_id: cat.archive,
      permission_overwrites: [{ id: G, type: 0, allow: "0", deny: String(P.VIEW) }],
      name: c.name.startsWith("old-") ? c.name : `old-${c.name}`,
    },
    `archive #${c.name} (${why})`,
  );
  used.add(c.id);
};

// Community first (forums, stages, announcement channels and onboarding need it): it needs a rules
// channel and a private updates channel to exist.
const modlog = byName("mod-log");
async function ensure(s: Spec, communityReady: boolean): Promise<void> {
  if ((s.type === T.forum || s.type === T.stage) && !communityReady) return;
  const parent = cat[s.cat]!;
  let have = s.reuse
    ?.map((n) =>
      chans.find(
        (c) =>
          c.name === n &&
          !used.has(c.id) &&
          c.parent_id !== cat.archive &&
          (c.type === s.type || (s.type === T.text && c.type === T.announce)),
      ),
    )
    .find(Boolean);
  if (!have)
    have = chans.find(
      (c) =>
        c.name === s.name &&
        c.parent_id === parent &&
        !used.has(c.id) &&
        c.type === s.type,
    );
  if (s.locked)
    have =
      have ??
      chans.find(
        (c) =>
          c.parent_id === parent &&
          c.type === T.voice &&
          c.name.startsWith(s.name.split(":")[0]!) &&
          !used.has(c.id),
      );
  const overwrites = s.locked
    ? [{ id: G, type: 0, allow: String(P.VIEW), deny: String(P.CONNECT) }]
    : s.ro
      ? readOnly
      : open;
  const body: Record<string, unknown> = {
    name: s.name,
    parent_id: parent,
    permission_overwrites: overwrites,
  };
  if (
    s.topic &&
    (s.type === T.text || s.type === T.forum || s.type === T.announce)
  )
    body.topic = s.topic;
  if (s.type === T.forum && s.tags) {
    body.available_tags = s.tags.map((name) => ({ name }));
    body.default_reaction_emoji = { emoji_name: "🔥" };
  }
  // An old channel of the same name (its own description) is archived; the one this tool made is kept.
  if (have && s.fresh && have.topic !== s.topic && (await messages(have.id)).length) {
    await archive(have, "old posts kept");
    have = undefined;
  }
  if (have) {
    const { available_tags, ...patch } = body as { available_tags?: unknown };
    void available_tags;
    await write(
      "PATCH",
      `/channels/${have.id}`,
      have.type === T.forum ? body : patch,
      `update #${have.name}${have.name !== s.name ? ` -> ${s.name}` : ""}`,
    );
    chan[s.key] = have.id;
    used.add(have.id);
  } else {
    const made = await write(
      "POST",
      `/guilds/${G}/channels`,
      { ...body, type: s.type },
      `create #${s.name}`,
    );
    chan[s.key] = made.id;
    used.add(made.id);
    chans.push({ id: made.id, name: s.name, type: s.type, parent_id: parent });
  }
}

const community = (guild.features as string[]).includes("COMMUNITY");
for (const s of SPECS) await ensure(s, community);
if (!community) {
  await write(
    "PATCH",
    `/guilds/${G}`,
    {
      features: [...guild.features, "COMMUNITY"],
      verification_level: 1,
      explicit_content_filter: 2,
      rules_channel_id: chan.rules,
      public_updates_channel_id: modlog?.id,
    },
    "turn on Community (verification: email; media scanned for everyone)",
  );
  if (!DRY) chans = await api("GET", `/guilds/${G}/channels`);
  for (const s of SPECS.filter((x) => x.type === T.forum || x.type === T.stage))
    await ensure(s, true);
}
// Announcement channels let other servers follow the feed.
for (const k of ["announcements", "video-drops"]) {
  const c = chans.find((x) => x.id === chan[k]);
  if (c && c.type === T.text)
    await write(
      "PATCH",
      `/channels/${c.id}`,
      { type: T.announce },
      `#${c.name} -> announcement channel`,
    );
}
// Everything left over that is not staff: old copies and retired channels go to the archive (never deleted
// when they hold messages); empty default categories are removed.
if (!DRY) chans = await api("GET", `/guilds/${G}/channels`);
for (const c of chans) {
  if (
    c.type === T.category ||
    used.has(c.id) ||
    STAFF.has(c.name) ||
    c.parent_id === cat.archive
  )
    continue;
  if (c.parent_id === cat.staff) continue;
  await archive(
    c,
    RETIRE.includes(c.name) ? "retired" : "not in the new layout",
  );
}
for (const c of chans.filter(
  (x) => x.type === T.category && !Object.values(cat).includes(x.id),
)) {
  const kids = chans.filter(
    (x) =>
      x.parent_id === c.id && !used.has(x.id) && x.parent_id !== cat.archive,
  );
  if (!kids.length)
    await write(
      "DELETE",
      `/channels/${c.id}`,
      undefined,
      `remove empty category ${c.name}`,
    );
}

// ---------------------------------------------------------------- order
const order = [
  ...CATS.map((c) => cat[c.key]!),
  ...SPECS.map((s) => chan[s.key]!),
].filter(Boolean);
await write(
  "PATCH",
  `/guilds/${G}/channels`,
  CATS.map((c, i) => ({ id: cat[c.key], position: i })).concat(
    SPECS.map((s) => ({
      id: chan[s.key]!,
      position: SPECS.filter((x) => x.cat === s.cat).indexOf(s),
    })),
  ),
  `order ${order.length} channels`,
);

// ---------------------------------------------------------------- server settings, branding
const logo = fs.existsSync("public/logo.png")
  ? `data:image/png;base64,${fs.readFileSync("public/logo.png").toString("base64")}`
  : undefined;
await write(
  "PATCH",
  `/guilds/${G}`,
  {
    description:
      "Gaming news, rankings and deals, checked and explained. The community behind Pulse Gaming.",
    default_message_notifications: 1,
    system_channel_id: chan.welcome,
    system_channel_flags: (1 << 1) | (1 << 2),
    afk_channel_id: chan.afk,
    afk_timeout: 300,
    ...(logo ? { icon: logo } : {}),
  },
  "server settings: mentions-only notifications, join messages in #welcome, AFK channel, icon",
);

// ---------------------------------------------------------------- onboarding and welcome screen
const ping = (k: string) => `<#${chan[k]}>`;
type Prompt = { id?: string; title: string; options: Array<{ id?: string; title: string } & Record<string, unknown>> } & Record<string, unknown>;
const onboarding: { prompts: Prompt[] } & Record<string, unknown> = {
    enabled: true,
    mode: 0,
    default_channel_ids: [
      "welcome",
      "rules",
      "announcements",
      "video-drops",
      "breaking-news",
      "general",
      "introductions",
      "news-chat",
      "gaming-talk",
      "clips",
      "memes",
      "predictions",
      "game-hub",
      "lfg",
      "suggestions",
    ].map((k) => chan[k]),
    prompts: [
      {
        type: 0,
        title: "What do you play on?",
        single_select: false,
        required: false,
        in_onboarding: true,
        options: [
          {
            title: "PlayStation",
            emoji_name: "🎮",
            role_ids: [role.PlayStation],
            channel_ids: [],
          },
          {
            title: "Xbox",
            emoji_name: "🟩",
            role_ids: [role.Xbox],
            channel_ids: [],
          },
          {
            title: "Nintendo",
            emoji_name: "🍄",
            role_ids: [role.Nintendo],
            channel_ids: [],
          },
          {
            title: "PC",
            emoji_name: "🖥️",
            role_ids: [role["PC Gamer"]],
            channel_ids: [],
          },
        ],
      },
      {
        type: 0,
        title: "What should we ping you about?",
        single_select: false,
        required: false,
        in_onboarding: true,
        options: [
          {
            title: "New videos",
            description: "A ping when a Pulse video goes live",
            emoji_name: "🎬",
            role_ids: [role["Video Pings"]],
            channel_ids: [chan["video-drops"]],
          },
          {
            title: "Breaking news",
            description: "Only the big stories",
            emoji_name: "🚨",
            role_ids: [role["Breaking News Pings"]],
            channel_ids: [chan["breaking-news"]],
          },
          {
            title: "Deals",
            description: "The best Steam deals each day",
            emoji_name: "💸",
            role_ids: [role["Deals Pings"]],
            channel_ids: [chan.deals],
          },
        ],
      },
    ],
  };
// Discord wants an id on every question and answer: keep the ones already there (matched by title)
// so re-runs edit in place, and mint snowflake-shaped ids for new ones.
const existing: { prompts?: Prompt[] } = await api("GET", `/guilds/${G}/onboarding`);
let seq = 0n;
const mint = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + seq++);
for (const p of onboarding.prompts) {
  const had = existing.prompts?.find((x) => x.title === p.title);
  p.id = had?.id ?? mint();
  for (const o of p.options) o.id = had?.options.find((x) => x.title === o.title)?.id ?? mint();
}
await write("PUT", `/guilds/${G}/onboarding`, onboarding, "onboarding: platforms and pings");
await write(
  "PATCH",
  `/guilds/${G}/welcome-screen`,
  {
    enabled: true,
    description: "Gaming news, rankings and deals, checked and explained.",
    welcome_channels: [
      {
        channel_id: chan.rules,
        description: "Read the rules",
        emoji_name: "📜",
      },
      {
        channel_id: chan.introductions,
        description: "Say hello",
        emoji_name: "👋",
      },
      {
        channel_id: chan["video-drops"],
        description: "New videos as they go live",
        emoji_name: "🎬",
      },
      {
        channel_id: chan.general,
        description: "Chat about anything gaming",
        emoji_name: "💬",
      },
      {
        channel_id: chan["game-hub"],
        description: "A forum for every game",
        emoji_name: "🎮",
      },
    ],
  },
  "welcome screen",
);

// ---------------------------------------------------------------- AutoMod
const rulesNow: Array<{ name: string }> = DRY
  ? []
  : await api("GET", `/guilds/${G}/auto-moderation/rules`);
const exempt = [role.Admin, role.Moderator];
const alert = modlog ? [{ type: 2, metadata: { channel_id: modlog.id } }] : [];
const AUTOMOD = [
  {
    name: "Pulse: slurs and sexual content",
    trigger_type: 4,
    trigger_metadata: { presets: [2, 3] },
    actions: [
      {
        type: 1,
        metadata: { custom_message: "That message breaks the server rules." },
      },
      ...alert,
    ],
  },
  { name: "Pulse: spam", trigger_type: 3, actions: [{ type: 1 }] },
  {
    name: "Pulse: mention spam",
    trigger_type: 5,
    trigger_metadata: {
      mention_total_limit: 5,
      mention_raid_protection_enabled: true,
    },
    actions: [
      { type: 1 },
      { type: 3, metadata: { duration_seconds: 600 } },
      ...alert,
    ],
  },
  {
    name: "Pulse: invite links",
    trigger_type: 1,
    trigger_metadata: {
      regex_patterns: ["(discord\\.gg|discord(app)?\\.com/invite)/\\S+"],
    },
    actions: [
      {
        type: 1,
        metadata: { custom_message: "Invite links are not allowed here." },
      },
      ...alert,
    ],
  },
];
for (const r of AUTOMOD)
  if (!rulesNow.some((x) => x.name === r.name))
    await write(
      "POST",
      `/guilds/${G}/auto-moderation/rules`,
      { ...r, event_type: 1, enabled: true, exempt_roles: exempt },
      `AutoMod: ${r.name}`,
    ).catch((e: Error) => console.log(`AutoMod ${r.name} skipped: ${e.message}`));

// ---------------------------------------------------------------- opening posts (only into empty channels)
const post = async (k: string, embeds: unknown[]) => {
  if (DRY) return log(`post in #${k}`);
  if ((await messages(chan[k]!)).length)
    return log(`#${k} already has posts; left as is`);
  await write(
    "POST",
    `/channels/${chan[k]}/messages`,
    { embeds },
    `post in #${k}`,
  );
};
const links =
  "[YouTube](https://youtube.com/@PulseGMG) · [TikTok](https://www.tiktok.com/@pulsegamingnews) · [Instagram](https://instagram.com/pulse.gmg) · [X](https://x.com/Pulse_GMG) · [pulsegmg.com](https://pulsegmg.com)";
await post("welcome", [
  {
    color: BRAND,
    title: "Welcome to Pulse Gaming 👋",
    description: [
      "Gaming news, rankings and deals, checked and explained. This is the community behind the channel.",
      "",
      "**Start here**",
      `📜 Read ${ping("rules")}`,
      "🎮 Pick your platforms and pings in **Channels & Roles** at the top of the channel list",
      `👋 Say hello in ${ping("introductions")}`,
      "",
      "**Pulse Live**",
      `🎬 ${ping("video-drops")} every new video the moment it is live`,
      `🚨 ${ping("breaking-news")} big stories as they break`,
      `💸 ${ping("deals")} the best Steam deals each day`,
      `📅 ${ping("release-radar")} what is out this week`,
      `🔥 ${ping("trending-games")} what everyone is playing right now`,
      "",
      "**Hang out**",
      `💬 ${ping("general")} · ${ping("news-chat")} · ${ping("gaming-talk")} · ${ping("clips")}`,
      `🎮 ${ping("game-hub")} a forum for every game · ${ping("lfg")} find people to play with`,
      "",
      "**Level up**",
      `Every message earns XP. Climb from Viewer to Regular, Insider, OG and Legend. Check yours with **/rank**, see the top members in ${ping("leaderboard")}, and claim **/daily** to build a streak.`,
      "",
      links,
    ].join("\n"),
  },
]);
await post("rules", [
  {
    color: BRAND,
    title: "📜 Server rules",
    description: [
      "**1. Be decent.** Disagree about games all you like; never attack the person.",
      "**2. No hate.** No slurs, harassment, discrimination or threats. Zero tolerance.",
      "**3. Keep it safe for work.** No NSFW, gore or shock content anywhere.",
      `**4. No spam or self-promotion.** No invite links, ads or repeated posts. Your clips are welcome in ${ping("clips")}.`,
      "**5. No piracy or cheats.** No links to pirated games, cracks, cheats or stolen leaked material.",
      "**6. Spoilers in spoiler tags,** with the game's name outside them: `||like this||`.",
      "**7. Right channel, right topic.** Check the channel description if unsure.",
      "**8. Discord's rules apply:** [Terms](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines).",
      "",
      "Moderators may warn, time out or remove anyone breaking these. AutoMod blocks slurs, spam, mass mentions and invite links automatically.",
    ].join("\n"),
  },
]);
await post("roles", [
  {
    color: BRAND,
    title: "🎭 Roles",
    description: [
      "**Your platforms and pings:** open **Channels & Roles** at the top of the channel list (or the server name, then Channels & Roles) and tick what fits. Change them any time.",
      "",
      "🎮 PlayStation · 🟩 Xbox · 🍄 Nintendo · 🖥️ PC",
      "🎬 Video Pings · 🚨 Breaking News Pings · 💸 Deals Pings",
      "",
      "**Level roles are earned by chatting:**",
      "👀 Viewer: when you join",
      "⭐ Regular: level 5",
      "🔥 Insider: level 10",
      "🏅 OG: level 20",
      "👑 Legend: level 35",
    ].join("\n"),
  },
]);
console.log(
  DRY ? "dry run complete: nothing changed" : "server layout applied",
);
if (!DRY) fs.writeFileSync(
  "data/discord/layout.json",
  JSON.stringify({ channels: chan, roles: role, categories: cat }, null, 2),
);
