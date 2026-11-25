// Claude through Claude Code on the owner's Max plan (CLAUDE_VIA_MAX, off by default). The owner asked on 25 Nov 2026:
// "Use my max plan". The paid API key had hit its monthly spend limit on 24 Nov and stays as the emergency fallback.
//
// Each structured() call runs `claude -p` once: the instructions as the system prompt (a file), the input on stdin,
// the call's Zod schema as --json-schema, no tools, no settings, hooks, MCP servers or session files, in an empty temp
// folder. The answer is checked with the same Zod schema and asked for once more if it does not fit. The model is the
// one the tier already names (CLAUDE_MODEL, _MID, _LOW), so no creative or judging step changes model.
//
// Order with the setting on: Max first, then Codex, then the API key (Codex's router does those two, with its own
// claudeOut hold, CODEX_SHORT_TIMEOUT_MINUTES cap and skipped-fallback logging). Calls with pictures, and calls a
// WRITER_SPLIT test sends to one writer, keep their routing (a "claude" call Max cannot take goes to the API key as
// before, never to Codex).
//
// Weekly guard, at MAX_WEEK_CAP_PERCENT (default 60) so the owner's own chats keep the rest:
//  - measured: every run's stream carries the plan's own seven-day utilisation (a rate_limit_event); the latest one is
//    the guard's main reading;
//  - shared: the PC orchestrator's reading (C:\Claude\orchestrator\claude_budget.py, the "Claude's week is N% used"
//    line of `orch status`), which the PC's library server hands to the Mac at /claude-budget (src/assets/gamelibserve.ts),
//    with any limit another pipeline met;
//  - with neither, Max runs until the CLI itself refuses on its limit, then holds for an hour (LIMIT_HOLD_MS), as it
//    does when the CLI is signed out (an ssh session) or times out twice in a row.
//
// The factory runs as a launchd agent in the owner's desktop session, where the CLI can open the login keychain.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { log } from "../lib/util.ts";
import {
  codexCapNow,
  extractJson,
  imagesOf,
  LIMIT_HOLD_MS,
  routeHintNow,
  siteListed,
  siteOf,
  textOf,
  withRoute,
} from "./codex.ts";
import {
  jobOf,
  recordUsage,
  type Llm,
  type StructuredOptions,
  type Tier,
} from "./llm.ts";

/** A weekly reading: the PC orchestrator's (state/claude_budget.json, trimmed) or one measured from a run's stream. */
export interface WeekReading {
  /** Percent of the week used. */
  weekly?: number;
  /** When the week resets (ISO). */
  resets_at?: string;
  /** When the reading was taken (epoch seconds). */
  read_at?: number;
  /** The plan is at a limit: no Claude until then (ISO). */
  limited_until?: string;
}

/** An older reading still counts for this long, or up to the reset it named (claude_budget.py READING_TTL_H). */
export const READING_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_WEEK_CAP_PERCENT = 60;
export const DEFAULT_MAX_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_CONCURRENCY = 2;
/** Under a Short's cap a schema retry is only tried with at least this long left. */
const MIN_RETRY_MS = 60_000;

const ts = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Whether one reading lets Max answer now (pure). Closed while a limit is recorded, or while a reading at or over the
 * cap is still before its reset (an old high reading stays until then; an old low one counts only READING_TTL_MS).
 * No reading, or a stale one: open (the CLI's own refusal is the guard then).
 */
export function maxGate(
  r: WeekReading | undefined,
  now: number,
  capPercent: number,
): { open: boolean; why: string } {
  if (!r) return { open: true, why: "no weekly reading" };
  const until = ts(r.limited_until);
  if (until > now)
    return {
      open: false,
      why: `Claude's plan is at its limit until ${r.limited_until}`,
    };
  if (typeof r.weekly !== "number")
    return { open: true, why: "no weekly reading" };
  const reset = ts(r.resets_at);
  if (reset > 0 && now >= reset)
    return { open: true, why: "the week has reset since the reading" };
  const recent =
    r.read_at !== undefined && now - r.read_at * 1000 < READING_TTL_MS;
  if (r.weekly >= capPercent && (recent || reset > 0))
    return {
      open: false,
      why: `Claude's week is ${r.weekly}% used (Max stops at ${capPercent}%)${r.resets_at ? `; back after ${r.resets_at}` : ""}`,
    };
  if (!recent) return { open: true, why: "no fresh weekly reading" };
  return { open: true, why: `Claude's week is ${r.weekly}% used` };
}

/**
 * Reads the weekly reading from `url` (the PC's /claude-budget), cached for ttlMs; a failed read is cached a minute
 * and gives undefined. Never throws.
 */
export function weekReader(
  url: string,
  fetchFn: typeof fetch = fetch,
  ttlMs = 5 * 60 * 1000,
): () => Promise<WeekReading | undefined> {
  let cached:
    | { at: number; value: WeekReading | undefined; ttl: number }
    | undefined;
  return async () => {
    const now = Date.now();
    if (cached && now - cached.at < cached.ttl) return cached.value;
    let value: WeekReading | undefined;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(4000) });
      value = res.ok ? ((await res.json()) as WeekReading) : undefined;
      if (!value || typeof value !== "object") value = undefined;
    } catch {
      value = undefined;
    }
    cached = { at: now, value, ttl: value ? ttlMs : 60_000 };
    return value;
  };
}

