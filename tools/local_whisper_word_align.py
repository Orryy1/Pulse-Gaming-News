#!/usr/bin/env python
"""Local Whisper word timestamp helper for Pulse Gaming.

Reads one local audio file and writes a small JSON payload to stdout.
This is intentionally local-only: no platform upload, no token access.
"""

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="tiny.en")
    parser.add_argument(
        "--backend",
        choices=("openai-whisper", "faster-whisper"),
        default="openai-whisper",
    )
    parser.add_argument("--prompt", default="")
    parser.add_argument("--device", default=None)
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    if args.backend == "faster-whisper":
        from faster_whisper import WhisperModel

        device = args.device or "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        model = WhisperModel(args.model, device=device, compute_type=compute_type)
        transcribed_segments, info = model.transcribe(
            args.audio,
            language="en",
            task="transcribe",
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
            initial_prompt=args.prompt or None,
        )
        segments = list(transcribed_segments)
        payload = {
            "model": f"faster-whisper:{args.model}",
            "backend": args.backend,
            "language": info.language,
            "text": " ".join(
                str(segment.text or "").strip()
                for segment in segments
                if str(segment.text or "").strip()
            ),
            "segments": [],
        }
        for segment in segments:
            payload["segments"].append(
                {
                    "id": segment.id,
                    "start": segment.start,
                    "end": segment.end,
                    "text": str(segment.text or "").strip(),
                    "words": [
                        {
                            "word": str(word.word or "").strip(),
                            "start": word.start,
                            "end": word.end,
                        }
                        for word in (segment.words or [])
                    ],
                }
            )
    else:
        import whisper

        model = whisper.load_model(args.model, device=args.device)
        result = model.transcribe(
            args.audio,
            language="en",
            task="transcribe",
            verbose=None,
            word_timestamps=True,
            fp16=False,
            condition_on_previous_text=False,
            initial_prompt=args.prompt or None,
        )
        payload = {
            "model": args.model,
            "backend": args.backend,
            "language": result.get("language"),
            "text": result.get("text", "").strip(),
            "segments": [],
        }
        for segment in result.get("segments", []):
            payload["segments"].append(
                {
                    "id": segment.get("id"),
                    "start": segment.get("start"),
                    "end": segment.get("end"),
                    "text": str(segment.get("text", "")).strip(),
                    "words": [
                        {
                            "word": str(word.get("word", "")).strip(),
                            "start": word.get("start"),
                            "end": word.get("end"),
                        }
                        for word in segment.get("words", [])
                    ],
                }
            )
    rendered = json.dumps(payload, ensure_ascii=False)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n", encoding="utf-8")
    else:
        sys.stdout.write(rendered + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
