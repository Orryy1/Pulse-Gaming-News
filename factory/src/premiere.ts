// Documentaries as YouTube Premieres (PREMIERE_DOCS, owner, 14 Nov 2026), first target the GTA launch documentary of
// 21 Nov. Checked 14 Nov 2026 against the current YouTube Data API reference (videos resource, videos.insert and
// update, and the revision history to 3 Nov 2026): there is no premiere field anywhere in the API. status.publishAt
// only schedules an ordinary publish, and liveBroadcasts are for live streams, not uploaded files. A Premiere is set in
// YouTube Studio only.
//
// So a run documentary marked "premiere": true uploads PRIVATE with every piece of metadata ready (title, description
// with chapters, tags, thumbnail, captions), never scheduled, and is put on the premiere list
// (<data>/premiere/pending.json, served to the browser task at /routine/premieres). The Brave browser task follows
// reports\Premiere steps.md: in Studio it sets the video as a Premiere at its slot with the countdown, then posts the
// countdown community post and the X post drafted here, and marks it done (/routine/premiere-done?video=<id>). Discord
// is told at upload. The factory never makes the video public itself; YouTube does that when the Premiere starts.
// Off: the documentary schedules as before.

import fs from "node:fs";
import path from "node:path";

/** What a documentary topic carries when its run entry asked for a Premiere. */
export interface PremiereTopic {
  premiere?: boolean;
}

/** True for an episode whose documentary topic asked for a Premiere, with PREMIERE_DOCS on (pure). */
export function isPremiereDoc(
  premiereDocs: boolean,
  factcheck: unknown,
): boolean {
  if (!premiereDocs) return false;
  const t =
    (factcheck as
      | { doc?: boolean; topic?: PremiereTopic }
      | null
      | undefined) ?? undefined;
  return Boolean(t?.doc && t.topic?.premiere);
}

/** The privacy a premiere documentary uploads with: private, and so never scheduled (src/youtube/upload.ts). */
export function premierePrivacy<P extends string>(
  premiere: boolean,
  privacy: P,
): P | "private" {
  return premiere ? "private" : privacy;
}

export interface PendingPremiere {
  episode: string;
  videoId: string;
  title: string;
  /** ISO: when the Premiere starts (the run entry's slot). */
  at: string;
  studioUrl: string;
  watchUrl: string;
  /** Drafts for the browser task: the countdown community post and the X post (no links in X's first line). */
  communityPost: string;
  xPost: string;
  status: "pending" | "set";
  addedAt: string;
  setAt?: string;
}

/** "Saturday 21 November at 17:00 UK time (12pm Eastern)" (pure). */
export function premiereWhen(at: Date): string {
  const uk = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => uk.find((p) => p.type === t)?.value ?? "";
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    .replace(":00", "")
    .replace(/\s?([AP])M/, (_m, x: string) => `${x.toLowerCase()}m`);
  return `${get("weekday")} ${get("day")} ${get("month")} at ${get("hour")}:${get("minute")} UK time (${et} Eastern)`;
}

/** The posts for the countdown (pure): Pulse's friendly voice, no em dashes, no subscribe ask. */
export function premierePosts(
  title: string,
  videoId: string,
  at: Date,
): { communityPost: string; xPost: string } {
  const when = premiereWhen(at);
  const url = `https://youtu.be/${videoId}`;
  return {
    communityPost: `Our new documentary premieres ${when}: "${title}". Set a reminder on the premiere page and watch it with us, chat open. ${url}`,
    xPost: `New documentary, premiering ${when}:\n${title}\nSet a reminder and watch it with us: ${url}`,
  };
}

/** Studio's edit page for a video. */
export const studioUrl = (videoId: string) =>
  `https://studio.youtube.com/video/${videoId}/edit`;

export const premiereFile = (dataDir: string) =>
  path.join(dataDir, "premiere", "pending.json");

export function readPremieres(dataDir: string): PendingPremiere[] {
  try {
    const o = JSON.parse(
      fs.readFileSync(premiereFile(dataDir), "utf8"),
    ) as unknown;
    return Array.isArray(o) ? (o as PendingPremiere[]) : [];
  } catch {
    return [];
  }
}

function writePremieres(dataDir: string, list: PendingPremiere[]): void {
  const file = premiereFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file);
}

/** Puts a video on the premiere list (idempotent by video). Returns the entry. */
export function addPremiere(
  dataDir: string,
  e: { episode: string; videoId: string; title: string; at: Date },
  now: Date,
): PendingPremiere {
  const list = readPremieres(dataDir);
  const had = list.find((x) => x.videoId === e.videoId);
  if (had) return had;
  const entry: PendingPremiere = {
    episode: e.episode,
    videoId: e.videoId,
    title: e.title,
    at: e.at.toISOString(),
    studioUrl: studioUrl(e.videoId),
    watchUrl: `https://youtu.be/${e.videoId}`,
    ...premierePosts(e.title, e.videoId, e.at),
    status: "pending",
    addedAt: now.toISOString(),
  };
  list.push(entry);
  writePremieres(dataDir, list);
  return entry;
}

/** The browser task's "done": the Premiere is set in Studio. False when the video is not on the list. */
export function markPremiereSet(
  dataDir: string,
  videoId: string,
  now: Date,
): boolean {
  const list = readPremieres(dataDir);
  const e = list.find((x) => x.videoId === videoId);
  if (!e) return false;
  e.status = "set";
  e.setAt = now.toISOString();
  writePremieres(dataDir, list);
  return true;
}

/** The ones still to set whose start is ahead (pure): the browser task's worklist. A start in the past is too late. */
export function premieresToSet(
  list: PendingPremiere[],
  now: Date,
): PendingPremiere[] {
  return list.filter(
    (p) =>
      p.status === "pending" && Date.parse(p.at) > now.getTime() + 30 * 60_000,
  );
}

/** The Discord notice at upload (pure). */
export function premiereNotice(e: PendingPremiere): string {
  return `🎬 Uploaded PRIVATE for a Premiere: "${e.title}". Premiere set-up is Studio-only (the YouTube API has no premiere option), so the Brave premiere task sets it as a Premiere for ${premiereWhen(new Date(e.at))} with the countdown, then posts the countdown community post and the X post (steps: reports\\Premiere steps.md). Studio: ${e.studioUrl}`;
}
