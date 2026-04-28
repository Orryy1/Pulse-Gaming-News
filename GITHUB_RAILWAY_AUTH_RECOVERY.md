# GitHub and Railway Auth Recovery

Generated: 2026-04-28

## Current state

- Railway CLI access works through `npx @railway/cli`.
- Railway production is inspectable read-only from this machine.
- GitHub CLI is installed but not authenticated.
- Git remote is HTTPS: `https://github.com/Orryy1/Pulse-Gaming-News.git`.
- Local SSH key `id_ed25519_orryy` exists, but GitHub rejected it during SSH auth.

## Why this matters

Railway can deploy from the CLI, but the safer normal path is:

1. commit locally
2. push to GitHub
3. let Railway deploy the GitHub `main` commit
4. verify Railway health against that commit

If GitHub auth is broken, a Railway CLI upload can still deploy, but GitHub and Railway can drift.

## Safe fix path

Run these manually in an interactive terminal. They require user auth and should not be started by an unattended agent.

```powershell
gh auth login
gh auth status
git push origin codex/pulse-full-stabilise-and-learn
```

If HTTPS push should use Git Credential Manager instead:

```powershell
git credential-manager github login
git push origin codex/pulse-full-stabilise-and-learn
```

If SSH is preferred, add the public key to GitHub first:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519_orryy.pub
ssh -T git@github.com
git remote set-url origin git@github.com:Orryy1/Pulse-Gaming-News.git
git push origin codex/pulse-full-stabilise-and-learn
```

## Do not do

- Do not paste GitHub tokens into chat.
- Do not commit credentials.
- Do not change Railway variables to work around GitHub auth.
- Do not deploy from a dirty working tree.

