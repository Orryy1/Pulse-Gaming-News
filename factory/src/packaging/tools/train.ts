// Builds the Packaging Lab's corpus and fits its model.
//   npx tsx src/packaging/tools/train.ts --yt <dir of yt-dlp channel listings> --vidiq <tsv> --pulse <export.json>
//        [--model src/packaging/model.default.json] [--report <dir>]
// The yt-dlp listings are `yt-dlp --flat-playlist -J https://www.youtube.com/channel/<id>/<shorts|videos>` dumps named
// <channel>_<shorts|videos>.json; the Pulse file is the factory's /routine/export?days=120. Writes the model, the
// corpus (corpus.json) and the backtest (backtest.json) into the report folder.
import fs from "node:fs";
import path from "node:path";
import {
  pulseRowsFromExport,
  studyRowsFromListing,
  studyRowsFromVidiq,
  type StudyRow,
} from "../corpus.ts";
import { trainImageModel, trainPackagingModel } from "../train.ts";
import { IMAGE_FEATURES, imageFeatures } from "../image.ts";

const arg = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const ytDir = arg("yt");
const vidiq = arg("vidiq");
const pulseFile = arg("pulse");
const modelFile = arg(
  "model",
  path.join("src", "packaging", "model.default.json"),
)!;
const report = arg("report", ".")!;
const thumbs = arg("thumbs");
if (!pulseFile) {
  console.error("--pulse <export.json> is required");
  process.exit(2);
}

const study: StudyRow[] = [];
if (ytDir)
  for (const f of fs.readdirSync(ytDir).filter((x) => x.endsWith(".json"))) {
    try {
      const listing = JSON.parse(fs.readFileSync(path.join(ytDir, f), "utf8"));
      study.push(
        ...studyRowsFromListing(
          listing,
          f.includes("_shorts") ? "short" : "long",
        ),
      );
    } catch {
      // an unreadable listing is skipped
    }
  }
if (vidiq) study.push(...studyRowsFromVidiq(fs.readFileSync(vidiq, "utf8")));
const pulse = pulseRowsFromExport(
  JSON.parse(fs.readFileSync(pulseFile, "utf8")),
);

const { model, reports, priors } = trainPackagingModel(
  study,
  pulse,
  new Date(),
);
fs.mkdirSync(report, { recursive: true });
// Thumbnails (and Shorts' first frames), when a folder of <videoId>.jpg files is given: features read at tile size.
let imageReports: unknown[] = [];
if (thumbs) {
  const feats = new Map<string, Record<string, number>>();
  const want = [
    ...study.map((r) => ({ id: r.id, format: r.format })),
    ...pulse.map((r) => ({ id: r.videoId, format: r.format })),
  ];
  for (const w of want) {
    const file = path.join(thumbs, `${w.id}.jpg`);
    if (feats.has(w.id) || !fs.existsSync(file)) continue;
    const f = await imageFeatures(file, w.format);
    if (f && Object.keys(f).length)
      feats.set(w.id, f as Record<string, number>);
  }
  const names = IMAGE_FEATURES.filter((k) => !k.startsWith("v_"));
  const r = trainImageModel(study, pulse, feats, names);
  (model as { image?: unknown }).image = r.image;
  imageReports = r.reports;
  fs.writeFileSync(
    path.join(report, "image_features.json"),
    JSON.stringify(Object.fromEntries(feats)),
  );
  for (const x of r.reports)
    console.log(
      `thumbs ${x.format}: prior held-out ${(x.priorAccuracy * 100).toFixed(1)}% (${x.priorRows} pictures)` +
        (x.pulse
          ? ` | Pulse ctr test ${x.pulse.test}: prior ${(x.pulse.prior * 100).toFixed(1)}% blended ${(x.pulse.blended * 100).toFixed(1)}%`
          : ""),
    );
}
fs.writeFileSync(modelFile, JSON.stringify(model, null, 1) + "\n");
fs.writeFileSync(
  path.join(report, "corpus.json"),
  JSON.stringify({ study, pulse }, null, 0),
);
fs.writeFileSync(
  path.join(report, "backtest.json"),
  JSON.stringify(
    { priors, reports, imageReports, blend: model.blend, top: model.meta },
    null,
    2,
  ),
);
const channels = new Set(study.map((r) => r.channel)).size;
console.log(
  `study rows ${study.length} from ${channels} channels/lists; Pulse rows ${pulse.length}`,
);
for (const [f, p] of Object.entries(priors))
  console.log(
    `prior ${f}: held-out channels pairwise ${(p.accuracy * 100).toFixed(1)}% over ${p.pairs} pairs (${p.rows} rows)`,
  );
for (const r of reports)
  console.log(
    `${r.format}/${r.head}: train ${r.train} test ${r.test} | prior ${(r.prior * 100).toFixed(1)}% pulse-only ${(r.pulseOnly * 100).toFixed(1)}% blended ${(r.blended * 100).toFixed(1)}% (rho ${r.spearman.toFixed(2)}, lambda ${r.lambda})`,
  );
console.log("blend", JSON.stringify(model.blend));
