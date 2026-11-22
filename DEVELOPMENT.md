# Music to Sheets — Development.md

# Design Document

**https://claude.ai/artifact/KNLZrThg3ZjcTQha7N9GN4**

# Development Plan

**https://claude.ai/artifact/Ex334ZAnmUGKRxQ7UXJ49g**

# Development Log

**https://claude.ai/artifact/QWgbdVz4ewsq7g6bwDSgNJ**

## Repo contents so far

- `notes/` — Growtopia sample WAVs, user-supplied. Never commit or deploy these.
- `test/` — test songs; `test/stems/` holds separation output.
- `tools/stem-test/` — runs the browser HT-Demucs ONNX pipeline (demucs-web) under Node.
- `tools/sample-pitch/` — measures the pitch of each sample file (YIN).
