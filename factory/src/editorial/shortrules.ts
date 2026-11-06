// What the world-class audit (Nov 2026) asked of the Shorts' writers, each behind its own setting:
//   #6 a stake for the viewer in the first line (GTA6Videos: "Do NOT pre order"; we state a fact, then ask how you feel),
//   #7 no thin stories ("a name and little else", "the record doesn't say"): the reason to watch is the payoff,
//   #12 the end is a payoff or a line that runs back into the start, not a question or an advert for tomorrow,
//   #14 half the Shorts run one argument with a turn instead of labelled sections, so the two can be compared.
// The rules join the variant note, the last thing the writer reads, so they outrank the general brief above them.
// The checks are pure and cheap: a miss goes back to the writer once with the others, and only a thin story stops.

import { numberWords } from "../voice/speakable.ts";

/** The first line carries the stake. Worded so it holds for a question hook and a statement hook alike (hook style test). */
export const STAKE_RULE = `First line: the hook has to carry a stake for the viewer, not just the fact: what this costs them, saves them, takes from them, or what they should do or not do. Whatever shape the hook takes (a question, a statement, a surprise), someone scrolling past should feel it is about them or their game. Shapes that work, in this story's own words: a warning ("Do not pre-order X yet", only when the sources say X is on sale or open for pre-order), a loss ("Your X save won't carry over"), a thing to do tonight ("Claim X before Friday"), a price they will pay. Keep the game's name in the first five words and every other hook rule.`;

/** The hook of a ranking or list: its premise stays, the stake is the argument fans will have. */
export const STAKE_RULE_EVERGREEN = `First line: besides the premise, the hook gives fans something to fight over or a reason it matters to them ("Your favorite Fallout probably isn't number one"), never just the list's name. It still never hints at number one.`;

export const THIN_RULE = `No filler. If the sources leave something unknown, do not say so to fill time and do not end on it: phrases like "little else", "that's all we know", "the record doesn't say" or "no details yet" tell the viewer there is no reason to stay. Build the Short on what the news changes for the viewer and on the real context around it. If the sources give nothing the viewer could care about beyond a name or a date, write the best draft you can and put one plain sentence saying why in "thin_reason"; otherwise leave it out.`;

