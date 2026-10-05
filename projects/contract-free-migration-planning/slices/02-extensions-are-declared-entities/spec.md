# Slice 2: extensions are declared entities

_Parent project: `projects/contract-free-migration-planning/`. Linear: TML-3030. Outcome: a Postgres extension is declared in the contract like an enum or a role; `db verify` checks it exists; a codec or index type that needs it is validated against the declaration; a `managed` declaration is created and dropped by the planner; the Prisma 7 source declares the datasource's `extensions` list, so a fresh database replayed from `migrations/` after the handover gets its extensions._

The project spec's locked decisions apply. This spec settles the open questions that belong to this slice and names the code.

## At a glance

Prisma 8 PSL:

```prisma
extension citext {}                       // managed: the planner creates and drops it
extension vector { @@control(external) }  // installed by the pgvector pack's baseline migration

model User {
  id    Int    @id
  email String @db.Citext    // when a citext codec exists; today citext has no codec, see Non-goals
}
```

Prisma 7 PSL through `prisma7Schema`:

```prisma
datasource db {
  provider   = "postgresql"
  extensions = [citext, uuid_ossp(map: "uuid-ossp", schema: "public", version: "1.1")]
}
```

lowers to two `managed` extension entities. On a fresh database `db migrate` runs, before any table:

```sql
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "public" VERSION "1.1";
```

and `db verify --strict` on the Prisma 7 database reports nothing for `citext`, `uuid-ossp` or `plpgsql`.

## Chosen design

### The entity

