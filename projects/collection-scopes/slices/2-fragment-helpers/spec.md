# Slice 2: shared query fragments as scopes

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** ADR 259, "Query fragments are functions", and ADR 258 for the word "scope". **Ticket:** TML-3436. **Builds on:** slice 1 (prisma/orm#30560, branch `tml-3403-collection-keeps-its-class`). **Pull request:** prisma/orm#30564, branch `tml-3436-fragment-helpers`, which holds an earlier form of this slice to be reshaped.

## At a glance

```ts
import { field } from '@prisma/orm-postgres/contract-builder';
import { orderByField } from '@prisma/orm-postgres/orm-client';

const notDeleted = db.scope(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);
const forTenant = (tenantId: string) =>
  db.scope({ tenantId: field.uuidString() }, (rows) => rows.where((r) => r.tenantId.eq(tenantId)));
const summary = db.Post.scope((posts) => posts.select('id', 'title').include('user'));

db.Post.apply(notDeleted).apply(forTenant(ctx.tenantId)).apply(summary).all();
db.Comment.apply(notDeleted);
db.Tag.apply(notDeleted);                        // error: Tag has no deletedAt
db.Post.select('id').apply(summary);             // error: the rows no longer have every Post field
db.Post.orderBy(orderByField(db.Post, input.sort, input.direction, ['title', 'createdAt']));
```

## Chosen design

As ADR 259. In `packages/3-extensions/sql-orm-client`, exported from the client and re-exported by the Postgres facade:

- **`db.scope(fields, body)`**, a method on the client. `fields` is a map from field name to either a field builder from the contract DSL (`field.text()`, `field.temporal.timestamptz().optional()`, `field.uuidString()`, …) or a `CodecField` type. The body receives a collection whose model accessor has only the declared fields, typed with `CodecField` per field. The returned scope is generic over the collection it receives: it accepts any collection of a model that has every declared field with the same column type and nullability, and returns that collection's own type plus what the body established (`Filtered<Self>` after a `where`, `Ordered<Self>` after an `orderBy`). A model that lacks a field, or has it with another column type or nullability, is refused with an error naming the field. At run time the scope checks the fields once against the model and throws `ORM.FIELD_UNKNOWN` otherwise. The body may `where`, `orderBy`, `limit` and `offset`; it may not `select` or `include`.
- **`db.Post.scope(body)`**, a method on every collection. The body is typed against the plain collection of the model. The returned scope accepts any collection of that model whose row is the full row or wider (root, filtered, after `include`, an include refinement, `this` in a class) and refuses one narrowed by `select` or `variant`. Its result has the default state when the body changes the row. The model comes from the receiver, so there are no type arguments.
- **`orderByField(collection, name, direction?, allowed?)`**, as already built on the branch.
- **`CodecField<TContract, CodecId, Nullable>`**, as already built, and the type a field builder resolves to inside `db.scope`.

The earlier spike's shape-matched fragment (`bot/spike-pipe-fragments`, `projects/collection-scopes/spikes/pipe-fragments.md`, section 2b) is the reference for `db.scope`: it typed the body against a restricted view of the collection and checked fields at run time. Two things it lacked are now available: `Filtered<Self>` from slice 1 lets the scope's result record the body's filter, and the cost it measured (about 10,000 instantiations per definition, cause unknown) predates slice 1's changes to `include` and must be measured again.

## Coherence rationale

One idea: a scope is a function, and these are the three ways to make one that TypeScript cannot type on its own. One reviewer holds it in one sitting.

## Scope

In: the two `scope` methods, `orderByField`, `CodecField`, their exports, tests, the package README and `skills/prisma-8/references/queries-postgres.md`, the demo using each, ADR 259 set to match the code and to Accepted, the per-definition and per-use cost of `db.scope` measured and written into ADR 259.

Out: `apply` and the `Scope` type (slice 1); a default scope per model; selecting or including by shape across models; collection scopes from indexes (slice 4); the registered class inside an include refinement (TML-3426).

## Pre-investigated edge cases

- Field builders live in the contract DSL package. Check how the facade exports them (`@prisma/orm-postgres/contract-builder`) and that the ORM client can read a builder's codec id and nullability without a layering violation (`pnpm lint:deps`). If the client cannot depend on the DSL, `db.scope` takes a small interface the builder satisfies, not the builder's class.
- A model may carry the declared field under a different column name (`@map`); the check is on the field, not the column.
- Declared fields must not be matched against relations or variant-only fields.
- Tests use emitted fixtures or a user-facing authoring surface, never patched generated files (`.agents/rules/no-contract-data-patching-in-tests.mdc`). The branch already has an emitted soft-delete fixture with `deletedAt` on two models and none on a third.

## Slice-specific done conditions

- Type tests for `db.scope`: accepted on two models that have the fields and refused on one that lacks them, on another column type, on another nullability; the body cannot name an undeclared field or call `select` or `include`; the result records the body's filter and order; works at every site listed above.
- Type tests for `db.Post.scope`: every site accepted, `select`- and `variant`-narrowed collections refused, a wrong model refused.
- Runtime tests show the plan contains the scope's filter and order, and the `ORM.FIELD_UNKNOWN` refusal.
- `examples/prisma-8-demo` uses all three, with its typecheck through `dist`, its tests and the declaration-emit test passing.
- Demo type instantiations do not rise by more than 0.2% with the helpers unused, and the measured per-definition cost of `db.scope` is in ADR 259.
