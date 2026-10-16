import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/db.ts";
import { migrate } from "../src/db.ts";
import type { Config } from "../src/config.ts";
import type { FeedItem } from "../src/discovery/rss.ts";
import type { Script } from "../src/editorial/schema.ts";

export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query(sql, params);
      return r.rows as T[];
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

export async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pulse-test-"));
}

export function testConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    publicUrl: "https://factory.example",
    dataDir,
    databaseUrl: "",
    appSecret: "test-secret-0123456789",
    adminToken: "admin",
    anthropicModel: "test",
    elevenLabsApiKey: "x",
    elevenLabsVoiceId: "v",
    elevenLabsModel: "m",
    discordWebhookUrl: "",
    healthcheckPingUrl: "",
    legacyTokenDir: "",
    googleClientId: "",
    googleClientSecret: "",
    youtubeRefreshToken: "",
    youtubePrivacy: "public",
    youtubeVetoMinutes: 0,
    dailyTarget: 1,
    selectFromHourUtc: 0,
    minGapHours: 0,
    tickMinutes: 10,
    maxStoryAgeHours: 24,
    includeRumours: false,
    approvalMode: "auto",
    approvalTimeoutMinutes: 60,
    publishWindowStartUtc: 0,
    publishWindowEndUtc: 24,
    visionQa: true,
    musicBed: true,
    dryRun: false,
    maxAttempts: 3,
    remotionConcurrency: 1,
    browserExecutable: "",
    ...overrides,
  };
}

export function item(title: string, source: string, kind: FeedItem["sourceKind"] = "outlet", minutesAgo = 30, now = new Date()): FeedItem {
  return {
    title,
    url: `https://${source.toLowerCase().replace(/\W+/g, "")}.example/${encodeURIComponent(title.toLowerCase().replace(/\W+/g, "-"))}`,
    summary: `${title}. More detail here.`,
    publishedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    source,
    sourceKind: kind,
  };
}

export function goodScript(overrides: Partial<Script> = {}): Script {
  return {
    story_type: "delay",
    game_title: "Starfield",
    steam_search_term: "Starfield",
    headline: "Starfield Expansion Delayed To 2027",
    hook: "Starfield's second expansion has been delayed to early 2027.",
    beats: [
      {
        narration: "Bethesda confirmed the move on Xbox Wire this morning and says the extra time will go on polish and performance across every platform.",
        visual: { kind: "date", primary: "Early 2027", secondary: "new window" },
      },
      {
        narration: "The expansion was previously due this December, so that is a slip of at least three months for players waiting on it.",
        visual: { kind: "stat", primary: "3+ months", secondary: "later than planned" },
      },
    ],
    pulse_take: {
      label: "OUR READ",
      narration: "Our read: Bethesda has delayed big content before and it usually lands in better shape, so this is not a red flag yet.",
      on_screen: "Not a red flag yet",
    },
    loop_line: "So mark early 2027, because Starfield's second expansion is",
    is_rumour: false,
    attribution: "Source: Xbox Wire / IGN",
    youtube: { title: "Starfield Expansion Delayed To Early 2027", description: "Bethesda has moved the expansion. Sources: Xbox Wire and IGN.", tags: ["starfield", "bethesda"] },
    claims: [{ claim: "Delayed to early 2027", source_url: "https://xboxwire.example/x" }],
    ...overrides,
  };
}
