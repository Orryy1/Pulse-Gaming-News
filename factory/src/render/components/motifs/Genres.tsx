// Motifs: Genres. Each entry of MOTIFS is one homage look (./types.ts): the fallback for any game of a
// genre when no series or console motif is more specific. Every look is built from scratch (layout,
// colour, type and motion), never a real logo, font file or interface. The parts live in ./genres.
import type { Motif, MotifGame } from "./types.ts";
import { hits } from "./genres/kit.tsx";
import { FIGHTING_STYLES, FightingCard } from "./genres/Fighting.tsx";
import { RPG_STYLES, RpgCard } from "./genres/Rpg.tsx";
import { RACING_STYLES, RacingCard } from "./genres/Racing.tsx";
import { SPORTS_STYLES, SportsCard } from "./genres/Sports.tsx";
import { HORROR_STYLES, HorrorCard } from "./genres/Horror.tsx";
import { BLOCKY_STYLES, BlockyCard } from "./genres/Blocky.tsx";
import { PIXEL_STYLES, PixelCard } from "./genres/Pixel.tsx";
import { ARENA_STYLES, ArenaCard } from "./genres/Arena.tsx";

const FIGHTING = [
  /\bstreet fighter\b/i,
  /\btekken\b/i,
  /\bmortal kombat\b/i,
  /\bsoul ?calibur\b/i,
  /\bsuper smash bros\b/i,
  /\bsmash bros\b/i,
  /\bguilty gear\b/i,
  /\bking of fighters\b/i,
  /\bdead or alive\b/i,
  /\bvirtua fighter\b/i,
  /\bfighting games?\b/i,
];

const RPG = [
  /\bfinal fantasy\b/i,
  /\bdragon quest\b/i,
  /\bpersona\s*(?:[1-5]\b|q\b|q2\b)/i,
  /\bshin megami tensei\b/i,
  /^persona$/i,
  /\bpokemon\b/i,
  /\bkingdom hearts\b/i,
  /\bchrono (?:trigger|cross)\b/i,
  /\bxenoblade\b/i,
  /\btales of (?:phantasia|destiny|eternia|symphonia|legendia|the abyss|innocence|vesperia|hearts|graces|xillia|zestiria|berseria|arise|the world|the rays|crestoria)\b/i,
  /\bfire emblem\b/i,
  /\boctopath\b/i,
  /\bj-?rpgs?\b/i,
];

const RACING = [
  /\bgran turismo\b/i,
  /\bforza\b/i,
  /\bneed for speed\b/i,
  /\bmario kart\b/i,
  /^burnout$/i,
  /\bburnout (?:\d|paradise|revenge|dominator|legends|takedown)\b/i,
  /\bF1\b/,
  /\bdirt (?:rally|showdown|\d)\b/i,
  /\bcolin mcrae\b/i,
  /\bridge racer\b/i,
  /\bcrazy taxi\b/i,
  /\bwipeout\b/i,
  /\btrackmania\b/i,
  /\bracing games?\b/i,
];

const SPORTS = [
  /\bfifa\b/i,
  /\bea sports fc\b/i,
  /\bea fc\b/i,
  /\bmadden\b/i,
  /\bnba 2k\d*\b/i,
  /\bnba live\b/i,
  /\bnhl\s*'?\d{2,4}\b/i,
  /\bmlb\b.*\bthe show\b/i,
  /\bpro evolution soccer\b/i,
  /\bpes\s*\d{2,4}\b/i,
  /\befootball\b/i,
  /\btony hawk/i,
  /\brocket league\b/i,
  /\bsports games?\b/i,
];

const HORROR = [
  /\bresident evil\b/i,
  /\bbiohazard\b/i,
  /\bsilent hill\b/i,
  /\bdead space\b/i,
  /\boutlast\b/i,
  /\balan wake\b/i,
  /\bthe last of us\b/i,
  /\bamnesia\b/i,
  /\bfive nights at freddy/i,
  /\buntil dawn\b/i,
  /\bsurvival horror\b/i,
  /\bhorror games?\b/i,
];

const BLOCKY = [
  /\bminecraft\b/i,
  /\broblox\b/i,
  /\bterraria\b/i,
  /\blego\b/i,
  /\bvoxel\b/i,
];

/** 8 and 16-bit series: these match the pixel look only for their early games (1996 or before). */
const PIXEL_ERA = [
  /\bmario\b/i,
  /\bsonic\b/i,
  /\bmega ?man\b/i,
  /\bcastlevania\b/i,
  /\bmetroid\b/i,
  /\bzelda\b/i,
  /\bkirby\b/i,
  /\bdonkey kong\b/i,
];
/** Modern games drawn in pixel art: always the pixel look. */
const PIXEL_ALWAYS = [
  /\bceleste\b/i,
  /\bshovel knight\b/i,
  /\bretro\b(?!\s+studios?\b)/i,
  /\bpixel(?:ated| art)?\b/i,
  /\b(?:8|16)-bit\b/i,
];

const ARENA = [
  /\bdoom\b/i,
  /\bquake\b/i,
  /\bwolfenstein\b/i,
  /\bunreal tournament\b/i,
  /\bhalf-life\b/i,
  /\bhalf life\b/i,
  /\bcounter-?strike\b/i,
  /\bduke nukem\b/i,
  /\b(?:boomer|arena) shooters?\b/i,
];

const early = (g: MotifGame) =>
  typeof g.year === "number" && g.year > 1970 && g.year <= 1996;

export const MOTIFS: Motif[] = [
  {
    id: "fighting",
    name: "Fighting game versus screen",
    matches: (g) => hits(g, ...FIGHTING),
    card: FightingCard,
    styles: FIGHTING_STYLES,
  },
  {
    id: "rpg",
    name: "Classic RPG window",
    matches: (g) => hits(g, ...RPG),
    card: RpgCard,
    styles: RPG_STYLES,
  },
  {
    id: "racing",
    name: "Race start and timing tower",
    matches: (g) => hits(g, ...RACING),
    card: RacingCard,
    styles: RACING_STYLES,
  },
  {
    id: "sports",
    name: "TV sports broadcast",
    matches: (g) => hits(g, ...SPORTS),
    card: SportsCard,
    styles: SPORTS_STYLES,
  },
  {
    id: "horror",
    name: "Survival horror case file",
    matches: (g) => hits(g, ...HORROR),
    card: HorrorCard,
    styles: HORROR_STYLES,
  },
  {
    id: "blocky",
    name: "Voxel block world",
    matches: (g) => hits(g, ...BLOCKY),
    card: BlockyCard,
    styles: BLOCKY_STYLES,
  },
  {
    id: "arena",
    name: "First-person shooter HUD",
    matches: (g) => hits(g, ...ARENA),
    card: ArenaCard,
    styles: ARENA_STYLES,
  },
  {
    id: "pixel",
    name: "Pixel-art title screen",
    matches: (g) =>
      hits(g, ...PIXEL_ALWAYS) || (early(g) && hits(g, ...PIXEL_ERA)),
    card: PixelCard,
    styles: PIXEL_STYLES,
  },
];
