// What the Pulse hands-off watch looks at, as pure functions from gathered facts to faults (src/handsoff/gate.ts
// decides what to do with them). The gathering itself (one ssh to the Mac, a few PC files) is in
// src/tools/pulse-watch.ts. Every check here is one the old hourly Claude watch did by reading the same sources:
//
// - the Mac reachable, the factory answering and still logging, its disk;
// - a slot missed: nothing published in the 90 minutes after a planned slot (the factory's own plan, src/pcschedule.ts
//   slotsOnDay, from the Mac's settings), and a long slot coming up with no episode being made for it;
// - error spikes and the same error twice ("the same error twice in a row is always worth fixing straight away");
// - a long video failing, or the long-topic picker refusing;
// - episodes stuck in one status, episodes that failed on a technical error (not a content judgement);
// - Pulse orchestrator jobs far over their estimate, and the PC watchdog's own Pulse faults;
// - the relay ports, the release gate, the YouTube download pause, the Claude and Codex holds;
// - new factory alerts (paused, needs you, gave up, QA failed), owner-only ones to the inbox.

import crypto from "node:crypto";
import type { Fault } from "./gate.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Health {
  ok?: boolean;
  published_24h?: string | number;
  in_flight?: string | number;
  producing?: string | number;
  scheduled?: string | number;
  uploads_active?: number;
  lastTick?: string;
}
export interface LogLine {
  t: string;
  level?: string;
  msg?: string;
  id?: string;
  error?: string;
  status?: string;
  [k: string]: unknown;
}
export interface Episode {
  id: string;
  lane: string | null;
  status: string;
  created_at: string;
  title?: string;
  last_error?: string;
}
export interface Published {
  id: string;
  lane: string | null;
  live_at: string;
  video?: string | null;
}
export interface Held {
  id: string;
  at: string;
  status?: string | null;
  headline?: string;
}
export interface Alert {
  at: number;
  channel?: string;
  text: string;
}
export interface MacFacts {
  reachable: boolean;
  error?: string;
  health?: Health;
  diskFreeGb?: number;
  log: LogLine[];
  lastLogAt?: Date;
  episodes: Episode[];
  published: Published[];
  gateHeld: Held[];
  /** Admin pages that did not answer (their lists above are empty because unknown, not because empty). */
  unknown: string[];
  ytBlockUntil?: number;
  alerts: Alert[];
  ports: { hostport: string; up: boolean }[];
  procs: string[];
  holdRestart: boolean;
  slotEnv: string;
}
export interface PlannedSlot {
  lane: string;
  at: string;
  lead: number;
}
export interface SlotPlan {
  timezone: string;
  dailyTarget: number;
  slots: PlannedSlot[];
}
export interface OrchJob {
  id: string;
  job: string;
  project: string;
  est_min?: number;
  granted?: number;
  created?: number;
}
export interface PcFacts {
  leases: OrchJob[];
  waiting: OrchJob[];
  /** The PC watchdog's faults.json entries. */
  watchdogFaults: { key: string; owner?: string; what: string }[];
  watchdogAt?: string;
  budgetPct?: number;
  codexHold?: string;
  /** loop_runs.json: Pulse scheduled tasks and their newest run. */
  taskRuns: {
    taskId: string;
    status: string;
    started_at: string;
    error?: string | null;
  }[];
  /** The orchestrator's finished jobs (state/history.jsonl, newest last). */
  orchHistory?: {
    id?: string;
    job: string;
    project: string;
    outcome: string;
    end: number;
  }[];
}

/** Splits the probe's output into its "@@name" sections (pure). */
export function parseSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name = "";
  for (const line of text.split(/\r?\n/)) {
    const m = /^@@([a-z]+)$/.exec(line);
    if (m) {
      name = m[1]!;
      out[name] = "";
      continue;
    }
    if (name) out[name] += `${line}\n`;
  }
  return out;
}

