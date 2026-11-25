"""Pre-cycle check for M2b: Beat This! runs here, on CPU and GPU, on the librosa-decoded test songs (test/ref/*.f32).

Run from the repo root: tools/.venv-beat/bin/python -I tools/beat-this/check.py [final0,small0] [cpu|cuda]
Prints per song: device, seconds, beats, downbeats, tempo, and the beat F-measure (±70 ms) against librosa's beats.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import Audio2Beats

REF = Path("test/ref")


def fmeasure(est, ref, win=0.07):
    est, ref = np.asarray(est), np.asarray(ref)
    if len(est) == 0 or len(ref) == 0:
        return 0.0
    used, hits = set(), 0
    for t in ref:
        d = np.abs(est - t)
        for i in np.argsort(d):
            if d[i] > win:
                break
            if i not in used:
                used.add(i)
                hits += 1
                break
    p, r = hits / len(est), hits / len(ref)
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)


def main():
    ckpts = sys.argv[1].split(",") if len(sys.argv) > 1 else ["final0", "small0"]
    devices = [d for d in (["cpu", "cuda"] if torch.cuda.is_available() else ["cpu"]) if d in (sys.argv[2:3] or ["cpu", "cuda"])]
    print("torch", torch.__version__, "cuda", torch.version.cuda, "gpu", torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)
    songs = sorted(p for p in REF.glob("*.json") if p.with_suffix(".f32").exists())
    for ckpt in ckpts:
        for dev in devices:
            a2b = Audio2Beats(checkpoint_path=ckpt, device=dev, dbn=False)
            a2b(np.zeros(22050 * 5, dtype=np.float32), 22050)  # warm-up
            for meta_path in songs:
                meta = json.loads(meta_path.read_text())
                y = np.fromfile(meta_path.with_suffix(".f32"), dtype="<f4")
                t0 = time.perf_counter()
                beats, downs = a2b(y, meta["sampleRate"])
                if dev == "cuda":
                    torch.cuda.synchronize()
                secs = time.perf_counter() - t0
                tempo = 60 / np.median(np.diff(beats)) if len(beats) > 1 else 0
                f = fmeasure(beats, meta["beats"])
                print(f"{ckpt:7} {dev:4} {secs:6.2f} s  {len(beats):4} beats {len(downs):4} downbeats  {tempo:6.1f} BPM  F={f:.3f}  {meta['file']}", flush=True)


if __name__ == "__main__":
    main()
