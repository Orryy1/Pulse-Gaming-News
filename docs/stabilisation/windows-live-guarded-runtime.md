# LIVE_GUARDED Windows boot runtime

This is a separate reviewed Windows profile for the exact governed YouTube
runway. It does not replace or weaken
`windows-local-runtime.governed-multi-lane.json`, which remains the safe
`HUMAN_REVIEW` profile with publication disabled.

The live profile is committed at
`config/windows-local-runtime.live-guarded-youtube.json`. It is:

- pinned to one exact clean `release/pulse-v1` commit or that commit detached
- pinned to the fully migrated `D:/pulse-data/pulse.db`
- `governed_multi_lane`
- `LIVE_GUARDED`
- YouTube-only
- blocked while the existing safe-runtime task is enabled
- supervised by a hidden, noninteractive `SYSTEM` Scheduled Task at machine
  startup
- independent of an interactive logon and resilient across user logoff

This code has not installed, enabled or started that task. The default command
is a read-only doctor.

## Authority boundary

`AUTO_PUBLISH=true` can enter the child process only after the supervisor
validates an explicit activation receipt. The receipt is bound to:

- the exact source commit
- the committed profile fingerprint
- the SQLite path
- the complete migration-set fingerprint
- `governed_multi_lane`
- `LIVE_GUARDED`
- YouTube as the only automated platform
- healthy kill-switch semantics
- a fresh GREEN control-tower requirement for every release
- the durable remote YouTube `publishAt` commitment contract

The receipt has no silent calendar expiry. Commit, profile or migration drift
invalidates it. Disabling the task then revoking the receipt is the supported
kill-switch path. The long-running supervisor rechecks the receipt and live
runtime health. It terminates the child after revocation or repeated health
failure. A disabled task cannot restart it.

The receipt is boot authority, not publication evidence. Every candidate still
requires exact human approval, rights and QA bindings, a fresh GREEN control
tower at the governed release commitment and the exact runway chain. The
doctor therefore never reports production GREEN.

## Read-only doctor

From the dedicated clean runtime checkout:

```powershell
$repo = "C:\Pulse\runtime\pulse-v1"
$commit = (git -C $repo rev-parse HEAD).Trim()

npm run ops:windows-live-guarded-runtime -- doctor `
  --repo-root $repo `
  --expected-commit $commit
```

The JSON report separates profile, checkout, migration, activation, task,
conflicting-owner and control-policy evidence. `READY` proves the boot profile
only. `HOLD` is expected until the explicit cutover is completed.

No doctor or plan command reads, prints or changes OAuth or token values. The
database is opened read-only and the supervisor never runs migrations.

## Explicit cutover sequence

Cutover is an operator change window, not an automatic deployment step.
Complete these in order:

1. Prepare the dedicated clean checkout and apply migrations through the
   reviewed migration procedure.
2. Stop and disable the existing safe runtime with its own supervisor.
3. Issue the exact activation receipt.
4. Install the new Scheduled Task. Installation always leaves it disabled and
   never starts it.
5. Run the doctor again.
6. Enable the exact managed task. Enablement never runs it immediately. The
   task starts at the next machine boot.

Every mutating command requires both `--apply` and this exact confirmation:

```powershell
$confirm = "LIVE_GUARDED_YOUTUBE_SYSTEM_RUNTIME"
```

Receipt issuance also requires a named operator and a reason:

```powershell
npm run ops:windows-live-guarded-runtime -- issue-activation `
  --repo-root $repo `
  --expected-commit $commit `
  --operator-id "named-operator" `
  --reason "Reviewed governed YouTube runway activation" `
  --apply --confirm $confirm
```

Install disabled:

```powershell
npm run ops:windows-live-guarded-runtime -- install `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

Enable for the next machine boot:

```powershell
npm run ops:windows-live-guarded-runtime -- enable `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

Install and enable reject profile or activation-path overrides. They also reject
a dirty checkout, source-commit mismatch, missing or drifted migrations,
unmanaged task identity and an enabled safe-runtime task.

## Revocation

Disable first so Task Scheduler cannot restart the host:

```powershell
npm run ops:windows-live-guarded-runtime -- disable `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm

npm run ops:windows-live-guarded-runtime -- revoke-activation `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

Revocation archives the receipt as local evidence. It does not contact YouTube,
alter OAuth material or delete a remote object. Any already committed remote
YouTube schedule remains governed by the exact disarm and reconciliation
workflow. If installation never created the task, revocation also accepts the
independently inspected `absent` state because no task can restart the host.

Uninstall is allowed only after the exact task is disabled:

```powershell
npm run ops:windows-live-guarded-runtime -- uninstall `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

## Scheduled Task contract

The task is named `PulseGaming-LiveGuarded-YouTube-Runtime` and has:

- one `AtStartup` boot trigger
- principal `SYSTEM` (`S-1-5-18`)
- `ServiceAccount` logon type
- highest available run level
- hidden, noninteractive execution
- `StartWhenAvailable=true`
- no battery or interactive-logon dependency
- `IgnoreNew` overlap protection
- no execution time limit
- one-minute restart-on-failure with 999 attempts
- disabled state at installation

Its action contains only the exact Node executable, committed supervisor path,
exact source commit, repository path and activation-receipt path. It contains
no API key, OAuth value, token or password.

For Windows Task Scheduler XML compatibility, the principal declares the
Local System SID (`S-1-5-18`) and deliberately omits the optional
`LogonType` XML element. Windows registers that SID as a `ServiceAccount`;
post-install inspection must still report `ServiceAccount` before the task is
accepted as managed.
