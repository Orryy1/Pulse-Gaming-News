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
  luma?: number;
  beatIndex?: number; // tagged for one entry of a ranking Short
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
}

// A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props constraint.
export type ShortProps = {
  headline: string;
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
  mascot?: boolean; // Pip the mascot test: the amber mascot in the brand band, beside the logo
  heroCut?: { fg: string; x?: number }; // the new-look opening: the hero art's subject cut out (src/render/parallax.ts)
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  durationSeconds: number;
  variant: number;
  renderDate: string; // ISO date the Short is made on (passed in, never read from a clock in the composition)
};

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
