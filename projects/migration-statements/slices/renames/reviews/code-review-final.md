# Code review (principal engineer pass) — rename statements

**Branch:** `tml-3475-statement-renames` · **Base:** `tml-3474-migration-statements-sync` · **Diff:** `git diff tml-3474-migration-statements-sync...HEAD` · **Spec:** [`../spec.md`](../spec.md)

## Summary

The feature works end to end on both targets for ordinary names, and the journeys, fixtures check and vocabulary ratchet all pass. One defect must be fixed before merge: the new Postgres `renameColumn` operation puts the table name into SQL without escaping it, and a probe executed an injected `CREATE TABLE` through a `--rename` field statement (F01).

## What looks solid

- Statements are resolved once, in the framework, before anything is written. The resolver's error messages name the contract that was searched and list what it contains, capped at twenty names, and the "field named through its old model" error prints the corrected statement. The tests cover every rule of the Grammar and Resolution sections.
- Both SQL planners share one statement planner and one working schema, and the hand-written facade uses the same working schema. So the planner and a hand-written `migration.ts` cannot drift. Both journeys check that re-running `migration.ts` writes byte-identical `ops.json` and `migration.json`.
- The working schema keeps the database's real constraint names (it spells out names that were derived from the old table or column), so the companion renames start from what the database holds. Re-planning from the live database after every probe that ran to completion produced an empty plan. This includes a table outside `public` with a foreign key from `public`, a 94-byte derived constraint name, three field statements on one table with a type change, a policy naming a renamed column, and on SQLite a column rename followed by a table rebuild.
- `db update` reads the snapshot only when statements are given. The test for this uses a serializer that throws on the origin snapshot, so the test fails if the snapshot is ever read. The runner still receives a plan with no origin, as before.
- SQLite identifiers are escaped everywhere I tried. The `COLLATE NOCASE` precheck is right on both sides: a case-only rename uses an exact match, and any other rename refuses a new name that matches an existing column in another case. A case-only table rename goes through a temporary name.
- Postgres truncates identifiers longer than 63 bytes. A rename to a 94-byte derived name was truncated the same way a create would truncate it. The postcheck still passed, because it compares the name as Postgres's `name` type, which truncates the same way. Nothing drifted afterwards.
- MongoDB refuses statements with a message that tells the user how to keep their data by hand, on both commands.

## Findings

### F01 — Postgres renders table names without escaping, so a field statement can run injected SQL

**Location:** `packages/3-targets/3-targets/postgres/src/core/migrations/operations/columns.ts` lines 59–66 (new `renameColumnStatement`); the shared cause is `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` lines 173–175 and 270–272 (`qualifyTable`). The same helper reaches `operations/tables.ts` lines 27–28 (`RENAME TO`), `operations/constraints.ts` lines 191 and 218 (`RENAME CONSTRAINT`, and the other `qualified` uses in that file), and `contract-free/checks.ts` lines 41–50 (the `to_regclass` argument of every table-exists check).

**Issue:** `qualifyTable` builds `"schema"."table"` without doubling a `"` inside the names. `quoteIdentifier`, which does escape, is used only for the new name. `renameColumn`'s prechecks bind the table name as a parameter against `information_schema`, so they pass for the real table, and then the unescaped `ALTER TABLE` runs. Probe P4 used the table name `Post" ADD COLUMN "pwned" int; CREATE TABLE "pwned"(id int); --` and the statement `--rename Profile.email:Profile.mail`. The planner emitted `ALTER TABLE "public"."Post" ADD COLUMN "pwned" int; CREATE TABLE "pwned"(id int); --" RENAME COLUMN "email" TO "mail"`, and PGlite created table `pwned` and added column `pwned` to `Post`. The table name comes from `@@map`, and `contract infer` copies table names from an existing database into `@@map`. So a name that someone else chose can reach this path when a project adopts an existing database. The same root cause breaks legal names. A model statement to a table named `Or"der` renamed the table correctly and then failed its postcheck (P5), because `to_regclass('"public"."Or"der"')` returns NULL. Creating a table whose name contains `"` already failed before this slice, in `ADD CONSTRAINT` (P1). This slice adds the first call site whose precheck passes, and it plans that call automatically from a statement.

**Suggestion:** Fix the helper, not the call site, so every caller is covered. Then add a planner-to-PGlite test that renames a table and a column whose names contain `"`, `\` and a space.

