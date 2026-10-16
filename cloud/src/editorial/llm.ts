// One structured-output call shape for every editorial step. Kept behind an
// interface so tests can substitute a deterministic fake.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { FatalError } from "../lib/util.ts";

export type LlmContent = Anthropic.Beta.BetaContentBlockParam[];

export interface Llm {
  structured<S extends z.ZodType>(opts: {
    system: string;
    content: string | LlmContent;
    schema: S;
    effort?: "low" | "medium" | "high";
    maxTokens?: number;
  }): Promise<z.infer<S>>;
}

export function createClaude(model: string): Llm {
  const client = new Anthropic();
  return {
    async structured({ system, content, schema, effort = "medium", maxTokens = 16000 }) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: maxTokens,
        // Server-side refusal fallback: a safety decline on one model is
        // retried on another inside the same call instead of stalling a run.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") {
        throw new FatalError(`model refused: ${response.stop_details?.category ?? "unspecified"}`);
      }
      if (response.stop_reason === "max_tokens") throw new Error("model output hit max_tokens");
      if (response.parsed_output == null) throw new Error("model output did not match the schema");
      return response.parsed_output as z.infer<typeof schema>;
    },
  };
}
