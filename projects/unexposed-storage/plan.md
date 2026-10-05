# Unexposed storage — Plan

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Unexposed storage](https://linear.app/prisma-company/project/unexposed-storage-tables-and-columns-the-orm-never-sees-97488a1828eb) (P-TML-1151)

Three slices, sequential. Each is one PR, named for what a developer can rely on when it merges.

| # | Slice | Delivers | Ticket |
|---|---|---|---|
| 1 | `storage-without-a-domain-counterpart` | The builder can emit a table, column or foreign key with no model, field or relation; the ORM never selects, writes or types such a column; `contract.d.ts` omits unexposed tables from the ORM-facing types; strict verify treats unexposed storage as declared. Proven with a TypeScript-authored contract. | TML-3468 |
| 2 | `prisma7-ignore-is-unexposed-storage` | `prisma7Schema` keeps `@ignore` fields, `@@ignore` models and ignored relations' foreign keys and junctions in storage, and declares `_prisma_migrations` as an unexposed table. Adding or removing `@ignore` plans nothing in the handover test; strict verify passes with `unclaimed: []`. Upgrade instruction for already-signed adopters. | TML-3467, TML-3453 |
| 3 | `print-and-infer-unexposed-storage` | Prisma 8 PSL gains `@ignore` and `@@ignore` with the storage-managed, not-exposed meaning; `contract print` round-trips every Prisma 7 fixture to the same storage hash; `contract infer` prints unexposed tables for what it cannot model. ADR at close-out. | TML-3469 |

## Sequencing

Slice 1 first: slices 2 and 3 both produce unexposed storage and need the runtime and emitter to honour it. Slice 2 before 3: the print slice's round-trip test uses slice 2's fixtures.

## Per-slice notes

### 1 — `storage-without-a-domain-counterpart` (TML-3468)

The ORM projection change (`query-plan-select.ts`, `query-plan-meta.ts`, `query-plan-mutations.ts`, `collection-runtime.ts`) is the risky part: it is on the hot path and must handle single-table and multi-table inheritance, `RETURNING`, and `include`. Write the leak test first: a contract with an unexposed column, `findMany()` with no `select`, assert the column is absent from rows and from the row type. The builder gains an internal flag on `FieldNode` and `ModelNode`; the public TS authoring surface does not gain a user-facing `ignore` option in this slice.

**Hands to:** a contract shape every source can produce and every consumer honours.

### 2 — `prisma7-ignore-is-unexposed-storage` (TML-3467, TML-3453)

Interpreter: resolve ignored fields' types instead of returning at the `@ignore` check; build `@@ignore` models as storage-only; emit foreign keys for ignored relation fields; synthesize junctions whose one side is ignored. Columns with no Prisma 8 codec stay omitted with today's diagnostics, and an `@@ignore` table with such a column is omitted whole, together with foreign keys into it. The source also declares `_prisma_migrations` (Prisma 7's fixed shape) as an unexposed table. Regenerate the Prisma 7 fixtures; `strictExtras` in the integration test shrinks to codec-less columns. The handover test gains an edit pair (add `@ignore`, remove it) that plans nothing, and tightens the strict-verify assertion to `unclaimed: []`.

**Hands to:** fixtures that carry unexposed storage, for slice 3's round trip.

### 3 — `print-and-infer-unexposed-storage` (TML-3469)

PSL attribute specs gain `@ignore` (field) and `@@ignore` (model); the interpreter lowers them to unexposed storage; the printer emits them, and prints a foreign key no relation travels as an `@ignore` relation field. The refusals `refuseUnmodelledTablesAndColumns` and `refuseUntravelledForeignKeys` are deleted. `psl-infer` prints an unmodelable table as an `@@ignore` model. Close-out: ADR, replace the slice-1 text in the Prisma 7 project that documents the omission, delete this folder.

## Close-out obligations

- ADR "Storage the ORM does not expose".
- The Prisma 7 contract source project's slice-1 spec and `contract-prisma7/README.md` lines that say ignored objects are omitted.
- The handover README's strict-verify sentence.
