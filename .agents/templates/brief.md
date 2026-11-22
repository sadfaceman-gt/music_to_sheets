# Brief: <cycle>-<task>

- Cycle: <N>, milestone <id>
- Model: <sonnet|haiku|opus>
- Branch / worktree: c<cycle>/<task> at ../mts-<task>
- Report to: .agents/reports/<cycle>-<task>.md (in the MAIN checkout, absolute path below)

## Goal
<one or two sentences: what exists and works when you're done>

## Read first
- CLAUDE.md
- Design Document sections: <list> (the orchestrator pastes the needed excerpts below if you can't read Claude Docs)

## Files you may touch
- <paths>
Anything else: don't. If you need to, stop and say so in the report.

## Acceptance checks (run them all before reporting)
1. npm run typecheck
2. npm run lint
3. npm test
4. <task-specific check>

## Rules
- Never read, copy or commit anything from notes/ or test/.
- Game facts come from public/profiles/growtopia-default.json, never hard-coded.
- Don't edit the Claude Docs; propose doc changes in your report.
- Commit to your branch with a clear message. Don't push, don't merge.
- If a question or permission prompt blocks you, write it into the report and stop.

## Excerpts
<design text the task needs>
