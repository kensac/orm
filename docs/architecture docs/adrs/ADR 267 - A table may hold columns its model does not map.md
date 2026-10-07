# ADR 267 — A table may hold columns its model does not map

## Decision

A model maps to a table, and the table may hold columns the model does not map. A table may have no model at all. Such storage is declared in storage terms, next to the models, and migrations manage it like any other. The ORM reads, writes and types only the columns a model's fields map.

```ts
const User = model('User', {
  id:    field.int().id(),
  email: field.text().unique(),
}).sql({
  columns: {
    legacy_key: column(textColumn).nullable(),        // in the table, migrated with it; no field maps it
  },
});

const AuditRows = table('audit_rows', {                 // a table no model maps
  columns: {
    id:          column(int4Column),
    recorded_at: column(timestamptzColumn),
  },
  id: { columns: ['id'] },
});
```

A contract has two halves. Storage lists tables, columns, keys and constraints. Domain lists models, fields and relations, and each field names the column that holds it. The declarations above lower to:

| Storage | Domain |
|---|---|
| table `User`: `id`, `email`, `legacy_key` | model `User`: fields `id`, `email` |
| table `audit_rows`: `id`, `recorded_at` | no model |

Each consumer reads one half. Migrations, `db verify` and the storage hash read storage, so they create, verify and fingerprint `legacy_key` and `audit_rows`. The ORM and the emitted types read domain, so to them neither exists:

```ts
const users = await db.public.User.all();                     // [{ id: 1, email: '...' }]
type UserKeys = keyof (typeof users)[number];                  // 'id' | 'email'

await db.public.User.create({ email: 'a@b', legacy_key: 'x' } as never);
// throws ORM.FIELD_UNKNOWN: Model "User" has no field "legacy_key"

db.public.AuditRows;                                           // not a property, in code or in types
```

The storage shape gains nothing. A column with no field, or a table with no model, is such storage by that fact alone, and `contract.json` already represents it.

## Why

Every database holds objects the application must not touch: a column kept for an audit process, a column in the middle of a rename, a table another process writes inside the schema Prisma migrates, and the record of applied migrations that an earlier Prisma version keeps in `_prisma_migrations`. A schema written for an earlier Prisma version marks these `@ignore` and `@@ignore`, and that schema is a contract source (ADR 252), so a Prisma 8 contract has to carry them with the same meaning: in the table, migrated with it, invisible to the application.

The separation of storage from domain exists for this. Storage is what the migration system receives, and it must be complete and unambiguous on its own. Domain is what the application sees. A column the application must not see is a storage fact with no domain counterpart, and the authoring surface says exactly that: it describes the table, not a field the model is told to hide.

## Declaring storage as storage

A model's `.sql({ ... })` section already describes the model's table rather than the model: its name, its control policy, its indexes, checks and foreign keys. It gains `columns`, the columns the table holds beyond those the model's fields map. A column there is written in storage terms: a column name, a storage type, nullability, an optional database default, and an optional control policy that defaults to the table's. It has no field name, because there is no field, and it never carries an execution default, because nothing writes it.

A table no model maps is declared with `table(...)` beside the models, with the same storage vocabulary: columns, primary key, uniques, indexes, checks, foreign keys and control policy. A foreign key from such a table to a modelled one, or from an extra column to anywhere, is a foreign key in storage, resolved by table and column name; it is never a relation, because there is no model to relate.

Prisma 8 PSL gets the same two forms: an `sql { }` block inside a `model`, and a `table` block beside models, in the family of storage-only blocks such as `native_enum` and `role`. Each must lower to the same storage as its TypeScript twin, under the parity rule of ADR 096. A `table` block naming a table a model maps is refused; a modelled table's extra columns go in that model's `sql { }` block, so one declaration owns each table's table-level properties.

One rule holds across every surface: each column of a table is declared exactly once, either by a field or in the storage declaration, never both.

## How a contract is assembled

Authoring lowers in two steps, which `buildSqlContractFromDefinition` performs today in one call:

1. **Derive.** Model-shaped input, a `ContractDefinition` of models with fields, relations, keys, indexes, checks and foreign keys, becomes the storage and domain halves it implies: column types from field codecs, tables from mappings, index and constraint names from the naming rules, inheritance materialised onto tables, junction tables for implicit many-to-many relations, foreign keys from relations, defaults encoded through codecs.
2. **Assemble.** Storage and domain halves become a contract: foreign key targets resolved, entries canonicalized, validators run, hashes computed.

Storage declared as storage has nothing to derive, so it enters at the second step, in contract shape, merged with the derived storage of the models. The assemble step refuses a column present in both. The Prisma 7 reader therefore derives the models it maps, adds `@@ignore` tables and `@ignore` columns to the storage half directly, and assembles. `defineContract` and the Prisma 8 PSL interpreter lower `.sql({ columns })`, `table(...)` and their PSL twins to the same place. No new vocabulary enters the definition data, and every contract passes through one validation and one hashing.

Derive is deterministic, and that gives two properties the design relies on:

