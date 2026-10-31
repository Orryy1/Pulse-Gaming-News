// Codex in place of Claude for the steps that run well ahead of a slot. The owner's ChatGPT plan carries a
// weekly Codex allowance that is lost if unused, so routine text work (documentary chapters, evergreen
// scripts, long-video titles) can go there at no API cost. The PC orchestrator's codex_runner.py does the
// calling; this module turns one structured() call into a prompt plus a JSON Schema file, runs the Python
// helper, validates the answer with the same Zod schema, and falls back to Claude on any failure, so a
// Codex outage can never stop a video. Nothing is routed unless CODEX_LLM is on and the step's site is in
// CODEX_CALLS; the news lane's Short writing stays on Claude because it sits on a slot's critical path and
// Codex takes seconds to minutes.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { log } from "../lib/util.ts";
import {
  jobOf,
  recordUsage,
  type Llm,
  type LlmContent,
  type StructuredOptions,
  type Tier,
} from "./llm.ts";

export type CodexKind = "quick" | "bulk" | "code" | "review" | "frontier";

/** What one Codex run is asked to do; the runner (real or a test double) answers with the raw text. */
export interface CodexRequest {
  prompt: string;
  kind: CodexKind;
  /** Path of a JSON Schema file the answer must match. */
  schema?: string;
  /** Image files to attach (vision checks). */
  images?: string[];
  timeoutMs: number;
}

export interface CodexOptions {
  /** CODEX_LLM: nothing is routed while false. */
  enabled: boolean;
  /** CODEX_CALLS: the sites routed, exact ("doc.chapter"), by family ("doc") or everything ("*"). */
  sites: string[];
  /** CODEX_VISION: calls carrying images are routed too (each check wants its own side-by-side first). */
  vision?: boolean;
  /** CODEX_TIMEOUT_MINUTES: the run is killed after this (default 20 minutes). */
  timeoutMs?: number;
  /** CODEX_PYTHON: the Python that can import codex_runner (default "python"). */
  python?: string;
  /** CODEX_RUNNER_DIR: where codex_runner.py lives. */
  runnerDir?: string;
  /** Where schema and image files are written; a temp folder by default. */
  tmpDir?: string;
  /** The runner; tests substitute a fake so no process is spawned. */
  run?: (req: CodexRequest) => Promise<string>;
}

export const DEFAULT_RUNNER_DIR = "C:\\Claude\\orchestrator";
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/** Which Codex model class answers a tier: top writing gets the frontier model, mid the workhorse, low the fast one. */
export function kindFor(tier: Tier = "top"): CodexKind {
  return tier === "top" ? "frontier" : tier === "mid" ? "bulk" : "quick";
}

/**
 * The site a call belongs to: the explicit tag, else the file name of the first module above this one and
 * llm.ts in the stack ("documentary", "evergreen", "vision").
 */
export function siteOf(
  explicit?: string,
  stack = new Error().stack ?? "",
): string {
  if (explicit) return explicit;
  for (const line of stack.split("\n")) {
    const m = line.match(/([\w.-]+)\.(?:ts|mts|js|mjs|tsx):\d+:\d+/);
    if (!m) continue;
    const name = m[1]!;
    if (name === "codex" || name === "llm" || name === "codex.test") continue;
    return name;
  }
  return "unknown";
}

/** Whether a site is on the list: exact, by family (the part before the first dot) or "*". */
export function siteListed(site: string, sites: string[]): boolean {
  const family = site.split(".")[0]!;
  return sites.some((s) => {
    const t = s.trim().toLowerCase();
    return t === "*" || t === site.toLowerCase() || t === family.toLowerCase();
  });
}

/** The routing decision for one call. */
export function routeToCodex(
  opts: Pick<CodexOptions, "enabled" | "sites" | "vision">,
  site: string,
  hasImages: boolean,
): boolean {
  if (!opts.enabled) return false;
  if (hasImages && !opts.vision) return false;
  return siteListed(site, opts.sites);
}

