"""Word timings for a narration, for the factory's narration check (src/qa/narration.ts).

Uses faster-whisper on CUDA (the PC) or MLX Whisper (the Mac), whichever this Python has.
Usage: python whisperwords.py <audio> <out.json>   ->  {"duration": s, "words": [{"text", "start", "end"}]}
"""
import json
import sys


def faster(src):
    from faster_whisper import WhisperModel

    model = WhisperModel("medium.en", device="cuda", compute_type="float16")
    segments, info = model.transcribe(src, word_timestamps=True, beam_size=5, condition_on_previous_text=False)
    words = [
        {"text": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)}
        for seg in segments
        for w in (seg.words or [])
    ]
    return info.duration, words


def mlx(src):
    import mlx_whisper

    out = mlx_whisper.transcribe(src, path_or_hf_repo="mlx-community/whisper-medium.en-mlx", word_timestamps=True, condition_on_previous_text=False)
    words = [
        {"text": w["word"].strip(), "start": round(w["start"], 2), "end": round(w["end"], 2)}
        for seg in out.get("segments", [])
        for w in seg.get("words", [])
    ]
    return (words[-1]["end"] if words else 0), words


def main():
    src, dest = sys.argv[1], sys.argv[2]
    try:
        duration, words = faster(src)
    except ImportError:
        duration, words = mlx(src)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({"duration": duration, "words": words}, f)
    print("words", len(words))


if __name__ == "__main__":
    main()
