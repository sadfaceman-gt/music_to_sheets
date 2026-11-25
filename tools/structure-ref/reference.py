"""Reference key, chords and sections for the local M2c benchmark (Design 5.3, 5.4, 18).

For every song with test/ref/<song>.f32 (22.05 kHz mono, written by tools/beat-ref/reference.py) and
test/ref/<song>.beatthis-small0.json (beats, written by tools/beat-this/reference.py), this computes, with librosa:
  - beat-synchronous CQT chroma (median per beat)
  - key: Krumhansl-Schmuckler correlation, global and in sliding 16-bar windows (step 4 bars)
  - chords: 24 major/minor templates (centred correlation) + no-chord (constant 0.3), Viterbi smoothing
    (self-transition 0.9)
  - sections: Laplacian structural segmentation (McFee and Ellis 2014, as in librosa's gallery example):
    chroma recurrence (kNN, 4-beat time-delay embedding) + MFCC path continuity, normalised Laplacian,
    k-means on the first k eigenvectors for k = 3..8; the chosen k is the largest eigengap; boundaries snapped to
    downbeats with at least 4 bars per section.
and writes test/ref/<song>.structure.json (git-ignored). It is a reference for agreement checks, not ground truth:
the user's ear judges keys and section labels.

Run from the repo root: tools/.venv-ref/bin/python -I tools/structure-ref/reference.py [test]
"""
import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage
import scipy.sparse.csgraph
import sklearn.cluster

SR = 22050
HOP = 512
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Kessler probe-tone profiles.
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def ks_key(chroma_sum: np.ndarray) -> tuple[str, float]:
    best, best_r = "", -2.0
    for mode, prof in (("major", KK_MAJOR), ("minor", KK_MINOR)):
        for t in range(12):
            r = float(np.corrcoef(chroma_sum, np.roll(prof, t))[0, 1])
            if r > best_r:
                best, best_r = f"{NAMES[t]} {mode}", r
    return best, best_r


def chords(chroma_b: np.ndarray, beats: np.ndarray) -> list[dict]:
    templates, labels = [], []
    for t in range(12):
        for q, iv in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            v = np.zeros(12)
            v[[(t + i) % 12 for i in iv]] = 1
            v -= v.mean()
            templates.append(v / np.linalg.norm(v))
            labels.append((NAMES[t], q))
    T = np.array(templates)
    # Centred correlation: chroma is all positive, so a plain cosine favours flat templates.
    c = chroma_b - chroma_b.mean(axis=0, keepdims=True)
    c /= np.linalg.norm(c, axis=0, keepdims=True) + 1e-9
    score = T @ c  # (24, nbeats), in [-1, 1]
    # No-chord scores a constant: it wins only where no triad correlates well.
    score = np.vstack([score, np.full((1, score.shape[1]), 0.3)])
    labels.append(("N", "N"))
    prob = np.exp(8 * score)
    prob /= prob.sum(axis=0, keepdims=True)
    trans = librosa.sequence.transition_loop(len(labels), 0.9)
    path = librosa.sequence.viterbi(prob, trans)
    out, start = [], 0
    for i in range(1, len(path) + 1):
        if i == len(path) or path[i] != path[start]:
            root, q = labels[path[start]]
            conf = float(np.mean(score[path[start], start:i]))
            out.append({"startBeat": start, "endBeat": i, "root": root, "quality": q, "confidence": round(conf, 3)})
            start = i
    return out


