// Messages for the owner at a set time (data/admin/notices.json: [{ at, content, sent? }]), posted by the factory
// itself. Claude's scheduled tasks cannot be relied on for this: an unattended run that needs one shell step
// to read a setting waits for an approval nobody is there to give (28 Oct 2026).
import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import { errorMessage, log } from "./lib/util.ts";

export interface Notice {
  at: string; // ISO time it goes out
  content: string;
  sent?: string; // ISO time it went out
}

export const noticesFile = (cfg: Pick<Config, "dataDir">) =>
  path.join(cfg.dataDir, "admin", "notices.json");

/** Posts every notice that is due and not yet sent, then records it as sent. Never throws. */
export async function sendDueNotices(
  cfg: Pick<Config, "dataDir">,
  now: Date,
  notify: (m: { content: string; ping?: boolean }) => Promise<unknown>,
): Promise<number> {
  const file = noticesFile(cfg);
  let list: Notice[];
  try {
    list = JSON.parse(await fs.readFile(file, "utf8")) as Notice[];
  } catch {
    return 0;
  }
  let sent = 0;
  for (const n of list) {
    if (n.sent || !n.content || !(new Date(n.at).getTime() <= now.getTime()))
      continue;
    try {
      await notify({ content: n.content.slice(0, 2000), ping: true });
      n.sent = now.toISOString();
      sent++;
    } catch (err) {
      log("warn", "notice failed", { error: errorMessage(err) });
    }
  }
  if (sent) await fs.writeFile(file, JSON.stringify(list, null, 2));
  return sent;
}
