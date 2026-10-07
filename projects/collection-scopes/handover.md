# Handover: collection scopes project

**Written:** 2026-10-07, by session shonagon-99, just before a rate limit. The previous handover (bragi-59, 2026-10-05) is superseded by this one; its review artifacts are in `formal-reviews/` and `verification-2026-10-06/`.

**Transcript of shonagon-99:** `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-model-scopes-handover-86b983/04d397bd-668b-4b4d-aa7f-f8f9ff7a06e9.jsonl`. It is JSONL; filter for `"role":"user"` to read Will's messages, which hold every ruling. The previous transcript (bragi-59) is at `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prometheus-67-transcript-38822b/4e95a23c-54dc-4602-9d06-65d2f2811331.jsonl`.

The operator is Will. Work as `~/.claude/CLAUDE.md` says: design with him, execute without interrupting him, review every slice, fix, verify, then hand to him. Memory file: `~/.claude/projects/-Users-wmadden-Projects-prisma-orm/memory/project-collection-scopes-design.md`.

## What the project is

A developer writes a reusable piece of a query once and runs it on any collection it fits, with sound types. Read `spec.md` and `plan.md` here, then ADR 265 (a collection keeps its class through the chain), ADR 259 (query fragments are functions) and the draft ADR for slice 4 (`docs/architecture docs/adrs/ADR 260 - Packages offer ... for their kinds of index.md` on this branch; it needs a new number, because main's ADR 260 is the `afterTransaction` decision). ADR numbering on main changed on 2026-10-06 (#30619): the collection ADR is 265, not 258.

## Vocabulary, as ruled by Will

- **2026-10-07, latest:** the general term is **query fragment** (**fragment**): a function from a collection to a collection. A **scope** is specifically a query fragment that only imposes conditions on the query. A **row fragment** is a function of the model accessor, which `where` and `orderBy` take. Soft-delete and tenant filters are scopes; a shared `select` and `include` is a fragment, not a scope. The name `scope` is kept free for a later per-model default feature.
- **2026-10-07:** the collection method that runs a fragment is **`with(fn)`**, not `apply` (merged, #30635). A pure filter is written `where(rowFragment)`. `use()` was the runner-up; `pipe`, `chain`, `tap`, `modify`, `merge`, `combine`, `and` are rejected.
- Rejected earlier and not to be proposed again: a `when()` combinator (no control flow in the query API); `modelStep`; declaring a fragment's fields by pointing at a model's field (`db.Post.fields.deletedAt`).
- The discussion doc that led to these rulings: `discussions/scope-or-fragment.md`.

## State of every branch and pull request (all on the `bot` remote; push only there)

| What | PR | Branch | State on 2026-10-07 |
| --- | --- | --- | --- |
| Design, ADR 259 and 265 | #30543 | merged | Merged 2026-10-06. |
| Slice 1: a collection keeps its class, `with`, `Fragment` (still named `Scope`) | #30560 | merged | Merged 2026-10-06 (as TML-3403). |
| Planner manifest fix for main after slice 1 | #30616 | merged | Merged 2026-10-06. |
| Slice 2: `db.orm.scope`, `Post.scope`, `orderByField`, list declarations, write refusals | #30564 | merged | Merged 2026-10-07 06:45 (TML-3436). |
| `apply` → `with` | #30635 | merged | Merged 2026-10-07 15:57 (TML-3508). |
| Index types declare whether they back a foreign key | #30561 | `index-types-declare-foreign-key-backing`, tip 4176bc2569 | Up to date with main (merged 2026-10-07), every touched package's tests pass. **Waits for Will's review.** Slice 3 is stacked on it. |
| Slice 3: weighted full-text index as index type `fullText` | #30562 | `weighted-full-text-index`, tip a18e769eb2 | Code, reviews and description final; up to date with #30561's tip. Blocked on #30561. After #30561 merges, GitHub retargets it to main; merge main again (it will need `with` and, once TML-3512 lands, `fragment` in the demo). The only local test failure is `cross-shell-tarball`, a pnpm-version problem of this machine; it passes in CI. |
| Scope → fragment rename | none yet | `tml-3512-query-fragments` | **In progress at handover.** An implementer was told to push a `WIP:` commit whose message lists what is done and not; read `git log bot/tml-3512-query-fragments`. The ticket TML-3512 holds the full rename list. At handover (tip 9a920e0ad0): all public and internal renames, file renames, the `fragment-namespace` fixture re-emit, error texts and the client, facade and demo docs are done; client, facade and demo tests pass. Not done: the upgrade entry `upgrade-instructions/pending/query-fragments/{app,extension}` and its validation by execution; the planner manifest (its two fixture paths were edited by hand and the integration-side hash is stale: regenerate with `PLANNER_GOLDEN_WRITE=1`, confirm only those lines moved); the whole-repository typecheck, all lints, `check:upgrade-coverage --prev e49161cf19`, `fixtures:check`, the renamed `namespaced-accessors-fragments` integration test and `planner-ddl-golden`; the design-branch vocabulary edits (ADR 260 file rename and names, `projects/collection-scopes/`); confirming `declaration-emit` ran in the demo tests. When done: open the PR (title `TML-3512: ...`, description as the owner's rules say: grounding diff first, decision, what changes, upgrading, alternatives last, `Agent: <name>`), bind it, turn on the monitor, run a short review pass, then hand to Will. |
| Slice 4 design draft (query fragments built from index definitions) | #30428 | `model-scopes-design` (this branch) | Draft. Conflicts with main; needs main merged and a new ADR number. Slice 4 starts after slice 3 merges and TML-3512 lands. |
| Integration tests in the merge queue | none yet | `tml-3481-integration-tests-in-merge-queue` | **Not this project's.** Will handed TML-3481 to another agent, who has pushed on top of shonagon-99's draft. Leave it alone. |

## What to do next, in order

1. Read the `WIP:` commit on `tml-3512-query-fragments`. Finish TML-3512 (an Opus implementer in its own worktree; brief it with the ticket, the standing rules in `verification-2026-10-06/standing-rules-for-agents.md`, and the checks list below), open the PR, review it once, hand it to Will.
2. When Will approves #30561, queue it. Then merge main into slice 3 (#30562): expect fixture re-emits (`pnpm fixtures:emit`, the demo migration via the regen script, the planner manifest via `PLANNER_GOLDEN_WRITE=1`), the `with` and `fragment` renames in the demo, and the planner manifest. Hand to Will.
3. After slice 3 and TML-3512 merge: bring `model-scopes-design` up to date with main, renumber the draft ADR, apply the fragment vocabulary (TML-3512's implementer was told to do this; check), then build slice 4 through the Drive process with `/drive-code-review`. Its two open points are closed in `spec.md`. Then manual QA across the feature, then Will's final verification, then the default-scopes discussion.
4. Follow-ups filed, needing Will's decision: TML-3490 (`upsert` and `create` ignore the filter, limit and offset of the collection they are called on; recommend refusing). Comment on TML-2913 (scalar comparisons such as `like` are offered on list fields).

## Checks before any push (every PR here passed these)

Whole-repository `mise exec -- pnpm typecheck`; typecheck, lint and tests of every touched package; demo (`examples/prisma-8-demo`) typecheck and tests, including `declaration-emit`; `pnpm fixtures:check`; `lint:deps`, `lint:throws`, `lint:casts`, `lint:agent`, `lint:skills`, `lint:framework-vocabulary`; `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base bot/main HEAD) --head HEAD`; the integration files the change touches, **one at a time, never the suite** (`cd test/integration && mise exec -- pnpm test test/<file>`), always including `test/planner-golden/planner-ddl-golden.test.ts` when a committed `contract.json` changes.

## Things learned this round

- Main merges through a merge queue that reruns CI, but integration tests are not required anywhere and the queue skips them (TML-3481 fixes this). A PR can show a red integration shard and still merge; check `gh pr checks` yourself before and after queueing, and after a queue rejection (`RemovedFromMergeQueueEvent`, reason `failed_checks`), because the monitor does not report it.
- `test/planner-golden/manifest.json` lists every committed SQL `contract.json` with a hash of its planner output. Any PR that adds or changes a contract must regenerate it; two PRs that each pass alone can break main together.
- Fixtures, demo migrations and snapshots are regenerated with the tooling, never edited by hand. The demo's migration `20260922T1218_add_post_title_search` is rewritten in place when the format changes; CodeRabbit accepted this (learning recorded on #30562).
- `gh pr edit` fails on some PRs with a token error about review requests; `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file` works.
- Will's rules learned the hard way this session: never run the full integration suite locally; an agreed design or a follow-up question is not permission to build ("go ahead" is); one PR at a time when he says so; never use Fable for subagents, always Opus.

## Standing rules (all bind)

Name yourself first (`bash ~/.claude/scripts/agent-name.sh`). Push only through `bot`; commit with `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; no AI attribution lines; never amend, rebase, squash or force-push; run node, pnpm and commits through `mise exec --`; never the full integration, e2e or package suites locally; stay inside your worktree, working files under `wip/`; no question UI, no spawn_task chips; subagents on Opus; plain English, short, no hard-wrapped markdown; PR titles `TML-NNNN: sentence`; bind every PR you own and turn its monitor on; never report "0 fail" while checks run; make engineering decisions yourself and bring Will only design changes, once, with a recommendation.
