# System design review — Statements on the command line, and renames of models and fields

**Branch:** `tml-3475-statement-renames` · **Base:** `tml-3474-migration-statements-sync` · **Range:** `git diff tml-3474-migration-statements-sync...HEAD` (HEAD `df9d6c4350`) · **Lens:** architect (names, typology, layer placement, boundaries)

Expectation sources read: `CLAUDE.md`, `drive/code/README.md`, the project `spec.md`, `design-notes.md`, `deferred.md`, `plan.md` § Stretch goal, the slice `spec.md`, the Migration System and Data Contract subsystem docs, and the ADR 001, 028, 243, 244 and 264 amendments.

## What the slice adds

A new concept enters the migration system: a **statement**, the user's own declaration of intent that the diff cannot express. It has a three-step life: text on the command line (`--rename Profile:User`), a `ResolvedStatement` in domain coordinates (namespace, model, field) after the CLI resolves it against the origin and destination contracts, and an `AppliedStatement` on the planner's success result after the family planner has turned it into operations.

New guarantees and invariants:

- Every planner takes `statements` as a required input, so no planner can ignore one silently. MongoDB refuses any statement with a `statementRejected` conflict instead of planning a drop.
- Resolution happens before any family code runs, against the application contract space only, and produces only domain names.
- The family maps each statement to a storage effect by comparing the two models' storage, and applies it in order to a working copy of the origin schema. The diff then runs on that copy, so a renamed table is no longer a drop plus a create.
- A plan built from statements renders the same `renameTable` / `renameColumn` facade calls a user could write, and the facade shares the working-schema mechanism, so re-running `migration.ts` reproduces `ops.json`.
- `db update` reads an origin contract from the snapshot of the marker hash, but only when statements are given.
- Drops that lose no data (index, unique and foreign-key constraint, check, policy, default, native enum type, disabling row-level security) are `widening` on Postgres and SQLite.

## Subsystem fit and dependency direction

The framework stays family-blind. I ran `node scripts/lint-framework-vocabulary.mjs`: `count=254 threshold=254`, unchanged. A grep of added framework source lines finds no table, column, collection or target names outside the CLI README. No new package edge appears: `@internal/errors` already depended on `@internal/framework-components`.

| Framework addition | Family vocabulary or family-shaped assumption? | Would MongoDB use it meaningfully? |
| --- | --- | --- |
| `ResolvedStatement`, `ResolvedModelRename`, `ResolvedFieldRename` | None. | Yes, once slice 4 decides which field name a Mongo statement uses (deferred). |
| `ModelCoordinate`, `FieldCoordinate` | None, but a second coordinate shape beside `EntityCoordinate` (S06). | Yes. |
| `AppliedStatement` | None in the type; its `description` is written by each family (S03), and `operationCount` is rename-shaped (S04). | Yes; Mongo returns `[]` today. |
| `MigrationPlannerConflict.statement` | None. Name is ambiguous (S02). | Yes; Mongo sets it. |
| `MigrationPlanner.plan` option `statements` | None. The word collides with SQL statements in SQL packages (S01). | Yes. |
| `OpFactoryCall.toOps?(lowerer?: unknown)` | An `unknown`-typed parameter added only so SQL target renderers can call it (S07). | No. |
| `Migration.resetAuthoringState` / `resetAuthoringStateOf` | None, but a mechanism on the framework base that only SQL facades need (S08). | Not today. |
| `PlannerInput.appSpace` / `AppSpacePlanningInputs` | None. The app-versus-extension split is a real framework distinction. Statements can be dropped silently (S10). | Yes. |
| `isStorageHashHex` | None. Symmetric with `storageHashHex`, placed next to it. | Yes. |
| CLI parser and resolver (`control-api/statements/`) | None. Reads `models`, `fields`, `relations`, `valueObjects`, all framework domain types. | Yes, subject to the deferred Mongo field-name question. |

Placement is right: the coordinate and statement types live in `framework-components/control` beside the planner types that carry them, and the resolver lives in the CLI's control API, which already owns contract-reference resolution. The aggregate planner learns only that the application space may receive extra inputs, which is a framework concept.

## Boundary between the SQL family and its targets

`StatementPlanningTarget<TCall>` is the right boundary, not the inverted abstraction that `drive/code/README.md` warns about. The family owns the statement semantics: reading the domain-to-storage bridge, the control-policy check, the refusal conditions and the conflict shape. The targets own their working schema and build opaque calls. No SQL text or target fragment crosses upward. Two things cross the line the wrong way, and one SPI member is redundant:

- The family renders a target facade call by hand in one refusal message, and branches on the unbound-namespace sentinel to decide whether to print `schema:` (S12).
- The family validates a rename's preconditions with its own checks, while the facade validates the same rename with the family's `resolveTableRenameAgainst` / `resolveColumnRenameAgainst` (S11).
- `operationCount` and `operationClasses` are implemented identically by both targets (S13).

Duplication between the targets: each has a near-identical 40-line private `planStatements` adapter, a three-line `WorkingSchemaImpl`, and the same one-line `toOps` body on each rename call. That is the acceptable kind of duplication the adapter pattern expects, once S13 removes the identical accessors. Nothing in a target belongs in the family beyond that.

