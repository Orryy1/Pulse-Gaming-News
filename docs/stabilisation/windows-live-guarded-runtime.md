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

Nothing in this workflow installs, enables or starts the task automatically.
The default command is a read-only doctor.

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
requires exact evidence-bound candidate authority, rights and QA bindings, a
fresh GREEN control tower at the governed release commitment and the exact
runway chain. Eligible low-risk official-source stories may use the governed
rubric auto-approval path. Uncertain, rights-sensitive or AMBER stories remain
held for review. The activation receipt grants neither candidate approval nor
publication permission, and the doctor never reports production GREEN.

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
conflicting-owner, start-operation-lock and control-policy evidence. `READY`
proves the boot profile only. A `start` doctor reports top-level `HOLD`
whenever the port, owner, start-operation lock or other start-specific state
is blocked, even if the underlying boot profile is otherwise ready.
Task-query errors are blockers rather than evidence that a conflicting task is
absent. `HOLD` is expected until the explicit cutover is completed.

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
6. Enable the exact managed task. Enablement never runs it immediately.
7. Either run the separately guarded `start` action after its doctor is ready,
   or reboot the machine. Reboot remains the fallback and starts the same
   exact `SYSTEM` task through its `AtStartup` trigger.

Every mutating command requires both `--apply` and this exact confirmation:

```powershell
$confirm = "LIVE_GUARDED_YOUTUBE_SYSTEM_RUNTIME"
```

Receipt issuance also requires a named operator and a reason:

```powershell
$oauthClientSha = "<fresh-account-binding-client-sha256>"

npm run ops:windows-live-guarded-runtime -- issue-activation `
  --repo-root $repo `
  --expected-commit $commit `
  --operator-id "named-operator" `
  --reason "Reviewed governed YouTube runway activation" `
  --youtube-oauth-client-sha256 $oauthClientSha `
  --apply --confirm $confirm
```

Install disabled:

```powershell
npm run ops:windows-live-guarded-runtime -- install `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

Enable for guarded start and the next machine boot:

```powershell
npm run ops:windows-live-guarded-runtime -- enable `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

Start without reboot:

```powershell
npm run ops:windows-live-guarded-runtime -- start `
  --repo-root $repo `
  --expected-commit $commit `
  --apply --confirm $confirm
```

`start` revalidates the exact checkout, database, activation receipt, managed
task identity, competing runtime and stopped port/owner state immediately
before asking Task Scheduler to run the task. A durable cross-process lock and
unique operation nonce serialise start attempts. The supervisor copies that
nonce into its owner receipt, so cleanup belonging to one failed attempt cannot
end or disable a different successful owner.

It reports success only after the local health identity, single listener and
supervisor owner receipt all bind to the expected commit, profile, activation
receipt and operation nonce. Checkout, database, activation, managed-task
identity and conflict state are revalidated again immediately before
`started_verified` evidence is written. Owner, health and single-listener
identity are then read once more after those authority checks, so a runtime
that dies or drifts during revalidation cannot receive successful start
evidence.

Task Scheduler `/Run` errors and timeouts are treated as ambiguous launch
attempts because the task may already have started before the command failed.
They therefore enter the same nonce-owned cleanup path as post-launch
verification failures. Every such failure writes a durable `start-failed`
lifecycle artefact. Cleanup ends and disables a task only after rechecking its
task, lock and owner nonce. The artefact records command failures, task state,
owner clearance and any orphan listener, and sets `stopped_verified` only when
the managed task is disabled, the port is free and the owner receipt has
cleared. It does not contact YouTube, mutate OAuth material or claim production
GREEN.

An exact owner receipt whose processes are dead and whose commit, profile,
database authority and activation binding still match is treated as stale. The
guarded start archives it while holding its exact operation nonce and before
issuing `/Run`; the supervisor still independently enforces exact owner
creation. Invalid, active or mismatched owner receipts block start.

The start-operation lock is durable across CLI failure. A lock is recoverable
only when its recorded process is dead, its commit, profile and activation
bindings are exact, the port has no listener and the owner receipt is absent
or exact-and-dead. Recovery archives the old lock as evidence before acquiring
a new nonce. An active process, mismatched binding, live listener, live owner
or uninspectable state remains `HOLD`.

Install, enable and start reject profile or activation-path overrides. They
also reject a dirty checkout, source-commit mismatch, missing or drifted
migrations, unmanaged task identity and an enabled safe-runtime task.

If guarded start is unavailable or fails closed, leave the task disabled,
resolve the reported blocker, re-enable it and either retry the exact guarded
start or reboot. Do not substitute an ad-hoc `Start-ScheduledTask` command
because that bypasses the lifecycle decision and start evidence.

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
