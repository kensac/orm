# Discussion: the data structure middleware sees is flat, and the things it needs to reason about are not

Status: discussed by Will and Serhii on 2026-10-07; the outcome is at the end. Nothing here is built, and TML-3400 does not wait on it.

## The problem in one example

```ts
await db.transaction(async (tx) => {
  await tx.orm.public.User.where({ id: 1 }).update(
    { name: 'Alicia', posts: (p) => p.create([{ title: 'Hello' }]) },
    (m) => m.annotate(invalidateAnnotation({ keys: ['user-1'] })),
  );
});
```

The user wrote one transaction containing one ORM call, and annotated the call. What the runtime runs, and what middleware sees, is four unrelated queries:

```
SELECT ... FROM "user" WHERE id = $1            scope: transaction
UPDATE "user" SET name = $1 WHERE id = $2       scope: transaction
INSERT INTO "post" ...                          scope: transaction
SELECT ... FROM "user" WHERE id = $1            scope: transaction   (read-back)
```

Each query has a plan, a `planExecutionId`, a `scope` string, and its own hook lifecycle (`beforeQuery` … `afterQuery`, and since ADR 260 `afterTransaction`). Nothing on any of them says they belong to the same ORM call, which transaction they belong to, or what the user annotated the call with. The annotation is validated by the ORM and then discarded, so the cache's write invalidation silently does nothing for this call.

This is not a nested-write corner case. Most ORM calls run more than one query: a single-row `update()` is a `SELECT` then an `UPDATE`; on a database that cannot return the modified row, every write is followed by a read-back; `delete()` with includes, `create()` on a multi-table variant, and nested writes all run several. The common case is "one user call, several queries".

## The two things middleware actually reasons about, and how we've been coping

Looking at every real middleware need we have, each one is a question about a **group of queries**, asked from inside one query:

| Middleware | Question asked from inside one query | Group it is really about |
|---|---|---|
| Cache invalidation (TML-3400) | "when are my effects final?" | the enclosing transaction |
| Cache invalidation on an ORM call | "what did the user ask to invalidate?" | the enclosing ORM call |
| Tracing (OTel, Sentry) | "which user action am I part of?" | the ORM call, and the transaction, and the request |
| Audit log | "record once per thing the user did" | the ORM call |
| Budgets, lints | "is this one statement within limits?" | none; the query itself |

Today the model has one group, the transaction, and even that is not an object. We have handled each need by hand:

- **ADR 160, `groupingKey`.** Decided a `meta.groupingKey` on every plan the ORM runs for one call. Never built. It is an id only; it carries no data about the group.
- **ADR 220, `planExecutionId`.** An id per query. Correlation within one query only.
- **ADR 260, `afterTransaction`.** The runtime walks from each query to its enclosing transaction on the query's behalf, and fires a per-query stage when that transaction ends. This is the parent walk, done inside the runtime because the query has no parent pointer. It works, and it took three review rounds to get the edge cases right (a query sent on the connection while the transaction is open, a query sent while `rollback()` is pending, a transaction that ends while a query still runs).
- **Transaction-level hooks** (begin / end). Agreed as a later `transaction` sub-object on the middleware. Not built.
- **The annotation convention** (discussed 2026-10-06, not built): a reserved annotation that the ORM writes onto every query of a call, carrying the call's annotations, so a query can read "what the thing I ran for was annotated with". It is a parent's data delivered to the child by copying, because there is no parent.

Each of these is a special case of the same missing thing.

## What is missing

The framework models a **query**: one plan, executed once, with a lifecycle. It does not model the thing the user did. An ORM call, a transaction, a batch, a request are each one unit of intent that turns into one or more queries. None of them is an object, none has a lifecycle hook of its own, and none has a place for the user's annotations.

OTel has exactly one abstraction for this, the span, and one relation, parent. A database client instrumented with OTel reports a span for the user-facing call and a child span per statement. Attributes set on the parent are the call's; attributes on the child are the statement's; nothing is copied, and the tree renders "one user action" without the tracer inferring anything from SQL text.

The proposal is the same shape: **a query may belong to a group; a group has its own annotations and its own begin and end; a group may belong to a group.** The runtime creates groups for transactions; a client creates a group for each of its calls; the framework owns the type and the lifecycle and does not know what an ORM is. The relation points from member to group, never the other way: a middleware inside a query can read its group, and a group can read its group. There are no child lists and no tree operations.

