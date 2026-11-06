// Drawn scenes for the documentary lines nothing filmed can show (31 Oct 2026, the filler-visuals programme):
// about one sentence in five is a meeting, a deadline, a late night, a call, a shipment or someone leaving,
// and those lines sat on the chapter's general footage or on stock that repeats. Two families answer them:
//   - period objects: a still life of the era with one small action (a code editor scrolling on a CRT, boxes
//     sealed for shipping, a fax feeding a page, a phone buzzing, a clock ticking past midnight, days crossed
//     off a calendar, boxes and arrows drawn on a whiteboard, a recorder in a voice booth, a drive copying a
//     build, a moving box and keys);
//   - silhouette scenes: faceless flat figures doing what the sentence says people did (a meeting, a pitch,
//     a team crunching, a handshake, someone walking out, a midnight queue, a team cheering).
// This module is the pure half: from a sentence, its shot-list moment and its chapter it says which scene
// fits, how sure it is and why, or declines. Plain keyword and phrase rules, so the integration step can rank
// the candidate against the other filler visuals and a test can pin every decision. A scene is only offered
// when the words say it: a sentence that states a figure goes to a graphic card, a moment in the game stays
// on the game's footage, and a sensitive subject (the rule of src/assets/illustrate.ts) is never drawn. A
// named person is never drawn either: silhouettes are anonymous figures, and the name tags stay elsewhere.
// No React here, so the pipeline can import it.

/** The shot-list moment as the fill pass knows it (src/assets/fill.ts FillMoment). */
export interface SceneMoment {
  show: string;
  broll?: string;
  person?: string;
  graphic?: { kind: string };
}

/** What the chooser may read about the chapter: its game and year, nothing else. */
export interface SceneChapter {
  game: string;
  year?: number;
}

export const OBJECT_SCENES = [
  "desk",
  "discs",
  "fax",
  "phone",
  "clock",
  "calendar",
  "whiteboard",
  "booth",
  "drive",
  "moving",
] as const;
export type ObjectScene = (typeof OBJECT_SCENES)[number];

export const SILHOUETTE_SCENES = [
  "meeting",
  "pitch",
  "crunch",
  "handshake",
  "walkout",
  "queue",
  "cheer",
] as const;
export type SilhouetteScene = (typeof SILHOUETTE_SCENES)[number];

export type SceneArea = "objects" | "silhouettes";

/** The look of the hardware in a scene: CRT and beige plastic to 2005, flat panels after. */
export type Era = "crt" | "flat";

/** One drawn scene offered for a sentence. */
export interface SceneCandidate {
  area: SceneArea;
  scene: ObjectScene | SilhouetteScene;
  /** The registry key (src/render/components/objects/index.ts), e.g. "Objects/fax". */
  style: string;
  /** 0 to 1: how plainly the words ask for this scene. */
  confidence: number;
  /** In plain English, for the log and the integration's ranking. */
  reason: string;
  /** The year the scene is set in: the sentence's own year, else the chapter's. */
  year?: number;
  era: Era;
  /** A month the sentence names, for the calendar's header (the only word a scene may take from a line). */
  month?: string;
  /** Always tagged on screen, as the graphic cards are. */
  tag: "ILLUSTRATION";
}

export type SceneDecision =
  | { candidate: SceneCandidate; declined?: undefined }
  | { candidate?: undefined; declined: string };

// ---------------------------------------------------------------- years and eras

/** The year a sentence is set in: a year it names (1980-2049), else the chapter's. */
export function sceneYear(
  sentence: string,
  chapter: SceneChapter,
): number | undefined {
  const m = sentence.match(/\b(19[89]\d|20[0-4]\d)\b/);
  return m ? Number(m[0]) : chapter.year;
}

/** CRT and beige to 2005, flat panels from 2006; no year known: the modern look. */
export function eraOf(year: number | undefined): Era {
  return year !== undefined && year <= 2005 ? "crt" : "flat";
}

/** The phone on the desk: a pager to 1999, a flip phone to 2007, a smartphone after. */
export function phoneOf(year: number | undefined): "pager" | "flip" | "smart" {
  const y = year ?? 2024;
  return y <= 1999 ? "pager" : y <= 2007 ? "flip" : "smart";
}

