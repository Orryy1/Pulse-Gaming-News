// The living "stream asks" list (STREAM_ASKS, owner, 12 Nov 2026: "make the list of things to test, try and record
// etc be a constantly evolving dynamic list based on social media chat, major gaming journalism news and publishing
// sites, etc. and what everyone is talking about, what they want to see"). Everything here is pure:
//   - testable questions and claims are pulled out of what people write ("can you X", "does Y happen", "previews
//     said Z", myths, "I want to see"), each labelled a rumour when it rests on a leak, a datamine or an insider;
//   - the same ask said many ways is one ask: by its topic when the topic list knows it (fuel, losing the cops by
//     changing clothes...), otherwise by the words it shares with an ask already on the list;
//   - each ask is scored by buzz (how many said it and how much they were engaged with), how recent, how new, how
//     testable on stream, whether it suits the early game (no story spoilers) and whether Pulse already covered it;
//   - asks leave the list when the owner's streams prove or disprove them (src/streamasks/miner.ts) or nobody has
//     mentioned them for STREAM_ASKS_STALE_DAYS.
// Nothing here presents a leak as fact: a rumour keeps its label all the way to the page and the daily message.

import crypto from "node:crypto";
import { tokens } from "../sceneindex/lookup.ts";
import { SPOILER_PHRASES } from "../sceneindex/spoilers.ts";

export type AskKind = "question" | "claim" | "myth" | "request";
export type AskStatus = "open" | "proved" | "disproved" | "stale" | "held";
export type MentionSource =
  | "seed"
  | "press"
  | "social"
  | "comments"
  | "viewers"
  | "reddit";

export interface Mention {
  source: MentionSource;
  /** Who or where: "IGN", "Bluesky", "YouTube comments: <video>", "Pulse viewers". */
  name: string;
  url?: string;
  at: string;
  /** The words as written (trimmed to 280 characters). */
  text: string;
  /** Likes, reposts and replies together; 0 when unknown. */
  engagement: number;
}

/** What the miner looks for in a stream: words said, things seen (vision descriptions), writing on screen. */
export interface AskCues {
  said: string[];
  seen: string[];
  text: string[];
}

export interface AskVerdict {
  result: "proved" | "disproved";
  confidence: number;
  vodId: string;
  recordedOn: string;
  /** Seconds into the recording. */
  at: number;
  reason: string;
  /** The candidate's folder (frames, contact sheet, meta), relative to the data folder. */
  moment?: string;
  decidedAt: string;
}

export interface StreamAsk {
  id: string;
  game: string;
  /** The topic-list id when the ask is a known one ("fuel", "clothes-wanted"). */
  topic?: string;
  /** "Can you lose the cops by changing clothes?" */
  question: string;
  /** What is claimed, with who claims it when known. */
  claim: string;
  howToTest: string;
  kind: AskKind;
  /** Rests on a leak, a datamine, an insider or nobody official: always labelled. */
  rumour: boolean;
  /** Doable in the first hours of the game, before the story opens far. */
  earlyGame: boolean;
  /** Gives the story away: never on the list during the game's spoiler window. */
  spoiler: boolean;
  cues: AskCues;
  /** The most engaged mentions, newest kept on ties (at most MAX_MENTIONS). */
  mentions: Mention[];
  mentionCount: number;
  engagement: number;
  firstSeen: string;
  lastSeen: string;
  status: AskStatus;
  /** A Pulse video that already answered it: the title. */
  covered?: string;
  verdict?: AskVerdict;
  /** Unclear matches found so far (the owner may still want to look): never published as a verdict. */
  unclear?: number;
  score?: number;
  why?: string[];
}

export const MAX_MENTIONS = 12;

// ---------------------------------------------------------------- the topics the factory already knows

export interface Topic {
  id: string;
  /** Which games it belongs to: "gta" (any Grand Theft Auto) or "*" (any open-world game). */
  family: "gta" | "*";
  match: RegExp;
  question: string;
  howToTest: string;
  cues: AskCues;
  earlyGame: boolean;
}

/**
 * The questions people keep asking about open-world crime games, with how to test each and what a stream shows when
 * it happens. GTA VI's come from the previews (docs/streamasks-seed-gta6.md); the generic ones fit any game.
 */
