// Every pattern the weekly compiler reads a stream or a script with, in one file so they can be read, tuned and tested
// together. Each matches the owner's own words as Whisper writes them (lower or mixed case, little punctuation).

/** A reaction: surprise, hype or disbelief out loud. */
export const REACTION =
  /\b(o+h+ my (?:god|gosh|days)|no+ ?wa+y|wha+t+(?: the)?|holy|let'?s go+|yo+|bro+|dude|insane|crazy|unbelievable|are you (?:kidding|serious)|wow+|whoa+|oh no+|nah+|get in|come on+|sheesh|look at (?:that|this))\b/i;

/** Laughter, as Whisper writes it or as the owner says it. */
export const LAUGH =
  /\b(ha(?:ha)+h?|he(?:he)+|lol|lmao+|rofl|i'?m (?:dying|crying)|that'?s (?:hilarious|so funny))\b|[([](?:laugh(?:s|ing|ter)?|chuckles?)[)\]]/i;

/** The owner trying something on purpose: a test. */
export const TEST_SAY =
  /\b(let'?s (?:see|try|test|find out)|can (?:you|i|we)\b|(?:does|will|would) (?:it|this|that)\b|i(?:'m| am) (?:going to|gonna) (?:try|test|see)|test(?:ing)?|experiment|how (?:far|long|fast|high|many)|is it possible|what happens if)\b/i;

/** A claim checked: a myth, rumour or something people said. */
export const MYTH_SAY =
  /\b(myth|rumou?r|apparently|people (?:say|said)|they said|is it true|confirmed|debunk(?:ed)?|fake|actually works|doesn'?t work|busted|true or (?:false|not)|previews? said)\b/i;

/** A discovery: something hidden, rare or new. */
export const HIDDEN_SAY =
  /\b(secret|hidden|easter egg|never (?:seen|noticed|knew)|didn'?t know|found|discover(?:ed)?|check (?:this|that) out|rare|detail|look at (?:the|this) detail|interior|you can go (?:in|inside))\b/i;

/** Strong language: a moment that leans on it is ranked down, and the cut never opens on it. */
export const SWEAR =
  /\b(f+u+c+k\w*|sh[i1]t\w*|bitch\w*|c+u+n+t\w*|motherf\w*|dick\w*|bastard\w*|wank\w*|twat\w*)\b/i;

/** Chat hype, as in the live detector. */
export const CHAT_HYPE =
  /\b(o+m+g+|wtf|lol+|lmao+|kekw|lul|pog+(gers|champ)?|no+ ?way|holy|insane|clip(ped)?|let'?s go+|w+ ?(play|moment)?|gg|bro+|what+)\b|[!?]{3,}/i;

/** A narration line that points at another video or asks for something: never in the links. */
export const PLUG =
  /\b(subscribe|smash (?:that|the) like|hit the bell|link in the description|check out our|our (?:full|other) (?:video|documentary)|don'?t forget to)\b/i;

/** Em and en dashes: never on the channel. */
export const DASHES = /[–—]/;

/** Advertiser-unfriendly words for titles and chapter names. */
export const ADVERTISER =
  /\b(death|dead|kill(?:s|ed|ing)?|war|attack|crisis|horror|scary|murder|gore|massacre|shoot(?:ing|out)?s?)\b/i;

/** American spellings the channel writes the British way. */
export const AMERICAN: Array<[RegExp, string]> = [
  [/\bcolor/i, "colour"],
  [/\bfavorite/i, "favourite"],
  [/\bcenter\b/i, "centre"],
  [/\bneighbor/i, "neighbour"],
  [/\b(real|organ|recogn|apolog)iz/i, "-ise"],
  [/\bdefense\b/i, "defence"],
  [/\btheater\b/i, "theatre"],
  [/\bhumor\b/i, "humour"],
];

/** The story words a compilation never carries during the spoiler window (with gtadaily's DAILY_PLOT_WORDS). */
export const STORY_WORDS =
  /\b(cutscenes?|endings?|twist|finale|final mission|boss fight|betray(?:s|ed|al)?|dies|died|death of)\b/i;

/** A word-for-word title lead to take off a writer's chapter name ("Chapter 2: ..."). */
export const CHAPTER_LEAD =
  /^\s*(?:part|chapter|section)\s*(?:\d+|[ivx]+)\s*[:.\-]?\s*/i;

/**
 * Whisper's well-known inventions over music or silence ("you", "Thanks for watching!", a phrase looped): such a line
 * is not the owner speaking and is never read as a reaction.
 */
export const HALLUCINATION =
  /^\s*(?:[!.?,\s]*|(?:you[.!?,\s]*)+|thanks? (?:you )?for watching[.!]*|please subscribe[.!]*|(?:okay[.,!\s]*)+|bye[.!]*|music|\[(?:music|silence|blank_audio)\])\s*$/i;

/** The game announcing something on screen: a stunt done, a collectable, a challenge, a pass or a fail. */
export const GAME_EVENT =
  /\b(under the bridge|knife flight|stunt jump|unique stunt|mission passed|passed|completed?|new record|collected|wasted|busted|challenge|gold medal|unlocked|achievement|trophy|\d+\s*\/\s*\d+)\b/i;

/** Writing that means the picture is a menu, a map, a save or a loading screen, not play. */
export const MENU_TEXT =
  /\b(save game|load game|brief|settings|gallery|online|alert|reconnect the controller|press any button|loading|legend|waypoint|quit game|pause menu|stats|social club)\b/i;