```ts
// postgres-schema.ts
qualifyTable(tableName: string): string {
  return `${quoteIdentifier(this.id)}.${quoteIdentifier(tableName)}`;
}
// unbound namespace override
override qualifyTable(tableName: string): string {
  return quoteIdentifier(tableName);
}
```

`regclassLiteral` and `tableExistsAst` build on `qualifyTable`, so they become correct too. Search for other places that build `"${...}"` from storage names (`git grep -n '"\${' packages/3-targets/3-targets/postgres/src`) in the same change.

### F02 — SQLite plans a table rename onto a name SQLite already holds in another case, and the rename then fails at `migrate`

**Location:** `packages/3-targets/3-targets/sqlite/src/core/migrations/schema-tables.ts` line 11 (`hasTable`); `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 321–330; `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` line 355 and `packages/3-targets/3-targets/sqlite/src/contract-free/checks.ts` lines 66–78.

**Issue:** SQLite treats table names that differ only in case as the same name, and tables and indexes share one set of names. The statement planner's "already has a table" check calls `hasTable`, which compares names exactly. The operation's precheck uses `name = ?` with `type = 'table'`. Probe S5 had an origin with tables `Profile` and `user`, a destination that drops `user`, and the statement `--rename Profile:User`. It planned, passed the precheck, and failed on execute with `there is already another table or index with this name: User`. The plan fails at `migrate` instead of at `migration plan`. Column renames already handle this case: `columnsNamed` and the `COLLATE NOCASE` precheck. Table renames do not.

**Suggestion:** Give `SchemaTables` a `tablesNamed(namespaceId, table)` that matches the way `columnsNamed` does (SQLite: `sqliteIdentifiersCollide`; Postgres: exact). Refuse when it returns anything other than the table being renamed. In the SQLite precheck, drop the `type` filter and compare with `COLLATE NOCASE`, except for a case-only rename. The same failure can happen on Postgres when an index, sequence or view in the schema has the new name, because they share one set of names with tables. That is less likely, and the same `tablesNamed` change can cover it.

### F03 — A column rename re-creates checks, policies and expression or partial indexes that name the column, so an instant rename becomes a full-table operation

**Location:** `packages/3-targets/3-targets/postgres/src/core/migrations/working-schema.ts` lines 164–220 (`withIndex`, `withCheck` and `withPolicy` keep the SQL text unchanged); the SQLite equivalent is in `packages/3-targets/3-targets/sqlite/src/core/migrations/working-schema.ts` lines 69–95.

**Issue:** Postgres rewrites stored check, policy and index expressions on `RENAME COLUMN`. The working copy keeps the old text, so the diff drops the object and creates it again. In P6 the plan emitted `DROP CONSTRAINT "email_present_07726780"` and then `ADD CONSTRAINT "email_present_d9d49f99" CHECK ((length(mail) > 0))`. Adding the check back reads every row while holding an `ACCESS EXCLUSIVE` lock. In P7 the policy was created again and the old one dropped. Recreating an expression or partial index rebuilds it. The spec accepts this for checks ("recreated by the existing check path"), so the result is correct. But a user who reads "Rename column" in the plan expects a change that touches no rows, and on a large table it locks the table for a long time. Nothing in the output or the docs says so.

**Suggestion:** At minimum, say in the README's rename section and in the plan output that a check, policy or expression index naming the renamed column is recreated. Better: re-add such a check as `NOT VALID` and then `VALIDATE CONSTRAINT`, which takes a lighter lock. Or teach the working copy to take the destination's definition when it equals the origin's with the column renamed.

### F04 — On SQLite, a column rename followed by a table rebuild builds the replacement index twice

**Location:** `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts` lines 220–225.

**Issue:** In S4 (a field statement plus a nullability change on the same table), the plan ran `CREATE INDEX "Profile_mail_idx_84594bc8"` as a companion of the rename. The "Recreate table Profile" step then dropped the table and created the same index again. The result is correct. On a large table, the index build is wasted work.

**Suggestion:** Leave out index-replacement companions for a table the diff rebuilds. Or accept the cost and leave a note in the planner.

### F05 — The `why` of a `statementRejected` conflict becomes the error's "fix", but most of these texts do not say what to do

**Location:** `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 242–423; `packages/1-framework/1-core/errors/src/control.ts` lines 391–397.

