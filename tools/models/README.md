# tools/models: backup copies of the separation models

The site hosts no model weights (Design 7.3, decided 2026-11-28). Each built-in model is fetched from its public host and checked against its SHA-256. These local copies (git-ignored, `*.onnx`) exist so a model can be uploaded to a Hugging Face mirror if its host ever disappears. Re-download with the URLs below and check with `sha256sum -c`.

| File | Bytes | SHA-256 | Source | Inputs -> outputs |
| --- | --- | --- | --- | --- |
| htdemucs_embedded.onnx | 180534758 | e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077 | https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx | input [1,2,343980], x [1,4,2048,336] (spectrogram) -> output [1,4,4,2048,336] (frequency branch), add_67 [1,4,2,343980] (time branch); stems drums, bass, other, vocals |
| htdemucs_6s_webgpu.onnx | 284797240 | a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a | https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx (constant-folded copy of the next file, so WebGPU can run it; bit-identical output) | mix [1,2,343980] -> stems [1,6,2,343980]; drums, bass, other, vocals, guitar, piano |
| htdemucs_6s.onnx | 258159781 | 48f8e84945579f8ab340e083339e9221e03785dbe733a52c388200b6d3ca779a | https://huggingface.co/adowu/htdemucs-6s-onnx/resolve/main/htdemucs_6s.onnx (same file at StemSplitio/htdemucs-6s-onnx) | as above |
| htdemucs_6s_fp16weights.onnx | 136428532 | 7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869 | https://huggingface.co/adowu/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx | as above (fp16-stored weights, fp32 compute) |

Licences: the Hugging Face cards say MIT; the Demucs maintainer says the v4 weights' licence is not clear and htdemucs_6s is likely CC BY-NC. The site is non-commercial. See tests/separator-models.md.

Checked 2026-11-28: all four hashes match; htdemucs_6s_webgpu.onnx runs one segment in 3.9 s on CPU (onnxruntime-node, 6 threads).
