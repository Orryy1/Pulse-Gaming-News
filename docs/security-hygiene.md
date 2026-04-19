# Security hygiene — Pulse Gaming

Short, durable operator guide. Written alongside the hygiene patch that
extended `.gitignore` to stop secret-bearing files from being committed.

The Pulse Gaming repo is **public** on GitHub
(`Orryy1/Pulse-Gaming-News`). Anything committed is publicly
harvestable. Secret scanners (trufflehog, GitHub secret scanning, Gitrob)
pick up leaked tokens within minutes, so the rotation window after a
leak is short.

## Repository hygiene rules

1. **No secrets in the repo.** Not in committed files, not in history,
   not in commit messages, not in PR descriptions.
2. **Secrets live in Railway variables** (`railway variables --kv` lists
   the current set) or in the local `.env` file (already gitignored).
3. **Tokens live on the persistent volume** (`/data/tokens/`) when the
   runtime needs file-backed storage. Paths are configured via env vars
   like `TIKTOK_TOKEN_PATH=/data/tokens/tiktok_token.json`.
4. **Never paste a token value into the terminal** if you have the shell
   history plugin enabled. Use env-var injection (`railway variables
--set`) or direct Railway UI entry instead.
5. **Never run `git add .` without checking `git status` first.** On
   Windows, `git add` of an absolute path (`C:/Users/...`) produces a
   file whose name contains a fullwidth-colon private-use character
   (U+F03A). The file looks "outside the repo" to later `git` commands
   but is still tracked — the exact shape of the 2026-03-30 Railway
   token leak fixed by this hygiene patch.

## What's gitignored (see `.gitignore`)

Secret-bearing / token files:

- `tokens/` (all contents — OAuth tokens, cookies, browser profiles)
- `.youtube_token*`, `.github_token*`, `.railway_token*`
- `railway_deploy.bat`, `railway_deploy.sh`, `railway_deploy.ps1`
- `CUsersMORR*`, `C*UsersMORR*`, `*railway_deploy.bat` — catches the
  Windows-fullwidth-colon filename shape

Local SQLite:

- `data/` (all — DB, WAL, SHM, deploy locks)

Logs / diagnostics:

- `*.log`
- `tts_server/diag/`, `tts_server/server.log*`, `tts_server/venv/`,
  `tts_server/boot_state.json`

Local test assets / editor state:

- `test_videos/`, `test_imagen.jpg`, `engagement_stats.json`
- `.claude/settings.local.json`, `.claude/launch.json`

## When a secret leaks

The repo is public and `git` retains history indefinitely. Removing a
secret from HEAD does **not** remove it from history. Treat any secret
that touched a git object as permanently compromised.

Operator checklist when a leak is found:

1. **Rotate the credential immediately** at the issuing service
   (Railway, Google Cloud, Facebook, TikTok, ElevenLabs, Anthropic).
2. Update the new credential in Railway variables.
3. Remove the file from HEAD (`git rm --cached <file>`, commit, push).
4. Add a `.gitignore` rule that makes the same file shape impossible to
   re-add accidentally.
5. Optional: `git filter-repo` to scrub the blob from history. This is
   **destructive** (rewrites history, breaks clones, invalidates
   deploys). Only do this when you have explicit sign-off and a plan
   for re-establishing the Railway deploy from the rewritten main.

## Known leaks this patch addresses

### Railway token (`CUsersMORRrailway_deploy.bat`)

- Committed in `23da3f9` (2026-03-30) with the message "Fix video
  assembly: real images + TikTok captions working".
- Present in git history under a Windows-fullwidth-colon filename.
- Repo is public, so treat the Railway token baked into this file as
  compromised.
- **Operator action required:** rotate the Railway account token /
  deploy token today. The token in that file is blown.
- This hygiene patch removes it from HEAD and adds `.gitignore` rules
  so the same shape can't recur. The blob is still in history; a
  `git filter-repo` scrub is a separate decision.

### `.youtube_token.json` at repo root

- Untracked today (never committed), but was not in `.gitignore` so
  a future `git add .` would silently include it.
- This hygiene patch adds a `.youtube_token*` rule so the file stays
  out of future commits.
- **No operator action required** unless you can confirm the file was
  ever pushed; a public-repo grep didn't surface it, so the YouTube
  refresh token is most likely still safe. If in doubt, rotate via the
  Google Cloud Console.

## Token storage — summary by platform

| Platform    | Storage                                            | Persistent? |
| ----------- | -------------------------------------------------- | ----------- |
| YouTube     | env vars (`YOUTUBE_REFRESH_TOKEN` etc.)            | yes         |
| Instagram   | env var (`INSTAGRAM_ACCESS_TOKEN`)                 | yes         |
| Facebook    | env var (`FACEBOOK_PAGE_TOKEN`)                    | yes         |
| Twitter / X | env vars (4× `TWITTER_*`), gated by                | yes         |
|             | `TWITTER_ENABLED=true` — off by default            |             |
| TikTok      | file on Railway volume                             | yes (since  |
|             | `TIKTOK_TOKEN_PATH=/data/tokens/tiktok_token.json` | 171072c)    |
| SQLite      | file on Railway volume                             | yes         |
|             | `SQLITE_DB_PATH=/data/pulse.db`                    |             |

Anything NOT in this table shouldn't be file-backed on Railway. If
you're tempted to add a new file-backed credential, use env vars first
and only escalate to a volume path when env vars genuinely don't fit.

## Before every commit

Quick three-line checklist the operator can run in the terminal:

```
git status --ignored --short | head      # nothing sensitive in the "??" section
git diff --cached -- .env\*              # empty
git ls-files | grep -i "token\|secret\|railway_deploy" | head   # empty
```

If any of those produce output, stop and verify before committing.
