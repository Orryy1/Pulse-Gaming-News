import type {
  AssetProgress,
  AutonomousStatus,
  PlatformStatus,
} from "../types/story";
import { apiGet, apiGetAuthed, apiMutate } from "./http";
import { clearToken, ensureToken, getToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Mutating calls route through apiMutate so every POST attaches the
// operator's API token. The 2026-04-20 audit found this wrapper was
// missing: every dashboard action that hits a requireAuth route was
// 401ing silently in production because the old code sent no
// Authorization header. Do NOT inline `fetch()` POST/PUT/DELETE calls
// in new code — use apiMutate so the auth contract stays consistent.

// Dashboard needs the full editorial payload (scripts, hooks,
// pinned comments, platform IDs, etc.) to render the approve/retry/
// publish UI. /api/news was sanitised on 2026-04-20 to a minimal
// public shape — the full shape now lives at /api/news/full behind
// the Bearer token. If the operator hasn't entered their token yet,
// apiGetAuthed prompts once just like apiMutate would.
export async function fetchStories() {
  return apiGetAuthed<unknown>("/api/news/full");
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
  // 2026-04-20 telemetry gate: /api/hunter/status now requires Bearer.
  return apiGetAuthed<{ active: boolean }>("/api/hunter/status");
}

export async function triggerPublish() {
  return apiMutate("/api/publish");
}

export async function fetchPublishStatus() {
  return apiGetAuthed<unknown>("/api/publish-status");
}

// Dashboard MP4 download.
//
// Before the 2026-04-20 artefact-route fix we used a plain <a
// download> click which fires a browser navigation with no request
// headers — so draft videos (story not yet publicly visible) would
// 404 under the new Bearer gate. Switch to fetch+blob so the
// Authorization header travels, then trigger the download via an
// object URL. Keeps the same "click → file lands on disk" UX, just
// via memory instead of a direct navigation.
export async function downloadVideo(id: string) {
  const token = ensureToken();
  const res = await fetch(
    `${API_BASE}/api/download/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 401) {
    clearToken();
    throw new Error(
      "API token required or invalid. Try the download again and enter a fresh token.",
    );
  }
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `pulse-gaming-${id}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  return apiGetAuthed<AutonomousStatus>("/api/autonomous/status");
}

export async function fetchPlatformStatus(): Promise<PlatformStatus> {
  return apiGetAuthed<PlatformStatus>("/api/platforms/status");
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
  // /api/progress is gated on requireAuthHeaderOrQuery as of the
  // 2026-04-20 telemetry lockdown. EventSource can't set headers, so
  // the server also accepts `?token=` on this one endpoint. We read
  // the token synchronously (no prompt — the SPA shouldn't open an
  // unsolicited prompt the moment the page loads); if the operator
  // hasn't entered one yet the stream just 401s and the hook's
  // onError fires.
  const token = getToken();
  const url = token
    ? `${API_BASE}/api/progress?token=${encodeURIComponent(token)}`
    : `${API_BASE}/api/progress`;
  const es = new EventSource(url);
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
