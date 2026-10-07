# ADR 267 — Storage the ORM does not expose

## Decision

A contract can hold a column that no field describes, a table that no model describes, and a foreign key that no relation travels. Migrations manage such storage like any other. The ORM never reads it, writes it, or types it. The author writes `@ignore` on a field and `@@ignore` on a model:

```prisma
model User {
  id        Int     @id @default(autoincrement())
  email     String  @unique
  legacyKey String? @ignore         // migrated with the table; the application cannot touch it
}

model AuditRow {                    // migrated like any table; the application has no model for it
  id        Int      @id
  recordedAt DateTime
  @@ignore
}
```

A contract has two halves. Storage lists tables, columns, keys and constraints. Domain lists models, fields and relations, and each field names the column that holds it. This schema lowers to:

| Storage | Domain |
|---|---|
| table `User`: `id`, `email`, `legacyKey` | model `User`: fields `id`, `email` |
| table `AuditRow`: `id`, `recordedAt` | no model |

Each consumer reads one half. Migrations, `db verify` and the storage hash read storage, so they create, verify and fingerprint `legacyKey` and `AuditRow`. The ORM and the emitted types read domain, so to them neither exists:

```ts
const users = await db.public.User.all();                    // [{ id: 1, email: '...' }]
type UserKeys = keyof (typeof users)[number];                 // 'id' | 'email'

await db.public.User.create({ email: 'a@b', legacyKey: 'x' } as never);
// throws ORM.FIELD_UNKNOWN: Model "User" has no field "legacyKey"

db.public.AuditRow;                                           // not a property, in code or in types
```

The storage shape gains no flag. A column with no field, or a table with no model, is unexposed by that fact alone.

## Why

Every database holds objects the application must not touch: a column kept for an audit process, a column in the middle of a rename, a table another process writes inside the schema Prisma migrates, and the record of applied migrations that an earlier Prisma version keeps in `_prisma_migrations`. A schema written for an earlier Prisma version marks these `@ignore` and `@@ignore`, and that schema is a contract source (ADR 252), so a Prisma 8 contract has to carry them with the same meaning.

They have to live in storage because migrations own them: a database rebuilt from `migrations/` must contain them, and `db verify --strict`, which fails on any object the contract does not declare, must count them as declared. They have to stay out of the domain because the application must not read or write them, and the types must not offer them.

## Storage and domain are separately truthful

Storage is the truth for migrations; domain is the truth for the ORM. The validators check that each field points at a real column (`validateModelStorageReferences`) and never the reverse. The storage hash covers storage only, so exposing or unexposing a column leaves it unchanged. That is what makes `@ignore` free to add and remove: the planner diffs storage, sees no change, and plans nothing.

Two validators keep the ORM's write path resting on the contract. Every field must have a storage entry, so a field is never assumed to be a column of the same name. And an execution default, a value the ORM fills in on create or update, must target a column some field describes (`validateExecutionDefaultsTargetMappedColumns`), because the ORM writes no other column, so such a default could never run. An unexposed column that needs a default gets a database default.

## How a schema source produces it

Every schema source, whether PSL, an earlier Prisma version's schema or TypeScript, lowers to one set of definition nodes that `buildSqlContractFromDefinition` turns into a contract. A `FieldNode` or `ModelNode` with `unexposed: true` is the node form of `@ignore` and `@@ignore`. An unexposed field lowers to its column and to no domain field. An unexposed model lowers to its table, with its columns, keys and foreign keys, and to no domain model; every field of an unexposed model is unexposed with it. The definition nodes are part of the public `contract-builder` entry point, so the flag is public. The chained TypeScript authoring API has no option for it: an application that wants a column it cannot query writes it in PSL or in a hand-written migration.

A foreign key no relation travels is written as a relation field marked `@ignore`: the field implies the foreign key, and the `@ignore` keeps the relation out of the domain.

The builder refuses a definition that contradicts exposure, naming the reason in the error's `meta`:

| Definition | Reason |
|---|---|
| A relation declared on an unexposed model | `relation-on-unexposed-model` |
| A relation whose target is an unexposed model | `relation-to-unexposed-model` |
| A many-to-many relation whose junction model is unexposed | `relation-through-unexposed-model` |
| A relation joining on a column whose field is unexposed | `relation-on-unexposed-field` |
| An unexposed model that is a single-table variant | `unexposed-variant` |
| An exposed variant of an unexposed model | `variant-of-unexposed-model` |
| A generated default on an unexposed field | `executionDefaults-on-unexposed-field` |

