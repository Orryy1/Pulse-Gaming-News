"""Generates the series-signature music candidates with ACE-Step 1.5 on this PC's GPU.

Each series (src/tools/musiclab/briefs.json) gets a few takes of a short sting, a bed to loop under the
narrator and, for the documentaries, a rise that builds into a downbeat. picksig.py then measures them and
keeps the best per series. Nothing here is chosen by ear: this only makes the raw material.

ACE-Step 1.5 is MIT licensed, and its official model cards say the music it makes may be used commercially
(recorded in public/music/signature/LICENCE.md). Turbo DiT only, no language model: the briefs are
instrumental, so the model's lyric and caption reasoning is not needed and the run stays light on memory.

Run through the PC orchestrator, with the ACE-Step environment's Python in isolated mode, from this folder:
  C:\\Claude\\orchestrator\\orch.cmd run --class gpu --project pulse --job "signature music" --priority 20 --est 25 --
    D:\\pulse-tools\\acestep\\.venv\\Scripts\\python.exe -I acegen.py --ace D:\\pulse-tools\\acestep --out <dir> [--only gta_daily] [--takes 4]
Existing takes are kept, so a re-run only fills gaps. Prints one JSON line per take.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ace", required=True, help="the ACE-Step checkout (holds checkpoints/)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--briefs", default=os.path.join(HERE, "briefs.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--takes", type=int, default=0, help="takes per piece (0: the brief's own count)")
    ap.add_argument("--model", default="acestep-v15-turbo")
    a = ap.parse_args()

    briefs = json.load(open(a.briefs, encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    jobs = []
    for series, spec in briefs["series"].items():
        if a.only and series not in a.only.split(","):
            continue
        for piece, p in spec["pieces"].items():
            n = a.takes or p.get("takes", 4)
            for t in range(n):
                seed = int(p.get("seed", 1000)) + t
                dest = os.path.join(a.out, f"{series}__{piece}__s{seed}.wav")
                if os.path.exists(dest):
                    continue
                jobs.append((series, piece, p, spec, seed, dest))
    if not jobs:
        print(json.dumps({"done": 0, "note": "every take already exists"}))
        return

    # Imported only when there is work: loading torch and the model takes most of a minute.
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=a.ace, config_path=a.model, device="cuda", offload_to_cpu=False)
    if not ok:
        print(json.dumps({"error": f"ACE-Step did not start: {msg}"}))
        sys.exit(1)
    done = 0
    for series, piece, p, spec, seed, dest in jobs:
        caption = f"{spec['identity']} {p['caption']} {briefs['house']}"
        params = GenerationParams(
            task_type="text2music",
            caption=caption,
            lyrics="[Instrumental]",
            instrumental=True,
            bpm=spec["bpm"],
            keyscale=f"{spec['key']} major",
            timesignature="4",
            duration=float(p["seconds"]),
            inference_steps=8,
            shift=3.0,
            guidance_scale=7.0,
            seed=seed,
            thinking=False,
            use_cot_metas=False,
            use_cot_caption=False,
            use_cot_language=False,
        )
        config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format="wav")
        t0 = time.time()
        tmp = os.path.join(a.out, "_tmp")
        os.makedirs(tmp, exist_ok=True)
        res = generate_music(dit, None, params, config, save_dir=tmp)
        if not res.success or not res.audios:
            print(json.dumps({"series": series, "piece": piece, "seed": seed, "error": str(res.error)[:300]}), flush=True)
            continue
        os.replace(res.audios[0]["path"], dest)
        done += 1
        meta = dict(series=series, piece=piece, seed=seed, file=os.path.basename(dest), seconds=round(time.time() - t0, 1),
                    model=a.model, bpm=spec["bpm"], key=spec["key"], caption=caption)
        with open(dest[:-4] + ".json", "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1)
        print(json.dumps(meta), flush=True)
    print(json.dumps({"done": done, "asked": len(jobs)}), flush=True)


main()