## Concrete scenarios and what each needs

These are the cases that decide the shape. For each: what happens, what the middleware needs, and what the flat model does today.

### 1. The cache invalidates after the transaction commits

An ORM single-row `update()` runs `SELECT` then `UPDATE` in a transaction of its own. The cache must not remove the cached row before `COMMIT`, or a concurrent read refills the cache with the old row.

- **Needs:** from the `UPDATE`, the outcome of the enclosing transaction.
- **Today:** solved by ADR 260 with the runtime doing the walk. Correct, but every future "ask my enclosing group" need has to be built the same way, one at a time, inside the runtime.
- **With groups:** the transaction is the query's group; `afterTransaction` is "my group ended, with this outcome". Same hook, now an instance of a general rule.

### 2. The user annotates an ORM call that runs several queries

The example at the top. The user says "invalidate `user-1` when this commits".

- **Needs:** from any of the four queries, the call's annotations, distinguishable from the query's own annotations.
- **Today:** discarded. The convention would deliver a copy on each query. Copying is wrong in general (see scenario 4) and acceptable only because `invalidate` is idempotent.
- **With groups:** the ORM call is a group with the user's annotations on it. Each query reads `group.annotations`. Nothing is copied; the cache invalidates on whichever query's end it likes, or once at the group's end.

