# Slice spec: TML-3443 — the Postgres runtime driver returns every column as server text

Orphan slice. One PR. Branch `leibniz-53/postgres-driver-text-only`, based on the head of prisma/orm#30582 so the colleague's JSON tests and port restorations are kept.

## At a glance

Today the runtime driver returns server text for an allowlist of OIDs (date and time types, the 28 array OIDs that `pg-types` registers, and after #30582 `json` and `jsonb`) and lets `pg` parse every other type. Every codec then decodes again. After this slice the driver returns text for every OID, the allowlist is gone, and the arktype-json codec always parses then validates.

## Chosen design

- `packages/3-targets/7-drivers/postgres/src/temporal-text-parsers.ts` becomes a file whose runtime policy is "text for every OID": `getTypeParser` returns the identity function unconditionally. Rename the file and the export to say what they do (for example `server-text-types.ts` exporting `serverTextTypes`). `controlTextTypes` keeps its current behaviour (pg parsing, array OIDs as text) because the control plane reads catalog rows without codecs. It still needs the array OID set, so that set stays, but it is no longer part of the runtime policy.
- `postgres-driver.ts` buffered, cursor and named cursor paths use the renamed runtime policy. No other driver code changes.
- `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts` `decodeWireValue`: when the wire is a string, parse it as JSON text and validate the parsed value. Remove the "try the raw wire first" branch and its comment. A string that is not valid JSON is a decode failure with the existing error code.
- Codec wire-type unions (`string | number`, `string | boolean`, `string | JsonValue`, `Uint8Array | string`) are not narrowed in this slice. They already accept text.

## Why this is one slice

The driver change is three lines. The arktype-json change is one function. The rest is tests and the README. One reviewer can hold it in one sitting and it rolls back as a unit.

## Scope

In:

- Driver policy as above, with file and export renames.
- arktype-json decode as above.
- Tests listed under Done conditions.
- Driver README: the "Query Result Parser Policy" bullet and the paragraph under the flowchart describe the text-only runtime policy and the unchanged control policy.
- `upgrade-instructions/pending/<name>/extension/instructions.md` with `changes: []`, because `packages/3-extensions/**` changes.
- Keep the colleague's commits from #30582. The two-OID change is superseded by the all-OID policy; do not revert their commits, just build on top.

Deliberately out:

- Narrowing codec wire types in `packages/3-targets/3-targets/postgres/src/core/codecs.ts` and `codec-helpers.ts`.
- The control plane policy and `controlTextTypes` consumers.
- Any ORM runtime change. `packages/2-sql/5-runtime/src/codecs/decoding.ts` already handles text include aggregates.

## Pre-investigated edge cases

- `pg` returns `bytea` as a Buffer today; as text it is `\x` hex. `pgByteaDecodeWire` already parses hex because list elements arrive that way.
- `float4`/`float8`: `pg-types` maps `NaN`, `Infinity`, `-Infinity` text to JS numbers. `Number()` does the same. Confirm with a test.
- `int8` and `numeric` already arrive as strings from `pg`, so nothing changes for them.
- `test/temporal-text-parsers.lazy-pg-types.test.ts` asserts the array OID set matches `pg-types` registrations and that an unknown OID lookup throws under a mocked `pg`. With the identity policy the runtime lookup never touches `pg.types`. Keep the array-set assertion for the control policy. Replace the "throws" assertion with one that fits the new behaviour.
- `test/driver.temporal-text.integration.test.ts` and `test/driver.json-text.integration.test.ts` still pass unchanged; they assert text.

## Done conditions

- Driver integration test (new file or extend `driver.json-text.integration.test.ts`) reads `bool`, `int2`, `int4`, `float8` (including `NaN` and `Infinity`), `bytea`, `oid`, `interval`, `json` and `jsonb` columns through buffered, cursor and named cursor paths on both `pgClient` and `pgPool` bindings, and asserts every value is a string with the exact server text. It also asserts `pg.types.getTypeParser` globals are unchanged.
- arktype-json integration test: a `jsonb` column under `type('string')` read through `@internal/driver-postgres/runtime` (URL binding, `createDevDatabase`) decodes `plain`, `123`, and `{"not":"a document"}` to the exact stored strings. A second case with `type({ name: 'string' })` decodes an object. Both fail before the codec change (the first did, the string case returned quoted values).
- Unit test in arktype-json: `decode` of wire text `"\"hello\""` under `type('string')` returns `hello`; `decode` of `not json` rejects with `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` or the existing decode error code.
- No reference to `temporalTextTypes` or `PG_TYPES_ARRAY_OIDS` remains outside the control policy's own needs.
- Validation: `pnpm --filter @internal/driver-postgres test`, `pnpm --filter @internal/extension-arktype-json test`, `pnpm --filter @internal/target-postgres test`, `pnpm --filter @internal/adapter-postgres test`, `pnpm --filter @internal/postgres-codec-testkit test`, `pnpm --filter @internal/sql-runtime test`, typecheck and lint on each touched package, `pnpm lint:deps`, `pnpm lint:throws`, `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD` after committing. Then the integration test files under `test/integration/test/ports/engines/queries/data_types/` for json, bool, int, float, bytes and decimal, run individually from `test/integration`. Never the full integration or e2e suites.
