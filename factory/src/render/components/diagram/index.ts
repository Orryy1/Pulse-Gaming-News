// The explainer-diagram registry: every style by the name `diagramFor` puts on its candidate
// (./choose.ts), so the integration step renders `DIAGRAMS[candidate.style].component` with the
// candidate's data. The chooser and the fact derivations are re-exported for one import.
import type React from "react";
import type { DiagramStyle } from "./choose.ts";
import type { DiagramProps } from "./kit.tsx";
import {
  BeforeAfter,
  Flow,
  OrgChart,
  SplitScreen,
  Timeline,
} from "./styles.tsx";

export interface DiagramEntry {
  component: React.FC<DiagramProps>;
  /** One line for the logs and the owner. */
  label: string;
  /** Sound on entry, as the graphic packs name them. */
  sound?: "pop" | "glint" | "stamp";
  /** The frame by which the build is complete (every style is inside DRAWN_BY). */
  settled: number;
}

export const DIAGRAMS: Record<DiagramStyle, DiagramEntry> = {
  orgChart: {
    component: OrgChart,
    label: "org chart of the studios",
    sound: "pop",
    settled: 80,
  },
  timeline: {
    component: Timeline,
    label: "development timeline",
    sound: "glint",
    settled: 74,
  },
  split: {
    component: SplitScreen,
    label: "two efforts side by side",
    sound: "pop",
    settled: 92,
  },
  flow: {
    component: Flow,
    label: "a flow from one thing to the next",
    sound: "pop",
    settled: 90,
  },
  beforeAfter: {
    component: BeforeAfter,
    label: "before and after",
    sound: "pop",
    settled: 64,
  },
};

export {
  diagramFor,
  diagramVerdict,
  DIAGRAM_STYLES,
  type DiagramData,
  type DiagramStyle,
} from "./choose.ts";
export type { DiagramProps } from "./kit.tsx";
