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
}

export interface ShortClip {
  src: string;
  durationSeconds: number;
  blurSrc?: string | null;
  motion?: number;
  luma?: number;
  beatIndex?: number;
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
  plan: RenderPlan | null; // built in the pipeline; the composition builds one for previews
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  durationSeconds: number;
  variant: number;
};

export const SAMPLE_PROPS: ShortProps = {
  headline: "Silksong DLC Lands This December",
  storyType: "release_date",
  gameTitle: "Hollow Knight: Silksong",
  gameSubtitle: "TEAM CHERRY · 2025",
  isRumour: false,
  attribution: "Source: Team Cherry / IGN",
  footageCredit: "",
  segments: [
    {
      kind: "hook",
      text: "Hollow Knight Silksong's first expansion lands on the eleventh of December.",
      start: 0,
      end: 3.6,
    },
    {
      kind: "beat",
      text: "It is free for everyone who owns the game.",
      start: 3.6,
      end: 6.4,
      visual: { kind: "stat", primary: "FREE", secondary: "for all owners" },
    },
    {
      kind: "beat",
      text: "Team Cherry says it adds a new region and twelve bosses.",
      start: 6.4,
      end: 10,
      visual: {
        kind: "list",
        primary: "New region | 12 bosses",
        secondary: "",
      },
    },
    {
      kind: "take",
      text: "Our read: after a seven-year wait for the base game, a four-month turnaround is a statement.",
      start: 10,
      end: 15.5,
      label: "OUR READ",
      visual: {
        kind: "title",
        primary: "A four-month turnaround",
        secondary: "",
      },
    },
    {
      kind: "loop",
      text: "And the date to remember is",
      start: 15.5,
      end: 17.5,
    },
  ],
  words: [],
  images: [],
  clips: [],
  steam: {
    currentPlayers: 48213,
    positivePercent: 96,
    totalReviews: 120000,
    price: "£16.75",
  },
  emphasis: ["silksong", "december", "free"],
  plan: null,
  logoSrc: "logo.png",
  audioSrc: null,
  musicSrc: "music_2.mp3",
  durationSeconds: 17.5,
  variant: 0,
};
