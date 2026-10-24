// Brand tokens: colour and type. Every component reads from here so the
// channel looks the same in every Short. No neon, no gradients as colour.

export const COLOUR = {
  ink: "#0B0B0E", // plates and panels
  paper: "#F5F5F2", // primary text
  muted: "#B4B4BC", // labels (4.5:1 on ink)
  chrome: "#848180", // mono micro labels only
  amber: "#FF6B1A", // identity: present in every frame
  alert: "#FF3B3B", // delay, rumour, negative deltas
  verify: "#38BDF8", // LIVE, VERIFIED and live-data highlights only
  up: "#22C55E",
  down: "#FF3B3B",
  gold: "#FFC21A", // price archetype
  violet: "#8B5CF6", // industry and other
  sky: "#38BDF8", // update archetype
} as const;

/** Kept for existing imports; new code uses COLOUR. */
export const BRAND = {
  primary: COLOUR.amber,
  ink: COLOUR.ink,
  text: COLOUR.paper,
  muted: COLOUR.muted,
  alert: COLOUR.alert,
} as const;

/** Type ladder in px at 1080x1920. Anton for glanced text, Inter for read text. */
export const TYPE = {
  displayXL: 196,
  headline: 132,
  headlineLong: 112, // more than six words
  cardTitle: 100,
  caption: 80,
  chartValue: 60,
  label: 32,
  micro: 26, // nothing below this
  brand: 46,
  chip: 30,
} as const;

export const STORY_THEME: Record<
  string,
  { chip: string; accent: string; takeLabel: string }
> = {
  explainer: { chip: "THE WHY", accent: COLOUR.amber, takeLabel: "OUR VERDICT" },
  release_date: {
    chip: "RELEASE DATE",
    accent: COLOUR.amber,
    takeLabel: "WHY IT MATTERS",
  },
  delay: { chip: "DELAYED", accent: COLOUR.alert, takeLabel: "WHAT IT MEANS" },
  price: { chip: "PRICE", accent: COLOUR.gold, takeLabel: "THE MATHS" },
  sales: {
    chip: "BY THE NUMBERS",
    accent: COLOUR.up,
    takeLabel: "THE CONTEXT",
  },
  reveal: {
    chip: "REVEALED",
    accent: COLOUR.amber,
    takeLabel: "TRAILER TRUTH",
  },
  trailer: {
    chip: "NEW TRAILER",
    accent: COLOUR.amber,
    takeLabel: "TRAILER TRUTH",
  },
  update: { chip: "UPDATE", accent: COLOUR.sky, takeLabel: "PATCH PULSE" },
  rumour: { chip: "RUMOR", accent: COLOUR.alert, takeLabel: "WHAT WE KNOW" },
  review_scores: {
    chip: "REVIEWS ARE IN",
    accent: COLOUR.amber,
    takeLabel: "THE VERDICT",
  },
  hardware: {
    chip: "HARDWARE",
    accent: COLOUR.amber,
    takeLabel: "PLATFORM PULSE",
  },
  industry: { chip: "INDUSTRY", accent: COLOUR.violet, takeLabel: "THE BIG PICTURE" },
  other: { chip: "NEWS", accent: COLOUR.amber, takeLabel: "THE TAKEAWAY" },
};

export function themeFor(
  storyType: string,
  isRumour: boolean,
): { chip: string; accent: string; takeLabel: string } {
  const t = STORY_THEME[isRumour ? "rumour" : storyType] ?? STORY_THEME.other!;
  return isRumour ? { ...t, accent: COLOUR.alert } : t;
}
