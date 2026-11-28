# Separator models (reference list, 2026-11-28)

Models the user may license and load as a Custom model on the Stems step (M3b), next to the built-in HT-Demucs and HT-Demucs 6 (Experimental). Licences come from search results and community mirrors, not from each original licence file: check that file (and the training data's terms) before relying on one. SDR figures are from the Music-Source-Separation-Training model list (ZFTurbo, docs/pretrained_models.md) and the cycle 9 review (.agents/reports/9-review.md, T44).

| Model | Stems | Weights licence (as reported) | Browser / ONNX | Quality and cost |
| --- | --- | --- | --- | --- |
| HT-Demucs (built in) | vocals, drums, bass, other | Unclear (Demucs maintainer: "the license of the weights is not clear") | timcsy/demucs-web-onnx, 180.5 MB fp32, SHA-256 e5e425c1... | other 5.7 dB SDR, vocals 8.2. Whole of "No": WebGPU 52 s, WASM 265 s |
| HT-Demucs 6 (htdemucs_6s, Experimental) | vocals, drums, bass, guitar, piano, other | Likely CC BY-NC (Demucs maintainer) | adowu/htdemucs-6s-onnx, StemSplitio htdemucs-6s-onnx (fp32 258 MB, fp16 weights 136 MB), kramp/htdemucs-6s-webgpu-onnx (constant-folded for WebGPU); input mix [1,2,343980], output [1,6,2,343980] | The piano stem bleeds and has artifacts (Demucs README) |
| Spleeter (Deezer) | 2, 4 or 5 (5 adds piano) | MIT per the JOSS paper; the README only names the code (an open issue asks) | Best-Practice/spleeter-4stems-onnx | Older, clearly weaker than HT-Demucs; the clearest licence |
| Open-Unmix UMX-HQ | vocals, drums, bass, other | Reported MIT (UMX-L, the better one, is CC BY-NC-SA 4.0) | edgetools/umx-hq (ONNX) | Weaker than HT-Demucs |
| SCNet / SCNet-large | vocals, drums, bass, other | Reported MIT; the author reportedly confirmed redistribution (starrytong/SCNet issue 35) | audiojs/scnet, audiojs/scnet-large (ONNX, int8 weights) | Best open 4-stem on other: about 6.5 dB (Multisong), 7.9 (MUSDB), XL IHF; trained on MUSDB18-HQ (research and educational use) |
| Mel-Band RoFormer (Kim) | vocals, instrumental | Reported MIT (KimberleyJSN/melbandroformer) | audiojs/mel-roformer (ONNX, fp16) | Vocals about 11.0 dB SDR vs 8.2 for HT-Demucs; two stems only, so it pairs with another model |
| BS-RoFormer SW | vocals, drums, bass, guitar, piano, other | Unknown on jarredou/BS-ROFO-SW-Fixed; CC BY-NC-SA 4.0 per the unblend project | elicwhite/bs-roformer-web (MIT code; fp16 336 MB, fp32 669 MB, 4 s chunks, JS STFT, WebGPU graph rewrites) | Best quality, heavy: one report gives 7.5 min for a 3 min song on an M1 Pro |
| htdemucs_ft | vocals, drums, bass, other | As HT-Demucs | Four models, no browser port found | About 4x the time; small gains (other 5.85) |

## Fit with the app
- HT-Demucs-shaped ONNX files (waveform in, waveform out, 7.8 s segments, STFT inside or done as in demucs-web) run with the current pipeline.
- Spectrogram-in models (RoFormers, SCNet, Spleeter, UMX) need the custom-model manifest to describe the STFT (size, hop, window) and the input and output layout; the app does the STFT and iSTFT in JS.
- The separation scope, resume, OPFS stems and the mixer work the same for any stem count.

## Sources
- Demucs README and licence notes: https://github.com/adefossez/demucs
- Model scores: https://github.com/ZFTurbo/Music-Source-Separation-Training (docs/pretrained_models.md)
- Spleeter: https://github.com/deezer/spleeter, https://joss.theoj.org/papers/10.21105/joss.02154.pdf, https://huggingface.co/Best-Practice/spleeter-4stems-onnx
- Open-Unmix: https://sigsep.github.io/open-unmix, https://pypi.org/project/openunmix/, https://huggingface.co/edgetools/umx-hq
- SCNet: https://arxiv.org/abs/2401.13276, https://huggingface.co/audiojs/scnet, https://huggingface.co/audiojs/scnet-large
- Mel-Band RoFormer: https://huggingface.co/audiojs/mel-roformer, https://huggingface.co/mlboydaisuke/MelBandRoformer-Vocal-CoreAI
- BS-RoFormer SW: https://huggingface.co/jarredou/BS-ROFO-SW-Fixed, https://huggingface.co/Ryan5453/unblend, https://github.com/elicwhite/bs-roformer-web
- htdemucs_6s ONNX: https://huggingface.co/adowu/htdemucs-6s-onnx
