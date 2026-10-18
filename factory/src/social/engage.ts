// One community post a day on Facebook and Instagram: "which was better", "guess
// the game", "rate it" or an open question, built around games people are
// talking about. The post image is rendered from official IGDB screenshots;
// a "guess" post gets its answer as a comment a day later; comment counts are
// read back after a day and the best-performing posts steer the next choices.
// The events table is the ledger (kind engage_post, engage_answer, engage_metrics).

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { Llm } from "../editorial/llm.ts";
import { logEvent } from "../episodes.ts";
import { dayKey, localTime } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { VisualAsset } from "../assets/steam.ts";
import type { EngageFormat } from "../render/Engage.tsx";

export const EngageTopicSchema = z.object({
  format: z.enum(["versus", "guess", "rate", "question"]),
  games: z
    .array(z.string())
    .min(1)
    .max(2)
    .describe("Exact official titles: two for versus, one otherwise"),
  kicker: z
    .string()
    .describe(
      "2-4 words on the badge, e.g. 'WHICH WAS BETTER?', 'GUESS THE GAME', 'RATE IT', 'YOUR TAKE'",
    ),
  question: z
    .string()
    .describe(
      "The question on the image, under 70 characters, e.g. 'Super Mario Bros. 3 or Super Mario World?'. For guess: 'Name this game from one screenshot.'",
    ),
  caption: z
    .string()
    .describe(
      "1-3 short sentences under the post that invite a reply with a reason, then 3-5 hashtags. Never 'like and share', never 'tag a friend', no more than one emoji",
    ),
  answer: z
    .string()
    .describe(
      "guess only: the game's title, posted as a comment tomorrow; empty otherwise",
    ),
});
export type EngageTopic = z.infer<typeof EngageTopicSchema>;

const FORMATS: EngageFormat[] = ["versus", "guess", "rate", "question"];

export function engagePrompt(): string {
  return `You run the community posts for Pulse Gaming News, a gaming news channel, on Facebook and Instagram. American English.
Write one post that makes people want to answer: a friendly argument, a memory, a test of knowledge. Pick from the formats:
- versus: two games people genuinely argue about (same series or same era), "X or Y?"
- guess: one well-known game recognizable from a single screenshot; the answer is posted tomorrow
- rate: a game in this week's news, "out of 10?"
- question: an open question with a story behind it ("hardest boss you ever beat?") tied to one game
Games must be real, well known and easy to find pictures of. Nothing about violence, politics or tragedy. No engagement bait ("like if", "share if", "tag a friend").`;
}

export async function chooseEngageTopic(
  llm: Llm,
  ctx: {
    headlines: string[];
    candidates: string[];
    recent: Array<{ format: string; games: string[]; comments?: number }>;
    format: EngageFormat;
  },
): Promise<EngageTopic> {
  const best = [...ctx.recent]
    .filter((r) => typeof r.comments === "number")
    .sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0))
    .slice(0, 5);
  return llm.structured({
    system: engagePrompt(),
    content: `Today's format: ${ctx.format}
In the news this week:\n${
      ctx.headlines
        .slice(0, 25)
        .map((h) => `- ${h}`)
        .join("\n") || "- nothing notable"
    }
Popular games right now:\n${ctx.candidates
      .slice(0, 30)
      .map((c) => `- ${c}`)
      .join("\n")}
Posted recently (do not repeat these games):\n${
      ctx.recent
        .slice(0, 20)
        .map((r) => `- ${r.format}: ${r.games.join(" vs ")}`)
        .join("\n") || "- nothing yet"
    }
${best.length ? `Got the most comments:\n${best.map((r) => `- ${r.format}: ${r.games.join(" vs ")} (${r.comments} comments)`).join("\n")}` : ""}`,
    schema: EngageTopicSchema,
    effort: "low",
  });
}

/** The format for a day: rotates so the feed never repeats itself two days running. */
export function formatForDay(day: string): EngageFormat {
  const n = [...day].reduce((a, c) => a + c.charCodeAt(0), 0);
  return FORMATS[n % FORMATS.length]!;
}

export interface EngageDeps {
  db: Db;
  cfg: Config;
  llm: Llm;
  now: () => Date;
  headlines: () => Promise<string[]>;
  candidates: () => Promise<string[]>;
  igdbArt: (title: string, dir: string) => Promise<VisualAsset[]>;
  render: (
    dir: string,
    outFile: string,
    props: {
      format: EngageFormat;
      kicker: string;
      question: string;
      labels: string[];
      imageFiles: string[];
    },
  ) => Promise<void>;
  facebook?: {
    photo: (imageUrl: string, message: string) => Promise<string>;
    comment: (postId: string, text: string) => Promise<string>;
    comments: (postId: string) => Promise<number>;
  };
  instagram?: {
    image: (imageUrl: string, caption: string) => Promise<string>;
    comment: (mediaId: string, text: string) => Promise<string>;
    comments: (mediaId: string) => Promise<number>;
  };
  notify: (m: { content: string }) => Promise<unknown>;
}

interface PostRow {
  id: number;
  created_at: string;
  detail: {
    day: string;
    format: EngageFormat;
    games: string[];
    answer?: string;
    facebook?: string;
    instagram?: string;
    comments?: number;
  };
}

