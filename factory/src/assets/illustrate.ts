// Concept sketches for the documentary lines nothing filmed can show. After the sentence top-up
// (src/assets/fill.ts) about a fifth of a documentary's screen time is still lines about meetings, decisions,
// offices and a studio's early days: things never photographed. This module draws them on this PC's own
// image model (FLUX.1 dev through ComfyUI, the server other projects on the machine already use) as an honest
// pencil-and-ink "concept sketch", styled so it reads as an illustration and never as a photograph, and tagged
// ILLUSTRATION on screen like the graphic cards. Only real-world scene lines qualify (people, a place, an
// action); figures, abstractions, named real people and sensitive subjects never do. Seeds come from the
// episode and sentence so a re-run draws the same picture. ILLUSTRATE_STUB=true draws a plain placeholder
// without the model, so tests and dry runs work on a PC whose GPU is spoken for.

import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { fetchWithTimeout, log } from "../lib/util.ts";
import type { Llm } from "../editorial/llm.ts";
import { rankStills } from "./stillscore.ts";

export const SKETCH_WIDTH = 1280;
export const SKETCH_HEIGHT = 720;
export const SKETCH_KIND = "sketch";

/** The fixed look: a sketch, never a photo, with nothing readable and nobody recognisable. */
export const STYLE_SUFFIX =
  "Pencil and ink concept sketch on cream paper, loose confident linework with light ink wash and soft graphite shading, muted palette, a documentary storyboard drawing. No text, no letters, no logos, no readable signage, no recognisable real faces: figures drawn small or turned away, faces simplified.";

export const NEGATIVE_PROMPT =
  "photograph, photo, photorealistic, realistic skin, 3d render, video game screenshot, HUD, text, letters, words, numbers, logo, watermark, signature, signage, caption, subtitle, real person, celebrity, likeness, recognisable face, portrait, blood, weapon, gore, nudity, neon, saturated colours";

/** What fill.ts knows about a sentence; the writer's notes decide most of what qualifies. */
export interface SketchMoment {
  show: string;
  person?: string;
  broll?: string;
  graphic?: { kind: string; items?: string[] };
}

export interface SketchChapter {
  game: string;
  year?: number;
  /** The real place the chapter's story happens in, when known (a studio's city); period detail for the prompt. */
  place?: string;
}

// The writer's "show" note names a real-world scene a sketch can draw: a room, a building, people at work, a
// journey. Game-world lines (a mission, a character, the game's city) are left to the game's own art and footage.
const SCENE_CUE =
  /\b(office|offices|room|rooms|studio|studios|building|headquarters|warehouse|flat|apartment|garage|desk|desks|house|boardroom|meeting|meetings|team|founders?|staff|employees?|developers?|programmers?|artists?|designers?|testers?|crew|workshop|shop|basement|bedroom|kitchen|pub|bar|cafe|train|plane|flight|airport|car park|conference|trade show|booth|factory|plant|printing|manufacturing|boxes|shelves|fax|telephone|phones?|computers?|monitors?|whiteboard|corridor|hallway|campus|university|school|lab|laboratory|night shift|late nights?|crunch|move|moved|moving|relocat\w*|rent\w*|hired|hiring|interview\w*|founded|gathered|crammed|huddled|packed|sat|stood|walked|drove|flew|arrived|visited|travelled|traveled|toured|research trip|worked|working|argued|negotiat\w*|presented|pitched|demo\w*|sketch\w*|drew|drawing|storyboard\w*|prototype\w*|scrapped|rebuilt)\b/i;

// The sensitive-line rule of fill.ts (controversy, violence, crime, race, a lawsuit, a tragedy): those lines
// take a neutral real shot or nothing, never a drawing of the event.
const SENSITIVE =
  /\b(lawsuit|lawsuits|sued|suing|court|courtroom|trial|judge|verdict|settlement|murder\w*|kill\w*|shoot\w*|shot|stabb\w*|violen\w*|assault\w*|rape|racis\w*|racial|race riot|african americans?|discriminat\w*|protest\w*|objection|controvers\w*|scandal\w*|tragedy|tragic|died|death|deaths|dead|suicide|overdos\w*|drugs?|cocaine|heroin|crime|crimes|criminal\w*|gang\w*|gun|guns|weapon\w*|hot coffee|sex\w*|strip club|prostitut\w*|porn\w*|harass\w*|abuse\w*|terror\w*|bomb\w*|war|hostage|arrest\w*|police raid|prison|jail)\b/i;

