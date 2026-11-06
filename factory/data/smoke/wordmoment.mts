// Previews the word-moment looks (src/render/components/wordmoment) on the PulseWord composition, as stills.
// node --import tsx data/smoke/wordmoment.mts <cases.json> <out dir>
// cases.json: [{ "name": "sticker_free", "look": "Sticker", "stamp": { "text": "FREE", "sub": "", "tone": "price" },
//   "frames": [6, 30], "picture": "entry_0/assets/hero_0.jpg", "variant": 0 }]
// The colour comes from the tone (src/render/brand.ts stampColour) unless the case gives one.
import { selectComposition, renderStill } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
import { getBundle, serveDir } from "../../src/render/render.ts";
import { stampColour } from "../../src/render/brand.ts";
import { STAMP_FRAMES } from "../../src/render/components/Stamp.tsx";

const [casesFile, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const EP = "C:/PulseFactory/factory/data/episodes/ep_20261026_52575f18";
const cases = JSON.parse(fs.readFileSync(casesFile!, "utf8")) as Array<Record<string, any>>;
fs.mkdirSync(out!, { recursive: true });
const srv = await serveDir(EP);
const url = (p?: string) => (p ? `${srv.url}/${p}` : undefined);
const serveUrl = await getBundle();
for (const c of cases) {
  const props = {
    look: c.look,
    stamp: { ...c.stamp, colour: c.stamp.colour ?? stampColour(c.stamp.tone) },
    picture: url(c.picture),
    durationSeconds: STAMP_FRAMES / 30,
    variant: c.variant ?? 0,
    guides: c.guides ?? true,
  };
  const composition = await selectComposition({ serveUrl, id: "PulseWord", inputProps: props });
  for (const f of c.frames ?? [6, 30])
    await renderStill({
      composition,
      serveUrl,
      output: path.join(out!, `${c.name}_${f}.png`),
      inputProps: props,
      frame: f,
      scale: 0.5,
      chromiumOptions: { gl: "angle" },
    });
  console.log("rendered", c.name);
}
await srv.close();
