// Browser-only auth helpers. Pure logic lives in `./authCore.js` so
// the Node test suite can cover it without pulling in `window` /
// `localStorage`. Anything that talks to the browser belongs in this
// file; anything testable in isolation belongs in authCore.
//
// Token lifecycle:
//   1. On module load we check the URL for `?token=…` (Discord
//      approval links and one-shot operator bookmarks use this). If
//      present, we save it to localStorage and strip it from the URL
//      so it doesn't leak via `document.referrer` or clipboard
//      copies.
//   2. `getToken()` returns the currently stored token (or null).
//   3. `ensureToken()` returns a token or prompts the operator for
//      one. Throws a clearly-worded error if they cancel the prompt.
//   4. `clearToken()` wipes storage (called on 401 responses). The
//      next mutating action re-prompts.

import { normaliseToken, parseTokenFromUrl } from "./authCore.mjs";

const STORAGE_KEY = "pulse.apiToken";

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    return normaliseToken(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setToken(raw: string): boolean {
  const clean = normaliseToken(raw);
  if (!clean) return false;
  const store = safeStorage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, clean);
    return true;
  } catch {
    return false;
  }
}

export function clearToken(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// One-shot URL capture. Called exactly once on module load. Separated
// so the module's top level has a clear side-effect surface.
function captureTokenFromUrl(): void {
  if (typeof window === "undefined") return;
  const fromUrl = parseTokenFromUrl(window.location.href);
  if (!fromUrl) return;
  setToken(fromUrl);
  // Strip ?token= from the URL so it doesn't get copy-pasted or
  // sent as a referrer to image CDNs etc.
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("token");
    window.history.replaceState({}, "", u.pathname + u.search + u.hash);
  } catch {
    /* noop — leaving the query is a minor privacy concern, not fatal */
  }
}

captureTokenFromUrl();

// Expose a tiny operator console for the case where the token is
// rejected mid-session and the operator wants to reset without
// reloading. No token values are ever logged from here.
if (typeof window !== "undefined") {
  (window as unknown as { pulseAuth?: unknown }).pulseAuth = {
    clear: clearToken,
    // `set` lets the operator paste a token in devtools without
    // triggering a prompt. We deliberately do NOT expose `get()` —
    // the whole point is to keep the value out of casual view.
    set: (raw: string) => setToken(raw),
  };
}

/**
 * Return a valid token for a mutating request. If none is stored,
 * prompt the operator once. Throws a descriptive error if they
 * cancel, so the caller can surface a helpful message in the UI
 * instead of a silent failure.
 */
export function ensureToken(): string {
  const existing = getToken();
  if (existing) return existing;
  if (typeof window === "undefined") {
    throw new Error(
      'API token required. Set window.pulseAuth.set("<token>") and retry.',
    );
  }
  let raw: string | null;
  try {
    raw = window.prompt(
      "Pulse API token required for this action.\n\nPaste the API_TOKEN from the Railway environment:",
    );
  } catch {
    throw new Error(
      'API token required. Open the dashboard with ?token=... or run window.pulseAuth.set("<token>") in DevTools and retry.',
    );
  }
  if (raw == null) {
    // Operator dismissed the prompt. Surface a specific error so the
    // UI layer doesn't render a generic "Failed to approve story".
    throw new Error("API token required or invalid — action cancelled.");
  }
  const clean = normaliseToken(raw);
  if (!clean) {
    throw new Error(
      "API token required or invalid — the value entered looks too short.",
    );
  }
  setToken(clean);
  return clean;
}
