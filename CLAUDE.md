# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Music to Sheets is a browser app that transcribes songs (MP3) into Growtopia sheet music (GMSF). It is a static site on GitHub Pages (`sadfaceman-gt.github.io/music_to_sheets/`, repo `github.com/sadfaceman-gt/music_to_sheets`), so everything, stem separation included, runs client-side.

**Current milestone: M1 Editor and simulator** (M0 Foundations closed 2026-11-22). The app so far is a shell with a startup report; no editor, audio or ML yet.

## Source of truth: Claude Docs

Start each session with [`DEVELOPMENT.md`](DEVELOPMENT.md). It links the three Claude Docs:
- **Design Document**: design and decisions only. Final (v1.2).
- **Development Plan**: cycles, the review/fix round, sub-milestones, Herdr orchestration, milestones.
- **Development Log**: cycle log, feedback/bug tracker, per-cycle goal prompts. **Read it first each session.**

Work runs in short cycles, one `/goal` prompt each, ending in a testable build plus a test script for the user (tested in Chrome and Firefox). At Ready for review the orchestrator hands the cycle to a per-cycle review agent that works through the user's feedback and returns a cycle report (Development Plan 3). Only the orchestrator edits the Claude Docs and this file, except that the review agent updates Status and Resolution of its own cycle's tracker rows; everyone else proposes changes in their reports.

## Commands

The toolchain (Node 22, npm, gh) lives in the `unitybox` distrobox; the Bazzite host has none of it. Check `which node` before assuming.

```
npm install          # once per checkout or worktree
npm run dev          # Vite dev server, http://localhost:5173/music_to_sheets/ (sends COOP/COEP itself)
npm run typecheck    # tsc -b over app, node config and tests
npm run lint         # ESLint flat config
npm test             # Vitest, tests/**/*.test.ts
npx vitest run tests/core/profile.test.ts   # one file; add -t "<name>" for one test
npm run build        # typecheck + production build to dist/
npm run preview      # serve dist/ with isolation headers
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test and build on every pull request and on `master`. `deploy.yml` deploys every push to `master` or `cycle/*` to Pages, so the site shows the current cycle's demo until it merges.

## Layout and conventions

- `src/` follows Design 3.3: `app/` shell and screens, `ui/`, `editor/`, `audio/`, `workers/`, `ml/`, `dsp/`, `core/`, `storage/`. `core/` is pure TypeScript with no DOM, so it runs in workers and in Node tests unchanged.
- TypeScript strict with `noUncheckedIndexedAccess`; relative imports keep the `.ts`/`.tsx` extension; type-only imports use `import type`.
- React 19 function components, Tailwind for styling.
- Tests live in `tests/`, mirroring `src/` (e.g. `tests/core/profile.test.ts`). Every bug the user reports gets a test.
- Git: the default branch is `master`. Each cycle works on `cycle/<N>`; sub-agent tasks use `c<N>/<task>` branches in `../mts-<task>` worktrees, merged into the cycle branch. The cycle PR merges into `master` only when the cycle closes.
- Sub-agent briefs and reports are files in `.agents/briefs/` and `.agents/reports/` (git-ignored); templates for task and review briefs and reports are committed in `.agents/templates/`. `.claude/settings.json` holds the agents' permissions.
- Herdr starts terminals on the Bazzite host, so agents launch inside the container: `hc run --name <t> -- distrobox enter unitybox -- bash -lc 'cd <worktree> && claude -p "<prompt>" --model <m> --permission-mode acceptEdits --add-dir <repo>/.agents'` (prompt before the flags; interactive agents drop `-p`).
- `public/coi-serviceworker.js` is vendored from the `coi-serviceworker` npm package (MIT). Re-copy it from `node_modules/` when upgrading.

## Hard rules

- **Never commit or deploy `notes/`.** It holds user-supplied Growtopia sample WAVs. `test/` (test songs and stems), `DESIGN.md` and `*.onnx` are git-ignored too.
- **Game facts live only in the Game Profile** (`public/profiles/growtopia-default.json`, schema in `src/core/profile/schema.ts`), never in code. The user verifies mechanics in-game; add the verification date.
- Bass parts always go on the Bass instrument. Piano is the default instrument for vocals and other parts.
- Test against every song in `test/`. The three `.GMSF` files there (Best Day Of My Life, Radioactive, Snow_Halation) are benchmark transcriptions.
- No AGPL code (GTMusicSim, essentia.js) and no game assets in the repo or site (Design 17).

## Decisions so far

- Stack: Vite + React 19 + TypeScript + Tailwind; Zustand, Comlink, onnxruntime-web, Dexie come in later milestones (Design 3.1).
- TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7 yet.
- Hosting: GitHub Pages; cross-origin isolation via coi-serviceworker with `require-corp` (Design 3.2).
- Game Profile v2: sounding pitch = `baseMidi` + file index; file 0 is B3 for most instruments (Flute B4, Bass B2) (Design 2.4, 2.8).
- Instrument ranges, verified by ear on 2026-11-22: B3–C6 for all except Flute B4–C7 and Bass B2–C5.
- Audio Rack is the default over Gear; the app picks grid and BPM; volume mode is a user setting.

## Tools

**`tools/stem-test/`** runs the HT-Demucs ONNX pipeline the website will use (`demucs-web`), on onnxruntime-node (CPU). Use it to check stem-separation quality and speed locally.
```
cd tools/stem-test && npm install
curl -L -o htdemucs_embedded.onnx https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx
node separate.mjs htdemucs_embedded.onnx "../../test/<song>.mp3" "../../test/stems/<song>"
```
The tool decodes the MP3, resamples it to 44.1 kHz, writes `vocals`/`drums`/`bass`/`other` WAVs, and prints the SNR of the summed stems against the mix. The model's SHA-256 is in `tools/stem-test/README.md`.

**`tools/sample-pitch/pitch.mjs`**: run `node tools/sample-pitch/pitch.mjs notes/`. It estimates each sample's pitch with YIN, for files named `<instrument>_<index>.wav`, and prints note plus cents for each index. It has no dependencies.