### 3. A transaction containing ORM calls

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.update(...);   // several queries
  await tx.orm.Post.update(...);   // several queries
});
```

This is everyday code. Each query here is in a call and in a transaction, and those are different groups: the cache wants the transaction, tracing and the write annotation want the call.

- **Needs:** two levels above a query, each reachable.
- **Today:** `afterTransaction` gives the transaction; nothing gives the call.
- **With one level of grouping only:** every query gets exactly one group, and we choose which. The two middleware above want different ones. One level is not a simplification here; it is a choice of which middleware to break.
- **With a group that may belong to a group:** query → call → transaction. Each middleware walks to the level it wants.

This scenario alone decides that a group needs a parent.

### 4. Tracing wants spans, not copies

A tracer wants one span per ORM call with the queries as children, and the call's attributes on the call span only. If the call's annotations are copied onto every query (the convention), the tracer sees four queries each claiming the call's attributes, and must either de-duplicate by an id or render four spans with the same data. Copying also means a 4× payload for any annotation of real size.

- **Needs:** the call's data once, at the call; the query's data at the query; a way to know which is which.
- **Today / convention:** copies.
- **With groups:** the annotation sits on the group, read through the member. One copy, no ambiguity.

### 5. Savepoints

`db.transaction` inside `db.transaction` is documented today as a hang. The correct implementation is a savepoint: a transaction inside a transaction. ActiveRecord fires `after_commit` only when the outermost transaction commits, which requires the inner transaction to know it has an outer one.

- **Needs:** a transaction group whose parent is a transaction group, and "effects are final" meaning "the outermost ended".
- **Today:** cannot be expressed; the runtime tracks one transaction per connection.
- **With groups:** the savepoint is a group with a parent; `afterTransaction` fires at the root's end. Scenario 1's rule unchanged.

This is a known defect we will have to fix, not a hypothetical.

### 6. Once-per-call work

An audit middleware writes one record per thing the user did, not one per statement. A rate limiter counts calls, not queries.

- **Needs:** a hook that fires when the call begins and when it ends, with the call's annotations and outcome, independent of how many queries it ran (possibly zero, if the call was served from cache).
- **Today:** impossible without reconstructing "the call ended" from per-query hooks, which is the reasoning we ruled out for transactions.
- **With groups:** `begin` and `end` on the group. The transaction hooks we deferred are the same two hooks on a transaction group.

### 7. Batches and retries (plausible, not asked for)

A `createMany` chunked into several `INSERT`s, or a batch endpoint running N ORM calls as one request: batch → call → query, with annotations at each level meaning different things. A client that retries a call on a serialization failure: call → attempt → query, where tracing wants "one call, two attempts" and the cache wants "the attempt that committed".

- **Needs:** more than two levels.
- Listed so the depth question is answered by the shape (a group may belong to a group, any depth) rather than by a fixed count.

### 8. The serverless request (plausible)

The serverless client already scopes everything in a request to one connection whose `close()` waits for in-flight work. A request is a natural outermost group: its annotations (route, user) reachable from every query for audit and tracing, with the trace context attached once at the top.

## What this collapses

If the group exists, four things we have built or deferred become one concept:

| Existing thing | Becomes |
|---|---|
| ADR 160 `groupingKey` (unbuilt) | the id of a query's group |
| ADR 220 `planExecutionId` | the id of a query (a group of one, or a leaf) |
| ADR 260 `afterTransaction` | "my enclosing transaction group ended", one instance of "my group ended" |
| deferred `transaction` begin/end hooks, and call begin/end | the group's own lifecycle, on every kind of group |
| the annotation convention | `group.annotations`, read, not copied |

## What it is not

- Not a tree you walk down. A member knows its group; a group may know its group. No child lists.
- Not a runtime that knows about ORMs. The runtime creates transaction groups. A client creates its own groups and runs its queries under them. The framework owns the type and the lifecycle.
- Not OTel. The shape maps onto spans one-to-one so that an OTel middleware is a thin translation, but we do not adopt its vocabulary or its SDK.

## Open questions for the discussion

1. **Is the shape right:** a query belongs to at most one group; a group has annotations, begin and end; a group belongs to at most one group. Is "at most one" enough, given scenario 3 (a query is in a call and in a transaction, which nest cleanly) and scenario 8?
2. **Names.** "Call" and "operation" are both wrong: "call" is user-level and does not cover a transaction; "operation" is already used in ADR 220 for one query. The group needs a name that covers a query's own level, a transaction, an ORM call and a request. Candidates discussed: *execution*, *span*. Neither is settled.
3. **Who creates groups and where the parent pointer lives.** On the middleware context (`ctx.group`), or on the plan's `meta`? ADR 160 argued for the plan so that every hook sees it with no new parameters. ADR 260 put transaction membership on the runtime's bookkeeping, not on the plan, because membership is decided at execution time and the plan is reusable.
4. **How `afterTransaction` relates.** Keep it as a convenience ("my nearest transaction group ended") on top of the general group end, or make middleware walk? The cache slice (TML-3400) is written against `afterTransaction` as it ships and does not change either way.
5. **Interim.** Whether to ship the annotation convention now as the stopgap for scenario 2, knowing it becomes `group.annotations` later, or to leave multi-query calls as a documented limit until the group exists. The convention costs one reserved namespace and ORM wiring; it is discarded, not migrated, when the group lands.
6. **Cost.** This touches the middleware interface, the runtime's transaction bookkeeping, and the ORM's call sites. Weeks. Whether it is this quarter's work or a design we record now and build when scenario 5 (savepoints) forces it.

## References

- ADR 160 — Plan grouping keys for multi-statement orchestration (decided, never built)
- ADR 220 — Plan execution identity for middleware correlation
- ADR 259 — The cache middleware passes data to its store, and the store decides how to cache
- ADR 260 — Every query has an afterTransaction stage that fires when its enclosing transaction ends
- `projects/cache-invalidation-on-write/spec.md`, slice 2 (TML-3400), "Known limits"
- `packages/3-extensions/sql-orm-client/src/collection.ts`, the comment on `create()` / `update()` stating that nested-write annotations are validated and discarded

## Outcome of the discussion (2026-10-07)

Agreed:

- **It is a tree.** A query, a transaction, and a client-level grouping (an ORM call, and whatever other clients group) are all nodes. A node may have a parent, to any depth. The middleware reads its parent chain; nothing walks down.
- **The middleware interface is two hooks on a node:** enter and exit, or an equivalent pair. Every current hook is a special case: the query lifecycle is enter/exit on a query node; `afterTransaction` is "the transaction node above me exited, with this outcome"; the deferred transaction begin/end hooks are enter/exit on a transaction node; a call's begin/end are enter/exit on the client's node. One pair covers all of them.
- **Depth is arbitrary.** The transaction case and the ORM/client grouping case are the same mechanism at different levels, and nesting (a call inside a transaction, a savepoint inside a transaction, a batch of calls) needs nothing further.

Still open, to be settled when this is designed for real:

- Names, for the node and for the two hooks.
- Where a node is reached from inside a query hook (the context or the plan).
- Whether `afterTransaction` stays as a convenience on top of the general exit hook.
- When it is built. It is not part of the cache project.
