---
changes:
  - id: planner-success-data-loss
    summary: |
      A migration planner's success result gains required `dataLoss` and `accessWidening` lists of `MigrationOperationSubject` (from `@prisma/orm-framework/components/control`): the operations that lose data, and those that widen who can read or write rows, each by position with its subject. A planner, or a test double of one, that returns `{ kind: 'success', ... }` adds both, empty when it plans neither.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?<![\w$])MigrationPlanner(?:Result|SuccessResult)?(?![\w$]))(?![\s\S]*(?<![\w$])dataLoss(?![\w$]))[\s\S]*kind:\s*["'']success["'']'
  - id: sql-planner-success-subjects
    summary: |
      In `@prisma/orm-family-sql/family/control`, `plannerSuccess(plan, appliedStatements, warnings?)` becomes `plannerSuccess(plan, appliedStatements, subjects, warnings?)`, where `subjects` is `{ dataLoss, accessWidening }`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])plannerSuccess\s*\('
  - id: per-space-plan-subjects
    summary: |
      A `PerSpacePlan` from `@prisma/orm-toolchain/migration-tools/aggregate` carries required `dataLoss` and `accessWidening` lists, empty for a space applied from recorded migrations.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'strategy:\s*["''](?:plan-from-diff|resolve-recorded-path|declared-state)["'']'
  - id: family-instance-storage-name-of
    summary: |
      `ControlFamilyInstance` from `@prisma/orm-framework/components/control` requires `storageNameOf(operation)`: the name the database knows the object an operation is about by. A family instance, or a test double of one, implements it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:Sql|Mongo)?ControlFamilyInstance(?![\w$])'
  - id: operation-classes-and-calls
    summary: |
      Postgres `setNotNull`, MongoDB `dropIndex`, `setValidation` and `collMod`, and the matching op-factory calls are now `widening`. `AlterColumnTypeCall` (`@prisma/orm-target-postgres/target/op-factory-call`) takes an optional `operationClass`, and SQLite's `RecreateTableCall` (`@prisma/orm-target-sqlite/target/op-factory-call`) an optional `lossyColumns`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:AlterColumnTypeCall|RecreateTableCall)(?![\w$])'
        - '(?<![\w$.])(?:dropIndex|setValidation|collMod)\('
        - '\bsetNotNull\('
  - id: control-client-db-update-answer-questions
    summary: |
      The control client's `dbUpdate(options)` requires an `answerQuestions` callback, which answers every question about an operation that would lose data or widen access, in order, or throws to refuse.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])answerQuestions(?![\w$]))[\s\S]*\.dbUpdate\s*\('
---

# Planners say what each plan loses and whose access it widens

## `planner-success-data-loss`

`MigrationPlannerSuccessResult` gains:

- `dataLoss: readonly MigrationOperationSubject[]`: one entry per operation, in plan order, that can lose rows or values (dropping a table, a column or a collection, or a type change that can change values).
- `accessWidening: readonly MigrationOperationSubject[]`: one entry per operation that widens who can read or write rows, such as dropping a row-level-security policy or disabling row-level security.

A `MigrationOperationSubject` is `{ operationIndex, subject }`: the operation's position in the plan's `operations`, and a `MigrationStatementSubject`, which is `{ kind: 'model', namespaceId, model }` or `{ kind: 'field', namespaceId, model, field }` when the operation is about a model or field of `fromContract`, else `{ kind: 'storage', name }` with the name the database knows it by. The CLI turns each entry into a question the user answers with `--delete`, `--rename` or `--allow` before anything is written or applied, so a planner must list every operation of these kinds; an operation it leaves out is applied without asking.

`MigrationStatementSubject`, `MigrationOperationSubject`, `MigrationStatementSubjectJson`, `migrationStatementSubjectJson` and `DeleteMigrationStatement` are imported from `@prisma/orm-framework/components/control`, and `describeMigrationStatement` also accepts a `DeleteMigrationStatement`. In a planner or a test double that returns `{ kind: 'success', plan, appliedStatements }`, add `dataLoss: []` and `accessWidening: []` when it plans no such operation.

Detection finds files that name `MigrationPlanner`, `MigrationPlannerResult` or `MigrationPlannerSuccessResult` and return `kind: 'success'` without `dataLoss` anywhere in the file. Check by hand a file that mentions `dataLoss` once, and a success result typed through a family type such as `SqlPlannerSuccessResult`.

## `sql-planner-success-subjects`

Change `plannerSuccess(plan, appliedStatements)` to `plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [] })`, and `plannerSuccess(plan, appliedStatements, warnings)` to `plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [] }, warnings)`, when the planner plans no operation that loses data or widens access. A SQL planner that does computes the lists with `planSubjects(calls, context)` from the same module, which takes what each call loses and widens (`CallSubjects`, as the Postgres and SQLite planners build them) and names each subject through the origin contract; `planFieldEventCalls(...)` returns the calls of the codec field-event hooks with the column each was returned for (`FieldEventCall`), so their subjects can be named too.

## `per-space-plan-subjects`

Add `dataLoss: []` and `accessWidening: []` to each `PerSpacePlan` object a test builds by hand. The aggregate planner fills them from the planner's result for a space it plans from a diff.

## `family-instance-storage-name-of`

A `ControlFamilyInstance` implementation adds `storageNameOf(operation: MigrationPlanOperation): string`. The CLI calls it to name what a destructive operation of a recorded migration is about, since no planner mapped it to a model. A SQL family returns the name from the operation's target details, `schema.table.column` for a column and `schema.name` for anything else; `storageNameOfOperation` from `@prisma/orm-family-sql/family/control` does that. A test double returns any stable name.

## `operation-classes-and-calls`

An operation is `destructive` only when it can lose rows or values. Postgres `setNotNull`, and MongoDB `dropIndex`, `setValidation` and `collMod` (with no `operationClass` given), are now `widening`, and so are the op-factory calls a planner builds for them. A planner or test that asserts `operationClass: 'destructive'` for them asserts `'widening'`.

`AlterColumnTypeCall` takes an optional last constructor argument, `operationClass: 'widening' | 'destructive'`, default `'destructive'`; pass `'widening'` only when every value of the old type converts to the new type unchanged. `RecreateTableCall` takes an optional second constructor argument, `lossyColumns`: the columns whose values the copy can change because their type changes. A planner that builds a recreate for a type change passes them, so `dataLoss` names those fields; they never reach the operation or `migration.ts`.

## `control-client-db-update-answer-questions`

In code and documentation that call the control client's `dbUpdate({ ... })` without `answerQuestions`, add a callback. Detection finds files that call `dbUpdate(` and never mention `answerQuestions`; a file with one call that has it and another that lacks it is skipped, so check it by hand. One that refuses every data loss and access widening, as `dbUpdate` used to without consent:

```typescript
await control.dbUpdate({
  migrations: { dir: 'migrations/app' },
  answerQuestions: async (questions) => {
    if (questions.length > 0) throw new Error('db update would lose data or widen access');
    return [];
  },
});
```

The callback is called at least once per apply, with an empty list when nothing is in question; return `[]` then. To consent, return one `{ verb, text }` per question, in order: a verb from `question.verbs` and `question.subject` as the text.