- **Kind.** Postgres-pack entity kind `extension`, declared beside `native_enum` and `role` (`packages/3-targets/3-targets/postgres/src/core/entity-kinds.ts`, `postgres-schema.ts`, `postgres-contract-serializer.ts`, `postgres-validators.ts`). Class `PostgresExtension` in `src/core/postgres-extension.ts` with `{ name, schema?, version?, control? }`. `schema` and `version` are used only to render `CREATE EXTENSION`; verify and equality compare the name only (the project's name-only rule).
- **Placement.** Extensions are per database, so they live in the unbound namespace like roles: `storage.namespaces.__unbound__.entries.extension[name]`.
- **Vocabulary.** The word `extension` already names a framework component (`contract.extensions`, `ExtensionPackRef`). The entity kind and PSL keyword stay `extension` as the project spec wrote them; the ADR notes the two meanings and the storage path disambiguates in code.
- **Control.** `control?` on the entity, default `managed` through `effectiveControlPolicy`. PSL: a block attribute `@@control(managed | external)` on the `extension` block, following `nativeEnumMapAttribute` in `authoring.ts`; `tolerated` and `observed` are refused on this kind. TS: `extension('vector', { control: 'external' })` from `@prisma/orm-postgres/contract`, lowered through `postgresLowerEntityHandles`; the `entities` union in `define-contract.ts` widens to accept it. Packs declare theirs `external`; an application declares its own `managed` by default.

### Both schema trees

- Expected: `contractToPostgresDatabaseSchemaNode` projects a `PostgresExtensionSchemaNode` (`id = name`, `control` stamped like native enums, `isEqualTo` compares the name only) under the database root, next to roles. `PostgresDatabaseSchemaNode` gains `extensions`; `pruneTableLessNamespaces` and `padActualNamespaces` pass it through. `schema-node-kinds.ts` gets the kind (granularity `entity`, `POSTGRES_NODE_ENTITY_KIND` entry `extension`).
- Live: `introspectExtensions` in the adapter reads `pg_catalog.pg_extension`, excluding `plpgsql` (always installed, never declared). Nothing reads `pg_depend`.
- Ownership: `isClusterScopedIssue`, `retainUnownedExtras` and `postgresNodeStorageCoordinate` learn the root-level extension path (`path[1]` is the name, not a schema), so a pack-declared extension is recognised as sibling-owned by the app space and vice versa.

### Dependencies

- `SqlColumnIR` gains a non-enumerable `dependsOn`, following `SqlIndexIR`. Both derivations stamp a column's edge to `[database, extension:<name>]` from its codec's `requires`, and the column→enum edge slice 1 deferred. The actual side derives the same edge from the same structural rule using the codec the contract maps to that column; a live column with no contract counterpart has no edge.
- Coalescing: when `coalesceSubtreeIssues` folds a column issue into a whole-table issue, the column's cross-links lift onto the table issue.
- `classifyCall` stays. `createExtension` is already `dep`; a new `dropExtension` call goes in a new final bucket after `rlsEnable`, so an extension is dropped after everything that used it. Retiring the buckets in favour of the graph stays with slice 3, which owns the planner's remaining contract reads; this slice records in `issue-planner.ts` which buckets the column edges now make redundant.

### Lifecycle

- `mapNodeIssueToCall` dispatches extension issues before the schema/table path check, like native enums: `not-found` → `CreateExtensionCall` (now carrying `schema` and `version`, quoting the name; the `installExtension` bug that leaves the name unquoted is fixed the same way), `not-expected` → new `DropExtensionCall` (`DROP EXTENSION IF EXISTS`, class `destructive`, precheck exists, postcheck gone), `not-equal` never fires.
- `POSTGRES_NODE_CREATION_FACTORY` gains `extension → createExtension`. `resolvePostgresNodeIssueControlPolicySubject` reads the declared entity's `control`; an extra with no declaration resolves through the plan's `defaultControlPolicy` like a table, so a `managed` default with a destructive policy drops an undeclared extension only when the user asked for destructive changes, and never drops `plpgsql` because it is never introspected.
- Verify: a declared extension missing from the database fails (`declaredMissing`); an `external` declaration suppresses extras as roles do; an undeclared installed extension is an unclaimed element under strict verify, which is what makes the Prisma 7 fixture test below meaningful.

### Codec and index-type requirements

- `CodecDescriptorTemplate` gains `requires?: readonly { entityKind: string; entityName: string }[]` (framework-plane, opaque strings). Index-type descriptors gain the same field so paradedb's `bm25` can require `pg_search`.
- The generic check lives in `validateLoadedContract` (`packages/1-framework/3-tooling/cli/src/control-api/operations/validate-loaded-contract.ts`), so `contract emit` and `contract print` fail with a load error naming the codec (or index type), the column, and the entity to declare, when a `requires` coordinate is not declared in the unbound namespace of any composed space. `validateContractCodecMappings` in the SQL runtime performs the same check at client load.
- pgvector declares `extension vector { @@control(external) }` in its contract space and `pg/vector@1` requires it; postgis the same for `postgis` and `pg/geometry@1`; paradedb declares `pg_search` and its `bm25` index type requires it. Every in-repo contract that uses those codecs keeps working because the pack declares the entity.

### Prisma 7 source

- `checkDatasource` in `contract-prisma7/src/interpreter.ts` reads `extensions = [...]`: bare identifiers and calls with `map`, `schema`, `version`. Each becomes a `managed` extension entity, filed into `namespaceEntities` under the unbound namespace through a new `extension: { entityKind }` on `Prisma7TargetBinding`, set by `prisma7-binding.ts`. The `postgresqlExtensions` preview feature is not required (Prisma 7 requires it; the source accepts the list either way and says so in the README rule table).
- `contract print` prints these as `extension <name> {}` blocks with `map`, `schema` and `version` attributes when set, so the slice-3 round trip holds.

### `contract print` and `contract infer`

- `psl-print`: `extension` joins `PRINTED_ENTRY_KINDS`; `buildExtensionBlocks` mirrors `buildRoleBlocks`; `@@control(external)` prints; `refuseNativeEnumControl` is not extended to extensions because the attribute is printable.
- `psl-infer`: installed extensions other than `plpgsql` are printed as top-level `extension <name> {}` blocks through the existing `topLevelExtensionBlocks` slot, minus those a described pack contract owns (the native-enum adoption precedent).

## Scope

In: everything above, the ADR amendment note for ADR 154 (declared-entity presence replaces the removed fuzzy `pg_extension` dependency matching), the extension-author upgrade instruction (declare your extension `external`; add `requires` to your codecs), and the handover test gaining an edit whose schema declares `extensions = [uuid_ossp(map: "uuid-ossp")]` and a column with `@default(dbgenerated("uuid_generate_v4()"))`, which the source already accepts. The fresh-database replay must then create the extension before the table. (`citext` cannot be the example: it has no Prisma 8 codec, so a `@db.Citext` column is refused.)

Out:
- Extension versioning in verify; `version` is render-only.
- Retiring `classifyCall` buckets (slice 3).
- Mongo.
- Codecs for `citext` and other extension types (separate issue TML-3270).
- Extensions a Prisma 7 user only ever added by hand to `migration.sql` (not in the schema; nothing can see them).

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| `uuid-ossp` and other hyphenated names | Always quote. `installExtension` fixed too. |
| `plpgsql` | Excluded at introspection; never declared, never dropped, never unclaimed. |
| Pack-installed extension and an app that also declares it | Two declarations of one coordinate across spaces: the app's `managed` and the pack's `external` conflict. Refuse at aggregate load with both coordinates named. |
| `WITH SCHEMA x` where `x` is not created | Prisma 7 has the same bug. The extension node depends on the namespace node when `schema` is set, so `CREATE SCHEMA` precedes it when the schema is in the contract; otherwise the plan fails on the missing schema with Postgres's own error. |
| Storage hash change for pack contract spaces and every contract using pgvector/postgis/paradedb | Expected; fixtures, snapshots and baseline `migration.json` regenerate under `pnpm fixtures:check`; the release note and upgrade instruction say so. |

## Tests (first; red before green)

- Parity: `test/integration/test/authoring/parity/extension/` with `contract.ts`, `schema.prisma`, `packs.ts`, `expected.contract.json`, on the `native-enum` and `rls` precedent.
- Authoring: `psl-extension-authoring.test.ts` mirroring the native-enum one, including `@@control`, refusal of `tolerated`/`observed`, and the TS helper.
- Node, derivation, planner, control-policy and verdict tests mirroring the native-enum set, plus the column→extension edge and the lifted edge under table coalescing.
- Adapter: `introspectExtensions`; PGlite integration for managed create and drop (PGlite ships `citext`? verify; otherwise use an extension PGlite bundles, such as `vector` from `@electric-sql/pglite/vector`), a declared-missing verify failure, and an `external` declaration that plans nothing and verifies.
- Load error: a contract using `pg/vector@1` with no declaration fails `contract emit` naming both ends; the same at SQL runtime load.
- Prisma 7: fixture `native-type-model-ignored` gains the entity; a new fixture with `map`, `schema` and `version`; `interpreter-fixtures.integration.test.ts` strict verify passes with the extension declared and `plpgsql` absent.
- Print and infer: round-trip tests for every Postgres contract keep passing with the new block; infer prints installed extensions.
- Handover: the edit above, with the fresh-database replay creating the extension before the table.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] The project DoD item "an app declares `extension vector` in both PSL and TS ..." holds end to end.
- [ ] `pnpm fixtures:check` passes after regeneration and every regenerated change is explained in the PR.
- [ ] The handover test's fresh-database replay succeeds with a schema that needs `uuid-ossp`.
- [ ] TML-3030 Done with a closing comment after merge; ADR 154 amendment and the extension-author upgrade instruction shipped.

## Dispatch plan

| # | Outcome |
|---|---|
| 1 | The entity, both trees, lifecycle calls and control resolution: a PSL/TS-declared extension is created, dropped, verified, and `external` plans nothing. Parity, node, planner, adapter tests red then green. |
| 2 | Dependencies and requirements: column edges, coalesced-edge lifting, `requires` on codec and index-type descriptors, the load checks, pack adoption, fixture regeneration. |
| 3 | Prisma 7 source, print, infer, handover edit, docs, ADR note, upgrade instructions, CI-equivalent gates. |
