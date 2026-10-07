# Handover: cache invalidation on write, after slice 1

Written 2026-10-07 by session halley-46, for an agent starting in a fresh session and worktree.

## Read first

- This session's transcript: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-middleware-cache-transaction-lifecycle-740886/80deccca-c0ba-4aa7-8021-5bf00e4cf86c.jsonl`. It covers the whole of 2026-10-06 and 2026-10-07: finishing slice 1, two review rounds, the merge, and the design discussion that followed. Read the user turns with `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content'` to see Will's rulings in his words.
- The previous session (aladdin-24, under the macOS user `will`) is at `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-cache-middleware-invalidation-ttl-a0648e/ca509ad2-5ee2-4f00-bcfb-8fc3684445b4.jsonl`. It covers the cache design (ADR 259) and the first build of slice 1. Readable only if Will has run `sudo chmod -R g+rX` on that folder; he did on 2026-10-06.
- `spec.md` and `plan.md` in this folder. ADR 259 and ADR 260 under `docs/architecture docs/adrs/`.
- `discussion-query-grouping.md` in this folder: the design discussion and its outcome.

## State of the work

| Item | State |
|---|---|
| TML-3398, cache primitives | Done. prisma/orm#30530 merged 2026-10-01. |
| Design PR, ADR 259 and this project folder | prisma/orm#30600 merged 2026-10-06. |
| TML-3399, the `afterTransaction` stage (slice 1) | Done. prisma/orm#30614 merged 2026-10-06. ADR 260. Linear closed with a comment. |
| TML-3400, `invalidateAnnotation` on writes (slice 2) | Not started. Spec is in `spec.md`, slice 2. Linear issue is in Backlog, blocked by TML-3399, which is now Done; unblock it. |
| Middleware node tree | Agreed in principle on 2026-10-07, not designed, not ticketed. See below. |

All code is on `main`. Nothing is on an unmerged branch except this file and `discussion-query-grouping.md`, pushed on branch `docs/cache-invalidation-handover` on the bot remote.

## What slice 1 shipped, in case the spec reads differently

ADR 260 is the source of truth. Two decisions came out of review and differ from the original brief:

- `unknown` fires for a resolved `commit()` when one of the transaction's queries failed (Postgres answers `COMMIT` on an aborted transaction with a silent rollback). A row stream the caller stopped reading is not a failure.
- A query sent on the transaction's connection while the transaction is open is part of the transaction. The transaction stops remembering queries when `commit()` or `rollback()` is *called*, not when it settles.

Documented limits (ADR 260): hooks run while the connection is still held, so a hook must not query through the same runtime; with the direct single-client Postgres driver a runtime-scope query sent while a transaction is open runs inside it but is reported as outside.

## The next piece of work: TML-3400

Will's ruling on 2026-10-07: build the pragmatic cut now. That is the spec's slice 2 as written:

- `invalidateAnnotation({ keys, meta })` on write terminals, same shape as `invalidate`'s target.
- The cache middleware implements `afterTransaction`: for a plan carrying the annotation, call `invalidate` unless the outcome is `rolled-back`. No state per transaction.
- Nested and multi-query ORM calls stay the documented limit in the spec's "Known limits". Do not try to fix that in this slice. Will rejected copying the call's annotations onto each query's plan and rejected picking one query to carry them.

Will has not yet said "go" for TML-3400. Ask once, with the plan, then execute without further questions. Follow `/drive-process`: brief an Opus implementer, run `/drive-code-review` without the walkthrough, fix, repeat, manual QA, then final verification with Will.

## The design that follows, not yet ticketed

Will and Serhii agreed on 2026-10-07 that the middleware's data structure should be a tree: a query, a transaction, and a client-level grouping (an ORM call) are all nodes; a node may have a parent to any depth; the middleware interface is an enter/exit hook pair on a node. `afterTransaction`, the deferred transaction begin/end hooks, ADR 160's unbuilt `groupingKey`, and the annotation-copying convention all become special cases of it. Full write-up and open questions in `discussion-query-grouping.md`.

Open before it can be specified: names for the node and the two hooks; whether a node is reached from the middleware context or the plan; whether `afterTransaction` survives as a convenience. When Will wants it, it is its own project with its own ADR, not a slice of this one.

## Rules Will gave in these sessions, in his words where it matters

- Use the established vocabulary (`docs/glossary.md`). Never invent a term; "operation" and "call" were both rejected as undefined. Define any new word before using it.
- Do not make up rules for middleware authors; document the behaviour.
- Separate the ideal from the pragmatic. Do not redesign the middleware system inside a cache slice.
- Every subagent on Opus (`model: "opus"`), implementers and reviewers alike. Never Fable.
- Never use the question UI. Never end a report with open questions. If something truly needs Will, say it once with a recommendation.
- Reply to review threads yourself and resolve them when the code answers them; do not draft replies for Will to post. Drafts are only for messages in his voice to colleagues.
- No AI attribution on commits or PRs. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` through `mise exec --`. Push through the `bot` remote. Never amend, rebase or force-push.
- Do not run the full integration or e2e suites locally; single packages and single files only.
- The auto-mode classifier blocks queueing a PR for merge ("Merge Without Review"); turn on the app's CI monitor on every PR and tell Will when a PR is ready for him to queue.
- The prisma-8-demo app's `pnpm start` crashes on Node 24 without a Temporal polyfill (TML-3246); preload it with `tsx --import temporal-polyfill/global` for manual checks.

## Loose ends, none urgent

- `main` has two ADR 259s (ours, and "Query fragments are functions", which merged first). Renumbering ours is a small separate PR; Will has not asked for it.
- The direct single-client Postgres driver limit above affects the already-shipped cache read path (a runtime-scope read sent while a transaction is open can store uncommitted rows). Not ticketed. Search Linear before filing.
- paulwer's cache PR #30132 was closed by Will; the post-commit hook he needed now exists. Telling him is Will's decision; two Discord drafts sit in the asks system from aladdin-24.
