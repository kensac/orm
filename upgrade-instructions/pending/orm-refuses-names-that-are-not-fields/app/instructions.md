---
changes:
  - id: orm-refuses-names-that-are-not-fields
    summary: |
      The SQL ORM now throws `ORM.FIELD_UNKNOWN` when a name it reads as a field is not a field of the model: a key of `create`, `update` or `upsert` data, a `where({ ... })` shorthand key, or a `select`, `distinct`, `groupBy`, `cursor`, aggregate or `conflictOn` field. Before, an unknown name was used as a column name, so code that passed a column name (`user_id`) instead of the field name (`userId`) worked by accident. Use field names. In a `where((row) => ...)` callback, a name that is not a field now reads as `undefined`, so `row.user_id.eq(1)` throws a `TypeError`. An update through a variant collection, such as `Task.variant('bug').update({ severity })`, accepts only the base model's fields.
---

## `orm-refuses-names-that-are-not-fields`

The type checker already rejects these names, so only untyped calls are affected: JavaScript, data passed through `as never` or `as any`, and objects built from strings such as a request body passed straight to `create(...)`.

For each `ORM.FIELD_UNKNOWN` your tests or logs report, the error's `meta` names the model and the name it refused. Replace the name with the field that maps that column; the contract's `domain.namespaces.<ns>.models.<Model>.storage.fields` lists each field and its column. When the refused name is a key of data you do not control, such as a request body, pick the fields you accept before passing the data to the ORM.

A `where` callback that names a column instead of a field now fails with `TypeError: Cannot read properties of undefined`, because the callback's argument has no member for a name that is not a field. Write the field name: `where((post) => post.userId.eq(1))` instead of `post.user_id`.

An update through a collection narrowed with `variant(...)` writes the base model's fields only, as its types already say. An untyped update of a variant's own field, such as `db.orm.public.Task.variant('bug').update({ severity: 'high' } as never)`, used to write the column through the fallback and now throws `ORM.FIELD_UNKNOWN`. Remove the variant's fields from such update data.

```ts
// before: worked because the column is named user_id
await db.orm.public.Post.create({ title: 'Hello', user_id: 1 } as never);

// after
await db.orm.public.Post.create({ title: 'Hello', userId: 1 });
```
