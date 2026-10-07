# Handover — migration statements project, after slice 1

Written 2026-10-07 by turing-38, who took the project over from scylla-59 on 2026-10-06. Read this first, then the files it points to.

## Where things stand

- **Project:** "Destructive changes need stated intent" (Linear plan issue TML-3474). The user states migration intent on the command line (`--rename`, later `--delete`, `--convert`, `--backfill`) in contract vocabulary, and the planner refuses data loss that no statement covers.
- **Slice 1 (TML-3475), `--rename` for models and fields on Postgres and SQLite:** PR [prisma/orm#30638](https://github.com/prisma/orm/pull/30638). Will approved it on GitHub on 2026-10-07. It was retargeted from the shaping branch to `main` (it carries the shaping PR's two commits), every review thread is resolved, all checks were green, and auto-merge is on, so GitHub merges it through the merge queue. Linear: TML-3475 is "Ready to be merged".
- **Shaping PR [prisma/orm#30604](https://github.com/prisma/orm/pull/30604)** (branch `tml-3474-migration-statements`): has no approving review; its content lands through #30638. A comment on it says so. **First task:** once #30638 has merged, check `main` contains `projects/migration-statements/`, then close #30604 as superseded.
- **Merged `main` on 2026-10-07 (`23ab9de790`, then `355cca5342`):** TML-3393 conflicted in `migration-plan.ts`. Rule kept: in an auto-baseline plan, a delta the planner refuses writes nothing; a delta that only produced no operations writes the baseline first and returns TML-3393's error, so its advised `migration new --from` works (tested in `migration-plan-statements.test.ts`). Main's CLI-local `PlanOrigin` is now `PlanLegOrigin`. Gate green and pushed; auto-merge still on.
- **The PR branch was squashed on 2026-10-07** (by Will or one of his sessions, not by turing-38): `tml-3475-statement-renames` is now one commit on `main` (873554568f) plus a Gitleaks false-positive ignore (8e967c1e69). The unsquashed history is on `tml-3475-statement-renames-unsquashed` (355cca5342). Never force-push the PR branch; build on the remote tip.
- **Slices 2 to 4 have not started.** Will's instruction: do not spend anything on later slices until slice 1 is merged. After it merges, slice 2 (TML-3476) is next.

## Read these, in this order

1. `projects/migration-statements/spec.md` — project spec, including cross-cutting requirement 12 (the refusal is structured data and there is one statement entry point, so an interactive prompt can drop in later).
2. `projects/migration-statements/plan.md` — four slices, the stretch goal (interactive prompt when a human runs the command), and slice 2's carry-over.
3. `projects/migration-statements/deferred.md` — six deferred items with where each was found and what would resolve it.
4. `projects/migration-statements/design-notes.md` — the design discussion and prior art.
5. `projects/migration-statements/slices/renames/spec.md` and `plan.md` — slice 1 as specified; `dispatches/02` to `09` — every brief.
6. `projects/migration-statements/slices/renames/reviews/` — on this branch only (the folder is gitignored on the PR branch): `code-review.md` (the build-loop review: every finding D2-1 to D9-8 and every orchestrator decision under "Orchestrator notes"), `system-design-review.md` and `code-review-final.md` (the whole-slice architect and principal-engineer passes, with their round A and round B verifications).
7. `projects/migration-statements/manual-qa.md` and `manual-qa-reports/2026-10-07-qa-opus.md` — the QA script and run 1.

## Decisions taken in slice 1 that later slices must respect

- Statements are resolved in the framework CLI package (`packages/1-framework/3-tooling/cli/src/control-api/statements/`) into domain coordinates; the SQL family maps them to storage effects (`packages/2-sql/9-family/src/core/migrations/statement-planning.ts`); targets supply the working schema and rename calls.
- The control API takes `statements: readonly { verb, text }[]`, one ordered list keyed by verb. Slice 2's `--delete` adds a verb; the interactive prompt feeds answers into the same list.
- A refused statement is a `statementRefused` conflict carrying `refusedStatement` (domain coordinates) under `MIGRATION.PLANNING_FAILED`. Consumers key on the field, not the kind.
- `AppliedMigrationStatement` refers to its operations by position (`operationIndexes`), not by id. Operation ids are not unique within a plan; changing them was tried and reverted because re-emitting an existing migration with new ids changes its hash and drops its applied mark in `migration status`.
- `db update` reads the origin contract from the snapshot of the marker hash only when statements are given; the plan the runner receives keeps `origin: null`.
- MongoDB refuses every statement (its advice tells the user how to keep the documents by hand).
- Drops that lose no data are `widening` on Postgres and SQLite. Will decided on 2026-10-07 that dropping a row-level-security policy and disabling row-level security stay `widening`, and that slice 2 adds a separate per-operation consent before `db update` widens who can read or write rows (in TML-3476 and `plan.md`).
- A model moved to another namespace is refused; it ships with slice 3.

## Open before or during slice 2

- **Will must decide** the `@@map`-only rename gap (a model that keeps its name but changes its table has no statement) before slice 2 writes the refusal text. Options are in `deferred.md`.
- The missing-origin check in `resolve-statements.ts` runs over the whole input and must move inside the per-statement loop so `--delete` works without an origin contract.
- MongoDB still classes index drops as destructive (`deferred.md`); slice 2's refusal must not refuse a drop no statement can resolve.

## Tickets filed during slice 1 (Terminal team, Backlog)

- TML-3491: `@prisma/cli-engine`'s `flag.repeated` is typed as an array but is `undefined` when absent; the two handlers pass `args.flags.rename ?? []`.
- TML-3497: the Postgres control adapter writes policy role names and dotted foreign-key table names into SQL unquoted.
- TML-3498: every Postgres `db update` prints a planner warning naming `__unbound__`.
- TML-3499: `migration plan` drops the old column before the backfill placeholder that could read it.

## How the work was run (keep doing this)

- Drive process: one persistent implementer and one persistent reviewer per slice, both on Opus; a brief per dispatch under `slices/<slice>/dispatches/`; every finding blocks SATISFIED; `/drive-code-review` (architect and principal-engineer passes, with an execution budget for SQL probes) on the whole slice before the PR; a manual QA run against real databases before the PR.
- Commits: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, subject `TML-NNNN: …`, no attribution lines anywhere (also not in PR comments). Never amend, rebase or force-push. Push to the `bot` remote.
- Run node and pnpm through `mise exec --`. Never run the full integration, e2e or journey suites locally; run touched files and the two journeys `test/integration/test/cli-journeys/rename-statements-migration*.e2e.test.ts`.
- Lessons from this slice: the in-loop reviewer missed an SQL injection that only an executed probe found (calibration F34 applies to every rename or identifier change); manual QA found a blocker the reviews missed (an error's advice led to data loss), so every user-facing advice text must be followed end to end on each target before it ships.

## Context

- Previous orchestrator transcript (this session, turing-38): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prisma-orm-pr-transcripts-7cfc03/f140a641-868f-44d7-9ad0-a9798c7a6f84.jsonl`. It is about 15 MB; read it with `jq` filtered to user and assistant text, not whole. The desktop session is `claude://claude.ai/epitaxy/local_a22de419-71f1-4c58-840f-2a08aa6095c3`.
- scylla-59's transcripts (the design of the shelved and the current attempt) are under the `will` macOS account: `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-hint-mechanism-design-887c01/`.
