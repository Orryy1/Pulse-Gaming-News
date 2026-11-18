// The reviewer-readiness pack (upgrade queue item 20, from the 11 Nov niche research, changes 23 to 25). Partner
// Programme reviewers read the About section, titles, thumbnails and descriptions as well as the newest and most-viewed
// videos. YouTube says a disclosure label "alone won't limit a video's audience" while repeated failure to label
// realistic synthetic content can bring suspension; the fake-trailer channels were terminated for "spam and misleading
// metadata". Anything AI-made that could pass as real GTA VI material is the highest-risk asset on the channel.
//
// Behind REVIEWER_PACK (off by default):
// - the standard AI line, worded once here, closes every description (the gameplay lane's no-voice line stays true to it);
// - one sources link per video on the Pulse website, /sources/<id tail>: the article's sources, or a short page of its own
//   for a video with no article (a cut from a long video);
// - three private records per upload in DATA_DIR/records/<episode id>/: production.json (what the factory did, in
//   order), footage.json (every clip and picture, where it came from and for how long) and claims.json (the claims
//   and the fact check's warnings). Never served, never uploaded.
// Behind AI_IMAGE_GATE (off by default): every AI-made picture (the concept sketches and their animated clips) is shown
// to the free local vision model before it can stay, and one that reads as a photograph, a game screenshot, key art
// or box art is dropped, so nothing AI-made can pass as official game material. The altered-content flag is ticked
// whenever an AI voice or a kept AI picture is in the video (syntheticMediaFor).
// Pure functions first; the file and model calls at the end.

import fs from "node:fs/promises";
import path from "node:path";
import type { Script } from "./editorial/schema.ts";
import { errorMessage, fetchWithTimeout, log } from "./lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
  visionModelProblem,
} from "./assets/localvision.ts";

/** The standard AI line: what is AI, what is checked and what the pictures are. */
export const AI_LINE =
  "How this video is made: the script is written with AI assistance from the sources listed and checked against them, and the narration is an AI-generated synthetic voice. Pictures are official publisher material and our own gameplay, credited; any AI-made illustration is labelled ILLUSTRATION on screen.";

/** The disclosure line for a video (pure): the standard line, or the gameplay lane's own true lines. */
export function disclosureLine(
  script: Pick<Script, "gameplay" | "game_title">,
): string {
  if (script.gameplay?.direct)
    return `Gameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. ${AI_LINE}`;
  if (script.gameplay)
    return `Gameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. No AI voice: the sound is the game's own.`;
  return AI_LINE;
}

/** The video's sources page on the website (pure): the episode id's tail finds it. */
export function sourcesUrl(siteBase: string, episodeId: string): string {
  return `${siteBase.replace(/\/$/, "")}/sources/${episodeId.split("_").pop()}`;
}

/** The description line that points to it. */
export function sourcesLine(siteBase: string, episodeId: string): string {
  return `Sources and notes for this video: ${sourcesUrl(siteBase, episodeId)}`;
}

/** True for a description that carries the pack (pure): the AI line and a sources link. The weekly share counts these. */
export function hasReviewerPack(description: string): boolean {
  return description.includes("AI-generated synthetic voice") ||
    /No AI voice/.test(description)
    ? /\/sources\/[A-Za-z0-9]+/.test(description)
    : false;
}

// ---------------------------------------------------------------- records

export interface RecordEpisode {
  id: string;
  lane?: string | null;
  youtube_video_id?: string | null;
  script_json?: Script | null;
  story_json?: {
    headline?: string;
    items?: Array<{ source: string; url: string }>;
  } | null;
  assets_json?: {
    clips?: Array<{
      file: string;
      provenance: string;
      sourceUrl?: string;
      durationSeconds?: number;
    }>;
    images?: Array<{
      file: string;
      kind: string;
      provenance?: string;
      sourceUrl?: string;
    }>;
  } | null;
  factcheck_json?: { warnings?: string[]; sources?: string[] } | null;
}

export interface ProductionEvent {
  kind: string;
  at: string;
  detail?: unknown;
}

const AI_PICTURE = /local image model|local video model|concept sketch/i;

/** The three private records for one video (pure). */
export function buildRecords(
  ep: RecordEpisode,
  events: readonly ProductionEvent[],
  at: Date,
) {
  const script = ep.script_json;
  const clips = ep.assets_json?.clips ?? [];
  const images = ep.assets_json?.images ?? [];
  return {
    production: {
      episode: ep.id,
      lane: ep.lane ?? null,
      video: ep.youtube_video_id ?? null,
      title: script?.youtube?.title ?? ep.story_json?.headline ?? "",
      written_at: at.toISOString(),
      steps: events.map((e) => ({
        at: e.at,
        kind: e.kind,
        detail: e.detail ?? null,
      })),
    },
    footage: {
      episode: ep.id,
      clips: clips.map((c) => ({
        file: c.file,
        seconds: Math.round((c.durationSeconds ?? 0) * 10) / 10,
        source: c.sourceUrl ?? "",
        provenance: c.provenance,
        ai_made: AI_PICTURE.test(c.provenance),
      })),
      pictures: images.map((i) => ({
        file: i.file,
        kind: i.kind,
        source: i.sourceUrl ?? "",
        provenance: i.provenance ?? "",
        ai_made: i.kind === "sketch" || AI_PICTURE.test(i.provenance ?? ""),
      })),
      clip_seconds:
        Math.round(
          clips.reduce((a, c) => a + (c.durationSeconds ?? 0), 0) * 10,
        ) / 10,
    },
    claims: {
      episode: ep.id,
      rumour: Boolean(script?.is_rumour),
      claims: script?.claims ?? [],
      sources: [
        ...(ep.story_json?.items ?? []).map((i) => i.url),
        ...(script?.sources ?? []),
        ...(ep.factcheck_json?.sources ?? []),
      ].filter((u, i, all) => u && all.indexOf(u) === i),
      fact_check_warnings: ep.factcheck_json?.warnings ?? [],
    },
  };
}

