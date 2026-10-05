# TML-3443 manual QA

## What was run

`wip/qa/server-text-qa.ts` was run against a fresh dev database from `createDevDatabase()` (`@prisma/dev`). It used the public `@prisma/orm-postgres` package, with the setup the `examples/prisma-8-demo` no-emit flow uses:

- `defineContract` from `@prisma/orm-postgres/contract-builder`, with the columns from `@prisma/orm-postgres/adapter/column-types`;
- `postgres({ contract, url })` from `@prisma/orm-postgres/runtime`;
- the ORM through `db.orm.public.Sample`.

The table has these columns: jsonb (`doc`, nullable), bool, int4, float8, bytea, interval, and a native enum `mood` (`nativeEnum` with `pg.enum`). The table and the enum type were created with plain DDL through `pg`.

Command: `wip/qa/node_modules/.bin/tsx server-text-qa.ts`. `wip/qa/node_modules` is a symlink to the demo's `node_modules`. The command ran after `pnpm build` on the merged branch. Output: `wip/qa/qa-run.log`. Result: 24 passed, 0 failed.

## Cases

Each case writes through the ORM `create`, then reads back with `where(...).select(...).first()` unless the row says otherwise. Every value came back with the JavaScript type shown.

| Case | Read back as | Result |
| --- | --- | --- |
| jsonb JSON string `"standard"` | string `standard` | PASS |
| jsonb JSON string `"123"` | string `123` | PASS |
| jsonb JSON string `"true"` | string `true` | PASS |
| jsonb JSON string `"null"` | string `null` | PASS |
| jsonb JSON number `123.5` | number | PASS |
| jsonb JSON object, nested | object | PASS |
| jsonb JSON array `["standard",123,true,null]` | array | PASS |
| jsonb SQL NULL (written by the ORM as `doc: null`) | `null` | PASS |
| jsonb JSON `null` (written with `'null'::jsonb`) | `null` | PASS |
| bool `true` | `true` | PASS |
| bool `false` | `false` | PASS |
| int4 `42` | number | PASS |
| float8 `1.5` | number | PASS |
| float8 `NaN` | number `NaN` | PASS |
| bytea `[1,2,255]` | `Uint8Array` | PASS |
| interval `{ months: 14, days: 3, micros: 14706500000n }` | the same object, with micros as a bigint | PASS |
| native enum `happy` | string | PASS |
| native enum `sad` | string | PASS |
| `update ... returning`, jsonb JSON string `"standard"` (the colleague's reproduction) | string `standard` | PASS |
| `update ... returning`, jsonb JSON string `"123"` | string `123` | PASS |
| `update ... returning`, jsonb object | object | PASS |
| `update ... returning`, jsonb array | array | PASS |
| `create ... returning`, jsonb JSON string `"standard"` | string `standard` | PASS |
| `create ... returning`, bool | `true` | PASS |

## Anything surprising

- **Two kinds of null read back the same.** A jsonb SQL NULL and a stored JSON `null` both read back as `null`. That is the existing ORM behaviour, which the non-ported `json_null` port documents. This branch did not change it.
- **No other surprises.** Every value has its documented JavaScript type. The JSON strings that look like other JSON values (`"123"`, `"true"`, `"null"`) stay strings on plain reads and on `update`/`create ... returning`, which is the bug #30582 reported.
