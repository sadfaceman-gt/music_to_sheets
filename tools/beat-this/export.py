"""Pre-cycle check for M2b: export a Beat This! checkpoint to ONNX (fixed 1500-frame = 30 s window, 128 mel bands)
and save a test spectrogram with PyTorch's logits for a parity check in Node (onnxruntime-node).

Run from the repo root: tools/.venv-beat/bin/python -I tools/beat-this/export.py [small0] [out_dir]
Writes <out>/beat_this_<ckpt>.onnx, <out>/parity_in.f32 (1500x128), <out>/parity_beat.f32, <out>/parity_down.f32.
"""
import sys
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import load_model
from beat_this.preprocessing import LogMelSpect

FRAMES = 1500


def main():
    ckpt = sys.argv[1] if len(sys.argv) > 1 else "small0"
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "test/onnx")
    out.mkdir(parents=True, exist_ok=True)
    model = load_model(ckpt, device="cpu").eval()
    ref = sorted(p for p in Path("test/ref").glob("*.f32"))[0]
    y = np.fromfile(ref, dtype="<f4")[22050 * 60 : 22050 * 60 + 441 * FRAMES + 1024]
    spect = LogMelSpect(device="cpu")(torch.from_numpy(y.copy()))[:FRAMES].unsqueeze(0)
    with torch.no_grad():
        ref_out = model(spect)
    onnx_path = out / f"beat_this_{ckpt}.onnx"
    torch.onnx.export(model, (spect,), str(onnx_path), input_names=["spect"], output_names=["beat", "downbeat"], opset_version=18, dynamo=True)
    spect.numpy().astype("<f4").tofile(out / "parity_in.f32")
    ref_out["beat"].numpy().astype("<f4").tofile(out / "parity_beat.f32")
    ref_out["downbeat"].numpy().astype("<f4").tofile(out / "parity_down.f32")
    n_params = sum(p.numel() for p in model.parameters())
    print(f"exported {onnx_path} ({onnx_path.stat().st_size / 1e6:.1f} MB, {n_params / 1e6:.2f} M params), input {tuple(spect.shape)}, from {ref.name}")


if __name__ == "__main__":
    main()
