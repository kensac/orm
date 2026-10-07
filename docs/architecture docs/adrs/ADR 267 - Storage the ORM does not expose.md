# ADR 267 — Storage the ORM does not expose

## Decision

A contract can hold a column that no field describes, a table that no model describes, and a foreign key that no relation travels. Migrations manage such storage like any other. The ORM never reads it, writes it, or types it. In Prisma 8 PSL the author writes `@ignore` on a field and `@@ignore` on a model, with the meaning Prisma 7 gave those attributes: the object stays in the database, and the application does not see it.

```prisma
model User {
  id        Int    @id @default(autoincrement())
  email     String @unique
  legacyKey String? @ignore        // the column exists and is migrated; the app cannot touch it
}

model PrismaMigration {            // a table migrations manage and the app never sees
  id String @id
  @@map("_prisma_migrations")
  @@ignore
}
```

The contract that results has `user.legacy_key` and the table `_prisma_migrations` in its storage half and nothing for them in its domain half. Every consumer behaves accordingly:

```ts
await db.public.User.all();                                   // [{ id: 1, email: '...' }]
await db.public.User.create({ email: 'a@b', legacy_key: 'x' } as never);  // throws ORM.FIELD_UNKNOWN
type Keys = keyof UserRow;                                    // 'id' | 'email'
db.public.PrismaMigration;                                    // does not exist, in code or in types
```

```bash
prisma migration plan      # a schema edit that adds or removes @ignore plans nothing
prisma db verify --strict  # the table and the column are declared, so nothing is unclaimed
```

The storage shape gains no flag. A column with no field, or a table with no model, is unexposed by that fact alone.

## Why

A contract has two halves. Storage lists tables, columns, keys and constraints; migrations, `db verify` and the storage hash read only storage. Domain lists models, fields and relations; the ORM and the emitted types read only domain. Each field names the column that holds it. When every column has a field, the two halves describe one shape from two sides, and a contract cannot say "this column is mine to migrate but not mine to query".

Databases hold such columns. A Prisma 7 schema marks them `@ignore` and `@@ignore`, and Prisma 7 keeps its own record of applied migrations in `_prisma_migrations`, a table no model describes. When Prisma 8 reads that schema as a contract source and takes over its migrations, a contract that cannot carry these objects must leave them out, and the migration system then treats them as foreign: adding `@ignore` to a field plans `DROP COLUMN`, removing it plans a column that already exists, and strict verify reports the ledger as unclaimed on every run. The same need exists without Prisma 7: a column kept for an audit process, a column in the middle of a rename, a table another application owns inside the schema Prisma migrates.

## Storage and domain are separately truthful

Storage is the truth for migrations; domain is the truth for the ORM. The validators check that each field points at a real column (`validateModelStorageReferences`) and never the reverse. The storage hash covers storage only, so exposing or unexposing a column leaves it unchanged. That invariant is what makes `@ignore` free to add and remove: the planner diffs storage, sees no change, and plans nothing.

Two validators keep the ORM's write path honest. Every field must have a storage entry, so a field is never guessed to be a column of the same name. And an execution default, a value the ORM fills in on create or update, must target a column some field describes (`validateExecutionDefaultsTargetMappedColumns`), because the ORM never writes any other column, so such a default could never run. An unexposed column that needs a default gets a database default.

## How a source produces it

Every schema source lowers to the contract definition nodes that `buildSqlContractFromDefinition` consumes. `FieldNode` and `ModelNode` carry an `unexposed` flag, the node-level form of `@ignore` and `@@ignore`. An unexposed field lowers to its column and to no domain field. An unexposed model lowers to its table, with its columns, keys and foreign keys, and to no domain model and no root; every field of an unexposed model is unexposed with it. The definition nodes are part of the public `contract-builder` entry point, so the flag is public, and the fluent TypeScript builder has no option for it: an application that wants a column it cannot query writes it in PSL, or in a hand-written migration.

The builder refuses definitions that contradict exposure, each with a named reason: a relation on, to, or through an unexposed model (`relation-on-unexposed-model`, `relation-to-unexposed-model`, `relation-through-unexposed-model`), a relation joining on a column whose field is unexposed (`relation-on-unexposed-field`), an unexposed single-table variant (`unexposed-variant`), an exposed variant of an unexposed model (`variant-of-unexposed-model`), and a generated default on an unexposed field (`executionDefaults-on-unexposed-field`). A junction table a many-to-many relation goes `through` is always an exposed model, because the ORM reads and writes its columns. Definition nodes carry no inheritance, so refusing `@@ignore` together with `@@base` or `@@discriminator` belongs to the PSL interpreter.