// A figure, a share, a score, a price or a headcount: a line for a graphic card, not a drawing.
const STATISTICAL =
  /(\d[\d,.]*\s*(million|billion|thousand|percent|per cent|copies|units|players|subscribers|dollars|pounds|euros)|[$£€]\s?\d|\d+(\.\d+)?\s*(out of|\/)\s*10|\b\d{1,3}(,\d{3})+\b|\b\d+\s*%|\b\d+(?:\s+[A-Z]\w+){0,3}\s+(people|person|staff|employees|developers|testers|members|workers)\b|\b(grew|rose|fell|went)\s+(to|from)\s+\d|\bnumbered\s+\d)/i;

// A shot note that asks for the game itself, hardware, a brand or a chart: those have real pictures (official
// art, Commons photos, the graphic cards), and a drawing of them would be a fake, not an illustration.
const NOT_A_SCENE =
  /\b(gameplay|screenshot|screenshots|footage|trailer|cutscene|in-game|ingame|console|controller|handheld|cartridge|disc|logo|logos|chart|charts|graph|cover art|box art|key art|menu|silhouette|mascot|character|characters|hero|protagonist|monster|brand|headline|newspaper|magazine|website|screen recording)\b/i;

// Words that look like a person's name but are a place, a studio or a game.
const NOT_A_NAME =
  /^(Grand|Theft|Auto|Rockstar|Vice|San|Liberty|Take|Red|Dead|DMA|Design|North|South|East|West|New|Los|Las|Max|Sony|Electronic|Square|Silicon|Valley|Space|Station|Phantasy|Star|Online|Ocean|Drive|Santos|Andreas|City|York|Miami|Dundee|Edinburgh|Scotland|England|London|Leeds|Glasgow)$/;

/** A line whose subject is a named person: a drawing of their face is never acceptable. */
export function namesPerson(sentence: string, m: SketchMoment): boolean {
  if (m.person && m.person.trim().split(/\s+/).length >= 2) return true;
  if (/\b(portrait|headshot|face|close-?up)\s+of\s+[A-Z]/.test(m.show))
    return true;
  // "Firstname Surname said/was/had ..." at the heart of the line, not a studio or game title.
  const named = sentence.match(
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?)\s+(said|says|told|was|were|had|has|wanted|decided|became|thought|believed|insisted|remembers|recalls|argued|refused|quit|left|joined|flew|moved)\b/,
  );
  if (named && !NOT_A_NAME.test(named[1]!) && !NOT_A_NAME.test(named[2]!))
    return true;
  // The shot note puts a named person in the picture: "Sam Houser at his desk".
  const shown = m.show.match(
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(at|in|with|and|talking|sitting|standing|working|speaking|on stage|presenting)\b/,
  );
  if (shown && !NOT_A_NAME.test(shown[1]!) && !NOT_A_NAME.test(shown[2]!))
    return true;
  return false;
}

/**
 * Whether a sentence may be drawn: bare (no picture or clip of its own, no graphic), a real-world scene the
 * writer's shot note or stock note describes (people, a place, an action), not the game or hardware, not a
 * figure, not a named person's face, not a sensitive subject.
 */
export function illustratable(
  sentence: string,
  m: SketchMoment,
  covered = false,
): boolean {
  if (covered) return false;
  if (m.graphic && m.graphic.kind !== "none") return false;
  const text = sentence.trim();
  if (text.split(/\s+/).length < 6) return false;
  if (SENSITIVE.test(text) || SENSITIVE.test(m.show)) return false;
  if (STATISTICAL.test(text)) return false;
  if (namesPerson(text, m)) return false;
  if (NOT_A_SCENE.test(m.show)) return false;
  // The scene is the writer's: the shot note must describe one; a sentence that merely mentions "the team"
  // while talking about the game stays on the game's footage.
  return SCENE_CUE.test(m.show);
}

