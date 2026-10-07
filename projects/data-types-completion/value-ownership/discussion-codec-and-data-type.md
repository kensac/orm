# Codec and DataType: what is each one for?

Discussion notes, 2026-10-07. A codec converts a value between representations. If that is all a codec does, what is a `DataType`, and which of the two owns what? This document lays out the scenarios we need to support and what each one needs, so we can settle the split against real cases rather than definitions.

## The example that started it

```prisma
model Event {
  id Int      @id
  at DateTime @default("2024-01-01T00:00:00Z")
}
```

On SQLite, that one instant is held as two texts:

| Where | Text | Written by |
| --- | --- | --- |
| `contract.json` | `"2024-01-01T00:00:00Z"` | the codec's `encodeJson`, then trimmed by a "canonical form" function |
| `DEFAULT` clause, every row | `2024-01-01T00:00:00.000Z` | the codec's `encode` |

Verify, the planner and the test kit each carry code whose only job is to make the two compare equal. The two texts exist because the form a value takes in the contract has two owners: on Postgres the data type defines it (`toCanonicalForm` on `pg/timestamptz`), on SQLite the codec does (`toCanonicalForm` on the `sqlite/datetime@1` descriptor), and a helper picks between them.

## The representations

A value passes through four representations. Every design question here is "who converts between which two".

| Representation | Example for `pg/timestamptz` | Where it lives |
| --- | --- | --- |
| PSL syntax | `@default("2024-01-01T00:00:00Z")` today; a tag such as `` timestamptz`…` `` is one option | `schema.prisma` |
| contract form | `"2024-01-01T00:00:00Z"` | `contract.json`, migration snapshots, hashes |
| runtime value | `Date`, or `Temporal.Instant`, or a string, depending on the codec the app chose | application code |
| wire | `2024-01-01 00:00:00+00` | what the driver sends and receives; also what the catalog reports for a default |

## What exists today

- **Data type** (`pg/timestamptz`, `pg/int8`, `sqlite/text`): declares the database type name and parameters (`timestamptz(p)`, catalog `timestamp(p) with time zone`), the PSL entries that read its literals, the casts it accepts from other types, and on some types a `toCanonicalForm` function that normalises text into the contract form.
- **Codec** (`pg/timestamptz@1`, `pg/timestamptz-temporal@1`): names the data type it represents; `encode`/`decode` between runtime value and wire; `encodeJson`/`decodeJson` between runtime value and contract form. On SQLite some descriptors also carry `toCanonicalForm`.
- **Cast**: a function from one type's contract form to another's, declared by the receiving type. Includes a cast from the text type into each date type, which is how a quoted string reaches a date column.

## The scenarios and what each needs

### 1. Three codecs, one column type

```prisma
createdAt DateTime            // pg/timestamptz-temporal@1 → Temporal.Instant
createdAt Timestamptz(3)      // pg/timestamptz@1          → Date
createdAt TimestamptzString   // pg/timestamptz-string@1   → string
```

All three are columns of `pg/timestamptz`. **Need:** the contract form must be the same for all three, or switching the application from `Date` to `Temporal` changes the contract hash and forces a re-sign of every database. So the contract form cannot be defined by the codec. Something shared by the three must define it.

### 2. A literal of one type at a column of another

```prisma
count BigInt @default(42)
```

`42` is classified as `pg/int4`; the column is `pg/int8`, whose contract form is digit text. **Need:** a conversion from an `int4` value to an `int8` value, with no codec involved, because no runtime value exists yet. The same need appears at function arguments (`nanoid(8)` takes a `pg/int4`) and enum members. This is what casts are for, and casts work on contract forms.

### 3. A date written in PSL

```prisma
at DateTime @default("2024-01-01T00:00:00Z")
```

Today a quoted string is a `pg/text` value, and it reaches the date column through a cast from `pg/text`, which parses it. **Need:** the user can write a date literal, and the text is read once, by one function, into the contract form. **Question for discussion:** is a cast from the text type the right mechanism, or should a date have its own syntax (a tag, `` timestamptz`…` ``) so that a quoted string is refused on a date column the way it is on a JSON column?

### 4. A JSON document written in PSL

```prisma
meta Jsonb @default(json`{"a":1}`)
```

The `json` tag's `parse` reads the body into the contract form. `Jsonb @default("{}")` is refused: a string is not a document. This is the shape scenario 3 would take with a tag.

### 5. Parameters

```prisma
price Numeric(10, 2) @default(1.234)   // must be refused
embedding pgvector.Vector(3) @default([0.1, 0.2])   // must be refused
```

**Need:** whoever constructs a value of a parameterised type must know the column's parameters. Today the check runs in the codec instance built with the parameters. A parameter the codec owns (`arktype/json@1`'s `schema`) is different: it describes the runtime value, not the stored one.

