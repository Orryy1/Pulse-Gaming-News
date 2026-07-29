# Pulse Gaming Codex Skill Routing Design

## Objective

Make the current global Codex skills the default working method for future Pulse Gaming runs without copying skill files into the repository or weakening the project’s existing safety and publishing rules.

## Context

- The active Pulse Gaming chat works from `C:\Users\MORR\gaming-studio\pulse-gaming`.
- The repository already has a detailed root `AGENTS.md`, which is the canonical project-instruction surface.
- Pulse Gaming has more than twenty linked worktrees. Duplicating policy into each worktree would create drift.
- An existing thread keeps its already-loaded skill catalogue. A fork or new run is required to load newly installed skills, while the repository and transcript can remain continuous.

## Considered Approaches

### 1. Repository-root routing policy — selected

Add a compact section to the existing root `AGENTS.md`. It tells Codex to begin with Superpowers’ routing workflow and selects the relevant debugging, design, test, parallelisation and verification skills according to the task.

This is the smallest durable change. It preserves a single source of truth and applies automatically to future runs based in the repository.

### 2. Copy the policy into every worktree

This would affect each current checkout immediately after a new run, but every copy could diverge. The worktree count makes maintenance and review disproportionate to the benefit.

### 3. Vendor complete skill instructions into the repository

This could make instructions visible without the global skill catalogue, but it would duplicate installed packages and become stale after upgrades. It is explicitly out of scope.

## Policy

The root `AGENTS.md` will gain a `Codex Skill Routing` section with these rules:

- Start each task with `superpowers:using-superpowers` and invoke only the skills relevant to the current goal.
- Use `superpowers:brainstorming` before feature, architecture or behavioural design.
- Use `superpowers:systematic-debugging` for defects, regressions and unexplained failures.
- Use `superpowers:test-driven-development` for behaviour-changing implementation.
- Use `superpowers:dispatching-parallel-agents` only for independent work that will not create overlapping edits.
- Use `superpowers:verification-before-completion` before claiming success, and `superpowers:requesting-code-review` for material changes.
- Route media and video work through the relevant installed HyperFrames, Remotion or media workflow in addition to the applicable Superpowers process skill.
- Never copy installed skill bodies into this repository. If a named skill is unavailable, report that clearly and use the closest applicable installed workflow.

Existing Pulse Gaming cardinal rules and hard stops remain higher-priority project constraints.

## Rollout

1. Add the policy to the tracked root `AGENTS.md`.
2. Do not edit generated or linked-worktree copies independently.
3. Fork the active Pulse Gaming thread, or start a new run from the same project, to load the current global skill catalogue and the updated project instructions.
4. Continue from the existing project state; do not repeat completed implementation.

## Verification

- Confirm only the intended `AGENTS.md` section and this design document change.
- Start a fresh ephemeral Codex run in the Pulse Gaming repository.
- Verify that it reports the new routing policy and all 14 `superpowers:*` skills.
- Verify that the existing cardinal rules and hard stops are still present.

## Non-goals

- Rewriting Pulse Gaming’s technical or editorial policy.
- Enabling every skill for every task.
- Updating every historical worktree independently.
- Altering the transcript or hidden system context of the existing active thread.
