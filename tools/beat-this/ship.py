"""Writes the Beat This! export the app ships: public/models/beat_this_<ckpt>.onnx as ONE file (weights inside, no
external .onnx.data) plus a .sha256 beside it (Design 3.2). Fixed input (1, 1500, 128): 30 s windows at 50 fps.

Run from the repo root: tools/.venv-beat/bin/python -I tools/beat-this/ship.py [small0]
Re-run export.py first only if the export itself changes; this script re-exports and folds the weights in.
"""
import hashlib
import sys
import tempfile
from pathlib import Path

import onnx
import torch
from beat_this.inference import load_model

FRAMES = 1500


def main() -> None:
    ckpt = sys.argv[1] if len(sys.argv) > 1 else "small0"
    model = load_model(ckpt, device="cpu").eval()
    spect = torch.zeros(1, FRAMES, 128)
    with torch.no_grad():
        model(spect)  # warm-up: rotary embeddings cache their tables on the first call, and export fails without it
    out = Path("public/models") / f"beat_this_{ckpt}.onnx"
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "m.onnx"
        torch.onnx.export(model, (spect,), str(path), input_names=["spect"], output_names=["beat", "downbeat"], opset_version=18, dynamo=True)
        m = onnx.load(str(path), load_external_data=True)
    onnx.checker.check_model(m)
    onnx.save_model(m, str(out), save_as_external_data=False)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_name(out.name + ".sha256").write_text(f"{digest}  {out.name}\n")
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB) sha256 {digest}")


if __name__ == "__main__":
    main()
