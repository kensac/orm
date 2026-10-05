# Unexposed storage: tables and columns the ORM never sees

**Linear:** [Unexposed storage](https://linear.app/prisma-company/project/unexposed-storage-tables-and-columns-the-orm-never-sees-97488a1828eb) (P-TML-1151). Issues: TML-3467 (`@ignore` data loss), TML-3453 (`_prisma_migrations` under strict verify).

## Purpose

Let migrations manage database objects the application never reads or writes. Today the contract can only describe a table, column or foreign key if a model, field or relation exposes it, so anything the ORM must not see has to be left out of the contract, and the migration system then treats it as foreign: it drops it, re-creates it, or reports it as unclaimed. Prisma 7 users rely on `@ignore` for exactly these objects, and Prisma 7 itself keeps a ledger table in the application's schema.

## At a glance

A Prisma 7 schema after the handover to Prisma 8:

```prisma
model User {
  id        Int    @id @default(autoincrement())
  email     String @unique
  legacyKey String @ignore          // Prisma 7 created it; the app must not see it
}

model AuditRow {                   // Prisma 7 created it; the app must not see it
  id Int @id
  @@ignore
}
```

Today `prisma7Schema` leaves `legacyKey` and `AuditRow` out of the contract. After the handover, adding `@ignore` to a field plans `DROP COLUMN` and `db migrate` runs it without asking. Removing `@ignore` plans `ADD COLUMN` for a column that is already there.

After this project both objects are in the contract's storage, managed by migrations, with no domain field or model. Adding or removing `@ignore` changes nothing in storage and plans nothing, as it does in Prisma 7. The same mechanism declares `_prisma_migrations` as a table Prisma 8 manages but never exposes, so `db verify --strict` passes after the handover:

```bash
prisma db verify --strict   # exit 0, unclaimed: []
```

## Non-goals

- Changing what `managed`, `tolerated`, `external` and `observed` mean (ADR 224). Unexposed storage is orthogonal to control policy: an unexposed table can carry any policy, and defaults to `managed`.
- Exposing unexposed storage through the SQL query builder's contract types. Whether `contract.d.ts` lists these tables is decided in the slice that touches the emitter; the default is that it does not.
- Supporting columns whose Postgres type has no Prisma 8 codec (`citext`, `money`, `Unsupported(...)`). They stay omitted with today's diagnostics until an opaque storage codec exists; that is a separate decision.
- Removing `@ignore` from Prisma 7, or changing how Prisma 7 treats it.

## Place in the larger world

- The Prisma 7 contract source (`packages/2-sql/2-authoring/contract-prisma7`) is the first producer. Its slice-1 spec (`projects/prisma7-contract-source/slices/01-postgres-source/spec.md`, lines 45 and 81) documents today's omission and the reliance on lenient verify.
- The handover test (`examples/prisma7-adoption/test/handover.test.ts`, slice 5 of that project) pins `unclaimed: ["_prisma_migrations"]` and tightens to `[]` when TML-3453 lands.
- Contract-free migration planning (`projects/contract-free-migration-planning/`) is making the planner read only the two schema trees. Unexposed storage is storage-side data, so it rides that work unchanged: the planner already diffs storage without reading the domain.
- The ORM client's default projection (`packages/2-sql/.../query-plan-select.ts`, `collection-runtime.ts`) selects every storage column when no `select` is given. That is the one runtime surface this project changes.

## Cross-cutting requirements

- **Storage is the truth for migrations; the domain is the truth for the ORM.** A storage table, column or foreign key may exist with no model, field or relation that maps to it. The contract validators allow this today; the builder and every source must be able to produce it, and the ORM must never read, write or type a column no field maps.
- **The storage hash does not change when exposure changes.** Adding or removing a domain field or model over existing storage must leave `storage.storageHash` unchanged, so `migration plan` reports no changes and the marker still matches. This is what makes `@ignore` round trips free.
- **`contract print` round-trips unexposed storage.** Prisma 8 PSL gains `@ignore` on fields and `@@ignore` on models with exactly the Prisma 7 meaning: the object is storage-managed and not exposed. A printed contract re-emits to the same storage hash. A foreign key with no relation prints as the `@ignore` relation field that implies it.
- **Verify treats unexposed storage as declared.** Strict verify no longer reports it as unclaimed; lenient verify is unchanged.
- **`contract infer` can emit unexposed storage** for tables it cannot model (today it refuses or hand-waves them), so an inferred contract covers the whole schema. This is required for `_prisma_migrations` on a Prisma 8 PSL project that migrated by hand.

## Transitional-shape constraints

- Every `prisma7Schema` adopter who already signed has a storage hash that changes when ignored objects enter storage. The slice that changes the source ships an upgrade instruction: re-sign before the handover, or plan one catch-up migration after it. That migration must plan to no operations for objects that already exist (it must not emit creates the runner then skips), so the source change lands only together with the "exposure changes do not change storage" rule.
- Until the ORM projection change lands, an unexposed column would leak through `findMany()` with no `select`. The projection change therefore lands in the same slice as the first producer, not after it.

## Contract impact

- `StorageTable`, `StorageColumn` and the foreign-key entry gain nothing: absence of a mapping domain object is the signal. The builder (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`) gains the ability to emit a table or column with no domain counterpart, and the contract JSON schema is unchanged.
- The emitter's `contract.d.ts` stops listing unexposed tables and columns in the ORM-facing types.
- A validator is added: a storage column that a field maps must agree with that field, as today; a storage column no field maps is legal.

## Adapter impact

- Postgres: none in the planner. Introspection is unchanged. `psl-infer` learns to print unexposed tables.
- SQLite and Mongo: the ORM projection rule is family-level (SQL); Mongo has no storage-only concept and is out of scope.

## ADR pointer

One ADR at close-out: "Storage the ORM does not expose", recording that storage and domain are separately truthful, the hash rule, and the PSL `@ignore`/`@@ignore` meaning. It extends ADR 224 (control policy) and ADR 252 (Prisma 7 schema as a contract source).

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- [ ] In `examples/prisma7-adoption`, a handover edit that adds `@ignore` to a field and `@@ignore` to a model plans no operations, and the reverse edit plans none either. A Prisma 8 `findMany` with no `select` returns no ignored column.
- [ ] The handover test asserts `db verify --strict` exits 0 with `unclaimed: []` on the database Prisma 7 built.
- [ ] `contract print` of a Prisma 7 schema with `@ignore` and `@@ignore` writes Prisma 8 PSL that re-emits to the same storage hash, and the Prisma 7 fixture round-trip test keeps every fixture.
- [ ] `contract infer` on a database with `_prisma_migrations` prints a contract that verifies strictly.
- [ ] The ADR is written and the slice-1 spec text that documents the omission is replaced.

## Open questions

- Whether unexposed tables appear in the SQL query builder's types (`contract.d.ts` storage section). Default: no. Settled in the emitter slice.
- The PSL form for a foreign key no relation travels (an `@ignore` relation field is the proposal). Settled in the print slice.

## References

- `projects/prisma7-contract-source/slices/01-postgres-source/spec.md`, `slices/05-migration-ownership-handover/spec.md`.
- `packages/1-framework/0-foundation/contract/src/control-policy.ts`; ADR 224.
- `packages/2-sql/1-core/contract/src/validators.ts` (`validateModelStorageReferences`).
- `packages/2-sql/2-authoring/contract-psl/src/psl-print/refusals.ts` (`refuseUnmodelledTablesAndColumns`, `refuseUntravelledForeignKeys`).
- `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts` (`@ignore` at ~936, `@@ignore` at ~602), `relations.ts` (~524-611).
