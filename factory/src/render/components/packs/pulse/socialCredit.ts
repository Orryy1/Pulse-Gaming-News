// The Pulse universe's "said where" quotes (./social.ts): a quote's credit ("Leslie Benzies, on Twitter, 2013",
// "Dan Houser, in an internal email, 2003") read for who said it, where and when. A post, an email or a chat
// window tells the viewer where something was said, so a style may only draw a quote whose credit names that
// medium (shared brief, rule 3): "Dan Houser, producer, GameSpot, 2002" is an interview and gets none of them.
// Pure text functions only, so the tests can check every rule.
import type { MomentGraphic } from "../../LongMoments.tsx";
import { txt, wordCount } from "../screen/common.ts";

/** Where a quote was said, as the three styles draw it. */
export type Medium = "social" | "mail" | "chat";

/** A finer pointer from the medium's own words: a newsgroup, a forum or a feed; a team chat or a phone. */
export type MediumHint =
  | "groups"
  | "boards"
  | "feed"
  | "team"
  | "phone"
  | "desktop";

export interface QuoteCredit {
  /** Who said it, as the credit names them ("Leslie Benzies", "a Rockstar developer"). */
  speaker: string;
  /** The words that name the medium, as given ("on Twitter", "in an internal email"); empty when none. */
  medium: string;
  /** The year, when the credit gives one. */
  year?: number;
  kind?: Medium;
  hint?: MediumHint;
  /** The earliest year the medium's own look can be: a tweet is never drawn as a 1998 newsgroup. */
  floor?: number;
}

/**
 * Parts of a credit that say the words were spoken or printed, not posted or sent: an interview, a talk, a
 * podcast, a magazine. A medium word inside one of these ("in an interview with Twitter's head of games") does
 * not count.
 */
const SPOKEN =
  /\b(interviews?|interviewed|podcasts?|keynotes?|speech|talks?|panels?|conferences?|presentations?|documentar(y|ies)|magazines?|press|statements?|told|broadcasts?|radio|tv|television|videos?|livestreams?|streams?|shows?|events?|book|memoir|biography|q&a|commentary|lecture|earnings)\b/i;

/** A role straight after a platform's name: "Twitter CEO" names a company, not a medium. */
const ROLE_AFTER =
  /^\s*(ceo|cto|coo|cfo|chief|executive|exec|founder|co-?founder|president|vice|vp|chair(man|woman|person)?|boss|head|engineer|employee|staffer|spokes(person|man|woman)|director|manager|developer|designer|investor|editor|writer|columnist|moderator|mod|admin|owner|founders|executives)\b/i;

/** A preposition before the medium word: "on Twitter", "in a Slack message", "via email". */
const PREP_BEFORE = /\b(on|in|via|to|over|across|through|from|onto|into|by)\b/i;

/** Only determiners and a few adjectives before the medium word: "email to staff", "internal memo", "a tweet". */
const LEADS =
  /^\s*((a|an|the|his|her|their|its|one|this|that|internal|leaked|private|public|personal|official|old|deleted|now-deleted|archived|company-wide|studio-wide|later|early|anonymous|short|long|brief|\d{4})\s+)*$/i;

/** A noun after a platform's name that makes it the place: "Facebook post", "Slack message", "Reddit AMA". */
const MEDIA_NOUN =
  /^\s*(posts?|threads?|messages?|dms?|status|updates?|page|account|feed|channels?|server|group|story|stories|repl(y|ies)|comments?|chats?|ama|spaces?|logs?)\b/i;

interface Cue {
  re: RegExp;
  kind: Medium;
  /** Lower ranks win when a credit has several: a DM on Twitter is a chat, an email posted on a forum an email. */
  rank: number;
  /** A platform name needs a preposition before it or a media noun after it; a plain noun may also lead. */
  platform?: boolean;
  /** A verb or a fixed phrase counts wherever it stands ("tweeted", "on X"). */
  anywhere?: boolean;
  hint?: MediumHint;
  floor?: number;
  /** "at the Develop forum" is an event, not a message board. */
  notAfterAt?: boolean;
}

