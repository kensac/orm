---
changes:
  - id: destructive-means-data-loss
    summary: |
      An operation is `destructive` only when it can lose rows or values. Postgres `setNotNull` and the type changes that keep every value (`int2` to `int4` to `int8`, `float4` to `float8`), a SQLite table rebuild that only changes nullability, and MongoDB `dropIndex`, `setValidation`, `collMod` and the planner's validator and change-stream image changes are now `widening`. Running an existing `migration.ts` again writes `widening` for these operations in `ops.json`, and a new `migrationHash`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetNotNull\('
        - '(?<![\w$.])(?:dropIndex|setValidation|collMod)\('
---

# `destructive` means data loss

## `destructive-means-data-loss`

The planner and the migration factories now class an operation as `destructive` only when it can lose rows or values. An operation that fails rather than losing a value is `widening`: `SET NOT NULL` fails on a NULL, and a MongoDB validator applies only to later writes. `prisma migration show` marks fewer operations with ⚠, `prisma migration plan` and `prisma db update` print the data-loss warning less often, and `prisma db update` asks for consent less often.

A migration that is already applied needs nothing: `prisma db migrate` applies its `ops.json` as written, and the database ledger records the migration by its hash.

For each migration package that no database has applied yet and whose `migration.ts` calls `setNotNull` (Postgres), or `dropIndex`, `setValidation` or `collMod` without an `operationClass` (MongoDB), run its `migration.ts` again (`node migration.ts`) so that `ops.json` records the new class. This rewrites `ops.json` and the `migrationHash` in `migration.json`. Do not run it again for a package a database has applied: its new hash would no longer match the hash the database's ledger recorded for it.
