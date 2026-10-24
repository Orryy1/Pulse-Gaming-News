import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

// Fonts ship in public/fonts (SIL OFL) so renders never depend on a font CDN.
export const DISPLAY = "PulseDisplay"; // Anton: glanced text
export const BODY = "PulseBody"; // Inter: read text

loadFont({
  family: DISPLAY,
  url: staticFile("fonts/anton-latin-400-normal.woff2"),
  weight: "400",
});
for (const w of ["600", "800", "900"]) {
  loadFont({
    family: BODY,
    url: staticFile(`fonts/inter-latin-${w}-normal.woff2`),
    weight: w,
  });
}