/** What kind of refusal the CLI's error text is: out of allowance, not signed in, or neither (pure). */
export function maxFailureKind(text: string): "limit" | "auth" | undefined {
  if (
    /usage limit|hit your (?:\w+ )?limit|limit reached|out of (?:extra )?usage|weekly limit|limit will reset/i.test(
      text,
    )
  )
    return "limit";
  if (
    /not logged in|run \/login|oauth token (?:has )?expired|invalid api key|authentication_error/i.test(
      text,
    )
  )
    return "auth";
  return undefined;
}

/** One `claude -p` run as the runner (real or a test double) is asked for it. */
export interface MaxRequest {
  system: string;
  input: string;
  model: string;
  effort: "low" | "medium" | "high";
  /** The JSON Schema the answer must match, as text. */
  jsonSchema: string;
  maxTokens?: number;
  timeoutMs: number;
}

/** The CLI's result message, as far as this module reads it, plus the weekly reading measured in the same run. */
export interface MaxReply {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** From the run's rate_limit_event messages (not part of the CLI's result). */
  week?: WeekReading;
}

/**
 * The plan's own reading from a run's rate_limit_event messages (pure): the seven-day utilisation as a percent, and a
 * limit until the reset when any window says "rejected". Undefined when the stream had none.
 */
export function weekFromEvents(
  events: unknown[],
  now = Date.now(),
): WeekReading | undefined {
  let out: WeekReading | undefined;
  for (const e of events) {
    const info = (e as { rate_limit_info?: Record<string, unknown> })
      ?.rate_limit_info;
    if (!info || typeof info !== "object") continue;
    out ??= { read_at: now / 1000 };
    const windows = (info.unifiedWindows ?? {}) as Record<
      string,
      { utilization?: number; resetsAt?: number; status?: string }
    >;
    const seven =
      windows.seven_day ??
      (info.rateLimitType === "seven_day"
        ? {
            utilization: info.utilization as number | undefined,
            resetsAt: info.resetsAt as number | undefined,
          }
        : undefined);
    if (typeof seven?.utilization === "number") {
      out.weekly = Math.round(seven.utilization * 100);
      if (typeof seven.resetsAt === "number")
        out.resets_at = new Date(seven.resetsAt * 1000).toISOString();
    }
    const rejected = [
      { status: info.status, resetsAt: info.resetsAt },
      ...Object.values(windows),
    ].filter((w) => w?.status === "rejected");
    for (const w of rejected) {
      const until =
        typeof w.resetsAt === "number"
          ? new Date((w.resetsAt as number) * 1000).toISOString()
          : new Date(now + LIMIT_HOLD_MS).toISOString();
      if (!out.limited_until || ts(until) > ts(out.limited_until))
        out.limited_until = until;
    }
  }
  return out;
}

/**
 * A new measured reading over the last one (pure): a run whose stream lacked the seven-day window, or a limit, keeps
 * the earlier figure and limit rather than wiping them.
 */
export function mergeWeek(
  old: WeekReading | undefined,
  fresh: WeekReading,
): WeekReading {
  const out: WeekReading = { ...old, read_at: fresh.read_at ?? old?.read_at };
  if (typeof fresh.weekly === "number") {
    out.weekly = fresh.weekly;
    if (fresh.resets_at) out.resets_at = fresh.resets_at;
  }
  if (fresh.limited_until) out.limited_until = fresh.limited_until;
  return out;
}

