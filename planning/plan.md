# Plan: Prisma 8 GA

**Goal:** ship Prisma 8 GA at the end of October 2026. November is the fallback.

This page lists the projects in priority order, by stream. Work the streams in parallel. Inside a stream, work from the top. The reasons behind each decision are in [decisions.md](decisions.md).

"GA" column: **Must** means GA does not ship without it. **Aim** means wanted at GA, but it can ship just after. **Later** means after GA. **Not decided** means Will has not placed it yet.

States were last checked against GitHub and Linear on 2026-10-07.

## Stream 1: Foundations and breaking changes

GA is the last chance to make breaking changes, so this stream decides the date.

| # | Project | GA | State | Waiting on |
| --- | --- | --- | --- | --- |
| 1 | Finish ADR 254: data types own column types | Must | Design finished 2026-09-29. Half done. Merged 2026-10-06: data types declare their names and parameters (TML-3386, prisma/orm#30547), and contract columns store a data type id with an upgrade script (TML-3388, prisma/orm#30576). Not started, both backlog: TML-3387 (verify and infer read types from the declarations) and TML-3389 (the cast rule checks function arguments, enum values and discriminator values). The plan PR (prisma/orm#30518) was closed; its documents landed with slice 1. | |
| 2 | One CLI and one config file: merge Composer's config into `prisma.config.ts`, remove the `prisma-composer` CLI | Must | Mostly done. Composer's config is the `composer` section of `prisma.config.ts` (prisma/composer#328, merged 2026-10-01). The `prisma-composer` binary is gone, nothing names it, and a lint keeps it out (prisma/composer#331, merged 2026-10-05). `prisma` hosts that release from 8.0.0-rc.20 (prisma/prisma-cli#330). `prisma` gets no `destroy` or `log` command, by the project's decision: they stay operations on `@prisma/composer/control`, and a command-line form is separate work. Open: the public docs (prisma/web#8387) and the ORM-side shaping PR (prisma/orm#30536). | |
| 3 | Early MySQL attempt, to find shared code that assumes PostgreSQL | Must | Not started. No ticket. | |
| 4 | SQL expression literals | Must | In progress. Merged: the `sql` tag writes the data type `sql/expression` (TML-3296, prisma/orm#30534), raw SQL ending in a line comment renders valid DDL (TML-3287, prisma/orm#30546), and migration files write SQL holding both quote kinds (TML-3290, prisma/orm#30554). Their tickets were closed on 2026-10-07. In review: index, check and policy SQL written as `sql` literals (TML-3288, prisma/orm#30550), the TypeScript builder takes `sql` values (TML-3289, prisma/orm#30558), and attribute arguments declare their data type (TML-3367, prisma/orm#30539). TML-3297 is a stretch goal. | |
| 5 | PSL mixins, then remove type aliases and field presets (TML-3055) | Must | No spec. Serhii takes it (Will, 2026-10-05). The ticket is unchanged since July. | Spec |
| 6 | Remove `@noCheck` and `.noCheck()`, and the `noCheck` field in the contract | Must | Not started. No ticket. Replacements decided, see [decisions.md](decisions.md). Unblocked: nullable list elements merged on 2026-10-01 (prisma/orm#30051). | |
| 7 | Migration statements: the planner refuses data loss, and the user states renames, deletes, conversions and backfills on the command line. Replaces `@hint`, which was shelved on 2026-10-05. | Not decided | Shaped 2026-10-05 (prisma/orm#30604, Linear project "Destructive changes need stated intent"). Slice 1 of 4 in progress (TML-3475). Breaking: slice 2 makes `migration plan` refuse data loss and replaces `--confirm` with `--delete`. | Will: GA or after |

## Stream 2: Upgrade path from Prisma 7

Test: an existing Prisma 7 database can be signed by Prisma 8.

| # | Project | GA | State | Waiting on |
| --- | --- | --- | --- | --- |
| 1 | Close every urgent and high upgrade issue (Linear: "Prisma 7 contract source: gaps and defects", "Contract print and Prisma 7 source follow-ups") | Must | In progress. Done since 2026-09-28: TML-3252, TML-3256, TML-3260, TML-3278, TML-3358. Open: TML-3250 (urgent; its fix merged in prisma/orm#30520 on 2026-09-30, and the ticket only needs closing), TML-3267 and TML-3268 (high: `@updatedAt` with `@default(now())`, and generated values on optional fields; both backlog), and TML-3322, TML-3323, TML-3326 (high, `contract print`; all backlog). The high issues from the migration handover are in row 2. | |
| 2 | Prisma 8 owns migrations in a Prisma 7 project that still reads `schema.prisma` | Must | Proven 2026-10-05 in prisma/orm#30601. No baseline command is needed. In review since 2026-10-05: adding `autoincrement()` to an existing column (TML-3466) and keeping Prisma 7's constraint names (TML-3452, high), both in prisma/orm#30606. The project docs on main drop the baseline step in prisma/orm#30605, open. Open: the planner refuses enum value changes (TML-3456, high), referential action changes (TML-3457, high) and primary key changes (TML-3458); TML-3460 (the datasource's extensions list); TML-3461 (`prisma migrate dev` and the other Prisma 7 commands answer with their replacements). | |
| 3 | Unexposed storage: the contract carries tables, columns and foreign keys that migrations manage but the ORM never exposes | Not decided | Planned 2026-10-05 (Linear project, slices TML-3468 and TML-3469). Settles TML-3453: Prisma 7's `_prisma_migrations` is declared as unexposed storage, so `db verify --strict` passes after the handover. Also fixes TML-3467 (adding `@ignore` after the handover drops the column without asking) and the reverse case in TML-3462. | |
| 4 | Upgrade guide rewrite | Must | Not tracked. The guide already drops the baseline commands (prisma/web#8291). It still tells `prisma7Schema` users to switch to a printed contract file before Prisma 8 takes over migrations, which prisma/orm#30601 showed is unnecessary. | |
| 5 | Codecs for `citext`, `bit`, `varbit`, `xml`, `oid` (TML-3270) | Must | Backlog | |
| 6 | Design: columns Prisma 8 does not manage, including columns of unknown type, in PSL and the Prisma 7 source (proposed: `@control(external)` on a column, and an `unknown` type) | Must | Proposed 2026-09-30. Not designed. The contract IR already has a control policy per column. PSL only has `@@control` per model. Row 3 covers storage Prisma 8 manages but hides from the ORM; this row is storage Prisma 8 does not manage at all. | Design |
| 7 | Adopting a Prisma 7 database without changing it: the enum membership check must not require a database change before cutover | Must | Not designed. Rejected: marking the contract as not managed during side-by-side running (see decisions.md). | Design |
| 8 | Medium and low upgrade issues | Later | Backlog | |
| 9 | `money` codec | Later | Backlog | |
| 10 | Views | Later | Backlog (TML-3269) | |

## Stream 3: Editor and tools

| # | Project | GA | State | Waiting on |
| --- | --- | --- | --- | --- |
| 1 | Emulator controls in the `prisma` CLI: start, stop, list, reset | Must, urgent | Not tracked. Raised to the top of the stream by Will on 2026-09-30: start it now. Will takes it (2026-10-05). No PR found in prisma/orm, prisma/composer or prisma/prisma-cli. | |
| 2 | VS Code extension: formatter without the CLI installed, go-to-definition, multi-file PSL, emulator controls | Must | In progress. Language server, all merged: hover (prisma/orm#30569), hover on arguments (prisma/orm#30591), go to definition (prisma/orm#30578), find references (prisma/orm#30621), multi-file schemas (prisma/orm#30456), and resolution on the new binder (prisma/orm#30545, prisma/orm#30563). Open: file watching without client notifications (prisma/orm#30535; its ADR number clashes with ADR 256 on main since prisma/orm#30619). The formatter without the CLI was not checked. Emulator controls in the extension wait on row 1. | 1 |
| 3 | Review how the VS Code extension handles local and remote Prisma Postgres instances, and make it match the current CLI and its emulators | Must | Not started | 1 |
| 4 | Multi-file PSL | Must | Done. Last part merged 2026-09-30 (prisma/orm#30456). | |

## Stream 4: Query features

Everything here is additive, so nothing here can block a breaking change.

| # | Project | GA | State | Waiting on |
| --- | --- | --- | --- | --- |
| 1 | Transaction options: isolation levels and timeouts | Must | Not designed. Split from nested transactions on 2026-10-05. A draft adds an isolation level option (prisma/orm#30333, draft since 2026-09-17). | Design |
| 1b | Nested transactions (transactions inside transactions) | Must | Not designed. Its own project since 2026-10-05. | Design |
| 2 | Nested writes on relations: `update`, `delete`, `upsert`, `set`, `connectOrCreate` (TML-2781) | Aim | Not started. Large. | Spec |
| 3 | Design the replacement for `omit` | Must (design only) | Not started | |
| 4 | Expressions in updates, which cover what `increment` and `decrement` did in Prisma 7 | When there is time | Not designed. `update` takes plain values only today. | |
| 5 | A query that fails when nothing matches, which covers what `firstOrThrow` did in Prisma 7 | When there is time | Serhii has a plan based on a new collection method, `whereUnique()`. Today it exists only as `.all().firstOrThrow()`, which reads every row. Related: prisma/orm#30362 (TML-3093) makes single-row `update()` and `delete()` require a unique `where()`, open since 2026-09-21. | Serhii's design |
| 6 | JSON filters and list filters | Later | prisma/orm#29834 stalled since 2026-07-28 | |

In progress but not ranked here:

- Row locking on a select (Linear project "Row locking clauses on a select"): the typed SQL builder merged 2026-10-06 (TML-3402, prisma/orm#30549). Open: the ADR (prisma/orm#30542) and the ORM client (TML-3415, prisma/orm#30555).
- Collection classes and scopes: a collection keeps its class through the chain, merged 2026-10-06 (TML-3403, prisma/orm#30560, ADR 265), with its design and the query-fragments ADR 259 (prisma/orm#30543). Open: scopes (TML-3436, prisma/orm#30564, in review) and the index-scopes design (prisma/orm#30428, draft).
- `variant()` selects by discriminator value, in the SQL and Mongo ORMs: merged 2026-10-06 (prisma/orm#30577).
- The Postgres driver returns every column as text so codecs decode once: merged 2026-10-06 (TML-3443, prisma/orm#30597).
- Cache middleware: invalidation and pluggable keys merged (TML-3398, prisma/orm#30530), the design record merged as ADR 266 (prisma/orm#30600), and every query has an `afterTransaction` stage, merged 2026-10-06 (TML-3399, prisma/orm#30614, ADR 260). Invalidation after commit on top of it is TML-3400, backlog.

## Stream 5: Docs and the new user's first hour

Test: the getting-started eval passes, in few steps and with no workarounds.

| # | Project | GA | State | Waiting on |
| --- | --- | --- | --- | --- |
| 1 | Docs and the shipped skill stop naming `prisma-composer` (TML-3340) | Must, urgent | Done in prisma/composer#331 (merged 2026-10-05), which removes every mention and adds a lint against it. The public docs fix is prisma/web#8387, open. The Linear ticket is still in Backlog. | |
| 2 | Correct the query reference in the shipped skill, which promises features that do not exist | Must, urgent | Not tracked as one task. Related tickets: TML-3440 (the skill tells users to import `@internal/*` packages), TML-3346 (back-references), TML-3365 (an undeclared alias in an example). Open PRs: prisma/orm#30483 (back-references), prisma/orm#30495 (TML-3364, data transforms). | |
| 3 | Docs gaps found by the eval: 11 items, 5 high | Must | Listed in [eval-friction-2026-09-28.md](eval-friction-2026-09-28.md). Not re-checked item by item. Related: prisma/web#8389 (prerequisites up front, one skill-install command), merged 2026-10-06. | |
| 4 | ORM scenario for the eval: decide the project, then build it | Must | Not decided | Will's decision |
| 5 | Docs restructure (prisma/web#8243) | Aim | Draft, last updated 2026-09-30 | |
| 6 | Document that cursor pagination starts after the cursor row, in the upgrade guide and "Coming from Prisma ORM 7" | Aim | Not tracked | |
| 7 | Update the records that contradict the code | Aim | Listed in [query-feature-gaps.md](query-feature-gaps.md) | |

## Databases

| Database | At GA |
| --- | --- |
| PostgreSQL | Ready |
| SQLite, MongoDB, MySQL/MariaDB | Can finish after GA. Labelled release candidate or early access until ready. They start once stream 1 has stopped changing what targets build on. |

## Beside the streams

| Item | Priority |
| --- | --- |
| Manifesto (prisma/prisma-orm-messaging#17) | Publish this week. The PR is still open, last updated 2026-10-01. |
| One lowering for PSL and the TypeScript contract builder: WhyAsh (prisma-idb) spiked translating PSL into `defineContract` input so both authoring surfaces share one implementation. Serhii takes over the topic with WhyAsh (Will, 2026-10-05). Spike: [prisma-idb plan](https://github.com/prisma-idb/prisma-idb/blob/ad0914f94ba2321e79904a4d3e34305867533659/packages/prisma-orm/plans/PLAN_SPIKE_psl_via_ts_dsl.md), [Discord thread](https://discord.com/channels/937751382725886062/1501983204381298732/1555550194664214608). | Not a GA item unless Will says so. |
| Asks | Lower. Will, in parallel. |
| Eval harness | Lower. Will, in parallel. |
| Platform faults found by the eval | Will, as platform lead. Not an ORM priority unless they delay GA. |

## After GA

Query linting, querying across contract spaces, performance work, migration runner service, the BetterAuth flow, referential actions on MongoDB. `@hint(was: oldName)` was listed here; migration statements replace it (stream 1, row 7).

## Never

`$extends`, the fluent relation API, `P2002`-style error codes, `Prisma.skip`, `omit` under that name, automatic batching, relation load strategy, `relationMode = "prisma"`, splitting large `IN` lists, soft delete, validation rules, lifecycle hooks, read replicas.
