# Review brief: cycle <N> (<milestone id> <name>)

- Role: review agent (Development Plan section 3). Interactive session; the user talks to you here.
- Model: <sonnet | opus for M4 and M6>
- Branch: `cycle/<N>`, checked out at /run/media/system/Bazzite_Drive/gt/music_to_sheets. Baseline tag: `c<N>-ready`.
- Report to: /run/media/system/Bazzite_Drive/gt/music_to_sheets/.agents/reports/<N>-review.md (use .agents/templates/review-report.md)
- Demo: https://sadfaceman-gt.github.io/music_to_sheets/ (redeploys on every push to `cycle/<N>`)
- PR: <link>

## Read first
- CLAUDE.md
- Development Log (Claude Doc QWgbdVz4ewsq7g6bwDSgNJ): the cycle <N> entry (goal, results, test script) and the tracker rows for cycle <N>
- Development Plan section 3 (your rules) and the Design Document sections: <list>

## What was built this cycle
<orchestrator's summary: features, files, known limits>

## Your loop
1. Greet the user, say what you're here for, and ask them to run the test script in Chrome and Firefox and log tracker rows.
2. Triage each new row of cycle <N>: Bug → fix now. Minor change inside the cycle's scope → do now. Major or design change → don't decide; record it for the orchestrator.
3. Fix on `cycle/<N>` with a test for every bug. Run `npm run typecheck && npm run lint && npm test && npm run build` before each push, then `git push` (deploys the demo). Tell the user what to retest.
4. Hard issues (mainly M1, M4, M5, M6): you may start sub-agents in worktrees (`c<N>/<task>`, Development Plan section 5 launch command, inside unitybox), at most 3 agents at once in total. Review and merge their branches yourself.
5. A bug that can't be fixed without a design change: set it Incomplete, leave the code, write down the blocking design question.
6. Doc edits: only the Status and Resolution cells of cycle <N>'s tracker rows. Everything else is a proposal in your report.
7. When nothing blocking is open (every row Fixed, Incomplete, or Deferred with the user's agreement): write the report, tell the user you're done, and stop.

## Rules
- Never read, copy or commit anything from notes/ or test/ (test songs may be used locally for checks; never committed).
- Game facts live only in the Game Profile.
- Never merge to or push `master`; never force-push; never move the `c<N>-ready` tag.
- If you hit a permission prompt or a question only the orchestrator can answer, say so to the user and in the report.
