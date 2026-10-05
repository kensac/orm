---
changes:
  - id: postgres-codecs-decode-server-text
    summary: The Postgres runtime driver now returns every column as the server's text output. A Postgres codec's `decode` receives that text for its type instead of the value `pg` used to parse, and direct `driver.query` callers receive strings.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:PostgresCodecDescriptor|definePostgresCodecs)(?![\w$])'
        - '@internal/driver-postgres/runtime[\s\S]*\.query\('
---

## `postgres-codecs-decode-server-text`

In a Postgres codec, make `decode` parse the server text for its type. Do not expect a value that `pg` parsed:

- `bool` arrives as `t` or `f`, not a boolean.
- Integer, float and `oid` values arrive as decimal text, such as `42`, `1.5`, `NaN` or `-Infinity`, not numbers. `int8` and `numeric` already arrived as text.
- `bytea` arrives as `\x` hex text, such as `\x0102ff`, not a `Buffer`.
- `interval` arrives as PostgreSQL interval text, such as `1 day 02:03:04`, not an object.
- `point` and `circle` arrive as PostgreSQL geometric text, such as `(1,2)` and `<(1,2),3>`, not objects.
- `json` and `jsonb` arrive as JSON text, so a stored JSON string keeps its quotes (`"hello"`). Parse it with `JSON.parse` before you validate it.

Code that reads rows from the runtime driver's `query` without a codec now receives these strings for every column. Convert each value it uses, for example with `Number(row.count)` or `row.flag === 't'`.
