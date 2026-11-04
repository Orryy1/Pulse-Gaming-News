// Where the factory's machine-specific defaults live, so the same code runs on the PC and on the Mac mini
// (the move planned for early Nov 2026). The PC keeps every default it had: Google Drive's G: folder for
// the backups, the tunnel file on D:, the PC orchestrator's client in C:\Claude. On the Mac those Windows
// paths do not exist and some of them are worse than missing: "G:/My Drive/Pulse backups" is a valid
// *relative* path on macOS, so the nightly backup would have landed inside the code folder and been wiped
// by the next deploy. Each function here is pure (the platform and home folder are passed in) so the tests
// can ask both machines' answers on either machine.

/** A path written for Windows ("C:\x", "D:/x"): meaningless on the Mac, where it would read as relative. */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * A setting's value as this machine can use it: unchanged on Windows, and "" (unset) on the Mac when it
 * is a Windows path, so the setting's own Mac default applies. Settings copied from the PC's .env (a start
 * script, a token file) must never be taken as relative paths there.
 */
export function usablePath(value: string, platform: string): string {
  return platform !== "win32" && isWindowsPath(value) ? "" : value;
}

/**
 * A file setting copied from the PC (TIKTOK_TOKEN_PATH=D:/pulse-data/tokens/tiktok.json) as this machine
 * finds it: unchanged on Windows; on the Mac the same file name in `dir`, where the cutover copies it.
 */
export function relocatedFile(
  value: string,
  platform: string,
  dir: string,
): string {
  if (platform === "win32" || !isWindowsPath(value)) return value;
  const name = value.split(/[\\/]/).pop() ?? "";
  return name ? `${dir.replace(/[\\/]$/, "")}/${name}` : "";
}

/** Where the nightly encrypted backups go: the owner's Google Drive on the PC; a folder beside the factory on the Mac (mac/pull-backups.sh copies them to Drive from the PC). */
export function defaultBackupDir(platform: string, home: string): string {
  return platform === "win32"
    ? "G:/My Drive/Pulse backups"
    : `${home}/PulseFactory/backups`;
}

/** The Cloudflare tunnel's config file, which the backup carries: on D: on the PC, beside the factory on the Mac (mac/migrate.sh cutover writes it there). */
export function defaultTunnelConfig(platform: string, home: string): string {
  return platform === "win32"
    ? "D:/pulse-data/cloudflared-pulse.yml"
    : `${home}/PulseFactory/cloudflared-pulse.yml`;
}

/**
 * The PC orchestrator's client module (orch.mjs), or undefined where there is none. The orchestrator is a
 * file lock on the PC: on the Mac a render does not share a GPU with After Effects, and the Mac's own
 * turn-taking (~/orch/macrun.sh) waits behind Pulse's renders by itself. ORCH_CLIENT overrides on both.
 */
export function orchClientUrl(
  platform: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (env.ORCH_CLIENT) return env.ORCH_CLIENT;
  return platform === "win32"
    ? "file:///C:/Claude/orchestrator/orch.mjs"
    : undefined;
}

/** The Python that runs the Codex helper: "python" on Windows; macOS ships only python3. */
export function defaultCodexPython(platform: string): string {
  return platform === "win32" ? "python" : "python3";
}

/** Where the Codex helper (codex_runner.py) lives: the PC orchestrator's folder; on the Mac a copy beside the factory, when one is installed. */
export function defaultCodexRunnerDir(platform: string, home: string): string {
  return platform === "win32"
    ? "C:\\Claude\\orchestrator"
    : `${home}/PulseFactory/codex`;
}
