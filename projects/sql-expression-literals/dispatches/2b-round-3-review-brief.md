# Brief: slice 2b, review round 3 (TML-3288, #30550)

Branch `m29-2b` in the git worktree at the current directory, pushed as `tml-3288-sql-expression-places`, pull request #30550, base `main`. Do not read, write or run anything outside this worktree; no `/tmp`; scratch under `wip/2b-round-3/`. Run node, pnpm and git through `mise exec --`. Do not edit code, tests or docs; your only output is your review file. **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** You may run single package test files if you need evidence; the machine is heavily loaded, so prefer reading code and the logs under `wip/merge-2b-main-verify/`.

## What slice 2b is

Raw SQL in `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)` and a policy's `using` and `withCheck` is a `sql` literal of data type `sql/expression`, received through `dataTypeValue`; a quoted string there is refused with the rewrite. `contract infer` and `contract print` write `sql` literals; a codemod rewrites schemas; fixtures are rewritten. Read `projects/sql-expression-literals/spec.md`, the 2b sections of `projects/sql-expression-literals/design.md`, and ADR 267 (`docs/architecture docs/adrs/ADR 267 - Raw SQL is a value of the data type sql-expression.md`).

## Scope of this round

Rounds 1 and 2 reviewed the slice up to `ed1df11285` (reviews in `projects/sql-expression-literals/slice-reviews/2b/` and `2b-round-2/`). Since then nobody has reviewed:

1. Five commits of the branch's own: `5b5a8538ce`, `0a58490350`, `43c42110b7`, `cfd8a3cb5e`, `0ee6de4c3f` (`git show <hash>`).
2. The resolutions of 15 merges of slice 2t and `main` into this branch. `wip/2b-round-3/merge-only-hunks.diff` holds, for each merge, the combined diff (`git diff-tree --cc`): only the hunks where the merge result differs from both parents, which is where a merge made a decision. `wip/2b-round-3/commits.txt` lists all first-parent commits since `ed1df11285`.

Slice 2t (#30539) has landed on `main` as the squash `b35bcd7d10`; it is not in scope. Review those two items against the end state: the branch's full diff with `main` (`git diff origin/main...HEAD`, 184 files). A finding about code outside them belongs in scope only when one of them caused it or exposed it.

What to look for: a merge that kept one side's code where the other side's change was needed too (a dropped behaviour, a test that lost an assertion, a doc that now says something the code does not do); names, messages and ADR numbers that disagree across code, tests, ADRs, the error reference, the upgrade fragment `upgrade-instructions/pending/sql-expression-literals-psl/` and the project docs; the ADR renumbering (2b's ADR is 267; ADR 255 became 262 on `main`; `main`'s own ADR 260 is the `afterTransaction` stage and must not be pointed at by this slice); the upgrade fragment describing the change from rc.16 (2t shipped in rc.16, so the fragment must not describe 2t's changes); and anything the merges left that the slice's own tests do not cover.

## Your pass

Your persona and output file are given in your dispatch prompt. Findings get IDs as your prompt says, each with a repo-relative location, the issue, and a concrete suggestion. No severity tiers. Markdown: never hard-wrap prose. Finish with a short plain-English report.