async function posts(db: Db, days = 30): Promise<PostRow[]> {
  return db.query<PostRow>(
    `SELECT id, created_at, detail FROM events WHERE kind = 'engage_post' AND created_at > now() - make_interval(days => $1) ORDER BY id DESC`,
    [days],
  );
}

/** The day's post, the next day's answers and the metrics: safe to call every few minutes. */
export async function engageTick(d: EngageDeps): Promise<void> {
  if (!d.facebook && !d.instagram) return;
  const now = d.now();
  const recent = await posts(d.db);
  // Yesterday's "guess" posts get their answer.
  for (const p of recent) {
    const age = now.getTime() - new Date(p.created_at).getTime();
    if (
      p.detail.format === "guess" &&
      p.detail.answer &&
      age > 22 * 3_600_000 &&
      !(await done(d.db, "engage_answer", p.id))
    ) {
      const text = `The answer: ${p.detail.answer}. How many of you got it? 🎮`;
      if (p.detail.facebook && d.facebook)
        await d.facebook
          .comment(p.detail.facebook, text)
          .catch((err) =>
            log("warn", "engage answer failed", {
              platform: "facebook",
              error: errorMessage(err),
            }),
          );
      if (p.detail.instagram && d.instagram)
        await d.instagram
          .comment(p.detail.instagram, text)
          .catch((err) =>
            log("warn", "engage answer failed", {
              platform: "instagram",
              error: errorMessage(err),
            }),
          );
      await logEvent(d.db, null, "engage_answer", { post: p.id });
    }
    // A day on: how many people answered.
    if (age > 24 * 3_600_000 && !(await done(d.db, "engage_metrics", p.id))) {
      let comments = 0;
      if (p.detail.facebook && d.facebook)
        comments += await d.facebook.comments(p.detail.facebook).catch(() => 0);
      if (p.detail.instagram && d.instagram)
        comments += await d.instagram
          .comments(p.detail.instagram)
          .catch(() => 0);
      await logEvent(d.db, null, "engage_metrics", { post: p.id, comments });
      await d.db.query(
        `UPDATE events SET detail = jsonb_set(detail, '{comments}', to_jsonb($2::int)) WHERE id = $1`,
        [p.id, comments],
      );
    }
  }
  // Today's post, once, after the slot.
  const day = dayKey(now, d.cfg.timezone);
  const slot = localTime(day, d.cfg.engageSlot, d.cfg.timezone);
  if (now < slot || now.getTime() - slot.getTime() > 3 * 3_600_000) return;
  if (recent.some((p) => p.detail.day === day)) return;
  const format = formatForDay(day);
  const topic = await chooseEngageTopic(d.llm, {
    headlines: await d.headlines().catch(() => []),
    candidates: await d.candidates().catch(() => []),
    recent: recent.map((p) => ({
      format: p.detail.format,
      games: p.detail.games,
      comments: p.detail.comments,
    })),
    format,
  });
  const dir = path.join(d.cfg.dataDir, "engage", day);
  await fs.promises.mkdir(dir, { recursive: true });
  const games = topic.games.slice(0, topic.format === "versus" ? 2 : 1);
  const files: string[] = [];
  for (const [i, g] of games.entries()) {
    const art = await d
      .igdbArt(g, path.join(dir, `g${i}`))
      .catch(() => [] as VisualAsset[]);
    const pick =
      art.find((a) => a.kind === "screenshot") ??
      art.find((a) => a.kind === "hero");
    if (pick) files.push(path.join(`g${i}`, pick.file).replace(/\\/g, "/"));
  }
  if (files.length < games.length) {
    log("warn", "engage post skipped: no pictures for the games", { games });
    await logEvent(d.db, null, "engage_post", {
      day,
      format: topic.format,
      games,
      skipped: "no pictures",
    });
    return;
  }
  const image = `post_${Date.now()}.jpg`;
  await d.render(dir, path.join(dir, image), {
    format: topic.format,
    kicker: topic.kicker,
    question: topic.question,
    labels: topic.format === "guess" ? [] : games,
    imageFiles: files,
  });
  const url = `${d.cfg.publicUrl.replace(/\/$/, "")}/engage/${day}/${image}`;
  const detail: PostRow["detail"] = {
    day,
    format: topic.format,
    games,
    answer: topic.answer || undefined,
  };
  if (d.facebook)
    detail.facebook = await d.facebook
      .photo(url, `${topic.question}\n\n${topic.caption}`)
      .catch(
        (err) => (
          log("warn", "engage post failed", {
            platform: "facebook",
            error: errorMessage(err),
          }),
          undefined
        ),
      );
  if (d.instagram)
    detail.instagram = await d.instagram
      .image(url, `${topic.question}\n\n${topic.caption}`)
      .catch(
        (err) => (
          log("warn", "engage post failed", {
            platform: "instagram",
            error: errorMessage(err),
          }),
          undefined
        ),
      );
  await logEvent(d.db, null, "engage_post", detail);
  log("info", "engage post", {
    day,
    format: topic.format,
    games,
    facebook: Boolean(detail.facebook),
    instagram: Boolean(detail.instagram),
  });
  if (!detail.facebook && !detail.instagram)
    await d.notify({
      content: `⚠️ Today's community post did not go out on Facebook or Instagram (${topic.question}).`,
    });
}

async function done(db: Db, kind: string, post: number): Promise<boolean> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = $1 AND (detail->>'post')::int = $2`,
    [kind, post],
  );
  return Number(r?.n ?? 0) > 0;
}