export const TOPICS: Topic[] = [
  {
    id: "fuel",
    family: "gta",
    match:
      /\b(fuel|petrol|gas (tank|gauge|station|pump)|run(s|ning)? out of gas|ran out of gas|run dry|refuel\w*)\b/i,
    question: "Can your car really run out of fuel?",
    howToTest:
      "Drive one car until it stops, with a timer. Then refuel and time that.",
    cues: {
      said: [
        "out of fuel",
        "out of gas",
        "no gas",
        "ran out",
        "fuel",
        "petrol",
        "gas station",
        "refuel",
      ],
      seen: ["car stopped on the road", "fuel gauge empty", "gas station pump"],
      text: ["fuel", "gas", "refuel", "empty"],
    },
    earlyGame: true,
  },
  {
    id: "map-size",
    family: "gta",
    match:
      /\b(map (size|is (huge|big|bigger|smaller))|twice the size|size of the map|how big is the map|bigger than (gta )?(v|5)|map compared)\b/i,
    question: "Is the map really about twice the size of GTA V's?",
    howToTest:
      "Drive or fly edge to edge at top speed with a timer and compare with GTA V's crossing times.",
    cues: {
      said: [
        "map",
        "edge of the map",
        "how big",
        "across the map",
        "minutes to cross",
      ],
      seen: ["map screen", "flying over the city", "long highway drive"],
      text: ["map"],
    },
    earlyGame: true,
  },
  {
    id: "clothes-wanted",
    family: "gta",
    match:
      /\b(chang\w* (your |my )?(clothes|outfit)|disguise|outfit change)\b.*\b(cops?|police|wanted|stars?|lose)\b|\b(cops?|police|wanted)\b.*\b(chang\w* (your |my )?(clothes|outfit)|disguise|description)\b/i,
    question: "Can you lose the cops by changing your clothes?",
    howToTest:
      "Commit a crime, get seen, change outfit in a store, walk past police. Then repeat without changing.",
    cues: {
      said: [
        "change clothes",
        "changed my outfit",
        "new outfit",
        "lost them",
        "lost the cops",
        "wanted level",
        "they don't recognise",
      ],
      seen: [
        "clothing store changing outfit",
        "police officers walking past the player",
        "wanted stars",
      ],
      text: ["wanted", "clothing", "outfit"],
    },
    earlyGame: true,
  },
  {
    id: "split-up",
    family: "gta",
    match:
      /\b(split(ting)? up|separat\w+)\b.*\b(jason|lucia|wanted|stars?|cops?|police)\b/i,
    question:
      "Does splitting Jason and Lucia up drop part of your wanted level?",
    howToTest:
      "Do the same crime twice: once together, once splitting up. Compare the stars.",
    cues: {
      said: ["split up", "separate", "jason", "lucia", "wanted level"],
      seen: ["two characters running in different directions", "wanted stars"],
      text: ["wanted"],
    },
    earlyGame: true,
  },
  {
    id: "rob-stores",
    family: "gta",
    match:
      /\b(rob(bing|bed)?|robbery|hold[- ]?up|stick[- ]?up)\b.{0,30}\b(every|all|any|which)?\s*(stores?|shops?)\b|\bevery (store|shop) (can be|is) robbable\b/i,
    question: "Can you really rob every store in Leonida?",
    howToTest:
      "Try ten different shop types in one session (fuel station, clothes, burger place, pawn shop, salon) and count which allow it.",
    cues: {
      said: [
        "rob",
        "robbery",
        "hands up",
        "open the register",
        "give me the money",
        "this store",
      ],
      seen: [
        "player aiming a gun at a shop clerk",
        "cash register",
        "store interior",
      ],
      text: ["rob", "cash"],
    },
    earlyGame: true,
  },
  {
    id: "shopper-fights",
    family: "gta",
    match:
      /\b(customers?|shoppers?|clerks?|cashiers?|npcs?|bystanders?)\b.{0,40}\b(fight(s)? back|resist\w*|intervene\w*|hidden guns?|carry guns?|shoot back)\b/i,
    question: "Do shoppers and clerks fight back during a hold-up?",
    howToTest:
      "Rob the same store type five times and count how often someone resists.",
    cues: {
      said: ["he's got a gun", "fought back", "shot back", "clerk", "shopper"],
      seen: ["shop clerk pulling out a gun", "customer tackling the player"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "stare-dog",
    family: "gta",
    match:
      /\b(stare|staring)\b.{0,40}\b(npc|man|people|stranger|dog)\b|\bset (his|the|their) dog on\b|\bdogs? attack\w*\b/i,
    question:
      "Will a stranger set his dog on you if you stare at him too long?",
    howToTest: "Stare at a man with a dog for 30, 60 and 90 seconds.",
    cues: {
      said: ["staring", "his dog", "the dog", "dog attack", "get him"],
      seen: ["dog attacking the player", "man with a dog on a lead"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "interiors",
    family: "gta",
    match:
      /\b(enterable|interiors?|go inside|enter (every|any|most|all)|buildings? you can enter|% of buildings)\b/i,
    question: "How many buildings can you really go inside?",
    howToTest:
      "Walk one Vice City block, try every door and give a real percentage.",
    cues: {
      said: ["can't go in", "can go inside", "door", "enter", "interior"],
      seen: [
        "player walking through a door into a building interior",
        "locked door",
      ],
      text: ["enter"],
    },
    earlyGame: true,
  },
  {
    id: "trackers",
    family: "gta",
    match:
      /\b(cars?|vehicles?|stolen|supercars?)\b.{0,30}\btrackers?\b|\btrackers?\b.{0,30}\b(cars?|vehicles?|police|cops)\b|\bfence (a|the|your)? ?(car|vehicle)\b/i,
    question: "Do stolen supercars have trackers that call the police?",
    howToTest:
      "Steal a supercar, drive slowly and see if police come. Then take one to a fence.",
    cues: {
      said: ["tracker", "fence", "supercar", "they found me"],
      seen: ["police chasing a sports car"],
      text: ["tracker"],
    },
    earlyGame: true,
  },
  {
    id: "waink",
    family: "gta",
    match: /\bwaink\b|\bscan(ner|ning)? (a |the )?cars?\b|\bcar scanner\b/i,
    question:
      "Does the WAINK app really show a car's locks, value and alarm before you steal it?",
    howToTest: "Scan ten cars on a street and steal the best one it finds.",
    cues: {
      said: ["waink", "scan", "scanner", "value", "alarm"],
      seen: ["phone app scanning a parked car"],
      text: ["waink", "value", "alarm", "tracker"],
    },
    earlyGame: true,
  },
  {
    id: "cash-death",
    family: "gta",
    match:
      /\b(lose|lost|losing|drop\w*|keep)\b.{0,20}\b(your |all |my )?(cash|money)\b.{0,30}\b(die|death|dying|wasted|arrest\w*|busted)\b|\b(die|wasted|busted)\b.{0,30}\b(lose|lost)\b.{0,15}\b(cash|money)\b|\bbank (it|your money)\b|\batms?\b/i,
    question: "Do you lose the cash you carry when you get Wasted or Busted?",
    howToTest: "Carry a known amount, get Wasted, check the balance.",
    cues: {
      said: ["wasted", "busted", "lost my money", "hospital", "money"],
      seen: ["wasted screen", "hospital exit", "money counter"],
      text: ["wasted", "busted", "$"],
    },
    earlyGame: true,
  },
  {
    id: "body",
    family: "gta",
    match:
      /\b(gym|work(ing)? ?out|get(ting)? fat|gain\w* weight|body (change|type)s?|muscles?|diet|burger shot)\b/i,
    question: "Does your body change with what you eat and how you train?",
    howToTest:
      "Eat only Burger Shot for a set number of in-game days, or train three days in a row. Before-and-after screenshots.",
    cues: {
      said: ["gym", "fat", "muscle", "eat", "burger"],
      seen: ["character exercising in a gym", "character eating fast food"],
      text: ["strength", "stamina"],
    },
    earlyGame: true,
  },
  {
    id: "weather",
    family: "gta",
    match: /\b(weather|storms?|hurricanes?|rain(storm)?|floods?|flooding)\b/i,
    question: "Do storms really build and move across the map?",
    howToTest:
      "When rain starts, drive out of it and film the edge of the storm.",
    cues: {
      said: ["storm", "rain", "weather", "hurricane"],
      seen: ["heavy rain storm", "dark storm clouds", "wet road reflections"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "gun-limit",
    family: "gta",
    match:
      /\bweapon wheel\b|\b(carry|holding|limit)\b.{0,25}\b(guns?|weapons?)\b|\b(two|2) (long )?guns\b|\bguns? in (the|your) (boot|trunk)\b/i,
    question: "Are you really limited to two handguns and two long guns?",
    howToTest: "Try to pick up a third long gun. Then open the boot.",
    cues: {
      said: ["weapon wheel", "can't carry", "trunk", "boot", "guns"],
      seen: ["weapon selection wheel", "car boot full of guns"],
      text: ["weapon"],
    },
    earlyGame: true,
  },
  {
    id: "open-carry",
    family: "gta",
    match:
      /\bopen[- ]carry\b|\b(people|pedestrians|npcs) (panic|react|run)\b.{0,20}\bguns?\b|\bwalk\w* (around )?with (a )?(rifle|gun)\b/i,
    question:
      "Do people panic and call the cops when you walk around with a rifle out?",
    howToTest: "Walk a busy street with a rifle out, then concealed.",
    cues: {
      said: ["rifle", "panicking", "calling the cops", "running away"],
      seen: ["pedestrians running from an armed player"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "flip-car",
    family: "gta",
    match:
      /\b(flip(ping)?|roll(ing)?) (your |the |a )?(car|vehicle) (back )?over\b|\boverturned\b|\bupside[- ]down car\b/i,
    question: "Can you still rock an upside-down car back over?",
    howToTest: "Roll a car and try to steer it back onto its wheels.",
    cues: {
      said: ["upside down", "flipped", "roll it back", "on its roof"],
      seen: ["car upside down on its roof"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "impound",
    family: "gta",
    match: /\bimpound\w*\b|\btow(ed)? (away|truck)\b/i,
    question: "Can you sneak a car back out of the impound?",
    howToTest: "Get a car towed and try sneaking in.",
    cues: {
      said: ["impound", "towed"],
      seen: ["impound lot fence"],
      text: ["impound"],
    },
    earlyGame: true,
  },
  {
    id: "disarm",
    family: "gta",
    match:
      /\b(shoot (the )?gun out|disarm\w*|limb shots?|knee ?cap\w*|shoot (them|someone) in the (leg|arm))\b/i,
    question: "Can you shoot the gun out of someone's hand?",
    howToTest:
      "Try ten times on armed enemies and count how often the gun drops.",
    cues: {
      said: ["shot the gun", "disarmed", "dropped the gun", "leg shot"],
      seen: ["enemy dropping a gun"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "car-delivery",
    family: "gta",
    match:
      /\bscooter bros\b|\b(car|vehicle) delivery\b|\bdeliver(ed)? (my|your) car\b/i,
    question: "How fast does Scooter Bros really deliver your car?",
    howToTest:
      "Order your car and time the delivery from the call to the keys.",
    cues: {
      said: ["scooter", "delivery", "here's my car"],
      seen: ["man on a scooter riding away"],
      text: ["scooter bros", "delivery"],
    },
    earlyGame: true,
  },
  {
    id: "narrow-roads",
    family: "gta",
    match:
      /\bnarrow(er)? roads?\b|\broads? (are|seem|look) (narrow|thinner|smaller)\b|\blane width\b/i,
    question: "Are the roads really narrower than GTA V's?",
    howToTest:
      "Measure a lane against a car's width and compare with GTA V footage.",
    cues: {
      said: ["narrow", "lane", "road"],
      seen: ["car driving down a narrow street"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "livestream-events",
    family: "gta",
    match:
      /\blive ?streams?\b.{0,30}\b(app|events?|in[- ]game)\b|\b(in[- ]game )?social (media )?(app|feed)\b.{0,30}\bevents?\b/i,
    question:
      "Do the in-game livestreams really show live events you can drive to?",
    howToTest: "Open the social app and race to the first live event it shows.",
    cues: {
      said: ["livestream", "live event", "on the app"],
      seen: ["phone showing a livestream"],
      text: ["live"],
    },
    earlyGame: true,
  },
  {
    id: "criminal-profile",
    family: "gta",
    match:
      /\bcriminal profile\b|\birredeemable\b|\b(criminal|player) reputation\b/i,
    question: "Does a messy crime really wreck your Criminal Profile?",
    howToTest:
      "Do a clean robbery and check the menu; do a messy one and check again.",
    cues: {
      said: ["criminal profile", "reputation", "professional"],
      seen: ["character profile menu"],
      text: ["profile", "professional", "irredeemable"],
    },
    earlyGame: true,
  },
  {
    id: "pet-dog",
    family: "gta",
    match: /\bpet(ting)? (the |a |your )?dogs?\b|\bpet the dog\b/i,
    question: "Can you pet the dog, and does asking the owner first matter?",
    howToTest: "Pet a dog without asking, then ask the owner first.",
    cues: {
      said: ["pet the dog", "good boy", "can i pet"],
      seen: ["player petting a dog"],
      text: ["pet"],
    },
    earlyGame: true,
  },
  {
    id: "animals",
    family: "gta",
    match:
      /\b(wildlife|animal (log|checklist|compendium|species)|study(ing)? (the )?animals|\d+\+? (animal )?species|species (to|you can) (log|find|study|discover))\b/i,
    question: "How many animals can you find and log?",
    howToTest: "Keep a daily count of every species logged.",
    cues: {
      said: ["alligator", "gator", "animal", "species"],
      seen: ["alligator", "wild animal"],
      text: ["species"],
    },
    earlyGame: true,
  },
  {
    id: "day-length",
    family: "gta",
    match:
      /\bday[- ]night cycle\b|\bhow long is (a|one) (day|in-game day)\b|\bin-game day\b/i,
    question: "How long is one in-game day in real minutes?",
    howToTest: "Time one in-game day from sunrise to sunrise.",
    cues: {
      said: ["sunrise", "sunset", "in-game day", "night already"],
      seen: ["sunrise over the city", "sunset"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "third-character",
    family: "gta",
    match:
      /\b(third|3rd) (playable )?(character|protagonist)\b|\bthree birds\b/i,
    question: "Is there a hidden third playable character?",
    howToTest:
      'Look for any character switch beyond Jason and Lucia. Say "previews say two" first.',
    cues: {
      said: ["third character", "switch character"],
      seen: ["character switch wheel"],
      text: ["switch"],
    },
    earlyGame: true,
  },
  {
    id: "first-person",
    family: "gta",
    match: /\bfirst[- ]person\b|\bfpp\b/i,
    question: "Is there really no first-person mode?",
    howToTest:
      "Check the camera settings on day one and try the view button while aiming.",
    cues: {
      said: ["first person", "camera"],
      seen: ["first-person view of hands on a steering wheel", "settings menu"],
      text: ["first person", "camera"],
    },
    earlyGame: true,
  },
  {
    id: "performance",
    family: "*",
    match:
      /\b(1440p|4k|60 ?fps|30 ?fps|frame ?rate|frames per second|resolution|performance mode|pro enhanced)\b/i,
    question: "What resolution and frame rate does it really run at?",
    howToTest:
      "Show the settings menu and any performance mode on PS5 or PS5 Pro.",
    cues: {
      said: ["frame rate", "fps", "performance mode", "resolution"],
      seen: ["graphics settings menu"],
      text: ["performance", "fidelity", "frame rate"],
    },
    earlyGame: true,
  },
  {
    id: "police-minimap",
    family: "gta",
    match:
      /\b(police|cops?)\b.{0,30}\b(minimap|radar)\b|\b(minimap|radar)\b.{0,30}\b(police|cops?)\b/i,
    question: "Do the police still show as dots on the minimap?",
    howToTest: "Check the minimap in your first chase.",
    cues: {
      said: ["minimap", "radar", "where are they"],
      seen: ["minimap during a police chase"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "radio-toggle",
    family: "*",
    match:
      /\b(streamer mode|copyright[- ](free|safe)|licensed (music|songs)|content id)\b|\bradio\b.{0,30}\b(copyright|toggle|streamers?)\b/i,
    question: "Is there a copyright-safe radio switch for streamers?",
    howToTest: "Check the audio settings on day one.",
    cues: {
      said: ["streamer mode", "copyright", "audio settings"],
      seen: ["audio settings menu"],
      text: ["streamer", "copyright", "licensed"],
    },
    earlyGame: true,
  },
  {
    id: "story-length",
    family: "*",
    match:
      /\b\d+[- ]hours? (story|campaign|long)\b|\bhow long is the (story|campaign|game)\b|\bstory length\b/i,
    question: "How long is the story really?",
    howToTest:
      "Keep a count of your hours; only say the total after the spoiler window.",
    cues: { said: [], seen: [], text: [] },
    earlyGame: false,
  },
  {
    id: "swim-escape",
    family: "*",
    match:
      /\bswim\w*\b.{0,40}\b(cops?|police|wanted|stars?|escape)\b|\b(escape|lose)\b.{0,30}\bswim\w*\b/i,
    question: "Can you swim away from a wanted level?",
    howToTest:
      "Get two or three stars near water, dive in and swim out until they give up.",
    cues: {
      said: ["swim", "water", "lost them", "wanted"],
      seen: ["player swimming in the sea", "police boat"],
      text: ["wanted"],
    },
    earlyGame: true,
  },
  {
    id: "lose-wanted",
    family: "*",
    match:
      /\b(lose|losing|lost|escape|shake|evade)\b.{0,25}\b(the )?(cops?|police|wanted level|stars|heat)\b|\bhow (do|to) (you )?lose (the )?(cops|police|stars)\b/i,
    question: "What is the quickest way to lose a wanted level?",
    howToTest:
      "Get the same number of stars three times and try hiding, out-driving and switching cars. Time each.",
    cues: {
      said: [
        "lost them",
        "lost the cops",
        "they're gone",
        "wanted level",
        "stars",
        "hide",
      ],
      seen: [
        "police car chase",
        "car hiding in an alley",
        "police helicopter searchlight",
      ],
      text: ["wanted"],
    },
    earlyGame: true,
  },
  {
    id: "car-explode",
    family: "*",
    match:
      /\b(cars?|vehicles?)\b.{0,30}\b(explode|blow up|catch(es)? fire|on fire)\b|\b(explode|blow up)\b.{0,20}\b(if|when) you crash\b/i,
    question: "Does a car really catch fire and blow up after enough crashes?",
    howToTest:
      "Crash the same car again and again and count the hits until it burns.",
    cues: {
      said: [
        "it's on fire",
        "on fire",
        "explode",
        "blew up",
        "boom",
        "get out",
      ],
      seen: ["car on fire", "burning wrecked car", "explosion"],
      text: [],
    },
    earlyGame: true,
  },
  {
    id: "fall-damage",
    family: "*",
    match:
      /\bfall damage\b|\b(jump|fall)\w* (off|from) (a |the )?(building|roof|bridge|cliff)\b|\bparachute\b/i,
    question: "How high can you fall from and survive?",
    howToTest:
      "Jump from higher and higher roofs and note where it stops being survivable.",
    cues: {
      said: ["jump", "fall", "survive", "parachute"],
      seen: ["character falling from a roof", "parachute"],
      text: ["wasted"],
    },
    earlyGame: true,
  },
];

const GTA = /\b(gta|grand theft auto)\b/i;

/** The topics that can apply to a game (pure). */
export function topicsFor(game: string): Topic[] {
  return TOPICS.filter(
    (t) => t.family === "*" || (t.family === "gta" && GTA.test(game)),
  );
}

/** The known topic a text is about, or undefined (pure). The first that matches wins: the list runs specific to general. */
export function topicOf(text: string, game: string): Topic | undefined {
  return topicsFor(game).find((t) => t.match.test(text));
}

// ---------------------------------------------------------------- pulling asks out of text

/** Words that mean a sentence is about something a stream can show (systems, not story). */
const SYSTEM =
  /\b(police|cops?|wanted|stars?|cars?|vehicles?|fuel|gas|petrol|driv\w+|crash\w*|swim\w*|fly|flying|planes?|helis?|helicopters?|boats?|bikes?|motorbikes?|stores?|shops?|rob\w*|heists?|guns?|weapons?|ammo|shoot\w*|aim\w*|npcs?|pedestrians?|strangers?|dogs?|animals?|pets?|horses?|fish\w*|hunt\w*|map|interiors?|buildings?|doors?|climb\w*|jump\w*|fall\w*|ragdoll|physics|weather|rain|storms?|phone|radio|cash|bank|atms?|clothes|outfits?|hair|tattoos?|gym|eat\w*|food|body|weight|health|hospital|die|dies|wasted|busted|arrest\w*|jail|prison|first[- ]person|fps|frame ?rate|frames per second|resolution|enterable|go inside|explod\w*|blow up|on fire|safehouses?|minimap|radar|hud|customi[sz]\w*|garages?|impound\w*|tow\w*|trackers?|alarms?|locks?|steal\w*|traffic|roads?|bridges?|beach|swamp|gators?|alligators?|wildlife|stealth|melee|fight\w*|punch\w*|chase\w*|escape\w*|hide|hiding|reactions?|react\w*|destructi\w+|crime|side ?quests?|activities|mini[- ]?games?|golf|tennis|bowling|darts|dating)\b/i;

/** Sales, money and launch news: never a stream test, even when it names a car or a store ("PS Store history"). */
const BUSINESS =
  /\b(pre-?orders?|pre-?ordered|pre-?purchase\w*|sold|sales|copies|units|revenue|billions?|millions?|store history|stock|shares|earnings|investors?|employees|day off|price[sd]?|pricing|\$\s?\d|launch day|release date|launch(es|ed)? on|trailer\s*\d|pre-?load\w*|download\w*|install\w*|marketing|embargo|metacritic|review scores?|keeps selling|business is|ceo|take-two|layoffs?|lawsuit|delay\w*|refund\w*|bundle|edition)\b/i;

/** True for sales, money and launch news (pure): never a stream test. */
export function isNewsy(text: string): boolean {
  return (
    BUSINESS.test(text) ||
    /\b(dmca|takedown|jacket|merch\w*|t-shirt|hoodie|fan[- ]made|mods?)\b/i.test(
      text,
    )
  );
}

const QUESTION_START =
  /^(?:so |but |and |ok |okay |wait |honestly |genuinely |real question:? |serious question:? |question:? )?(can|could|does|do|did|is|are|will|would|has|have|how (?:long|many|much|big|far|fast|high)|what happens (?:if|when)|is it possible|anyone know (?:if|whether)|has anyone (?:tried|tested|checked))\b/i;
const REQUEST =
  /\b(someone (?:needs to |should |please )?(?:test|try|check|see)|somebody (?:test|try|check)|please (?:test|try|show|check)|pls (?:test|try|show)|i (?:want|wanna|need) to (?:see|know)|i hope (?:we|you) can|would love to see|need (?:a|someone to make a) video|test (?:if|whether)|try (?:if|whether)|can someone|can somebody|who'?s gonna test)\b/i;
const CLAIM =
  /\b(you can(?:'t|not)?|you won'?t be able|you'?ll be able|you will be able|lets you|allows you|there (?:is|are|will be) (?:no )?|reportedly|according to|previews? (?:say|said|says|claim\w*|mention\w*)|hands[- ]on|confirmed|it'?s been (?:said|claimed)|apparently|supposedly|allegedly|rumou?r\w*|leak\w*|datamin\w+|insider\w*)\b/i;
const MYTH =
  /\b(myth|theory|theories|is it true|fake|debunk\w*|really true|truth about)\b/i;
export const RUMOUR =
  /\b(leak\w*|datamin\w+|insider\w*|rumou?r\w*|unconfirmed|allegedly|supposedly|apparently|tiktok|4chan|reportedly|sources? (?:say|claim)|not (?:officially )?confirmed|no official source|unofficial|fan theor\w+)\b/i;

export interface RawAsk {
  kind: AskKind;
  question: string;
  claim: string;
  rumour: boolean;
  text: string;
}

/** Text tidied for reading: no links, handles, hashtags at the end, emoji or repeated punctuation (pure). */
export function tidyText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)@[\w.]+/g, " ")
    .replace(/(\s#[\w]+)+\s*$/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/([!?.])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences of a text, each 12 to 240 characters (pure). */
export function sentences(text: string): string[] {
  return tidyText(text)
    .split(/(?<=[.!?])\s+|\n+|\s+[-–|]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 240);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) =>
  /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/** A claim as the question a test answers (pure): "you can rob every store" -> "Can you rob every store?". */
export function claimQuestion(claim: string): string {
  const c = claim
    .replace(
      /^(?:previews? (?:say|said|says|claim\w*)(?: that)?|reportedly|according to [^,]+,|apparently|supposedly|allegedly|it'?s been (?:said|claimed) that)\s*/i,
      "",
    )
    .replace(/[.!]+$/, "")
    .trim();
  const can = c.match(/^you can(?:'t| ?not)\s+(.+)$/i);
  if (can) return `Is it true you can't ${can[1]}?`;
  const can2 = c.match(/^you(?:'ll| will)? (?:can|be able to)\s+(.+)$/i);
  if (can2) return `Can you really ${can2[1]}?`;
  return `Is it true that ${lowerFirst(c)}?`;
}

/** The testable asks in one piece of writing (pure). Only sentences about systems a stream can show count. */
export function extractAsks(text: string): RawAsk[] {
  const out: RawAsk[] = [];
  for (const s of sentences(text)) {
    if (!SYSTEM.test(s) || isNewsy(s)) continue;
    const rumour = RUMOUR.test(s);
    if (/\?\s*$/.test(s) && (QUESTION_START.test(s) || REQUEST.test(s))) {
      const q = cap(
        s.replace(QUESTION_START, (m) =>
          m.replace(
            /^(so|but|and|ok|okay|wait|honestly|genuinely|real question:?|serious question:?|question:?)\s+/i,
            "",
          ),
        ),
      );
      out.push({
        kind: MYTH.test(s) ? "myth" : "question",
        question: q,
        claim: "",
        rumour,
        text: s,
      });
    } else if (REQUEST.test(s)) {
      out.push({
        kind: "request",
        question: cap(s.replace(/[.!]+$/, "")),
        claim: "",
        rumour,
        text: s,
      });
    } else if (CLAIM.test(s) && !/\?\s*$/.test(s)) {
      out.push({
        kind: MYTH.test(s) ? "myth" : "claim",
        question: claimQuestion(s),
        claim: s,
        rumour,
        text: s,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- one ask, many ways of saying it

export function askId(game: string, key: string): string {
  return crypto
    .createHash("sha1")
    .update(`${game.toLowerCase()}|${key}`)
    .digest("hex")
    .slice(0, 10);
}

/** Shared words of two asks, 0 to 1 (pure). */
export function overlap(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / Math.min(x.size, y.size) >= 0.75 && n >= 3
    ? n / Math.max(x.size, y.size) + 0.25
    : n / (x.size + y.size - n);
}

/** Cues for an ask with no topic: its own telling words (pure). */
export function cuesFromText(question: string): AskCues {
  const words = tokens(question).filter((w) => w.length > 3);
  return {
    said: [...new Set(words)].slice(0, 8),
    seen: [question.replace(/\?$/, "")],
    text: [],
  };
}

/** True when the words give the story away (pure): the spoiler guard's own phrases. */
export function spoilsStory(
  text: string,
  lateTerms: readonly string[] = [],
): boolean {
  if (SPOILER_PHRASES.some(([re]) => re.test(text))) return true;
  const low = text.toLowerCase();
  return lateTerms.some((t) => t && low.includes(t.toLowerCase()));
}

/** Keeps the most engaged mentions, newest first on ties, without repeats (pure). */
export function keepMentions(list: Mention[]): Mention[] {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => b.engagement - a.engagement || b.at.localeCompare(a.at))
    .filter((m) => {
      const k = `${m.source}|${m.text.toLowerCase().slice(0, 80)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_MENTIONS);
}

export interface Sighting {
  game: string;
  raw: RawAsk;
  mention: Mention;
}

/**
 * Folds new sightings into the list (pure): onto the ask of the same topic, else onto an open ask that shares most of
 * its words, else as a new ask. Asks already proved or disproved keep their verdict; a new sighting only refreshes
 * when they were last talked about.
 */
export function foldSightings(
  asks: StreamAsk[],
  sightings: Sighting[],
  now: Date,
  o: { lateTerms?: Record<string, string[]> } = {},
): StreamAsk[] {
  const list = asks.map((a) => ({ ...a, mentions: [...a.mentions] }));
  for (const s of sightings) {
    const topic = topicOf(
      `${s.raw.question} ${s.raw.claim} ${s.raw.text}`,
      s.game,
    );
    let ask = topic
      ? list.find((a) => a.game === s.game && a.topic === topic.id)
      : undefined;
    if (!ask && !topic)
      ask = list
        .filter((a) => a.game === s.game && !a.topic)
        .map((a) => ({ a, o: overlap(a.question, s.raw.question) }))
        .filter((x) => x.o >= 0.5)
        .sort((x, y) => y.o - x.o)[0]?.a;
    const at = s.mention.at || now.toISOString();
    if (ask) {
      const isNew = !ask.mentions.some(
        (m) =>
          m.source === s.mention.source &&
          m.text.toLowerCase() === s.mention.text.toLowerCase(),
      );
      if (!isNew) continue;
      ask.mentions = keepMentions([...ask.mentions, s.mention]);
      ask.mentionCount++;
      ask.engagement += s.mention.engagement;
      if (at > ask.lastSeen) ask.lastSeen = at;
      if (ask.status === "stale") ask.status = "open";
      // Something official arriving lifts the rumour label; a rumour arriving never adds it to a confirmed ask.
      if (
        ask.rumour &&
        !s.raw.rumour &&
        (s.mention.source === "press" || s.mention.source === "seed")
      )
        ask.rumour = false;
      if (!ask.claim && s.raw.claim) ask.claim = s.raw.claim;
      continue;
    }
    const question = topic?.question ?? s.raw.question;
    const spoiler = spoilsStory(
      `${question} ${s.raw.text}`,
      o.lateTerms?.[s.game] ?? [],
    );
    list.push({
      id: askId(s.game, topic?.id ?? tokens(question).sort().join(" ")),
      game: s.game,
      ...(topic ? { topic: topic.id } : {}),
      question,
      claim: s.raw.claim,
      howToTest:
        topic?.howToTest ??
        (s.raw.kind === "claim" || s.raw.kind === "myth"
          ? "Say the claim out loud, try it on stream and show the result either way."
          : 'Say the question out loud ("Testing: ..."), try it on stream and show what happens.'),
      kind: s.raw.kind,
      rumour: s.raw.rumour,
      earlyGame: topic?.earlyGame ?? !spoiler,
      spoiler,
      cues: topic?.cues ?? cuesFromText(question),
      mentions: [s.mention],
      mentionCount: 1,
      engagement: s.mention.engagement,
      firstSeen: at,
      lastSeen: at,
      status: spoiler ? "held" : "open",
    });
  }
  return list;
}

// ---------------------------------------------------------------- scoring and the list's lifecycle

const HOUR = 3_600_000;
const SOURCE_WEIGHT: Record<MentionSource, number> = {
  seed: 1.5,
  press: 2,
  social: 1,
  comments: 1,
  viewers: 2.5,
  reddit: 1,
};

/**
 * An ask's score and the reasons for it (pure). Buzz: mentions weighted by source (Pulse's own viewers count most,
 * then the press) plus engagement, both on a log scale; recency: halves every three days since it was last
 * mentioned; freshness: a bonus for the first two days; testability: a question or claim with a test beats a vague
 * want; early game: what can be done in the first hours first; covered: already answered by a Pulse video drops it
 * far down. Rumours are kept (a leak tested on stream is a good Short) and labelled, never boosted.
 */
export function scoreAsk(
  a: StreamAsk,
  now: Date,
): { score: number; why: string[] } {
  const why: string[] = [];
  const weighted =
    a.mentions.reduce((n, m) => n + SOURCE_WEIGHT[m.source], 0) +
    Math.max(0, a.mentionCount - a.mentions.length);
  const buzz = Math.log2(1 + weighted) * 2 + Math.log10(1 + a.engagement);
  why.push(`${a.mentionCount} mention${a.mentionCount === 1 ? "" : "s"}`);
  if (a.engagement) why.push(`${Math.round(a.engagement)} engagement`);
  const ageHours = Math.max(0, (now.getTime() - Date.parse(a.lastSeen)) / HOUR);
  const recency = Math.pow(0.5, ageHours / 72);
  const newHours = Math.max(
    0,
    (now.getTime() - Date.parse(a.firstSeen)) / HOUR,
  );
  // The previews' seeds are the list's starting point, not news: no "new" bonus for them.
  const seedOnly = a.mentions.every((m) => m.source === "seed");
  const fresh = newHours < 48 && !seedOnly ? 1.5 * (1 - newHours / 48) : 0;
  if (fresh > 0.5) why.push("new");
  const testable =
    (a.topic ? 2 : 0) +
    (a.kind === "question" || a.kind === "claim" || a.kind === "myth"
      ? 1
      : 0.3);
  const early = a.earlyGame ? 1 : -2;
  if (!a.earlyGame) why.push("later in the game");
  const sources = new Set(a.mentions.map((m) => m.source)).size;
  if (sources > 1) why.push(`${sources} kinds of source`);
  let score =
    buzz * (0.35 + 0.65 * recency) +
    fresh +
    testable +
    early +
    Math.min(2, sources - 1);
  if (a.covered) {
    score -= 6;
    why.push("Pulse covered it");
  }
  if (a.rumour) why.push("rumour");
  return { score: Math.round(score * 100) / 100, why };
}

/**
 * The list after a refresh (pure): every ask scored; stale ones (nobody mentioned them for `staleDays`, three times
 * that for the previews' seeds, which are the reason the list exists) marked so; spoilers held; the open ones best
 * first. Proved and disproved asks stay in the file, off the open list.
 */
export function refreshList(
  asks: StreamAsk[],
  now: Date,
  o: { staleDays: number },
): StreamAsk[] {
  return asks
    .map((a) => {
      const { score, why } = scoreAsk(a, now);
      let status = a.status;
      if (status === "open" || status === "stale") {
        const seedOnly = a.mentions.every((m) => m.source === "seed");
        const days = (now.getTime() - Date.parse(a.lastSeen)) / (24 * HOUR);
        status = days > o.staleDays * (seedOnly ? 3 : 1) ? "stale" : "open";
      }
      if (a.spoiler && status === "open") status = "held";
      return { ...a, score, why, status };
    })
    .sort(
      (x, y) =>
        statusRank(x.status) - statusRank(y.status) ||
        (y.score ?? 0) - (x.score ?? 0),
    );
}

function statusRank(s: AskStatus): number {
  return s === "open"
    ? 0
    : s === "proved" || s === "disproved"
      ? 1
      : s === "held"
        ? 2
        : 3;
}

/** The open asks, best first (pure). */
export function openAsks(asks: StreamAsk[], game?: string): StreamAsk[] {
  return asks.filter((a) => a.status === "open" && (!game || a.game === game));
}

/** A verdict takes the ask off the open list (pure); a weaker verdict never replaces a stronger one. */
export function applyVerdict(
  asks: StreamAsk[],
  id: string,
  v: AskVerdict,
): StreamAsk[] {
  return asks.map((a) => {
    if (a.id !== id) return a;
    if (a.verdict && a.verdict.confidence >= v.confidence) return a;
    return { ...a, verdict: v, status: v.result };
  });
}

/**
 * Marks asks a Pulse video already answered (pure): a published title that shares most of the ask's words or names
 * its topic. The caller passes only videos that tested something (the gameplay lane), never news on the same topic.
 */
export function markCovered(
  asks: StreamAsk[],
  titles: Array<{ title: string; game?: string }>,
): StreamAsk[] {
  return asks.map((a) => {
    const hit = titles.find(
      (t) =>
        (!t.game || t.game.toLowerCase() === a.game.toLowerCase()) &&
        (overlap(t.title, a.question) >= 0.6 ||
          (a.topic ? topicOf(t.title, a.game)?.id === a.topic : false)),
    );
    return hit ? { ...a, covered: hit.title } : a;
  });
}