def sections(y: np.ndarray, beat_frames: np.ndarray, downbeat_idx: np.ndarray, nb: int) -> dict:
    C = librosa.amplitude_to_db(np.abs(librosa.cqt(y=y, sr=SR, hop_length=HOP, bins_per_octave=36, n_bins=252)), ref=np.max)
    Csync = librosa.util.sync(C, beat_frames, aggregate=np.median)
    mfcc = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP)
    Msync = librosa.util.sync(mfcc, beat_frames)
    R = librosa.segment.recurrence_matrix(librosa.feature.stack_memory(Csync, n_steps=4), width=3, mode="affinity", sym=True)
    Rf = librosa.segment.timelag_filter(scipy.ndimage.median_filter)(R, size=(1, 7))
    path_d = np.sum(np.diff(Msync, axis=1) ** 2, axis=0)
    sigma = np.median(path_d)
    path_sim = np.exp(-path_d / sigma)
    R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)
    deg_path = np.sum(R_path, axis=1)
    deg_rec = np.sum(Rf, axis=1)
    mu = deg_path.dot(deg_path + deg_rec) / np.sum((deg_path + deg_rec) ** 2)
    A = mu * Rf + (1 - mu) * R_path
    L = scipy.sparse.csgraph.laplacian(A, normed=True)
    evals, evecs = np.linalg.eigh(L)
    evecs = scipy.ndimage.median_filter(evecs, size=(9, 1))
    Cnorm = np.cumsum(evecs**2, axis=1) ** 0.5
    gaps = np.diff(evals[:9])
    k_best = int(np.argmax(gaps[2:8]) + 3)  # eigengap after the k-th eigenvalue, k in 3..8
    result = {}
    for k in range(3, 9):
        X = evecs[:, :k] / (Cnorm[:, k - 1 : k] + 1e-9)
        seg = sklearn.cluster.KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)
        bounds = [0] + [i for i in range(1, len(seg)) if seg[i] != seg[i - 1]]
        # Snap to downbeats, then merge sections shorter than 4 bars into the previous one.
        db = downbeat_idx if len(downbeat_idx) else np.arange(0, len(seg), 4)
        snapped = sorted({int(db[np.argmin(np.abs(db - b))]) for b in bounds} | {0})
        kept = [snapped[0]]
        for b in snapped[1:]:
            bars = int(np.sum((db >= kept[-1]) & (db < b)))
            if bars >= 4:
                kept.append(b)
        segs = []
        for i, b in enumerate(kept):
            e = kept[i + 1] if i + 1 < len(kept) else nb
            lab = int(np.bincount(seg[b:e]).argmax()) if e > b else -1
            segs.append({"startBeat": b, "endBeat": e, "cluster": lab})
        result[str(k)] = segs
    return {"kChosen": k_best, "eigenvalues": [round(float(v), 4) for v in evals[:10]], "byK": result}


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "test")
    ref = root / "ref"
    for f32 in sorted(ref.glob("*.f32")):
        song = f32.stem
        bt = ref / f"{song}.beatthis-small0.json"
        if not bt.exists():
            continue
        t0 = time.time()
        y = np.fromfile(f32, dtype="<f4")
        b = json.loads(bt.read_text())
        beats = np.array(b["beats"])
        downs = np.array(b["downbeats"])
        beat_frames = librosa.time_to_frames(beats, sr=SR, hop_length=HOP)
        chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
        chroma_b = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
        nb = chroma_b.shape[1]
        downbeat_idx = np.array([int(np.argmin(np.abs(beats - d))) for d in downs])
        key, r = ks_key(chroma_b.sum(axis=1))
        windows = []
        if len(downbeat_idx) > 16:
            for i in range(0, len(downbeat_idx) - 16 + 1, 4):
                s, e = downbeat_idx[i], downbeat_idx[min(i + 16, len(downbeat_idx) - 1)]
                k2, r2 = ks_key(chroma_b[:, s:e].sum(axis=1))
                windows.append({"startBeat": int(s), "endBeat": int(e), "key": k2, "r": round(r2, 3)})
        out = {
            "song": song,
            "beatsFrom": "beatthis-small0",
            "beatsUsed": int(nb),
            "key": {"key": key, "r": round(r, 3)},
            "keyWindows": windows,
            "chords": chords(chroma_b, beats),
            "sections": sections(y, beat_frames, downbeat_idx, nb),
            "librosa": librosa.__version__,
            "seconds": None,
        }
        out["seconds"] = round(time.time() - t0, 1)
        (ref / f"{song}.structure.json").write_text(json.dumps(out, ensure_ascii=False))
        ch = out["chords"]
        ks = out["sections"]
        segs = ks["byK"][str(ks["kChosen"])]
        changes = sorted({w["key"] for w in windows})
        print(f"{song}: key {key} (r {r:.2f}); windows {changes}; {len(ch)} chord spans; k={ks['kChosen']} -> {len(segs)} sections; {out['seconds']} s")


if __name__ == "__main__":
    main()
