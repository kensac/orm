# Code review — slice 1, statement renames

Per-round review artifact for [`../spec.md`](../spec.md) and [`../plan.md`](../plan.md). The reviewer owns the scoreboard, the findings log and the round notes. The orchestrator owns the subagent IDs and the orchestrator notes.

## Subagent IDs

| Role | ID | Since |
| --- | --- | --- |
| Implementer | (set on dispatch 2, round 1) | 2026-10-06 |
| Reviewer | (set on dispatch 2, round 1) | 2026-10-06 |

Dispatch 1 was implemented and reviewed under the previous orchestrator (scylla-59, 2026-10-05). Its implementer and reviewer transcripts are not available to this orchestrator (turing-38), so dispatch 2 starts fresh subagents and the dispatch 2 reviewer also reads the dispatch 1 commits.

## Scoreboard

| Dispatch | Round | Verdict | Date |
| --- | --- | --- | --- |
| 1 — salvage the planner substrate | 1 | SATISFIED (scylla-59's reviewer; the last two commits on 2026-10-05 are its fix-ups) | 2026-10-05 |
| 2 — statement grammar and resolver | 1 | ANOTHER ROUND NEEDED (one should-fix, three low) | 2026-10-06 |
| 2 — statement grammar and resolver | 2 | SATISFIED (D2-1 to D2-4 closed; D2-5 low, optional) | 2026-10-06 |
| 3 — model renames on both SQL planners | 1 | SATISFIED (three low findings, optional; D2-5 closed in e043835caf) | 2026-10-06 |
| 4 — column rename and field statements | 1 | ANOTHER ROUND NEEDED (one should-fix, three low; D3-1 to D3-3 closed) | 2026-10-06 |
| 4 — column rename and field statements | 2 | ANOTHER ROUND NEEDED (D4-1 to D4-4 closed; D4-5 should-fix, a one-sentence wording change) | 2026-10-06 |
| 4 — column rename and field statements | 3 | SATISFIED (D4-5 closed in 44a375555a) | 2026-10-06 |
| 5 — flag, db update origin, output | 1 | ANOTHER ROUND NEEDED (three should-fix, two low) | 2026-10-06 |
| 5 — flag, db update origin, output | 2 | SATISFIED (D5-1 to D5-5 closed; D5-6 low, optional) | 2026-10-06 |
| 6 — journeys, upgrade fragments, docs | 1 | ANOTHER ROUND NEEDED (one should-fix, two low; D5-6 closed in acbb7a504e) | 2026-10-06 |
| 6 — journeys, upgrade fragments, docs | 2 | SATISFIED (D6-1 to D6-3 closed) | 2026-10-06 |
| Mongo refusal (79e90c0bfe, 8cf229a4a7, ba30ff6324) | 1 | ANOTHER ROUND NEEDED (M-1 should-fix, one string) | 2026-10-06 |
| 7 — M-1 closure and merge of main (e8b1b46ea0, fd649676da, 9c09483884) | 1 | ANOTHER ROUND NEEDED (D7-1 should-fix, message text; the merge is sound) | 2026-10-07 |
| 7 — D7-1 (624c89798f) | 2 | SATISFIED (D7-1 closed) | 2026-10-07 |
| 9 — QA findings and round B follow-ups (236e87d425..ecab6397be) | 1 | ANOTHER ROUND NEEDED (D9-1 should-fix, D9-2 and D9-3 low) | 2026-10-07 |
| 9 — round 2 (ecab6397be..11685e67a9) plus the line-by-line pass | 2 | ANOTHER ROUND NEEDED (D9-1 to D9-3 closed; D9-4 to D9-7 should-fix) | 2026-10-07 |
| 9 — round 3 (11685e67a9..696a2cb915) | 3 | SATISFIED (D9-4 to D9-7 closed; D9-8 low, optional) | 2026-10-07 |

## Findings log

### D2-1 · should-fix · closed in 1b7b28ac83 · `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts:368-374`

The failure: a user runs `--rename Profile:User --rename Profile.name:User.fullName`. That is the natural thing to type, because the old field lives on `Profile`. They get `MIGRATION.STATEMENT_INVALID` with "a field cannot move between models", and the fix line lists the four coordinate forms. Nothing tells them that a field's model must be named as the destination contract names it, so they do not learn that the statement they need is `User.name:User.fullName`. The same happens when they leave out the model statement. The rule exists only in the error reference.

Recommended change: when `from.destinationModel` is `undefined` (the old model is not in the destination contract), say so in the why and give the corrected statement. For example: `"app.Profile" is not a model of the destination contract. Name a field's model as the destination contract names it: --rename User.name:User.fullName`. If no earlier statement renames `Profile` to the new model, also say that the model needs its own `--rename Profile:User` first. Extend the existing test at `resolve-field-statements.test.ts:67` to assert the corrected statement appears in the message.

### D2-2 · low · closed in 1b7b28ac83 · `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts:513` and `src/utils/cli-errors.ts:486`

Both errors use one fixed `fix` line for every reason. `STATEMENT_UNRESOLVED` always says "the old name must exist in the origin contract…". That is unhelpful when the reason is a bare name declared in several namespaces (the fix is to add the namespace) or a value object (there is no fix in this release). `STATEMENT_INVALID` always shows the four coordinate forms. That is unhelpful for "an earlier statement already renames …". The `why` text is right in every case, so this is noise, not a wrong instruction. Recommended change: let the caller pass the `fix` text along with the reason, or leave out the forms line when the problem is not the syntax.

### D2-3 · low · closed in 1b7b28ac83 · `packages/1-framework/3-tooling/cli/test/control-api/statements/resolve-field-statements.test.ts`

No test covers renaming two fields to the same new name (`User.a:User.c`, `User.b:User.c`). Deleting the `renamedTo` check at `resolve-statements.ts:386-393` leaves every test green. The model version of this check is tested at `resolve-model-statements.test.ts:225`. Recommended change: add the field version of that test.

### D2-4 · low · closed in 1b7b28ac83 · `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts:189-195`

A missing bare model lists every model of every namespace. On a contract with a few hundred models, one CLI error line holds a few hundred names. Recommended change: list the models of one namespace only when the contract has one namespace, or cap the list (for example the first 20 and "and N more").

### D2-5 · low · closed in e043835caf · `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts:416-441`

`oldModelNotInDestination` asks for `--rename <oldModel>:<newModel>` whenever no earlier statement renamed the old model to the new side's model. In two cases that advice is wrong:
- The old model was already renamed to a different model. Take origin `{A{x}, C{z}}`, destination `{B, C{y}}` and the statements `A:B`, then `A.x:C.y`. The message says to add `--rename A:C`. Doing so gives `STATEMENT_INVALID` ("already renames app.A").
- The new side's model also exists in the origin. Take `A` deleted and `C` in both contracts, and the statement `A.x:C.y`. Adding `--rename A:C` gives `STATEMENT_UNRESOLVED` ("app.C already exists in the origin").

In both cases the user is trying to move a field between models. The plain "a field cannot move between models" message is the right answer.

Recommended change: give the corrected statement and the model-statement advice only when the old model was not renamed by an earlier statement and the new side's model is not in the origin. Otherwise use the same message as the two-models branch. Add one test for the first example.

### D3-1 · low · closed in 1ebff800f1 · `packages/2-sql/9-family/src/core/migrations/plan-helpers.ts:138-139`

The line `...(conflict.statement ? { statement: conflict.statement } : {}),` appears twice in `plannerSuccess`. The second copy does nothing, but it reads like a merge mistake. Recommended change: delete one copy.

### D3-2 · low · closed in 1ebff800f1 · `packages/3-targets/3-targets/postgres/test/migrations/planner.statements.test.ts:138`

The test named "computes the companions of a later statement on the schema an earlier one left" still passes when the renames are computed against the original schema. The implementer found this during the remove-the-rule check. Its two renames do not interact, so the name claims something the test cannot detect. The test at `:164` ("pairs foreign keys against the tables earlier statements renamed") does detect it. That test gives the destination's foreign keys in the opposite order to the origin's, so pairing against the original schema would swap `article_a` and `article_b`. Recommended change: rename the `:138` test to describe what it checks (two statements planned in order, each with its companions), or delete it.

### D3-3 · low · closed in 482bb47c04 · `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:418`, `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts:219`

The rename calls a statement produces, and their companions, go into the plan without the operation-class check that both planners apply to the diff's calls. On SQLite, for example, `disallowedIndexCalls` checks the diff's index replacements, but not the index replacements that come with a rename. This causes no failure today: renames are `widening`, and every caller that can pass statements allows `widening` (`migration plan`, `migrate`, `db update`; `db init` takes no statements). It becomes a defect as soon as a caller passes statements with a narrower policy. Recommended change: check each statement call, and each of its companions, against `options.policy.allowedOperationClasses` in `planStatements` or in each planner's `planStatements`. Refuse a disallowed one with the conflict the planner already uses (`conflictForDisallowedCall` on SQLite). Add one test with an additive-only policy.

### D4-1 · should-fix · closed in 47efb01650 (its advice text is D4-5) · `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` (`#planField`), `packages/3-targets/3-targets/postgres/src/core/migrations/table-rename-calls.ts` (`destination === undefined`)

The failure: in the origin contract, model `User` is stored in table `users`. In the destination contract, `@@map` changes the table to `app_users` and field `name` is renamed to `fullName`. The user runs `--rename User.name:User.fullName`. The statement resolves. `#planField` takes the origin table `users`, finds no earlier model statement for it, and emits `ALTER TABLE users RENAME COLUMN name TO fullName`. Because the destination has no table `users`, the column rename gets no constraint companions. The diff then drops `users` and creates `app_users`.

The plan reports the field statement as applied with one operation, but the table it renamed a column on is then dropped. On `db update` the user sees a drop that needs `--confirm`. On `migration plan` the plan includes a drop of a table with rows. The statement did nothing useful, and its report hides the real problem.

The user also cannot fix this with statements, because `--rename User:User` is unresolved (the new name already exists in the origin). See the note for the orchestrator.

Recommended change: in `#planField`, compare the working name of the origin table (after earlier model statements) with the destination model's table (`modelTable(contract, statement.to)`). When they differ, refuse with `statementRejected`. The summary should name both tables, for example `Cannot rename column "users"."name": the model's table changes from "users" to "app_users", and no statement renames the table`. When the check is in place, the `destination === undefined` branch in `postgresColumnRenameCall` can no longer be reached from the planner. Keep it for the hand-written facade. Add a family test for this case.

### D4-2 · low · closed in d199e234ed · `packages/3-targets/3-targets/postgres/test/migrations/planner.field-statements.test.ts:183`, `packages/3-targets/3-targets/sqlite/test/migrations/rename-column.test.ts`

The test "plans the call the facade call it renders would emit" checks two things: that the plan renders the facade call text, and the planner's op ids. It never runs the facade. On SQLite, nothing compares the facade and the planner at all. If the facade (start contract plus `schemaAfterRenames`) and the planner (`working.current`) ever computed different companions, no test would fail before dispatch 6's journeys. Recommended change: on each target, build a hand-written migration whose `operations` spread the facade call the planner rendered, with the same start and end contracts. Assert that its ops deep-equal the planner's ops: ids, labels and SQL.

### D4-3 · low · closed in 57099c7ac4 · `packages/3-targets/6-adapters/{postgres,sqlite}/test/migrations/`

The table rename has runner tests (`runner.rename-table.test.ts` and `runner.rename-table.integration.test.ts`). They pin that when both the old and the new table exist, the precheck fails instead of the rename being skipped. The column rename has no such test. Its postcheck ("new present and old absent") is false when both columns exist, so today's behaviour is right by construction. But the table tests exist because this exact regression happened once. Recommended change: add the column version of the SQLite runner test. The Postgres one can wait for the journeys.

### D4-4 · low · closed in 0b3295a68d · `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/columns.ts` (`renameColumn`)

SQLite compares column names without regard to case. I checked this against sqlite 3.54: with `Name` present, `ALTER TABLE "User" RENAME COLUMN "other" TO "NAME"` fails with "duplicate column name: NAME". The precheck `pragma_table_info ... WHERE name = ?` compares exactly, so it passes, and the failure surfaces as a raw database error during execute. The planner's `hasColumn` check is also exact. This can happen in a plan whose diff drops `Name` after the statements have run. The case-only rename itself works; I confirmed it renames the column and rewrites the index SQL. Recommended change: make the SQLite target-name check ignore case, for example `name = ? COLLATE NOCASE` for the "new name absent" step, keeping an exact match when the two names differ only in case. Or use `sqliteIdentifiersCollide` in the planner check.

### D4-5 · should-fix · closed in 44a375555a · `packages/2-sql/9-family/src/core/migrations/statement-planning.ts:377-378`

The D4-1 refusal says: "Make the change of table name and the field rename two separate migrations." Following that advice loses data. The migration that holds only the `@@map` change is still planned by `migration plan` as drop `users` and create `app_users`, because no statement can say the table was renamed (the spec gap noted in round 1). `migration plan` asks consent only for a baseline, so the user who does as we say writes and applies a migration that drops a table with rows.

The only safe way today is to write the table rename by hand. Recommended `why` text: `The column would be renamed on a table the plan then drops and creates under the new name. Rename the table in a migration of its own, written by hand with ...this.renameTable({ table: "users", to: "app_users" }) in migration.ts, then plan the field rename on top of it.` Build the table names from `table` and `destinationTable.table`. `db update` has no hand-written path, so the text should not suggest one there. The refusal is the same on both commands, so this one sentence covers both. Extend the family test at `statement-planning.fields.test.ts:103` to assert that `renameTable` appears in `why`.

### D5-1 · should-fix · closed in 0b798f1992 · `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts:174-237`, `packages/1-framework/3-tooling/migration/src/aggregate/strategies/plan-from-diff.ts:88-92`

Without any `--rename`, `db update` now behaves differently whenever a snapshot exists for the marker hash. That is the normal case: every `db update` that advances the `db` ref stores a snapshot. The brief required "`db update` without statements behaves exactly as before".

The cause is the plan's origin. The planner writes `from: fromContract?.storage.storageHash ?? null`, so `Migration.origin` is no longer `null` on a `db update` plan, and both runners read it:
- `ensureMarkerCompatibility` (Postgres `runner.ts:521`, SQLite `runner.ts:492`) now checks that the marker equals the origin. Its own comment says the `null` origin is how `db update` opts out of that check. A marker that changes between `readAllMarkers` and the runner's read under the lock, for example a concurrent `db update`, used to be overwritten and is now refused with `MIGRATION.MARKER_ORIGIN_MISMATCH`, an error about a "plan origin" that `db update` users never named.
- `isSelfEdge` is now true when the marker is already at the destination (origin = marker = destination). A zero-operation re-run therefore takes the `isSelfEdgeNoOp` branch, which skips `upsertMarker` and `recordLedgerEntries`. Before, the same run wrote both.
- Ledger entries now record the marker hash as their origin instead of `null`.
- Field events: a codec with `onFieldEvent` used to see every column as `added` on every `db update`. Now it sees only real changes. No codec in this repository implements the hook, so no shipped plan changes. Extension codecs would.

The consent plan hash is not affected: `computePlanHash` covers operations and destination only, and the pre-plan and the apply get the same `renames` and the same marker.

The gate this round did not run the adapter packages. Those hold the runner tests and `db-init-update.cli.test.ts`, which exercise these paths against real SQLite.

Recommended change: keep the old runner semantics for `db update` and `db init`. The plan `planFromDiff` returns already sits behind a Proxy that overrides `targetId`. Have it also return `null` for `origin`, so the runner sees what it saw before, while the planner still gets `fromContract` for statements and field events. Add a control-api test: with a snapshot present and no statements, the plan handed to the runner has `origin === null`. If you would rather accept the new semantics (origin checking on `db update`, no ledger row for a no-op re-run), that changes a decision the brief pinned. Record it, update the runner comment, and add runner tests for both behaviours.

### D5-2 · should-fix · closed in 0b798f1992 · `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts` (`readAppOrigin`)

`readAppOrigin` runs on every `db update` and `db init`, with or without statements, and calls `familyInstance.deserializeContract(json)` without a guard. A snapshot that exists but no longer deserializes now makes a plain `db update` throw. Before this change it was never read. Examples: a snapshot written by an earlier release whose contract format the current serializer rejects, or a hand-edited snapshot when content verification is off.

Recommended change: when there are no statements, a deserialization failure leaves `fromContract` `null`, which keeps the old behaviour. When statements are given, report it as `STATEMENT_ORIGIN_UNKNOWN`, with the reason the snapshot could not be read, or surface the serializer's error. Simplest is to read the origin only when it will be used. If D5-1 is fixed by keeping `fromContract` for field events only, the read is still needed, so the guard is needed either way. Also narrow the bare `catch {}` around `contractSnapshotDir` to the error the store throws for a hash it cannot address.

### D5-3 · should-fix · closed in 8a806fb0b4 · `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-plan.ts:166` and `:858-872`

`runPlannerLeg` no longer fails on zero operations when statements are given, and the new branch returns a no-op result without writing a package. The failure: the destination's storage hash differs from the origin's, but the planner produces no operations. The existing `unsupportedChange` conflict ("Contract changed but planner produced no operations") is for exactly that case. Add a relation-field statement to the same run and the command reports "No changes to plan" and writes no migration. The migration graph then has no edge to the new hash, and the `db` ref is left behind it.

The README says a package is skipped only "when no statement needs an operation and nothing else changed". The code skips it even when the storage hash changed.

Recommended change: take the zero-operations no-op branch only when `fromHash === toStorageHash` (storage did not change). Otherwise keep the `unsupportedChange` planning failure whether or not statements were given. Add a test with a storage hash change that plans no operations, plus one statement.

### D5-4 · low · closed in 0b798f1992 · `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts:540-553`

When `hash` is `null` (the database has no marker), the `STATEMENT_ORIGIN_UNKNOWN` fix and its first next action talk about `--advance-ref` and snapshots. A database with no marker has never been initialised or updated, so it has nothing to rename. Recommended change: when `hash === null`, say that, and offer only "run without statements".

### D5-5 · low · closed in 8a806fb0b4 · `packages/1-framework/3-tooling/cli/src/orm/migration/plan.ts:158-161`

The no-op branch prints the fixed summary `No changes detected` above a `Statements applied` list. It never shows `result.summary` ("No changes to plan: the statements need no operations"), which explains the case. Recommended change: print `result.summary` when `appliedStatements` is not empty.

### D5-6 · low · closed in acbb7a504e · `packages/1-framework/1-core/framework-components/src/control/contract-snapshot-layout.ts:7-12`

The new `isStorageHashHex` was inserted between `storageHashHex` and its JSDoc. `/** Validate a storage hash for use as a directory name. */` now sits directly above `/** Whether the snapshot store can address ... */`. That leaves an orphaned doc block (see `.agents/rules/jsdoc-line-width.mdc`), and `storageHashHex` has no doc. The new export also has no unit test in framework-components. Recommended change: move the old comment back onto `storageHashHex`, have `storageHashHex` call `isStorageHashHex`, and add a two-case test (a 64-hex hash, a `sha256:` hash).

### D6-1 · low · closed in 2ad8076e2a · `test/integration/test/cli-journeys/rename-statements-migration.e2e.test.ts:227-231` and `:265`, the same lines in the SQLite file

Slice done condition "a further plan empty" is asserted only in S1, and only through `migration plan --from <renameDir>`. That plan starts from the hash the rename migration ends at, which is the emitted contract's hash, so it is a no-op by hash equality before any planner or database is consulted. It would pass even if `migrate` had applied nothing. The sibling rename-table journeys do the same, so this copies an existing weakness. S2, the `db update` half of the condition, has no "further plan empty" check at all. `db verify --schema-only` covers the schema in both journeys, so nothing is unprotected today. Recommended change: in S2, after the renamed-state check, run `db update --dry-run --json` with no statements and assert zero operations. That plan is diffed against the live database. Keep or drop S1.10 as you prefer.

### D6-2 · should-fix · closed in 6f5d33067a · `upgrade-instructions/pending/migration-statement-renames/extension/instructions.md` (`planner-plan-statements` detection)

The regex `\.plan\(\s*\{(?![^}]*statements…)[^}]*fromContract\s*[:,]` uses `[^}]*` between the opening brace and `fromContract`. Any inline object before `fromContract`, most often `policy: { allowedOperationClasses: [...] }`, ends the match early, so those calls are not detected. I ran it against the pre-sweep sources of commit 33ee547aa0, the commit that added `statements: []` to every call site in this repository. It matches 104 of the 171 sites, missing about 40%. For example, it matches none of the calls in `planner.authoring-surface.test.ts` (7), `planner.contract-to-schema-ir.test.ts` (8), `rls-rename-planner.test.ts` (3) or `check-rename-planner.test.ts` (2). An extension codebase written in the same style would be told nothing at those sites.

Recommended change: allow one level of nested braces on both sides. For example: `\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])statements\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]`. I measured that pattern the same way: it matches 163 of the 171 sites. The 8 it misses do not write the options inline in the `.plan({` call (two `planner.codec-field-event.test.ts` files and `native-enum-planner.test.ts`), and no regex over the call site can catch those.

A smaller weakness of the same kind, fine to leave: `planner-success-applied-statements` only fires in files that name a `MigrationPlanner…` type, and skips the whole file if `appliedStatements` appears anywhere in it. A planner double typed through `TargetMigrationsCapability`, as the CLI tests type theirs, is missed.

### D6-3 · low · closed in 21fa971fe1 · `docs/architecture docs/adrs/ADR 258 - A model names its storage verbatim, and a rename is an operation.md:79`

The amendment sits under the "A planner hint in the contract source" alternative, as an indented plain paragraph. The decision it reverses is the alternative just above it, "State the rename on the command line …". The other ADRs in the folder put such notes in a `> **Update — …:**` or `> **Superseded** —` blockquote. ADRs 001 and 028 got a blockquote at the top, which is close enough. Recommended change: move the ADR 258 note under the command-line alternative as a blockquote, and match the `**Update —**` wording on all three if you want them uniform.

### M-1 · should-fix · superseded by D7-1 (e8b1b46ea0 improved the text; D7-1 covers what remains) · `packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts` (`statementNotApplied`)

`errorMigrationPlanningFailed` shows each conflict's `why` as the error's fix, so the user reads this as what to do next: "The MongoDB planner cannot carry out a rename yet. Without the statement, the same change is planned as removing the old name and adding the new one." It gives no safe way forward, and the user's obvious next step loses data without the message saying so.

For a model statement, "removing the old name" means the plan drops the old collection with its documents. That is the outcome the refusal exists to prevent. For a field statement on MongoDB, the documents keep the old field and only the validator changes. The two cases differ, and neither is described plainly.

ADR 258 already names the safe route for a collection: rename it outside Prisma with `renameCollection`.

Recommended change: write the `why` per entity.
- Model: `MongoDB cannot rename a collection through a migration in this release. Without the statement, the plan drops collection "<old>" and its documents and creates "<new>". To keep the documents, rename the collection yourself with renameCollection, then run the command again without --rename.`
- Field: `MongoDB cannot rename a field through a migration in this release. Without the statement, existing documents keep the field under "<old>". To move the values, run an update with $rename yourself, then run the command again without --rename.`

Take the collection names from the two contracts' storage when they are at hand, or name the models. Update the exact-text test in `mongo-planner.statements.test.ts`.

### D7-1 · should-fix · closed in 624c89798f · `packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts` (`keepTheData`)

The M-1 text that e8b1b46ea0 wrote fails in four concrete ways.

1. It is unsafe for `migration plan`. "Rename the collection yourself … then run the command again without --rename" is right for `db update`: after the rename by hand, introspection finds the new collection and plans no drop. For `migration plan` the advice leads to data loss. The plan is offline, so running again without `--rename` writes a migration that drops `"<from>"` and creates `"<to>"`. Every database it is later applied to, where nobody renamed the collection by hand (staging, production), loses the documents. The planner cannot tell which command called it, so the text must be right for both.
2. It is wrong when both models keep the same collection, for example a variant, or `@@map("posts")` on both sides. `from === to`, so the text claims the plan "drops collection "posts" and its documents and creates collection "posts"" and suggests `db.posts.renameCollection("posts")`. Without the statement nothing is dropped in that case.
3. `db.<name>.renameCollection` and `db.<name>.updateMany` do not work in mongosh for a collection name that is not a JavaScript identifier, such as one with `-` or `.`. `db.getCollection("<name>")` works for every name.
4. The `$rename` example uses the domain field names. A field stored under another name keeps its values under the stored name.

Recommended text, with no "run again" in the cases where running again loses data:

- Model, two different collections: `MongoDB cannot carry out rename statements in this release. Without the statement, a plan drops collection "<from>" with its documents and creates collection "<to>". To keep the documents, rename the collection by hand on each database before a plan made without the statement is applied there, for example with db.getCollection("<from>").renameCollection("<to>") in mongosh. A migration written by migration plan without the statement still drops "<from>" wherever it is applied, so check its operations first.`
- Model, the same collection on both sides: `MongoDB cannot carry out rename statements in this release. Both models store their documents in collection "<collection>", so a plan made without the statement keeps them.`
- Field: `MongoDB cannot carry out rename statements in this release. Without the statement, the documents in collection "<collection>" keep their values under "<old>", and nothing moves them to "<new>". To move them, update the documents by hand on each database, for example with db.getCollection("<collection>").updateMany({}, { $rename: { "<old>": "<new>" } }) in mongosh, using the field names as they are stored.`

Add a test for the same-collection case. Update the two exact-text assertions.

### D9-1 · should-fix · closed: R1 reverted (333d5a88b5), positions instead (4253e2dc74) · `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` (`MigrationPlanOperation.id` doc), `upgrade-instructions/pending/migration-statement-renames/app/instructions.md` (`postgres-operation-ids-name-the-schema`)

The R1 premise is partly wrong, and the consequence it hides is not documented.
- The ledger does persist operation ids. `recordLedgerEntries` (Postgres `runner.ts:636-671`, and the same on SQLite) writes each edge's executed `operations`, ids included, together with the edge's `migrationHash`. Nothing reads the ids back. `readLedger` has two readers: `migration log` displays the entries, and `migration status` (`migration-status-overlay.ts`) builds its "applied" set from the ledger's `migrationHash` values.
- Re-emitting an existing `migration.ts` changes its hash. If the file was hand-written, or planned before this change, and contains a Postgres table, column, constraint, index or enum operation, then running `node migration.ts` again now writes new ids. That gives a new `migrationHash` in `ops.json` and `migration.json`. On every database that applied the old version, the ledger keeps the old hash, so `migration status` stops marking that migration as applied. Users re-run `migration.ts` after filling a placeholder, after editing, or after an upgrade.
- Nothing reports the migration as tampered. `migration check` recomputes the hash from the files on disk, which agree with each other. `migrate` and `db update` choose a path by contract hashes and the marker, so they never re-apply it. That is why this is should-fix and not must-fix, and why position-based references are not needed.

Recommended change:
- Correct the `id` doc comment: "The ledger records the executed operations, ids included, but nothing compares them."
- Replace "Migrations planned before the upgrade keep their ids and their hashes; nothing re-plans them" in the upgrade instructions with an accurate sentence. For example: "Running an existing `migration.ts` again writes the new ids, and so a new `migrationHash`. Commit both files together. On a database that already applied that migration, `migration status` then no longer marks it as applied. Avoid re-running a migration that has already been applied."

The other R1 claims hold. A migration whose `ops.json` has old-style ids still applies and verifies: the runner uses ids only in messages, progress events and the ledger journal, and the policy check uses the operation class. The consent plan hash is recomputed in the same run. The regenerated example migrations (`prisma7-adoption`, and the two in the commit) and the planner goldens are consistent with the new ids. `fixtures:check` is green, and the descriptor-shipped extension migrations in the repository use their own ids, which are unaffected.

### D9-2 · low · closed in 2e8da66552 · `packages/1-framework/1-core/errors/src/migration.ts` (`unfilledPlaceholderOperation`), `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/render-ops.ts` (`checkedOp`)

The stub's rejected promise is marked handled, but `renderOps` wraps every promise in `checkedOp`, which returns `opOrPromise.then(assert…)`. That derived promise is what `plan.operations` holds, and it is not marked handled. So the doc comment's claim, "a plan nobody awaits does not raise an unhandled rejection", is false. Any reader that takes `plan.operations` without awaiting every element leaves a rejected promise with no handler. `SqlMigration.providedInvariants` is such a reader: it filters promises out. Under Node's default `--unhandled-rejections=throw`, that ends the process.

No CLI path reaches this today. `runPlannerLeg` awaits every element through `Promise.all`/`allSettled`. `db update`'s policy excludes `data`, so its planners emit no stubs. A programmatic caller of the planner could hit it.

Recommended change: in `checkedOp`, mark the derived promise handled as well, or return a rejected input promise unwrapped. Add a test that reads a placeholder plan's `operations` without awaiting them and asserts that no `unhandledRejection` event fires.

### D9-3 · low · closed in 11685e67a9 · `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` (`STORE_ORIGIN_SNAPSHOT_STEPS`, step 2)

Step 2 says `db update --advance-ref <name>` against the restored old contract "changes nothing" in the database. That holds only if the database still matches that contract. If it has drifted, the run reconciles it, and that can include destructive operations behind the consent prompt. Recommended change: tell the user to run it with `--dry-run` first and to expect an empty plan, then run it without `--dry-run`.

### D9-4 · should-fix · closed in 6a64b58ae4 · `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts:281-360` with `statements/report-applied-statements.ts`

On `db update`, `operationIndexes` point into the wrong list. The planner counts positions from the first operation of the app space's plan. But `db update`'s JSON `plan.operations` (both plan and apply mode) is `orderedResolutions.flatMap((r) => r.entry.displayOps)`, every space in apply order: extensions alphabetically, then the app.

When an extension space contributes operations in the same run, the app's operations start after them. That happens on a first `db update`, or after an extension version bump with pending extension migrations. `appliedStatements[i].operationIndexes` then name the extension's operations. `AppliedStatementReport`'s doc says "positions of its operations in the result's `operations`", which is not true there. `migration plan` is unaffected, because its `operations` is the app leg alone.

Recommended change: in `executeRun`, offset each app-space `operationIndexes` entry by the number of `displayOps` of the spaces ordered before the app. Add a control-api test with one extension space contributing an operation.

### D9-5 · should-fix · closed in cdf21421a7 · `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts` (identity statement advice, `STORED_NAME_ONLY`)

For `--rename Post:Post` or `--rename Post.profileId:Post.profileId`, the advice is "plan without the statement, and edit the planned migration.ts so that it renames the stored name instead of dropping and creating it." On `db update` (the QA re-run in `wip/qa/r9/f7-wrong-statements.txt` is `db update`) there is no `migration.ts`. A user whose real change was an `@@map` or `@map` change who follows "plan without the statement" gets a drop and create of the table or column.

The resolver does not know which command called it, so the text must cover both. Recommended text: `Leave out --rename <stmt>. If only the stored name changed (@map or @@map), a statement cannot state that in this release, and a plan without it drops and creates the table or column. With migration plan, edit the planned migration.ts to rename it instead (...this.renameTable(...) or ...this.renameColumn(...)). With db update, rename it in the database yourself first, then run db update.`

### D9-6 · should-fix · closed in 4419216df2 · `resolve-statements.ts:597-603` (`swapRefusal`)

The swap advice does not work at its second step. Take `--rename Profile.name:Profile.handle --rename Profile.handle:Profile.name`. Step 1 (`name` to a temporary name) resolves. Step 2 says to plan "the other statement and `--rename <temporary name>:Profile.handle`", which is `--rename Profile.handle:Profile.name --rename Profile.tmp:Profile.handle`.

In step 2 the destination contract has `handle` (the temporary field's new name), so `Profile.handle:Profile.name` fails with "The field "handle" still exists on the destination model". `handle` is again both an old name and a new name, which the swap check refuses too. Resolution reads contracts, not a working copy (the slice spec's swap rule), so two names that trade places need three plans.

Recommended text: `Make the swap in three plans. First change the contract so that "<first>" has a temporary name, and plan it with --rename <first>:<temporary>. Then give "<second>" the name "<first>" and plan it with --rename <second>:<first>. Then give the temporary name the name "<second>" and plan it with --rename <temporary>:<second>.` Add a resolver test that resolves each of the three advised plans against its two contracts.

### D9-7 · should-fix · closed in 696a2cb915 · `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` (`#planField`, the refusal when a model's table changes)

The F8 advice is now the full `migration plan` route: intermediate contract, `migration new --from <hash of the migration the database is at>`, `renameTable` in its `migration.ts`, then plan the field rename `--from` that migration. The QA re-run (`wip/qa/r9/f6-f8-refused.txt`) runs `db update`, where none of this applies: a `db update` project has no migration at the database's hash, and nothing applies a hand-written migration in that workflow.

The planner does not know the command, so the text must give both routes. The `db update` route that keeps the rows:
1. Change the contract so only the table name changes, and run `contract emit`.
2. Rename the table in the database yourself (`ALTER TABLE "users" RENAME TO "app_users"`). Check `db update --dry-run` plans no drop, then run `db update` to store that contract.
3. Emit the final contract and run `db update --rename User.name:User.fullName`.

Recommended change: add those steps after the `migration plan` route, prefixed "With db update: …". Verify them once the way QA verified the `migration plan` route.

### D9-8 · low · open · `resolve-statements.ts` (`STORED_NAME_ONLY`), `statement-planning.ts` (the `db update` route in the table-change refusal)

Two `db update` texts promise a cleaner result than Postgres gives after a table is renamed by hand. "run db update, which then finds nothing to change" (D9-5) and "check that prisma db update --dry-run plans no drop" (D9-7) both assume the hand rename leaves nothing to reconcile. On Postgres, `ALTER TABLE … RENAME` keeps the primary key, unique and foreign key names derived from the old table (`users_pkey`). The destination contract derives `app_users_pkey`, so `db update` then plans changes to those constraints, possibly as drop-and-add. Those operations lose no data and are `widening` since dispatch 1, but a user told to expect "no drop" or "nothing to change" sees "Drop constraint …" and stops. SQLite, where the implementer verified the route, keeps no table-derived names, so it shows nothing.

Recommended change: write "plans no drop of a table or column" and "which then finds nothing that loses data", or name the constraint renames as expected.

## Round notes

### Dispatch 2, round 1 (2026-10-06)

Verdict: ANOTHER ROUND NEEDED, for D2-1 only. D2-2 to D2-4 are optional in the same round.

What is sound:
- Every rule in slice spec § Grammar and § Resolution is implemented. Each rule has a test that fails if the rule is removed, except the extension-space rule (see the note for the orchestrator below).
- The resolver reads only `domain` and speaks only of namespace, model and field. A sweep of the added lines under `packages/1-framework` finds no table, column, schema, collection or target names.
- No `any`, no bare `as`, no `blindCast`, no zod. Lookups use `Object.hasOwn`, so `__proto__` and `constructor` resolve as missing names. Test names omit "should", and the test files are 54, 195 and 287 lines. No optional keys were added that would need `ifDefined`.
- I checked hostile input by reading the code. An empty string, `:`, `a..b` and 200 segments all return `STATEMENT_INVALID` and quote the statement. Names with spaces or other unicode are matched exactly and return `UNRESOLVED`, with the name in quotes.

The implementer's own decisions, all accepted:
- Repeats and two-onto-one are `INVALID`. They are a mistake in the list itself, not in the contracts, so this is right.
- `A:B` then `A.x:B.y` is `INVALID`. This matches the dispatch brief. Only the message needs work (D2-1).
- Depth 1-against-3 is refused when parsing, and 1-against-2 after resolution. A two-part side can only be classed after resolution, so this split is forced.
- The resolver takes `ContractWithDomain`. This is the narrowest type that holds what it needs.
- Relation fields are looked up in `model.relations`. The spec requires this.
- The shape of a missing origin is good. Dispatch 5 can fill it directly from the marker read.
- Variants are separate entries in `namespace.models` that point at their base model, so "resolves like any model" holds against real contracts. A variant's `fields` contain only its own fields. So `Bug.title:Bug.name`, where `title` is inherited, is unresolved, and the message lists the variant's own fields. The user can then rename it on the base model. I accept this.

Public API trace:
- `MigrationPlanner.plan` options gained the required `statements`. All four places that build the framework-typed input pass `[]`: `migration-plan.ts:128`, `plan-from-diff.ts:88` (which serves `db init` and `db update`), `test/integration/test/_harness/mongo.ts:89`, and `planner.authoring-surface.test.ts`. The Postgres, SQLite and Mongo `plan` methods still declare their own option types without `statements`. Method parameters are checked bivariantly, so these planners still satisfy the interface and ignore the field.
- New exports: the statement types from `@internal/framework-components/control`; `ResolvedStatement`, `resolveStatements`, `ResolveStatementsInput` and `StatementOrigin` from the CLI `control-api` entry. Nothing calls them yet. `ModelCoordinate` and `FieldCoordinate` are not re-exported from `control-api`, so a programmatic consumer cannot name them. Dispatch 5 should add them if it needs them.

Dispatch 1 skim: no must-fix. The only framework changes are the optional `OpFactoryCall.toOps` and `Migration.resetAuthoringState`. Both are family-blind and tested. The two `blindCast` sites are moved code whose reasons explain the cast.

For the orchestrator (not for this PR's implementer):
- Extension spaces: the resolver relies on its caller to pass the application space's contracts. No test can enforce this inside the resolver. Dispatch 5 needs a command-level test where a name exists only in an extension space and the command fails with `STATEMENT_UNRESOLVED`.
- Dispatch 3: the Postgres planner forwards options field by field into its issue planner (`planner.ts:355` passes `fromContract: options.fromContract`). So `statements` will be dropped silently unless it is forwarded explicitly. Widening the target option types will also make `statements` required at every direct `planner.plan({...})` call in target tests. Expect a large number of changes there, or make the field required only on the framework type.
- `STATEMENT_ORIGIN_UNKNOWN` is checked before any statement is parsed, so a malformed statement with no origin reports the origin problem first. This matches the spec ("before anything else"). I note it only in case dispatch 5 wants parse errors first.

### Dispatch 2, round 2 (2026-10-06)

Verdict: SATISFIED. D2-1 to D2-4 are closed as recommended. D2-5 is new and low. It can be fixed now or later.

- D2-1 closed. `A:B` then `A.x:B.y` now says `"app.A" is not a model of the destination contract`, gives `--rename B.x:B.y`, and the fix line is `Write the statement as --rename B.x:B.y.` Without an earlier model statement, the message also asks for `--rename Profile:User` first. Both cases are tested, including the exact fix text. The error reference describes this. The advice is wrong in two narrow cases where the user is moving a field between models (D2-5).
- D2-2 closed. `errorStatementInvalid` and `errorStatementUnresolved` now take a required `fix`, so every call site has to choose one. The fixes per reason:
  - Syntax errors keep the forms line.
  - Repeated statements: give each name one statement.
  - An ambiguous namespace: name it with its namespace, for example `auth.User`, where the example is the first of the sorted candidates.
  - A value object: leave it out.
  - A model with no origin counterpart: rename the model first.
  - A two-part side read both ways: write it as `namespace.Model.field`.

  These read as plain instructions, and tests pin four of them. When a two-part side resolves neither way because of a value object, the fix line is the generic one, while the why still says value objects are not supported. That is acceptable.
- D2-3 closed. The two-onto-one field test is at `resolve-field-statements.test.ts:211`.
- D2-4 closed. The list is capped at 20 sorted names plus "and N more". It is tested with 25 models and a check that `M20` is absent.
- No regressions: no bare `as`, `any` or casts. The only new comment is the JSDoc on `oldModelNotInDestination`, which explains why the corrected statement is offered. It uses "spells", which Will avoids; "writes" would be better (cosmetic). The test files are 54, 223, 304 and 95 lines.

### Dispatch 3, round 1 (2026-10-06)

Verdict: SATISFIED. D3-1 to D3-3 are low and optional. D2-5 is closed in e043835caf. Three tests cover its cases: the old model was renamed to another model, another model was renamed to the new model, and the new model is also in the origin. The "spells" comment now says "writes".

Working schema, checked on each planner:
- Postgres: `planStatements` builds the working copy from `options.schema` and computes each rename call against `working.current`, then applies it. `buildPostgresPlanDiff`, `verifyPostgresNamespacePresence` and `relationalNamespaceNode` all read the working copy. The only read of `options.schema` left is the `assert`. Rename calls come first. The table-name case guard reads issues from the working copy, so a renamed table yields no drop-and-create pair. A case-only rename is tested.
- SQLite: the working copy is built from `sqliteActualSchema(options.schema)`. `collectSchemaIssues` now takes that schema. Calling `sqliteActualSchema` a second time inside `buildSqlitePlanDiff` changes nothing. Rename calls come before the diff's index replacements.
- `planIssues` still receives the original `fromContract`. I checked its one consumer, the unsafe-type-change strategy. It only tests whether `fromContract` is null and never looks a table up by name, so a rename changes nothing there.
- The three-table foreign-key test (`:164`) detects the bug, for the reason given under D3-2.

`statement-planning.ts`:
- It knows no target. Each target supplies its working schema, its rename call and how to count operations through `StatementPlanningTarget<TCall>`.
- The data stays structured. A conflict carries the `ResolvedStatement` and a `location`. An applied statement carries the `ResolvedStatement`, and its description text is written from the domain coordinates, with the namespace only when the contract has more than one.
- The namespace-move check compares storage `namespaceId`, not the domain namespace. Two domain namespaces on one storage namespace would therefore plan as a plain rename. That is the correct storage effect, so I accept it.

Field events: prior tables are re-keyed by their renamed name, per storage namespace. Columns of a renamed table therefore match by name, and no other path compares prior and new tables by name. Three tests cover this, including the same table name in another namespace.

Blast radius:
- Three code paths build a planner success result: Postgres, SQLite and Mongo. Mongo passes `[]`. `plannerSuccess` has no callers outside tests.
- Nothing in extensions or examples implements `MigrationPlanner` or builds a success result.
- The 79 `statements: []` additions are mechanical, in test calls only.

The implementer's decisions, all accepted:
- `appliedStatements` is on the success result. Hand-written `Migration` classes implement `MigrationPlan`, so the plan type cannot hold it.
- Field statements are refused until dispatch 4.
- The first failure ends the plan with one conflict. This matches the resolver.
- The destination table's control policy is the one checked. It governs the table from now on, and the user asked for the rename.
- `operationCount` is `1 + companions`, which equals `toOps().length` on both targets today.
- A plan with statements and no origin contract is refused here as well as earlier in the resolver. The second check is redundant but cheap.
- A rename onto a table name the starting schema already has is refused.
- `renames` is required on field-event planning, so every caller has to decide.

Repo rules: no bare `as`, `any` or new `blindCast` in production code. Test files are 330, 274, 154 and 56 lines, and `field-event-planner.test.ts` dropped to 482 after its fixtures moved out. Test names omit "should". The comments are JSDoc on exported types or explain the order of statements.

For the orchestrator:
- `statement` is on `SqlPlannerConflict` only. The framework `MigrationPlannerConflict` has no such field, so dispatch 5's CLI cannot read the refused statement through the framework type when it renders `MIGRATION.PLANNING_FAILED`. Either add an optional `statement?: ResolvedStatement` to the framework conflict (it is family-blind), or have dispatch 5 render the message from `summary` and `why` only.
- `plan-from-diff.ts` (`db update`) still passes `statements: []` and does not forward `appliedStatements`. That is dispatch 5's job.

### Dispatch 4, round 1 (2026-10-06)

Verdict: ANOTHER ROUND NEEDED, for D4-1. D4-2 to D4-4 are low.

D3 carry-over:
- D3-1 closed: the duplicate line is gone. The fix also copies `refusedOperationClass` in `plannerSuccess` and `plannerFailure`. Before this, SQLite's `disallowedIndexCalls` conflicts lost it on the way out, so `db init`'s class-specific advice never fired for them. That is a fix, not a regression.
- D3-2 closed: the test is renamed.
- D3-3 closed: both planners now report the operation classes of each statement call and its companions. A disallowed class is a `statementRejected` conflict that carries `refusedOperationClass`, tested in the family and on both targets.

What is sound:
1. Working copy:
   - Postgres: `renameColumnInPostgresSchema` rewrites the column key and name, and the column lists of the primary key, uniques, own foreign keys and plain indexes. It rewrites `referencedColumns` of foreign keys in any table that points at this table, matched on the resolved namespace. It rewrites dependency references through `stepRewrite`. It writes out the derived names of unnamed uniques and foreign keys on the column from the old column list, which is what the database still holds after `RENAME COLUMN`. Expression and predicate indexes, and checks, keep their text, so the diff replaces them (widening). Postgres itself rewrites those expressions, so the working copy is out of date only where the diff then corrects it.
   - SQLite: the working copy has the same rewrites, and index names are kept. I checked against real SQLite that `RENAME COLUMN` keeps the index name and rewrites its SQL. A case-only rename works without a temporary name.
2. Companions:
   - Destination names come from the destination's explicit name, else `defaultUniqueName` / `defaultForeignKeyName` on the destination table and the renamed columns.
   - Index companions are filtered to indexes on the new column and take the destination's wire name from `pairIndexRenames`.
   - Pairing is one to one: a set for uniques, and `pairForeignKeys` for foreign keys.
   - `pairedConstraintRenames` with `{ primaryKey: true, onColumns: () => true }` is the old table-rename code with the same pairing. The table-rename test files are unchanged and pass.
   - The primary key is never renamed: `<table>_pkey` does not depend on its columns. I accept this.
3. The decision "destination table missing → no companions" is D4-1.
4. The chain test (`planner.field-statements.test.ts:132`) detects the bug. Without the table-name mapping, the column rename would look for `"Profile"."email"` on a working copy that only has `User`, and would be refused.
5. `renderTypeScript` is the facade call on both targets, and the plan's rendered source contains it. Running the facade's call and the planner's call side by side is not tested (D4-2).
6. Prechecks and postchecks are both names in both directions, pinned by the ops tests. Runner coverage is D4-3.
7. Blast radius:
   - `columnRenames` on `planFieldEventOperations` has two production callers, both planners.
   - `renameColumnCall` on `StatementPlanningTarget` is implemented by both planners and the family's fake target.
   - No extension or example implements either.
   - Field events: prior columns are re-keyed under their new names on the table's post-rename name, so a renamed column fires no drop-and-add. Tested.
8. Repo rules: no bare `as` or new `blindCast` in production code. `fieldColumn` reads the untyped storage with `Object.getOwnPropertyDescriptor` instead of casting. That is awkward but sound. Every test file is under 300 lines, and test names omit "should".
   - The two removed-rule checks detect their rules. Without the `referencedColumns` mapping, the Postgres test sees `['id']`. Without `renamedColumnIndex`, the SQLite test gets no drop and create.
   - The `MIGRATION.COLUMN_RENAME_UNMATCHED` `why` says "check the spelling". "Check the names" would avoid a word Will dislikes (cosmetic).

The implementer's decisions:
- `columnRenames` keyed by the post-rename table name: accepted, because field-event planning already walks the tables under their new names.
- A column on one side only is `statementRejected`: accepted.
- Destination table missing → no companions: rejected for the planner path (D4-1). Fine for the facade.
- Index companions only on the renamed column: accepted, because other indexes' wire names do not change.
- The primary key is never renamed: accepted.
- SQLite case-only rename needs no temporary name: verified. The case-insensitive collision is D4-4.
- The new family error code has an error-reference entry: accepted.
- `StatementPlanner` as one ordered pass: accepted. It is the simplest way to share the renamed-table map between model and field statements.

For the orchestrator (a spec gap, not this PR's implementer): a model that keeps its name but changes its table through `@@map` cannot be renamed by any statement. `--rename User:User` is unresolved, because the new name exists in the origin. So a user who changes a model's `@@map` gets a drop and create with no statement to prevent it. In `migration plan` they can still write `renameTable` by hand in `migration.ts`. In `db update` they have no way out. Either accept this as known for slice 1 and record it in the deferred list, or add a rule that a model statement whose two sides are the same coordinate means "the table changed". That second option needs Will, because it changes the slice spec's § Resolution.

### Dispatch 4, round 2 (2026-10-06)

Verdict: ANOTHER ROUND NEEDED, for D4-5 only. It is a one-sentence change to the refusal's `why`, plus one test assertion. Everything else is closed.

- D4-1 closed. `#planField` compares the destination model's table, namespace and name, with the origin table under the name earlier statements gave it, and refuses when they differ. The location points at the column. A family test covers it. The advice text is D4-5.
- D4-2 closed. On both targets, a hand-written migration that spreads the rendered facade call yields ops that `toEqual` the planner's ops: ids, labels and SQL.
- D4-3 closed. The SQLite runner test against real SQLite covers two cases: both columns exist, and a column of the new name exists in another case. Both fail at the precheck.
- D4-4 closed.
  - `SchemaTables.columnsNamed` is exact on Postgres (`[column]` when present). On SQLite it uses `sqliteIdentifiersCollide`.
  - Both callers drop `rename.from` from the result, so a case-only rename is not refused.
  - On Postgres this is the old `hasColumn` check, because `to === from` cannot occur. The table-rename paths do not call it, so table renames are unchanged.
  - The precheck `SELECT COUNT(*) = 0 FROM pragma_table_info(?) WHERE "name" COLLATE NOCASE = ?` is valid SQLite: `COLLATE` binds to the left operand, and `NOCASE` folds only ASCII, as SQLite's column-name comparison does. The runner test executes it.
  - A case-only rename keeps the exact `columnAbsent` check, chosen by `sqliteIdentifiersCollide(from, to)`.
- The "check the spelling" wording is now "check the names". No bare `as` in production code; the `as unknown as` casts are in tests only.

### Dispatch 4 round 3 and dispatch 5, round 1 (2026-10-06)

Dispatch 4 round 3: SATISFIED. D4-5 is closed: the refusal now tells the user to rename the table by hand first, with `...this.renameTable({ table, to })` in its own `migration.ts`, and a test pins the text. One nit: on Postgres, a table outside the default namespace needs `schema` in that call too. Not worth a round.

Dispatch 5, round 1: ANOTHER ROUND NEEDED, for D5-1, D5-2 and D5-3.

Checked and sound:
1. Resolution happens before anything is written.
   - `migration plan`: resolution runs after `--to` and before the manifest check and the seed phase.
   - `db update`: resolution runs after the marker read and before introspection and planning. Nothing is written before the apply.
   - Statement errors are thrown from `executeRun`, as accepted.
   - The pre-plan and the apply get the same `renames` through `sharedInputs`, so the consent plan hash agrees.
   - A greenfield or `@empty` origin is an empty domain, so every statement is unresolved.
2. Only the app space gets the origin and the statements: `planMigration` passes `{ fromContract: null, statements: [] }` to every other space. The snapshot read uses `readContractSnapshotJsonTolerant` with the client's verifier. The runner side effects are D5-1 and the deserialization risk is D5-2.
3. JSON: `appliedStatements` is on `MigrationPlanResult` (every assembled result), `DbInitSuccess`, `DbUpdateSuccess` and `MigrationCommandResult`. `db init` sets `[]`. Each entry holds the resolved statement in domain coordinates, the description and the count. `statement` is now on the framework `MigrationPlannerConflict` and `CliErrorConflict`, and reaches `MIGRATION.PLANNING_FAILED`'s `meta.conflicts` unchanged. A `statementRejected` conflict also carries a storage `location` (table, column), as every SQL conflict does. That adds to the domain data and does not replace it.
4. Layering: `@internal/migration-tools/contract-snapshot-store` was already imported by `db-run.ts` (as a type) and is a published entry point. `lint:deps` passes.
5. README and error reference: plain English, no `projects/` links, nothing unshipped promised. The `--advance-ref` explanation matches the stated snapshot behaviour. The one inaccuracy is the "nothing else changed" sentence, which the code does not honour (D5-3).
6. Repo rules: no bare `as` in production code. Test files are 281 and 191 lines. The `as unknown as ResolvedStatement` is in a test.

For the orchestrator:
- D5-1 touches a decision you pinned. "Supply `fromContract` whenever the snapshot exists" assumed the planner reads it only for field events and the `from` hash. The runners also read the `from` hash, as the plan's origin. My recommendation keeps your decision and hides the origin from the runner. The alternative is to accept origin checking on `db update`, which is a behaviour change worth one line to Will.
- Ask the implementer to run `adapter-sqlite`'s `db-init-update.cli.test.ts` and both `runner.*.test.ts` after the fix. This round's gate skipped the adapters.

### Dispatch 5, round 2 (2026-10-06)

Verdict: SATISFIED. D5-1 to D5-5 are closed as recommended or by your decision. D5-6 is low.

- D5-1 closed. `planFromDiff`'s Proxy returns `null` for `origin`, so both runners see the plan exactly as before: no marker check, the same self-edge handling, ledger origin `null`. Tested in migration-tools and at the control API.
- D5-2 closed. The snapshot is read only when `renames` is non-empty, so a plain `db update` never touches it (tested). With statements, a deserializer failure becomes `STATEMENT_ORIGIN_UNKNOWN` carrying `unreadable` and the reason (tested). The bare `catch` is replaced by `isStorageHashHex`. `readContractSnapshotJsonTolerant` already returns `undefined` for a hash it cannot address, so a non-hex marker hash still reads as missing.
- D5-3 closed. `noOperationsExpected` is true only when statements are given and `fromHash === toStorageHash`. When the storage changed and nothing was planned, the command fails with `unsupportedChange` whether or not statements were given (tested). The auto-baseline legs pass `false`. The README sentence now matches.
- D5-4 closed. When `hash` is `null`: "the database has no marker … nothing to rename", with one next action, run without statements.
- D5-5 closed. The no-op summary is `result.summary` when statements were applied.
- The D4-5 follow-up is in: the hand-written `renameTable` advice adds `schema:` outside the unbound namespace, tested both ways.
- `StatementOrigin.unreadable`: required `string | undefined`, set at all three construction sites in `db-run.ts` and in the three test origins. The message names the hash, the directory and the reason, and `meta` carries `unreadable` only when it is set.
- `isStorageHashHex`: knows no family (a hash format check beside `storageHashHex`) and is needed, because it replaces a catch-all. It has no direct test and it orphans `storageHashHex`'s doc comment (D5-6).

F25, the three CLI tests that failed once in a parallel run: I found nothing on this branch that could cause it.
- No commit from dispatches 2 to 5 touches either failing test file, `test/helpers/orm-test-cli.ts`, `test/setup.ts`, `src/utils/snapshot-content-verification.ts` or `migration/src/contract-snapshot-store.ts`.
- The snapshot content mismatch these tests expect is raised during `--from` resolution. That code is untouched, and it runs before the new statement resolution in `migration plan`.
- The branch's new CLI test files install no `vi.mock`, no spies and no global state. They use local `vi.fn()` doubles, file-local mock objects, and temp directories they remove in `afterEach`/`afterAll`.
- The change to the shared `offline-project.ts` fixture is additive: an optional `models`, and `statementsReceived` recorded only when a script passes it. Callers that pass neither get the same contract and planner as before.
- I ran the CLI test command once. The extra `--` made vitest drop the file filters, so it ran the whole package: 141 files and 1887 tests passed, including both files.
- `CLI.UNEXPECTED` is how an unstructured error caught at the command boundary is reported, for example a filesystem or timeout error. That fits load from parallel runs better than shared state. If it recurs, record the fingerprint under F25 rather than changing this branch.

Note for the orchestrator, not a finding: since D5-2's fix, a codec with `onFieldEvent` sees the prior contract only when statements are given. Without statements, every column is `added`, as before. With statements, it sees real changes only. No codec in the repository implements the hook. If one ever does, `db update` will call it differently depending on `--rename`. Worth one line in `deferred.md`.

### Dispatch 6, round 1 (2026-10-06)

Verdict: ANOTHER ROUND NEEDED, for D6-2. D6-1 and D6-3 are low. D5-6 is closed in acbb7a504e: the doc comment is back on `storageHashHex`, which now calls `isStorageHashHex`, and there is a two-case test.

c4e6b1b8e0 (the field description through the destination model) is right. It matches the slice spec's `rename field "User.name" to "User.fullName"`, and the new family test detects the change.

Done conditions against the journeys:

| Slice done condition | Postgres | SQLite |
| --- | --- | --- |
| `migration plan` with a model and a field statement, then `migrate`, on a table with rows, a unique, an FK from another table, a secondary index, a check (and a policy on Postgres) | S1.05: the exact operation list, all `widening`, no drop or create. S1.08 | S1.05: the exact labels, with the index replaced. S1.08 |
| Rows and objects under the new names | S1.09 through the database: rows, `to_regclass` of the old table, `pg_attribute`, `pg_constraint`, `pg_indexes`, `pg_policies`, `relrowsecurity`, and the `Post` FK's `confrelid` | S1.09 through `node:sqlite`: rows, `pragma_table_info`, `sqlite_master` tables and indexes, `pragma_foreign_key_list` |
| A further plan empty | S1.10, but the no-op comes from equal hashes (D6-1) | the same |
| `db verify --schema-only` clean | inside `expectRenamedState` | the same |
| The same through `db update` with no prompt | S2.04 and S2.05: `--json` with no `--confirm`, exit 0, so no consent was needed; the same database assertions | the same |
| A second `db update` with the same statements fails with `STATEMENT_UNRESOLVED` | S2.06, after asserting that the snapshot exists | the same |
| Re-running `migration.ts` writes identical `ops.json` and `migration.json` | S1.07 compares the files as strings read from disk, not parsed JSON | the same |
| `fixtures:check`, framework-vocabulary 272 | gate | gate |

The reported red check (statements ignored → S1.05 and S2.04 fail) is consistent with these assertions: the exact operation lists would show the drop and create.

S3 (Postgres) covers the three error codes through the CLI, and asserts that no migration directory was written. It does not assert that no destination snapshot was written; the control-api tests cover that.

Test rules: 367 and 311 lines, `timeouts.spinUpPpgDev` as in the sibling rename journeys, no raw numbers, test names without "should". The Postgres file imports `join` from `node:path`, as most journeys in that folder do; I am not filing it.

Upgrade fragments:
- App: `non-data-drops-are-widening` lists exactly the spec's reclassified drops, plus disabling RLS. The detection is `--confirm` in scripts and config, and the summary and instructions say consent stays for data-losing operations. `rename-statements` is additive, with no detection, and describes only what ships, including the `--advance-ref` advice.
- Extension: every surface named is published. That includes `migration-tools/aggregate` through `@prisma/orm-postgres/migration-tools/aggregate` and the SQL family's `control`. The instructions are accurate. The detection gap is D6-2.

Docs:
- Migration System § Statements matches the code: the grammar; the field named through the destination model; resolution in the CLI package into domain coordinates; app space only; the working copy; the storage effects, with zero operations for `@@map`/`@map`-kept names and relations; `widening`; byte-identical re-emit; `appliedStatements`; `statementRejected`; the snapshot read only with statements; `origin: null` for the runner; `--db`/`--advance-ref`. It also states the limits, including the `@@map`-only table change with the hand-written fallback.
- The `db update` live-reconciliation paragraph, the CLI verbs and the error list are updated.
- The Data Contract rewrite is accurate.
- No `projects/` paths. `hint(was` survives only in ADR 258's history and the 02b checklist line that forbids it. No hard-wrapped prose.

Skills: pitfall 7 and the checklist in `contract.md`, and pitfall 8 and the "doesn't do yet" entry in `migrations.md`, teach `--rename` with the destination-model field form, keep hand-editing `migration.ts` (now with `renameColumn`) as the fallback, and say MongoDB does not apply statements. Journey 02b now expects `--rename User.email:User.emailAddress`. Its file name still says "with-hint". Renaming the file is optional.

For the orchestrator: the Mongo fix now in progress will change what "The MongoDB planner does not apply statements yet" and the skill line "is not applied on MongoDB" should say. For example, if Mongo now refuses statements with an error, both should name that error. Re-read both after the Mongo commits land.

### Dispatch 6 round 2, and the Mongo refusal round 1 (2026-10-06)

Dispatch 6 round 2: SATISFIED.
- D6-1 closed. S2.06 on both targets runs `db update --dry-run --json` without statements after the renames, and asserts an empty `plan.operations`. That plan is diffed against the live database. The labels after it are renumbered, and the journey README says so.
- D6-2 closed. The detection pattern is the nested-brace version. The prose says calls that pass a prebuilt options object are not detected and must be checked by hand, and now includes `MongoMigrationPlanner` from `@prisma/orm-target-mongo/target/control` (a published path).
- D6-3 closed. All three ADR notes use `> **Update — 2026-10:**`. ADR 258's note is a blockquote under the command-line alternative it reverses.
- The error reference, README, Migration System § Statements limits and the skill's "doesn't do yet" entry now say MongoDB refuses statements with `MIGRATION.PLANNING_FAILED` and plans nothing. That matches the code.

Mongo refusal: ANOTHER ROUND NEEDED, for M-1 (message text only).
- The refusal happens before anything is planned. `MongoMigrationPlanner.plan` returns the failure before it casts the contract or calls `planCalls`, so no operation is built.
- Statements reach a planner only through `plan` options: `migration plan` through `runPlannerLeg`, and `db update` through `planFromDiff`. `planCalls` takes no statements and has no other production caller. So no Mongo path can plan a drop-and-create while a statement was given.
- The conflict reaches `PLANNING_FAILED` with the statement. The new test in the Mongo target package runs `executeDbUpdate` with the real `mongoTargetDescriptor.migrations` and asserts `code: 'PLANNING_FAILED'` and a `statementRejected` conflict carrying the resolved model statement in domain coordinates. The planner unit test asserts the exact conflict, that only the first of two statements is reported, and the field form named through the destination model.
- The summary reads well. The `why` is M-1.
- The 40-call `statements: []` sweep is mechanical. `@internal/cli` and `@internal/migration-tools` are already dev dependencies of the Mongo target, so the new control-api test adds no dependency.

For the orchestrator, not a finding: in `migration plan`'s auto-baseline path, the baseline package is written before the delta leg runs with the statements. A delta leg refused by the planner (`statementRejected` on any target, now including every MongoDB statement) leaves the baseline package on disk. That baseline is a valid edge from the empty contract to the `db` ref's hash, and the next run plans normally from it, so I see no harm. It does contradict a reading of "statements fail before anything is written" for refusals at planning time, as opposed to resolution failures. If you want the README sentence exact, it could say "resolve before anything is written". It already says that.

### Dispatch 7, round 1 (2026-10-07)

Verdict: ANOTHER ROUND NEEDED, for D7-1 (message text and one test). The merge is sound.

The merge, `git show --remerge-diff fd649676da`, which shows only how conflicts were resolved and what was changed by hand. `b5e44cf411`, main into the shaping branch, has an empty remerge diff, so main reached the sync branch without conflicts.
- `control-api.ts`: keeps this branch's `ResolvedStatement` export and main's removal of `SignDatabaseResult`. Family `errors.ts`: keeps `COLUMN_RENAME_UNMATCHED` and main's removal of `MARKER_CAS_FAILURE`.
- Family exports: `sqlTypeLookupsOf` (main) and the statement-planning exports (this branch) are both kept. Postgres planner imports: both, and `sqlTypeLookupsOf(options.frameworkComponents)` is still used at `planner.ts:312`.
- Working schema, both targets: `withColumnName` copies `toCanonicalForm` instead of the removed `codecNamedType`. The copy list now matches every field of `SqlColumnIR` (13). A field main adds later would be dropped silently by a column rename, because the list is written out by hand. Not a finding today.
- The SQLite facade's `schemaAfterRenames` passes `sqlTypeLookupsOf(this.frameworkComponents())` to `sqliteContractToSchema`. The Postgres facade already passes `this.frameworkComponents()`, per main's signature. Every `contractToSchema` call in `src` passes the type lookups.
- SQLite `table-rename-calls.ts`: keeps this branch's working-schema version. Main's side still called `applyTableRename`, which this branch removed in dispatch 1. Main did not change `apply-table-rename.ts` after the shaping branch's base (an empty diff from `97820831c6` to `b5e44cf411`), so deleting it loses nothing of main's. Main's `apply-table-rename.test.ts` goes with it.
- Field-event planner: auto-merged. Main's `sameStorageColumn` compares `dataType`, `nullable`, `typeRef`, `typeParams` and `default`, and this branch's table and column re-keying sits above it unchanged.
- Aggregate planner: auto-merged. Main's `spacesInApplyOrder` loop drives planning and `applyOrder`, and this branch's `appSpace` spread and `appliedStatements: []` on the declared-state plan sit inside it.
- Tests: the conflicts are mostly a `frameworkComponents` line beside this branch's `statements: []`, and resolve to main's `postgresTypeComponents` (or the SQLite equivalent) plus `statements: []`. Main's field-event `dataType` fixtures moved into this branch's `field-event-fixtures.ts` rather than being dropped.
- Neither planner gained a new reader of `options.schema` that bypasses the working copy.

ADR numbering: main moved the storage-naming ADR to 264, and 258 is now "List cardinality …". This branch's amendment note is in the ADR 264 file. No tracked text this branch added cites ADR 258 for storage naming: the grep finds only the ADR index row for 258 and other projects' notes. 9c09483884 fixes the one brief that did.

For the orchestrator: the adapter-postgres `render-typescript.roundtrip.test.ts` timeouts under load are the same pattern as the F25 CLI case. Nothing on this branch changes that file's subject.

### Dispatch 7, round 2 (2026-10-07)

Verdict: SATISFIED. D7-1 is closed.

- The three texts are the recommended ones, word for word, behind one shared first sentence. The same-collection case is decided by comparing the two contracts' collection names, so `@@map` is honoured. Names are quoted with `JSON.stringify`, so `db.getCollection(...)` and the `$rename` keys are valid shell strings for any name. No case tells the user to run again where that loses data.
- Tests: exact text for the different-collection case (`profiles` to `users`) and for the field case, plus the new same-collection case (`posts`).
- The implementer's claim holds. A Mongo model's `fields` are keyed by the stored name in every authoring surface:
  - The PSL interpreter (`contract-psl/src/interpreter.ts:1503-1504`) does `fields[physicalName(...)] = …`.
  - The Prisma 6 interpreter (`contract-prisma6/src/interpreter.ts:1005`, `:1046`) does `build.fields[storedName]`, where `@map` sets `storedName`.
  - The TypeScript builder takes `fields` keyed as written, for example `fields: { _id: field.objectId() }`.
  - The emitted `mongo-blog-leaderboard` contract shows `User.fields` keys `_id, address, bio, email, name`.
  - Value-object fields are keyed by their source names, but value objects are refused before planning.
  - So the statement's field names are the stored names, and the `$rename` example is correct. The words "using the field names as they are stored" in the text are still right, and do no harm.

Note for the orchestrator, outside this slice: because Mongo keys model fields by stored name, a Mongo field statement has to name the stored field, for example `User._id`, where SQL statements name the model's field. That is a consequence of how the Mongo contract is shaped, not of this branch. Slice 4 (statements on MongoDB) will have to decide which name a statement uses.

### Dispatch 9, round 1 (2026-10-07)

Verdict: ANOTHER ROUND NEEDED, for D9-1 (documentation only). D9-2 and D9-3 are low.

R1, checked independently: every read of an operation `id` in `packages/**/src`.
- The runners use it in failure messages, `meta.operationId`, the skip records they build, and the ledger journal (D9-1).
- The CLI uses it in progress span ids (`operation:<id>`), JSON summaries, the destructive-operation list, and `appliedStatements.operationIds`.
- The family uses it in the plan-operation clone and `operationIds`.
- No marker, attestation, `migration check`, graph or edge code reads it. Edges and paths are keyed by contract hashes and `migrationHash`.
- The consent plan hash covers operations and destination, and the pre-plan and the apply recompute it in the same run.
- So nothing ever reports an old migration as tampered.

F9, the placeholder change:
- An unfilled placeholder is still refused. `runPlannerLeg` catches `MIGRATION.UNFILLED_PLACEHOLDER` from `Promise.all` and writes `ops.json` empty while `hasPlaceholders` is set, as before. `migrate` reads `ops.json`, not the stub. Re-running `migration.ts` reaches the user's `placeholder()` call, which throws as before. `db update` cannot produce stubs, because the data-safety strategies in `planner-strategies.ts` emit `DataTransformCall` only when the policy allows `data`, and `db update`'s does not. So supplying `fromContract` with statements (dispatch 5) does not bring placeholders into `db update`.
- The auto-baseline consent change is a fix. A baseline whose resolved operations include a destructive one now asks for consent, where before the synchronous throw hid every operation.
- Unhandled rejection: D9-2.

The rest:
- F1 and F2: no advice now leads to data loss. The no-marker case states that a plan without statements drops and recreates with consent, and puts the warning in the next action itself. The missing-snapshot case gives the three-step route that stores the old contract, and says that adding `--advance-ref` to the failing command, or `migration plan --from`, does not help. The step 2 wording is D9-3.
- The "leave out the statement" texts appear only where leaving it out is safe: an identity rename, a statement already applied (F5), and a model with no table.
- F4 (8dfb41d6e0) plans every leg before writing anything, with a test.
- F6 (7fc2a5daa9) leaves `namespaceId` out of a conflict's `location` and `refusedStatement` in JSON for the unbound namespace, with a test, and the error reference says so.

I did not review F5, F7, F8, F10, F11, R2 to R4 or S08 line by line in this round. I only scanned their advice texts for data-loss guidance, as described above. I can review them in a follow-up round if you want each checked against its QA reproduction.

### Dispatch 9, round 2, and the line-by-line pass (2026-10-07)

Verdict: ANOTHER ROUND NEEDED, for D9-4 to D9-7. D9-1 to D9-3 are closed.

Round 2:
- R1 revert: `git diff 96023ec431^ 11685e67a9` over the regenerated example migrations, the planner goldens and `manifest.json` is empty. In the Postgres operation sources, the only id-related difference is the removed `operationId` getters. So ids and migration hashes are as before R1.
- Positions:
  - `StatementPlanner.#emit` counts `operationsOf(call)` (the call and its companions, each one operation, as `toOps` lowers them) from 0. The count is taken only after the policy check passes. Refused calls are never counted, and a refusal ends the plan anyway.
  - Both planners put `statements.value.calls` first (Postgres `planner.ts:424`, SQLite `planner.ts:225`), and nothing reorders the assembled list. The other sorts in the Postgres planner apply to sub-lists before assembly.
  - `migration plan`'s JSON `operations` is that list in order. On the placeholder path, `allSettled` drops only rejected stubs, and those come from strategies after the statement calls, so the statement positions do not move.
  - `db update` is D9-4.
  - The new `planner.operation-positions.test.ts` checks same-named tables in two schemas.
- D9-2: `checkedOp` now marks its wrapped promise handled on both targets, with tests. D9-3: step 2 is `--dry-run` first, in the error, the error reference and the skill.

Line by line, against the QA report and `wip/qa/r9`:
- F5: "already has "User" and has no "Profile", so this rename has already happened … Leave out --rename Profile:User." Correct, and safe on both commands.
- F7: the no-colon, model-against-field, backwards and order cases each give the statement to type, and each works. Identity is D9-5. Swap is D9-6.
- F8: the `migration plan` route is complete. The `db update` route is D9-7.
- F10: the extension instructions say to refuse and never ignore, describe the conflict to return, list the import paths, explain `operationIndexes`, and list what detection misses. Accurate.
- F11: the skill's code table lists the three `STATEMENT_*` codes, with routes that match the errors. The MongoDB workaround points at mongosh.
- R2: the planner options take `origin: PlanOrigin | null`, and `planFromDiff` passes `origin: null`. This replaces D5-1's Proxy override, which is gone. `migration plan` passes `planOriginOf(fromContract)`, and `Migration.origin` and `MigrationPlan.origin` share `PlanOrigin`.
- R3: `migration-statements.ts` says nothing about MongoDB. The remaining MongoDB mentions in `control-migration-types.ts` predate this slice and concern runners.
- R4: `StatementCall` is gone, replaced by `CallWithCompanions`.
- S08: `providedInvariants` reads through `Migration.readOperations`.

### Dispatch 9, round 3 (2026-10-07)

Verdict: SATISFIED. D9-4 to D9-7 are closed. D9-8 is low wording, and optional.

- D9-4: `reportAppliedStatements` takes an `operationOffset`. `executeRun` passes the operation count of the spaces ordered before the app (`operationsBefore`), and `migration plan` passes 0. The same report serves plan and apply mode. A new control-api test with an extension space checks that the positions index the aggregate `plan.operations`.
- D9-5: the stored-name text now says that a plan without the statement drops and creates with data, and gives both routes: `migration plan` edits `migration.ts`, `db update` renames by hand first. A test pins it. The "nothing to change" wording is D9-8.
- D9-6: three plans, in the order name to temporary, second to first, temporary to second. For a field, the temporary name is written on the field's model. I traced it against the resolver: each plan's old name is in its origin and not its destination, and its new name the reverse. The new test resolves each advised plan.
- D9-7: the refusal now gives the `migration plan` route and the `db update` route. The `db update` route's SQL comes from the new target hook `tableRenameByHand`, which the case guard now shares, so the two print the same statements (the SQLite case-only temporary name included). `wip/qa/r9/f8-db-update-route.txt` shows the route on SQLite: refusal, intermediate emit, hand rename, `--dry-run` with 0 operations, `db update` advancing `db`, final emit, `--rename` applying one column rename, and rows under `app_users.fullName`. On Postgres the route works the same way but shows constraint changes (D9-8).

## Orchestrator notes

- 2026-10-06: orchestrator handover from scylla-59 to turing-38. The slice spec and plan are taken as written; no amendments.
- 2026-10-06: D2-5 (low) and the "spells" wording are carried into dispatch 3 as its first commit rather than a third round of dispatch 2; the same implementer owns both.
- 2026-10-06: the operator added cross-cutting requirement 12 to the project spec (structured refusal, one statement entry point, so an interactive prompt can drop in later). Dispatch 2 already satisfies it; dispatches 3 and 5 are briefed on it.
- 2026-10-06: dispatch 5 brief pinned "supply fromContract to db update whenever the snapshot exists". D5-1 showed the runners read the plan's `from` as its origin, so that pin changed plain db update behaviour, contrary to the slice spec. Reversed: the snapshot is read only when statements are given, and the runner's plan keeps `origin: null`.
- 2026-10-07: R1 (schema in Postgres operation ids) reversed after D9-1: the ledger keeps each migration's hash and `migration status` reads it, so re-emitting an existing migration after the id change would drop its applied mark everywhere. Statements now refer to their operations by position in the plan (`operationIndexes`); ids are unchanged from main.