/**
 * The call's Zod schema as the CLI's --json-schema wants it (pure): draft-07 with no "$schema" key. The CLI's checker
 * rejected Zod's default draft 2020-12 ("no schema with key or ref", 25 Nov 2026).
 */
export function cliJsonSchema(schema: z.ZodType): string {
  const js = z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete js.$schema;
  return JSON.stringify(js);
}

/**
 * The flags for one run (pure): print mode, streamed JSON (so the plan's rate-limit reading comes too), the tier's
 * model, no tools, nothing loaded from settings, no session kept.
 */
export function cliArgs(
  req: Pick<MaxRequest, "model" | "effort" | "jsonSchema">,
  systemFile: string,
): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    req.model,
    "--effort",
    req.effort,
    "--system-prompt-file",
    systemFile,
    "--json-schema",
    req.jsonSchema,
    "--tools",
    "",
    "--safe-mode",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
  ];
}

/**
 * The child's environment (pure): every ANTHROPIC_* variable removed, so the CLI signs in with the owner's plan and
 * can never bill the API key; a large answer gets its output cap raised.
 */
export function cliEnv(
  env: NodeJS.ProcessEnv,
  maxTokens?: number,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env))
    if (!/^ANTHROPIC_/i.test(k)) out[k] = v;
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  out.DISABLE_AUTOUPDATER = "1";
  if (maxTokens && maxTokens > 32000)
    out.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);
  return out;
}

/** The result message and rate-limit reading in a run's stream-json output (pure). */
export function parseStream(stdout: string, now = Date.now()): MaxReply {
  const events: unknown[] = [];
  let result: MaxReply | undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (msg.type === "rate_limit_event") events.push(msg);
    else if (msg.type === "result") result = msg as MaxReply;
  }
  if (!result)
    throw new Error(`claude -p gave no result: ${stdout.trim().slice(-200)}`);
  const week = weekFromEvents(events, now);
  return week ? { ...result, week } : result;
}

/** CLI processes still running: killed with the factory, so none outlives a restart. */
const live = new Set<number>();
let exitHook = false;
const killGroup = (pid: number) => {
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
    else process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
};

/** Runs `claude -p` once in an empty temp folder and returns its result; killed (its group) after the timeout. */
export async function runClaudeCli(
  req: MaxRequest,
  opts: { bin: string; binArgs?: string[]; tmpRoot?: string },
): Promise<MaxReply> {
  if (!exitHook) {
    exitHook = true;
    process.on("exit", () => {
      for (const pid of live) killGroup(pid);
    });
    // A launchd stop or restart ends Node by signal, which emits no "exit": kill the CLIs, then let the signal do
    // what it would have done (this listener steps aside and the signal is raised again).
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const onSig = () => {
        for (const pid of live) killGroup(pid);
        process.removeListener(sig, onSig);
        if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
      };
      process.on(sig, onSig);
    }
  }
  const base = opts.tmpRoot ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "pulse-max-"));
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  const systemFile = path.join(dir, "system.txt");
  fs.writeFileSync(systemFile, req.system);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        opts.bin,
        [...(opts.binArgs ?? []), ...cliArgs(req, systemFile)],
        {
          cwd: work,
          env: cliEnv(process.env, req.maxTokens),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          // Its own group, so a timeout kills the CLI and anything it started.
          detached: process.platform !== "win32",
        },
      );
      if (child.pid) live.add(child.pid);
      let out = "";
      let err = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (d: string) => (out += d));
      child.stderr?.on("data", (d: string) => (err += d));
      const timer = setTimeout(() => {
        if (child.pid) killGroup(child.pid);
        else child.kill("SIGKILL");
        reject(
          new Error(
            `claude -p timed out after ${Math.round(req.timeoutMs / 1000)} s`,
          ),
        );
      }, req.timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        if (child.pid) live.delete(child.pid);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (child.pid) live.delete(child.pid);
        // An error result still comes as JSON on stdout with exit 1: the caller reads it.
        if (out.trim()) resolve(out);
        else
          reject(
            new Error(
              `claude -p exit ${code}: ${err.trim().split("\n").at(-1) ?? ""}`.trim(),
            ),
          );
      });
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(req.input);
    });
    return parseStream(stdout);
  } finally {
    // A just-killed child can still hold the folder for a moment (Windows): cleanup must never hide the run's own error.
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      // left for the OS's temp cleanup
    }
  }
}