**Issue:** `errorMigrationPlanningFailed` joins the conflicts' `why` strings into `fix`. Most `statementRejected` `why` texts explain the refusal without giving a next step. Examples: "A rename cannot replace a table that already exists."; "The origin contract names the table, but the schema the plan starts from does not have it."; "The model's table would move from namespace "a" to namespace "b"."; "The rename produces a "widening" operation, and this command plans only "additive" operations." The field statement on a remapped table and the MongoDB refusal do give a next step. Cross-cutting requirement 5 asks each failure to say what to do.

**Suggestion:** Write each `why` as an instruction. For example: "Check that the database matches the origin contract with `db verify --schema-only`, or leave out this statement and rename the table by hand with `this.renameTable(...)`." Or add a `fix` field to the conflict and prefer it in `errorMigrationPlanningFailed`.

### F06 — `db update` says no snapshot was found when the snapshot exists but cannot be read

**Location:** `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts` lines 358–396; `packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts` lines 215–234; `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` lines 628–633.

**Issue:** `readContractSnapshotJsonTolerant` returns `undefined` for a missing file, for invalid JSON and for a content-hash mismatch. `readAppOrigin` treats all three as "not found", so the error says `No contract snapshot for hash "…" was found in <dir>` while the file is there. A user who checks the directory sees the file and has no way to tell that it is corrupt. Only a failure in `deserializeContract` fills in `unreadable`.

**Suggestion:** Check whether the file exists before calling the tolerant reader, or use the strict reader and catch its errors. Report an invalid or mismatched file as `unreadable` with its reason.

### F07 — No test covers a hostile identifier on the rename path, and no test covers the rule that only the application space gets statements

**Location:** tests for `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/operations/columns.ts`; `packages/1-framework/3-tooling/migration/src/aggregate/planner.ts` lines 82–84 and `packages/1-framework/3-tooling/migration/test/aggregate/planner.test.ts` lines 123–165.

**Issue:** (a) The rename tests use only plain names, and the target-package tests use a stub lowerer that renders every precheck as `stub`. So no test renders a rename for a name containing `"` and runs it. Such a test would have caught F01. (b) The aggregate planner gives `appSpace` (origin contract and statements) to the application space only, and `{ fromContract: null, statements: [] }` to every other space. The new test has only an application space. I found no test with a sibling space planned from the diff, so if every space received the application's statements, nothing would fail. An extension space's planner would then try to rename application tables in its own schema.

**Suggestion:** (a) Add the PGlite and `node:sqlite` hostile-name tests that F01 asks for, and run their prechecks for real. (b) Add an extension space with an empty graph to the aggregate planner test, and assert that its planner receives `fromContract: null` and `statements: []`.

### F08 — `OpFactoryCall.toOps?(lowerer?: unknown)` passes a target's type through the framework as `unknown`

