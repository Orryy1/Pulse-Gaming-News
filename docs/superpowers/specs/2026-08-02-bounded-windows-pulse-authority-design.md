# Bounded Windows Pulse Authority Design

**Status:** Approved by the operator on 2 August 2026

**Outcome:** Replace whole-workstation shell interpretation with one positively identified Windows Scheduled Task authority, then complete one bounded YouTube canary release cycle.

## Problem

The current release delta contains valuable database, sequencing, crash-recovery and evidence controls. It also grew a general-purpose classifier that tries to decide whether arbitrary PowerShell, `cmd.exe`, Node and Scheduled Task commands could eventually launch Pulse. Independent review continued to find valid execution forms after each expansion.

That parser is an unbounded language-analysis problem and is not the right production boundary. Pulse needs to prove which specific authority can own its runtime, database leases and publication path. It does not need to prove that every unrelated shell on the workstation is harmless.

## Decision

The first canary will use the existing `PulseGaming-LiveGuarded-YouTube-Runtime` Windows Scheduled Task as the sole Pulse production authority.

The authority is valid only when a continuous chain binds all of the following:

1. exact task name, path, principal, trigger, settings and action
2. exact Node executable path
3. exact permanent checkout and real path
4. exact release commit SHA
5. exact runtime-profile hash
6. exact database file identity
7. exact activation and owner receipts
8. exact Scheduled Task instance GUID and engine PID
9. exact supervisor and child PIDs plus creation times
10. exact child parentage and Windows Job Object membership
11. exact port ownership
12. exact scheduler and publisher database leases

Known legacy Pulse tasks remain explicit conflicts and must be absent or disabled. Unrelated PowerShell, Codex, Desktop Commander, Ollama, Plex and maintenance processes are outside this authority boundary and are not parsed as potential Pulse owners.

### Alternatives considered

- **Continue the global command classifier:** rejected because it is open-ended, already large and does not directly prove Pulse ownership.
- **Dedicated Windows service account or service:** a credible later upgrade, but larger than required for the first canary.
- **Dedicated VM or machine:** the strongest long-term isolation, but it delays the immediate proof cycle and is not required before one guarded YouTube canary.

## Scope

### Retain from the current eight-file delta

- exact canonical checkout, path and database identity
- no-link and no-path-swap protections
- continuous transition-lease fencing
- activation-receipt absence throughout local proof
- exact predecessor database bindings
- sequential PRIMARY then STANDBY draining
- exact `LOCAL_PROOF` completion attestations
- deterministic, immutable and crash-recoverable evidence
- secret-safe blocker reporting
- quarantine correctness
- WAL checkpoint, backup and restore verification

### Remove or retire from the delta

- PowerShell grammar expansion
- `cmd.exe` grammar expansion
- arbitrary JavaScript and Node AST execution analysis
- shell alias and environment-expansion catalogues
- command-line blacklists for unrelated processes
- the runtime TypeScript dependency added only for JavaScript parsing
- parser-only tests that do not exercise an actual Pulse authority

### Out of scope before the canary

- a new renderer generation
- secondary-platform publishing
- a service-account migration
- a VM or cloud migration
- another content lane or product surface
- further parser families
- feature work not tied to a demonstrated escape from the exact Pulse boundary

## Authority model

### Quiescent maintenance state

The exact-plan drain, quarantine and WAL operations may proceed only when:

- the exact live task definition is absent or identity-valid and disabled
- the exact live task has no running instances
- every configured legacy conflict task is absent or disabled
- the activation receipt is absent
- the owner receipt is absent, or is an exact stale receipt whose bound PIDs and creation times are confirmed dead and archived through the existing governed lane
- port 3001 has no listener
- the exact production database identity matches the request
- the live-runtime transition lease is held continuously by the maintenance operation
- no live scheduler or publisher lease exists outside that transition

No scan of unrelated process command lines is part of this decision.

### Live state

The runtime is GREEN only when:

- the exact task XML validates against the immutable checkout, release SHA, profile hash and Node executable
- exactly one instance of that task is running
- the instance engine PID equals the owner receipt's supervisor PID
- the supervisor PID and creation time match the live process
- the child PID and creation time match the live process
- the child's parent PID equals the supervisor PID
- the supervisor and child executable paths equal the reviewed Node executable
- the supervisor command fingerprint equals the reviewed supervision command
- the child command fingerprint equals the reviewed `server.js` command
- the child PID is present in the current task process's Windows Job Object membership list
- port 3001 has exactly one listener and it is the child PID
- `/api/health` reports the exact release commit, live guarded profile and expected worker topology
- the `scheduler:primary` lease is unexpired and its metadata `process_id` equals the child PID
- any active `publisher:global` lease belongs to the same child PID and a currently admitted publication operation
- the activation receipt, owner receipt and profile remain unchanged

