"""Word timings for a narration, for the factory's narration check (src/qa/narration.ts).

Uses faster-whisper on CUDA (the PC) or MLX Whisper (the Mac), whichever this Python has.
WHISPER_DEVICE=cpu runs faster-whisper on the CPU (int8, WHISPER_THREADS threads, 8 by default): the stream index
does (src/vodindex/build.ts, 26 Nov 2026), so no second CUDA model loads and frees beside Ollama's vision model.
Usage: python whisperwords.py <audio> <out.json>   ->  {"duration": s, "words": [{"text", "start", "end"}]}
"""
import json
import os
import sys

# CTranslate2 on Windows can abort while freeing the CUDA model (0xC0000409), which used to kill the
# script before it wrote anything. The model is kept alive here and the process leaves without
# running destructors once the words are safely on disk.
_MODEL = None


def faster(src):
    from faster_whisper import WhisperModel

    global _MODEL
    device = os.environ.get("WHISPER_DEVICE") or "cuda"
    name = os.environ.get("WHISPER_MODEL") or "medium.en"
    beam = int(os.environ.get("WHISPER_BEAM") or 5)
    if device == "cpu":
        threads = int(os.environ.get("WHISPER_THREADS") or 8)
        _MODEL = model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)
    else:
        _MODEL = model = WhisperModel(name, device=device, compute_type="float16")
    segments, info = model.transcribe(src, word_timestamps=True, beam_size=beam, condition_on_previous_text=False)
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
    print("words", len(words), flush=True)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
