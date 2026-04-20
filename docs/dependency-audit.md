# Dependency Audit — 2026-04-21

## Shipped in this commit

`npm audit fix` (non-breaking only) applied. Lockfile-only change:

| Package            | Before               | After         | CVE fixed                                                                                                                                                                                                              |
| ------------------ | -------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axios`            | `1.0.0-1.14.0` range | latest 1.15.x | [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5) (NO_PROXY SSRF bypass) + [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx) (cloud metadata exfil via header injection) |
| `follow-redirects` | `<=1.15.11`          | latest patch  | [GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653) (auth header leak on cross-domain redirect)                                                                                                   |

Both are transitively-used (axios is a direct dep of our code;
follow-redirects is pulled in by axios itself). Verified by running
`npm test` (376/376 pass) and `npm run build` (clean Vite build)
after the upgrade.

The axios upgrade is directly relevant to [Task 9's SSRF
audit](./url-fetch-safety-audit.md) — the two CVEs are exactly the
class of bug the `lib/safe-url.js` helper addresses from the
caller side.

---

## Deferred to a future (breaking) PR

### Production dependency

| Package             | Current  | Fix                                                                                 | Reason deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/sdk` | `0.80.0` | `0.90.0` ([GHSA-5474-4w2j-mq4c](https://github.com/advisories/GHSA-5474-4w2j-mq4c)) | **Major upgrade** (0.80 → 0.90). The CVE is in the Memory Tool path validation — Pulse Gaming does NOT use the Memory Tool feature (we only call `messages.create` for script generation in `processor.js`, `entities.js`, and `ab_titles.js`). Exposure is effectively zero. The upgrade requires a careful walk of the SDK's breaking changes (new `Anthropic` constructor shape, type changes around `messages.stream`, tool-use response types). Safer in its own PR with a manual smoke of the produce pipeline. |

### Dev dependency (build toolchain only)

| Package                | Current    | Fix          | Reason deferred                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild` (via `vite`) | `<=0.24.2` | Vite 8 major | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — dev server CORS bypass. **Dev-only** (runs only under `npm run dev`, not in production). Vite 5 → 8 is a two-major-versions jump with non-trivial config changes (Rollup 5, new SSR story, plugin API changes). Production build output is unaffected. Defer to when the dashboard UX needs a feature from a newer Vite. |

---

## How to re-run the audit

```bash
npm audit --omit=dev         # prod-only (the one that matters)
npm audit                    # full graph including dev chain
npm outdated                 # candidate upgrades (not all security)
```

`npm audit fix` is safe to re-run whenever the ecosystem publishes
a non-breaking patch. Force-upgrading majors should always go
through a dedicated PR with its own test run.

---

## Current posture after this commit

```
production dependencies:  1 moderate (@anthropic-ai/sdk — not exploitable given usage)
dev dependencies:          1 moderate (esbuild — dev server only)
```

No critical / high vulnerabilities on either side. Nothing
blocking the 19:00 UTC publish window.
