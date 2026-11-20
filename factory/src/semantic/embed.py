"""The picture-and-words embedder behind MATCH_SEMANTIC and VOD_TAGS (src/semantic/embed.ts starts it).

One process, one model (SigLIP 2 by default, Apache 2.0), loaded once and kept while the factory asks; it ends when
its input closes. Each request is one JSON line on stdin, each answer one JSON line on stdout:

  {"id": 1, "op": "info"}                          -> {"id": 1, "model": ..., "dim": 768, "scale": ..., "bias": ...}
  {"id": 2, "op": "image", "files": ["a.jpg"]}      -> {"id": 2, "vectors": ["<base64 float32>", null, ...]}
  {"id": 3, "op": "text", "texts": ["a red car"]}   -> {"id": 3, "vectors": ["<base64 float32>", ...]}

Vectors are unit length, so a dot product is the cosine. SigLIP was trained with a sigmoid, so
sigmoid(scale * cosine + bias) is the model's own probability that a picture shows the words: the factory uses that
as the meaning score. A picture that cannot be read answers null in its place, never an error for the whole batch.

Run by hand: python embed.py --model google/siglip2-base-patch16-224 < requests.jsonl
"""

import argparse
import base64
import json
import os
import sys

DEFAULT_MODEL = "google/siglip2-base-patch16-224"
BATCH = 16


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("SEMANTIC_MODEL") or DEFAULT_MODEL)
    ap.add_argument("--device", default=os.environ.get("SEMANTIC_DEVICE") or "auto")
    ap.add_argument("--threads", type=int, default=int(os.environ.get("SEMANTIC_THREADS") or 4))
    args = ap.parse_args()

    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoModel, AutoProcessor

    torch.set_num_threads(max(1, args.threads))
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device in ("cuda", "mps") else torch.float32
    model = AutoModel.from_pretrained(args.model, dtype=dtype).to(device).eval()
    proc = AutoProcessor.from_pretrained(args.model)
    scale = float(model.logit_scale.exp().item()) if hasattr(model, "logit_scale") else 1.0
    bias = float(model.logit_bias.item()) if getattr(model, "logit_bias", None) is not None else 0.0

    def features(out):
        # transformers 5 may hand back an output object rather than the pooled tensor.
        if isinstance(out, torch.Tensor):
            return out
        for name in ("pooler_output", "image_embeds", "text_embeds"):
            v = getattr(out, name, None)
            if isinstance(v, torch.Tensor):
                return v
        raise RuntimeError("no pooled features in the model's answer")

    def pack(t):
        t = torch.nn.functional.normalize(t.float(), dim=-1).cpu().numpy().astype(np.float32)
        return [base64.b64encode(row.tobytes()).decode("ascii") for row in t]

    def images(files):
        out = [None] * len(files)
        for b in range(0, len(files), BATCH):
            chunk = []
            for i, f in enumerate(files[b:b + BATCH]):
                try:
                    with Image.open(f) as im:
                        chunk.append((b + i, im.convert("RGB")))
                except Exception:
                    pass
            if not chunk:
                continue
            inputs = proc(images=[im for _, im in chunk], return_tensors="pt").to(device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(dtype)
            with torch.no_grad():
                vecs = pack(features(model.get_image_features(**inputs)))
            for (i, _), v in zip(chunk, vecs):
                out[i] = v
        return out

    def texts(items):
        out = []
        for b in range(0, len(items), BATCH):
            chunk = [str(t)[:300] or " " for t in items[b:b + BATCH]]
            inputs = proc(text=chunk, padding="max_length", max_length=64, truncation=True, return_tensors="pt").to(device)
            with torch.no_grad():
                out.extend(pack(features(model.get_text_features(**inputs))))
        return out

    dim = len(base64.b64decode(texts(["a picture"])[0])) // 4

    def answer(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    answer({"id": 0, "ready": True, "model": args.model, "device": device, "dim": dim, "scale": scale, "bias": bias})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            op = req.get("op")
            if op == "info":
                answer({"id": rid, "model": args.model, "device": device, "dim": dim, "scale": scale, "bias": bias})
            elif op == "image":
                answer({"id": rid, "vectors": images(list(req.get("files") or []))})
            elif op == "text":
                answer({"id": rid, "vectors": texts(list(req.get("texts") or []))})
            else:
                answer({"id": rid, "error": f"unknown op {op!r}"})
        except Exception as err:  # one bad request never ends the process
            answer({"id": rid, "error": str(err)[:300]})


if __name__ == "__main__":
    main()
