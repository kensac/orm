---
changes:
  - id: planner-plan-statements
    summary: |
      Every call to a migration planner's `plan(...)` passes a new required `statements` list; pass `statements: []` when the call states no renames.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])statements\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]'
  - id: planner-success-applied-statements
    summary: |
      A migration planner's success result gains a required `appliedStatements` list; a planner, or a test double of one, that returns `{ kind: 'success', plan }` adds `appliedStatements`, empty when it applied no statements.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?<![\w$])MigrationPlanner(?:Result|SuccessResult)?(?![\w$]))(?![\s\S]*(?<![\w$])appliedStatements(?![\w$]))[\s\S]*kind:\s*["'']success["'']'
  - id: sql-planner-helpers
    summary: |
      In `@prisma/orm-family-sql/family/control`, `plannerSuccess(plan, warnings?)` becomes `plannerSuccess(plan, appliedStatements, warnings?)`, `planFieldEventOperations(...)` takes required `renames` and `columnRenames` lists, and the conflict kind union gains `'statementRejected'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])plannerSuccess\s*\('
        - '(?<![\w$])planFieldEventOperations\s*\('
        - '(?<![\w$])SqlPlannerConflictKind(?![\w$])'
  - id: aggregate-planner-app-space
    summary: |
      The aggregate planner's `planMigration(...)` input takes a required `appSpace: { fromContract, statements }`, and a `PerSpacePlan` carries a required `appliedStatements` list.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])planMigration\s*\('
        - 'strategy:\s*["''](?:plan-from-diff|resolve-recorded-path|declared-state)["'']'
---

# Migration planners take statements and report the statements they applied

## `planner-plan-statements`

The options of `MigrationPlanner.plan` (from `@prisma/orm-framework/components/control`), of the SQL family's `SqlMigrationPlannerPlanOptions`, of the Postgres and SQLite planners, and of `MongoMigrationPlanner` (from `@prisma/orm-target-mongo/target/control`) gain a required `statements: readonly ResolvedMigrationStatement[]`: the `--rename` statements the user gave, resolved into namespace, model and field names. For each `plan({ ... })` call, add `statements: []` beside `fromContract`. A planner that forwards its options to another planner forwards `statements` too. Detection finds the calls that write their options inline in `plan({ ... })`; a call that builds its options object elsewhere and passes it in, such as `plan(options)`, is not detected, so check those calls by hand. `MongoMigrationPlanner` refuses a non-empty `statements` with a `statementRejected` conflict in this release.

## `planner-success-applied-statements`

`MigrationPlannerSuccessResult` gains a required `appliedStatements: readonly AppliedMigrationStatement[]`, one entry per statement the plan applied, in order. In a planner implementation, or a test double of one, that returns `{ kind: 'success', plan, ... }`, add `appliedStatements: []` when the planner applies no statements. `MigrationPlannerConflict` also gains an optional `statement`, set on a conflict that refuses a statement; nothing needs to set it.

## `sql-planner-helpers`

- Change `plannerSuccess(plan)` to `plannerSuccess(plan, [])`, and `plannerSuccess(plan, warnings)` to `plannerSuccess(plan, [], warnings)`.
- Add `renames: []` and `columnRenames: []` to the options of each `planFieldEventOperations({ ... })` call.
- An exhaustive `switch` over `SqlPlannerConflictKind` gains a `case 'statementRejected':`.

## `aggregate-planner-app-space`

Add `appSpace: { fromContract: null, statements: [] }` to each `planMigration({ ... })` input, and `appliedStatements: []` to each `PerSpacePlan` object a test builds by hand.
