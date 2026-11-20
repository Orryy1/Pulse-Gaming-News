// Loads an export of the live tables (JSON files from a read-only copy of the factory's database) for the learning
// core's proof tools: the episodes, the events, the metrics. Never opens the live database.

import fs from "node:fs";
import path from "node:path";
import {
  outcomeOf,
  type EpisodeRow,
  type MetricRow,
  type Outcome,
} from "../learn/outcomes.ts";
import type { EventRow } from "../learn/judges.ts";

export interface LiveExport {
  episodes: Array<Record<string, any>>;
  events: EventRow[];
  notes: EventRow[];
  metrics: MetricRow[];
  outcomes: Outcome[];
}

const read = <T>(dir: string, name: string): T =>
  JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")) as T;

export function loadExport(dir: string): LiveExport {
  const episodes = read<Array<Record<string, any>>>(dir, "episodes");
  const events = read<EventRow[]>(dir, "events");
  const notes = fs.existsSync(path.join(dir, "notes.json"))
    ? read<EventRow[]>(dir, "notes")
    : [];
  const metrics = read<MetricRow[]>(dir, "video_metrics");
  const byEp = new Map<string, MetricRow[]>();
  for (const m of metrics)
    byEp.set(m.episode_id, [...(byEp.get(m.episode_id) ?? []), m]);
  const outcomes = episodes
    .filter(
      (e) =>
        e.status === "published" && e.youtube_video_id && e.lane !== "twin",
    )
    .map((e) => {
      const row: EpisodeRow = {
        id: e.id,
        lane: e.lane,
        story_hash: e.story_hash,
        evergreen_format: e.script_json?.evergreen_format ?? null,
        runtime: e.script_json?.runtime ?? null,
        live: e.story_json?.gameplay?.live ?? null,
        story_type: e.script_json?.story_type ?? null,
        duration: e.assets_json?.durationSeconds ?? null,
        published_at: e.publish_at ?? e.updated_at,
      };
      return outcomeOf(row, byEp.get(e.id) ?? []);
    });
  return { episodes, events, notes, metrics, outcomes };
}
