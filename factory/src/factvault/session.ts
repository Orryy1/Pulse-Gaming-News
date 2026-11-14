// One episode's view of the vault, so each pipeline step needs a line or two: the brief for the writer and the
// checker, warnings for claims already rejected, and the settling of a fact check's blockers. Nothing here can fail
// an episode: every vault step is wrapped, and a vault that won't load means the step runs as it always did.

import type { Db } from "../db.ts";
import { logEvent } from "../episodes.ts";
import type { SteamFacts } from "../assets/steam.ts";
import type { WikiRef } from "../discovery/wikirefs.ts";
import type { VaultContext } from "./check.ts";
import {
  harvestArticle,
  harvestBlockers,
  harvestCited,
  harvestSteam,
  readPage,
  type PageReader,
} from "./harvest.ts";
import {
  vaultEnforces,
  vaultReads,
  vaultWrites,
  type FactVaultMode,
} from "./mode.ts";
import { FactVault } from "./store.ts";
import {
  disputeWarnings,
  enforceBlockers,
  loadContext,
  safely,
  vaultBrief,
  verifiedNote,
  type Enforcement,
} from "./vault.ts";

export interface VaultSession {
  mode: FactVaultMode;
  vault: FactVault;
  ctx: VaultContext;
  /** The block the writer and the fact checker read (empty when the vault knows nothing about these games). */
  brief: string;
  /** Lines that repeat a claim our fact check rejected before, as writer feedback. */
  warnings(texts: readonly string[]): string[];
  /** What the vault verified in a script, as a note for the fact checker. */
  verified(texts: readonly string[]): string;
  /** A fact check's blockers, settled where the vault can (enforce), the rest recorded as disputes (write). */
  settle<T>(
    script: T,
    blockers: readonly string[],
    episodeId: string,
    step: string,
  ): Promise<Enforcement<T>>;
}

/** The session for an episode, or undefined when FACT_VAULT is off or the vault won't load. */
export async function openSession(
  db: Db,
  mode: FactVaultMode,
  names: readonly string[],
  texts: readonly string[] = [],
  now = new Date(),
): Promise<VaultSession | undefined> {
  if (!vaultReads(mode)) return undefined;
  const vault = new FactVault(db);
  const ctx = await safely("loading the context", () =>
    loadContext(vault, names, texts, now),
  );
  if (!ctx) return undefined;
  return {
    mode,
    vault,
    ctx,
    brief: vaultBrief(ctx),
    warnings: (t) => disputeWarnings(t, ctx),
    verified: (t) => verifiedNote(t, ctx),
    async settle<T>(
      script: T,
      blockers: readonly string[],
      episodeId: string,
      step: string,
    ): Promise<Enforcement<T>> {
      const none: Enforcement<T> = {
        script,
        remaining: [...blockers],
        resolutions: [],
        fixes: [],
      };
      if (!blockers.length) return none;
      const done = vaultEnforces(mode)
        ? enforceBlockers(script, blockers, ctx)
        : none;
      const settled = done.resolutions.filter((r) => r.status !== "unresolved");
      if (settled.length)
        await safely("logging", () =>
          logEvent(db, episodeId, "factvault", {
            step,
            settled: settled.map((r) => ({
              quote: r.blocker.quote.slice(0, 300),
              status: r.status,
              why: r.why.slice(0, 400),
              facts: r.judged.map((j) => j.fact?.id).filter(Boolean),
            })),
            fixes: done.fixes.map((f) => ({
              from: f.from,
              to: f.to,
              fact: f.factId,
            })),
            remaining: done.remaining.length,
          }),
        );
      for (const r of settled)
        for (const j of r.judged)
          if (j.fact)
            await safely("recording the check", () =>
              vault.recordCheck(
                j.fact!.id,
                true,
                `${step}: ${r.status} a fact check blocker`,
              ),
            );
      if (vaultWrites(mode))
        await safely("recording disputes", () =>
          harvestBlockers(vault, ctx, done.remaining, episodeId),
        );
      return done;
    },
  };
}

/** Growth from what a step already fetched; a no-op below write. Never throws. */
export async function growFromSteam(
  db: Db,
  mode: FactVaultMode,
  game: string,
  facts: SteamFacts | undefined,
): Promise<void> {
  if (!vaultWrites(mode) || !facts?.storeUrl) return;
  await safely("harvesting Steam", () =>
    harvestSteam(new FactVault(db), game, facts),
  );
}

export async function growFromArticles(
  db: Db,
  mode: FactVaultMode,
  game: string | undefined,
  articles: ReadonlyArray<{
    url: string;
    title: string;
    text: string;
    outlet?: string;
    published?: string;
    official?: boolean;
  }>,
): Promise<void> {
  if (!vaultWrites(mode) || !game?.trim()) return;
  const vault = new FactVault(db);
  for (const a of articles)
    await safely("harvesting an article", () => harvestArticle(vault, game, a));
}

/** A research step's Wikipedia brief, followed to its cited sources (at most `maxFetch` read). */
export async function growFromResearch(
  db: Db,
  mode: FactVaultMode,
  game: string,
  article: { url: string; text: string; refs?: readonly WikiRef[] } | undefined,
  maxFetch: number,
  read: PageReader = readPage,
): Promise<void> {
  if (!vaultWrites(mode) || !article?.refs?.length || maxFetch <= 0) return;
  await safely("harvesting research", () =>
    harvestCited(
      new FactVault(db),
      { name: game },
      { url: article.url, text: article.text, refs: article.refs! },
      read,
      { maxFetch },
    ),
  );
}
