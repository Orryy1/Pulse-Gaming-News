// Pulse universe pack, "evidence" (DOC_EVIDENCE, 1 Nov 2026): a documentary's key beat shown as the record itself,
// full frame (./PulseEvidence.tsx). These styles fit only graphics src/editorial/evidence.ts tagged as evidence, so
// the renderer's rotation never gives them to an ordinary quote; src/render/Long.tsx always picks them for a
// tagged graphic.
import type { GfxStyle } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import {
  PulseEvidence,
  fitsEvidenceAggregate,
  fitsEvidenceStatement,
} from "./PulseEvidence.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /** A statement the source quotes, word for word, with its issuer and the source credit. */
  EvidenceQuote: {
    kind: "quote",
    component: PulseEvidence,
    fits: fitsEvidenceStatement,
    sound: "stamp",
  },
  /** The source's own passage about a key beat (or an aggregator's verdict words), marked as the narrator says it. */
  EvidenceRecord: {
    kind: "source",
    component: PulseEvidence,
    fits: (g) => fitsEvidenceStatement(g) || fitsEvidenceAggregate(g),
    sound: "stamp",
  },
  /** The review aggregate's figures exactly as the source gives them. */
  EvidenceAggregate: {
    kind: "reviews",
    component: PulseEvidence,
    fits: fitsEvidenceAggregate,
    sound: "stamp",
  },
};

/** The evidence style for a tagged graphic, or undefined. */
export function evidenceStyle(g: MomentGraphic): GfxStyle | undefined {
  if (!g.evidence) return undefined;
  return Object.values(STYLES).find(
    (s) => s.kind === g.kind && (!s.fits || s.fits(g)),
  );
}
