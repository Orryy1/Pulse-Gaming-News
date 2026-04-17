# Inference Startup Forensics Plan

Scope: when the local VoxCPM 2 inference service (`tts_server/`) hangs or silently dies during boot, what evidence do we capture and how do we use it to root-cause.

This plan pairs with the Phase 1B safetensors watchdog (commit `626fe04`) and the Phase 1C forensic instrumentation. The watchdog contains the failure; the instrumentation exists to find the cause.

**Status:** instrumentation, not fix. Root cause of the 2026-04-17 hang is still unknown. This plan exists so the next hang leaves better artefacts than the last one.

## Candidate failure modes

| Mode                                  | Symptom                                              | Distinguishing evidence                                                                                                  | Captured by                                                |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Silent native crash (SIGSEGV/SIGABRT) | Process exits, no Python traceback                   | `faulthandler.<boot>.log` has a stack trace; process exit code                                                           | `faulthandler.enable(file=...)` at import                  |
| Safetensors read deadlock             | Process stays alive, `phase='warming'` forever       | Last phase in `boot_state.json` is `engine_load_call`; periodic faulthandler dump shows stack frozen in safetensors code | `_mark_phase()` + `faulthandler.dump_traceback_later`      |
| Torch/CUDA crash                      | `RuntimeError: CUDA error ...` raised                | Python traceback in `server.log` + `phase='load_exception'` with exception class                                         | Existing `log.exception` + `_mark_phase("load_exception")` |
| Windows sleep / interruption          | Wall-clock jumps forward, monotonic doesn't          | `drift_s > 5` on a phase entry in `boot_state.json.history`                                                              | `_mark_phase()` drift detection                            |
| VRAM / resource exhaustion            | Raises `CUDA out of memory` OR silent kill by OS OOM | VRAM snapshot on each phase entry; last `boot_state.json.history[-1].vram.free_b` approaches 0                           | `_vram_snapshot()` inside `_mark_phase()`                  |

## What the next failing boot now captures

All artefacts live under `tts_server/diag/` by default (override via `BOOT_DIAG_DIR`):

- **`boot_state.json`** — atomically rewritten on every phase transition. Holds:
  - `boot_id`, `pid`, `started_iso` — identity of the attempt
  - `versions` — torch, cuda, safetensors, voxcpm, numpy, python, platform
  - `env` — DEVICE, PREWARM_ON_BOOT, HF_HOME, CUDA_VISIBLE_DEVICES, …
  - `history[]` — ordered phase entries:
    - `phase` name (e.g. `module_imported`, `engine_load_call`, `watchdog_expired`, `ready`)
    - `mono_s` and `wall_s` elapsed from boot
    - `vram` — allocated / reserved / free / total from `torch.cuda.mem_get_info`
    - `drift_s` — wall-clock delta vs monotonic delta since the previous phase
- **`faulthandler.<boot_id>.log`** — line-buffered file written by Python's faulthandler. Catches two classes of evidence in one file:
  - Native crash stacks (SIGSEGV / SIGABRT / SIGFPE / SIGILL).
  - Periodic all-thread dumps every `BOOT_FAULT_DUMP_EVERY_S` seconds (default 60) while the supervisor is warming. If the load thread is wedged, its stack trace appears here without needing to run `py-spy`.
  - An extra dump is forced the moment the watchdog expires.
- **`server.log`** — existing log, now with `[forensics] phase=<p> boot=<id> ...` breadcrumb lines and a one-shot `banner` line at boot. Stdout is now line-buffered so VoxCPM's own prints (e.g. `Loading model from safetensors: ...`) reach disk in real time instead of dying in a buffer.
- **`/health` exposes `boot_id`, `pid`, `diag_dir`** — Node callers can correlate a failed job to the exact boot that served it.

## Interpreting the evidence

### Scenario A: process is still alive, `/health` reports `phase='failed'` with `last_error` containing `PREWARM_WATCHDOG_EXPIRED`

```
# 1. Grab the final state before restarting
cat tts_server/diag/boot_state.json
cat tts_server/diag/faulthandler.<boot_id>.log
# 2. Optional: fresh py-spy dump of the living process
py-spy dump --pid <pid from /health>
# 3. Only now, restart
```

The fault log will already contain a periodic dump from ≤60s before the watchdog expired, plus the forced dump at expiry. Compare stacks across dumps: if every stack is frozen at the same `safetensors::…` frame, it is a deadlock. If the frame advances but never exits, it is progress too slow for the watchdog.

### Scenario B: process exited, no `/health` reachable

```
# 1. Read the last phase the supervisor reached
cat tts_server/diag/boot_state.json   # .phase + .history[-1]
# 2. If the fault log has a trace, that is the crash site
cat tts_server/diag/faulthandler.<boot_id>.log
# 3. Cross-check Windows Event Viewer for a matching python.exe crash
```

If `boot_state.json.history[-1].phase == "engine_load_call"` and the fault log shows a traceback, that traceback _is_ the crash site. If no fault log entry exists, the process was killed externally (OS OOM, manual kill, machine sleep cascade).

### Scenario C: drift detected

Any `history[i].drift_s > 5` means the machine slept (or was paused) between phases. Combine with `HKLM\SYSTEM\...\Power\...` logs if needed — but the drift alone is usually sufficient to blame sleep for the stall.

### Scenario D: VRAM pressure

`history[-1].vram.free_b` approaching zero, or `allocated_b / total_b > 0.95` a few phases before the hang, points at memory pressure. Safetensors with a near-full card is a known wedge path on Windows + CUDA 12.x when other processes hold VRAM.

## Operational flags

| Flag                      | Default           | Effect                                                                          |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `BOOT_DIAG_DIR`           | `tts_server/diag` | Where forensic artefacts are written                                            |
| `BOOT_FAULT_DUMP_EVERY_S` | `60`              | Cadence of periodic all-thread stack dumps to the fault log. Set `0` to disable |
| `PREWARM_WATCHDOG_S`      | `420`             | Wall-clock ceiling on `eng.load()` (Phase 1B)                                   |

## What remains unknown

- Whether the 2026-04-17 hang was a true deadlock, a very slow safetensors read, a driver stall, or a VoxCPM-internal bug.
- Whether the `torch.nn.utils.weight_norm` deprecation warning in the prior log is correlated (likely benign but has never been ruled out).
- Whether `HF_HOME` / `HUGGINGFACE_HUB_CACHE` is pointed at a slow filesystem path on the dev box.

These cannot be answered from the existing log alone. They need one real repro with Phase 1C instrumentation active.

## What should happen next

1. **Live repro.** Boot `tts_server` with `PREWARM_ON_BOOT=true` until the hang reoccurs. Collect `boot_state.json` + `faulthandler.<boot>.log` + `server.log`. Do not purge any artefact before post-mortem.
2. **If repro shows a true deadlock in safetensors:** version-pin `safetensors` / `torch` / `voxcpm` and A/B swap. The requirements file currently floats `torch` via `setup.bat`; pin it during the bisect.
3. **If repro shows VRAM pressure:** change boot order so no other CUDA consumer runs during tts_server startup.
4. **If repro shows sleep/power drift:** wire `lib/power-gate.js` into the tts_server process wrapper (currently only the Node worker uses it).

The next step is **live repro**, not more code. The instrumentation is the diagnostic surface; running it against the real failure is what closes the gap.