/**
 * OpenAI's structured outputs want a strict schema: every property required, no extra properties, and no
 * keywords it does not know. Zod's optional fields become nullable-and-required; the answer's nulls are
 * dropped before Zod sees it (the factory's schemas use optional, never nullable).
 */
export function strictJsonSchema(schema: unknown): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = { ...(node as Record<string, unknown>) };
    delete n.$schema;
    delete n.default;
    delete n.minLength;
    delete n.maxLength;
    delete n.minItems;
    delete n.maxItems;
    delete n.minimum;
    delete n.maximum;
    delete n.exclusiveMinimum;
    delete n.exclusiveMaximum;
    delete n.pattern;
    delete n.format;
    if (
      n.type === "object" &&
      n.properties &&
      typeof n.properties === "object"
    ) {
      const props = n.properties as Record<string, unknown>;
      const required = new Set((n.required as string[] | undefined) ?? []);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        const w = walk(v);
        out[k] = required.has(k) ? w : { anyOf: [w, { type: "null" }] };
      }
      n.properties = out;
      n.required = Object.keys(props);
      n.additionalProperties = false;
    }
    for (const key of ["items", "anyOf", "oneOf", "allOf", "not"] as const)
      if (key in n) n[key] = walk(n[key]);
    return n;
  };
  return walk(schema);
}

/** Nulls stand for absent optional fields in a strict-schema answer. */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    if (v !== null) out[k] = dropNulls(v);
  return out;
}

/** The answer's JSON, with any code fence or prose around it removed. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return body;
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return end > start ? body.slice(start, end + 1) : body.slice(start);
}

/** Codex has no system role: the instructions and the input are marked, and the JSON-only rule comes last. */
export function buildPrompt(system: string, text: string): string {
  return `<instructions>\n${system}\n</instructions>\n\n<input>\n${text}\n</input>\n\nReply with one JSON object only, matching the output schema exactly. No prose, no code fence.`;
}

/** The text of a call's content, with image parts left out (they travel as files). */
export function textOf(content: string | LlmContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** The base64 image parts of a call's content. */
export function imagesOf(
  content: string | LlmContent,
): Array<{ data: string; mediaType: string }> {
  if (typeof content === "string") return [];
  const out: Array<{ data: string; mediaType: string }> = [];
  for (const part of content)
    if (part.type === "image" && part.source.type === "base64")
      out.push({ data: part.source.data, mediaType: part.source.media_type });
  return out;
}

/** The Python the runner spawns: reads the request file, asks Codex, writes the answer file. */
export const PYTHON_SNIPPET = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "import codex_runner",
  "req = json.load(open(sys.argv[2], encoding='utf-8'))",
  "out = codex_runner.ask(req['prompt'], kind=req['kind'], schema=req.get('schema'), timeout=req['timeout'], images=req.get('images') or None)",
  "open(req['out'], 'w', encoding='utf-8').write(out)",
].join("\n");

/** The command line for one request: python -c <snippet> <runner dir> <request file>. */
export function buildCommand(
  python: string,
  runnerDir: string,
  requestFile: string,
): { cmd: string; args: string[] } {
  return { cmd: python, args: ["-c", PYTHON_SNIPPET, runnerDir, requestFile] };
}

