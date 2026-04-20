import type {
  AssetProgress,
  AutonomousStatus,
  PlatformStatus,
} from "../types/story";
import { apiGet, apiMutate } from "./http";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Mutating calls route through apiMutate so every POST attaches the
// operator's API token. The 2026-04-20 audit found this wrapper was
// missing: every dashboard action that hits a requireAuth route was
// 401ing silently in production because the old code sent no
// Authorization header. Do NOT inline `fetch()` POST/PUT/DELETE calls
// in new code — use apiMutate so the auth contract stays consistent.

export async function fetchStories() {
  return apiGet<unknown>("/api/news");
}

export async function approveStory(id: string, scheduleTime?: string) {
  return apiMutate("/api/approve", { body: { id, scheduleTime } });
}

export async function generateImage(id: string) {
  return apiMutate("/api/generate-image", { body: { id } });
}

export async function generateVideo(id: string) {
  return apiMutate("/api/generate-video", { body: { id } });
}

export async function setSchedule(id: string, scheduleTime: string | null) {
  return apiMutate("/api/schedule", { body: { id, scheduleTime } });
}

export async function retryPublish(id: string) {
  return apiMutate("/api/retry-publish", { body: { id } });
}

export async function triggerHunter() {
  return apiMutate("/api/hunter/run");
}

export async function fetchHunterStatus() {
  return apiGet<{ active: boolean }>("/api/hunter/status");
}

export async function triggerPublish() {
  return apiMutate("/api/publish");
}

export async function fetchPublishStatus() {
  return apiGet<unknown>("/api/publish-status");
}

export function downloadVideo(id: string) {
  const url = `${API_BASE}/api/download/${encodeURIComponent(id)}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `pulse-gaming-${id}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function fetchPostStats(
  postId: string,
  platform: "youtube" | "tiktok",
) {
  return apiGet<unknown>(
    `/api/stats/${encodeURIComponent(postId)}?platform=${platform}`,
  );
}

export async function updateStoryStats(
  id: string,
  stats: { youtube_views?: number; tiktok_views?: number },
) {
  return apiMutate("/api/stats/update", { body: { id, ...stats } });
}

// --- Autonomous endpoints ---

export async function fetchAutonomousStatus(): Promise<AutonomousStatus> {
  return apiGet<AutonomousStatus>("/api/autonomous/status");
}

export async function fetchPlatformStatus(): Promise<PlatformStatus> {
  return apiGet<PlatformStatus>("/api/platforms/status");
}

export async function triggerAutonomousCycle() {
  return apiMutate("/api/autonomous/run");
}

export async function triggerAutoApprove() {
  return apiMutate("/api/autonomous/approve");
}

export async function triggerMultiPlatformPublish() {
  return apiMutate("/api/autonomous/publish");
}

export function connectProgressStream(
  onProgress: (data: AssetProgress) => void,
  onError?: (err: Event) => void,
): EventSource {
  const es = new EventSource(`${API_BASE}/api/progress`);
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.storyId) {
        onProgress(data as AssetProgress);
      }
    } catch {
      // ignore parse errors for non-progress messages
    }
  };
  es.onerror = (err) => {
    onError?.(err);
  };
  return es;
}