**Location:** `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 175–180.

**Issue:** No framework code calls `toOps`. Only the Postgres and SQLite `render-ops.ts` call it. The parameter is `unknown` so that each target can declare `ExecuteRequestLowerer` instead. That works only because TypeScript does not check method parameters strictly (parameter bivariance), so a caller can pass anything and the compiler will not complain. This is the "family-agnostic dressing" smell listed in `drive/code/README.md`. The sibling method `toOp()` takes no parameter on the framework interface, and the targets reach their lowerer through a documented `blindCast`. So the two methods now follow two different patterns.

**Suggestion:** Declare `toOps` on the target call classes, or on each target's call union, and narrow in `render-ops.ts`. Or match `toOp()`'s framework signature and reuse the existing cast.

### F09 — The `db update` synopsis this slice edited still lists `-y|--yes`

**Location:** `packages/1-framework/3-tooling/cli/README.md` line 951.

**Issue:** The line gained `[--rename <old:new>]...` but still shows `[-y|--yes]`, which `db update` does not declare. The project spec names this as a known inaccuracy, and the slice's scope includes the README's `db update` section.

**Suggestion:** Remove `[-y|--yes]` from the synopsis, and check the section's other flags against `createDbUpdateCommand`.

## Deferred

None. Fixing F01 changes a helper that the create and add-constraint paths also use. It still belongs in this slice, because this slice adds the first call site whose precheck lets the unescaped SQL run, and plans that call automatically.

## Probes run

All probes ran against the built workspace. Postgres probes ran on PGlite (`createDevDatabase`) through the real Postgres control adapter, and SQLite probes ran on `node:sqlite`. Contracts came from PSL through `interpretPslDocumentToSqlContract` (Postgres) or were built by hand (SQLite). Statements went through `resolveStatements` from `@internal/cli/control-api` and then through `createPlanner(controlAdapter).plan(...)`. I ran each operation's precheck, execute and postcheck steps, then introspected the database and planned again from it without statements. The scratch tests were deleted afterwards.

| Probe | Input | Observed |
| --- | --- | --- |
| Build | `mise exec -- pnpm build` | 87 of 87 tasks succeeded, exit 0. |
| P1 (Postgres) | Table `Pro"file ü`, column `e"mail sel\ect` with a unique and an index, renamed to `Or"der \ table` and `se"lect; DROP TABLE x; --` | The setup failed before the rename: the `createTable` postcheck returned false, and `ALTER TABLE "public"."Pro"file ü" ADD CONSTRAINT …` raised a syntax error (the `qualifyTable` problem from F01, which existed before this slice). |
| P2 (Postgres) | `Profile:User` + 30 × `x` and `email_` + 40 × `a` to `mail_` + 25 × `ü`, with a unique on the column | The plan emitted `RENAME CONSTRAINT … TO "Userxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_mail_üüüüüüüüüüüüüüüüüüüüüüüüü_key"` (94 bytes). Postgres stored `Userxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_mail_üüüüüüüüüüü` (62 bytes, 51 characters). The postcheck passed and the new plan from the live database was empty. |
| P3 (Postgres) | Model in schema `auth` with an FK from `public.Post`; `auth.Profile:auth.User`, `auth.User.email:auth.User.fullName` | `ALTER TABLE "auth"."Profile" RENAME TO "User"` plus primary key, column and unique renames. `Post_profileId_fkey` now references `auth."User"`. The new plan from the live database was empty. |
| P4 (Postgres) | Table `Post" ADD COLUMN "pwned" int; CREATE TABLE "pwned"(id int); --`; `Profile.email:Profile.mail` | Ran `ALTER TABLE "public"."Post" ADD COLUMN "pwned" int; CREATE TABLE "pwned"(id int); --" RENAME COLUMN "email" TO "mail"`. Afterwards `to_regclass('public.pwned') = pwned` and `Post` had columns `{id,pwned}`. Then the postcheck failed (F01). |
| P5 (Postgres) | `Profile:Order` with `@@map("Or\"der")` | `ALTER TABLE "public"."Profile" RENAME TO "Or""der"` ran correctly. The postcheck `to_regclass('"public"."Or"der"') IS NOT NULL` was false (F01). |
| P6 (Postgres) | Three field statements: an FK column, an indexed column named in a check, and a column changing `Int` to `BigInt` | The FK, the index and the column were renamed. The check was dropped and added again (F03), and `ALTER COLUMN "points" TYPE int8` ran on the renamed column. The row kept its values. The new plan from the live database was empty. |
| P7 (Postgres) | `Profile:User`, `User.tenantId:User.orgId` (`@map`), with RLS and a policy using `(tenant_id = 1)` | The table, primary key and column were renamed. A new policy `tenant_read_88d265b5` with `(org_id = 1)` was created and the old one dropped. The new plan from the live database was empty. |
| S1 (SQLite) | `Pro"file \ ü` → `Or"der select`; column `e"mail sel\ect` → `se"lect; DROP TABLE post; --` | Every identifier was escaped, and every precheck bound its names as parameters (including the `COLLATE NOCASE` one). The FK in `post` followed the table. The new plan from the live database was empty. |
| S2 (SQLite) | Case-only `Profile.email:Profile.Email` | The precheck used the exact match `"name" = ?`. `RENAME COLUMN "email" TO "Email"` ran, and the index was replaced under `Profile_Email_idx_6ecb1576`. The new plan from the live database was empty. |
| S3 (SQLite) | Case-only `Profile:profile` | The table went through `_prisma_rename_profile`. The FK in `post` now references `"profile"`. One row kept. The new plan from the live database was empty. |
| S4 (SQLite) | `Profile.email:Profile.mail` plus a nullability change, with `PRAGMA foreign_keys = OFF` as the runner sets it | Rename, index replacement, then a table rebuild that copied `mail`. Both rows were kept. The index was built twice (F04). My first run left foreign keys on and failed in `DROP TABLE`; that was a problem in my test harness, not in the code. |
| S5 (SQLite) | Origin tables `Profile` and `user`; destination drops `user`; `Profile:User` | Planned, and the precheck passed. Execute failed with `there is already another table or index with this name: User` (F02). |
| SQLite NOCASE refusal | `pnpm test test/migrations/runner.rename-column.test.ts` (adapter-sqlite) | 2 of 2 passed. With an existing `Name` column, renaming `other` to `NAME` fails the precheck. |
| Journeys | `pnpm test test/cli-journeys/rename-statements-migration.e2e.test.ts`, then the `.sqlite.e2e.test.ts` file, in `test/integration` | Both runs exited 0, with every test passing. |
| Vocabulary ratchet | `pnpm lint:framework-vocabulary` | `count=254 threshold=254`; the threshold was not changed in the diff. |
| Fixtures | `pnpm fixtures:check` | Exit 0; `git status` clean afterwards. |