export interface MaxOptions {
  /** CLAUDE_VIA_MAX: off, the router below is returned untouched. */
  enabled: boolean;
  /** The model per tier, the same ones the API uses (CLAUDE_MODEL, CLAUDE_MODEL_MID, CLAUDE_MODEL_LOW). */
  models: Partial<Record<Tier, string>>;
  /** MAX_WEEK_CAP_PERCENT: Max stops at this share of the week. */
  capPercent?: number;
  /** MAX_TIMEOUT_MINUTES: one call's Max attempt is given up after this (a Short's CODEX_SHORT_TIMEOUT_MINUTES cap bounds it too). */
  timeoutMs?: number;
  /** MAX_CONCURRENCY: runs at once; more wait their turn (a Short under its cap does not wait: it skips Max). */
  concurrency?: number;
  /** The PC orchestrator's reading (weekReader); undefined: only the runs' own readings and refusals guard. */
  week?: () => Promise<WeekReading | undefined>;
  /** True when Codex's router sits below: a failed or skipped call then goes Codex first, the API key last. */
  viaCodex?: boolean;
  /** CODEX_CALLS: with Codex below and forCodexSites off, these steps skip Max and stay on Codex as today. */
  codexSites?: string[];
  /** MAX_FOR_CODEX_SITES (default off): Max answers the CODEX_CALLS steps too, before Codex. */
  forCodexSites?: boolean;
  /** CLAUDE_BIN: the CLI (default "claude"). */
  bin?: string;
  tmpRoot?: string;
  /** The runner; tests substitute a fake so no process is spawned. */
  run?: (req: MaxRequest) => Promise<MaxReply>;
  /** Max was paused (over the cap, at its limit, signed out, hanging) or came back: one line each, for the owner. */
  onState?: (text: string) => void;
}

/**
 * An Llm that answers text calls through Claude Code on the Max plan and hands everything else, and every failure, to
 * `next` (Codex's router over the API key). With `enabled` off it is `next` itself: nothing changes.
 */
