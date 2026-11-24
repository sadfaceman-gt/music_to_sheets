"""Reference beats for the local M2a benchmark (Design 18: DSP compared with librosa).

For every audio file in test/ this decodes the song the way librosa does (22.05 kHz mono), tracks beats with
librosa's default beat tracker (Ellis 2007 DP, 120 BPM prior), and writes into test/ref/ (git-ignored):
  <song>.f32   the decoded samples, raw little-endian float32, mono, 22050 Hz
  <song>.json  {"file", "sampleRate", "samples", "durationSec", "tempoBpm", "beats": [seconds], "librosa"}
The Node benchmark (tests/dsp/benchmark.test.ts) runs our tracker on the same .f32 samples.

Run from the repo root: tools/.venv-ref/bin/python -I tools/beat-ref/reference.py [test]
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 512
EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "test")
    out = root / "ref"
    out.mkdir(exist_ok=True)
    songs = sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in EXTS)
    for song in songs:
        y, sr = librosa.load(song, sr=SR, mono=True)
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP, units="time")
        tempo = float(np.atleast_1d(tempo)[0])
        y.astype("<f4").tofile(out / f"{song.stem}.f32")
        meta = {
            "file": song.name,
            "sampleRate": sr,
            "samples": int(len(y)),
            "durationSec": len(y) / sr,
            "tempoBpm": tempo,
            "beats": [round(float(b), 5) for b in beats],
            "librosa": librosa.__version__,
        }
        (out / f"{song.stem}.json").write_text(json.dumps(meta, indent=1))
        print(f"{song.name}: {tempo:.1f} BPM, {len(beats)} beats, {len(y) / sr:.1f} s", flush=True)


if __name__ == "__main__":
    main()
