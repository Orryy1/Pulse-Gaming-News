# TikTok Re-auth Operator Note

Date: 2026-05-01

## Current State

Discord reported:

```text
TikTok token refresh failed — reason: expired
Refresh error: TikTok refresh rejected: invalid_grant
```

`invalid_grant` means the saved refresh token is no longer usable. This is not a normal code bug. TikTok requires the operator to complete OAuth in the browser again.

## Why The Bare URL Shows Unauthorized

Opening this directly:

```text
https://pulse.orryy.com/auth/tiktok
```

returns:

```json
{"error":"Unauthorized"}
```

That is expected. The OAuth starter route is protected by the same operator `API_TOKEN` guard as the dashboard mutation routes. This is deliberate so strangers cannot start auth flows against the app.

## How To Start Re-auth

Use one of these operator-authenticated methods:

1. Use the dashboard/auth button if it supplies the operator token automatically.
2. Or open the URL with the API token query parameter:

```text
https://pulse.orryy.com/auth/tiktok?token=YOUR_API_TOKEN
```

Replace `YOUR_API_TOKEN` with the value from the local `.env` or Railway environment. Do not paste that full URL into Discord or logs.

## Important Limitation

Re-auth only refreshes the local/server token. It does not solve TikTok's external app/API posting blocker.

Expected state after re-auth:

- token file can be renewed;
- scheduled auth checks should stop reporting `invalid_grant`;
- public TikTok auto-posting may still fail with API/app approval errors until TikTok approves the app/scope.

## Safety

No code should try to bypass OAuth.

No background process should trigger this flow.

No browser automation should be used for TikTok auth.

No tokens should be printed in logs, Discord or reports.