/** Writes the records to DATA_DIR/records/<id>/ (private: the website never serves the data folder). */
export async function writeRecords(
  dataDir: string,
  ep: RecordEpisode,
  events: readonly ProductionEvent[],
  at: Date,
): Promise<string> {
  const dir = path.join(dataDir, "records", ep.id);
  await fs.mkdir(dir, { recursive: true });
  const r = buildRecords(ep, events, at);
  await Promise.all(
    (["production", "footage", "claims"] as const).map((k) =>
      fs.writeFile(path.join(dir, `${k}.json`), JSON.stringify(r[k], null, 2)),
    ),
  );
  return dir;
}

// ---------------------------------------------------------------- AI pictures and the altered-content flag

/** True when the video keeps an AI-made picture or clip (pure). */
export function hasAiPicture(assets: RecordEpisode["assets_json"]): boolean {
  return (
    (assets?.images ?? []).some(
      (i) => i.kind === "sketch" || AI_PICTURE.test(i.provenance ?? ""),
    ) || (assets?.clips ?? []).some((c) => AI_PICTURE.test(c.provenance))
  );
}

/** The altered-content flag (pure): the AI voice's setting, or ticked anyway when a kept AI picture is in the video. */
export function syntheticMediaFor(
  voiceFlag: boolean,
  assets: RecordEpisode["assets_json"],
  gate: boolean,
): boolean {
  return voiceFlag || (gate && hasAiPicture(assets));
}

export interface AiImageLook {
  sketch: boolean; // reads as a drawing or illustration
  photoreal: boolean; // reads as a photograph or a realistic 3D render
  official: boolean; // could pass as a game screenshot, HUD, key art, box art or a publisher's promotional image
}

/** Why an AI picture may not stay, or undefined (pure). Unscreened: it may not stay either (fail closed). */
export function aiImageProblem(l: AiImageLook | undefined): string | undefined {
  if (!l) return "not screened";
  if (l.official) return "could pass as official game material";
  if (l.photoreal) return "reads as a photograph";
  if (!l.sketch) return "does not read as an illustration";
  return undefined;
}

/** The model's answer read into a look (pure). */
export function aiImageLookAnswer(parsed: any): AiImageLook | undefined {
  if (
    !parsed ||
    ["sketch", "photoreal", "official"].some(
      (k) => typeof parsed[k] !== "boolean",
    )
  )
    return undefined;
  return {
    sketch: parsed.sketch,
    photoreal: parsed.photoreal,
    official: parsed.official,
  };
}

const PROMPT = `You check one AI-made picture before it appears in a YouTube video about video games. Answer with JSON.
sketch: true when it clearly reads as a drawing or illustration (pencil, ink, wash, a storyboard sketch).
photoreal: true when it could be mistaken for a photograph or a realistic 3D render.
official: true when it could be mistaken for a real video game screenshot, a game's HUD or menu, key art, box art, a logo or a publisher's promotional image.`;

const SCHEMA = {
  type: "object",
  properties: {
    sketch: { type: "boolean" },
    photoreal: { type: "boolean" },
    official: { type: "boolean" },
  },
  required: ["sketch", "photoreal", "official"],
};

/** One picture through the free local model; undefined when it cannot judge. */
export async function lookAiImage(
  file: string,
): Promise<AiImageLook | undefined> {
  if (process.env.NODE_TEST_CONTEXT || process.env.LOCAL_VISION === "off")
    return undefined;
  if (await visionModelProblem()) return undefined;
  try {
    const image = (await fs.readFile(file)).toString("base64");
    const res = await fetchWithTimeout(
      `${LOCAL_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: LOCAL_VISION_MODEL,
          stream: false,
          think: false,
          format: SCHEMA,
          keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "20s",
          options: {
            temperature: 0,
            num_predict: 80 + THINK_ROOM,
            num_ctx: 8192,
          },
          messages: [{ role: "user", content: PROMPT, images: [image] }],
        }),
      },
      90_000,
    );
    if (!res.ok) return undefined;
    return aiImageLookAnswer(
      visionAnswer(
        (await res.json()) as {
          message?: { content?: string; thinking?: string };
        },
      ),
    );
  } catch (err) {
    log("warn", "AI picture check failed", { file, error: errorMessage(err) });
    return undefined;
  }
}

/**
 * AI_IMAGE_GATE: every AI-made picture screened, the failing ones taken out of `images` in place. An unscreened one
 * goes too: the relay being down never lets a picture through. Returns what was dropped and why.
 */
export async function gateAiImages<
  T extends { file: string; kind: string; provenance?: string },
>(
  images: T[],
  dir: string,
  look: (file: string) => Promise<AiImageLook | undefined> = lookAiImage,
): Promise<Array<{ file: string; problem: string }>> {
  const dropped: Array<{ file: string; problem: string }> = [];
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i]!;
    if (img.kind !== "sketch" && !AI_PICTURE.test(img.provenance ?? ""))
      continue;
    const problem = aiImageProblem(await look(path.join(dir, img.file)));
    if (!problem) continue;
    dropped.unshift({ file: img.file, problem });
    images.splice(i, 1);
  }
  return dropped;
}
