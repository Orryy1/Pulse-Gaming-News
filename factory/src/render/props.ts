import type { Word } from "../voice/elevenlabs.ts";
import type { Segment } from "./timeline.ts";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export interface ShortImage {
  src: string;
  kind: string;
  aspect: number; // width / height
}

// A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props constraint.
export type ShortProps = {
  headline: string;
  storyType: string;
  gameTitle: string;
  isRumour: boolean;
  attribution: string;
  segments: Segment[];
  words: Word[];
  images: ShortImage[];
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  durationSeconds: number;
  variant: number;
};

export const STORY_THEME: Record<string, { chip: string; accent: string }> = {
  release_date: { chip: "RELEASE DATE", accent: "#FF6B1A" },
  delay: { chip: "DELAYED", accent: "#FF3B3B" },
  price: { chip: "PRICE", accent: "#FFC21A" },
  sales: { chip: "BY THE NUMBERS", accent: "#22C55E" },
  reveal: { chip: "REVEALED", accent: "#FF6B1A" },
  trailer: { chip: "NEW TRAILER", accent: "#FF6B1A" },
  update: { chip: "UPDATE", accent: "#38BDF8" },
  rumour: { chip: "RUMOUR", accent: "#FF3B3B" },
  industry: { chip: "INDUSTRY", accent: "#A78BFA" },
  other: { chip: "NEWS", accent: "#FF6B1A" },
};

export const BRAND = {
  primary: "#FF6B1A",
  ink: "#0B0B0E",
  text: "#F5F5F2",
  muted: "#A1A1AA",
  alert: "#FF3B3B",
};

export const SAMPLE_PROPS: ShortProps = {
  headline: "Silksong DLC Lands This December",
  storyType: "release_date",
  gameTitle: "Hollow Knight: Silksong",
  isRumour: false,
  attribution: "Source: Team Cherry / IGN",
  segments: [
    { kind: "hook", text: "Hollow Knight Silksong's first expansion lands on the eleventh of December.", start: 0, end: 3.6 },
    { kind: "beat", text: "It is free for everyone who owns the game.", start: 3.6, end: 6.4, visual: { kind: "stat", primary: "FREE", secondary: "for all owners" } },
    { kind: "beat", text: "Team Cherry says it adds a new region and twelve bosses.", start: 6.4, end: 10, visual: { kind: "list", primary: "New region | 12 bosses", secondary: "" } },
    { kind: "take", text: "Our read: after a seven-year wait for the base game, a four-month turnaround is a statement.", start: 10, end: 15.5, label: "OUR READ", visual: { kind: "title", primary: "A four-month turnaround", secondary: "" } },
    { kind: "loop", text: "And the date to remember is", start: 15.5, end: 17.5 },
  ],
  words: [],
  images: [],
  logoSrc: "logo.png",
  audioSrc: null,
  musicSrc: "music_2.mp3",
  durationSeconds: 17.5,
  variant: 0,
};
