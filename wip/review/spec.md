# Review spec: prisma/orm#30475 (inferred)

> **Notice.** This spec was written by the review orchestrator (gagarin-12), not by the author. It is inferred from: the pull request description of [prisma/orm#30475](https://github.com/prisma/orm/pull/30475); the two defect comments by columbo-92 on that pull request ([one](https://github.com/prisma/orm/pull/30475#issuecomment-5904954696), [two](https://github.com/prisma/orm/pull/30475#issuecomment-5905041843)); the verification matrix in the description of [prisma/web#8349](https://github.com/prisma/web/pull/8349); and the diff `origin/main...HEAD`. No Linear ticket exists. Expectations are **inferred**, not explicit.

## Review range

Branch `gagarin/fix-cli-contract-reference-forms` (pushed as `fix/cli-contract-reference-forms`), base `origin/main`. Commits: `a930072e21`, `20615a96f0` (original author), `a08c5532ac` (merge of main, import conflict in `db/update.ts`), `b2eb5aad3f` (gagarin-12: fixes for the reported defects). Diff: `wip/review/diff.patch`.

## Intent

Every CLI command resolves a contract reference with one parser (`parseContractRef` in `@internal/migration-tools`). The help text advertised forms the parser never accepted (`./path`), two commands used the parser without supplying what `@contract` and `@db` need, `db update --to` crashed on reserved names, and `migration status` reported "Up to date" when the marker was not in the migration graph. The change makes each command's help list exactly the forms it accepts, and makes `migration status` and `db migrate` resolve `@contract` and `@db`.

## Functional requirements

1. `./path` is removed from every help brief, doc comment, and skill reference that listed contract reference forms. No path support is added.
2. `db sign`'s positional and `--contract` describe the same forms: hash, prefix, ref name, migration dir name, `<dir>^`. `db update --to` lists the same.
3. `migration status --to` and `--from` accept `@contract` (resolved offline from the emitted contract's hash) and `@db` (resolved from the live marker after the database read; needs a connection, `CONFIG.DB_CONNECTION_REQUIRED` otherwise, with a retry command that repeats the user's `--from`/`--to`).
4. `migration status --from @db` behaves like omitting `--from`. `--from <hash> --to @db` reads the database only for the target.
5. `db migrate --show --to @db` resolves the target from the marker. `usedLiveMarker` tracks whether the origin is live.
6. `db migrate --to @contract` applies up to the emitted contract. `db migrate --to @db` resolves to the live marker and reports "Already up to date". On a database with no marker, `@db` resolves to the empty contract and the run reports "Already up to date" without invoking the runner (gagarin-12 fix).
7. `db migrate --to @empty` resolves to the empty contract: on an empty database it reports "Already up to date"; on a database with a marker it fails with `MIGRATION.PATH_UNREACHABLE`.
8. `migration status` warns `MIGRATION.MARKER_NOT_IN_HISTORY` (exit 0) when the marker is not a graph node, including when it equals the emitted contract's hash.
9. `db update --to` refuses `@empty`, `@db`, `@contract` with `MIGRATION.REF_WRONG_GRAMMAR` before preparing the run.
10. The connection-required error raised inside `migrate --show` names the command `db migrate --show`.
11. Help for `migration status --from` no longer claims it always switches to offline computation; help for `db migrate --from` lists every form it accepts.

## Non-goals

- Adding `./path` support.
- Changing `db sign @empty` / `@db` (still `MIGRATION.SNAPSHOT_MISSING`).
- Changing `migration plan`, `migration new`, `migration ref set` grammar.

## Constraints and invariants

- `db migrate` stays replay-only: it never invents an edge. The placeholder hash from `parseContractRef` for `@db` is never used as a real hash.
- Every `--to` form other than `@db` resolves before a connection opens.
- Error codes stay within the existing catalogue (`docs/reference/error-reference.md` is verified by `pnpm check:error-reference`).
- CLI errors follow `.cursor/rules/cli-error-handling.mdc`.
- A declared-state plan (zero ops, missing marker, destination = head ref) must still reach the runner so the marker is written.

## Acceptance criteria

- AC1: `migration status --to @contract` yields the same document as no `--to`; `--from @contract` opens no connection.
- AC2: `migration status --to @db` resolves to the marker; `--from @db --to <pending-dir>` reports 1 pending with the base migration applied.
- AC3: `migration status --from <hash> --to @db` and `--from @db` without a connection fail with `CONFIG.DB_CONNECTION_REQUIRED` and `meta.missingFlags: ['--db']`.
- AC4: marker equal to the emitted contract with no migration ending there warns `MIGRATION.MARKER_NOT_IN_HISTORY`.
- AC5: `db migrate --show --from @empty --to @db` plans one migration ending at the marker; `--to @db` alone shows nothing to run; `--to @db` without a connection fails with `CONFIG.DB_CONNECTION_REQUIRED`.
- AC6: `db migrate --to @contract` hands the runner the emitted contract's hash and applies the pending migration; `--to @db` hands the runner the live marker's hash so nothing runs; `--to @db` without a connection fails before any connection opens.
- AC7: `db migrate --to @db` on a database with no marker, and `db migrate --to @empty` on an empty database, do not invoke the runner and report "Already up to date". A declared-state plan with no marker still invokes the runner.
- AC8: `db update --to @empty|@contract|@db` fail with `MIGRATION.REF_WRONG_GRAMMAR` and never reach the client.
- AC9: the `migrate --show` connection-required error's `why` names `db migrate --show`; no production `commandName` names a command that does not exist.
- AC10: no help brief, doc comment, or skill reference lists `./path` as a contract reference form.
- AC11: `pnpm check:error-reference` passes; error-reference entry for `MIGRATION.REF_WRONG_GRAMMAR` names the `db update --to` site.

## Risks

- `planRequiresExecution` is shared by every space; treating a missing origin as the empty contract must not stop declared-state extension plans from running (AC7).
- `migration status --from @db` reading the database changes the "offline" contract of `--from`; scripts that relied on `--from` never connecting are unaffected unless they pass `@db`.
- Help text changes are not tested; drift is caught only by reading.
