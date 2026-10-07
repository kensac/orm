# Slice 1: storage without a domain counterpart

_Parent project: `projects/unexposed-storage/`. Linear: TML-3468. Outcome: a contract can carry a table, a column or a foreign key that no model, field or relation exposes; the builder can produce that shape; the ORM never selects, writes or types such a column; the emitted `contract.d.ts` omits unexposed tables from the ORM-facing types; strict verify treats unexposed storage as declared. Proven with a TypeScript-authored contract._

## At a glance

```ts
// Lowering-level flags on the contract definition nodes; the fluent builder has no option yet
buildSqlContractFromDefinition({
  models: [
    { modelName: 'User', tableName: 'user', fields: [
        column('id', 'id', int4Column), column('email', 'email', textColumn),
        column('legacyKey', 'legacy_key', textColumn, { nullable: true, unexposed: true }) ] },
    { modelName: 'PrismaMigration', tableName: '_prisma_migrations', unexposed: true, fields: [ ... ] },
  ],
  ...
});
```

- `contract.json`: `storage.namespaces.public.tables.User.columns.legacyKey` exists; `domain.models.User.fields` has no `legacyKey`. `storage.namespaces.public.tables._prisma_migrations` exists; `domain.models` has no model for it.
- `db.orm.public.User.all()` returns rows with `id` and `email` only, and the row type has no `legacyKey`.
- `db.orm.public._prisma_migrations` does not exist, in code or in types.
- `db verify --strict` on a database that has both reports `unclaimed: []`.
- `migration plan` from a contract without `legacyKey` to one with it (unexposed) plans `ADD COLUMN`; from exposed to unexposed with the same storage plans nothing, and the storage hash is unchanged.

## Chosen design

- **Absence of a mapping domain object is the signal.** No new field on `StorageTable`, `StorageColumn` or the foreign-key entry. `validateModelStorageReferences` (`packages/2-sql/1-core/contract/src/validators.ts` ~678-734) already checks field → column only; confirm no validator requires the reverse, and add a test that a contract with an unmapped column and an unmodelled table validates.
- **Builder.** `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` (~1213-1330 for models, ~1630-1640 for fields) gains an internal path that emits a storage column with no domain field, and a storage table with no domain model or root. Expose it through the TS authoring surface as a minimal internal option that the Prisma 7 source (slice 2) and `contract-psl` (slice 3) can target; no user-facing public API is added or documented in this slice.
- **ORM projection** (`packages/3-extensions/sql-orm-client/src/`): `query-plan-meta.ts` (~18-35) and `query-plan-select.ts` (~94-113) project every storage column when no `select` is given; `query-plan-mutations.ts` (~32-49) does the same for `RETURNING`; `collection-runtime.ts` `mapColumnNames` passes unmapped columns through under their column name (unchanged: once nothing selects them, nothing reaches it). The projection sites, including `query-plan-source.ts` for MTI joins, project only the columns a model's fields map plus the columns inheritance requires (variant key columns, discriminator). Exposure is per model, derived with the ORM's polymorphism information, not per table. Writes never include an unmapped column, so its database default applies. Covers single-table and multi-table inheritance, `include`, `create`/`update`/`delete` with `RETURNING`. Every place that resolves a user-supplied field name to a column refuses a name that is not a field of the model, so the rule holds at runtime for untyped callers too.
- **Emitter** (`packages/2-sql/3-tooling/emitter/src/index.ts`): the ORM-facing types in `contract.d.ts` omit unmodelled tables; the storage section keeps them (the project's open question; the default is kept in this slice: storage types still list them, ORM model types do not).
- **Verify.** Strict verify today collects extra top-level entities not declared by any space (`packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts` ~200-221, `declaresEntity`). An unmodelled storage table is declared, so it must not be unclaimed. Confirm by test; fix `declaresEntity` if it consults the domain.
- **Hash.** `storage.storageHash` covers storage only (`hashing.ts` ~82-86); add a test that exposing or unexposing a column leaves it unchanged.
- **Mongo** is out of scope. The SQL family only.

## Scope

In: the builder path, the ORM projection rule, the emitter types, verify, validators, and tests. One TS-authored fixture contract under `test/integration/test/sql-orm-client/fixtures/` or the sql-orm-client package's own fixtures.

Out: any PSL surface (slice 3); the Prisma 7 source (slice 2); `contract print` and `contract infer` (slice 3); Mongo.

## Tests (first; red before green)

- Validator: a contract with an unmapped storage column and an unmodelled table validates; a field mapping a missing column still fails.
- Builder: the internal option emits the shape above; `storageHash` equal between exposed and unexposed variants of the same storage.
- Inheritance with an unexposed column has no TS-built fixture (definition nodes carry no inheritance), and the PSL polymorphism fixture cannot mark a column unexposed until slice 3. This slice pins inheritance projection on the PSL fixture (variant key columns, discriminator, variant with no own fields); slice 3 adds the unexposed-column inheritance leak test.
- ORM leak test (red first): with the fixture contract on PGlite, insert a row through raw SQL that sets `legacyKey`; `findMany()` with no `select` returns no `legacyKey`; `create()` returns no `legacyKey` and leaves its default; `include` and inheritance paths likewise; `expectTypeOf` the row type has no `legacyKey` and `db.orm.public` has no `_prisma_migrations`.
- Emitter: `contract.d.ts` snapshot for the fixture.
- Verify: on PGlite, `db init` the fixture; `db verify --strict` reports no unclaimed elements; drop the unexposed column by raw SQL and strict verify reports it missing.
- Planner: exposed → unexposed plans nothing; absent → unexposed plans `ADD COLUMN`.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Every test above red then green.
- [ ] sql-orm-client, contract-ts, contract (1-core), emitter and migration-tools typecheck, lint, tests and coverage thresholds pass; `pnpm fixtures:check` passes.
- [ ] TML-3468 Done with a closing comment after merge.

## Dispatch plan

| # | Outcome |
|---|---|
| 1 | Validators, builder path and hash test: the contract shape can be produced and validates; fixture contract emitted. |
| 2 | ORM projection and emitter types: the leak test and type tests green; verify and planner tests green; gates. |
