A `jsonb` column holding the JSON string `"standard"` failed to read through the standard Postgres driver:

```ts
await db.Offer.where({ id }).update({ value: 'standard' }).returning()
// RUNTIME.DECODE_FAILED: Failed to decode column Offer.value with codec 'pg/jsonb@1':
//   Unexpected token 's', "standard" is not valid JSON
```

A stored `"123"` came back as the number `123`, `"true"` as `true`, and `"null"` as `null`.

## Decision

The runtime Postgres driver returns every column as the text Postgres sent, and codecs do all decoding. The driver no longer keeps a list of type OIDs that `pg` must not parse.

## How it works

`pg` converts each column's text wire value to a JavaScript value by looking up its type OID in `pg-types`: `t` becomes `true`, `123` a number, `{a,b}` an array, and JSON text goes through `JSON.parse`. Every Postgres codec then decodes the value again. For JSON the second decode is where the bug lived: `pg` turned the JSON string `"standard"` into the plain string `standard`, and the codec's `JSON.parse` either threw or changed the type.

The driver already overrode `pg`'s parsing per query for date and time types, and later for the 28 array OIDs `pg-types` registers. Each entry was added after a bug of this shape. `serverTextTypes` in `packages/3-targets/7-drivers/postgres/src/server-text-types.ts` now returns the identity parser for every OID, and the buffered, cursor and named cursor paths all pass it. The control driver keeps `controlTextTypes` (`pg` parsing, arrays as text) because migrations and introspection read catalog rows without codecs. `explain` passes no parser policy and keeps `pg` defaults.

## What the text policy exposed

Every Postgres codec already accepted the text form, because list elements have arrived as text since the array change. Three readers did not, and `pg`'s parsing had been covering for them. Each is fixed here with a test that fails without the fix:

- **Runtime marker check.** `readMarker` on the runtime adapter reads marker rows with no codecs, and the row schema requires `canonical_version` as a number. `decodePostgresMarkerRow` now converts integer text. Every current writer stores null, so this was latent in production, but every integration test that seeds a marker writes `1`.
- **sql-builder computed projections.** `fns.eq`, `fns.exists`, `fns.raw(...).returns(...)` and extension operations such as `cosineDistance` built projection items with no codec ref, so the runtime passed the wire value through unchanged: `true` became `'t'`. `resolveSelectArgs` and the `returning` paths now stamp `{ codecId }` from the field when the composed stack can build that codec from its id alone. The guard matters on SQLite, which registers no `pg/bool@1`, and for codecs that need type parameters such as `pg/enum@1`; both keep main's behaviour. `sql()` reads `codecDescriptors` from the execution context for this, so a hand-built test context must provide it.
- **Interval.** `pg/interval@1` only parsed ISO 8601 text, never the text Postgres prints (`1 day 02:03:04`), because `pg` had always parsed it into an object first. It now reads both.

## arktype-json

The `arktype/json@1` codec validated a string wire against its schema before falling back to `JSON.parse`, because it was written for `pg`'s pre-parsed values. With text wires, a `jsonb` column under `type('string')` would have returned `"plain"` with its JSON quotes. The codec now parses the wire text, then validates. Text that is not JSON lets the `SyntaxError` reach the runtime, which wraps it in `RUNTIME.DECODE_FAILED` with the table, column and wire preview, the same as `pg/json@1`.

## Tests

- `driver.server-text.integration.test.ts` reads `bool`, `int2`, `int4`, `float8` including `NaN` and `Infinity`, `bytea`, `oid`, `interval`, `json` and `jsonb` through buffered, cursor and named cursor paths on the client and pool bindings, asserts the exact server text, and checks the global `pg.types` parsers are untouched.
- `driver.json-text.integration.test.ts` covers the JSON value matrix and `INSERT`/`UPDATE ... RETURNING`.
- `arktype-json-codec.driver.integration.test.ts` reads string, number and object schemas through the runtime driver, and asserts the column context on a parse error.
- `runtime-marker-read.integration.test.ts`, `interval-runtime-read.integration.test.ts`, the sql-builder `select` cases for comparison, `exists`, extension and enum-typed raw projections, and `sqlite-comparison-projections.test.ts`.
- Six engine-port JSON tests that were marked as expected failures now pass, and their ledger entries are removed.

## Upgrade instructions

`upgrade-instructions/pending/postgres-driver-server-text/extension/instructions.md` tells extension authors that a Postgres codec's `decode` now receives server text, and that a hand-built `ExecutionContext` passed to `sql()` needs `codecDescriptors`.

## Follow-ups

- TML-3445: codecs declare a `string` wire type and drop the pre-parsed branches.
- TML-3446: the control driver returns server text and the control plane parses its own catalog fields.
- TML-3444: the runtime rejects a projection cell with no codec instead of passing text through.
- TML-3449: boolean results get their codec from the target and SQLite gets a boolean codec, removing the `materializesWithoutTypeParams` guard.
- TML-3447: the runtime adds column context to structured codec errors.

## Alternatives considered

- Adding only the `json` and `jsonb` OIDs to the allowlist, as #30582 first did. That fixes the reported bug, leaves the allowlist to grow one OID per bug, hides the three readers above, and regresses arktype-json string schemas.
- Catching failed `JSON.parse` calls in the codec. That still silently coerces `"123"`, `"true"` and `"null"`.
- Changing `pg`'s global parsers. That affects every consumer sharing the process.

Refs: TML-3443. Supersedes #30582, whose two commits are kept.

Agent: leibniz-53
