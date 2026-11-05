// The GTA VI launch's community posts, 18 to 21 Nov 2026 (LAUNCH_COMMUNITY_POSTS). Fixed text, so launch week spends no
// model call on them and nothing can drift: every post is a question about the viewer's own play, spoiler free, and claims
// nothing about the game beyond its name and setting. They go through the daily community post (Facebook, Instagram when on),
// which the factory posts itself, so the browser routines' pause on 18-20 Nov does not touch them.

import type { EngageTopic } from "./engage.ts";

const GAME = "Grand Theft Auto VI";
const TAGS = "#GTA6 #GTAVI #Gaming";

export const LAUNCH_POSTS: Readonly<Record<string, EngageTopic>> = {
  "2026-11-18": {
    format: "question",
    games: [GAME],
    kicker: "YOUR TAKE",
    question: "Story first, or lose a whole day exploring?",
    caption: `It unlocks region by region over the next day. What is your first hour going to look like, and why? No spoilers in the replies, please. ${TAGS}`,
    answer: "",
  },
  "2026-11-19": {
    format: "question",
    games: [GAME],
    kicker: "LAUNCH DAY",
    question: "What was the first thing you did in Leonida?",
    caption: `Launch day. Tell us the very first thing you did, and keep it spoiler free for everyone still downloading. ${TAGS}`,
    answer: "",
  },
  "2026-11-20": {
    format: "question",
    games: [GAME],
    kicker: "ONE WORD",
    question: "GTA VI so far, in one word?",
    caption: `One word, then one sentence on why. Spoiler free, so everyone can join in. ${TAGS}`,
    answer: "",
  },
  "2026-11-21": {
    format: "rate",
    games: [GAME],
    kicker: "RATE IT",
    question: "GTA VI after two days: how many out of 10?",
    caption: `Give it a score and the one reason behind it. No story spoilers. ${TAGS}`,
    answer: "",
  },
};

export function launchPostFor(day: string): EngageTopic | undefined {
  return LAUNCH_POSTS[day];
}