const CUES: Cue[] = [
  // Chats, strongest first.
  {
    re: /\bslack\b/i,
    kind: "chat",
    rank: 1,
    platform: true,
    hint: "team",
    floor: 2014,
  },
  {
    re: /\bdiscord\b/i,
    kind: "chat",
    rank: 1,
    platform: true,
    hint: "team",
    floor: 2015,
  },
  { re: /\bIRC\b/i, kind: "chat", rank: 1, hint: "desktop" },
  {
    re: /\b(ICQ|AIM)\b/,
    kind: "chat",
    rank: 1,
    platform: true,
    hint: "desktop",
  },
  {
    re: /\b(whats ?app|imessage|telegram)\b/i,
    kind: "chat",
    rank: 1,
    platform: true,
    hint: "phone",
    floor: 2009,
  },
  { re: /\b(messenger|skype)\b/i, kind: "chat", rank: 1, platform: true },
  {
    re: /\b(sms|text messages?|texts)\b|\b(a|an) text\b/i,
    kind: "chat",
    rank: 1,
    hint: "phone",
  },
  {
    re: /\btexted\b|\bDMed\b|\bdm'd\b/i,
    kind: "chat",
    rank: 1,
    anywhere: true,
    hint: "phone",
  },
  {
    re: /\bDMs?\b|\b(direct|private) messages?\b/i,
    kind: "chat",
    rank: 1,
    hint: "phone",
  },
  { re: /\binstant messages?\b/i, kind: "chat", rank: 1, hint: "desktop" },
  // A workplace chat is the team window; a group or private one may be either.
  {
    re: /\b(team|internal|work|office|studio) chats?\b|\bchat channels?\b/i,
    kind: "chat",
    rank: 1,
    hint: "team",
  },
  {
    re: /\b(group|private|irc|online|live) chats?\b|\bchat ?(logs?|rooms?|messages?|threads?)\b|\bchatrooms?\b/i,
    kind: "chat",
    rank: 1,
  },
  // Mail.
  { re: /\be-?mails?\b|\bmailing lists?\b/i, kind: "mail", rank: 2 },
  // Lower case only: "in the Daily Mail" is a newspaper.
  { re: /\bmail\b/, kind: "mail", rank: 2 },
  { re: /\be-?mailed\b|\bfaxed\b/i, kind: "mail", rank: 2, anywhere: true },
  {
    re: /\bmemo(s|randum|randa)?\b|\bletters?\b|\bfax\b/i,
    kind: "mail",
    rank: 2,
  },
  {
    re: /\b(internal|staff|private|handwritten) notes?\b|\bnote to\b|\b(a|an) note\b/i,
    kind: "mail",
    rank: 2,
  },
  // Social media, forums, blogs and newsgroups.
  {
    re: /\btwitter\b/i,
    kind: "social",
    rank: 3,
    platform: true,
    hint: "feed",
    floor: 2010,
  },
  {
    re: /\b(re)?tweets?\b/i,
    kind: "social",
    rank: 3,
    hint: "feed",
    floor: 2010,
  },
  {
    re: /\b(re)?tweeted\b|\bblogged\b/i,
    kind: "social",
    rank: 3,
    anywhere: true,
    floor: 2010,
  },
  {
    re: /\b(on|to|via) X\b|\bX (posts?|threads?|account)\b/,
    kind: "social",
    rank: 3,
    anywhere: true,
    hint: "feed",
    floor: 2010,
  },
  {
    re: /\b(instagram|facebook|bluesky|mastodon|tumblr)\b/i,
    kind: "social",
    rank: 3,
    platform: true,
    hint: "feed",
    floor: 2010,
  },
  {
    re: /\b(on|to|via) Threads\b/,
    kind: "social",
    rank: 3,
    anywhere: true,
    hint: "feed",
    floor: 2010,
  },
  { re: /\bmyspace\b/i, kind: "social", rank: 3, platform: true, floor: 2004 },
  { re: /\breddit\b/i, kind: "social", rank: 3, platform: true, floor: 2005 },
  { re: /\bsubreddits?\b|\br\/\w+/i, kind: "social", rank: 3, floor: 2005 },
  { re: /\bAMA\b/, kind: "social", rank: 3, floor: 2010 },
  {
    re: /\b(resetera|neogaf)\b|\bGAF\b/i,
    kind: "social",
    rank: 3,
    platform: true,
    hint: "boards",
  },
  {
    re: /\bforums?\b/i,
    kind: "social",
    rank: 3,
    hint: "boards",
    notAfterAt: true,
  },
  {
    re: /\bmessage ?boards?\b|\bmessageboards?\b|\bbulletin boards?\b|\bBBS\b/i,
    kind: "social",
    rank: 3,
    hint: "boards",
  },
  {
    re: /\bblog(s|post|posts)?\b|\bweblogs?\b/i,
    kind: "social",
    rank: 3,
    floor: 2000,
  },
  {
    re: /\busenet\b|\bnewsgroups?\b|\b(alt|comp|rec)\.[a-z]+/i,
    kind: "social",
    rank: 3,
    hint: "groups",
  },
  // Weak words: a post, posted (a lower-case "post", so The Washington Post is never one).
  { re: /\bposted\b|\bposting\b/i, kind: "social", rank: 4, anywhere: true },
  {
    re: /\b(a|an|his|her|their|one|this|that) post\b/,
    kind: "social",
    rank: 4,
  },
  // A bare "message" is a chat only when nothing better names the medium, and never one to the public.
  { re: /\bmessages?\b(?! ?boards?)|\bmessaged\b/i, kind: "chat", rank: 5 },
];

