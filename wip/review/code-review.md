# Code review: prisma/orm#30475 (principal-engineer pass)

Range: `origin/main...HEAD` (commits `a930072e21`, `20615a96f0`, merge `a08c5532ac`, fix `b2eb5aad3f`). Spec: `wip/review/spec.md` (inferred).

## Summary

The change is mostly sound. Reserved references are resolved in one place per command, the `@db` placeholder hash never reaches a comparison in the commands this pull request touches, and the merge resolution in `db update` is correct. The new `planRequiresExecution` rule skips no plan that must write a marker.

One change is a regression: `migration status` now warns `MIGRATION.MARKER_NOT_IN_HISTORY` for every all-external extension space (the Supabase shape) after a normal `db migrate`. The removed `markerHash === spaceContractHash` exception was what kept those spaces quiet (F01). Two other findings change behavior that users see: `migration status --to @contract` and `--to @db` apply the app hash to extension spaces, so AC1 holds only for projects without extension spaces (F02); and `docs/CLI Style Guide.md` still lists `./path` (F09, AC10 fails). The rest are smaller: test coverage for the fix commit is at the predicate level only, one connection check is now unreachable, and two retry or header details are inconsistent across commands.

Validation run: the seven relevant vitest files (77 tests) pass; `pnpm check:error-reference` passes.

## What looks solid

- `planRequiresExecution` (control-api/operations/migrate.ts lines 530 to 534). I traced every plan shape:
  - Recorded path (`resolveRecordedPath`): a plan with operations always runs. A zero-op plan with no marker and destination `EMPTY_CONTRACT_HASH` can only come from `findPathWithDecision(∅, ∅)` with no required invariants, which returns an empty path. Skipping it is correct.
  - Declared-state plan for an all-external extension space: `planSpacePath` returns `at-head` before it ever builds a declared-state plan when there is no marker and the target is `∅` (line 405). So every declared-state plan that reaches `planRequiresExecution` with no marker has a non-empty destination and still runs. The unit test at test/control-api/migrate-plan-requires-execution.test.ts line 40 covers this.
  - At-head plans never reach the predicate; they go to `atHeadResolutions`.
  - `planRequiresExecution` has one caller (`executeMigrate`); `db init` and `db update` do not use it.
- `db update` merge resolution (src/orm/db/update.ts). The reserved-ref early return is at lines 155 to 157, before `prepareMigrationRun`, so no connection opens. The catch block at lines 293 to 318 uses `errorFromCaught` with the connection string, keeps the `EngineStructuredError` rethrow and the `CONTRACT.VALIDATION_FAILED` mapping. No leftover `errorUnexpected` or `sanitizeErrorMessage` import.
- `@db` placeholder hash (question 6). `parseContractRef` returns `hash: ''` for `@db`. Every call site this pull request touches skips the parser for `@db`: src/orm/migrate.ts line 359, migrate-show.ts lines 154 and 189, status.ts lines 318 and 327; `db update` refuses it at line 155. The remaining call sites (`db sign`, `migration ref set`, `migration plan`) are listed under Deferred.
- `migration status --from <hash> --to @db` (question 3). `liveOrigin` is false, so `markerHash` comes from `fromOverrideHash` (status.ts lines 409 to 411), the ledger overlay is off (line 434 to 435), and the database is read only to resolve the target (line 405). `--from @db` sets `liveOrigin` true and reads the ledger overlay, the same as omitting `--from`.
- `usedLiveMarker: liveOrigin` (question 5, migrate-show.ts line 345). The ★ marker in the tree is drawn at `renderMarkerHashBySpace`, which holds the from-state. With `--from <hash> --to @db` that is the offline hash, so labeling it as the database marker would have been wrong. The change is correct.
- `db migrate --to @db` with a marker present: the target is the marker hash, the app plan is a zero-step path, and `refuseMarkerOutsideGraph` runs first. Extension spaces still walk to their own heads, which matches every other `--to` value.
- Error shapes (question 7). `errorUpdateTargetReservedRef` reuses the existing code `MIGRATION.REF_WRONG_GRAMMAR` with the same `meta` keys (`input`, `expectedGrammar`) as the shared mapper at cli-errors.ts line 705, is an `ActionableCliError`, and passes through `normalizeError`. `requireLiveDatabaseForLiveMarkerRef` builds `CONFIG.DB_CONNECTION_REQUIRED` with `meta.missingFlags`. No new codes; the error reference entry is updated.

