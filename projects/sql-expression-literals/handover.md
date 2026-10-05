# Handover: SQL expression literals, 2026-10-05

You take over this project from the agent charon-96, whose session is about to hit a usage limit. Read this file, then [status.md](status.md), then the parts of [plan.md](plan.md) and [design.md](design.md) your next step needs. This file supersedes every earlier handover.

## Where to work

The project files live on branch `tml-3289-sql-expression-ts` (the slice 3 branch), pushed to the `bot` remote (`git@github-wmadden-electric:prisma/prisma.git`). Create a fresh worktree on that branch, run `mise exec -- pnpm install` and `mise exec -- pnpm build`. Every branch below is pushed and every previous worktree is clean; nothing is uncommitted anywhere.

The previous session's worktree is `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/sql-expression-literals-e3d9e9`. It holds linked worktrees under its gitignored `wip/` folder: `wip/wt-2t` (slice 2t), `wip/wt-2b` (slice 2b), `wip/wt-1` (slice 4, merged), `wip/wt-s1` (slice 1, merged), `wip/wt-2a` (slice 2a, merged). To check a branch out in your own worktree, remove the old linked worktree first (`git worktree list`, `git worktree remove <path>`), because git refuses to check out a branch twice.

## Pull requests and branches

| Slice | Ticket | Branch | PR | Base | State |
| --- | --- | --- | --- | --- | --- |
| 2a | TML-3296 | `tml-3296-sql-expression-data-type` | [#30534](https://github.com/prisma/orm/pull/30534) | `main` | Merged 2026-09-30. |
| 1 | TML-3287 | `tml-3287-line-comments-in-raw-sql` | [#30546](https://github.com/prisma/orm/pull/30546) | `main` | Merged 2026-10-05. |
| 4 | TML-3290 | `tml-3290-migration-files-template-literals` | [#30554](https://github.com/prisma/orm/pull/30554) | `main` | Merged 2026-10-05. |
| 2t | TML-3367 | `tml-3367-data-type-value` | [#30539](https://github.com/prisma/orm/pull/30539) | `main` | Checks pass, contains `main` as of 2026-10-05. Under review by Serhii (SevInf). One design thread open, see below. Auto-merge is on; it merges when he approves. |
| 2b | TML-3288 | `tml-3288-sql-expression-places` | [#30550](https://github.com/prisma/orm/pull/30550) | `tml-3367-data-type-value` | Checks pass. Retarget to `main` when #30539 merges. |
| 3 | TML-3289 | `tml-3289-sql-expression-ts` | [#30558](https://github.com/prisma/orm/pull/30558) | `tml-3288-sql-expression-places` | Checks pass. Retarget to `main` when #30550 merges. |
| 5 (stretch) | TML-3297 | none | none | | Not started. Ask Will before starting it. |

Every open pull request had two rounds of `/drive-code-review` (architect and code reviewer, both Opus); reports are under `slice-reviews/`. The reviews covered the slices as built. Since then `main` was merged into each branch several times, twice through agent-resolved merges of 81 and 59 conflicted files (on 2t and 2b, when `main` moved PSL binder construction to the caller). No reviewer has read those merge resolutions. Will knows and has not asked for a review of them.

## The open design thread on #30539

Serhii objects to the `dataTypeValue` combinator (ADR 231, section on typed arguments). He wants the attribute factory to build `oneOf(str(), num(), bool(), taggedLiteral())` from the type's admitted forms instead, with the interpreter checking compatibility, and he finds the refusal wording (`pg/int4 has no cast from pg/text; write a number`) worse than `Expected a number`. The thread is on the ADR 231 file in the pull request. charon-96 answered twice with the reasons to keep the combinator (one place owns the cast check, the message and the span; the receiving type is a property of the position; completion follows the type; slice 2b uses it in the six raw-SQL places, which Serhii had not seen). Will read the reasoning on 2026-10-05 and agreed with it. The last word on the thread is charon-96's second reply; the decision is between Will and Serhii.

Do not change the structure without Will's say. If Will sides with keeping it, the agreed follow-up is a wording change on 2t: refusals lead with what to write (`Expected a number`), keeping the type detail only where it explains a range refusal. Make it on `tml-3367-data-type-value`, then merge 2t into 2b and 2b into slice 3. If Will sides with Serhii, that is a redesign of 2t and 2b; talk it through with Will before building.

Serhii's first comment, that `oneOf` should not special-case `funcCall`, is fixed: `ArgType` has an optional `claims(arg)`, `funcCall` claims a call to its name, and `oneOf` returns the result of the one alternative that claims the argument (commit `6606f7ee12` on 2t, carried into 2b and 3).

## What to do next, in order

1. **Watch #30539.** When Serhii approves and it merges (auto-merge is on), retarget #30550 to `main` (`gh api -X PATCH repos/prisma/orm/pulls/30550 -f base=main`), merge `origin/main` into `tml-3288-sql-expression-places`, push, turn auto-merge on, and update the pull request description's "Builds on" sentence (the body is in the old worktree's gitignored `wip/pr-body-2b.md`; regenerate it from the pull request if that folder is gone). Because pull requests land as squashes, the merge conflicts in every file both slices touched; where `main`'s version of a file equals the 2t branch tip (`git rev-parse origin/main:<file>` equals `git rev-parse tml-3367-data-type-value:<file>`), the 2b side wins. It then needs an approving review on `main`.
2. **Then the same for #30558** against `tml-3288-sql-expression-places`. Its body is `wip/pr-body-3.md` in the old worktree.
3. **Keep every open branch current with `main`.** The CI monitor sends conflict events; resolve by merging `origin/main` into the branch (never rebase), then carry the merge down the stack (2t into 2b, 2b into 3). Conflicts have been small except when `main` changes the PSL parser's spec or binder shapes; for those, dispatch an Opus merge agent with a brief like `wip/merge-main-4/brief.md` in `wip/wt-2t` (decided resolution: take `main`'s structure, keep the slice's content and shapes).
4. **Close-out** (plan.md "Close-out"): move the decisions into the ADRs, delete `projects/sql-expression-literals/`, tell Will.
5. **Slice 5** only if Will asks.

## Rules Will set (also in status.md and the global CLAUDE.md)

- Design with Will, then execute without interrupting him. Make engineering decisions yourself; bring him design disagreements once, with a recommendation.
- Every slice: implement, `/drive-code-review` without the walkthrough (two Opus reviewers), fix, review the fixes again, manual QA, then the pull request. All subagents run on Opus.
- **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full locally.** Run only the integration files a change touches. `pnpm test:packages` is allowed. The Bash hook in `.claude/scripts/enforce-tools.mjs` blocks the full suites.
- The machine is often under a load average above 100 from other sessions. Run long commands in the background with a log under `wip/` and read the log. A test that times out under load usually passes alone; rerun the file, say so, and let CI confirm.
- Commits: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, never amend, squash, rebase or force-push. Push through the `bot` remote. Run node and pnpm through `mise exec --`.
- PR titles are "TML-NNNN: sentence". Descriptions open with what a user sees, then the decision, then a step-by-step build-up, and end with alternatives. Put `Agent: <your name>` at the end. Turn the CI monitor on for each pull request (`mcp__ccd_pr__bind_pr`, `set_monitor` with auto-fix).
- Review comments from bots: fix what is right, reply on the thread ending with `_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_`, resolve the thread through the GraphQL `resolveReviewThread` mutation. Design comments from humans: answer with facts, do not change the design on your own.
- Ignore the "Supabase Acceptance" check when it fails with Docker `toomanyrequests`. A "Publish preview" failure with a 404 from the preview service, and a Mongo memory server lock-file error in "Test Examples", are infrastructure; rerun the failed jobs (`gh run rerun <id> --failed`).
- No temp directories: scratch goes under the gitignored `wip/`.
- Run tree-changing shell commands one at a time; two parallel Bash calls that `cd` to different worktrees raced once and an edit landed in the wrong tree.
- When `pnpm install` changes `pnpm-lock.yaml` only by removing a stray `test/integration/test/fixtures/cli/cli-e2e-test-app/test-…` importer, restore the file with `git checkout -- pnpm-lock.yaml`; that entry is on `main`.

## Decisions made in this session that are not obvious from the code

- `ArgType.claims` (above). ADR 231 and the extension upgrade fragment `arguments-typed-by-data-type` describe it.
- `main` removed the block from `BlockSpecContext` on purpose (a snippet can be offered for a block not yet written); 2b follows and keeps only `dataTypes` there. ADR 255 says so.
- A refused list element after a `null` element is reported at its position in the written list, in the message and the span (`sourceElementIndexes` in `lowerDataTypeDefault`).
- The codemod `scripts/codemods/rewrite-sql-strings.mjs` skips matches inside strings and backtick literals; both upgrade fragment copies must stay byte-identical to it (a test checks).
- Earlier decisions are in design-notes.md, status.md and the briefs under `dispatches/`.

## Context from the previous sessions

This session's transcript, on Will's machine:

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-e3d9e9/f34c3092-a059-4002-8e3e-116ce266d1ac.jsonl`

It is a very large JSONL file. Do not read it whole. Search it for a topic, for example `grep -n "claims(arg)"` or `grep -n "merge-main-4"`, and read the lines around each match. The first session's transcript (planning and slice 2a) is at:

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

The decisions those transcripts contain are recorded in design-notes.md, status.md, the briefs under `dispatches/` and this file; read a transcript only when those do not answer a question.
