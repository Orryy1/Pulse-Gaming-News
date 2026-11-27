import type { Word } from "../voice/elevenlabs.ts";
import type { Segment } from "./timeline.ts";
import type { RenderPlan, PlanSteam } from "./plan.ts";

export { BRAND, STORY_THEME } from "./brand.ts";
export { WIDTH, HEIGHT } from "./layout.ts";
export const FPS = 30;

export interface ShortImage {
  src: string;
  kind: string;
  aspect: number; // width / height
  blurSrc?: string | null; // pre-blurred plate for the framed panel
  fillSrc?: string | null; // FILL_FRAME: the picture extended to 1080x1920 by the PC's image model, shown full-bleed instead of the panel
  luma?: number;
  beatIndex?: number; // tagged for one entry of a ranking Short
  credit?: string; // a credit its licence asks for on screen (a CC BY photo), shown while it shows
  focusX?: number; // 0-1, the subject's place across a wide still, for the vertical crop
  noCollage?: boolean; // hardware or merchandise (allowed only in a story about it): never in the game collage card
  layers?: {
    bg: string;
    mid: string;
    fg: string;
    /** PARALLAX_DEEP: the 3D photo maps; with them the still is filmed by the depth camera (components/DepthCam.tsx). */
    mesh?: { depth: string; far: string; farDepth: string; pivot: number };
  }; // SHORT_PARALLAX: depth layers, drifted at their own speeds
}

export interface ShortClip {
  src: string;
  durationSeconds: number;
  blurSrc?: string | null;
  motion?: number;
  luma?: number;
  beatIndex?: number;
  role?: "hook";
  stock?: boolean; // licensed stock: shown with an ILLUSTRATIVE tag
  audio?: boolean; // gameplay with its game sound kept: played low under the narrator
  credit?: string; // a credit its licence asks for on screen (CC BY gameplay), shown while it plays
  crop?: import("./smartcrop.ts").ClipCrop; // APPLE_SMART_CROP: where the upright crop centres, moment by moment
}

// A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props constraint.
export type ShortProps = {
  headline: string;
  /**
   * The game collage card (the motif sting), placed on the words that name the game for at least 2.5 s
   * (src/render/cleanframe.ts stingPlacement); null: no collage card at all; absent: as before, a second after the hook.
   */
  motifSting?: { from: number; frames: number } | null;
  /** SHORT_OPEN_WORDS: the caption over an opening on footage, in place of the headline: hook words or the subject ("" = none). */
  openingWords?: string;
  /** SHORT_FULL_COVER: the cover still (cover.jpg), frame 0 with the whole headline and no caption (src/social/cover.ts). */
  coverStill?: boolean;
  storyType: string;
  gameTitle: string;
  gameSubtitle: string; // "RELEASED 2023 · BETHESDA" style line for the game card
  isRumour: boolean;
  attribution: string;
  footageCredit: string; // "FOOTAGE: BETHESDA · OFFICIAL TRAILER", empty when no clips
  segments: Segment[];
  words: Word[];
  images: ShortImage[];
  clips: ShortClip[];
  steam: PlanSteam | null;
  emphasis: string[]; // words the captions keep lit after they are spoken
  deskName?: string; // the desk partner's name, when a desk question is in the Short
  stamps?: Array<{ at: number; text: string; sub?: string; colour: string; tone?: string }>; // word stamps, timed to their words
  plan: RenderPlan | null; // built in the pipeline; the composition builds one for previews
  suite?: boolean; // the new-look test: cut accents, punch-ins and an old game's period looks
  quickFigures?: boolean; // SHORT_LABELS_CLEAN: a card's count-up lands as its word is said
  bright?: boolean; // SHORT_BRIGHT: lighter fades over the picture
  ownWork?: boolean; // a ranking, deals list or other evergreen Short: no NEWS chip (SHORT_LABELS_CLEAN)
  vivid?: boolean; // SHORT_VIVID: a lighter scrim and vignette
  clean?: boolean; // the clean frame (src/render/cleanframe.ts): full-bleed, one overlay at a time, a small mark
  mascot?: boolean; // Pip the mascot test: the amber mascot in the brand band, beside the logo
  chrono?: boolean; // a series in release order (src/editorial/everygame.ts): rank cards show the year in the badge
  heroCut?: { fg: string; x?: number }; // the new-look opening: the hero art's subject cut out (src/render/parallax.ts)
  seriesCover?: import("./seriesstrip.ts").SeriesCover; // SERIES_COVER_STYLE=strip: the series strip on the opening poster
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  durationSeconds: number;
  variant: number;
  renderDate: string; // ISO date the Short is made on (passed in, never read from a clock in the composition)
  quotes?: ShortQuote[]; // CHARACTER_QUOTES: the game's own lines, played in the silences the narration left for them
  gameBed?: import("./gamebed.ts").GameBed; // GAME_AUDIO_BED: the footage's own sound under the voice (src/assets/gameaudio.ts)
  reply?: { handle: string; text: string }; // COMMENT_REPLY_SHORTS: the viewer's comment shown as a card over the opening
  shape?: import("./untemplate.ts").ShortShape; // SHORT_LAYOUTS: how the Short opens and closes; absent, today's card at both ends
  /** PEOPLE_INSETS (src/render/people.ts): each named person's licensed photo, on the word that names them. */
  people?: import("./people.ts").PersonInset[];
  /** PEOPLE_INSETS: the tracklist card of a soundtrack story; its line's own card gives way to it. */
  tracklist?: import("./people.ts").TracklistPlacement;
  /** MENTION_* (src/render/mentions.ts): the mention insets, scheduled on their words; each stands in for its beat's card. */
  mentions?: import("./mentions.ts").MentionSlot[];
  /**
   * SHORT_* upgrades (src/render/shortupgrades.ts): the game map, the 3D podium, the compare wipe, the depth type, the
   * orbit, the game's look and the 3D box. The render step turns the map's and the clips' files into URLs.
   */
  upgrades?: import("./shortupgrades.ts").ShortUpgrades;
  /** EVIDENCE_STYLE (src/evidencestyle.ts): the evidence board's cards, stamps and board windows. Absent: as before. */
  board?: import("./evidenceboard.ts").EvidenceBoardPlan;
};

