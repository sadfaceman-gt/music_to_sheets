# stem-test

Runs the same HT-Demucs ONNX model and demucs-web JS pipeline the website will use, with onnxruntime-node (CPU).

```
npm install
curl -L -o htdemucs_embedded.onnx https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx
node separate.mjs htdemucs_embedded.onnx "../../test/Meghan Trainor - No.mp3" "../../test/stems/Meghan Trainor - No"
```

Options: `--start <s> --duration <s>` separate a clip (seconds); `--threads <n>` (default 10). The input may be an mp3
or a 16-bit PCM WAV, such as the app's stored 44.1 kHz stereo copy; the clip that was separated is written to
`<outDir>/input.wav` next to the stems.

The browser parity check (`tests/e2e/separation-parity.local.spec.ts`, local only) compares the app's stems with this
tool's on 30 s of "No" from 60 s. Make that reference from the app's own WAV (the spec writes it to
`test/stems-ref/no-60-30/app-input.wav`), not from the mp3: the browser decodes the mp3 slightly differently (about
33 dB apart), which alone costs the stems their 30 dB.

```
node separate.mjs ../../test/htdemucs_embedded.onnx ../../test/stems-ref/app-input-60-30.wav ../../test/stems-ref/no-60-30 --threads 6
```

Model SHA-256 (2026-11-21): e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077