function json<T>(s: string | undefined, fallback: T): T {
  try {
    const t = (s ?? "").trim();
    return t ? (JSON.parse(t) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The probe's sections as facts (pure). */
export function macFactsFrom(sec: Record<string, string>): MacFacts {
  const health = json<Health | undefined>(sec.health, undefined);
  const disk = (sec.disk ?? "").trim().split(/\s+/);
  // df -g: Filesystem 1G-blocks Used Available Capacity ...
  const free = Number(disk[3]);
  const log: LogLine[] = [];
  for (const l of (sec.log ?? "").split("\n")) {
    const x = json<LogLine | undefined>(l, undefined);
    if (x && typeof x.t === "string") log.push(x);
  }
  const lastT = /"t":"([^"]+)"/.exec(sec.lastlog ?? "")?.[1];
  const unknown = (["episodes", "published", "gateheld"] as const).filter(
    (k) => json<unknown>(sec[k], null) === null,
  );
  const alerts: Alert[] = [];
  for (const l of (sec.alerts ?? "").split("\n")) {
    const x = json<Alert | undefined>(l, undefined);
    if (x && typeof x.at === "number" && typeof x.text === "string")
      alerts.push(x);
  }
  const ports = (sec.ports ?? "")
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter((p) => p.length === 2)
    .map(([hostport, s]) => ({ hostport: hostport!, up: s === "up" }));
  return {
    reachable: sec.end !== undefined,
    error: sec.error?.trim() || undefined,
    health,
    diskFreeGb: Number.isFinite(free) ? free : undefined,
    log,
    lastLogAt: lastT ? new Date(lastT) : undefined,
    episodes: json<Episode[] | null>(sec.episodes, null) ?? [],
    published: json<Published[] | null>(sec.published, null) ?? [],
    gateHeld: json<Held[] | null>(sec.gateheld, null) ?? [],
    unknown: [...unknown],
    ytBlockUntil: json<{ until?: number }>(sec.ytguard, {}).until,
    alerts,
    ports,
    procs: (sec.procs ?? "").split("\n").filter((l) => l.trim()),
    holdRestart: (sec.hold ?? "").includes("hold-restart"),
    slotEnv: sec.slotenv ?? "",
  };
}

const short = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

/** An error message with its changing parts (numbers, ids, quotes) taken out, so repeats match (pure). */
export function normaliseError(e: string): string {
  return e
    .replace(/ep_\d{8}_[0-9a-f]+/g, "<ep>")
    .replace(/"[^"]{0,200}"/g, '"…"')
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Content judgements the factory makes on purpose: a rejected Short is the checks working, not a fault (pure). */
export const CONTENT_ERROR =
  /fact-?check|QA (held|failed)|clarity|spoiler|release gate|rubric|rejected|writer notes|not about|demand|duplicate|already covered|stale/i;

/** Long lanes: an episode of these takes hours, and one lost costs a long video. */
export const LONG_LANES = ["longform", "documentary"];
/** Shorts that do not take a planned slot (breaking news goes out when it breaks; gameplay waits for the owner). */
const OFF_PLAN = ["news_breaking", "gameplay", "twin"];
// Not "approved": an approved Short waits for its slot, and a spare one for a gap, often for hours.
const PRODUCING = ["selected", "scripted", "voiced", "rendered"];
const DONE = ["published", "failed", "rejected"];

export function healthFaults(m: MacFacts, now: Date): Fault[] {
  if (!m.reachable)
    return [
      {
        key: "mac-unreachable",
        severity: "critical",
        what: "The Mac mini did not answer over ssh (pulse-mac)",
        detail: m.error,
        confirmRuns: 2,
      },
    ];
  const out: Fault[] = [];
  if (!m.health || m.health.ok !== true)
    out.push({
      key: "factory-health",
      severity: "critical",
      what: "The factory's /health on the Mac did not answer ok",
      detail: JSON.stringify(m.health ?? null),
      confirmRuns: 2,
    });
  if (!m.lastLogAt || now.getTime() - m.lastLogAt.getTime() > 30 * MIN)
    out.push({
      key: "factory-silent",
      severity: "critical",
      what: `The factory has written nothing to its log for over 30 minutes (last ${m.lastLogAt?.toISOString() ?? "never"})`,
      confirmRuns: 2,
    });
  // Nothing at all published in 24 hours, judged from 14:00 UK (after the first slots of the day had their chance).
  const ukHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (m.health?.ok && Number(m.health.published_24h ?? 1) === 0 && ukHour >= 14)
    out.push({
      key: "nothing-published-24h",
      severity: "fault",
      what: "Nothing has been published in the last 24 hours",
      detail: `health: in_flight ${m.health.in_flight}, producing ${m.health.producing}, scheduled ${m.health.scheduled}`,
    });
  return out;
}

/** Disk: under 40 GB free the old watch thinned Time Machine's local snapshots (owner-approved 18 Nov); under 25 GB
 *  after that it is a fault. Returns whether to thin, and the fault if any (pure). */
export function diskCheck(freeGb: number | undefined): {
  thin: boolean;
  fault?: Fault;
} {
  if (freeGb === undefined) return { thin: false };
  return {
    thin: freeGb < 40,
    fault:
      freeGb < 25
        ? {
            key: "mac-disk",
            severity: "fault",
            what: `The Mac has only ${freeGb} GB free (under 25 GB)`,
            detail:
              "Thin local snapshots first; if still low, find the biggest folders under ~/PulseFactory/factory/data with du and report them. Delete nothing.",
          }
        : undefined,
  };
}

function localDayOf(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Planned slots that passed (by 90 minutes, within the last 18 hours) with nothing published for them (pure). Each
 * published video counts for one slot at most: the nearest unclaimed slot it went out within 30 minutes before or
 * 90 after. A Short slot is not owed once the day already has its target of Shorts (SHORTS_PER_DAY).
 */
export function missedSlotFaults(
  plan: SlotPlan,
  published: readonly Published[],
  now: Date,
): Fault[] {
  const due = plan.slots
    .map((s) => ({ ...s, t: Date.parse(s.at) }))
    .filter(
      (s) =>
        s.t + 90 * MIN <= now.getTime() && s.t >= now.getTime() - 18 * HOUR,
    )
    .sort((a, b) => a.t - b.t);
  // Every slot near enough competes for the videos (a slot not yet 90 minutes old keeps its own video), and each
  // video goes to the nearest slot it fits: pairs are taken closest first.
  const slots = plan.slots
    .map((s) => ({ ...s, t: Date.parse(s.at) }))
    .filter(
      (s) =>
        s.t >= now.getTime() - 20 * HOUR && s.t <= now.getTime() + 30 * MIN,
    );
  const vids = published
    .filter((p) => !OFF_PLAN.includes(p.lane ?? ""))
    .map((p) => ({ ...p, t: Date.parse(p.live_at) }));
  const pairs: { s: number; v: number; d: number }[] = [];
  slots.forEach((s, si) =>
    vids.forEach((v, vi) => {
      const sameKind =
        LONG_LANES.includes(s.lane) === LONG_LANES.includes(v.lane ?? "");
      if (sameKind && v.t >= s.t - 30 * MIN && v.t <= s.t + 90 * MIN)
        pairs.push({ s: si, v: vi, d: Math.abs(v.t - s.t) });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const slotTaken = new Set<number>();
  const vidTaken = new Set<number>();
  for (const p of pairs) {
    if (slotTaken.has(p.s) || vidTaken.has(p.v)) continue;
    slotTaken.add(p.s);
    vidTaken.add(p.v);
  }
  const filled = new Set(
    [...slotTaken].map((i) => `${slots[i]!.lane}@${slots[i]!.at}`),
  );
  const out: Fault[] = [];
  for (const s of due) {
    const long = LONG_LANES.includes(s.lane);
    if (filled.has(`${s.lane}@${s.at}`)) continue;
    if (!long) {
      const day = localDayOf(new Date(s.t), plan.timezone);
      const shorts = published.filter(
        (p) =>
          !LONG_LANES.includes(p.lane ?? "") &&
          Date.parse(p.live_at) <= s.t + 90 * MIN &&
          localDayOf(new Date(p.live_at), plan.timezone) === day,
      ).length;
      if (shorts >= plan.dailyTarget) continue;
    }
    out.push({
      key: `slot:${s.lane}@${s.at}`,
      severity: "fault",
      what: `The ${s.lane} slot at ${s.at} passed with nothing published for it`,
      detail: `Published in the window: none. Shorts published that day so far count against SHORTS_PER_DAY ${plan.dailyTarget}.`,
    });
  }
  return out;
}

/** A long slot whose lead time has started with no long episode being made or done for it (pure). */
export function longSlotFaults(
  plan: SlotPlan,
  episodes: readonly Episode[],
  published: readonly Published[],
  now: Date,
): Fault[] {
  const due = plan.slots
    .filter((s) => LONG_LANES.includes(s.lane))
    .map((s) => ({ ...s, t: Date.parse(s.at) }))
    .filter(
      (s) =>
        s.t > now.getTime() &&
        now.getTime() >= s.t - (s.lead + 60) * MIN &&
        s.t - now.getTime() <= 36 * HOUR,
    )
    .sort((a, b) => a.t - b.t);
  let making = episodes.filter(
    (e) => LONG_LANES.includes(e.lane ?? "") && !DONE.includes(e.status),
  ).length;
  making += published.filter(
    (p) =>
      LONG_LANES.includes(p.lane ?? "") &&
      Date.parse(p.live_at) > now.getTime(),
  ).length;
  const out: Fault[] = [];
  for (const s of due) {
    if (making > 0) {
      making--;
      continue;
    }
    out.push({
      key: `longslot:${s.lane}@${s.at}`,
      severity: "fault",
      what: `The ${s.lane} slot at ${s.at} is due within its lead time and no long episode is being made for it`,
    });
  }
  return out;
}

export function logFaults(
  log: readonly LogLine[],
  episodes: readonly Episode[],
  now: Date,
): Fault[] {
  const laneOf = new Map(episodes.map((e) => [e.id, e.lane ?? ""]));
  const within = (l: LogLine, ms: number) =>
    now.getTime() - Date.parse(l.t) <= ms &&
    Date.parse(l.t) <= now.getTime() + MIN;
  const failed = log.filter((l) => l.msg === "step failed");
  const out: Fault[] = [];
  const recent = failed.filter((l) => within(l, 90 * MIN));
  if (recent.length >= 4)
    out.push({
      key: "step-failed-spike",
      severity: "fault",
      what: `${recent.length} "step failed" lines in the last 90 minutes`,
      detail: recent
        .slice(-4)
        .map((l) => `${l.t} ${l.id ?? ""} ${(l.error ?? "").slice(0, 160)}`)
        .join(" | "),
    });
  // The same technical error twice in three hours (content judgements are the checks working).
  const groups = new Map<string, LogLine[]>();
  for (const l of failed.filter((x) => within(x, 3 * HOUR))) {
    const e = l.error ?? "";
    if (!e || CONTENT_ERROR.test(e)) continue;
    const k = normaliseError(e);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [k, ls] of groups)
    if (ls.length >= 2)
      out.push({
        key: `err:${short(k)}`,
        severity: "fault",
        what: `The same step error ${ls.length} times in 3 hours: ${k.slice(0, 140)}`,
        detail: ls
          .slice(-3)
          .map((l) => `${l.t} ${l.id ?? ""} status=${l.status ?? ""}`)
          .join(" | "),
      });
  // Long videos: any failure counts, content judgements included (a lost long video is a fault either way).
  const longFails = new Map<string, LogLine[]>();
  for (const l of failed.filter(
    (x) =>
      within(x, 24 * HOUR) && LONG_LANES.includes(laneOf.get(x.id ?? "") ?? ""),
  ))
    longFails.set(l.id!, [...(longFails.get(l.id!) ?? []), l]);
  for (const [id, ls] of longFails)
    if (ls.length >= 2)
      out.push({
        key: `longfail:${id}`,
        severity: "fault",
        what: `Long episode ${id} failed a step ${ls.length} times in 24 hours`,
        detail: ls
          .slice(-3)
          .map((l) => `${l.t} ${(l.error ?? "").slice(0, 200)}`)
          .join(" | "),
      });
  const refused = log.filter(
    (l) =>
      within(l, 24 * HOUR) &&
      /long_topic_skipped|no long-form topic/i.test(
        `${l.msg ?? ""} ${l.error ?? ""}`,
      ),
  );
  if (refused.length)
    out.push({
      key: "long-topic-refused",
      severity: "fault",
      what: `The long-video topic picker refused ${refused.length} time(s) in 24 hours`,
      detail: refused
        .slice(-2)
        .map((l) => `${l.t} ${l.msg}`)
        .join(" | "),
    });
  // Any other error line repeated: three times in 90 minutes.
  const errs = new Map<string, number>();
  for (const l of log.filter(
    (x) =>
      x.level === "error" && x.msg !== "step failed" && within(x, 90 * MIN),
  )) {
    const k = normaliseError(`${l.msg ?? ""}: ${l.error ?? ""}`);
    errs.set(k, (errs.get(k) ?? 0) + 1);
  }
  for (const [k, n] of errs)
    if (n >= 3)
      out.push({
        key: `logerr:${short(k)}`,
        severity: "fault",
        what: `Error logged ${n} times in 90 minutes: ${k.slice(0, 160)}`,
      });
  const limit = log.filter(
    (l) =>
      within(l, 2 * HOUR) &&
      /usage limit|spending limit/i.test(`${l.msg ?? ""} ${l.error ?? ""}`),
  );
  if (limit.length)
    out.push({
      key: "claude-limit",
      severity: "warn",
      what: `Claude refused on its usage or spending limit ${limit.length} time(s) in 2 hours (Codex answers meanwhile)`,
    });
  return out;
}

/** Episodes that failed in the last 12 hours on a technical error, not a content judgement (pure). */
export function failedFaults(episodes: readonly Episode[], now: Date): Fault[] {
  return episodes
    .filter(
      (e) =>
        e.status === "failed" &&
        now.getTime() - Date.parse(e.created_at) <= 12 * HOUR &&
        !CONTENT_ERROR.test(e.last_error ?? ""),
    )
    .map((e) => ({
      key: `failed:${e.id}`,
      severity: "fault" as const,
      what: `Episode ${e.id} (${e.lane}) failed on a technical error: ${(e.last_error ?? "no error recorded").slice(0, 160)}`,
      detail: `Find the cause in the factory log, fix it, then retry with /admin/retry?id=${e.id} (it keeps its script and voice).`,
    }));
}

export type StatusMemory = Record<string, { status: string; since: string }>;

/**
 * Episodes stuck in one status (pure). A Short takes minutes, so one still being made four hours after it was picked
 * is stuck; a long video is stuck after ten hours in one status (tracked between runs) or 30 hours in all.
 */
export function stuckFaults(
  episodes: readonly Episode[],
  memory: StatusMemory,
  now: Date,
): { faults: Fault[]; memory: StatusMemory } {
  const next: StatusMemory = {};
  const out: Fault[] = [];
  for (const e of episodes) {
    if (!PRODUCING.includes(e.status)) continue;
    const old = memory[e.id];
    const since =
      old && old.status === e.status ? old.since : now.toISOString();
    next[e.id] = { status: e.status, since };
    const age = now.getTime() - Date.parse(e.created_at);
    const inStatus = now.getTime() - Date.parse(since);
    const long = LONG_LANES.includes(e.lane ?? "");
    const stuck = long
      ? inStatus >= 10 * HOUR || age >= 30 * HOUR
      : age >= 4 * HOUR;
    if (stuck)
      out.push({
        key: `stuck:${e.id}:${e.status}`,
        severity: "fault",
        what: `Episode ${e.id} (${e.lane}) has been "${e.status}" for ${Math.round((long ? Math.max(inStatus, 0) : age) / HOUR)} h${long ? "" : " since it was picked"}`,
        detail: e.title ? `Title: ${e.title}` : undefined,
      });
  }
  return { faults: out, memory: next };
}

/** Digests and summaries count things, failures included; they are not alerts. */
const DIGEST_TEXT =
  /^\W*(📋|alert digest|daily digest|weekly report|growth report)/iu;
const ALERT_RE =
  /paused|needs you|no new short has started|gave up|qa failed|failed|could not|is not on youtube yet/i;
const BACK_ON_RE =
  /back on|resumed|answering again|lifted|recovered|working again/i;
/** Steps only the owner can take. */
export const OWNER_RE =
  /sign in again|signing in again|signed out|verify it.s you|password|full disk access|log in again|reconnect|re-connect|two-step|2-step/i;

/** New factory alerts in the last 90 minutes that say something is wrong, owner-only ones marked (pure). */
export function alertFaults(alerts: readonly Alert[], now: Date): Fault[] {
  const recent = alerts.filter(
    (a) =>
      now.getTime() / 1000 - a.at <= 90 * 60 &&
      !/:digest$|^routine$/.test(a.channel ?? "") &&
      !DIGEST_TEXT.test(a.text),
  );
  const out: Fault[] = [];
  const seen = new Set<string>();
  for (const a of recent) {
    if (
      !(ALERT_RE.test(a.text) || OWNER_RE.test(a.text)) ||
      BACK_ON_RE.test(a.text)
    )
      continue;
    const subject = a.text
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")
      .toLowerCase();
    const cleared = recent.some(
      (b) =>
        b.at > a.at &&
        BACK_ON_RE.test(b.text) &&
        b.text
          .replace(/[^\p{L}\p{N} ]/gu, " ")
          .trim()
          .toLowerCase()
          .startsWith(subject),
    );
    if (cleared) continue;
    const key = `alert:${short(normaliseError(a.text))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = OWNER_RE.test(a.text);
    out.push({
      key,
      severity: "fault",
      what: `Factory alert: ${a.text.replace(/\s+/g, " ").slice(0, 200)}`,
      detail: `Posted ${new Date(a.at * 1000).toISOString()} to ${a.channel ?? "?"}.`,
      ownerOnly: owner,
    });
  }
  return out;
}

export function portFaults(ports: MacFacts["ports"]): Fault[] {
  return ports
    .filter((p) => !p.up)
    .map((p) => ({
      key: `port:${p.hostport}`,
      severity: "fault" as const,
      what: `Port ${p.hostport} is not answering from the Mac (${PORT_ROLE[p.hostport.split(":")[1] ?? ""] ?? "relay"})`,
      confirmRuns: 2,
    }));
}
const PORT_ROLE: Record<string, string> = {
  "8793": "the PC's footage library through the orchestrator relay",
  "8799": "the PC's GPU visuals through the relay",
  "8797": "the Mac's Blender scene service",
};

export function holdFaults(m: MacFacts, now: Date): Fault[] {
  const out: Fault[] = [];
  if (m.ytBlockUntil && m.ytBlockUntil > now.getTime())
    out.push({
      key: "yt-block",
      severity: "warn",
      what: `YouTube downloads are paused by the factory's guard until ${new Date(m.ytBlockUntil).toISOString()} (by design: never get round it)`,
    });
  for (const h of m.gateHeld) {
    if (h.status === "published" || h.status === "rejected") continue;
    out.push({
      key: `gate:${h.id}`,
      severity: "fault",
      what: `The release gate is holding long video ${h.id} (${h.headline ?? ""})`,
      detail: `Held at ${h.at}, status ${h.status}. Find what the gate scored low and fix the cause; approving it is a judgement, not a click.`,
    });
  }
  if (m.holdRestart)
    out.push({
      key: "hold-restart",
      severity: "warn",
      what: "The Mac's hold-restart flag is set (deploys wait)",
    });
  return out;
}

export function pcFaults(pc: PcFacts, now: Date): Fault[] {
  const out: Fault[] = [];
  for (const j of pc.leases.filter((l) => l.project === "pulse")) {
    const est = j.est_min ?? 60;
    const ran = j.granted ? (now.getTime() / 1000 - j.granted) / 60 : 0;
    if (ran > Math.max(est * 2, est + 30))
      out.push({
        key: `orch-overrun:${j.id}`,
        severity: "fault",
        what: `Pulse orchestrator job "${j.job}" has run ${Math.round(ran)} min against an estimate of ${est}`,
        detail:
          "Check its log in the session scratchpad. Only end it if it is ours and plainly stuck; never kill After Effects, aerender or Blender.",
      });
  }
  for (const j of pc.waiting.filter((l) => l.project === "pulse")) {
    const waited = j.created ? (now.getTime() / 1000 - j.created) / 3600 : 0;
    if (waited > 12)
      out.push({
        key: `orch-wait:${j.id}`,
        severity: "warn",
        what: `Pulse job "${j.job}" has waited ${Math.round(waited)} h for its turn`,
      });
  }
  // A Pulse job that failed or expired in the last two hours (the old watch read its log and requeued it).
  for (const h of (pc.orchHistory ?? []).filter(
    (x) =>
      x.project === "pulse" &&
      x.outcome !== "done" &&
      now.getTime() / 1000 - x.end <= 2 * 3600,
  ))
    out.push({
      key: `orchfail:${h.id ?? short(h.job)}`,
      severity: "fault",
      what: `Pulse orchestrator job "${h.job}" ended ${h.outcome} at ${new Date(h.end * 1000).toISOString()}`,
      detail:
        "Read its log in the session scratchpad; fix it if the cause is obvious and requeue at priority 20 with --est.",
    });
  const fresh =
    pc.watchdogAt && now.getTime() - Date.parse(pc.watchdogAt) <= 2 * HOUR;
  if (fresh)
    for (const f of pc.watchdogFaults.filter((x) =>
      /pulse/i.test(x.owner ?? ""),
    ))
      out.push({
        key: `pc:${f.key}`,
        severity: "fault",
        what: `PC watchdog: ${f.what}`,
      });
  if (pc.codexHold)
    out.push({
      key: "codex-hold",
      severity: "warn",
      what: `Codex runner: ${pc.codexHold}`,
    });
  for (const r of pc.taskRuns)
    if (
      r.status === "failed" &&
      now.getTime() - Date.parse(r.started_at) <= 24 * HOUR &&
      !/limit/i.test(r.error ?? "")
    )
      out.push({
        key: `task:${r.taskId}:${r.started_at}`,
        severity: "warn",
        what: `Scheduled task ${r.taskId} failed at ${r.started_at}: ${(r.error ?? "").slice(0, 120)}`,
      });
  return out;
}

/** Every fault from one run's facts (pure). */
export function allFaults(
  m: MacFacts,
  pc: PcFacts,
  plan: SlotPlan | undefined,
  memory: StatusMemory,
  now: Date,
): { faults: Fault[]; memory: StatusMemory; thin: boolean } {
  const pcf = pcFaults(pc, now);
  const hf = healthFaults(m, now);
  if (!m.reachable) return { faults: [...hf, ...pcf], memory, thin: false };
  const disk = diskCheck(m.diskFreeGb);
  // An admin page that did not answer is unknown, not empty: the checks that need it wait (and the stuck clock
  // keeps its memory) rather than calling every slot missed.
  const epsKnown = !m.unknown.includes("episodes");
  const pubKnown = !m.unknown.includes("published");
  const stuck = epsKnown
    ? stuckFaults(m.episodes, memory, now)
    : { faults: [], memory };
  const faults = [
    ...hf,
    ...(m.unknown.length
      ? [
          {
            key: "admin-api",
            severity: "fault" as const,
            what: `The factory's admin pages did not answer: ${m.unknown.join(", ")}`,
            confirmRuns: 2,
          },
        ]
      : []),
    ...(disk.fault ? [disk.fault] : []),
    ...(plan && pubKnown ? missedSlotFaults(plan, m.published, now) : []),
    ...(plan && pubKnown && epsKnown
      ? longSlotFaults(plan, m.episodes, m.published, now)
      : []),
    ...logFaults(m.log, m.episodes, now),
    ...(epsKnown ? failedFaults(m.episodes, now) : []),
    ...stuck.faults,
    ...alertFaults(m.alerts, now),
    ...portFaults(m.ports),
    ...holdFaults(m, now),
    ...pcf,
  ];
  return { faults, memory: stuck.memory, thin: disk.thin };
}

/** True while the Mac renders: remotion, ffmpeg or headless Chrome running (pure over the probe's process list). */
export function rendering(procs: readonly string[]): boolean {
  return procs.some((p) => /remotion|ffmpeg|chrome-headless-shell/i.test(p));
}