## Findings

### F01: all-external extension spaces now warn `MARKER_NOT_IN_HISTORY` after every successful `db migrate`

Location: packages/1-framework/3-tooling/cli/src/orm/migration/status.ts lines 413 to 427.

Issue: The old check was `graph.nodes.has(markerHash) || markerHash === spaceContractHash`. The fix for AC4 replaced it with `isGraphNode(markerHash, graph)`. That fixes the app space, but it also removes the only thing that kept all-external extension spaces quiet. Such a space ships `migrations/<space>/refs/head.json` and no migration packages, so it is listed by `migrationSpaceListEntriesFromAggregate` and its graph is empty. The integrity check explicitly allows a head that is not in an empty graph (migration/src/aggregate/check-integrity.ts lines 91 to 104). `db migrate` writes the marker at the head hash with zero operations (test/integration/test/cli.migrate-external-space.e2e.test.ts lines 144 to 152). `isGraphNode(head, emptyGraph)` is false, so `migration status` now pushes a `MARKER_NOT_IN_HISTORY` warning for that space, sets `divergedMarker`, and changes the headline to "Database marker ... is not in the on-disk migration graph". Every Supabase project hits this on a healthy database.

No test covers status with an extension space, which is why the suite stays green.

Suggestion: Keep the exception for spaces that have no graph and whose marker is at their declared head. Apply AC4 strictly to spaces that do have a graph. Add a status test with an empty-graph extension space whose marker equals its head.

```ts
const headHash = space.headRef?.hash;
const markerInGraph =
  markerHash === undefined ||
  isGraphNode(markerHash, graph) ||
  (graph.nodes.size === 0 && markerHash === headHash);
```

### F02: `migration status --to @contract` and `--to @db` apply the app hash to extension spaces

Location: packages/1-framework/3-tooling/cli/src/orm/migration/status.ts lines 365 and 404.

Issue: `targetHash = activeRefHash ?? spaceContractHash` is computed for every scoped space, but `activeRefHash` is resolved against the app graph and the app marker. With an extension space present, `--to @contract` targets the app's contract hash in the extension space and `--to @db` targets the app's marker hash there. `hasMigrationPath` then fails for the extension, `noPath` is set (if the extension is listed first, it wins the headline), and the document differs from the one without `--to`. So AC1 ("same document as no `--to`") holds only for app-only projects; the test at test/orm/migration-status.test.ts line 455 uses an app-only project. This scoping problem already existed for hash and ref-name `--to` values, but `@contract` and `@db` are the forms users will now type by default. `db migrate` scopes `--to` to the app space (control-api/operations/migrate.ts line 169), so the two commands disagree.

Suggestion: Apply `activeRefHash` only to the app space, as `executeMigrate` and `executeMigrateShowPlan` do (migrate-show.ts line 264), and let extension spaces target their own contract hash. Do the same for `fromOverrideHash` at line 411, which `migrate --show` already limits to the app space (migrate-show.ts lines 198 to 205). Add a status test with an extension space for `--to @contract`.

### F03: unmarked database with `--to @db` or `--to @empty` reports a marker that does not exist

Location: packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts lines 249 to 276 and 547 to 555; src/control-api/operations/run-migration.ts lines 230 to 234.