A junction table is always an exposed model because the ORM reads and writes its columns. Definition nodes carry no inheritance, so refusing `@@ignore` together with `@@base` or `@@discriminator` belongs to the PSL interpreter.

## How the ORM stays out of it

Models inherit. A single-table variant shares its base model's table and adds fields to it; a multi-table variant has a table of its own that holds its own fields and the key it inherits. Exposure is therefore per model, not per table. A model's fields are its own fields and the fields it inherits (`getModelFields`, the one definition that name resolution and the default projection share). The columns a query reads from a table (`resolveModelColumns`) are the model's fields on that table, its variants' fields on that table, and, on a multi-table variant's table, the inherited key. So a single-table variant read as itself, for example as the target of a relation, carries the columns it inherits, and a multi-table variant with no field of its own still reads and returns its key. The default projection, `RETURNING` lists and `include` joins all use this set.

Every name a caller supplies as a field resolves through the model's fields, and a name that is not a field of the model is an error, `ORM.FIELD_UNKNOWN`. This holds for the keys of `create`, `update` and `upsert` data, `where` shorthand keys, `select`, `distinct`, `groupBy`, `cursor`, aggregate and `conflictOn` fields, and shorthand relation filters. The types already reject such names; the runtime check is what stops a request body passed straight to `create`, or any untyped caller, from reaching an unexposed column by its column name. A collection narrowed with `variant(...)` accepts the variant's own field names in `select` only; everywhere else the base model's fields apply.

The ORM may touch an unexposed column inside a query it builds, for example the row-number subquery behind `distinct` reads every column of the table, but it never returns one in a row, assigns one in a write, or accepts one's name from a caller.

## Types

The emitted `contract.d.ts` omits unexposed columns from the ORM's model, row and input types and omits unexposed tables from the model map. Its storage types keep them: the SQL query builder addresses storage, and a migration author or raw-SQL caller needs the names. A model with no exposed fields, or no relations, is typed as `{}`, never `Record<string, never>`, whose `keyof` is all of `string` and would let a row or create type accept any key.

## Verify, print and infer

Strict verify asks whether the contract declares each database object, and declaration is a storage fact, so unexposed storage is declared and never unclaimed. `contract print` writes an unexposed field as `@ignore`, an unexposed model as `@@ignore`, and a foreign key no relation travels as an `@ignore` relation field, so a printed contract re-emits to the same storage hash. `contract infer` prints a table it cannot model as an `@@ignore` model, so an inferred contract covers the whole schema.

## Consequences

- Adding or removing `@ignore` or `@@ignore` changes no storage, no hash and no migration history.
- A schema from an earlier Prisma version keeps every ignored object and declares `_prisma_migrations`, so strict verify passes on the database that version built.
- A column name passed where a field name belongs is an error at runtime as well as in the types.
- Exposure is orthogonal to control policy (ADR 224). An unexposed table can carry any policy and defaults to `managed`.
- MongoDB has no storage half distinct from its domain, so this decision is SQL-only.

## Alternatives considered

- **A flag on storage tables and columns.** Storage would then record a decision the ORM makes, the two halves could disagree, and the storage hash would change when exposure changed, so every `@ignore` edit would plan a migration.
- **Control policy instead of exposure.** Marking the objects `tolerated` or `external` would satisfy verify, but those policies mean migrations do not manage the object. An ignored column is managed: it must survive a rebuild from `migrations/`. Exposure and policy answer different questions.
- **Leave the objects out of the contract and verify leniently.** The planner then treats them as foreign, dropping or re-creating them as the schema edits around them, and strict verify can never pass.
- **A type-level guarantee only, keeping column-name fallbacks in the ORM.** `create(req.body)` and any JavaScript caller would write and read unexposed columns, which is the data the concept exists to protect.
- **Exposure per table.** A multi-table variant's table has no field describing its key, so its `RETURNING` list is empty and `create` fails, and two models over one table would see each other's columns.
- **Hiding unexposed tables from the SQL query builder's types.** The query builder addresses storage; hiding storage from it would split one storage description into two and remove the way to read an ignored column on purpose.
