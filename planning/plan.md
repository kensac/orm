# Plan: Prisma 8 GA

**Goal:** ship Prisma 8 GA at the end of October 2026. November is the fallback.

This page lists the projects in priority order, by stream. Work the streams in parallel. Inside a stream, work from the top. The reasons behind each decision are in [decisions.md](decisions.md). The pull requests and tickets behind each status are in [evidence.md](evidence.md), one entry per row.

**GA column:** **Must** means GA does not ship without it. **Aim** means wanted at GA, but it can ship just after. **Later** means after GA. **Not decided** means Will has not placed it yet.

**Owner column:** who answers for the row. Everything not given to Serhii is Will's until he says otherwise.

**Status column:** ✅ done · 🟡 code done, waiting on review or docs · 🔄 in progress · ⏳ not started · ❓ needs a decision from Will.

States were last checked against GitHub and Linear on 2026-10-07.

## Stream 1: Foundations and breaking changes

GA is the last chance to make breaking changes, so this stream decides the date.

| # | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | Finish ADR 254: data types own column types | Must | Will | 🔄 2 of 4 slices merged | TML-3387 next: verify and infer read types from the declarations |
| 2 | One CLI and one config file | Must | Will | 🟡 Code done, public docs open | Merge the docs PR |
| 3 | Early MySQL attempt, to find shared code that assumes PostgreSQL | Must | Will | ⏳ Not started, no ticket |  |
| 4 | SQL expression literals | Must | Will | 🔄 3 slices merged, 3 in review | Review the three open PRs |
| 5 | PSL mixins, then remove type aliases and field presets | Must | Serhii | ⏳ No spec |  |
| 6 | Remove `@noCheck` and `.noCheck()` | Must | Will | ⏳ Not started, no ticket, unblocked |  |
| 7 | Migration statements: the planner refuses data loss, the user states renames, deletes, conversions and backfills | Not decided | Will | 🔄 Slice 1 of 4 in progress. Slice 2 is breaking | Finish slice 1 (TML-3475), then slice 2 (TML-3476) |

## Stream 2: Upgrade path from Prisma 7

Test: an existing Prisma 7 database can be signed by Prisma 8.

| # | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | Close every urgent and high upgrade issue | Must | Will | 🔄 5 closed, 6 open | TML-3267 next: `@updatedAt` with `@default(now())`. Close TML-3250 |
| 2 | Prisma 8 owns migrations in a Prisma 7 project that still reads `schema.prisma` | Must | Will | 🟡 Proven. Follow-ups: 1 PR in review, 5 gaps open | Review the PR, then the two high planner gaps |
| 3 | Unexposed storage: tables and columns migrations manage but the ORM never sees | Not decided | Will | ⏳ Planned, 2 slices |  |
| 4 | Upgrade guide rewrite | Must | Will | ⏳ Not tracked. One known error in the guide |  |
| 5 | Codecs for `citext`, `bit`, `varbit`, `xml`, `oid` | Must | Will | ⏳ Backlog |  |
| 6 | Design: columns Prisma 8 does not manage, including unknown types | Must | Will | ⏳ Proposed, not designed |  |
| 7 | Adopt a Prisma 7 database without changing it: the enum membership check | Must | Will | ⏳ Not designed |  |
| 8 | Medium and low upgrade issues | Later | Will | ⏳ Backlog | |
| 9 | `money` codec | Later | Will | ⏳ Backlog | |
| 10 | Views | Later | Will | ⏳ Backlog | |

## Stream 3: Editor and tools

| # | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | Emulator controls in the `prisma` CLI: start, stop, list, reset | Must, urgent | Will | ⏳ Not started, no PR |  |
| 2 | VS Code extension: formatter without the CLI, go-to-definition, multi-file PSL, emulator controls | Must | Will | 🔄 Language server done. File watching in review. Formatter without the CLI unverified | Review the file-watching PR. Verify the formatter works without the CLI. Emulator controls wait on row 1 |
| 3 | Make the extension's handling of local and remote Prisma Postgres match the CLI and its emulators | Must | Will | ⏳ Not started |  |
| 4 | Multi-file PSL | Must | Will | ✅ Done 2026-09-30 | |