## Acceptance-criteria verification

The criteria come from the slice spec's Grammar, Resolution, Planner input, Operations and Origin contract sections, and its done conditions. AC27 and AC28 come from the project spec's cross-cutting requirements 5 and 8.

| AC | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| AC1 | `--rename <old>:<new>` on `migration plan` and `db update`, repeatable, processed in order | PASS | `flag.repeated` in `orm/migration/plan.ts` and `orm/db/update.ts`; `db-update.test.ts` "hands every --rename to the control API in the order given"; `resolve-model-statements.test.ts` "keeps the order the statements were given in". |
| AC2 | A malformed side gives `STATEMENT_INVALID`, quoting the statement and listing the four forms | PASS | `parse-rename.test.ts` asserts the code, the text and every form for seven malformed cases. |
| AC3 | A model on one side and a field on the other gives `STATEMENT_INVALID` | PASS | `parse-rename.test.ts` and `resolve-model-statements.test.ts` "refuses a model renamed to something that resolves as a field". |
| AC4 | A two-segment side resolves one way; both ways or neither way gives `STATEMENT_UNRESOLVED` naming both | PASS | `resolve-model-statements.test.ts` tests for both and for neither. |
| AC5 | A side with no namespace needs exactly one declaring namespace and lists the candidates otherwise; the default namespace is not special; names match exactly | PASS | `resolve-model-statements.test.ts` namespaces tests and "matches names exactly, including case". |
| AC6 | Model rename rules, with errors naming the contract searched and the names found there | PASS | Four refusal tests assert the reason text and the listed models; a twenty-name cap test. |
| AC7 | Field rename rules: same destination model, origin counterpart found through an earlier statement, fields cannot move between models | PASS | `resolve-field-statements.test.ts` (16 tests, including the corrected-statement message). |
| AC8 | Variants resolve; value objects are refused; relation fields resolve | PASS | Entity-kind tests in both resolver test files. |
| AC9 | Statements resolve against the application space only | WEAK | True by construction (the resolver takes application contracts; `planner.ts` lines 82–84). No test has a sibling space (F07). |
| AC10 | No origin contract with statements gives `STATEMENT_ORIGIN_UNKNOWN`, naming the hash and the directory, before planning | PASS | `db-update-statements.test.ts` (no marker, no snapshot, unreadable snapshot, with `calls` empty); journey S3.04. The message is inaccurate for a corrupt file (F06). |
| AC11 | Required `statements` on the framework and SQL planner options, passed on both paths | PASS | Types in `control-migration-types.ts` and `types.ts`; `plan-from-diff.test.ts` and `migration-plan-statements.test.ts` assert what the planner receives. |
| AC12 | Storage effect worked out from the storage bridge; equal storage means applied with zero operations | PASS | `statement-planning.test.ts` and `.fields.test.ts` "with no operations"; CLI "reports a statement that needs no operations as applied, without writing a package". |
| AC13 | Applied in order to a working copy, with companions computed against it, and the diff run on the result | PASS | Unit tests "renames the column on the table an earlier statement renamed"; probes P2, P3, P6, P7 and S1–S4 re-planned to empty. |
| AC14 | A table whose control policy is not `managed` gives a `statementRejected` conflict, surfaced as `PLANNING_FAILED` | PASS | Family tests for `external`, `observed` and `tolerated`; the target planner tests on both targets. The `fix` text is weak (F05). |
| AC15 | `appliedStatements` on the planner result; `Statements applied` after the operations; JSON field; description format | PASS | `migration-plan-statements.test.ts` and `db-update.test.ts` (human and JSON, dry run); journeys assert descriptions and counts. |
| AC16 | Table rename companions, FKs retargeted, policies follow; a namespace move gives `statementRejected` | PASS | Journey S1 (primary key renamed, `Post` FK follows, policy kept); P3 (FK across schemas); `statement-planning.test.ts` namespace-move test. |
| AC17 | `renameColumn` facade and planner call on both targets with prechecks, postchecks and companions | FAIL | Works for ordinary names (P6, S1–S4, journeys). The Postgres operation renders the table name unescaped and ran injected SQL in P4 (F01). |
| AC18 | Rendered as facade calls; re-running `migration.ts` reproduces `ops.json` byte for byte | PASS | Journeys S1.06–S1.07 on both targets; unit tests compare the planner's and the facade's operations. |
| AC19 | Non-data drops are `widening` on both targets; no consent asked for them; upgrade fragment | PASS | `non-data-drops-widening.test.ts` checks the call and the lowered operation; SQLite `dropIndex`; `upgrade-instructions/pending/migration-statement-renames/app`. |
| AC20 | `db update` reads the snapshot of the marker hash and passes it as `fromContract` | PASS | `db-update-statements.test.ts` "plans from the snapshot of the marker hash"; journey S2. |
| AC21 | Without statements, nothing is read and behaviour is unchanged | PASS | `db-update-statements.test.ts` "reads no snapshot without statements" (the serializer throws if called); runner plan origin `null`. |
| AC22 | `db init` declares no `--rename` | PASS | `orm/db/init.ts` declares no `rename` flag, and `db-init.ts` passes `renames: []`. |
| AC23 | Done condition: journey on both targets, with rows, unique, FK, index, check and policy; further plan empty; `db verify` clean; `db update` without prompt; second run `STATEMENT_UNRESOLVED` | PASS | Both journey files pass. The SQLite fixture has no check, because the target does not support checks. The Postgres check is not on the renamed column; P6 covers that case. |
| AC24 | Done condition: re-run writes identical `ops.json` and `migration.json` | PASS | Journey S1.07 on both targets. |
| AC25 | Done condition: `pnpm fixtures:check` with no changed files | PASS | Exit 0, clean tree. |
| AC26 | Done condition: `lint:framework-vocabulary` count unchanged | PASS | 254 of 254; threshold unchanged. |
| AC27 | Cross-cutting requirement 5: an unusable statement fails before anything is written | PASS | Resolution runs before the seed phase. `migration-plan-statements.test.ts` asserts no new package directory. A `statementRejected` from the planner comes after the seed phase, the same as any other planning failure. |
| AC28 | Cross-cutting requirement 8: companions follow a rename on both targets, not a rebuild | PASS | Journeys; P2, P3, P6, S1–S3. Checks, policies and expression indexes on a renamed column are recreated, as the spec says (F03). |

