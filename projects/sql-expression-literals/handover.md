# Handover: SQL expression literals (TML-3282), 2026-10-07

You take over this project from the agent marconi-29. This file supersedes every earlier handover. Read it, then [status.md](status.md), then the parts of [plan.md](plan.md), [design.md](design.md) and [design-notes.md](design-notes.md) your next step needs.

## Where to work

Create a fresh worktree on branch `tml-3288-sql-expression-places` from the `bot` remote (`git@github-wmadden-electric:prisma/prisma.git`), then run `mise exec -- pnpm install` and `mise exec -- pnpm build`. Everything is pushed; nothing is uncommitted anywhere. The previous worktree (`.claude/worktrees/sql-expression-literals-handover-3c78f4`) used local branch names `m29-2t`, `m29-2b`, `m29-3`; ignore them, the remote branches are the truth. If git refuses to check a branch out because another worktree has it, use a different local name and push with `git push bot <local>:<remote-branch>`.

## State of the pull requests

| Slice | Ticket | Branch | PR | State |
| --- | --- | --- | --- | --- |
| 2a, 1, 4 | TML-3296, TML-3287, TML-3290 | | #30534, #30546, #30554 | Merged. |
| 2t | TML-3367 | `tml-3367-data-type-value` | [#30539](https://github.com/prisma/orm/pull/30539) | **Merged 2026-10-07** as squash `b35bcd7d10`. Shipped in 8.0.0-rc.16. |
| 2b | TML-3288 | `tml-3288-sql-expression-places` at `7719580e23` | [#30550](https://github.com/prisma/orm/pull/30550) | Base is `main`. Contains `main` at `00bb24ed31` (rc.16). Pushed, checks were running. No approval yet. Review round 3 not done (see below). |
| 3 | TML-3289 | `tml-3289-sql-expression-ts` at `93b78527df` | [#30558](https://github.com/prisma/orm/pull/30558) | Base `tml-3288-sql-expression-places`; has conflicts with it. Untouched this session. Will paused it; do it after 2b lands. |
| 5 (stretch) | TML-3297 | | | Not started. Ask Will before starting. |

## What happened this session (2026-10-06 and 07)

- **Serhii's design thread on #30539** was settled: Will kept the `dataTypeValue` combinator. ADR 231 now explains why: an attribute argument is either grammar (names, flags, keywords, references, DDL parameters; typed by shape with `str()`, `bool()`, …) or a database value (a value of a data type a column holds or the database evaluates; typed by `dataTypeValue` and the cast rule). The size in `nanoid(8)` is grammar, so the project "Data types own column types" uses `dataTypeValue` only for a function argument the database receives. design-notes.md item 15.
- **Refusal wording** changed (2t, shipped): messages lead with what to write. `Expected a number`; ``Expected sql`...`; write sql`(x)` `` for a quoted string on a tagged type when the literal reads back; `Expected a number that pg/int4 can hold; got pg/int8` when the value has the right form; `Expected <forms>; got a list`; `Expected <forms>; this target has no data type for a <syntax> value`. `@default` offers the exact rewrite too (`Expected json`...`; write json`{}``). Framework functions: `describeRefusal`, `describeExpected`, `describeRefusedValueType`, `exactRewrite`, `admittedForms`, `tagForm`, `RefusalGuidance`, `WrittenForm`, `printedTaggedLiteralReadsBack` in `packages/1-framework/1-core/framework-components/src/shared/written-value.ts` and `tagged-literal.ts`. Reviews: `slice-reviews/2t-wording/`, `slice-reviews/2t-wording-round-2/`.
- **Many merges of `main`** into 2t and 2b. `main` moves fast; the "Data types own column types" project (TML-3386 #30547, TML-3388 #30576) conflicts heavily with this work. Merge resolution rule used throughout: `main`'s structure, this project's names and content. Briefs: `dispatches/2t-merge-main-brief.md`, `dispatches/2b-merge-2t-adr-267-brief.md`.
- **ADR numbers**: #30619 renumbered clashing ADRs. ADR 255 (block specs) is now **ADR 262**. `main` has its own ADR 260 (`afterTransaction`), so 2b's ADR is now **ADR 267 - Raw SQL is a value of the data type sql-expression**. No open PR claims 267 (#30428 collection scopes also still uses 260; not ours).
- **Releases**: rc.15 and rc.16 moved pending upgrade fragments into `upgrade-instructions/releases/`. Released fragments must never be edited; a merge can carry edits into them through rename detection, so after every merge of `main` run `git diff --name-only origin/main -- upgrade-instructions/releases skills/prisma-8/upgrading` and restore any hit from `main`. 2t's fragment `arguments-typed-by-data-type` is released in rc.15-to-rc.16; 2b's only pending fragment is `upgrade-instructions/pending/sql-expression-literals-psl/`, and it must describe the change from rc.16.
- **SQLite `json` hint**: on SQLite `Json`, `String` and `DateTime` columns all have data type `sqlite/text`, and `main` registers the `json` tag under the key `tag:json`. A refused default on a SQLite `Json` column says `Expected a quoted string`. Decided: correct and kept, because a quoted JSON string works there and offering ``json`...`` would also show on `String` and `DateTime` columns. Record this in status.md as a known limit (not yet written there).

## What to do next, in order

1. **Review round 3 of 2b.** Required by Will's process before 2b goes to him. Brief: `dispatches/2b-round-3-review-brief.md`. Before dispatching, regenerate its two inputs under `wip/2b-round-3/` (gitignored, not in the repo): `git log --first-parent --format="%h %s" ed1df11285..HEAD > wip/2b-round-3/commits.txt`, and for each merge in that range `git diff-tree --cc <merge>` into `wip/2b-round-3/merge-only-hunks.diff` (the commands are in the brief's "Scope"). Note that `7719580e23` (merge of `main`) is now part of the range too. Dispatch two Opus reviewers (architect persona → `slice-reviews/2b-round-3/system-design-review.md`, principal-engineer persona → `slice-reviews/2b-round-3/code-review.md`). Fix the findings with an Opus implementer, review the fixes again, push.
2. **Update the #30550 description**: base is now `main`, 2t has landed (drop "Builds on #30539"), ADR is 267, the wording examples are the new messages, the upgrade fragment describes the change from rc.16. Description rules below.
3. **Keep #30550 current with `main`** (CI monitor sends conflict events). Check every merge for released-fragment edits (see above).
4. Hand #30550 to Will for approval. **A PR is blocked by unresolved review threads** even when checks are green and it is approved: before saying a PR is ready, check `reviewThreads` with `isResolved == false` (GraphQL) and resolve or answer them. Will queues it, or asks you to (`gh pr merge <n> --squash` adds it to the merge queue; integration tests run only in the queue now).
5. **Slice 3 (#30558)** after #30550 lands: retarget to `main`, merge `main` (where `main`'s file equals the 2b tip, slice 3's side wins), the same released-fragment check, a review round on what changed since its round 2, then Will.
6. **Close-out** (plan.md "Close-out"): move the decisions into the ADRs, delete `projects/sql-expression-literals/`, tell Will.

## Rules Will set (also in the global CLAUDE.md and memory)

- Design with Will, then execute without interrupting him. Make engineering decisions yourself.
- Every slice: implement, `/drive-code-review` (two Opus reviewers), fix, review the fixes, manual QA, then Will. **Every subagent runs on Opus (`model: "opus"`), never Fable, because Fable is expensive.**
- **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` locally.** Run the files a change touches; CI runs the rest. Put this in every brief.
- The machine often has a load average over 100. Run long commands in the background with a log under `wip/`. A test that times out under load usually passes alone.
- Commits: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, never amend, squash, rebase or force-push. Push through the `bot` remote. Run node and pnpm through `mise exec --`.
- PR titles "TML-NNNN: sentence". Descriptions open with what a user sees, then the decision, then the build-up, alternatives last, `Agent: <your name>` at the end.
- Bot review comments: fix what is right, reply ending with `_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_`, resolve the thread. Human design comments: answer with facts, don't change the design without Will.
- Bind the PR to your session's CI monitor (`mcp__ccd_pr__bind_pr`, `set_monitor` with auto-fix). Binding replays the PR's whole comment history as "new"; check thread state before acting.
- When `pnpm install` changes `pnpm-lock.yaml` only by removing a stray `cli-e2e-test-app/test-…` importer, restore it.
- `pnpm lint:fix` touches `scripts/validate-package-readmes.test.mjs` and `skills-contrib/review-fetch-phase/scripts/guard-review-artifacts-ignored.test.mjs`; restore both.
- The three tarball tests fail locally on a registry refusal ("High-risk trust downgrade for @vercel/detect-agent"); ignore them.
- Write to Will in plain English, short sentences. No question UI, no floating task chips.

## Context from earlier sessions

This session's transcript (marconi-29, 2026-10-06 to 07):

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-3c78f4/ea08b13e-c168-4c0e-a372-06c63f31c561.jsonl`

Earlier sessions (charon-96):

- `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-e3d9e9/f34c3092-a059-4002-8e3e-116ce266d1ac.jsonl`
- `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

They are large JSONL files. Do not read them whole; grep for a topic (for example `grep -n "ADR 267"` or `grep -n "tag:json"`) and read the lines around each match. The decisions they hold are recorded in this file, status.md, design-notes.md and `dispatches/`; read a transcript only when those don't answer a question.
