# Dependency Audit — 2026-07-27

## Current result

The production dependency audit is materially improved but remains `HOLD`.
This is dependency evidence only and grants no deployment or publication
authority.

| Severity | Before | After |
|---|---:|---:|
| Critical | 2 | 0 |
| High | 10 | 2 |
| Moderate | 23 | 20 |
| Low | 1 | 0 |
| Total | 36 | 22 |

The counts above come from `npm audit --omit=dev --json` against the exact
lockfile. They count affected packages in the dependency graph, not distinct
root causes.

## Compatible remediation applied

| Package | Previous lock | Remediated lock | Decision |
|---|---:|---:|---|
| `concurrently` | 9.2.1 | 9.2.4 | Compatible patch update |
| `shell-quote` | 1.8.3 | 1.9.0 | Resolved by `concurrently` 9.2.4 |
| `axios` | 1.15.1 | 1.18.1 | Compatible minor update |
| `postcss` | 8.5.12 | 8.5.23 | Compatible patch update |
| `sharp` | 0.34.5 | 0.35.3 | Reviewed breaking-series update |

The lockfile also carries compatible fixes for the affected Discord HTTP
stack, form handling, Hono, Protocol Buffers, query parsing and WebSocket
packages. No forced install or audit fix was used.

Sharp 0.35.3 requires Node.js 20.9 or newer. Pulse uses Node.js 22 in its
container and Node.js 24 in release CI. The repository does not use the
constructor and metadata properties removed in Sharp 0.35, the renamed JP2
format property, removed sharpen options or AVIF output. The in-memory
resize/composite/PNG smoke, owned-motion image generation and the focused
image validation, thumbnail and visual-prescan tests all passed on 0.35.3.

## Residual risk

### Hyperframes

`hyperframes` 0.4.32 remains a direct production dependency and is the source
of both residual high-severity package findings and one moderate finding:

- `adm-zip` remains on the 0.5 line while the repaired line starts at 0.6
- `@hono/node-server` remains on the 1.x line while the repaired line starts
  at 2.0.5

The current Hyperframes release range cannot select either repaired major.
The latest available Hyperframes release inspected during this audit still
declares the same incompatible dependency families, so changing Hyperframes
versions would not remove this risk. Forcing transitive majors was rejected
because upstream compatibility is unproven.

Containment is limited: invoke the Hyperframes CLI only for trusted local
projects and assets, do not feed it untrusted archives and do not expose its
local server as a public service. Its existing thumbnail project still passes
`hyperframes lint`, but that compatibility proof does not make the dependency
findings disappear. The release remains `HOLD` until the upstream graph is
fixed, Hyperframes is replaced or a separately reviewed risk decision is
recorded.

### Sentry/OpenTelemetry

The other 19 moderate package findings are the Sentry 8.55.2 OpenTelemetry graph.
The registry's remediation requires `@sentry/node` 10.68.0, a major upgrade.
That upgrade was not forced into this dependency pass and needs its own
wrapper, startup and telemetry validation.

## Reproduce

```powershell
npm ci
npm audit --omit=dev --json
npm ls --omit=dev
npm test
npm run build
npm run ops:agent-rules
node tools/ci-secret-scan.js
git diff --check
```

Do not use `npm audit fix --force` to turn the count green without proving the
resulting major-version behaviour.
