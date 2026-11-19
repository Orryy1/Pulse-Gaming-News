// Who wrote a Short and who voiced it, recorded on every episode (19 Nov 2026 audit, upgrade 4). Codex wrote the news
// Shorts from 12 to 18 Nov while Claude's credit was out, and the local Liam voice stood in for ElevenLabs on 18 and 19
// Nov, so before/after readings of any test mixed writers and narrators. Now the script carries its writer and the
// analytics loop reads writer and narrator per post.
//
// How the writer is caught: src/editorial/llm.ts tells its listeners about every model call (Claude's model name, or
// Codex's "codex:<kind>" with provider "codex"). While the writer runs inside `captureCalls`, an AsyncLocalStorage
// scope collects those lines, so concurrent episodes never mix. The last answer is the one that wrote the words.

import { AsyncLocalStorage } from "node:async_hooks";
import { tapUsage, type UsageLine } from "./llm.ts";

export type WriterProvider = "claude" | "codex";

export interface WriterRecord {
  /** The provider of the main draft's last answer; "unknown" when no call was seen (a test double). */
  provider: WriterProvider | "unknown";
  /** "claude-opus-5-5", "codex:frontier". */
  model?: string;
  /** Where the writer was meant to go: WRITER_SPLIT's choice, else CODEX_CALLS' routing. */
  intended?: WriterProvider;
  /** It answered on the other provider (a Codex failure or timeout, or Claude's limit). */
  fallback?: boolean;
  /** WRITER_SPLIT's reason, when the split chose: "fit length", "strong fandom", "series" or "rest". */
  split?: string;
  /** Model answers inside the writer, per provider (drafts and rewrites). */
  calls: Record<WriterProvider, number>;
}

const scopes = new AsyncLocalStorage<UsageLine[][]>();
let tapped = false;

function ensureTap(): void {
  if (tapped) return;
  tapped = true;
  tapUsage((line) => {
    for (const bucket of scopes.getStore() ?? []) bucket.push(line);
  });
}

/** Runs fn with every model call it makes also pushed into `into` (nested scopes each get the line). */
export function captureCalls<T>(
  into: UsageLine[],
  fn: () => Promise<T>,
): Promise<T> {
  ensureTap();
  return scopes.run([...(scopes.getStore() ?? []), into], fn);
}

export const providerOf = (
  line: Pick<UsageLine, "provider" | "model">,
): WriterProvider =>
  line.provider === "codex" || line.model.startsWith("codex")
    ? "codex"
    : "claude";

/** The writer record from the calls the writer made (pure). */
export function writerRecord(
  calls: Array<Pick<UsageLine, "provider" | "model">>,
  intended?: WriterProvider,
  split?: string,
): WriterRecord {
  const last = calls.at(-1);
  const provider = last ? providerOf(last) : "unknown";
  return {
    provider,
    ...(last ? { model: last.model } : {}),
    ...(intended ? { intended } : {}),
    ...(intended && provider !== "unknown" && provider !== intended
      ? { fallback: true }
      : {}),
    ...(split ? { split } : {}),
    calls: {
      claude: calls.filter((c) => providerOf(c) === "claude").length,
      codex: calls.filter((c) => providerOf(c) === "codex").length,
    },
  };
}

/** A narrator as the loop groups it: the ElevenLabs voice by name, or the local fallback (Liam on VoxCPM). */
export function narratorOf(
  voice: { provider?: string; id?: string; name?: string } | null | undefined,
): string | undefined {
  if (!voice?.provider) return undefined;
  if (voice.provider === "local") return "local (Liam/VoxCPM)";
  return `elevenlabs${voice.name ? `: ${voice.name}` : ""}`;
}

/**
 * WRITER_SPLIT (pure): Claude writes the Shorts most likely to travel (a fit length of 35 s or under, a strong-identity
 * fandom, or a series Short), Codex the rest; spend stays level across the month.
 */
export function writerSplit(p: {
  maxSeconds?: number;
  strongFandom: boolean;
  serial: boolean;
}): { route: WriterProvider; why: string } {
  if (p.serial) return { route: "claude", why: "series" };
  if (p.maxSeconds !== undefined && p.maxSeconds <= 35)
    return { route: "claude", why: "fit length" };
  if (p.strongFandom) return { route: "claude", why: "strong fandom" };
  return { route: "codex", why: "rest" };
}