Issue: With the fix, `db migrate --to @db` on a database with no marker returns `ok` with `summary: 'Already up to date'`, `migrationsApplied: 0`, `applied: []`. The human output is sensible: a `to @db` header line and "Already up to date". But the JSON document has `markerHash: <EMPTY_CONTRACT_HASH>` and `perSpace[app].marker.storageHash: <EMPTY_CONTRACT_HASH>`, while the database has no marker row. A script that reads `markerHash` cannot tell "no marker" from "marker at the empty contract". `buildPerSpaceBreakdown` copies `plan.destination` into `marker` regardless of whether the runner wrote anything. This was already true for at-head extension spaces, but this pull request makes it reachable for the app space.

Suggestion: When the short-circuit applies and the plan's origin is `null`, report `marker: null` (or omit it) for that space and set the top-level `markerHash` from the live marker rather than the destination. If the JSON schema cannot change in this pull request, record it in the tech-debt file.

### F04: `--to @empty` on an unmarked database still writes an app marker when an extension space has pending work

Location: packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts lines 236 to 248 and 279 to 290.

Issue: `planRequiresExecution` only decides whether the whole run short-circuits. If any extension space has pending work, `applyOrder` still includes the app space's zero-op plan (origin `null`, destination `∅`), and `runMigration` hands it to the runner, which advances markers inside each space's transaction. So whether `db migrate --to @empty` (or `--to @db` on an unmarked database) leaves the app space untouched depends on unrelated extension spaces. The commit message's claim that these commands "leave an unmarked database alone" is true only when no extension has pending work.

Suggestion: Filter `applyOrder` by `planRequiresExecution` and move the skipped plans into `atHeadResolutions`, so the rule applies per space:

```ts
const applyOrder = canonicalOrder.filter((spaceId) => {
  const entry = perSpacePlans.get(spaceId);
  if (entry === undefined) return false;
  if (planRequiresExecution(entry)) return true;
  atHeadResolutions.set(spaceId, entry);
  return false;
});
const hasPendingWork = applyOrder.length > 0;
```

### F05: the fix for AC7 is tested only at the predicate level

Location: packages/1-framework/3-tooling/cli/test/control-api/migrate-plan-requires-execution.test.ts lines 1 to 57; test/orm/migrate.test.ts lines 440 to 538.

Issue: The defect columbo-92 reported was an end-to-end one: the runner was called and refused the plan. The new tests check `planRequiresExecution` on hand-built plans with `as unknown as PerSpacePlan`. The command-level tests in test/orm/migrate.test.ts mock `client.migrate`, so they never run `executeMigrate`. Nothing asserts that `executeMigrate` with an unmarked database and `refHash: EMPTY_CONTRACT_HASH` returns "Already up to date" without calling the runner, or that the extension-space case in F04 behaves as intended. The predicate tests would still pass if someone moved the call or dropped it from `hasPendingWork`.

Suggestion: Add an `executeMigrate` test with a fake `familyInstance.readAllMarkers` returning an empty map, a one-edge app graph, and `refHash: EMPTY_CONTRACT_HASH`. Assert the summary and that the runner (`migrations` capability) was not called. Add a second case with an all-external extension space that needs a marker, to cover AC7's "declared-state plan still invokes the runner" through the real path.

### F06: the second connection check in `executeMigrateShowPlan` is unreachable

Location: packages/1-framework/3-tooling/cli/src/control-api/operations/migrate-show.ts lines 208 to 216.

Issue: Lines 111 to 130 already return `CONFIG.DB_CONNECTION_REQUIRED` whenever `needsLiveMarker` is true and the connection or driver is missing. The check at line 209 tests the same condition under the same flag, so it can never fire. The fix commit edited its `why` and `commandName` (AC9), but those strings are never shown. It also has no `missingFlags`, unlike the reachable check. A future reader may "fix" the wrong one.

Suggestion: Delete lines 209 to 216. If TypeScript needs the narrowing for `config.driver!` and `dbConnection`, narrow with a local `const driver = config.driver` after the early return, or throw an `InternalError` for the impossible case.

### F07: `db migrate --to @db` without a connection drops `--to @db` from the retry hint

Location: packages/1-framework/3-tooling/cli/src/orm/migrate.ts lines 305 to 314; src/orm/db/prepare.ts lines 97 to 104.