/** The sentence as plain words: no quotes, dashes or the narrator's joining word. */
export function sceneOf(sentence: string): string {
  const s = sentence
    .replace(/["“”]/g, "")
    .replace(/\s+-\s+|\s*[–—]\s*/g, ", ")
    .replace(/^(and|but|so|then|now|yet|because)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The positive and negative prompts for one sentence: the writer's shot note is the scene, the sentence its
 * context, then the chapter's place and year for period detail and the fixed style.
 */
export function sketchPrompt(
  sentence: string,
  chapter: SketchChapter,
  show?: string,
): { prompt: string; negative: string } {
  const note = (show ?? "").trim().replace(/[.!?]+$/, "");
  const scene = note
    ? `${note.charAt(0).toUpperCase()}${note.slice(1)}. The moment: ${sceneOf(sentence)}.`
    : `${sceneOf(sentence)}.`;
  const when = chapter.year ? `around ${chapter.year}` : "";
  const where = chapter.place ? `in ${chapter.place}` : "";
  const period = [where, when].filter(Boolean).join(", ");
  const parts = [
    `Concept sketch of a scene: ${scene}`,
    period
      ? `Setting: ${period}; clothes, furniture and technology of that time.`
      : "",
    STYLE_SUFFIX,
  ].filter(Boolean);
  return { prompt: parts.join(" "), negative: NEGATIVE_PROMPT };
}

/** A seed from the episode and the sentence (FNV-1a), so a re-run draws the same picture. */
export function sketchSeed(episodeId: string, sentence: string): number {
  const key = `${episodeId}|${sentence
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
}

export interface IllustrateOptions {
  dest: string;
  seed: number;
  negative?: string;
  /** The ComfyUI server; ILLUSTRATE_URL. */
  url?: string;
  /** Queue, draw and download within this; ILLUSTRATE_TIMEOUT_SECONDS. */
  timeoutMs?: number;
  /** A placeholder PNG instead of the model; ILLUSTRATE_STUB. */
  stub?: boolean;
}

export const DEFAULT_ILLUSTRATE_URL = "http://127.0.0.1:8188";
const POLL_MS = 2000;
const WORKFLOW_FILE = new URL("./illustrate.workflow.json", import.meta.url);

/** The workflow with the prompt, negative and seed substituted (nodes 6, 7 and 3; see the JSON's comment). */
export async function sketchWorkflow(
  prompt: string,
  negative: string,
  seed: number,
): Promise<
  Record<string, { class_type: string; inputs: Record<string, unknown> }>
> {
  const wf = JSON.parse(await fs.readFile(WORKFLOW_FILE, "utf8")) as Record<
    string,
    unknown
  >;
  delete wf._comment;
  const nodes = wf as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  nodes["6"]!.inputs.text = prompt;
  nodes["7"]!.inputs.text = negative;
  nodes["3"]!.inputs.seed = seed;
  return nodes;
}

/**
 * Draws one sketch to opts.dest (PNG) and returns its path. Posts the workflow to ComfyUI, waits for it in
 * the history and downloads the first image it made; a job past the timeout is dropped from the queue.
 */
export async function illustrate(
  prompt: string,
  opts: IllustrateOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(opts.dest), { recursive: true });
  if (opts.stub) {
    await fs.writeFile(opts.dest, placeholderPng(opts.seed));
    return opts.dest;
  }
  const url = (opts.url ?? DEFAULT_ILLUSTRATE_URL).replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  const workflow = await sketchWorkflow(
    prompt,
    opts.negative ?? NEGATIVE_PROMPT,
    opts.seed,
  );
  const clientId = `pulse-sketch-${process.pid}`;
  const queued = await fetchWithTimeout(
    `${url}/prompt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    },
    30_000,
  );
  if (!queued.ok)
    throw new Error(
      `comfyui ${queued.status}: ${(await queued.text()).slice(0, 300)}`,
    );
  const { prompt_id: id } = (await queued.json()) as { prompt_id: string };
  if (!id) throw new Error("comfyui gave no prompt id");
  let outputs:
    | Record<
        string,
        {
          images?: Array<{ filename: string; subfolder: string; type: string }>;
        }
      >
    | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetchWithTimeout(`${url}/history/${id}`, {}, 30_000);
    if (!res.ok) continue;
    const hist = (await res.json()) as Record<
      string,
      {
        outputs?: typeof outputs;
        status?: {
          status_str?: string;
          completed?: boolean;
          messages?: unknown[];
        };
      }
    >;
    const entry = hist[id];
    if (!entry) continue;
    if (entry.status?.status_str === "error")
      throw new Error(
        `comfyui job failed: ${JSON.stringify(entry.status.messages ?? []).slice(0, 300)}`,
      );
    if (entry.outputs) {
      outputs = entry.outputs;
      break;
    }
  }
  if (!outputs) {
    // Drop it so a slow job never keeps the GPU after we stopped waiting for it.
    await fetchWithTimeout(
      `${url}/queue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [id] }),
      },
      10_000,
    ).catch(() => undefined);
    // Only our own job: a bare /interrupt stops whatever is running, another project's job included.
    await fetchWithTimeout(
      `${url}/interrupt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt_id: id }),
      },
      10_000,
    ).catch(() => undefined);
    throw new Error(
      `comfyui job ${id} took longer than ${Math.round(timeoutMs / 1000)}s`,
    );
  }
  const image = Object.values(outputs).flatMap((o) => o.images ?? [])[0];
  if (!image) throw new Error("comfyui job made no image");
  const q = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  const file = await fetchWithTimeout(
    `${url}/view?${q}`,
    {},
    Math.max(10_000, deadline - Date.now()),
  );
  if (!file.ok) throw new Error(`comfyui view ${file.status}`);
  await fs.writeFile(opts.dest, Buffer.from(await file.arrayBuffer()));
  return opts.dest;
}