/** Runs codex_runner.ask in a child Python, killed (with its tree) if it outlives the timeout. */
export async function runCodex(
  req: CodexRequest,
  opts: { python: string; runnerDir: string; tmpDir: string },
): Promise<string> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const requestFile = path.join(opts.tmpDir, `req_${stamp}.json`);
  const outFile = path.join(opts.tmpDir, `out_${stamp}.txt`);
  fs.writeFileSync(
    requestFile,
    JSON.stringify({
      prompt: req.prompt,
      kind: req.kind,
      schema: req.schema,
      images: req.images,
      // Codex is told to stop a little before Node gives up, so the runner's own kill comes first.
      timeout: Math.max(30, Math.floor(req.timeoutMs / 1000) - 15),
      out: outFile,
    }),
  );
  const { cmd, args } = buildCommand(opts.python, opts.runnerDir, requestFile);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += String(d)));
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid)
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        else child.kill("SIGKILL");
        reject(
          new Error(
            `codex timed out after ${Math.round(req.timeoutMs / 60000)} min`,
          ),
        );
      }, req.timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `codex runner exit ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`.trim(),
            ),
          );
      });
    });
    return fs.readFileSync(outFile, "utf8");
  } finally {
    fs.rmSync(requestFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

/**
 * An Llm that answers listed sites through Codex and everything else (and every failure) through Claude.
 * Each answer is parsed with the call's Zod schema; an answer that does not fit is asked for once more with
 * the validation error, then the call goes to Claude.
 */
export function createCodexLlm(fallback: Llm, opts: CodexOptions): Llm {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const python = opts.python ?? "python";
  const runnerDir = opts.runnerDir ?? DEFAULT_RUNNER_DIR;
  let tmpDir = opts.tmpDir;
  const tmp = () => {
    if (!tmpDir)
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-codex-"));
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  };
  const run =
    opts.run ??
    ((req: CodexRequest) =>
      runCodex(req, { python, runnerDir, tmpDir: tmp() }));

  return {
    async structured<S extends z.ZodType>(
      o: StructuredOptions<S>,
    ): Promise<z.infer<S>> {
      const images = imagesOf(o.content);
      const site = siteOf(o.site);
      if (!routeToCodex(opts, site, images.length > 0))
        return fallback.structured(o);
      const kind = kindFor(o.tier);
      const started = Date.now();
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const files: string[] = [];
      try {
        const schemaFile = path.join(tmp(), `schema_${stamp}.json`);
        fs.writeFileSync(
          schemaFile,
          JSON.stringify(
            strictJsonSchema(
              z.toJSONSchema(o.schema, { unrepresentable: "any" }),
            ),
          ),
        );
        files.push(schemaFile);
        const imageFiles = images.map((img, i) => {
          const ext = img.mediaType === "image/png" ? "png" : "jpg";
          const f = path.join(tmp(), `img_${stamp}_${i}.${ext}`);
          fs.writeFileSync(f, Buffer.from(img.data, "base64"));
          files.push(f);
          return f;
        });
        let prompt = buildPrompt(o.system, textOf(o.content));
        let lastError = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          const answer = await run({
            prompt: attempt
              ? `${prompt}\n\nYour previous reply was not valid: ${lastError}\nReply again with one JSON object matching the schema.`
              : prompt,
            kind,
            schema: schemaFile,
            images: imageFiles.length ? imageFiles : undefined,
            timeoutMs,
          });
          let parsed: unknown;
          try {
            parsed = dropNulls(JSON.parse(extractJson(answer)));
          } catch (err) {
            lastError = `not JSON (${(err as Error).message.slice(0, 120)})`;
            continue;
          }
          const r = o.schema.safeParse(parsed);
          if (r.success) {
            const ms = Date.now() - started;
            recordUsage({
              t: new Date().toISOString(),
              model: `codex:${kind}`,
              job: jobOf(o.system),
              in: 0,
              out: 0,
              cacheRead: 0,
              cacheWrite: 0,
              provider: "codex",
              site,
              ms,
            });
            log("info", "codex answered", {
              site,
              kind,
              ms,
              attempt,
              images: imageFiles.length,
            });
            return r.data as z.infer<S>;
          }
          lastError = r.error.issues
            .slice(0, 6)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        }
        throw new Error(`answer did not match the schema: ${lastError}`);
      } catch (err) {
        log("warn", "codex failed, Claude answers", {
          site,
          kind,
          ms: Date.now() - started,
          error: (err as Error).message.slice(0, 300),
        });
        const result = await fallback.structured(o);
        log("info", "claude answered after codex", {
          site,
          ms: Date.now() - started,
        });
        return result;
      } finally {
        for (const f of files) fs.rmSync(f, { force: true });
      }
    },
  };
}
