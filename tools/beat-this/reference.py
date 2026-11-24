"""Reference beats from Python Beat This! for the M2b parity test (our ONNX + TypeScript pipeline must match these).

For every test/ref/<song>.f32 (librosa's 22.05 kHz mono decode, see tools/beat-ref/reference.py) this runs beat_this
with the given checkpoint (default small0, minimal postprocessing, GPU when available) and writes
test/ref/<song>.beatthis-<ckpt>.json: {"checkpoint", "beats": [s], "downbeats": [s], "beat_this", "torch"}.

Run from the repo root: tools/.venv-beat/bin/python -I tools/beat-this/reference.py [small0]
"""
import json
import sys
from importlib.metadata import version
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import Audio2Beats

REF = Path("test/ref")


def main() -> None:
    ckpt = sys.argv[1] if len(sys.argv) > 1 else "small0"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    a2b = Audio2Beats(checkpoint_path=ckpt, device=device, dbn=False)
    for meta_path in sorted(p for p in REF.glob("*.json") if p.with_suffix(".f32").exists()):
        meta = json.loads(meta_path.read_text())
        y = np.fromfile(meta_path.with_suffix(".f32"), dtype="<f4")
        beats, downs = a2b(y, meta["sampleRate"])
        out = {
            "checkpoint": ckpt,
            "beats": [round(float(b), 5) for b in beats],
            "downbeats": [round(float(d), 5) for d in downs],
            "beat_this": version("beat-this"),
            "torch": torch.__version__,
        }
        (REF / f"{meta_path.stem}.beatthis-{ckpt}.json").write_text(json.dumps(out, indent=1))
        print(f"{meta['file']}: {len(beats)} beats, {len(downs)} downbeats ({device})", flush=True)


if __name__ == "__main__":
    main()
