"""Front-end parity data for M2b: beat_this's LogMelSpect (torchaudio, CPU, float32) on fixed clips, so the TypeScript
log-mel front end can be compared with it (max abs diff 1e-3, Log cycle 5).

For each of the first 3 test/ref/<song>.f32 (22.05 kHz mono), takes a 10 s clip from 60 s (or from 0 when shorter)
and writes test/ref/frontend/<n>.in.f32 (the clip) and <n>.out.f32 (frames x 128, row-major) plus manifest.json:
[{"name", "song", "startSample", "samples", "frames"}]. Also a 1 s 440 Hz sine and a 0.5 s silence clip.

Run from the repo root: tools/.venv-beat/bin/python -I tools/beat-this/frontend_ref.py
"""
import json
from pathlib import Path

import numpy as np
import torch
from beat_this.preprocessing import LogMelSpect

REF = Path("test/ref")
OUT = REF / "frontend"
SR = 22050


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    spect = LogMelSpect(device="cpu")
    clips = []
    for i, f in enumerate(sorted(REF.glob("*.f32"))[:3]):
        y = np.fromfile(f, dtype="<f4")
        start = SR * 60 if len(y) > SR * 75 else 0
        clips.append((f"song{i}", f.stem, start, y[start : start + SR * 10]))
    t = np.arange(SR, dtype=np.float64) / SR
    clips.append(("sine440", None, 0, (0.5 * np.sin(2 * np.pi * 440 * t)).astype("<f4")))
    clips.append(("silence", None, 0, np.zeros(SR // 2, dtype="<f4")))
    manifest = []
    for name, song, start, clip in clips:
        clip = np.ascontiguousarray(clip, dtype="<f4")
        with torch.no_grad():
            s = spect(torch.from_numpy(clip.copy())).numpy().astype("<f4")
        clip.tofile(OUT / f"{name}.in.f32")
        s.tofile(OUT / f"{name}.out.f32")
        manifest.append({"name": name, "song": song, "startSample": int(start), "samples": int(len(clip)), "frames": int(s.shape[0])})
        print(f"{name}: {len(clip)} samples -> {s.shape[0]} frames, max {s.max():.3f}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
