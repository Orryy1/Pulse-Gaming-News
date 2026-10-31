// Gameplay uploads that must never be shown as footage of a game, refused by title and channel before anything
// is downloaded. The Vice City documentary's GTA VI chapter (30 Oct 2026) carried eight clips of a GTA V kids'
// mod (Spider-Man and cartoon zombies on neon ramps) uploaded as "GTA 6 gameplay"; the frame review caught them
// only after the render. The licensed-gameplay search (src/assets/gameplay.ts) and the footage-first gather
// (src/assets/footagefirst.ts) both ask here first. Kept apart from both so each can import it.

/** Words in a title that mean the video is not clean gameplay of the game as released, with the reason. */
const JUNK_TITLE: Array<[RegExp, string]> = [
  [
    /\bmods?\b|\bmodded\b|\bmodding\b|\bmodpack\b|\breshade\b|\benb\b|\btrainer\b|\bcheats?\b|\bchaos\b|\bscript hook\b/i,
    "mod",
  ],
  [
    /spider-?man|\bhulk\b|\bsonic\b|\bminions?\b|\bsuperhero(es)?\b|\bbatman\b|\bsuperman\b|\bshrek\b|\bpeppa\b|\bmcqueen\b|\bcartoon\b|\btoys?\b|\bkids?\b|\bramps?\b|\bfunny\b|\bchallenge\b|\bparkour\b|\bvs\.?(?=\s|$)|\bversus\b|\bprank\b|\bshark\b|\bfrog\b|\bdinosaurs?\b|\bnoob\b/i,
    "kids or stunt video",
  ],
  [
    /\breacts?\b|\breaction\b|\bfacecam\b|\bwebcam\b|\blive ?stream\b|\bstream highlights\b|\bpodcast\b|(?<!\bno[ -])\bcommentary\b|\bfirst play\b|\bblind\b|\bfirst time\b|\bfor \d+ hours\b/i,
    "reaction or facecam",
  ],
  // A screen filmed with a phone or camera, when the title says so; most do not (the frame check catches those).
  [
    /\b(filmed|recorded|shot) (on|with) (my |a )?(phone|iphone|camera|camcorder)\b|\boff[- ]screen\b|\bcam ?corder\b|\bfilming (my|the) (tv|screen|monitor)\b/i,
    "filmed off a screen",
  ],
  // 31 Oct 2026 proof: phone ports carry touch buttons over the picture; wheel videos a steering-wheel cam.
  [
    /\b(android|ios|iphone|ipad|mobile|apk|htc|samsung|tablet|netflix)\b/i,
    "mobile port (touch controls on screen)",
  ],
  [
    /\b(steering wheel|g29|g920|thrustmaster|logitech|simulator|lspdfr|roleplay)\b/i,
    "simulator, wheel cam or roleplay mod",
  ],
  [
    /\bremaster(ed)?\b|\bdefinitive\b|\bremake\b|\bunreal engine\b|\bue ?[45]\b|\bray ?tracing\b|\brtx\b|\bnext ?gen\b|\bfan[- ]?made\b|\bconcept\b|\bconceptual\b|\brealistic\b|\bgraphics\b|\b8k\b|\breimagined\b|\breviced\b|\bhardlined\b|\bbuild\b|\bbeta\b|\bprototype\b|\bleak(ed|s)?\b/i,
    "remaster, remake or fan build",
  ],
  [
    /\bsins?\b|everything wrong|\bwhy (does|did|is|was)\b|\bwhat happens if\b|\bwhat if\b|\bhorror\b|\bcreepy(pasta)?\b|\bmyths?\b|\bsecrets?\b|\beaster eggs?\b|\bexplorations?\b|\bnostalgi(a|c)\b|\bessay\b|\bdocumentary\b|\bhistory of\b|\bkill ?counts?\b|\bi (finally|tried|played|beat|spent|robbed|destroyed|ruined)\b|\bpt\/eng\b|\blive\b/i,
    "video essay, stream or counter overlay",
  ],
  [
    /\btrailer\b|\bteaser\b|\breview\b|\bexplained\b|\banalysis\b|\bnews\b|\btop \d+\b|\branking\b|\btier list\b|\bmeme\b|\bcompilation\b|\bmontage\b|\bedit\b|\bshorts?\b|#shorts|\bspeedrun\b|\bglitch(es)?\b|\btutorial\b|\bhow to\b|\btrophy\b|\bachievement\b|\bost\b|\bsoundtrack\b|\bmusic\b|\basmr\b|\b100 days\b/i,
    "not plain gameplay",
  ],
];

/** Channels whose uploads are kids' or mod content whatever the title says. */
const JUNK_CHANNEL =
  /\b(kids?|toys?|cartoon|superhero|spider|funny|mods?|gta ?6 ?domination)\b/i;

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Why a video's title or channel marks it as junk for footage of `game`: a mod, kids' or stunt content, a
 * reaction or facecam, a remaster or fan build (another look than the game), or not plain gameplay at all.
 * A word the game's own title contains does not count ("... Definitive Edition" for that edition).
 */
export function junkTitleReason(
  title: string,
  channel: string,
  game: string,
): string | undefined {
  const own = norm(game);
  for (const [re, why] of JUNK_TITLE) {
    const m = title.match(re);
    if (m && !own.includes(norm(m[0]))) return why;
  }
  // "GTA Vice City DE": the Definitive Edition, as its uploaders shorten it.
  if (/\bDE\b/.test(title) && !/definitive/i.test(game))
    return "remaster, remake or fan build";
  if (JUNK_CHANNEL.test(channel)) return "kids or mod channel";
  return undefined;
}

/** A game from this calendar year on: its uploaded "gameplay" can only be fake or someone else's trailer. */
export function notOutYet(year: number | undefined, now = new Date()): boolean {
  return !!year && year >= now.getFullYear();
}
