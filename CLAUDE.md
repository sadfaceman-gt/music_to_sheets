# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Music to Sheets is a browser app that transcribes songs (MP3) into Growtopia sheet music (GMSF). It is deployed as a static site on GitHub Pages (`github.com/sadfaceman-gt/music_to_sheets`), so everything, including stem separation, runs client-side.

The app itself is not written yet. The repo currently holds only Node prototyping tools under `tools/`.

## Source of truth: Claude Docs

`DEVELOPMENT.md` is the orchestrator startup file and links three Claude Docs:
- **Design Document** holds design and decisions only. It is final (v1.2).
- **Development Plan** covers cycles, the review/fix round, sub-milestones, Herdr orchestration, and milestones.
- **Development Log** holds the cycle log, the feedback/bug tracker, and the per-cycle goal prompts. **Read it first each session.**

Work is done in short cycles. Each cycle is one goal prompt, written into the Development Log, that the user runs as `/goal`. A cycle ends with a testable build plus a test script for the user, and it closes only after the user's feedback has been fixed. Only the orchestrator session edits the Claude Docs.

## Hard rules

- **Never commit or deploy `notes/`.** It holds user-supplied Growtopia sample WAVs. `test/` (test songs and stems) and `DESIGN.md` are gitignored too, as are `*.onnx` model files.
- **Never hard-code game rules.** Put them in the Game Profile JSON. The user verifies mechanics in-game.
- Bass parts always go on the Bass instrument. Piano is the default instrument for vocals and other parts.
- Test against every song in `test/`. The three `.GMSF` files there (Best Day Of My Life, Radioactive, Snow_Halation) are benchmark transcriptions.

## Tools

**`tools/stem-test/`** runs the HT-Demucs ONNX pipeline the website will use (`demucs-web`), on onnxruntime-node (CPU). Use it to check stem-separation quality and speed locally.
```
cd tools/stem-test && npm install
curl -L -o htdemucs_embedded.onnx https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx
node separate.mjs htdemucs_embedded.onnx "../../test/<song>.mp3" "../../test/stems/<song>"
```
The tool decodes the MP3, resamples it to 44.1 kHz, writes `vocals`/`drums`/`bass`/`other` WAVs, and prints the SNR of the summed stems against the mix. The model's SHA-256 is in `tools/stem-test/README.md`.

**`tools/sample-pitch/pitch.mjs`**: run `node tools/sample-pitch/pitch.mjs notes/`. It estimates each sample's pitch with YIN, for files named `<instrument>_<index>.wav`, and prints note plus cents for each index. It has no dependencies.

There is no build, lint, or test setup yet.