/** Where a build lives: floppy disks to 1998, a spindle of burned discs to 2005, a hard drive after. */
export function driveOf(
  year: number | undefined,
): "floppy" | "spindle" | "hdd" {
  const y = year ?? 2024;
  return y <= 1998 ? "floppy" : y <= 2005 ? "spindle" : "hdd";
}

/** The booth's recorder: a tape deck with reels to 2003, a screen with a waveform after. */
export function recorderOf(year: number | undefined): "tape" | "screen" {
  return (year ?? 2024) <= 2003 ? "tape" : "screen";
}

/** What ships: cartridges to 1995, jewel cases to 2005, keep cases after. */
export function boxOf(
  year: number | undefined,
): "cartridge" | "jewel" | "keep" {
  const y = year ?? 2024;
  return y <= 1995 ? "cartridge" : y <= 2005 ? "jewel" : "keep";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A month the sentence names, capitalised as a month ("May" only before a year or after "in"/"by", since
 * "may" is also a verb).
 */
export function monthOf(sentence: string): string | undefined {
  for (const m of MONTHS) {
    if (m === "May") {
      if (
        /\b(in|by|of|until|till|from|since|early|late|mid-?)\s+May\b|\bMay\s+(19|20)\d\d\b/.test(
          sentence,
        )
      )
        return m;
      continue;
    }
    if (new RegExp(`\\b${m}\\b`).test(sentence)) return m;
  }
  return undefined;
}

// ---------------------------------------------------------------- the rules

// The sensitive-line rule of src/assets/illustrate.ts (controversy, violence, crime, race, a lawsuit, a
// tragedy): those lines take a neutral real shot or nothing, never a drawing of the event. Kept in step by
// hand; a test pins the cases that matter here.
const SENSITIVE =
  /\b(lawsuit|lawsuits|sued|suing|court|courtroom|trial|judge|verdict|settlement|murder\w*|kill\w*|shoot\w*|shot|stabb\w*|violen\w*|assault\w*|rape|racis\w*|racial|race riot|african americans?|discriminat\w*|protest\w*|objection|controvers\w*|scandal\w*|tragedy|tragic|died|death|deaths|dead|suicide|overdos\w*|drugs?|cocaine|heroin|crime|crimes|criminal\w*|gang\w*|gun|guns|weapon\w*|hot coffee|sex\w*|strip club|prostitut\w*|porn\w*|harass\w*|abuse\w*|terror\w*|bomb\w*|war|hostage|arrest\w*|police|prison|jail|attacks?|9\/11|september 11|gore|gory)\b/i;

// A figure, a share, a score, a price or a headcount: a line for a graphic card, not a drawing.
const STATISTICAL =
  /(\d[\d,.]*\s*(million|billion|thousand|percent|per cent|copies|units|players|subscribers|dollars|pounds|euros)|[$£€]\s?\d|\d+(\.\d+)?\s*(out of|\/)\s*10|\b\d{1,3}(,\d{3})+\b|\b\d+\s*%|\b\d+(?:\s+(?:to|or)\s+\d+)?(?:\s+[A-Z]\w+){0,3}\s+(people|person|staff|employees|developers|testers|members|workers)\b|\b(grew|rose|fell|went)\s+(to|from)\s+\d|\bnumbered\s+\d|\b(million|billion)\b)/i;

// A shot note that asks for the game itself: its world, its people, its screens. Those have the game's own
// footage and art; a drawing of an office over them would be a non sequitur.
const IN_GAME =
  /\b(gameplay|in-game|ingame|cutscene|mission|missions|character|characters|protagonist|niko|tommy|cj|claude|the map|maps?|skyline|billboards?|radio station|loading screen|menus?|error message|vice city streets|liberty city|los santos|san andreas desert|godzilla|monster|logo|box art|cover art|review page|trailer)\b/i;

type Rule = {
  scene: ObjectScene | SilhouetteScene;
  /** Phrases in the sentence that plainly ask for the scene. */
  strong?: RegExp;
  /** Phrases in the sentence that fit it less surely. */
  weak?: RegExp;
  /** Phrases in the writer's shot note ("show") or stock note ("broll") that describe it. */
  note?: RegExp;
  /** The scene is wrong for the line when this matches the sentence (a cheer on a line of bad news). */
  not?: RegExp;
  /** The scene cannot be drawn honestly in this year (a fax on a 2015 desk). */
  years?: { to?: number; from?: number };
  /** What the scene shows, for the reason. */
  what: string;
};

const NEGATED =
  /\b(n't|not|never|no|nobody|nothing|neither|nor|without|failed|split|mixed)\b|n't\b/i;

const OBJECT_RULES: Rule[] = [
  {
    scene: "booth",
    strong:
      /\b(voice (work|actors?|acting|cast|recording|recordings|lines|sessions?|talent|director)|voice-?overs?|recording (booth|studio|sessions?)|recorded (the )?(lines|dialogue|voices?)|lines of dialogue|dialogue (was )?recorded|voiced by|microphones?|sound booth)\b/i,
    weak: /\b(dialogue|voiced|narrat\w+|soundtrack|sound effects?)\b/i,
    note: /\b(recording booth|voice actors?|voice recording|microphone|vocal booth|sound booth)\b/i,
    what: "a recorder and microphone in a voice booth",
  },
  {
    scene: "discs",
    strong:
      /\b(went gold|gone gold|going gold|shipped (to stores|to shops|out)|shipping (the|copies|discs)|discs? (went|were sent) to manufactur\w+|manufactur(ing|ed|er)|pressing plant|pressed (the )?(discs|copies)|duplicat\w+ (discs|copies)|sealed (the )?boxes|boxes (were )?sealed)\b/i,
    weak: /\b(shipped|ships|shipping|boxed copies|retail copies|copies (went|were sent) out)\b/i,
    note: /\b(boxes being (packed|sealed)|shipping boxes|discs? (being )?(packed|pressed)|manufacturing|packing (boxes|copies)|pressing discs)\b/i,
    what: "boxed games packed into a carton and sealed for shipping",
  },
  {
    scene: "fax",
    strong:
      /\b(fax(ed|es|ing)?|sent (a|an|the) (letter|memo|contract|offer|proposal)|signed (a|the) (deal|contract|letter)|letter of intent|a letter (to|from)|wrote (a|an) (letter|memo))\b/i,
    weak: /\b(contract|paperwork|memo|proposal|terms|offer letter)\b/i,
    note: /\b(fax machine|fax|letter|contract|memo|documents? being signed)\b/i,
    years: { to: 2009 },
    what: "a fax machine feeding a page",
  },
  {
    scene: "phone",
    strong:
      /\b(phoned|phone calls?|a call from|got (a|the) call|took (a|the|our|their) calls?|take (our|their|the|a) calls?|calls? (came|kept coming|poured)|rang (him|her|them|the)|on the phone|pager|paged|voicemail|cold[- ]call\w*|called (him|her|them|back) (up|back|to|about|in))\b/i,
    weak: /\b(the phone|a phone|phones (rang|were ringing)|ringing)\b/i,
    note: /\b(phone (call|ringing|buzzing)|ringing phone|pager|mobile phone|flip phone|on the phone)\b/i,
    what: "a phone buzzing on a desk",
  },
  {
    scene: "clock",
    strong:
      /\b(late (nights?|into the night)|all[- ]nighters?|midnight|overnight|through the night|into the (small hours|night)|round the clock|around the clock|night shifts?|worked (late|nights|through the night|weekends))\b/i,
    weak: /\b(crunch\w*|long hours|weekends?|(proper |real )?breaks?|evenings?|no sleep|sleepless)\b/i,
    note: /\b(clock|late at night|office at night|night shift|midnight|working late|tired (developers?|programmers?|staff))\b/i,
    what: "a wall clock ticking past midnight over a desk lamp",
  },
  {
    scene: "calendar",
    strong:
      /\b(deadlines?|schedules?|behind schedule|ahead of schedule|release date|ship date|launch date|slipped|delay(ed|s)?|postpone\w*|pushed back|crossed off|counting down|countdown)\b/i,
    weak: /\b(the wait|waited|waiting|weeks? (went|passed|later)|(first|second|third) week|months? (later|passed|went)|days? (later|passed))\b/i,
    note: /\b(calendar|missed deadlines?|days crossed|countdown)\b/i,
    what: "a calendar on a cork wall with days crossed off",
  },
  {
    scene: "whiteboard",
    strong:
      /\b(whiteboards?|brainstorm\w*|mapped (it |the \w+ )?out|flowcharts?|design documents?|planning (meetings?|sessions?)|drew up (a|the) plan|sketched out|the plan was)\b/i,
    weak: /\b(plann(ed|ing)|the plan|decisions?|decided|designed|structure|outline\w*|blueprint|idea|ideas)\b/i,
    note: /\b(whiteboard|planning|brainstorm\w*|flowchart|design document)\b/i,
    what: "boxes and arrows being drawn on a whiteboard",
  },
  {
    scene: "drive",
    strong:
      /\b(floppy|floppies|floppy disks?|hard drives?|source code|(the|a|an|unfinished|early|internal|test|debug|nightly|alpha|beta|preview|demo|final|latest|playable|working) builds?|backups?|master (copy|disc)|gold master|burned (a|the) discs?|code base|codebase)\b/i,
    weak: /\b(the code|copied|copying|files|the data)\b/i,
    note: /\b(floppy|hard drive|source code|build|backup|code on screen)\b/i,
    what: "a drive copying the build",
  },
  {
    scene: "moving",
    strong:
      /\b((moved|moving) (in)?to (a |an |the |new |bigger |larger |smaller )*(office|offices|building|premises|studio|studios|headquarters)|(moved|moving) (offices|studios|premises|out of (the|its|their) (office|offices|studio|building))|(studio|team|company) moved|relocat\w+|new (office|offices|building|premises|headquarters)|packed up|cleared (out )?(his|her|their) desks?)\b/i,
    weak: /\b(quit|resigned|left the (company|studio|team)|departures?|departed|laid off|layoffs?|walked out|stepped down)\b/i,
    note: /\b(moving (boxes?|offices?)|empty desk|packed boxes?|cardboard box|departing employee|clearing (a|his|her) desk)\b/i,
    what: "a moving box and keys on an emptied desk",
  },
  {
    scene: "desk",
    strong:
      /\b(coded|coding|programm(ed|ing|er|ers)|engine|debug\w*|prototypes?|dev kits?|development kits?|wrote the (code|engine|tools))\b/i,
    weak: /\b(the code|technical|tricks?|tools|tech|making it work|got it (working|running)|worked inside it)\b/i,
    note: /\b(programmers?|coding|(writing|typing|debugging) code|code on (a |the )?screen|debugg\w*|developers? (working|at (their )?desks|solving|at work|at computers)|computer screens?|game studio office|at (their )?desks)\b/i,
    what: "a studio desk with a code editor scrolling on the monitor beside a Pulse dev kit",
  },
];

const SILHOUETTE_RULES: Rule[] = [
  {
    scene: "pitch",
    strong:
      /\b(pitch(ed|es|ing)?|presented (it|the game|the idea|a demo)|presentation|demo(ed|nstrated)? (it )?(to|for)|showed (it|the game|a demo) to|offered (the game|it) to|talk(ed)? (them|him|her|the \w+) into|convinc\w+|persuad\w+|sold (them|him|her) on)\b/i,
    weak: /\b(publishers?|investors?|executives?|the board|managers?|bosses)\b/i,
    note: /\b(pitch(ing)?|presenting|presentation|panel|executives?|managers in a meeting)\b/i,
    what: "a pitch to a seated panel",
  },
  {
    scene: "meeting",
    strong:
      /\b(meetings?|met (with|to)|sat down (with|together)|round the table|around the table|boardroom|discuss(ed|ion|ions)|debated|argued (over|about)|huddled)\b/i,
    weak: /\b(the team agreed|agreed|talks|talked|conversations?|gathered)\b/i,
    note: /\b(meeting|boardroom|around a table|round a table|discussion|team gathered)\b/i,
    what: "a meeting round a table",
  },
  {
    scene: "crunch",
    strong:
      /\b(crunch\w*|late nights?|long hours|overtime|all[- ]nighters?|worked (late|nights|weekends|through)|(no|without a) (proper |real )?breaks?|hadn't had a (proper |real )?break|burn(ed|t)?[- ]?out|exhaust\w*)\b/i,
    weak: /\b(tired|the cost|weekends?|pressure|pace)\b/i,
    note: /\b(tired (developers?|programmers?|staff|team)|developers? with no break|crunch|office at night|working late|night shift)\b/i,
    what: "a team at their desks late, the lights going off one by one",
  },
  {
    scene: "handshake",
    strong:
      /\b(deal|deals|agreement|acquir\w+|acquisition|bought (the )?(studio|company|rights)|purchas\w+|merg(ed|er)|partner(ed|ship)|signed (with|a|the|on)|ownership (changed|passed)|took over|sold (the studio|the company|to))\b/i,
    weak: /\b(ownership|owner|owners|parent company|contract|investment|invested)\b/i,
    note: /\b(handshake|shaking hands|ownership changing hands|signing|deal)\b/i,
    what: "a handshake",
  },
  {
    scene: "walkout",
    strong:
      /\b(quit|resigned|left (the )?(company|studio|team|rockstar)|walked out|stepped down|departed|departure|was fired|were fired|laid off|let go)\b/i,
    weak: /\b(left|leaving|exit\w*|goodbye|farewell)\b/i,
    note: /\b(walking out|leaving the (office|studio)|departing|empty desk|door closing)\b/i,
    what: "someone walking out of a door",
  },
  {
    scene: "queue",
    strong:
      /\b(queue[ds]?|queueing|queuing|lined up|lines? (outside|round|around) the|midnight (launch|opening|release|sales?)|camped (out|outside)|crowds?|launch (night|day) (crowds?|queues?)|stores? opened (at midnight|early))\b/i,
    weak: /\b(demand|fans waited|the wait|waiting|sold out|shelves)\b/i,
    note: /\b(queue\w*|crowds?|lined up|fans waiting|midnight launch|people queueing)\b/i,
    what: "a crowd queueing at a shop for a midnight launch",
  },
  {
    scene: "cheer",
    strong:
      /\b(celebrat\w+|cheer(ed|ing|s)?|champagne|launch party|wrap party|applau\w+|went gold|gone gold)\b/i,
    weak: /\b(finished|finally (done|finished|out|shipped)|it worked|relief|proud|triumph\w*)\b/i,
    note: /\b(celebrat\w+|cheering|team cheering|launch party)\b/i,
    not: NEGATED,
    what: "a team cheering at a launch",
  },
];

// A scene needs the sentence's own words (STRONG) or the writer's shot note (NOTE) to ask for it. A weaker
// word in the sentence and the stock note only agree with one of those: the stock note alone is often the
// writer's default ("office at night") and asks for nothing in particular.
const STRONG = 0.75;
const NOTE = 0.6;
/** Each extra source that agrees (a weaker word in the sentence, the shot note, the stock note) adds this. */
const AGREE = 0.12;
const CAP = 0.92;
/** Two scenes this close are a toss-up: the winner's confidence drops by this much. */
const TIE = 0.05;

function score(
  rule: Rule,
  sentence: string,
  m: SceneMoment,
  year: number | undefined,
): { confidence: number; why: string[] } | undefined {
  if (rule.not?.test(sentence)) return undefined;
  if (rule.years && year !== undefined) {
    if (rule.years.to !== undefined && year > rule.years.to) return undefined;
    if (rule.years.from !== undefined && year < rule.years.from)
      return undefined;
  }
  const s = rule.strong?.exec(sentence);
  const w = s ? null : rule.weak?.exec(sentence);
  const n = rule.note?.exec(m.show ?? "");
  const b = m.broll ? rule.note?.exec(m.broll) : null;
  if (!s && !n) return undefined;
  const why: string[] = [];
  if (s) why.push(`the sentence says "${s[0]}"`);
  if (n) why.push(`the shot note asks for "${n[0]}"`);
  if (w) why.push(`the sentence says "${w[0]}"`);
  if (b) why.push(`the stock note asks for "${b[0]}"`);
  const confidence = Math.min(
    CAP,
    (s ? STRONG : NOTE) + AGREE * (why.length - 1),
  );
  return { confidence, why };
}

// Game titles whose words would trip the sensitive rule ("Red Dead"), and photography's "shooting".
const NEUTRAL =
  /\b(red dead( redemption)?( \d| ii)?|shoot(ing|s)? (photos?|photographs?|pictures|video|footage|reference))\b/gi;

// A line that reports what someone said or wrote is about the words, not a scene: a quote card or the
// footage carries it.
const REPORTED =
  /["“”]|\b(called (it|the|them|him|her|this|that)|said that|says that|wrote that|told \w+ that|described (it|the|them)|according to)\b/i;

function choose(
  area: SceneArea,
  rules: Rule[],
  sentence: string,
  m: SceneMoment,
  chapter: SceneChapter,
): SceneDecision {
  const text = sentence.trim();
  if (!text) return { declined: "no sentence" };
  if (m.graphic && m.graphic.kind !== "none")
    return { declined: `it carries a ${m.graphic.kind} graphic` };
  const plain = (t: string | undefined) => (t ?? "").replace(NEUTRAL, " ");
  if (
    SENSITIVE.test(plain(text)) ||
    SENSITIVE.test(plain(m.show)) ||
    SENSITIVE.test(plain(m.broll))
  )
    return { declined: "a sensitive subject is never drawn" };
  if (STATISTICAL.test(text))
    return { declined: "it states a figure, which a graphic card shows" };
  if (REPORTED.test(text))
    return {
      declined: "it reports what someone said, which a quote card shows",
    };
  if (IN_GAME.test(m.show ?? ""))
    return { declined: "the shot note asks for the game itself" };
  const year = sceneYear(text, chapter);
  const scored = rules
    .map((r) => ({ r, s: score(r, text, m, year) }))
    .filter((x): x is { r: Rule; s: NonNullable<ReturnType<typeof score>> } =>
      Boolean(x.s),
    )
    .sort((a, b) => b.s.confidence - a.s.confidence);
  const best = scored[0];
  if (!best)
    return {
      declined: `nothing in the words asks for ${area === "objects" ? "a period object" : "people"}`,
    };
  let confidence = best.s.confidence;
  const why = [...best.s.why];
  const next = scored[1];
  if (next && best.s.confidence - next.s.confidence < TIE) {
    confidence -= TIE;
    why.push(`a close call with ${next.r.what}`);
  }
  if (area === "silhouettes" && m.person?.trim())
    why.push("the figures stay anonymous; the name tag rules apply elsewhere");
  const scene = best.r.scene;
  return {
    candidate: {
      area,
      scene,
      style: `${area === "objects" ? "Objects" : "Silhouettes"}/${scene}`,
      confidence: Math.round(confidence * 100) / 100,
      reason: `${best.r.what}: ${why.join("; ")}`,
      year,
      era: eraOf(year),
      month: scene === "calendar" ? monthOf(text) : undefined,
      tag: "ILLUSTRATION",
    },
  };
}

/** The period-object scene for a sentence, or why there is none. */
export function objectsDecision(
  sentence: string,
  moment: SceneMoment,
  chapter: SceneChapter,
): SceneDecision {
  return choose("objects", OBJECT_RULES, sentence, moment, chapter);
}

/** The silhouette scene for a sentence, or why there is none. */
export function silhouetteDecision(
  sentence: string,
  moment: SceneMoment,
  chapter: SceneChapter,
): SceneDecision {
  return choose("silhouettes", SILHOUETTE_RULES, sentence, moment, chapter);
}

/** A period-object scene for a bare sentence, with a confidence and a reason; undefined when none fits. */
export function objectsFor(
  sentence: string,
  moment: SceneMoment,
  chapter: SceneChapter,
): SceneCandidate | undefined {
  return objectsDecision(sentence, moment, chapter).candidate;
}

/** A silhouette scene for a bare sentence, with a confidence and a reason; undefined when none fits. */
export function silhouetteFor(
  sentence: string,
  moment: SceneMoment,
  chapter: SceneChapter,
): SceneCandidate | undefined {
  return silhouetteDecision(sentence, moment, chapter).candidate;
}