A foreign key no relation travels is written in PSL as a relation field marked `@ignore`: the field implies the foreign key, and the `@ignore` keeps the relation out of the domain.

## How the ORM stays out of it

Exposure is per model, not per table. A model's fields are its own fields on its own table and the fields it inherits from its base model (`getModelFields`, the one definition that name resolution and the default projection share). The columns a query reads from a table (`resolveModelColumns`) are the model's fields on that table, its variants' fields on that table, and, on a multi-table variant's table, the key the variant inherits. So a single-table variant read as itself, for example as the target of a relation, carries the columns it inherits, and a multi-table variant with no field of its own still reads and returns its key. The default projection, `RETURNING` lists and `include` joins all use this set.

Every name a caller supplies as a field resolves through the model's fields, and a name that is not a field of the model is an error, `ORM.FIELD_UNKNOWN`. This holds for the keys of `create`, `update` and `upsert` data, `where` shorthand keys, `select`, `distinct`, `groupBy`, `cursor`, aggregate and `conflictOn` fields, and shorthand relation filters. The types already reject such names; the runtime check is what stops a request body passed straight to `create`, or any untyped caller, from reaching a hidden column by its column name. A collection narrowed with `variant(...)` accepts a variant's own field names in `select` only; everywhere else the base model's fields apply.

The ORM may touch an unexposed column inside a query it builds, for example the row-number subquery behind `distinct` reads every column of the table, but it never returns one in a row, assigns one in a write, or accepts one's name from a caller.

## Types

The emitted `contract.d.ts` omits unexposed columns from the ORM's model, row and input types and omits unexposed tables from the model map. Its storage types keep them: the SQL query builder addresses storage, and a migration author or raw-SQL caller needs the names. A model with no exposed fields, or no relations, is typed as `{}`, never `Record<string, never>`, whose `keyof` is all of `string` and would let a row or create type accept any key.

## Verify and print

Strict verify asks whether the contract declares each database object, and declaration is a storage fact, so unexposed storage is declared and never unclaimed. `contract print` writes an unexposed field as `@ignore`, an unexposed model as `@@ignore`, and a foreign key no relation travels as an `@ignore` relation field, so a printed contract re-emits to the same storage hash. `contract infer` prints a table it cannot model as an `@@ignore` model, so an inferred contract covers the whole schema.

## Consequences

- Adding or removing `@ignore` or `@@ignore` changes no storage, no hash and no migration history.
- A Prisma 7 schema read as a contract source keeps every ignored object and declares `_prisma_migrations`, so strict verify passes after Prisma 8 takes over migrations.
- Code that passed a column name where a field name belongs, which the types never allowed, now fails with `ORM.FIELD_UNKNOWN` instead of working by accident.
- Unexposed storage is orthogonal to control policy (ADR 224). An unexposed table can carry any policy and defaults to `managed`.
- MongoDB has no storage half distinct from its domain, so this decision is SQL-only.

## Alternatives considered

- **A flag on storage tables and columns.** Storage would then record a decision the ORM makes, the two halves could disagree, and the storage hash would change when exposure changed, so every `@ignore` edit would plan a migration.
- **Control policy instead of exposure.** Marking the objects `tolerated` or `external` would stop verify complaining, but those policies mean migrations do not manage the object. An `@ignore` column is managed: Prisma 7 migrates it, and a column kept for an audit process must survive a rebuild from `migrations/`. Exposure and policy answer different questions.
- **Leave the objects out of the contract and rely on lenient verify.** This is the state the decision replaces: the planner then drops or re-creates the objects, and strict verify can never pass.
- **A type-level guarantee only, keeping the column-name fallbacks.** `create(req.body)` and any JavaScript caller would write and read hidden columns, which is the data the concept exists to protect.
- **Exposure per table.** A multi-table variant's table has no field describing its key, so its `RETURNING` list is empty and `create` fails, and two models over one table would see each other's columns.
- **Hiding unexposed tables from the SQL query builder's types.** The query builder is a storage-level lane; hiding storage from it would split one storage description into two and remove the way to read an ignored column on purpose.
