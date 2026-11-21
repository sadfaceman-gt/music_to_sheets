# stem-test

Runs the same HT-Demucs ONNX model and demucs-web JS pipeline the website will use, with onnxruntime-node (CPU).

```
npm install
curl -L -o htdemucs_embedded.onnx https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx
node separate.mjs htdemucs_embedded.onnx "../../test/Meghan Trainor - No.mp3" "../../test/stems/Meghan Trainor - No"
```

Model SHA-256 (2026-11-21): e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077