## Naming and typology

- **statement vs hint.** The code uses "statement" consistently, and the docs sweep replaced most `@hint` text. Leftovers are in S16.
- **statement vs SQL statement.** In the SQL packages "statement" already means SQL text (`renameTableStatement`, `renameByHandStatements`, `LoweredStatement`, the runner's `executeStatement`), and in the framework `OperationPreview.statements` is rendered DDL. `migration plan --json` now emits `preview.statements` (SQL) and `appliedStatements` (user intent) in one document (S01).
- **applied statement.** Reads correctly: a resolved statement plus what the plan did with it. Its fields need work (S03, S04).
- **storage effect.** Good concept name, but the two unions mix effects with reasons the effect cannot be worked out (`noTable`, `columnOnOneSide`) (S18).
- **working schema, companion.** Both read correctly and match the project spec's vocabulary. `RenameTableCompanionCall` and `RenameColumnCompanionCall` are the same union under two names (S14).
- **statementRejected vs refusedOperationClass.** Two words for one idea in the same conflict type (S02).
- **renames vs statements on option types.** `renames` means raw `--rename` texts on four CLI option types, and resolved table renames on `PlannedStatements` and `PlanFieldEventOperationsOptions`, where its sibling is `columnRenames` (S05, S14).
- **columnRenames.** Fine; its sibling should be `tableRenames`.
- **appSpace.** Passes the probes: it names a real structural partition (`aggregate.app`).
- **ResolvedTableRename / ResolvedColumnRename vs ResolvedModelRename.** The `Resolved` prefix means "resolved against the contracts" on the framework types and "the namespace was found in the schema" on the family types. Read cold, the four look like a model→table, field→column ladder produced by one kind of resolution, which they are not (S14).

## Fitness for the next slices and the stretch goal

What holds:

- One required `statements` input on every planner, and a planner result that reports per statement, are the right shape for `--delete`, `--convert` and `--backfill` to join.
- Statements resolve and plan in order over a working copy, which is what composition across verbs needs (`--rename User.age:User.years --convert User.years`).
- Refused statements already travel as structured data on conflicts, which is the seed of the structured refusal that requirement 12 asks for.
- Every dispatch site switches on `entity` without checking `kind`, but each site's parameter types make the compiler reject a delete reaching rename code, so slice 2 will be told where to add cases.

What will have to be reshaped if left as is:

- The text-side entry point is rename-specific (`renames: string[]`, `ParsedRename`, `--rename` in error titles, a whole-input origin check that slice 2 must make per verb because `--delete` works without an origin). Adding `--delete` this way means a parallel `deletes: string[]` on four option types and loses the order between verbs (S05).
- `AppliedStatement.operationCount` cannot express what a delete does: it produces no operation, it permits one the diff planned. Slice 2's refusal also needs to know which operations a statement accounts for (S04).
- `conflict.statement` names the refused statement. Slice 2 adds the opposite relation, the statements that would resolve a destructive operation. With the current name a reader cannot tell cause from cure (S02).
- `ModelCoordinate` cannot address a value object or an enum value, which slice 3 needs, and its field names are about to be fixed in released JSON (S06).
- The data-loss refusal needs a map from a storage operation back to a domain entity (`dropTable "Legacy"` → model `Legacy`). Nothing here builds it, which is correct for this slice. The natural home is the SQL family, beside `modelRenameStorageEffect`, using the same bridge reads in the other direction.
- Requirement 12 says statements are "parsed, resolved and applied through one entry point". Parse and resolve have one entry point (`resolveStatements`). Application runs through two planning paths: `runPlannerLeg` in `migration-plan.ts` and `planMigration` → `planFromDiff` in `db-run.ts`. That is pre-existing, and the plan accepts re-running the whole command with more statements, so it is not a finding, but the stretch goal will have to wrap both paths.

## ADR amendments and docs

The Migration System § Statements section is accurate, uses the code's names (`ResolvedStatement`, `statementRejected`, `PlannerInput.appSpace`, `appliedStatements`), and states the limits honestly. The Data Contract section and the ADR 001, 028, 243 and 244 notes hold up. Gaps:

- ADR 264's next alternative still calls a contract-source hint "the intended direction … recorded in the Data Contract and Migration System subsystem documents and in ADR 001", which this branch has just removed from those documents (S16).
- The rule "destructive means the operation loses data" is not stated where operation classes are defined (S15).
- The Statements section says statements are the planner's "third input, beside the destination contract and the origin schema". The origin contract is a fourth input that statements depend on; the section explains it later, under "The origin of `db update`". Minor, no finding.

## Test strategy at the architectural level

| Property | Proven? |
| --- | --- |
| The framework stays family-blind | Yes: the vocabulary lint count is unchanged, and the Mongo planner tests show a second family receives the same surface and refuses it. |
| Statements are the only source of intent | Yes: Postgres, SQLite and Mongo planner tests each plan a drop and create for the same change without a statement. |
| Same plan from both commands | Mostly: both journeys apply the same `expectOnlyRenames` and `expectAppliedStatements` checks. Comparing the two operation lists for equality would prove it directly. |
| Equivalence with the hand-written route | Yes for success: planner-versus-facade tests on both targets, and byte-identical re-emit in the journeys. Not for refusal, because the planner and the facade use different validators (S11). |
| No statement is ignored | Yes for planners (required input, Mongo refuses). Not for the aggregate planner, which drops `appSpace` when the app space walks its graph (S10); no test covers it. |
| Re-reading a migration's operations is stable | Yes: `rename-table-facade.authoring-state.test.ts` on both targets. |

## Findings in scope

**S01 — "statement" already means a SQL statement in the same packages and the same JSON document.** Should fix before slice 2.
Location: `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts` lines 26-42; `packages/1-framework/1-core/framework-components/src/control/control-operation-preview.ts` lines 15-23; `packages/2-sql/9-family/src/core/migrations/types.ts` lines 337-341; `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` lines 77, 347, 701-742.
Issue: `OperationPreview.statements` (framework) is rendered SQL or shell text, and `migration plan --json` now carries both `preview.statements` and `appliedStatements`. In the Postgres planner, `renameTableStatement` and `renameByHandStatements` (SQL) sit beside `planStatements` and `statements.value` (user intent). `SqlMigrationPlannerPlanOptions.statements` reads cold as SQL to put in the plan.
Why it matters: one word for two concepts in one bounded context, on a public JSON surface, just before three more slices add verbs under it.
Suggestion: keep "statement" as the user-facing word, and qualify it in code the way the module name already does: `MigrationStatement`, `ResolvedMigrationStatement`, `AppliedMigrationStatement`, planner option `migrationStatements`. Decide the JSON field name deliberately (`appliedStatements` beside `preview.statements` is defensible only if the docs define both).

**S02 — A conflict's `statement` field and the `statementRejected` kind name the cause ambiguously, and use a second word for "refused".** Should fix before slice 2.
Location: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 275-279; `packages/2-sql/9-family/src/core/migrations/types.ts` lines 257-267 and 282-283; `packages/1-framework/1-core/errors/src/control.ts` lines 39-40; `packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts` line 269.
Issue: the sibling field in the same type is `refusedOperationClass`, and every doc comment says the conflict "refuses" a statement, yet the field is `statement` and the kind is `statementRejected`. Slice 2 adds conflicts that list the statements that would resolve a destructive operation, so `conflict.statement` will be read as either the cause or the cure. The kind string is also a cross-family contract (Mongo copies it) with no framework definition. `SqlPlannerConflict` redeclares the field it already inherits.
Why it matters: the CLI and the stretch-goal prompt will key on this field; the name has to say which relation it is.
Suggestion: rename the field to `refusedStatement`, matching `refusedOperationClass`, and the kind to `statementRefused`. Either export the kind from the framework next to the field, or document that consumers key on the field, not the kind. Drop the redeclaration in `SqlPlannerConflict`.

**S03 — Each family writes the same domain-only description of a statement; MongoDB already has a second copy that differs.** Should fix.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 115-136; `packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-planner.ts` lines 216-222; `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts` lines 33-42.
Issue: `describeStatement` uses only domain coordinates and the contracts' namespace count; nothing in it is family knowledge. The SQL copy qualifies names with the namespace when a contract has several, and the Mongo copy never does. `AppliedStatement.description` then carries presentation text inside a structured planner result.
Why it matters: one rule in two places, already diverging, and slice 2's refusal text and the prompt will need the same rendering a third and fourth time.
Suggestion: move `describeStatement` to the framework beside the statement types (or to the CLI renderer), have the CLI render `AppliedStatement` from its `statement`, and drop `description` from the planner result. The spec's "the family describes each one" should change with it.

**S04 — `AppliedStatement.operationCount` is shaped for renames only.** Should fix before slice 2.
Location: `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts` lines 33-42; `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 455-469.
Issue: a count says how many operations a statement produced, and the CLI relies on statement calls being first in the plan to make sense of it. A `--delete` produces nothing; it permits an operation the diff planned. A `--convert` produces an operation with a placeholder. Slice 2's refusal needs to know which destructive operations a statement accounts for.
Why it matters: slice 2 will have to reshape this type, and every renderer and JSON consumer of it, one slice after it ships.
Suggestion: record which operations each statement accounts for, by operation id, with the relation stated (for example `produced` for a rename, `permitted` for a delete). The count can be derived.

**S05 — The text-side entry point is keyed by one verb.** Should fix before slice 2.
Location: `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts` lines 44-48 and 566-589; `packages/1-framework/3-tooling/cli/src/control-api/statements/parse-rename.ts` lines 11-15; `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` lines 570-605; `renames` on `migration-plan.ts` line 82, `control-api/types.ts` line 240, `db-update.ts` line 58, `db-run.ts` line 104.
Issue: `ResolveStatementsInput.renames: string[]`, `ParsedRename`, and error titles that hard-code `"--rename ${statement}"` make the resolver know both the verb and that the text came from a flag. The missing-origin check fails the whole input, but decision 8 says `--delete` works without an origin. Requirement 12 asks for an entry point that does not know where the text came from.
Why it matters: slice 2 would add `deletes: string[]` to four option types and lose the order between verbs, which decision 9 and the design notes' scenario 3 rely on.
Suggestion: carry one ordered list of statement texts with their verb from the command line down (`statements: readonly { verb: 'rename' | …; text: string }[]`), parse into a `ParsedStatement` union, make the origin check per statement, and have error titles render the statement from its parsed form rather than from a flag name. The engine's repeated flags may not keep cross-flag order; if not, record the order rule (for example all renames first) in the spec now.

**S06 — The new coordinates are a second, differently spelled coordinate shape, undocumented, and too narrow for slice 3.** Should fix before the JSON ships.
Location: `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts` lines 3-31; compare `packages/1-framework/1-core/framework-components/src/ir/storage.ts` lines 25-30 and `control-migration-types.ts` `SchemaEntityCoordinate`.
Issue: `ModelCoordinate` spells the namespace as `namespace`; `EntityCoordinate`, `SchemaEntityCoordinate`, `ModelTable` and every family type spell it `namespaceId`. Neither interface says that `model` and `field` are names as the contract source writes them, not storage names, which is exactly the question the deferred Mongo item asks. A value object, a value object field and an enum value cannot be addressed by `ModelCoordinate` / `FieldCoordinate`. `ResolvedStatement`'s doc says "a statement the user gave on the command line", which ties the type to one source.
Why it matters: these field names go out in `appliedStatements` and conflict JSON, and slice 3 must add coordinates for value objects and enum values.
Suggestion: use `namespaceId`; add one doc line per interface saying the names are domain names; state how slice 3's coordinates relate (for example an `entityKind` slot, as `EntityCoordinate` has, or separate `ValueObjectCoordinate` and `EnumValueCoordinate` types). Drop "on the command line" from the type's doc.

**S07 — `OpFactoryCall.toOps?(lowerer?: unknown)` puts an `unknown`-typed parameter on the framework interface for the SQL targets' benefit.** Should fix. This is the "family vocabulary on framework surface" class in `drive/code/README.md`; sweep the diff for others (I found none besides S08).
Location: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 175-180; `packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts` lines 46-61; `packages/3-targets/3-targets/sqlite/src/core/migrations/render-ops.ts` lines 39-55.
Issue: only the two SQL targets implement or call it. Its sibling `toOp()` takes no lowerer at the framework level, and the targets still `blindCast` to pass one, so the two siblings have different parameter shapes. "One call lowers to several operations" changes the meaning of a call in the planner IR (ADR 195) without saying so.
Why it matters: MongoDB would neither populate nor consume it; the `unknown` parameter exists so the framework type can stay agnostic, which is the dressing the smell list names.
Suggestion: declare `toOps(lowerer)` on each target's call base class (default `[this.toOp(lowerer)]`), and have `renderOps` narrow to that base. If one call lowering to several operations should be a framework concept, state it in ADR 195 and type the lowerer properly for both methods.

**S08 — The framework `Migration` base gains a reset protocol to make a stateful `operations` getter re-readable.** Consider.
Location: `packages/1-framework/3-tooling/migration/src/migration-base.ts` lines 135-147 and 281; `packages/2-sql/9-family/src/core/sql-migration.ts` line 46; `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` lines 389-487.
Issue: the facade's rename methods record calls in `#renames` while `operations` is evaluated, so every reader must call `resetAuthoringState` first. The framework adds a mechanism-named protected hook plus a static method whose only job is to call it from outside. A reader that forgets, such as a user's own test reading `operations` twice, gets `TABLE_RENAME_UNMATCHED` on the second read.
Why it matters: `operations` reads like a pure property; the rule that makes it safe lives in two call sites.
Suggestion: give the base one static read path, for example `Migration.readOperations(migration)`, that resets and reads, use it in `buildMigrationArtifacts` and `providedInvariants`, and make that the only documented way to read operations. Name the hook for what it protects (for example `beginOperationsRead`).

**S09 — `fromContract` now carries two meanings, and the aggregate strategy hides one of them with a Proxy.** Should fix.
Location: `packages/1-framework/3-tooling/migration/src/aggregate/strategies/plan-from-diff.ts` lines 119-131; `packages/2-sql/9-family/src/core/migrations/types.ts` lines 330-336; `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` line 459; `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts` line 239.
Issue: planners use `fromContract` both as the plan's origin identity (`describe().from`, hence `origin`, which the runner checks against the marker) and as context for planning (statements, field events). `db update` needs the second without the first, so `planFromDiff` returns `origin: null` through the Proxy while `describe().from` still returns the hash. The deferred `onFieldEvent` item is a symptom of the same coupling.
Why it matters: two views of one plan now disagree, and the next input that needs the origin contract for planning will need another Proxy branch.
Suggestion: split the planner input into the origin the plan asserts (`origin: { storageHash } | null`, chosen by the caller) and the contract the planner may read (`fromContract`). `migration plan` passes both; `db update` passes `origin: null` with a contract. Remove the Proxy branch.

**S10 — Statements given to the aggregate planner are dropped silently when the app space walks its graph.** Consider.
Location: `packages/1-framework/3-tooling/migration/src/aggregate/planner.ts` lines 71-84; `packages/1-framework/3-tooling/migration/src/aggregate/planner-types.ts` lines 89-101.
Issue: `appSpace` is only read inside the `ignoreGraph` branch. A caller that passes statements without putting the app space in `callerPolicy.ignoreGraphFor` gets a plan that ignores them. Only `db-run.ts` calls `planMigration` today, and it sets both, so this is latent.
Why it matters: decision 4 says no statement is ignored; the type allows it.
Suggestion: return a `PlannerError` when `appSpace.statements` is non-empty and the app space is planned from its recorded path, and add a test.

**S11 — Two validators decide whether one rename is valid.** Should fix.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 310-330 and 391-414; `packages/2-sql/9-family/src/core/migrations/resolve-table-rename.ts` lines 58-103; `packages/2-sql/9-family/src/core/migrations/resolve-column-rename.ts` lines 71-127; `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` lines 404-412.
Issue: the facade checks a rename with `resolveTableRenameAgainst` / `resolveColumnRenameAgainst`. The statement planner re-implements the same checks (old name present, new name free, column case collisions) against `SchemaTables` with its own messages.
Why it matters: requirement 7 says a planned file is one the user could have written. With two rule sets, a statement can plan a call that the facade refuses when `migration.ts` is re-run, or the reverse, and only the success path is tested for agreement.
Suggestion: have `StatementPlanner` call the family's `resolve…RenameAgainst` functions on the target's `SchemaTables` and turn a failure into a `statementRejected` conflict, keeping its own wording in `summary` if needed.

**S12 — The family hand-renders a target's facade call, and decides the target by the namespace sentinel.** Should fix.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 365-380 (the message at line 376); compare `packages/2-sql/9-family/src/core/migrations/table-name-case-guard.ts` lines 79 and 103 and `renameTableCall` in both target planners; `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` line 422; `packages/3-targets/3-targets/postgres/src/core/migrations/table-rename-calls.ts` lines 23-30.
Issue: the field-statement refusal writes `...this.renameTable({ schema: "…", table: "…", to: "…" })` in the family, choosing whether to print `schema:` by testing `UNBOUND_NAMESPACE_ID`, which in practice means "is this SQLite". The table-name case guard already receives this rendering from the target through `renameTableCall`, and `RenameTableCall.renderTypeScript` is the target's own rendering. The two renderings also disagree: the family prints the namespace id, while `RenameTableCall` prints `emissionSchemaForNamespace`, the DDL schema name. The facade then reads `schema` as a namespace id. Which one is right for a namespace whose DDL schema name differs from its id should be checked by the code reviewer.
Why it matters: target syntax and a target branch have moved into the family, and two places now define what `schema:` means in a rename call.
Suggestion: add `renderTableRename(rename)` to `StatementPlanningTarget` (or reuse `renameCall(rename).renderTypeScript()`), use it in the message, and add a test with a namespace whose DDL schema name differs from its id.

**S13 — Two members of `StatementPlanningTarget` are implemented identically by every target, and one is misnamed.** Consider.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 138-151; `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` lines 733-737; `packages/3-targets/3-targets/sqlite/src/core/migrations/planner.ts` lines 285-289.
Issue: `operationCount: 1 + call.companions.length` and `operationClasses: [call.operationClass, ...companions]` are the same on both targets: they are properties of the call, not target behaviour. `renameCall` builds a table rename beside `renameColumnCall`.
Why it matters: the interface charges every future target for code it cannot vary, and the asymmetric names hide which call each builds.
Suggestion: constrain `TCall extends { readonly operationClass: MigrationOperationClass; readonly companions: readonly { readonly operationClass: MigrationOperationClass }[] }` and compute both in the family; rename `renameCall` to `renameTableCall`.

**S14 — `renames` and the `Resolved` prefix each mean two things.** Consider.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 153-158 and 222-223; `packages/2-sql/9-family/src/core/migrations/field-event-planner.ts` lines 52-61; `packages/2-sql/9-family/src/core/migrations/resolve-table-rename.ts` lines 21-26; `packages/2-sql/9-family/src/core/migrations/resolve-column-rename.ts` lines 22-28; `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` lines 372 and 510.
Issue: `renames` holds table renames on `PlannedStatements` and `PlanFieldEventOperationsOptions` beside `columnRenames`, while on the CLI option types it holds raw `--rename` texts. `ResolvedTableRename` means "a table rename whose namespace was found in the schema", but in the statement path it is built directly from a storage effect and never resolved; beside `ResolvedModelRename` it reads as the next step of the same resolution. `RenameTableCompanionCall` and `RenameColumnCompanionCall` are the same union.
Why it matters: a reader carries two meanings for each name across one slice.
Suggestion: `renames` → `tableRenames` in the family; name the family types for what they are (`TableRename` with a required `namespaceId`, and `TableRenameRequest` for the facade input whose namespace may be missing; same for columns); one `RenameCompanionCall` type.

**S15 — The meaning of `widening` and `destructive` changed, and the definitions did not.** Should fix.
Location: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 70-77; `docs/architecture docs/subsystems/7. Migration System.md` § Statements.
Issue: the framework still defines `widening` as "relaxes constraints or expands types" and `destructive` as "removes or alters existing structures". The slice now classes dropping an index, a default or a native enum type, renames, and disabling row-level security as `widening`, under the project rule that "destructive" means "loses data". That rule is stated only in ADR 243 and 244 notes and the upgrade fragment. `widening` now also admits changes that widen data access (dropping a policy, disabling row-level security) without consent in `db update`.
Why it matters: a fresh reader of the class names will classify the next operation by the old definitions, and the access-widening consequence is a decision readers should see stated.
Suggestion: rewrite the doc comment to define each class by data loss, list what `widening` now covers including the access-widening drops, and state the rule once in the Migration System doc, linked from the ADR notes.

**S16 — The `@hint` sweep missed four places.** Should fix.
Location: `docs/architecture docs/adrs/ADR 264 - A model names its storage verbatim, and a rename is an operation.md` line 80; `docs/architecture docs/subsystems/9. No-Emit Workflow.md` line 120; `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` lines 700-701; `skills/journey-tests/02b-rename-with-hint.md` (file name).
Issue: ADR 264 still calls a contract-source hint "the intended direction" recorded in documents this branch has just amended. The No-Emit doc says edges store planner hints. A user-facing error says "rename inference … may additionally need a hint in the planned migration". The journey file title says "with a statement", its name says "with-hint".
Why it matters: one name per concept, and the error text contradicts requirement 1 (nothing is inferred).
Suggestion: add an update note to the ADR 264 hint bullet (it is now not the direction), fix the No-Emit line, reword the error to point at statements and hand-written migrations, and rename the journey file (updating links).

**S17 — `db init` carries statement fields it can never use.** Consider.
Location: `packages/1-framework/3-tooling/cli/src/control-api/types.ts` lines 412-413; `packages/1-framework/3-tooling/cli/src/control-api/operations/db-run.ts` lines 103-104; `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` line 89; `packages/1-framework/3-tooling/cli/src/orm/db/init.ts` line 66.
Issue: `DbInitSuccess.appliedStatements` is required and `db init --json` now prints `appliedStatements: []`, because `db init` and `db update` share one result builder and one options type, not because `db init` applies statements. `ExecuteRunOptions.renames` accepts statements for `action: 'dbInit'`.
Why it matters: a public JSON field that can only ever be empty, and a type that allows what the spec forbids.
Suggestion: put the statement input and output on the `db update` types only (or make `renames` part of a `dbUpdate`-only branch of `ExecuteRunOptions`).

**S18 — The family reads its own storage bridge without its own type, and the effect unions mix effects with failures.** Consider.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` lines 27-45 and 68-94; `packages/2-sql/1-core/contract/src/types.ts` lines 70-80.
Issue: `modelTable` and `fieldColumn` probe `storage['table']`, `storage['namespaceId']` and `getOwnPropertyDescriptor(field, 'column')` although `SqlModelStorage` names exactly that shape. `noTable` and `columnOnOneSide` sit in the effect unions beside `renameTable` and `renameColumn`, but they are reasons no effect could be worked out.
Why it matters: the bridge's shape is defined twice in the family, and the union name promises effects.
Suggestion: read through one typed accessor that returns `SqlModelStorage | undefined` (validated once), and return `Result<ModelStorageEffect, Refusal>` so the effect union holds only effects.

## Deferred findings

**S19 — MongoDB still classes non-data drops as `destructive`.** Defer to slice 4, but record it now.
Location: `packages/3-mongo-target/1-mongo-target/src/core/migrations/op-factory-call.ts` lines 113-115; `packages/3-mongo-target/1-mongo-target/src/core/migrations/migration-factories.ts` line 182.
Issue: requirement 10 says index drops are `widening` on every target; this slice did Postgres and SQLite only (as its spec says), and neither `deferred.md` nor slice 4's outcome in `plan.md` mentions Mongo. Until it lands, `destructive` means different things per family.
Why deferred: changing Mongo classification belongs with the Mongo slice. Why it matters now: slice 2's refusal must not refuse a Mongo index drop, which no statement can resolve because an index is not a model or field.
Suggestion: add it to `deferred.md` and to slice 4's outcome, and make slice 2's refusal either cover Mongo with this fixed or exclude Mongo explicitly.

## The deliberately deferred items in `deferred.md`

- **`@@map`-only rename.** Correctly deferred, and correctly flagged as a decision before slice 2 writes refusal text. Of the options listed, "a storage-level statement" would break decision 5 (no storage names on the command line); `--rename User:User` keeps to domain coordinates.
- **Model move across namespaces.** Correctly deferred to slice 3.
- **`onFieldEvent` under `db update`.** Correctly deferred as a behaviour question, but it is a symptom of S09, which is in scope.
- **Which field name a MongoDB statement uses.** The Mongo mapping belongs in slice 4. The meaning of `FieldCoordinate.field` is a framework decision this slice makes, so it should be written down now (S06); otherwise slice 4 decides it by changing the resolver's behaviour for every family.

## Verdict

Concerns, not a redesign. The structure is sound: the framework stays family-blind (vocabulary lint unchanged at 254), statements are a required input on every planner, the family-to-target boundary is drawn where the family owns statement meaning and the targets own SQL, and the tests prove the important properties for the success path on both targets. What should change before slice 2 builds on it are names and placements that later slices and released JSON would otherwise fix in place: the word "statement" beside SQL statements (S01), the conflict field and kind (S02), per-family descriptions (S03), the rename-only `operationCount` (S04), the rename-keyed entry point (S05), and the coordinate shape (S06). Separately, three placements cross a boundary the wrong way and are cheap to fix now: the `unknown`-typed `toOps` on the framework interface (S07), the Proxy that hides a second meaning of `fromContract` (S09), and the family rendering target syntax with two validators for one rename (S11, S12). The doc and definition fixes (S15, S16) are small and should ship with this slice.

## Round B verification

**Range:** `git diff 098161ba64..e321f7862c -- packages docs skills upgrade-instructions test` (21 commits). File contents were read at `e321f7862c`. `node scripts/lint-framework-vocabulary.mjs` still reports `count=254 threshold=254`, so the framework stays family-blind.

### Per finding

- **S01 — closed.** The types are now `ResolvedMigrationStatement`, `AppliedMigrationStatement`, `ResolvedModelRenameStatement` and `ResolvedFieldRenameStatement`, matching the module name. The planner option is still called `statements`, and the JSON field is still `appliedStatements` beside `preview.statements`, but the option's type now says which kind of statement it holds. Acceptable.
- **S02 — closed.** The field is now `refusedStatement` and the kind `statementRefused`. The framework doc says consumers key on the field, not the kind. The `SqlPlannerConflict` redeclaration is gone, and `CliErrorConflict` follows the rename.
- **S03 — closed.** There is one `describeMigrationStatement` in the framework, used by the SQL family, by Mongo and by the CLI's `reportAppliedStatements`. The planner result no longer carries `description`; the CLI adds it in `AppliedStatementReport`.
- **S04 — closed, with a residual (see R1).** `AppliedMigrationStatement.operationIds` replaces the count. For slice 2, the ids of a delete statement can list the drop it permits. The "produced" or "permitted" relation is not stated, but nothing in slice 2 needs it yet.
- **S05 — closed, with one step left for slice 2.** One ordered `StatementText { verb, text }` list now runs from the command through the control API to the resolver, and error titles render `--${verb}`. The spec records the order rule across flags. `StatementVerb = 'rename'` will make the compiler point at `parseRenameStatement` when `'delete'` joins. The missing-origin check still fails the whole input before any statement is looked at (`resolve-statements.ts` lines 572-575). Slice 2 must move it inside the loop so a `--delete` resolves without an origin (decision 8). That is a local change, not a reshape.
- **S06 — closed.** The coordinates now use `namespaceId`, and each is documented as using domain names. The union's doc says another kind of entity is a further member with its own coordinate type, which leaves room for slice 3. "On the command line" is gone. See R3 on the Mongo sentence in `FieldCoordinate`'s doc.
- **S07 — closed.** `toOps` is gone from the framework `OpFactoryCall`. It lives on `PostgresOpFactoryCallNode` and the SQLite call base. `renderOps` narrows with `isPostgresOpFactoryCall` (and the SQLite equivalent) before calling it.
- **S08 — closed, one nit.** `Migration.readOperations` and the `beginOperationsRead` hook replace the static backdoor, and `buildMigrationArtifacts` uses `readOperations`. `SqlMigration.providedInvariants` (`packages/2-sql/9-family/src/core/sql-migration.ts` lines 45-50) still calls the hook and then reads `this.operations` itself. Behaviour is the same, but it is a second read path beside a method documented as "read them only through this". Use `Migration.readOperations(this)` there.
- **S09 — closed.** Planner options now take `origin: PlanOrigin | null` separately from `fromContract`. `migration plan` passes `planOriginOf(fromContract)`, `planFromDiff` passes `null`, and the Proxy's `origin` branch is gone. A test pins that a planner asserts only the origin it is given. See R2 on the new type.
- **S10 — closed.** `planMigration` returns `policyConflict` when it gets statements but the app space is not in `ignoreGraphFor`. A test covers it.
- **S11 — closed.** `checkTableRename` and `checkColumnRename` now return structured mismatches, and both the facade (through `resolve…RenameAgainst`) and the statement planner use them. Each path keeps its own wording.
- **S12 — closed.** The family asks the target to render the hand-written call (`StatementPlanningTarget.renderTableRename`, wired to `renderRenameTableCall` on both targets), and the `UNBOUND_NAMESPACE_ID` branch is gone from the family. A namespace whose database schema name differs from its id cannot be written in today's contract (`ddlSchemaName` returns `this.id`), so that case cannot be tested and is not a gap now.
- **S13 — closed.** `TCall extends StatementCall` carries `operationClass`, `operationId` and `companions`, so the family computes classes and ids itself. `renameCall` is now `renameTableCall`. See R4 on the name `StatementCall`.
- **S14 — closed.** The family field is now `tableRenames` (beside `columnRenames`). `TableRename` has a required namespace and `TableRenameRequest` an optional one. That distinction is concrete, single and structural, so the names fit. There is one `RenameCompanionCall` type per target, and the `Resolved*` prefix now belongs only to statements.
- **S15 — closed.** The `MigrationOperationClass` doc and Migration System § operation classes (line 423) define the classes by what happens to the data, list the drops that lose no data, and state that dropping a policy or disabling row-level security widens who can read and write rows.
- **S16 — closed.** ADR 264's hint bullet has an update note saying a contract-source hint is no longer the direction. The No-Emit line, the `PATH_UNREACHABLE` error text and the journey file name (now `02b-rename-with-statement.md`) are fixed. ADR 001 and ADR 028 still list `hints` in their edge field lists, but each has the update note at the top. Fine.
- **S17 — closed.** `ExecuteRunOptions` is a union keyed by `action`, and only `dbUpdate` carries `statements`. `DbInitSuccess` no longer has `appliedStatements`.
- **S18 — closed.** `isSqlModelStorage` narrows to `SqlModelStorage`. The effect unions hold only effects, and `NoTable` and `ColumnOnOneSide` come back as the failure side of a `Result`.
- **S19 — deferred, recorded.** `deferred.md` § "MongoDB still classes index drops as destructive" names slice 2 and slice 4.

### New items from round B

**R1 — Operation ids are now used to point at operations, but Postgres rename ids do not name the schema.** Should fix before slice 2 keys its refusal on ids.
Location: `packages/3-targets/3-targets/postgres/src/core/migrations/operations/tables.ts` lines 31-33 (`renameTable.${fromName}`), `operations/columns.ts` lines 68-70 (`renameColumn.${tableName}.${fromName}`), and `dropTable.${tableName}` (line 17); `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts` (`operationIds`).
Issue: `AppliedMigrationStatement.operationIds` assumes an id names exactly one operation in a plan. On Postgres, renaming tables with the same name in two namespaces in one plan, or dropping one and renaming the other, gives two operations the same id. Slice 2's refusal will look up destructive operations the same way.
Suggestion: either add the schema to the rename and drop ids (this changes `ops.json` ids, so update the fixtures in the same change), or point at operations by their position in the plan. Whichever is chosen, state the uniqueness rule where `MigrationPlanOperation.id` is defined.

**R2 — `PlanOrigin` is a third shape for the plan's origin.** Consider.
Location: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` lines 84-94 (`PlanOrigin`, `planOriginOf`) and lines 214-221 (`MigrationPlan.origin`, an inline `{ storageHash; profileHash? }`); `packages/1-framework/3-tooling/migration/src/migration-base.ts` (`get origin(): { storageHash } | null`).
Issue: the concept now has a name, but `MigrationPlan.origin`, which the runner reads, still uses its own inline type with `profileHash`, and the `Migration` getter uses a third. A reader cannot tell whether `PlanOrigin` is the plan's origin or only the planner's input.
Suggestion: type `MigrationPlan.origin` and `Migration.origin` as `PlanOrigin | null`, and give `PlanOrigin` an optional `profileHash`.

**R3 — Framework doc comments now describe MongoDB's current behaviour.** Consider.
Location: `control-migration-types.ts` (the `MigrationOperationClass` doc: "MongoDB still classes dropping an index as 'destructive'"; the `refusedStatement` doc naming the SQL and MongoDB planners); `migration-statements.ts` (`FieldCoordinate`: "A MongoDB contract keys a model's fields by their stored names, so there it is the stored field name").
Issue: the vocabulary rule allows comments, so this is not a lint matter. But a framework definition now carries one family's temporary state. The `FieldCoordinate` sentence makes the coordinate mean different things per family, which is the question `deferred.md` leaves open for slice 4.
Suggestion: keep the Mongo index sentence in the Mongo package and `deferred.md`, not in the framework definition. In `FieldCoordinate`, say that slice 4 decides the Mongo case, instead of describing today's behaviour as the meaning.

**R4 — `StatementCall` names who uses the type, not what it is.** Consider.
Location: `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` (`StatementOperationCall`, `StatementCall`).
Issue: `RenameTableCall` and `RenameColumnCall` satisfy `StatementCall` because they lower to one operation followed by companion operations. The hand-written facade uses them the same way, with no statement involved.
Suggestion: name the type for its shape, for example `CallWithCompanions` (and `SingleOperationCall` for the companion element).

Names checked and found fine: `planOriginOf` (apart from R2), `TableRenameRequest` versus `TableRename`, `beginOperationsRead`, `readOperations`, `describeMigrationStatement`, `StatementText`, `StatementVerb`, `AppliedStatementReport`, `RenameCompanionCall`.

### Round B verdict

Satisfied, with one item to fix before slice 2. All eighteen in-scope findings are closed; S04, S05 and S08 have small residuals that are noted, not reopened. The framework is still family-blind (254/254). The statement entry point is now an ordered list keyed by verb. Slice 2's `--delete` and the interactive prompt can join it without changing any type: the prompt's answers are more `StatementText` entries, refused statements travel as `refusedStatement`, and a statement's operations are referenced by id. Slice 2 must move the missing-origin check inside the loop (S05), and the ids must become unique within a plan before the refusal relies on them (R1). R2, R3 and R4 are naming tidy-ups.