/** Patch notes, liner notes and the like are not letters. */
const NOT_A_NOTE =
  /\b(patch|liner|release|sleeve|design|production|programme|program|foot|press) ?notes?\b/i;

/** An open message: to fans, players or the public. */
const TO_THE_PUBLIC =
  /\b(fans|players|community|everyone|public|readers|viewers|customers)\b/i;

/** Whether one cue names the medium in this part of a credit. */
function cueHolds(cue: Cue, part: string): boolean {
  const m = cue.re.exec(part);
  if (!m) return false;
  if (cue.anywhere) return true;
  const before = part.slice(0, m.index);
  const after = part.slice(m.index + m[0].length);
  if (ROLE_AFTER.test(after)) return false;
  if (cue.notAfterAt && /\bat\b/i.test(before)) return false;
  if (cue.kind === "mail" && NOT_A_NOTE.test(part)) return false;
  // "a message to fans" was published, not sent to someone: no chat window for it.
  if (cue.rank === 5 && TO_THE_PUBLIC.test(part)) return false;
  if (PREP_BEFORE.test(before)) return true;
  if (!LEADS.test(before)) return false;
  return cue.platform ? MEDIA_NOUN.test(after) || after.trim() === "" : true;
}

const YEAR = /^(19[89]\d|20[0-4]\d)$/;

/** Opening quote marks off, so a post or a bubble shows the words alone. */
export function quoteText(primary: string): string {
  return txt(primary)
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim();
}

/**
 * Who said a quote, where and when, from its credit. The medium is the part (after the speaker's) that names
 * a chat, an email or a post; a role or an outlet is left out. "Leslie Benzies on Twitter" with no comma is
 * split at the preposition.
 */
export function quoteCredit(secondary: string): QuoteCredit {
  const parts = txt(secondary)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let speaker = parts[0] ?? "";
  const rest = parts.slice(1);
  // A credit with the medium inside its first part: split it at the preposition before the medium.
  if (!rest.some((p) => CUES.some((c) => !SPOKEN.test(p) && cueHolds(c, p)))) {
    const m = /^(.+?)\s+((on|in|via|over)\s+.+)$/i.exec(speaker);
    if (m && !SPOKEN.test(m[2]!) && CUES.some((c) => cueHolds(c, m[2]!))) {
      speaker = m[1]!;
      rest.unshift(m[2]!);
    }
  }
  let best: { cue: Cue; part: string } | undefined;
  for (const part of rest) {
    if (SPOKEN.test(part)) continue;
    for (const cue of CUES)
      if (cueHolds(cue, part) && (!best || cue.rank < best.cue.rank))
        best = { cue, part };
  }
  const yearPart = parts.find((p) => YEAR.test(p));
  const inline = best?.part.match(/\b(19[89]\d|20[0-4]\d)\b/);
  const year = yearPart
    ? Number(yearPart)
    : inline
      ? Number(inline[0])
      : undefined;
  return {
    speaker: YEAR.test(speaker) ? "" : speaker,
    medium: best?.part ?? "",
    year,
    kind: best?.cue.kind,
    hint: best?.cue.hint,
    floor: best?.cue.floor,
  };
}

