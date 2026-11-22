# Cycle report: cycle <N> review

- Status: done | blocked
- Branch: cycle/<N>, from c<N>-ready to <sha>
- Fix rounds: <count>; retests the user ran: <list>

## Tracker rows
| ID | Type | Status | Fix (commit) | Test |
| --- | --- | --- | --- | --- |
| T<n> | Bug | Fixed | <sha> <one line> | tests/<file>: <name> |

## Incomplete (need a design change)
- T<n>: <the design question that blocks the fix; options seen>

## Deferred and design changes for the orchestrator
- T<n>: <what the user wants; suggested milestone>

## Checks at the end
| Check | Result |
| --- | --- |
| npm run typecheck / lint / test / build | pass/fail |
| CI on the PR | pass/fail |

## Proposed doc changes
- <doc, section: change>

## Sub-agents used
- <task, model, branch, merged?>