### 6. Verify reads a default back from the database

Postgres reports a column default as `'2024-01-01 00:00:00+00'::timestamp with time zone`; SQLite reports the literal the `DEFAULT` clause holds. **Need:** turn that into something comparable with the contract's default, with no PSL involved (introspection never sees a tag or a quoted literal). The body is wire text: it is exactly what the driver hands `decode` for a row. So the codec can read it (`decode`, then the runtime-to-contract conversion), and the result is in the contract form. No normalising helper is needed if every codec's runtime-to-contract conversion lands in the type's form.

### 7. SQLite stores everything as four storage classes

```prisma
at   DateTime   // stored as TEXT
meta Json       // stored as TEXT
name String     // stored as TEXT
```

`pragma_table_info` reports `TEXT` for all three. **Need:** the contract still has to know that `at` holds dates (to read and refuse literals, to compare defaults) even though the database cannot record it. Two ways to model this: three data types (`sqlite/datetime`, `sqlite/json`, `sqlite/text`) that are all stored as `text`, or one type `sqlite/text` with codecs that carry the date and JSON knowledge. The second is what exists today, and it is where the two-owner problem lives. **Question for discussion:** is "several data types stored as one database type" acceptable? It means a data type is not the database type.

### 8. Verify compares storage on SQLite

Following scenario 7 with three types: the contract says `at` is `sqlite/datetime`, stored as `text`; the catalog says `TEXT`. **Need:** verify is satisfied when the database's storage matches what the contract declares the storage to be. It does not need to recover the data type from the catalog; that is `contract infer`'s job, and on SQLite `infer` can only say `String`.

### 9. A codec from outside the repository

An extension author writes `acme/vector@1` for `pgvector/vector`. **Need:** the contract their codec produces from a TypeScript `.default()` must equal what PSL produces for the same value, or one schema gets two hashes. Whatever defines the contract form must be something the codec cannot get wrong, or at least something a test kit catches.

### 10. Mongo

Mongo data types declare BSON types instead of a DDL name; codecs convert between contract form, runtime value and BSON. **Need:** the same split, with "stored as" meaning a BSON type rather than a column type.

## What the scenarios say about the split

Reading the needs together:

- Scenarios 1, 2 and 9 say the contract form belongs to the **type**, not the codec: it must be shared across codecs, usable with no codec present, and not something a codec can define differently.
- Scenario 1 says the runtime value belongs to the **codec**: it is the only thing that differs between codecs of one type.
- Scenario 6 says the wire belongs to the **codec**, and that verify can read defaults through it.
- Scenario 7 says a data type is a *value we store*, not the database's type: on SQLite several types share one storage class. The database type is a declaration about the type (what it is stored as), not its identity.
- Scenarios 3 and 4 say literal reading belongs to the **type**, through its PSL entries, and raise the open question of whether a quoted string should reach a date column at all.

So a candidate split, for discussion:

| | Data type owns | Codec owns |
| --- | --- | --- |
| Representations | PSL syntax, contract form | runtime value, wire |
| Conversions | PSL → contract form (tag `parse`, classifier); casts between types; contract JSON ↔ a typed value | typed value ↔ runtime value; runtime value ↔ wire |
| Declares | the database type it is stored as, with parameters; the literal syntaxes it reads; the casts it accepts | the data type it represents; the runtime type it produces |
| Invariant | | its runtime-to-contract conversion lands in the type's form; the test kit asserts it by round trip |

In this split the thing that passes between the two is a **typed value**: a value together with its type and parameters, constructed only by the type, so a codec cannot hand over something the type would not store. A codec's four methods would then be: typed value → runtime, runtime → typed value, wire → runtime, runtime → wire.

## Points worth arguing about

1. **Is a data type the database type, or a value we store?** Scenario 7 forces the choice. If it is the database type, SQLite has four and the date and JSON knowledge must live in codecs. If it is a value, SQLite has more types than storage classes, and `TEXT` in the catalog maps to several of them.
2. **Does a codec define anything?** The candidate split says no: it converts, and the type defines the contract form. The alternative is that each type names one canonical codec whose conversion defines the form, with other codecs conforming to it.
3. **Quoted strings on date columns.** A cast from the text type is a parser in a cast's clothing. A tag is unambiguous but is a syntax change every schema with a date default has to make.
4. **Where parameter checks run.** In the type's constructor (which then needs the parameters) or in a codec instance built with them (which then means the type's form depends on a codec).
5. **Verify without resolving a type.** Comparing storage declarations rather than data type ids is weaker on purpose, because the database records less than the contract knows. Is that the right place to draw the line, or should the planner write something the catalog can recover (SQLite type names carry affinity and are hazardous: a column declared `JSON` stores the document `"42"` as the integer 42)?
6. **Method names.** `encode`/`decode` for the wire, and something for the contract side that reads as the same family.
