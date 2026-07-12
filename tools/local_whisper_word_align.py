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
    parser.add_argument("--prompt", default="")
    parser.add_argument("--device", default=None)
    parser.add_argument("--output", default="")
    args = parser.parse_args()

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
