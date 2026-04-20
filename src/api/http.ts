// Thin fetch wrapper that centralises auth-header attachment and 401
// handling for the dashboard API layer. All mutating dashboard calls
// route through `apiMutate`; all public read-only calls route through
// `apiGet`. news.ts is the only module that calls these directly —
// components never touch `fetch` themselves.
//
// Design notes:
//   - `apiGet` never sends Authorization. The backend leaves GETs
//     public (they surface story lists, status, analytics). If that
//     ever changes, lift the header-attach logic out of `apiMutate`
//     into a shared helper.
//   - `apiMutate` calls `ensureToken()` before every request, which
//     will prompt the operator exactly once per session.
//   - A 401 response clears the stored token and throws a clearly
//     worded "API token required or invalid" so the UI never hides
//     the failure behind a generic "Failed to approve story".
//   - Error messages are passed through `redactToken` so a stray
//     token can't leak via `alert` / thrown `Error.message` / Sentry.

import { clearToken, ensureToken, getToken } from "./auth";
import { isAuthError, redactToken } from "./authCore.mjs";

const API_BASE = import.meta.env.VITE_API_URL || "";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const msg = redactToken(
      `GET ${path} failed with ${res.status}`,
      getToken(),
    );
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// Authenticated GET — for operator-only endpoints that still use
// the GET verb (e.g. /api/news/full, which is a read but returns
// the full editorial payload). Mirrors apiMutate's auth handling:
// ensureToken() prompts once, 401 clears + throws a clear operator
// error, any error message is redacted before surfacing.
export async function apiGetAuthed<T = unknown>(path: string): Promise<T> {
  const token = ensureToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(redactToken(`GET ${path} failed: ${raw}`, token));
  }
  if (isAuthError(res)) {
    clearToken();
    throw new Error(
      "API token required or invalid. Reload the page and enter a fresh token.",
    );
  }
  if (!res.ok) {
    throw new Error(redactToken(`GET ${path} failed (${res.status})`, token));
  }
  return (await res.json()) as T;
}

interface MutateOptions {
  method?: "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
}

export async function apiMutate<T = unknown>(
  path: string,
  opts: MutateOptions = {},
): Promise<T> {
  const method = opts.method || "POST";
  const token = ensureToken(); // throws with operator-friendly message
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Network-level failure — redact just in case the URL got into
    // the error message somewhere.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(redactToken(`${method} ${path} failed: ${raw}`, token));
  }

  if (isAuthError(res)) {
    // Token rejected. Clear so the next call re-prompts, and surface
    // an explicit operator-facing message (not a generic "Failed to
    // approve").
    clearToken();
    throw new Error(
      "API token required or invalid. Try the action again and enter a fresh token.",
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") detail = `: ${data.error}`;
    } catch {
      /* non-JSON body is fine */
    }
    throw new Error(
      redactToken(`${method} ${path} failed (${res.status})${detail}`, token),
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    // Some mutating endpoints return an empty body on success.
    return {} as T;
  }
}

export { getToken, clearToken };
