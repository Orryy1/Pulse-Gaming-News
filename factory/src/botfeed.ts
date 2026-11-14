// The bot feed (12 Nov 2026, owner: "get the bot(s) feedback all day every day"): every Discord message the factory
// sends, alerts and errors included, also goes to ~/PulseFactory/state/discord_posts.jsonl, one JSON object a line
// ({ at, channel, text }), for the PC watch task (C:\Claude\orchestrator\bot_feed.py). Secret-shaped text is masked
// and the file keeps its last 5,000 lines. BOT_FEED_FILE moves it; BOT_FEED_FILE=off stops it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEEP = 5_000;
let writes = 0;

function feedFile(): string | undefined {
  const set = process.env.BOT_FEED_FILE?.trim();
  if (set === "off") return undefined;
  return (
    set ||
    path.join(os.homedir(), "PulseFactory", "state", "discord_posts.jsonl")
  );
}

/** Webhook URLs, API keys, bearer tokens and other long secret-looking runs become "[masked]". */
export function maskSecrets(text: string): string {
  return text
    .replace(
      /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\S+/gi,
      "[masked webhook]",
    )
    .replace(
      /\b(?:sk|pk|rk|xox[abp]|ghp|gho|github_pat|AIza)[-_A-Za-z0-9]{12,}/g,
      "[masked]",
    )
    .replace(
      /\b(?:bearer|token|key|secret|password)\s*[:=]\s*\S+/gi,
      (m) => `${m.split(/[:=]/)[0]}=[masked]`,
    )
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[masked]");
}

/** The channel a webhook posts to, by the setting that holds it; never the URL itself. */
export function channelName(webhookUrl: string): string {
  if (!webhookUrl) return "not-configured";
  for (const [k, v] of Object.entries(process.env)) {
    if (k.includes("DISCORD") && v && v.trim() === webhookUrl.trim())
      return (
        k
          .replace(/^DISCORD_/, "")
          .replace(/_?WEBHOOK(_URL)?$/, "")
          .toLowerCase() || "alerts"
      );
  }
  return "other";
}

export function messageText(msg: {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
}): string {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  for (const e of msg.embeds ?? []) {
    for (const k of ["title", "description"])
      if (typeof e[k] === "string") parts.push(e[k] as string);
    for (const f of (e.fields as
      | Array<{ name?: string; value?: string }>
      | undefined) ?? [])
      parts.push(`${f.name ?? ""}: ${f.value ?? ""}`);
  }
  return parts.join("\n");
}

/** Appends one message; never throws (the feed must not stop an alert). */
export function feedBotPost(
  webhookUrl: string,
  msg: {
    content?: string;
    embeds?: Array<Record<string, unknown>>;
    level?: string;
  },
  now = Date.now(),
): void {
  const file = feedFile();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      at: Math.round(now / 1000),
      channel:
        channelName(webhookUrl) + (msg.level === "info" ? ":digest" : ""),
      text: maskSecrets(messageText(msg)).slice(0, 8_000),
    });
    fs.appendFileSync(file, line + "\n");
    if (++writes % 100 === 1) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      if (lines.length > KEEP)
        fs.writeFileSync(file, lines.slice(-KEEP).join("\n") + "\n");
    }
  } catch {
    // a full disk or a locked file must never stop the post itself
  }
}