| Verdict | Count |
| --- | --- |
| PASS | 26 |
| FAIL | 1 (AC17) |
| WEAK | 1 (AC9) |
| NOT VERIFIED | 0 |

## Round A verification

**Range:** `git diff a281f94e50..098161ba64` (commits e2b69c3b47, 2ac20b141f, e7390c11a8, b03bc9f790, ce493b8631, e72902a3cf, 56fed270cb, e4523b86ba, 098161ba64). I rebuilt the workspace with HEAD at 098161ba64 and probed the result. Round B works in the same worktree. While I worked it committed 3c9b7c2db5 and left uncommitted edits to the facade files, so my build may include some of those edits. None of the files that carry the round A fixes (`postgres-schema.ts`, `sqlite-unbound-database.ts`, the SQLite checks, `schema-tables.ts`, `statement-planning.ts`, `db-run.ts`) is among round B's changes.

### Findings

| Finding | Status | What I checked |
| --- | --- | --- |
| F01 | Closed | `qualifier()` and `qualifyTable()` now escape every part on Postgres (`postgres-schema.ts` lines 164, 174 and 272) and SQLite (`sqlite-unbound-database.ts`). The SQLite adapter's hand-rolled `escapePragmaArg` and the runner's `PRAGMA table_info` use `quoteIdentifier`. P1, P4 and P5 now run cleanly (see below). The new tests `rename-statements.hostile-names.integration.test.ts` (PGlite, 2 tests) and `rename-statements.hostile-names.test.ts` (`node:sqlite`, 1 test) pass. They go through the real runner with its prechecks, and they assert the full table list, so an injected `CREATE TABLE` would fail them. Without the fix both would fail: the injection test's `ALTER TABLE "public"."p"` names a table that does not exist, and the precheck of the other test cannot find a table whose name has a quote in it. The sweep left two pieces of hand-built SQL; see F10. |
| F02 | Closed | `SchemaTables.tablesNamed` compares exactly on Postgres and ignores case on SQLite. The statement planner and the facade resolver both refuse a name another table holds, excluding the table being renamed. The SQLite `renameTable` precheck now uses `COLLATE NOCASE` against `sqlite_master` with no `type` filter, except in a case-only rename. S5 is refused at plan time, and the operation's precheck stops it at migrate time (S5b). Two gaps remain, both runtime refusals rather than plan-time ones, and both unlikely: on SQLite an index holding the new name is caught only by the precheck, and on Postgres an index, sequence or view holding it is not checked at all. |
| F03 | Closed | The README's rename section and the Migration System doc now say that a check, policy, or expression or partial index naming a renamed column is dropped and created again, and that re-adding a check reads every row under an exclusive lock. This is the "at minimum" fix I suggested. The plan output does not say so. |
| F04 | Deferred | Recorded in `projects/migration-statements/deferred.md`. The reason holds: removing the companion would break the rule that re-running `migration.ts` reproduces `ops.json`. |
| F05 | Reopened, two of eleven texts | Nine of the eleven texts read as plain English and end in a real next step. Two do not: the refusals for a table, or a column, that the starting schema does not have (`statement-planning.ts` lines 319 and 403, through `CHECK_THE_DATABASE` at line 164). They tell the user to "check that the database matches the origin contract with prisma db verify --schema-only". But `db verify` compares the database with the emitted contract, which by then is the destination, and it has no option to compare with another contract. After a rename it reports the pending rename itself as drift, and it cannot show whether the database matches the origin. These refusals fire under `db update`, when the live database lacks something the contract of its last update names. A correct text would be: "The database has no table "X", although the contract it was last updated to names it, so the database has drifted from that contract. Inspect it with `prisma db schema`, or leave out this statement." |
| F06 | Closed | `readAppOrigin` now uses the strict `readContractSnapshotJson`. A missing file (`CONTRACT_SNAPSHOT_MISSING`) is reported as missing. Invalid JSON, a content mismatch or a contract the family cannot load is reported as unreadable, with the reason, its own summary and a "restore `migrations/snapshots/` from version control" fix. A hash that is not 64 hex characters is reported as missing without touching the filesystem. Any other filesystem error, such as `EACCES`, is thrown unchanged. That is acceptable. `db-update-statements.test.ts` passes 11 of 11. |
| F07 | Closed | (a) The hostile-name tests are listed under F01. (b) `planner.test.ts` now has an extension space planned from the diff next to the application space. It asserts that the extension receives `fromContract: null` and `statements: []`, and that the application space receives the origin and the statements. It passes 10 of 10. |
| F08 | Open in this range | Not changed in a281f94e50..098161ba64. Round B's commit 3c9b7c2db5, "move toOps from the framework call type to the SQL targets' call bases", appears to address it. It is outside the range, and I did not review it. |
| F09 | Closed | The `db update` synopsis now lists `--to`, `--advance-ref` and `--confirm <database>` instead of `-y|--yes`, and the bullet above it names `--confirm`. All three flags are declared in `createDbUpdateCommand` or by the engine. The `migration plan` synopsis gained `--confirm <directory>` and the interactive flags. |
| F10 (new) | Open, outside the rename path | The sweep did not reach two pieces of hand-built SQL in `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` at 098161ba64. First, line 2046 joins `CREATE POLICY` role names unquoted (`node.roles.join(', ')`). PSL roles are checked identifiers, but the TypeScript `role(name)` helper only checks that the name is not empty, so `role('x; DROP TABLE y')` reaches the SQL text. A plain `quoteIdentifier` would break `PUBLIC` and `CURRENT_USER`, so quote every name except those keywords. Second, line 1924 splits a foreign key's `refTable` on `.` before quoting, so a referenced table whose name contains a dot is read as a schema and a table. That is a correctness bug, not an injection. Neither line is on the rename path, and neither is new in this slice. File them as a ticket rather than fixing them here. Everything else that builds SQL text in both targets and both adapters goes through `quoteIdentifier`, `pgQualify`, `qualifyTable` or bound parameters. I checked this with `git grep -nE '"\$\{'` and with a grep for SQL keywords followed by `${`, over `packages/3-targets`, `packages/2-sql` and `packages/3-extensions`. The only other hits are labels, descriptions and error messages. |