export function createMaxLlm(next: Llm, opts: MaxOptions): Llm {
  if (!opts.enabled) return next;
  const cap = opts.capPercent ?? DEFAULT_WEEK_CAP_PERCENT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  const limit = Math.max(1, opts.concurrency ?? DEFAULT_MAX_CONCURRENCY);
  const run =
    opts.run ??
    ((req: MaxRequest) =>
      runClaudeCli(req, { bin: opts.bin ?? "claude", tmpRoot: opts.tmpRoot }));
  const pick = (tier: Tier = "top") =>
    opts.models[tier] || opts.models.top || "claude-opus-5-5";

  // Slots: a release hands its slot straight to the next waiter, so the count can never pass the limit.
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const w = waiting.shift();
    if (w) w();
    else active--;
  };
  const slot = async (): Promise<void> => {
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>((r) => waiting.push(r));
  };

  let holdUntil = 0;
  let timeoutsInRow = 0;
  let measured: WeekReading | undefined;
  let paused: string | undefined;
  const say = (state: string | undefined) => {
    if (state === paused) return;
    const was = paused;
    paused = state;
    if (state) {
      log("warn", "Max plan paused; the usual routing answers", {
        why: state,
      });
      opts.onState?.(
        `Claude on the Max plan is paused: ${state}. ${opts.viaCodex ? "Codex answers, the API key last" : "The API key answers"}.`,
      );
    } else if (was) {
      log("info", "Max plan answering again", { was });
      opts.onState?.("Claude on the Max plan is answering again.");
    }
  };
  const hold = (why: string) => {
    holdUntil = Date.now() + LIMIT_HOLD_MS;
    say(`${why}, held until ${new Date(holdUntil).toISOString()}`);
  };
  // Why Max is closed right now, or undefined when it may answer.
  const closed = async (): Promise<string | undefined> => {
    if (Date.now() < holdUntil)
      return paused ?? `held until ${new Date(holdUntil).toISOString()}`;
    const now = Date.now();
    const own = maxGate(measured, now, cap);
    if (!own.open) return own.why;
    const shared = maxGate(
      await opts.week?.().catch(() => undefined),
      now,
      cap,
    );
    return shared.open ? undefined : shared.why;
  };

  // Down to the usual routing: Codex first when it is there, except a WRITER_SPLIT "claude" call, which keeps its hint.
  const pass = <S extends z.ZodType>(o: StructuredOptions<S>) =>
    opts.viaCodex && routeHintNow() !== "claude"
      ? withRoute("codex", () => next.structured(o))
      : next.structured(o);

  return {
    async structured<S extends z.ZodType>(
      o: StructuredOptions<S>,
    ): Promise<z.infer<S>> {
      // Pictures, and a WRITER_SPLIT call meant for Codex: routed exactly as before.
      if (imagesOf(o.content).length > 0 || routeHintNow() === "codex")
        return next.structured(o);
      const site = siteOf(o.site);
      // A CODEX_CALLS step stays on Codex (its weekly allowance is lost if unused), unless MAX_FOR_CODEX_SITES. Without
      // Codex below it would only reach the API key, so Max takes it then.
      if (
        opts.viaCodex &&
        !opts.forCodexSites &&
        siteListed(site, opts.codexSites ?? [])
      )
        return next.structured(o);
      const why = await closed();
      say(why);
      if (why) return pass(o);

      const runCap = codexCapNow();
      const capped = Boolean(runCap && runCap > 0);
      // A Short under its cap never queues for a slot: the wait would come out of its slot time.
      if (capped && active >= limit) {
        log("info", "max busy, a capped Short goes the usual way", { site });
        return pass(o);
      }
      const model = pick(o.tier);
      const effort = o.effort ?? "medium";
      const budget = capped ? Math.min(timeoutMs, runCap!) : timeoutMs;
      const input = textOf(o.content);
      const started = Date.now();
      await slot();
      // The slot goes back before any fallback, so Codex's or the API's time never holds a Max slot.
      let held = true;
      const free = () => {
        if (held) release();
        held = false;
      };
      let reply: MaxReply | undefined;
      try {
        const jsonSchema = cliJsonSchema(o.schema);
        const deadline = Date.now() + budget;
        let lastError = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          const left = deadline - Date.now();
          if (attempt && left < MIN_RETRY_MS) break;
          reply = await run({
            system: o.system,
            input: attempt
              ? `${input}\n\nYour previous reply was not valid: ${lastError}\nReply again with one JSON object matching the schema.`
              : input,
            model,
            effort,
            jsonSchema,
            maxTokens: o.maxTokens,
            timeoutMs: Math.max(1000, left),
          });
          timeoutsInRow = 0;
          if (reply.week) measured = mergeWeek(measured, reply.week);
          if (reply.is_error || (reply.subtype && reply.subtype !== "success"))
            throw new Error(
              `claude -p failed: ${`${reply.subtype ?? "error"}: ${reply.result ?? ""}`.slice(0, 300)}`,
            );
          let parsed: unknown = reply.structured_output;
          if (parsed === undefined || parsed === null) {
            try {
              parsed = JSON.parse(extractJson(reply.result ?? ""));
            } catch (err) {
              lastError = `not JSON (${(err as Error).message.slice(0, 120)})`;
              continue;
            }
          }
          const r = o.schema.safeParse(parsed);
          if (r.success) {
            const ms = Date.now() - started;
            recordUsage(
              {
                t: new Date().toISOString(),
                model,
                job: jobOf(o.system),
                in: reply.usage?.input_tokens ?? 0,
                out: reply.usage?.output_tokens ?? 0,
                cacheRead: reply.usage?.cache_read_input_tokens ?? 0,
                cacheWrite: reply.usage?.cache_creation_input_tokens ?? 0,
                provider: "max",
                site,
                ms,
              },
              o.system,
            );
            log("info", "max answered", {
              site,
              model,
              ms,
              attempt,
              ...(measured?.weekly !== undefined
                ? { weekPercent: measured.weekly }
                : {}),
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
        const message = (err as Error)?.message ?? String(err);
        // A refusal can come as a JSON result or only on stderr: either way it holds Max.
        const kind = maxFailureKind(message);
        if (kind === "limit") hold("the CLI refused on its usage limit");
        else if (kind === "auth") hold("the CLI is not signed in");
        else if (/timed out/.test(message) && ++timeoutsInRow >= 2)
          hold("two runs in a row timed out");
        log(
          "warn",
          opts.viaCodex && routeHintNow() !== "claude"
            ? "max failed, Codex answers"
            : "max failed, the API key answers",
          {
            site,
            model,
            ms: Date.now() - started,
            timeoutMs: budget,
            error: message.slice(0, 300),
          },
        );
        free();
        return pass(o);
      } finally {
        free();
      }
    },
  };
}
