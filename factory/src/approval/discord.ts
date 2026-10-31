// Discord is the dashboard: approvals, alerts and the daily heartbeat all land
// in one channel via a plain webhook (no bot to host).

import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithTimeout, log, errorMessage } from "../lib/util.ts";

export interface DiscordMessage {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  files?: string[];
  /** Something the owner must act on: pings @everyone so the phone actually buzzes (servers default to mentions only). */
  ping?: boolean;
  /** Background news (a story dropped, a retry, a quality note): kept for the evening summary, not sent on its own. */
  level?: "info";
}

/** true = delivered, false = delivery failed, undefined = Discord not configured. */
export async function postDiscord(webhookUrl: string, msg: DiscordMessage): Promise<boolean | undefined> {
  if (!webhookUrl) {
    log("info", "discord (not configured)", { content: msg.content, title: msg.embeds?.[0]?.title });
    return undefined;
  }
  try {
    const payload = {
      username: "Pulse Factory",
      content: msg.ping ? `@everyone ${msg.content ?? ""}`.trim() : msg.content,
      embeds: msg.embeds,
      allowed_mentions: { parse: msg.ping ? ["everyone"] : [] },
    };
    let res: Response;
    if (msg.files?.length) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      for (const [i, f] of msg.files.entries()) {
        form.append(`files[${i}]`, new Blob([await fs.readFile(f)]), path.basename(f));
      }
      res = await fetchWithTimeout(webhookUrl, { method: "POST", body: form }, 60_000);
    } else {
      res = await fetchWithTimeout(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    }
    if (!res.ok) {
      log("warn", "discord post failed", { status: res.status, body: (await res.text()).slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    log("warn", "discord post failed", { error: errorMessage(err) });
    return false;
  }
}

export const COLOURS = { brand: 0xff6b1a, ok: 0x22c55e, warn: 0xffc21a, alert: 0xff3b3b };

export async function alert(webhookUrl: string, title: string, detail: string): Promise<void> {
  log("error", title, { detail });
  await postDiscord(webhookUrl, { embeds: [{ title: `⚠️ ${title}`, description: detail.slice(0, 3900), color: COLOURS.alert }] });
}