## Stream 4: Query features

Everything here is additive, so nothing here can block a breaking change.

| # | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | Transaction options: isolation levels and timeouts | Must | Will | ⏳ Not designed. A stale draft exists |  |
| 1b | Nested transactions | Must | Will | ⏳ Not designed |  |
| 2 | Nested writes on relations: `update`, `delete`, `upsert`, `set`, `connectOrCreate` | Aim | Will | ⏳ Not started. Large |  |
| 3 | Design the replacement for `omit` | Must (design only) | Will | ⏳ Not started |  |
| 4 | Expressions in updates (what `increment` and `decrement` did in Prisma 7) | When there is time | Will | ⏳ Not designed | |
| 5 | A query that fails when nothing matches (what `firstOrThrow` did in Prisma 7) | When there is time | Serhii | ⏳ Planned, not designed |  |
| 6 | JSON filters and list filters | Later | Will | ⏳ PR stalled since July | |

In progress but not ranked here:

| Work | Owner | Status | Next |
| --- | --- | --- | --- |
| Row locking on a select | Will | 🔄 SQL builder merged. ORM client and ADR in review | Review the two open PRs |
| Collection classes and scopes | Will | 🔄 Collection classes merged. Scopes in review | Review the scopes PR |
| `variant()` selects by discriminator value | Will | ✅ Merged 2026-10-06 | |
| The Postgres driver returns every column as text | Will | ✅ Merged 2026-10-06 | |
| Cache middleware | Will | 🔄 Invalidation, keys and the after-transaction stage merged. Invalidation after commit in backlog | TML-3400 |

## Stream 5: Docs and the new user's first hour

Test: the getting-started eval passes, in few steps and with no workarounds.

| # | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- |
| 1 | Docs and the shipped skill stop naming `prisma-composer` | Must, urgent | Will | 🟡 Code done, public docs open | Merge the docs PR. Close TML-3340 |
| 2 | Correct the query reference in the shipped skill, which promises features that do not exist | Must, urgent | Will | 🔄 2 PRs open, 3 tickets open | Review the two PRs |
| 3 | Docs gaps found by the eval: 11 items, 5 high | Must | Will | 🔄 1 of 11 merged. The rest not re-checked | Re-check the 11 items against prisma/web |
| 4 | ORM scenario for the eval: decide the project, then build it | Must | Will | ❓ Not decided | Decide the project |
| 5 | Docs restructure | Aim | Will | 🔄 Draft since 2026-09-30 | |
| 6 | Document that cursor pagination starts after the cursor row | Aim | Will | ⏳ Not tracked | |
| 7 | Update the records that contradict the code | Aim | Will | ⏳ Not started |  |

## Databases

| Database | At GA |
| --- | --- |
| PostgreSQL | Ready |
| SQLite, MongoDB, MySQL/MariaDB | Can finish after GA. Labelled release candidate or early access until ready. They start once stream 1 has stopped changing what targets build on. |

## Beside the streams

| Item | Owner | Status | Priority |
| --- | --- | --- | --- |
| Manifesto | Will | 🔄 PR open, last updated 2026-10-01 | Publish. Was due the week of 2026-09-29 |
| One lowering for PSL and the TypeScript contract builder | Serhii | 🔄 Serhii and WhyAsh (prisma-idb) | Not a GA item unless Will says so |
| Asks | Will | 🔄 Ongoing | Lower, in parallel with GA |
| Eval harness | Will | 🔄 Ongoing | Lower, in parallel with GA |
| Platform faults found by the eval | Will, as platform lead | ⏳ Not started | Not an ORM priority unless they delay GA |

## After GA

Query linting, querying across contract spaces, performance work, migration runner service, the BetterAuth flow, referential actions on MongoDB. `@hint(was: oldName)` was listed here; migration statements replace it (stream 1, row 7).

## Never

`$extends`, the fluent relation API, `P2002`-style error codes, `Prisma.skip`, `omit` under that name, automatic batching, relation load strategy, `relationMode = "prisma"`, splitting large `IN` lists, soft delete, validation rules, lifecycle hooks, read replicas.
