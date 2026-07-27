# Governed Windows local runtime cutover

This surface prepares one local Pulse Gaming runtime without authorising a
platform post. It is pinned to port `3001`, `D:/pulse-data/pulse.db`,
`HUMAN_REVIEW`, YouTube-only stabilisation and the `stabilisation_30d`
scheduler profile.

The default action is a read-only plan. It never installs a task, starts or
stops a process, changes OAuth material, applies a migration or writes to the
database.

## Required checkout

Use a dedicated clean checkout, not a development worktree. The checkout may
be on `release/pulse-v1` or detached at the exact reviewed commit.

```powershell
$repo = "C:\Pulse\runtime\pulse-v1"
$commit = (git -C $repo rev-parse HEAD).Trim()
```

The supervisor refuses to start when:

- the supplied commit is not the exact checkout commit
- the checkout has tracked or untracked changes
- `server.js` or `package.json` is missing
- the SQLite file is absent, corrupt, ahead of source or has a pending or
  checksum-mismatched migration
- port `3001` cannot be inspected, is owned by another process or has a stale
  owner receipt
- the committed safety profile has changed

Database inspection opens SQLite with `readonly` and `fileMustExist`. The
supervisor never calls the migration runner.

## Read-only commands

```powershell
npm run ops:windows-local-runtime -- plan `
  --repo-root $repo `
  --expected-commit $commit

npm run ops:windows-local-runtime -- status `
  --repo-root $repo `
  --expected-commit $commit
```

Both commands emit one machine-readable JSON document to standard output.
`production_green` remains `false`: this evidence is a local lifecycle
preflight, not a production-readiness verdict.

## Lifecycle commands

Every lifecycle command is a dry run unless both `--apply` and the exact
confirmation value are present.

```powershell
$confirm = "SAFE_HUMAN_REVIEW_RUNTIME"

npm run ops:windows-local-runtime -- install `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm

npm run ops:windows-local-runtime -- start `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm

npm run ops:windows-local-runtime -- restart `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm

npm run ops:windows-local-runtime -- stop `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm

npm run ops:windows-local-runtime -- uninstall `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

`install` creates an operator-logon Scheduled Task named
`PulseGaming-Stabilisation-Runtime` at limited privilege. It does not create a
SYSTEM task. `stop` disables a matching managed task before stopping its
receipt-bound process. `uninstall` removes only a task whose command still
matches the exact checkout and commit; it does not stop a running process.

The task model deliberately avoids storing or requesting a Windows password.
It therefore does not promise unattended operation before the operator logs
on. Moving to a service account is a separate security and operations
decision.

## Runtime safety profile

The child receives an allowlisted Windows system environment plus committed
safe overrides. Inherited credentials and inherited publication flags are not
passed through. The runtime can load its normal local `.env`, but the
non-overriding configuration loader preserves these process-level controls:

- `PULSE_OPERATING_MODE=HUMAN_REVIEW`
- `AUTO_PUBLISH=false`
- `PULSE_GUARDED_LIVE_DISPATCH_ENABLED=false`
- both emergency kill-switch flags tripped
- `USE_SQLITE=true` and `USE_JOB_QUEUE=true`
- `PULSE_PRIMARY_INSTANCE=true`
- every known secondary-platform, browser-fallback and token-maintenance
  automation flag false
- standard renderer `studio-v21`; experimental renderer disabled

Owner state, logs and lifecycle receipts live under
`D:/pulse-data/runtime/pulse-v1`. Receipts contain process and configuration
identity only. They do not contain credentials.

## Port and stop safety

The supervisor never adopts an existing listener merely because it is
`node server.js`. A managed listener requires all of:

1. one PID on port `3001`
2. a matching owner receipt
3. the expected process identity
4. `/api/health` reporting the exact commit, local primary mode, SQLite,
   durable queue, `HUMAN_REVIEW` and both publication arms off

Restart and stop refuse foreign listeners. A failed post-start health check
terminates only the child PID that the current invocation created.