/** A character quote's clip on the Short's timeline (src/render/components/QuoteMoment.tsx). */
export interface ShortQuote {
  src: string;
  /** Seconds into the Short, and how long the clip plays. */
  start: number;
  seconds: number;
  speaker: string;
  text: string;
  credit: string;
  mode: "bleed" | "framed";
  /** GAME_SPEECH_DIALOGUE: the music bed's level under the character, as a share of its level (default 0.45). */
  bedUnder?: number;
}

export const SAMPLE_PROPS: ShortProps = {
  headline: "Starfield Expansion Slips To 2027",
  storyType: "delay",
  gameTitle: "Starfield",
  gameSubtitle: "BETHESDA · 2023",
  isRumour: false,
  attribution: "Source: Xbox Wire / IGN",
  footageCredit: "",
  segments: [
    { kind: "hook", text: "Starfield's second expansion has slipped from this December to early twenty twenty seven.", start: 0, end: 4.2 },
    { kind: "beat", text: "Bethesda now says the expansion lands in March, three months later than planned.", start: 4.2, end: 8.4, visual: { kind: "timeline", primary: "Expansion window", secondary: "", date_from: "2026-12", date_to: "2027-03" } },
    { kind: "beat", text: "The price holds at twenty nine ninety nine, down from the thirty four ninety nine first listed.", start: 8.4, end: 12.6, visual: { kind: "price", primary: "£29.99", secondary: "expansion price", was: "£34.99", region: "UK" } },
    { kind: "beat", text: "The base game still sits at a seventy two on Metacritic across the big outlets.", start: 12.6, end: 16.4, visual: { kind: "score", primary: "72", secondary: "Metacritic", value_a: 72, items: ["IGN", "GameSpot", "Eurogamer"] } },
    { kind: "beat", text: "On Steam it is still pulling more players than Outer Worlds two and Avowed combined.", start: 16.4, end: 20.6, visual: { kind: "compare", primary: "Playing on Steam now", secondary: "", items: ["*Starfield:4,088", "Outer Worlds 2:1,950", "Avowed:1,420"] } },
    { kind: "beat", text: "Bethesda has pencilled the new date for the fourteenth of March.", start: 20.6, end: 24.2, visual: { kind: "countdown", primary: "14 March 2027", secondary: "new date", date_to: "2027-03-14" } },
    { kind: "take", text: "Our read: a three month slip on a project this size is not a red flag yet.", start: 24.2, end: 28.6, label: "OUR READ", visual: { kind: "title", primary: "Not a red flag yet", secondary: "" } },
    { kind: "loop", text: "And the new date to remember is March twenty twenty seven.", start: 28.6, end: 31.5 },
  ],
  words: [],
  images: [],
  clips: [],
  steam: { currentPlayers: 4088, positivePercent: 72, totalReviews: 180000, price: "£29.99" },
  emphasis: ["starfield", "march", "2027"],
  plan: null,
  logoSrc: "logo.png",
  audioSrc: null,
  musicSrc: "music_2.mp3",
  durationSeconds: 31.5,
  variant: 0,
  renderDate: "2026-10-17",
};
