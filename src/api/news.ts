import type { AssetProgress } from '../types/story';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchStories() {
  const res = await fetch(`${API_BASE}/api/news`);
  if (!res.ok) throw new Error('Failed to fetch stories');
  return res.json();
}

export async function approveStory(id: string, scheduleTime?: string) {
  const res = await fetch(`${API_BASE}/api/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, scheduleTime }),
  });
  if (!res.ok) throw new Error('Failed to approve story');
  return res.json();
}

export async function generateImage(id: string) {
  const res = await fetch(`${API_BASE}/api/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to queue image generation');
  return res.json();
}

export async function generateVideo(id: string) {
  const res = await fetch(`${API_BASE}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to queue video generation');
  return res.json();
}

export async function setSchedule(id: string, scheduleTime: string | null) {
  const res = await fetch(`${API_BASE}/api/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, scheduleTime }),
  });
  if (!res.ok) throw new Error('Failed to set schedule');
  return res.json();
}

export async function retryPublish(id: string) {
  const res = await fetch(`${API_BASE}/api/retry-publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to retry publish');
  return res.json();
}

export async function triggerHunter() {
  const res = await fetch(`${API_BASE}/api/hunter/run`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to trigger hunter');
  return res.json();
}

export async function fetchHunterStatus() {
  const res = await fetch(`${API_BASE}/api/hunter/status`);
  if (!res.ok) throw new Error('Failed to fetch hunter status');
  return res.json();
}

export async function triggerPublish() {
  const res = await fetch(`${API_BASE}/api/publish`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start publish run');
  return res.json();
}

export async function fetchPublishStatus() {
  const res = await fetch(`${API_BASE}/api/publish-status`);
  if (!res.ok) throw new Error('Failed to fetch publish status');
  return res.json();
}

export function downloadVideo(id: string) {
  const url = `${API_BASE}/api/download/${encodeURIComponent(id)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `pulse-gaming-${id}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function fetchPostStats(postId: string, platform: 'youtube' | 'tiktok') {
  const res = await fetch(
    `${API_BASE}/api/stats/${encodeURIComponent(postId)}?platform=${platform}`
  );
  if (!res.ok) throw new Error(`Failed to fetch ${platform} stats`);
  return res.json();
}

export async function updateStoryStats(id: string, stats: { youtube_views?: number; tiktok_views?: number }) {
  const res = await fetch(`${API_BASE}/api/stats/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...stats }),
  });
  if (!res.ok) throw new Error('Failed to update story stats');
  return res.json();
}

export function connectProgressStream(
  onProgress: (data: AssetProgress) => void,
  onError?: (err: Event) => void
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
