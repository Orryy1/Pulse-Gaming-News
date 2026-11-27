/**
 * STORY_PREMISE_GATE (frontier check 25 Nov 2026, queue item 47): no news Short whose whole point is that nothing is
 * known, a price or edition list, patch notes or an outage, unless the story also carries a conflict or a surprise.
 *
 * Seven of the ten lowest-marked Shorts in the 25 Nov blind marking were of this kind (presets unconfirmed, a New
 * Zealand switch unconfirmed, a bonus cutoff, a preorder price, a track list, patch notes, outage reports), while an
 * "unconfirmed" story with a real conflict (Rockstar layoffs) marked best. So the test is conflict or surprise, not the
 * word "unconfirmed". Payoff links to views (0.24) and average viewed (0.33) in that marking.
 *
 * Pure and model-free: the headline is read against the patterns below, before the editor sees the slot's candidates.
 * Half the news slots get the gate (STORY_PREMISE_GATE_SHARE, split by slot time), so its effect can be measured; the
 * slot's arm and what it dropped are logged as a `premise_gate` event on the episode it made.
 */

export type PremiseKind =
  | "nothing_known"
  | "price_list"
  | "patch_notes"
  | "outage";

export type PremiseArm = "gate" | "open";

export interface PremiseFlag {
  kind: PremiseKind;
  /** The words that matched, for the log. */
  matched: string;
}

/** A story whose point is that nothing is confirmed, known or announced yet. */
const NOTHING_KNOWN =
  /\b(?:no (?:confirmed|official|word|news|update|release date|date|details|info(?:rmation)?|answer)\b|not (?:yet )?(?:confirmed|announced|known|revealed|clear)\b|unconfirmed\b|isn'?t (?:confirmed|known|clear)|hasn'?t (?:been )?(?:confirmed|announced|revealed)|has not been (?:confirmed|announced|revealed)|nothing (?:is )?(?:known|confirmed|official)|(?:still|remains?) (?:unknown|unclear|a mystery|unconfirmed)|what we know(?: so far)?\b|everything we know\b|no sign of (?:[\w'-]+ ){0,5}?(?:release|date|trailer|launch|reveal|announcement)\b)/i;

/** A price, preorder, edition, bonus or track list: shopping, not a story. */
const PRICE_LIST =
  /\b(?:pre-?orders?\b|pre-?load(?:s|ing)?\b|prices?\b|pricing\b|how much (?:is|does|will|cash)|which edition|editions? (?:compared|explained|differences)|every edition|pre-?order bonus(?:es)?|bonus(?:es)? cut-?off|track ?list|full soundtrack|songs? list|radio stations? list|where to buy|release times?\b|unlock times?\b|file size|download size|install size)/i;

/** Patch notes and update logs. */
const PATCH_NOTES =
  /\b(?:patch notes?\b|hotfix(?:es)?\b|changelog|title update|every change\b|full list of changes)/i;

/** Server status and outage reports. */
const OUTAGE =
  /\b(?:(?:servers?|psn|playstation network|xbox live|xbox network|steam|battle\.?net|ea app|ubisoft connect|epic games store)(?: (?:is|are))? (?:down|offline|having issues)\b|outages?\b|downtime\b|server status|server maintenance|error codes?\b|can'?t (?:log ?in|connect))/i;

/**
 * A conflict or a surprise: the story has a side to take or something unexpected, so it stays whatever else it is.
 * A rise in price is a conflict; a price on its own is not.
 */
const CONFLICT =
  /\b(?:lay-?offs?\b|laid off|fir(?:es|ed|ing)\b|lawsuits?\b|sue[sd]?\b|suing\b|court\b|ban(?:s|ned|ning)?\b|backlash|boycott\w*|outrage\w*|furious|angr(?:y|ier)\b|anger\b|criticis\w*|slams?\b|slammed|blast(?:s|ed)?\b|cancel\w*|delay\w*|postpon\w*|shut(?:s|ting)? down|shutter\w*|pull(?:s|ed|ing)\b|remov(?:es|ed|al|ing)\b|refund\w*|strikes?\b|leak\w*|controvers\w*|vs\.?(?=\s)|versus|beats?\b|beaten|records?\b|record-breaking|biggest|largest|first time|secret(?:s|ly)?\b|hidden|u-?turn|revers\w*|admit\w*|den(?:ies|ied|y)\b|accus\w*|price (?:hike|increase|rise|cut|drop)s?\b|prices? (?:rise|rises|go up|going up|increase|increases|cut|drop|drops)\b|raises? (?:the )?prices?\b|more expensive|cheaper than|slash\w*|(?:reveal|announc|confirm|unveil)\w* (?:\w+ ){0,4}price\b|takedown|dmca|exclusives?\b|scam\w*|broken|disaster\w*|crash\w*|for good\b|permanently|end of service|end-of-service|offline forever|cost \$?[\d.,]+ (?:million|billion))/i;

/** Why a headline fails the premise test (pure): the first kind matched, or nothing when it passes. */
export function premiseFlag(headline: string): PremiseFlag | undefined {
  const h = (headline ?? "").replace(/[‘’]/g, "'");
  if (!h.trim() || CONFLICT.test(h)) return undefined;
  for (const [kind, re] of [
    ["nothing_known", NOTHING_KNOWN],
    ["patch_notes", PATCH_NOTES],
    ["outage", OUTAGE],
    ["price_list", PRICE_LIST],
  ] as const) {
    const m = h.match(re);
    if (m) return { kind, matched: m[0] };
  }
  return undefined;
}

/** A slot's side of the test (pure): "gate" for a hash under the share. */
export function premiseArmFor(hash: number, share: number): PremiseArm {
  return share > 0 && hash < share ? "gate" : "open";
}

export interface PremiseGateResult<T> {
  /** The candidates the editor sees: the passing ones, or all of them when every one would be dropped. */
  kept: T[];
  dropped: Array<{ headline: string; kind: PremiseKind; matched: string }>;
  /** Every candidate failed the test, so none was dropped and the slot keeps its usual choice. */
  allFlagged: boolean;
}

/**
 * The gate over a slot's candidates (pure). On the "open" side nothing changes. On the "gate" side a candidate that
 * fails the premise test is dropped and the editor takes the next one; when every candidate fails, the list stands,
 * because a slot with a weak story still beats an empty slot.
 */
export function gateCandidates<T extends { headline: string }>(
  candidates: T[],
  arm: PremiseArm,
): PremiseGateResult<T> {
  if (arm === "open")
    return { kept: candidates, dropped: [], allFlagged: false };
  const dropped: PremiseGateResult<T>["dropped"] = [];
  const kept: T[] = [];
  for (const c of candidates) {
    const f = premiseFlag(c.headline);
    if (f)
      dropped.push({ headline: c.headline, kind: f.kind, matched: f.matched });
    else kept.push(c);
  }
  if (!kept.length)
    return { kept: candidates, dropped: [], allFlagged: candidates.length > 0 };
  return { kept, dropped, allFlagged: false };
}