### Probes re-run against the fixed tree

The harness is the same as in the first pass: PSL contracts on PGlite through the real control adapter, every operation's precheck, execute and postcheck run in order, then a new plan from the introspected database. SQLite S5 used hand-built contracts and, for S5b, the real runner. The scratch tests and logs were deleted afterwards.

| Probe | Before (first pass) | Now |
| --- | --- | --- |
| P1 (Postgres): table `Pro"file ü`, column `e"mail sel\ect`, renamed to `Or"der \ table` and `se"lect; DROP TABLE x; --` | Setup failed: `ADD CONSTRAINT` syntax error, and the `createTable` postcheck was false. | Setup succeeded. Five widening renames ran, each with every quote doubled (for example `ALTER TABLE "public"."Or""der \ table" RENAME COLUMN "e""mail sel\ect" TO "se""lect; DROP TABLE x; --"`). Afterwards the tables are `Or"der \ table` and `Post`, the constraints and indexes carry the destination names, the row was kept, and a new plan from the live database is empty. |
| P4 (Postgres): table `Post" ADD COLUMN "pwned" int; CREATE TABLE "pwned"(id int); --`, `Profile.email:Profile.mail` | The injected SQL ran: table `pwned` was created and `Post` gained a `pwned` column. | It ran `ALTER TABLE "public"."Post"" ADD COLUMN ""pwned"" int; CREATE TABLE ""pwned""(id int); --" RENAME COLUMN "email" TO "mail"`. `to_regclass('public.pwned')` is NULL, `Post` has only `id`, and the payload-named table has columns `id` and `mail`. A new plan from the live database is empty. |
| P5 (Postgres): `Profile:Order` with `@@map("Or\"der")` | The rename ran, then the postcheck failed. | The rename, the primary-key rename and the unique rename all ran and passed their postchecks. The table is `Or"der`, with constraints `Or"der_pkey` and `Or"der_email_key`, and one row. A new plan from the live database is empty. |
| S5 (SQLite): origin tables `Profile` and `user`, destination drops `user`, `Profile:User` | Planned, the precheck passed, then execute failed with "there is already another table or index with this name". | Refused at plan time: a `statementRejected` conflict, "the schema being planned from already has a table "User", as "user"", with the fix "Rename or drop table "user" first, or leave out this statement." |
| S5b (SQLite): the planned rename run by the real runner on a database that has `user` | Not run. | `MIGRATION.PRECHECK_FAILED`: "ensure no table or index is named "User" in any case". Both tables are still there. |
| Round A tests | — | Postgres hostile names 2/2; SQLite hostile names 1/1; SQLite `runner.rename-table` 3/3 (including the case and index refusals); family `statement-planning.refusals` 11/11; aggregate `planner` 10/10; CLI `db-update-statements` 11/11. |

### Acceptance criteria re-scored

| AC | Was | Now | Evidence |
| --- | --- | --- | --- |
| AC17 | FAIL | PASS | P1, P4 and P5 run cleanly. The PGlite and `node:sqlite` hostile-name tests rename a table and a column through statements with the real runner and its prechecks. |
| AC9 | WEAK | PASS | `planner.test.ts`: "gives the origin contract and statements to the app space only, and none to an extension space planned from the diff". |

| Verdict | Count |
| --- | --- |
| PASS | 28 |
| FAIL | 0 |
| WEAK | 0 |
| NOT VERIFIED | 0 |

The other 26 criteria keep their first-pass verdicts. The round A changes to the files they rely on were refusal texts, error texts and documentation. AC14 still passes: the policy refusal fires as before, and only its wording changed (F05).