Issue (question 4): `requireLiveDatabaseForLiveMarkerRef` gives `migration status` and `db migrate --show` a retry command that repeats `--from` and `--to`. `db migrate` without `--show` never calls it. It fails in `prepareMigrationRun`, whose fix text is "Run `{bin} db migrate --db <url>`", and whose `why` does not mention `@db`. Running the suggested command migrates to the emitted contract, which is not what the user asked for. `meta.missingFlags: ['--db']` is present, so the envelope shape is fine.

For the call sites that do use the helper, the retry command is correct: status repeats `--from`/`--to` and `migrate --show` repeats them after `--show`. Neither repeats `--space`, `--config`, or `--ascii`, which is acceptable. The user's values are pasted unquoted; that is harmless for hashes, ref names, and directory names.

Suggestion: In `createMigrateCommand`, when `isLiveMarkerRef(args.flags.to)`, call `requireLiveDatabaseForLiveMarkerRef({ command: '{bin} db migrate', from: undefined, to: args.flags.to, ... })` before `prepareMigrationRun`, and extend the test at test/orm/migrate.test.ts line 523 to assert `fix` contains `--to @db`.

### F08: `db migrate --show --from @db` hides the database line in the header

Location: packages/1-framework/3-tooling/cli/src/orm/migrate.ts lines 293 to 296.

Issue: The header shows the masked database URL only when `args.flags.from === undefined`. `--from @db` reads the live marker the same way, so the header should show the database too. `migration status` uses `connects` for the same decision (status.ts line 540), so the two commands disagree.

Suggestion: Use the same condition as the operation: show the database when `--from` is omitted or is `@db` (`args.flags.from === undefined || isLiveMarkerRef(args.flags.from)`). Showing it whenever `--to` is `@db` would also be reasonable, since that also reads the database.

### F09: `docs/CLI Style Guide.md` still lists `./path` and describes the old `db sign` positional

Location: docs/CLI Style Guide.md line 248.

Issue: The `db sign` entry says `--contract` accepts "`<dir>^`, or `./path`" and "the positional accepts only the first four". This pull request removes `./path` and makes the positional and the flag share one brief (`CONTRACT_REF_BRIEF`, src/orm/db/sign.ts lines 62 to 63). AC10 fails on this line.

Suggestion: Change it to "`[contract]` positional or `--contract <ref>` (hash, prefix, ref name, migration dir name, or `<dir>^`; both accept the same forms; ...)".

### F10: test gaps against the acceptance criteria

Location: packages/1-framework/3-tooling/cli/test/orm/migration-status.test.ts lines 454 to 586; test/orm/migrate-show.test.ts lines 321 to 370.

Issue: Some acceptance criteria are covered only by error-path tests, or are not asserted:
- No test runs `migration status --from <hash> --to @db` with a connection and checks that `currentContract` is the `--from` hash and that the migrations show no `applied` overlay (question 3). Only the no-connection error is tested.
- No test asserts the retry command text (`fix`) for any `@db` call site, though the helper exists to produce it.
- The `--to @db` no-connection test for `migrate --show` (migrate-show.test.ts line 356) checks only the code, not `meta.missingFlags`.

Suggestion: Add the `--from <hash> --to @db` success case with `db.counters.connections === 1`, `currentContract: <hash>`, and every migration `status` not `applied`. Assert `fix: expect.stringContaining('--to @db --db $DATABASE_URL')` in one status and one `migrate --show` test.

## Deferred

- `db sign @db`, `migration ref set @db`, and `migration plan --from @db` still feed `parseContractRef`'s placeholder hash `''` into real comparisons: `contract-snapshot-resolution.ts` line 82 (`bundles.find(p => p.metadata.to === '')`, then a "No contract file found for hash """ error), `ref.ts` line 101 (`errorRefSetHashNotInGraph('')`), and `plan-resolution.ts` `resolveFromPolicy`. The spec lists `db sign` and those `migration` subcommands as non-goals. The cleaner fix is in `parseContractRef` itself: return a distinct result for `@db` that has no `hash` field, so every caller must handle it. Deferred because it changes a shared parser outside this pull request's scope.
- `buildFabricatedMigrationEdge` puts a zero-op edge into `applied` for at-head empty-graph spaces, so `migrationsApplied` can be 1 while the summary says "Already up to date". This already happened before this pull request and only affects extension spaces. Deferred as it is not related to the reserved-reference change.