/**
 * A cream "paper" PNG with a few seeded pencil strokes: what the stub draws instead of the model. Written by
 * hand (signature, IHDR, one deflated IDAT, IEND) because the factory carries no image library.
 */
export function placeholderPng(
  seed: number,
  width = SKETCH_WIDTH,
  height = SKETCH_HEIGHT,
): Buffer {
  const row = Buffer.alloc(width * 3 + 1);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const paper = [0xf1, 0xea, 0xd8];
  const ink = [0x5a, 0x55, 0x50];
  // Strokes: a handful of diagonal bands whose angle and spacing come from the seed.
  const angle = 0.4 + (seed % 7) * 0.15;
  const gap = Math.max(
    8,
    Math.round(Math.min(width, height) * (0.12 + (seed % 5) * 0.035)),
  );
  const thick = Math.max(2, Math.round(gap * (0.07 + (seed % 3) * 0.02)));
  const mx = Math.round(width * 0.05);
  const my = Math.round(height * 0.08);
  for (let y = 0; y < height; y++) {
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const d = (x + y * angle) % gap;
      const stroke =
        d < thick && y > my && y < height - my && x > mx && x < width - mx;
      const c = stroke ? ink : paper;
      const o = 1 + x * 3;
      row[o] = c[0]!;
      row[o + 1] = c[1]!;
      row[o + 2] = c[2]!;
    }
    row.copy(raw, y * row.length);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// The pass over a documentary: draw the qualifying bare sentences of each chapter, let the picture editor
// judge each sketch against its sentence, and pin the ones that pass as images of kind "sketch".

/** A picture as fill.ts stores it, plus what the render needs of a sketch. */
export interface SketchImage {
  file: string;
  kind: string;
  aspect?: number;
  sourceUrl?: string;
  provenance?: string;
  beatIndex?: number;
  moment?: number;
  label?: string;
}

export interface SketchChapterInput extends SketchChapter {
  entry: number;
  moments: SketchMoment[];
  sentences: string[];
}

export interface SketchSummary {
  asked: number; // sentences that qualified and were sent to the model
  drawn: number; // sketches the model returned
  kept: number; // sketches the judge passed and pinned
  dropped: number; // drawn but refused by the judge (under 0.5, text or a likeness)
  failed: number; // the model errored or timed out
  seconds: number;
}

export interface SketchRunOptions {
  llm: Llm;
  dir: string;
  episodeId: string;
  url: string;
  max: number;
  stub: boolean;
  timeoutMs: number;
  /** Test seam: the drawing function. */
  draw?: typeof illustrate;
}

export const SKETCH_PROVENANCE =
  "Concept sketch drawn by a local image model (FLUX.1 dev via ComfyUI) from the narration; an illustration, not a photograph";

/**
 * One run per documentary, shared across its chapters so the cap (ILLUSTRATE_MAX) holds for the whole video.
 * forChapter is the hook fill.ts calls between its picture search and the graphics pass.
 */
export function createSketchRun(opts: SketchRunOptions): {
  forChapter(
    ch: SketchChapterInput,
    bare: number[],
    images: SketchImage[],
  ): Promise<number>;
  summary(): SketchSummary;
} {
  const sum: SketchSummary = {
    asked: 0,
    drawn: 0,
    kept: 0,
    dropped: 0,
    failed: 0,
    seconds: 0,
  };
  const draw = opts.draw ?? illustrate;
  return {
    summary: () => ({ ...sum, seconds: Math.round(sum.seconds) }),
    async forChapter(ch, bare, images) {
      const left = opts.max - sum.asked;
      const want = bare
        .filter((k) =>
          illustratable(ch.sentences[k] ?? "", ch.moments[k] ?? { show: "" }),
        )
        .slice(0, Math.max(0, left));
      if (!want.length) return 0;
      const t0 = Date.now();
      const base = path.join(`entry_${ch.entry}`, "fill");
      const made: Array<{ k: number; file: string }> = [];
      // No place is guessed: the chapter's map graphic names where the story goes (Miami for Vice City), not
      // where the studio sits, and a wrong setting draws the wrong room. A caller that knows the place passes it.
      for (const k of want) {
        sum.asked++;
        const sentence = ch.sentences[k] ?? "";
        const { prompt, negative } = sketchPrompt(
          sentence,
          ch,
          ch.moments[k]?.show,
        );
        const file = path.join(base, `sketch_${k}.png`);
        try {
          await draw(prompt, {
            dest: path.join(opts.dir, file),
            seed: sketchSeed(opts.episodeId, sentence),
            negative,
            url: opts.url,
            timeoutMs: opts.timeoutMs,
            stub: opts.stub,
          });
          made.push({ k, file });
          sum.drawn++;
        } catch (err) {
          sum.failed++;
          log("warn", "sketch not drawn", {
            game: ch.game,
            sentence: k,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // The judge: each sketch against its own sentence; kept only when the editor picks that sketch for that
      // sentence with confidence 0.5 or more and sees no text (or a likeness, which the sketch mode counts as text).
      let kept = 0;
      if (made.length) {
        try {
          const ranked = await rankStills(
            opts.llm,
            made.map(({ k }) => ({
              key: `m${k}`,
              show: ch.moments[k]?.show ?? "",
              sentence: ch.sentences[k] ?? "",
            })),
            made.map(({ file }) => ({ file: path.join(opts.dir, file) })),
            path.join(opts.dir, base, `sketchscore_${ch.entry}`),
            undefined,
            "sketch",
          );
          made.forEach(({ k, file }, i) => {
            const ok =
              !ranked.withText.has(i) &&
              ranked.picks.some((p) => p.key === `m${k}` && p.image === i);
            if (!ok) {
              sum.dropped++;
              return;
            }
            images.push({
              file,
              kind: SKETCH_KIND,
              aspect: SKETCH_WIDTH / SKETCH_HEIGHT,
              sourceUrl: "",
              provenance: SKETCH_PROVENANCE,
              beatIndex: ch.entry,
              moment: k,
              label:
                ranked.labels.get(i) || `sketch: ${ch.moments[k]?.show ?? ""}`,
            });
            kept++;
            sum.kept++;
          });
        } catch (err) {
          // Without the judge nothing is pinned: an unchecked drawing is worse than the chapter's footage.
          sum.dropped += made.length;
          log("warn", "sketch judge failed; sketches left out", {
            game: ch.game,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      sum.seconds += (Date.now() - t0) / 1000;
      log("info", "sketches for bare sentences", {
        game: ch.game,
        asked: want.length,
        drawn: made.length,
        kept,
      });
      return kept;
    },
  };
}
