# Evidence behind the plan

One entry per row of [plan.md](plan.md): the pull requests, tickets and dates that justify the status there. Read the plan first; come here when you need to click through.

States were last checked against GitHub and Linear on 2026-10-07.

## Stream 1: Foundations and breaking changes

**Row 1, finish ADR 254.** Design finished 2026-09-29. Merged 2026-10-06: data types declare their names and parameters (TML-3386, prisma/orm#30547), and contract columns store a data type id with an upgrade script (TML-3388, prisma/orm#30576). Not started, both backlog: TML-3387 (verify and infer read types from the declarations) and TML-3389 (the cast rule checks function arguments, enum values and discriminator values). The plan PR (prisma/orm#30518) was closed; its documents landed with slice 1.

**Row 2, one CLI and one config file.** Composer's config is the `composer` section of `prisma.config.ts` (prisma/composer#328, merged 2026-10-01). The `prisma-composer` binary is gone, nothing names it, and a lint keeps it out (prisma/composer#331, merged 2026-10-05). `prisma` hosts that release from 8.0.0-rc.20 (prisma/prisma-cli#330). `prisma` gets no `destroy` or `log` command, by the project's decision: they stay operations on `@prisma/composer/control`, and a command-line form is separate work. Open: the public docs (prisma/web#8387) and the ORM-side shaping PR (prisma/orm#30536).

**Row 3, early MySQL attempt.** No ticket, no branch.

**Row 4, SQL expression literals.** Merged: the `sql` tag writes the data type `sql/expression` (TML-3296, prisma/orm#30534), raw SQL ending in a line comment renders valid DDL (TML-3287, prisma/orm#30546), and migration files write SQL holding both quote kinds (TML-3290, prisma/orm#30554). Those tickets were closed on 2026-10-07. In review: index, check and policy SQL written as `sql` literals (TML-3288, prisma/orm#30550), the TypeScript builder takes `sql` values (TML-3289, prisma/orm#30558), and attribute arguments declare their data type (TML-3367, prisma/orm#30539). TML-3297 is a stretch goal.

**Row 5, PSL mixins.** TML-3055, unchanged since July. Serhii takes it (Will, 2026-10-05).

**Row 6, remove `@noCheck`.** No ticket. Replacements decided, see [decisions.md](decisions.md). Unblocked: nullable list elements merged on 2026-10-01 (prisma/orm#30051).

**Row 7, migration statements.** Shaped 2026-10-05 (prisma/orm#30604, Linear project "Destructive changes need stated intent"). Slice 1 of 4 in progress (TML-3475). Slice 2 (TML-3476) makes `migration plan` refuse data loss and replaces `--confirm` with `--delete`, which is breaking. Replaces `@hint`, shelved on 2026-10-05.

## Stream 2: Upgrade path from Prisma 7

**Row 1, close every urgent and high upgrade issue.** Linear projects "Prisma 7 contract source: gaps and defects" and "Contract print and Prisma 7 source follow-ups". Done since 2026-09-28: TML-3252, TML-3256, TML-3260, TML-3278, TML-3358. Open: TML-3250 (urgent; its fix merged in prisma/orm#30520 on 2026-09-30, and the ticket only needs closing), TML-3267 and TML-3268 (high: `@updatedAt` with `@default(now())`, and generated values on optional fields; both backlog), and TML-3322, TML-3323, TML-3326 (high, `contract print`; all backlog). The high issues from the migration handover are in row 2.

**Row 2, Prisma 8 owns migrations in a Prisma 7 project.** Proven 2026-10-05 in prisma/orm#30601. No baseline command is needed. In review since 2026-10-05: adding `autoincrement()` to an existing column (TML-3466) and keeping Prisma 7's constraint names (TML-3452, high), both in prisma/orm#30606. The project docs on main drop the baseline step in prisma/orm#30605, open. Open gaps: the planner refuses enum value changes (TML-3456, high), referential action changes (TML-3457, high) and primary key changes (TML-3458); TML-3460 (the datasource's extensions list); TML-3461 (`prisma migrate dev` and the other Prisma 7 commands answer with their replacements).

**Row 3, unexposed storage.** Planned 2026-10-05 (Linear project "Unexposed storage: tables and columns the ORM never sees", slices TML-3468 and TML-3469). Settles TML-3453: Prisma 7's `_prisma_migrations` is declared as unexposed storage, so `db verify --strict` passes after the handover. Also fixes TML-3467 (adding `@ignore` after the handover drops the column without asking) and the reverse case in TML-3462.

**Row 4, upgrade guide rewrite.** Not tracked. The guide already drops the baseline commands (prisma/web#8291, merged 2026-09-17). It still tells `prisma7Schema` users to switch to a printed contract file before Prisma 8 takes over migrations, which prisma/orm#30601 showed is unnecessary.

**Row 5, codecs.** TML-3270, backlog.

**Row 6, columns Prisma 8 does not manage.** Proposed 2026-09-30 (`@control(external)` on a column, and an `unknown` type). The contract IR already has a control policy per column. PSL only has `@@control` per model. Row 3 covers storage Prisma 8 manages but hides from the ORM; this row is storage Prisma 8 does not manage at all.

**Row 7, enum membership check on adoption.** Not designed. Rejected: marking the contract as not managed during side-by-side running (see [decisions.md](decisions.md)).

**Rows 8 to 10.** Medium and low upgrade issues: the same two Linear projects. `money` codec: part of TML-3270. Views: TML-3269.

## Stream 3: Editor and tools

**Row 1, emulator controls in the CLI.** Not tracked. Raised to the top of the stream by Will on 2026-09-30. Will takes it (2026-10-05). No PR found in prisma/orm, prisma/composer or prisma/prisma-cli.

**Row 2, VS Code extension.** Language server, all merged: hover (prisma/orm#30569), hover on arguments (prisma/orm#30591), go to definition (prisma/orm#30578), find references (prisma/orm#30621), multi-file schemas (prisma/orm#30456), and resolution on the new binder (prisma/orm#30545, prisma/orm#30563). Open: file watching without client notifications (prisma/orm#30535; its ADR number clashes with ADR 256 on main since prisma/orm#30619). The formatter without the CLI was not checked.

**Row 3, extension and Prisma Postgres instances.** Not started.

**Row 4, multi-file PSL.** Last part merged 2026-09-30 (prisma/orm#30456).

## Stream 4: Query features

**Row 1, transaction options.** Split from nested transactions on 2026-10-05. A draft adds an isolation level option (prisma/orm#30333, draft since 2026-09-17).

**Row 1b, nested transactions.** Its own project since 2026-10-05.

**Row 2, nested writes on relations.** TML-2781.

**Row 3, replacement for `omit`.** Not started.

**Row 4, expressions in updates.** `update` takes plain values only today.

**Row 5, a query that fails when nothing matches.** Serhii's plan is a new collection method, `whereUnique()`. Today it exists only as `.all().firstOrThrow()`, which reads every row. Related: prisma/orm#30362 (TML-3093) makes single-row `update()` and `delete()` require a unique `where()`, open since 2026-09-21.

**Row 6, JSON and list filters.** prisma/orm#29834, stalled since 2026-07-28.

**Unranked: row locking on a select.** Linear project "Row locking clauses on a select". The typed SQL builder merged 2026-10-06 (TML-3402, prisma/orm#30549). Open: the ADR (prisma/orm#30542) and the ORM client (TML-3415, prisma/orm#30555).

**Unranked: collection classes and scopes.** A collection keeps its class through the chain, merged 2026-10-06 (TML-3403, prisma/orm#30560, ADR 265), with its design and the query-fragments ADR 259 (prisma/orm#30543). Open: scopes (TML-3436, prisma/orm#30564, in review) and the index-scopes design (prisma/orm#30428, draft).

**Unranked: `variant()`.** Merged 2026-10-06 (prisma/orm#30577).

**Unranked: the Postgres driver returns text.** Merged 2026-10-06 (TML-3443, prisma/orm#30597).

**Unranked: cache middleware.** Invalidation and pluggable keys merged (TML-3398, prisma/orm#30530), the design record merged as ADR 266 (prisma/orm#30600), and every query has an `afterTransaction` stage, merged 2026-10-06 (TML-3399, prisma/orm#30614, ADR 260). Invalidation after commit on top of it is TML-3400, backlog.

## Stream 5: Docs and the new user's first hour

**Row 1, stop naming `prisma-composer`.** TML-3340. Done in prisma/composer#331 (merged 2026-10-05), which removes every mention and adds a lint against it. The public docs fix is prisma/web#8387, open. The Linear ticket is still in Backlog.

**Row 2, correct the skill's query reference.** Not tracked as one task. Related tickets: TML-3440 (the skill tells users to import `@internal/*` packages), TML-3346 (back-references), TML-3365 (an undeclared alias in an example). Open PRs: prisma/orm#30483 (back-references), prisma/orm#30495 (TML-3364, data transforms).

**Row 3, docs gaps found by the eval.** Listed in [eval-friction-2026-09-28.md](eval-friction-2026-09-28.md). Not re-checked item by item. Related: prisma/web#8389 (prerequisites up front, one skill-install command), merged 2026-10-06.

**Row 4, ORM scenario for the eval.** Will's decision.

**Row 5, docs restructure.** prisma/web#8243, draft, last updated 2026-09-30.

**Row 6, cursor pagination note.** For the upgrade guide and "Coming from Prisma ORM 7". Not tracked.

**Row 7, records that contradict the code.** Listed in [query-feature-gaps.md](query-feature-gaps.md).

## Beside the streams

**Manifesto.** prisma/prisma-orm-messaging#17, open, last updated 2026-10-01.

**One lowering for PSL and the TypeScript contract builder.** WhyAsh (prisma-idb) spiked translating PSL into `defineContract` input so both authoring surfaces share one implementation. Serhii takes over the topic with WhyAsh (Will, 2026-10-05). Spike: [prisma-idb plan](https://github.com/prisma-idb/prisma-idb/blob/ad0914f94ba2321e79904a4d3e34305867533659/packages/prisma-orm/plans/PLAN_SPIKE_psl_via_ts_dsl.md), [Discord thread](https://discord.com/channels/937751382725886062/1501983204381298732/1555550194664214608).