const THIN_PHRASES: RegExp[] = [
  /\blittle else\b/i,
  /\b(?:that's|that is) (?:all|about all|everything) (?:we|anyone) knows?\b/i,
  /\bthe record (?:doesn't|does not|never) (?:say|says|show|explain)\b/i,
  /\b(?:no|without) (?:further |other |more |real )?details? (?:yet|so far|at all)\b/i,
  /\bnothing else (?:is|has been|was) (?:known|confirmed|shared|announced|said)\b/i,
  /\bnot much (?:else )?(?:is|to go on|has been)\b/i,
  /\bwe (?:simply |just |still )?(?:don't|do not) know\b/i,
  /\bnobody (?:outside .{1,30})?knows\b/i,
];

/** The script admits it has nothing: a sentence that says so, and the writer's own reason when it gave one. */
export function thinProblems(narration: string, thinReason?: string): string[] {
  const out: string[] = [];
  for (const re of THIN_PHRASES) {
    const hit = narration.match(re);
    if (hit) {
      out.push(
        `The script says "${hit[0]}", which tells the viewer there is no payoff. Build it on what the sources do give: the consequence for the viewer, a comparison, the history.`,
      );
      break;
    }
  }
  if (thinReason?.trim())
    out.push(`The writer called this story thin: ${thinReason.trim()}`);
  return out;
}

/**
 * Never report what a source leaves out. Elden Ring's third community questline (4 Nov 2026) reached the writer as a
 * Steam reprint's opening paragraph; the Short said the post "runs thin" and "names no price, no platforms and no
 * release date", told viewers to hold off pre-ordering, and 18,000 TikTok viewers called it misinformation.
 */
export const SOURCE_TRUTH_RULE = `Say only what the sources say. Never state what a source does not say ("no price", "no release date", "no platforms", "little else", "the post runs thin", "hasn't said when"): a source you were given may be only its headline or opening lines, so a missing detail is not news. The one exception is a full source text that genuinely lacks a detail the story turns on, and then only as a plain fact ("Sony hasn't given a price yet"). For a game that is already out, an "announced" name can be an event, a season, an update, a questline or a collaboration rather than a new game or DLC: say what it is in the sources' own terms, never guess that it is a new product, and never tell viewers to wait on or hold off pre-ordering something the sources do not say is for sale.`;

const ABSENCE_PHRASES: RegExp[] = [
  /\bruns? (?:thin|light|dry)\b/i,
  /\b(?:post|announcement|report|article|source|reveal|trailer|statement)s? (?:is|are|was|were|stays?|stayed|goes|went|reads?) (?:thin|light|vague|silent|quiet|bare)\b/i,
  /\b(?:names?|gives?|lists?|mentions?|shares?|offers?|confirms?|reveals?|includes?|has|had|with|carr(?:y|ies)) no (?:price|platforms?|(?:release |launch )?dates?|(?:release |launch )?window|details?|specifics)\b(?! (?:increases?|hikes?|rises?|changes?|cuts?|drops?)\b)/i,
  /\bno (?:price|platforms?|release date|launch date|release window)(?! (?:increase|hike|rise|change|cut|drop|tag on)s?\b)(?:,| or\b| and\b| yet\b| so far\b| given\b| listed\b| named\b| mentioned\b|\.)/i,
  /\b(?:doesn't|does not|didn't|did not|won't|hasn't|has not|haven't|have not|never) (?:say|said|says|mention|mentioned|name|named|give|given|list|listed|confirm|confirmed|reveal|revealed|share|shared|specify|specified) (?:a |the |any |its |their )?(?:price|platforms?|(?:release |launch )?date|window|when|what it costs|how much|which platforms|details?)\b/i,
  /\b(?:silent|quiet|mum|vague) (?:on|about) (?:the )?(?:price|platforms?|(?:release |launch )?date|when|details?)\b/i,
  /\bnothing (?:on|about) (?:the )?(?:price|platforms?|(?:a |the )?(?:release |launch )?date|when)\b/i,
  /\bno word (?:yet )?(?:on|about)\b/i,
  /\blittle else\b/i,
];

/** Each sentence that reports what the sources leave out: a miss for the writer, and a line the fact check must rule on. */
export function absenceClaims(narration: string): string[] {
  return narration
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x && ABSENCE_PHRASES.some((re) => re.test(x)));
}

export function absenceProblems(narration: string): string[] {
  return absenceClaims(narration).map(
    (x) =>
      `The script says "${x}", which reports what the sources leave out. Say what the sources do say: what the thing is, when, and what it gives the viewer.`,
  );
}

const PREORDER_ADVICE =
  /\b(?:pre-?orders?|pre-?ordering|hold off|before (?:you )?buy(?:ing)?|wait before (?:buying|paying)|don't buy|do not buy|keep your (?:money|wallet))\b/i;
const FOR_SALE =
  /\b(?:pre-?orders?|pre-?purchase|price[ds]?|\$\s?\d|£\s?\d|€\s?\d|\d+(?:\.\d\d)? ?(?:usd|dollars)|on sale|buy|purchase|wishlist|deluxe edition|season pass)\b/i;

/** Buying advice ("don't pre-order", "hold off") for a story whose sources sell nothing. */
export function preorderProblems(narration: string, sourceText: string): string[] {
  const hit = narration.match(PREORDER_ADVICE);
  if (!hit || FOR_SALE.test(sourceText)) return [];
  return [
    `The script gives buying advice ("${hit[0]}"), but no source says anything is for sale or open for pre-order. Say what the thing is per the sources.`,
  ];
}

export const ENDING_RULE = `The ending: this overrides what the brief says about the loop line. The loop_line is a statement, never a question: either the payoff of the whole Short in its sharpest form, or a line whose last words run straight back into the hook, so the replay sounds like the next sentence. Never a question to the viewer, never an advert for ourselves ("the next Why lands tomorrow", "every day", "follow for"), never a summary of what was just said. The viewer's question goes in the pinned comment, not here.`;

/** With a real long video to point at, that pointer stays, as a statement. */
export const ENDING_RULE_FOLLOW = `If this Short has a documentary or ranking to point to, the pointer stays in the line, as a statement.`;

const SELF_ADVERT =
  /\b(next why|lands? tomorrow|every day|each day|tomorrow'?s why|new why|follow for|come back tomorrow)\b/i;

export function endingProblems(loopLine: string): string[] {
  const line = loopLine.trim();
  const out: string[] = [];
  if (/\?["”']?$/.test(line))
    out.push(
      `The loop line "${line}" ends on a question; end on the payoff or a line that runs back into the hook.`,
    );
  if (SELF_ADVERT.test(line))
    out.push(
      `The loop line "${line}" advertises the channel; end on the story's payoff instead.`,
    );
  return out;
}

export const ARGUMENT_RULE = `Shape for this Short: one running argument, not sections. Open on the claim, then each line follows from the last ("so", "but", "which is why", "except") and somewhere past halfway the argument turns: the thing that makes the viewer see it differently. No line stands alone as a labelled fact, the take is simply the argument's conclusion, and it does not announce itself. Set desk_question to an empty string, and pulse_take.label to an empty string.`;

/** A tighter read for a faster Short (SHORT_TIGHT_SCRIPT): every full stop is a pause in the voice. */
export const TIGHT_RULE = `Pace: this Short should sound quick. Use plain short words. Prefer one flowing sentence to two clipped ones: every full stop costs the voice a pause, so no sentence under five words except the hook. No throat-clearing, no restating.`;

/** Which half of the argument test an episode is in: stable for the episode, on the lanes the news writer serves. */
export function argumentArm(
  cfg: { shortArgumentShare: number },
  ep: { id: string; lane: string },
): boolean {
  if (cfg.shortArgumentShare <= 0) return false;
  if (!["news", "news_breaking", "free"].includes(ep.lane)) return false;
  let h = 0;
  for (const c of `argument:${ep.id}`) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  return h % 1000 < cfg.shortArgumentShare * 1000;
}

export interface ShortRuleSettings {
  shortStakeFirst: boolean;
  shortRefuseThin: boolean;
  shortEndPayoff: boolean;
  shortTightScript: boolean;
  shortArgumentShare: number;
  shortEraMatch?: boolean;
}

/** The rules the news and Why writers read last, for this episode. */
export function shortRuleNote(
  cfg: ShortRuleSettings,
  ep: { id: string; lane: string },
): string {
  return [
    cfg.shortStakeFirst ? STAKE_RULE : "",
    cfg.shortRefuseThin ? THIN_RULE : "",
    cfg.shortEndPayoff ? `${ENDING_RULE} ${ENDING_RULE_FOLLOW}` : "",
    cfg.shortTightScript ? TIGHT_RULE : "",
    cfg.shortEraMatch ? ERA_RULE : "",
    argumentArm(cfg, ep) ? ARGUMENT_RULE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The same for a ranking or list Short, whose hook and take have their own shape. */
export function evergreenRuleNote(cfg: ShortRuleSettings): string {
  return [
    cfg.shortStakeFirst ? STAKE_RULE_EVERGREEN : "",
    cfg.shortEndPayoff
      ? "The ending: the loop_line is a statement, never a question to the viewer: the pick's sharpest line, or words that run back into the hook."
      : "",
    cfg.shortTightScript ? TIGHT_RULE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const FIGURE_CARDS = new Set(["stat", "score", "price", "countdown"]);

/**
 * A card's figure has to be in the line it sits on: the card lands on its word, and a viewer who reads "$40B" under
 * "that's 23 games over 24 years" hears one number and sees another. Of 70 figure cards in 30 days about 10 did this
 * ("That's what players are reporting" over ~30GB). Whole numbers only, in digits or words; a sum in other words
 * ("half a million", "a third") is left to the writer.
 */
export function cardFigureProblems(
  beats: Array<{ narration: string; visual: { kind: string; primary: string } }>,
): string[] {
  const out: string[] = [];
  for (const b of beats) {
    if (!FIGURE_CARDS.has(b.visual.kind)) continue;
    const said = b.narration.toLowerCase().replace(/,/g, "");
    const figs = b.visual.primary.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
    for (const fig of figs) {
      const n = Number(fig);
      const inWords =
        Number.isInteger(n) && n < 1e12
          ? new RegExp(`\\b${numberWords(n)}\\b`).test(said)
          : false;
      if (!said.includes(fig) && !inWords) {
        out.push(
          `The card "${b.visual.primary}" sits on the line "${b.narration.slice(0, 80)}", which does not say ${fig}. Say the figure in that line, or put the card on the line that says it.`,
        );
        break;
      }
    }
  }
  return out;
}

export type SourceTag = "CONFIRMED" | "REPORTED" | "ESTIMATE";

const ESTIMATE_WORDS =
  /\b(estimat\w*|projected|projections?|forecasts?|analysts?|surveys?|polled|polls?|tracking firm|sensor tower|piper sandler|ampere|niko partners|data firm|research firm|expected to|on track to)\b/i;
const REPORT_WORDS =
  /\b(reportedly|reports?|reported|according to|sources? (?:say|said|tell|told)|insiders?|claims?|claimed|alleged\w*|leak\w*|rumou?r\w*|supposedly|apparently|unconfirmed)\b/i;

/**
 * What the Short may call its own claim, a rule and not a preference: rumors and estimates are never shown as fact.
 * CONFIRMED needs a publisher's or platform's own source in the story and no estimate or report in the words. Anything
 * built on an estimate says ESTIMATE, anything else from outlets alone says REPORTED. (GTA 6's "$750 million" is a
 * Sensor Tower estimate, and carried CONFIRMED on the Short of 5 Nov 2026.)
 */
export function sourceTag(text: string, hasOfficialSource: boolean): SourceTag {
  if (ESTIMATE_WORDS.test(text)) return "ESTIMATE";
  if (!hasOfficialSource || REPORT_WORDS.test(text)) return "REPORTED";
  return "CONFIRMED";
}

/** The writer names the release it is about, so the pictures can be of that release. */
export const ERA_RULE = `If this Short is about one specific older release and a later remake, remaster or reboot shares its name, put that release's year in "story_year". Say so in the line if a line is truly about both versions.`;

/** The store page is of a release at least this many years after the one the Short is about. */
export const ERA_GAP_YEARS = 3;

/** Whether the store page's release is a later version than the one the Short is about. */
export function eraConflict(
  storyYear: number | undefined,
  storeDate: string | undefined,
): boolean {
  const y = Number(storeDate?.match(/\b(19|20)\d\d\b/)?.[0]);
  return !!storyYear && !!y && y - storyYear >= ERA_GAP_YEARS;
}

/** A line honestly about both versions may show the later one. */
export function lineNamesLaterVersion(
  narration: string | undefined,
  storeDate: string | undefined,
): boolean {
  if (!narration) return false;
  const y = storeDate?.match(/\b(19|20)\d\d\b/)?.[0];
  return (
    /\b(remakes?|remaster(?:s|ed)?|reboots?|re-?releases?)\b/i.test(narration) ||
    (!!y && narration.includes(y))
  );
}
