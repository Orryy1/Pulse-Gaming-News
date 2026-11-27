// A community post and a poll for every documentary, drafted when it goes live. The YouTube Data API
// has no community-post endpoint for third parties, so these are text: kept on the episode
// (assets.community) and put in the publish notice for the owner to paste into the Community tab.
// Both are built from what the script already holds (its title, its chapters' games and years), so a
// documentary costs no extra model call. American spelling: the audience is US-first.

import type { Script } from "../editorial/schema.ts";

export interface CommunityDrafts {
  /** Two or three lines ending in a question, with the video link. */
  post: string;
  /** A question with three or four options drawn from the chapters; absent when the chapters give fewer than three. */
  poll?: { question: string; options: string[] };
}

/** YouTube trims poll options past this many characters; a longer game title is cut at a word. */
export const POLL_OPTION_MAX = 36;

/** The documentary's chapters in story order (entries are ranked with the first chapter highest). */
export function chapterGames(
  script: Script,
): Array<{ game: string; year: number }> {
  return [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => ({ game: e.game_title.trim(), year: e.year }))
    .filter((e) => e.game);
}

/** Up to n items spread evenly through a list, always keeping the first and the last. */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++)
    out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  return out;
}

function shortOption(title: string): string {
  if (title.length <= POLL_OPTION_MAX) return title;
  const cut = title.slice(0, POLL_OPTION_MAX);
  const atWord = cut.lastIndexOf(" ");
  return (atWord > 12 ? cut.slice(0, atWord) : cut).replace(/[\s:,-]+$/, "");
}

export function communityPoll(
  script: Script,
): CommunityDrafts["poll"] | undefined {
  const games: string[] = [];
  for (const c of chapterGames(script))
    if (!games.some((g) => g.toLowerCase() === c.game.toLowerCase()))
      games.push(c.game);
  if (games.length < 3) return undefined;
  const series = script.game_title.trim() || "the series";
  return {
    question: `Which ${series} game was the peak?`,
    options: spread(games, 4).map(shortOption),
  };
}

export function communityPost(script: Script, videoId: string): string {
  const chapters = chapterGames(script);
  const first = chapters[0];
  const last = chapters.at(-1);
  const span =
    first && last && first !== last
      ? ` ${chapters.length} chapters, from ${first.game} (${first.year}) to ${last.game} (${last.year}).`
      : "";
  const series = script.game_title.trim() || "the series";
  return [
    `New documentary: ${script.youtube.title}.${span}`,
    `Which ${series} game was the one for you, and what made it?`,
    `Watch: https://youtu.be/${videoId}`,
  ].join("\n");
}

export function communityDrafts(
  script: Script,
  videoId: string,
): CommunityDrafts {
  const poll = communityPoll(script);
  return { post: communityPost(script, videoId), ...(poll ? { poll } : {}) };
}

/** The drafts as they go into the Discord notice: ready to copy. */
export function communityBlock(d: CommunityDrafts): string {
  const lines = ["Community post to paste:", d.post];
  if (d.poll)
    lines.push(
      "",
      "Poll to paste:",
      d.poll.question,
      ...d.poll.options.map((o) => `• ${o}`),
    );
  return lines.join("\n");
}