Any missing, malformed, unavailable or contradictory targeted observation produces HOLD.

## Components

### 1. Exact Scheduled Task inspection

Extend the existing live-runtime task inspection rather than enumerate every task on the machine. Query only:

- `PulseGaming-LiveGuarded-YouTube-Runtime`
- the configured `conflicting_task_names`

Validate the existing XML contract. Add a read-only COM query for the exact task's running instances, returning only instance GUID, engine PID and state.

### 2. Exact process inspection

Extend the existing PID-bound process inspector with a narrow authority observation:

- PID
- UTC creation time
- parent PID
- canonical executable path
- SHA-256 of the command line

Raw command lines must not enter public evidence or blocker text.

### 3. Windows Job Object membership

Use one fixed, committed and injected probe that calls `QueryInformationJobObject(NULL, JobObjectBasicProcessIdList, ...)` from within the exact task instance. The result is a bounded list of process IDs in the current task job. The live child must be present.

The probe is static production code. It does not evaluate task-supplied or process-supplied text.

### 4. Database authority

Inspect only the exact production database already bound by canonical file identity. Validate:

- the maintenance transition lease during drain, quarantine and WAL work
- the scheduler lease in live state
- the publisher lease only while a publication operation is active
- lease expiry, owner and metadata process ID

The scheduler and publisher lease owner IDs remain secret-safe in evidence: store stable hashes and exact non-secret process bindings rather than raw owner IDs.

### 5. Bounded authority evidence

Produce `pulse-windows-bounded-authority-v1` evidence with:

- mode: `QUIESCENT` or `LIVE`
- exact release and profile bindings
- task definition fingerprint
- task instance fingerprint
- owner receipt fingerprint
- process identity fingerprints
- job membership result
- listener result
- database identity and lease result
- a GREEN or HOLD verdict
- stable, enumerated blocker codes

Evidence must exclude environment values, raw command lines, OAuth material, tokens and raw lease owner IDs.

## Integration

`inspectWindowsPulseQuiescence` remains the compatibility entry point used by the exact drain, quarantine and WAL consumers, but its implementation becomes a thin adapter over the bounded authority inspector.

The adapter preserves the existing fail-closed quiescence contract while deleting the dependency on whole-machine command parsing. Its process, task and listener attestations refer only to the positively identified Pulse boundary.

The live-runtime start and doctor paths consume the same bounded inspector after task launch. This prevents two definitions of production ownership.

## Failure handling

- A targeted probe failure is HOLD, never inferred success.
- A mismatched task definition is treated as foreign and is not changed automatically.
- A stale receipt is archived only after PID plus creation-time death is proven.
- A PID reuse mismatch is HOLD.
- An unexpected task instance, listener, lease or job member is HOLD.
- A lost transition, scheduler or publisher lease stops the corresponding operation.
- A possible remote YouTube creation is reconciled before any retry.
- Failures expose stable codes and hashes only.

## Testing

### Focused unit tests

- exact task XML and task-instance identity
- task instance count and engine PID binding
- PID reuse and creation-time drift
- executable, parent PID and command-fingerprint drift
- current Job Object membership present, missing and unavailable
- exact port ownership
- scheduler and publisher lease process binding
- quiescent and live evidence schemas
- secret-safe failures
- unrelated workstation processes do not affect the verdict

### Consumer tests

- exact-plan drain
- standby quarantine
- WAL clean-close and restore
- Windows live guarded runtime

### Release verification

- all focused suites on Node 22
- full Node 22 repository suite
- dashboard build
- agent-rules check
- docs doctor
- secret scan
- independent hash-bound whole-diff review
- pushed external CI at the exact release SHA

## Bounded release cycle

After code review and external CI are GREEN:

1. clear the pending Windows reboot and restore adequate system-drive headroom
2. pause Codex, Desktop Commander and maintenance automations for the cutover window
3. verify and rehearse a production database backup restore
4. create the permanent D: checkout at the exact reviewed SHA
5. copy ignored `.env` without displaying it and compare only its SHA-256
6. preserve existing output and reuse completed provider-ledger narration and timing
7. create one immutable successor production plan
8. drain PRIMARY then STANDBY sequentially in `LOCAL_PROOF`
9. inspect fresh GREEN media and receipts
10. back up again
11. install and activate exactly one bounded runtime authority
12. verify live task, process, job, port, health and database lease identity
13. admit one fresh eligible YouTube window
14. upload privately once, wait for processing, arm one `publishAt`, observe the public transition and reconcile the remote object
15. freeze engineering changes and observe the canary

## Hard stop

No further cutover feature is permitted before the reconciled canary unless it closes a demonstrated route by which an actual Pulse task, exact entry point, task instance, process, Windows job, port, database lease or database owner escaped this boundary.

Unrelated shell syntax is not evidence of such an escape.
