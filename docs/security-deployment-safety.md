# Security Deployment Safety

Pulse Gaming treats credential handling as a publish gate, not a cleanup task. This runbook records the controls that Goal 23 can verify without reading `.env`, `tokens/` or any live credential value.

## Credential Controls

- Token rotation: rotate platform credentials at least every 90 days and immediately after any suspected exposure, platform incident or operator handover.
- Least privilege: keep OAuth scopes to the smallest set needed for the current platform task. Upload scopes, page publishing scopes and analytics read-only scopes are allowed only when the matching platform path is enabled.
- No credential logs: logs may record status, reason codes and report paths. They must not print access credentials, refresh credentials, authorisation codes, state values, credential file contents or credential file paths.
- Scoped OAuth: new scopes require an operator review note before the authorisation flow is rerun.

## Deployment Controls

- Environment separation: `LOCAL_PROOF` and `DRY_RUN_PUBLISH` are the default modes for development and proof runs. Live platform actions require an explicit operator-enabled platform and a GREEN control tower verdict.
- Human review: AMBER items route to `HUMAN_REVIEW`. RED items remain blocked.
- Kill switch: live posting requires a healthy emergency kill switch before any limited auto-publish mode can run.
- Retry logging: every upload retry must record platform, story id, attempt count, reason code and repair lane without credential material.
- Audit trail: every publish-capable package must keep production audit logs, lineage manifests and platform preflight artefacts.
- Rollback path: every live action needs a correction or takedown path before scheduling.
- Safe API handling: local proof, repair and readiness commands must not post externally, mutate OAuth state or touch production rows unless the command is an explicit controlled repair with backup and audit output.