/** The credit as it goes under the graphic: speaker, medium and year, nothing else ("Leslie Benzies, on Twitter, 2013"). */
export function creditLine(c: QuoteCredit): string {
  const year =
    c.year && !c.medium.includes(String(c.year)) ? String(c.year) : "";
  return [c.speaker, c.medium, year].filter(Boolean).join(", ");
}

/** A speaker named only by role ("a Rockstar developer") gets a plain silhouette instead of initials. */
export const anonymous = (speaker: string) =>
  /^(a|an|one|some|two|several)\s/i.test(speaker);

/** Two letters for an avatar: "Leslie Benzies" LB; an article is skipped. */
export function initialsOf(speaker: string): string {
  return speaker
    .replace(/^(a|an|the|one)\s+/i, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .map((w) => w[0]!)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** The display name: the speaker with a capital first letter ("A Rockstar developer"). */
export const displayName = (speaker: string) =>
  speaker.charAt(0).toUpperCase() + speaker.slice(1);

/** PulseSocial's look by year: a newsgroup reader to 1999, a forum thread to 2009, a feed post after. */
export type SocialLook = "groups" | "boards" | "feed";

export function socialLook(
  year: number | undefined,
  c: Pick<QuoteCredit, "hint" | "floor">,
): SocialLook {
  if (c.hint === "groups" || c.hint === "boards" || c.hint === "feed")
    return c.hint;
  const y = Math.max(year ?? 2015, c.floor ?? 0);
  return y <= 1999 ? "groups" : y <= 2009 ? "boards" : "feed";
}

/** PulseMail's look by year: a grey desktop client to 2004, a clean webmail after. */
export type MailLook = "desktop" | "webmail";

export const mailLook = (year: number | undefined): MailLook =>
  (year ?? 2015) <= 2004 ? "desktop" : "webmail";

/** PulseChat's look: a desktop buddy chat to 2008 (an IRC relay window for IRC), then a team chat or a phone. */
export type ChatLook = "relay" | "messenger" | "team" | "phone";

export function chatLook(
  year: number | undefined,
  c: Pick<QuoteCredit, "hint" | "floor" | "medium">,
  variant = 0,
): ChatLook {
  if (/\birc\b/i.test(c.medium)) return "relay";
  const y = Math.max(year ?? 2015, c.floor ?? 0);
  if (c.hint === "desktop" || y <= 2008)
    return y <= 1997 ? "relay" : "messenger";
  if (c.hint === "team" || c.hint === "phone") return c.hint;
  return variant % 2 ? "phone" : "team";
}

/** The quote and its credit, when this graphic is a quote with a speaker said in this medium. */
function said(
  g: MomentGraphic,
  kind: Medium,
): { words: number; chars: number; credit: QuoteCredit } | undefined {
  if (g.kind !== "quote") return undefined;
  const credit = quoteCredit(g.secondary);
  if (credit.kind !== kind || !credit.speaker || credit.speaker.length > 44)
    return undefined;
  const q = quoteText(g.primary);
  return { words: wordCount(q), chars: q.length, credit };
}

/** A post: 3-60 words (a feed card or a forum post holds a paragraph at 34 px and more). */
export const fitsPulseSocial = (g: MomentGraphic) => {
  const s = said(g, "social");
  return !!s && s.words >= 3 && s.words <= 60 && s.chars <= 380;
};

/** An email body: 3-70 words. */
export const fitsPulseMail = (g: MomentGraphic) => {
  const s = said(g, "mail");
  return !!s && s.words >= 3 && s.words <= 70 && s.chars <= 440;
};

/** One chat bubble: 2-40 words, so it reads as a message rather than a wall on a phone. */
export const fitsPulseChat = (g: MomentGraphic) => {
  const s = said(g, "chat");
  return !!s && s.words >= 2 && s.words <= 40 && s.chars <= 250;
};
