// The in-game reconstruction area: the chooser (src/assets/recon.ts, reconFor) offers a candidate for a bare
// documentary sentence; the integration step ranks it against the other filler areas and, when it wins,
// shows the chosen clip through ReconShot with the candidate's scene tags, rate and the chapter's palette.
export { ReconShot, type ReconShotProps } from "./ReconShot.tsx";
export {
  BAR,
  RECON_TAG,
  SCOPE,
  barsAt,
  gameLine,
  poseAt,
  reconGrade,
  reconMove,
} from "../../reconplan.ts";

/** The treatments this area renders, by name, for the integration step's registry. */
export const RECON_TREATMENTS = ["scope"] as const;
export type ReconTreatment = (typeof RECON_TREATMENTS)[number];
