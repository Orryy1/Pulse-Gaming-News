// One structured-output call shape for every editorial step. Kept behind an
// interface so tests can substitute a deterministic fake.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { FatalError } from "../lib/util.ts";
import { PULSE_FACT_RULES, PULSE_VOICE } from "./voice.ts";

/** One usage line as the logs keep it; Codex answers add provider "codex" at zero tokens (src/editorial/codex.ts). */
export interface UsageLine {
  t: string;
  model: string;
  job: string;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite5m?: number;
  provider?: "codex";
  site?: string;
  ms?: number;
}

/** Appends one line to data/usage/<day>.jsonl. Never throws: the meter must not break a run. */
export function recordUsage(line: UsageLine): void {
  try {
    const dir = path.join(
      path.resolve(process.env.DATA_DIR || "./data"),
      "usage",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `${line.t.slice(0, 10)}.jsonl`),
      `${JSON.stringify(line)}
`,
    );
  } catch {
    // The meter must never break a run.
  }
}

/** One line per Claude call in data/usage/<day>.jsonl: what it was for and the tokens it used, so the bill can be explained. */
function meter(model: string, system: string, usage: any): void {
  recordUsage({
    t: new Date().toISOString(),
    model,
    job: jobOf(system),
    in: usage?.input_tokens ?? 0,
    out: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
    // The part of cacheWrite kept five minutes (priced lower than the hour); older lines have none.
    cacheWrite5m: usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0,
  });
}

/**
 * What a call was for. The house style opens every writer's prompt, so the job is named after it: the
 * format's notes (news, documentary, ranking...) or the paragraph after the opening.
 */
export function jobOf(system: string): string {
  const shared = `${PULSE_VOICE}\n\n${PULSE_FACT_RULES}\n\n`;
  const body = system.startsWith(shared)
    ? system.slice(shared.length)
    : system.includes("\n\n")
      ? system.slice(system.indexOf("\n\n") + 2)
      : system;
  return body.replace(/\s+/g, " ").slice(0, 70);
}

/** $ per million tokens: input, output, cache read, 1-hour cache write (twice the input; a 5-minute write is 1.25 times). */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 8],
  "claude-sonnet-5-5": [2, 10, 0.2, 4],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.2],
};

/**
 * What Claude cost on one UTC day from the usage logs: the live factory (dataDir/usage) and every sandbox
 * (dataDir/smoke/<name>/usage, each run keeps its own log), so the evening summary shows the real bill.
 */
export function claudeSpend(
  dataDir: string,
  day: string,
): { live: number; tests: number } {
  const cost = (file: string) => {
    let total = 0;
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as {
          model: string;
          in: number;
          out: number;
          cacheRead: number;
          cacheWrite: number;
          cacheWrite5m?: number;
        };
        const [i, o, cr, cw] = PRICES[r.model] ?? PRICES["claude-opus-5-5"]!;
        const w5 = r.cacheWrite5m ?? 0;
        total +=
          (r.in * i +
            r.out * o +
            r.cacheRead * cr +
            (r.cacheWrite - w5) * cw +
            w5 * i * 1.25) /
          1e6;
      }
    } catch {
      // no log for that day
    }
    return total;
  };
  const live = cost(path.join(dataDir, "usage", `${day}.jsonl`));
  let tests = 0;
  try {
    for (const name of fs.readdirSync(path.join(dataDir, "smoke")))
      tests += cost(path.join(dataDir, "smoke", name, "usage", `${day}.jsonl`));
  } catch {
    // no sandboxes
  }
  return { live, tests };
}

export type LlmContent = Anthropic.Beta.BetaContentBlockParam[];

export interface Llm {
  structured<S extends z.ZodType>(opts: {
    system: string;
    content: string | LlmContent;
    schema: S;
    effort?: "low" | "medium" | "high";
    maxTokens?: number;
    /** top: writing and final checks (Opus); mid: picking footage and posts (Sonnet); low: simple filtering (Haiku). */
    tier?: Tier;
    /** How long the instructions stay cached: "1h" only for jobs that come back to the same instructions over the hour. */
    cache?: CacheTtl;
    /**
     * The step this call belongs to ("doc.chapter", "evergreen.write"), so a router can send named steps to
     * another provider (src/editorial/codex.ts). Unset: the calling module's file name. Claude ignores it.
     */
    site?: string;
  }): Promise<z.infer<S>>;
}

/** The options one structured() call takes. */
export type StructuredOptions<S extends z.ZodType> = Parameters<
  Llm["structured"]
>[0] & { schema: S };

export type Tier = "top" | "mid" | "low";

export type CacheTtl = "5m" | "1h";

export function createClaude(
  models: string | Partial<Record<Tier, string>>,
): Llm {
  const pick = (tier: Tier = "top") => {
    if (typeof models === "string") return models;
    return models[tier] || models.top || "claude-opus-5-5";
  };
  // An organisation-level key must name the workspace on every request; a workspace key does not.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(
    workspace
      ? { defaultHeaders: { "anthropic-workspace-id": workspace } }
      : {},
  );
  return {
    async structured({
      system,
      content,
      schema,
      effort = "medium",
      maxTokens = 16000,
      tier,
      cache = "5m",
    }) {
      const model = pick(tier);
      const response = await client.beta.messages.parse(
        {
          model,
          max_tokens: maxTokens,
          // Server-side refusal fallback: a safety decline on one model is
          // retried on another inside the same call instead of stalling a run.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort, format: betaZodOutputFormat(schema) },
          // Each job's instructions are fixed text, sent again on every call, and a repeat reads them from the
          // cache at a twentieth of the price. Most jobs repeat within minutes (a rewrite half a minute after
          // its draft) and then not for hours, so they keep the cheaper five-minute cache: an hour's write
          // costs 60% more and was mostly never read (23-29 Oct). Jobs that come back over the hour (the
          // picture editor's bursts, the translations) ask for the hour.
          system: [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral", ttl: cache },
            },
          ],
          messages: [{ role: "user", content }],
        },
        // A large output (a long video's full shot list) needs an explicit time limit, or the SDK insists on streaming.
        maxTokens > 16000 ? { timeout: 20 * 60 * 1000 } : undefined,
      );
      meter(model, system, response.usage);
      if (response.stop_reason === "refusal") {
        throw new FatalError(
          `model refused: ${response.stop_details?.category ?? "unspecified"}`,
        );
      }
      if (response.stop_reason === "max_tokens")
        throw new Error("model output hit max_tokens");
      if (response.parsed_output == null)
        throw new Error("model output did not match the schema");
      return response.parsed_output as z.infer<typeof schema>;
    },
  };
}