## Already addressed

The four defects columbo-92 reported, fixed in `b2eb5aad3f`:

1. `db migrate --to @db` on a database with no marker invoked the runner, which refused the plan. Verified fixed for the single-space case: `planRequiresExecution` now reads a missing origin as `∅`, so the zero-op `∅ → ∅` plan short-circuits to "Already up to date". See F04 for the multi-space case and F05 for the test gap.
2. `db migrate --to @empty` on an empty database failed the same way. Same fix, same verification.
3. The connection-required error for `migrate --show` named a command that does not exist. Verified: the reachable check (migrate-show.ts line 124) says `db migrate --show`, and the test at test/orm/migrate-show.test.ts line 232 asserts it. The unreachable copy is F06.
4. Out-of-date help for `migration status --from` and `db migrate --from`. Verified: status.ts line 244 and migrate.ts line 248 now match what the code accepts.

## Acceptance-criteria verification

| AC | Result | Evidence |
| --- | --- | --- |
| AC1 | WEAK | migration-status.test.ts lines 455 to 478 assert `toEqual` between `--to @contract` and no `--to`, and lines 480 to 494 assert `connections === 0` for `--from @contract`. The fixture is app-only; with an extension space the documents differ (F02). |
| AC2 | PASS | Lines 496 to 514 assert `currentContract`/`targetContract` = marker for `--to @db`; lines 516 to 540 assert 1 pending, `DIR_BASE` `applied`, `DIR_HEAD` `pending`, one connection. |
| AC3 | PASS | Lines 542 to 564 and 566 to 584 assert exit 2, `CONFIG.DB_CONNECTION_REQUIRED`, `meta.missingFlags: ['--db']` for both forms. Retry text is not asserted (F10). |
| AC4 | PASS | Lines 207 to 229 assert exactly one `MIGRATION.MARKER_NOT_IN_HISTORY` warn at exit 0 when the marker equals the emitted contract. The same change causes F01. |
| AC5 | PASS | migrate-show.test.ts lines 322 to 338 (one migration `∅ → C1`), 340 to 354 (`migrations: []`), 356 to 369 (`CONFIG.DB_CONNECTION_REQUIRED`). |
| AC6 | PASS | migrate.test.ts lines 441 to 482 assert `refHash: C2` and the C2 contract; lines 484 to 520 assert `refHash: C1`, `refInvariants: []`; lines 522 to 537 assert the error and that neither `connect` nor `migrate` was called. |
| AC7 | WEAK | Only migrate-plan-requires-execution.test.ts asserts the predicate on hand-built plans. No test runs `executeMigrate` for an unmarked database (F05). The multi-space case does not hold (F04). |
| AC8 | PASS | db-update-to-resolution.test.ts lines 142 to 167 assert exit 2, `MIGRATION.REF_WRONG_GRAMMAR`, the `why` text, `meta`, and `dbUpdate` not called, for all three inputs. |
| AC9 | PASS | migrate-show.test.ts line 236 asserts `why` contains `db migrate --show`. A grep of production `commandName` values finds only existing commands. |
| AC10 | FAIL | docs/CLI Style Guide.md line 248 still lists `./path` (F09). Help briefs, doc comments, and the skill reference are clean. |
| AC11 | PASS | `pnpm check:error-reference` passes (365 codes); docs/reference/error-reference.md line 1605 names the `db update --to` site. |

| Result | Count |
| --- | --- |
| PASS | 8 |
| WEAK | 2 |
| FAIL | 1 |
| NOT VERIFIED | 0 |