- **Exposure does not move the storage hash.** A column declared as a field and the same column declared in `columns` produce identical storage, so moving a column between the two, which is what adding or removing `@ignore` does, plans no migration and leaves the marker valid. This is one equation, derive with the field equals derive without it plus the declared column, and it is tested as such.
- **`contract print` can separate the two.** It prints the models, derives their storage, and whatever the contract's storage holds beyond that is printed as `sql { }` and `table` blocks. `contract infer` does the same from a database: the tables it can model become models, and the rest becomes `table` blocks, so an inferred contract covers the whole schema.

## Keeping the ORM to the domain

A model's columns are the columns of its own fields and of the fields it inherits, on each table it reads. Models inherit: a single-table variant shares its base's table and adds fields to it, and a multi-table variant has a table of its own holding its fields and the key it inherits. So the set a query reads from a table is worked out per model: the model's fields on that table, its variants' fields on that table, and, on a multi-table variant's table, the inherited key. The default projection, `RETURNING` lists and `include` joins use that set and nothing else.

Every name a caller supplies as a field resolves through the model's fields, and a name that is not a field of the model is an error, `ORM.FIELD_UNKNOWN`: the keys of `create`, `update` and `upsert` data, `where` shorthand keys, `select`, `distinct`, `groupBy`, `cursor`, aggregate and `conflictOn` fields, and shorthand relation filters. The types already reject such names; the runtime check is what stops a request body passed straight to `create`, or any untyped caller, from reaching an extra column by its column name.

Two validators let the ORM's write path rest on the contract. Every field has a storage entry (`validateModelStorageReferences`), so a field is never assumed to be a column of the same name. And an execution default, a value the ORM fills in on create or update, targets a column some field maps, because the ORM writes no other column. An extra column that needs a default gets a database default.

The ORM may touch an extra column inside a query it builds, for example the row-number subquery behind `distinct` reads every column of the table, but it never returns one in a row, assigns one in a write, or accepts one's name from a caller.

## Types

The emitted `contract.d.ts` omits extra columns from the ORM's model, row and input types and omits tables with no model from the model map. Its storage types keep them: the SQL query builder addresses storage, and a migration author or raw-SQL caller needs the names. A model with no fields, or no relations, is typed as `{}`, never `Record<string, never>`, whose `keyof` is all of `string` and would let a row or create type accept any key.

## Verify and control policy

Strict verify asks whether the contract declares each database object, and declaration is a storage fact, so extra columns and tables with no model are declared and never unclaimed.

Who manages the storage is a separate question from whether the application sees it. An extra column or a table with no model carries a control policy like any storage, defaulting to `managed`: a Prisma 7 `@ignore` column is migrated and must survive a rebuild from `migrations/`. A legacy column another system owns is declared the same way with `external`, and then the planner emits no DDL for it. Exposure and policy are orthogonal, and both live in storage.

## Consequences

- Adding or removing `@ignore` or `@@ignore` in a Prisma 7 schema changes no storage, no hash and no migration history.
- A schema from an earlier Prisma version keeps every ignored object and declares `_prisma_migrations`, so strict verify passes on the database that version built.
- A column name passed where a field name belongs is an error at runtime as well as in the types.
- `buildSqlContractFromDefinition` is two composable steps, and a source may enter at either.
- A column whose type has no codec is not covered: every storage column carries a storage type. That is its own decision.
- MongoDB has no storage half distinct from its domain, so this decision is SQL-only.

## Alternatives considered

- **A field the model is told to hide.** A flag on a field node, or `@ignore` as a Prisma 8 attribute, describes storage as domain with a negation. It needs a model to carry it, so a table with no model becomes a model with invented field names, and the vocabulary names the thing by what the ORM refuses to do. Storage declared as storage needs neither.
- **A flag on storage tables and columns.** Storage would record a decision the ORM makes, the two halves could disagree, and the storage hash would change when exposure changed, so every `@ignore` edit would plan a migration.
- **Control policy instead of exposure.** Marking the objects `tolerated` or `external` satisfies verify, but those policies mean migrations do not manage the object, and an ignored column is managed. The two answer different questions and both are needed.
- **Leaving the objects out of the contract and verifying leniently.** The planner then treats them as foreign, dropping or re-creating them as the schema edits around them, and strict verify can never pass.
- **A new node for tables in the definition data.** Storage declared as storage has nothing to derive, so a node vocabulary for it duplicates the contract's own storage shapes. Entering at the assemble step uses those shapes directly.
- **The Prisma 7 reader appending tables after the contract is built.** It would be a second assembler: it would re-hash, re-validate and resolve its own foreign keys, and a foreign key between an ignored table and a modelled one would need both assemblers to agree.
- **A type-level guarantee only, keeping column-name fallbacks in the ORM.** `create(req.body)` and any JavaScript caller would write and read extra columns, which is the data the concept exists to protect.
- **Exposure per table in the ORM.** A multi-table variant's table has no field describing its key, so its `RETURNING` list is empty and `create` fails, and two models over one table would see each other's columns.
- **Hiding extra storage from the SQL query builder's types.** The query builder addresses storage; hiding storage from it would split one storage description in two and remove the way to read an extra column on purpose.
