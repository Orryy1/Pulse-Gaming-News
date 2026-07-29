"""Fail-closed validation for private local-TTS voice references.

The reference audio stays outside the Git checkout.  Callers supply a private
data root plus a relative filename and the immutable fingerprint/probe contract
that the deployment expects.  Returned diagnostics deliberately omit absolute
paths so health endpoints cannot disclose private filesystem layout.
"""

from __future__ import annotations

import hashlib
import wave
from pathlib import Path
from typing import Any, Dict, Mapping, Optional


_CLEARED_RIGHTS_STATUSES = {"CLEARED", "OWNED", "LICENSED"}


def _normalise_sha256(value: Optional[str]) -> str:
    candidate = str(value or "").strip().lower()
    if len(candidate) != 64 or any(ch not in "0123456789abcdef" for ch in candidate):
        return ""
    return candidate


def validate_voice_reference(
    *,
    data_root: str,
    relative_path: str,
    expected_sha256: str,
    expected_probe: Optional[Mapping[str, Any]] = None,
    rights_status: str = "UNVERIFIED",
    rights_evidence_reference: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate one WAV reference without exposing its absolute path.

    ``technical_ready`` requires a contained regular WAV file whose SHA-256
    and audio probe match the configured contract. ``production_ready`` also
    requires an explicit cleared/owned/licensed rights status.
    """

    reasons = []
    expected_probe = dict(expected_probe or {})
    safe_relative_path = str(relative_path or "").replace("\\", "/")
    expected_hash = _normalise_sha256(expected_sha256)
    normalised_rights = str(rights_status or "UNVERIFIED").strip().upper()
    rights_evidence_present = bool(str(rights_evidence_reference or "").strip())
    actual_hash = ""
    probe: Dict[str, Any] = {}
    path_valid = False
    hash_matches = False
    probe_matches = False

    try:
        root = Path(data_root).expanduser().resolve(strict=True)
        supplied = Path(relative_path)
        if supplied.is_absolute():
            raise ValueError("reference path must be relative to the private data root")
        candidate = (root / supplied).resolve(strict=True)
        candidate.relative_to(root)
        if not candidate.is_file():
            raise ValueError("reference is not a regular file")
        if candidate.suffix.lower() != ".wav":
            raise ValueError("reference must be a WAV file")
        path_valid = True
    except (OSError, RuntimeError, ValueError) as exc:
        candidate = None
        reasons.append(f"path_invalid:{exc}")

    if not expected_hash:
        reasons.append("expected_sha256_invalid")
    elif candidate is not None:
        hasher = hashlib.sha256()
        try:
            with candidate.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    hasher.update(chunk)
            actual_hash = hasher.hexdigest()
            hash_matches = actual_hash == expected_hash
            if not hash_matches:
                reasons.append("sha256_mismatch")
        except OSError as exc:
            reasons.append(f"sha256_probe_failed:{exc}")

    if candidate is not None:
        try:
            with wave.open(str(candidate), "rb") as wav:
                frames = wav.getnframes()
                sample_rate = wav.getframerate()
                channels = wav.getnchannels()
                sample_width_bytes = wav.getsampwidth()
                compression = wav.getcomptype()
            duration_seconds = frames / sample_rate if sample_rate else 0.0
            probe = {
                "format": "wav",
                "duration_seconds": round(duration_seconds, 6),
                "sample_rate_hz": sample_rate,
                "channels": channels,
                "sample_width_bits": sample_width_bytes * 8,
                "compression": compression,
            }
            probe_reasons = []
            expected_duration = float(expected_probe.get("duration_seconds", 0))
            duration_tolerance = float(
                expected_probe.get("duration_tolerance_seconds", 0.25)
            )
            expected_sample_rate = int(expected_probe.get("sample_rate_hz", 0))
            expected_channels = int(expected_probe.get("channels", 0))
            if expected_duration <= 0:
                probe_reasons.append("expected_duration_missing")
            elif abs(duration_seconds - expected_duration) > duration_tolerance:
                probe_reasons.append("duration_mismatch")
            if expected_sample_rate <= 0:
                probe_reasons.append("expected_sample_rate_missing")
            elif sample_rate != expected_sample_rate:
                probe_reasons.append("sample_rate_mismatch")
            if expected_channels <= 0:
                probe_reasons.append("expected_channels_missing")
            elif channels != expected_channels:
                probe_reasons.append("channels_mismatch")
            if compression != "NONE":
                probe_reasons.append("wav_compression_unsupported")
            probe_matches = not probe_reasons
            reasons.extend(probe_reasons)
        except (OSError, EOFError, wave.Error) as exc:
            reasons.append(f"wav_probe_failed:{exc}")

    rights_cleared = normalised_rights in _CLEARED_RIGHTS_STATUSES
    if not rights_cleared:
        reasons.append(f"rights_not_cleared:{normalised_rights or 'UNVERIFIED'}")
    elif not rights_evidence_present:
        reasons.append("rights_evidence_missing")

    technical_ready = path_valid and hash_matches and probe_matches
    return {
        "relative_path": safe_relative_path,
        "technical_ready": technical_ready,
        "production_ready": (
            technical_ready and rights_cleared and rights_evidence_present
        ),
        "path_valid": path_valid,
        "hash_matches": hash_matches,
        "probe_matches": probe_matches,
        "expected_sha256": expected_hash or None,
        "actual_sha256": actual_hash or None,
        "probe": probe,
        "rights_status": normalised_rights or "UNVERIFIED",
        "rights_evidence_present": rights_evidence_present,
        "reasons": reasons,
    }
