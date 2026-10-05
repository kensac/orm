# TML-3443 dispatch 1 report

## What changed

- `packages/3-targets/7-drivers/postgres/src/temporal-text-parsers.ts` renamed to `src/server-text-types.ts`. `serverTextTypes` returns the identity parser for every OID. `controlTextTypes` keeps its behaviour (array OIDs as text, `pg` parsing for the rest). `PG_TYPES_ARRAY_OIDS` stays, used only by the control policy. The JSON and temporal OID constants are gone.
- `src/postgres-driver.ts`: buffered, cursor and named cursor paths use `serverTextTypes`. `src/exports/control.ts`: import path only.
- `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`: `decodeWireValue` parses a string wire as JSON, then validates the parsed value. The "raw wire first" branch, its comment and the `isRuntimeError` import are removed. Text that is not JSON throws `RUNTIME.DECODE_FAILED` ("arktype-json wire value is not JSON text") with the `SyntaxError` as `cause`, matching how `serializeWire` wraps `ENCODE_FAILED`. `parseJsonText` now returns `unknown`, which removes one bare `as JsonValue` cast. No public API change.
- Driver tests that read real databases asserted `pg`-parsed numbers (`{ id: 1 }`). They now assert server text (`{ id: '1' }`) and their row type parameters say `string`: `driver.basic.test.ts` (two real-DB tests), `driver.buffered-release.integration.test.ts`, `driver.pinned-client-serialization.integration.test.ts`, `driver.prepared.integration.test.ts`, `driver.stream-portal-protection.integration.test.ts`. `driver.prepared.test.ts`: renamed import.
- `test/temporal-text-parsers.lazy-pg-types.test.ts` renamed to `test/server-text-types.lazy-pg-types.test.ts`. The array-set check is now about the control policy. The "throws for an unlisted OID" check now applies to `controlTextTypes`. A new case checks that `serverTextTypes` returns text for any OID without touching `pg.types`.
- `packages/3-targets/7-drivers/postgres/README.md`: the parser policy bullet and the "Row parser policy" section describe the text-only runtime policy and the unchanged control policy.
- `docs/architecture docs/adrs/ADR 251 - Target-owned Postgres list framing.md`: the file link and the three sentences that named `temporalTextTypes` or described the runtime allowlist now describe the new policy. This is outside the spec's file list. I changed it because the ADR linked to a file that no longer exists.
- `upgrade-instructions/pending/postgres-driver-server-text/extension/instructions.md` with `changes: []`.

## Tests added, and evidence that they failed before the fix

- `packages/3-targets/7-drivers/postgres/test/driver.server-text.integration.test.ts`: reads bool, int2, int4, float8 (1.5, NaN, Infinity, -Infinity), bytea, oid, interval, json and jsonb through buffered, cursor and named cursor on `pgClient` and `pgPool`. It asserts the exact server text and that the global `pg.types` parsers are unchanged. Run on 31cc56e942 before the driver change: all 6 cases failed on `toEqual([SERVER_TEXT])`, because `pg` returned `true`, numbers, a `Buffer`, a `PostgresInterval` and `42` (log: `wip/validation/driver-server-text-before.log`).
- `packages/3-extensions/arktype-json/test/arktype-json-codec.driver.integration.test.ts`: writes jsonb through `@internal/driver-postgres/runtime` (URL binding, `createDevDatabase`) and decodes it with the codec.
  - String schema, values `plain`, `123`, `{"not":"a document"}`: failed before the codec change with `expected [ '"plain"', '"123"', …] to deeply equal [ 'plain', '123', …]`.
  - Object schema `{ name: 'string' }`: this case **passed** before the codec change, because the old fallback `JSON.parse` already handled objects. It guards the object path after the change. It does not show the bug.
  - Log: `wip/validation/arktype-json-before.log`.
- `packages/3-extensions/arktype-json/test/arktype-json-codec.test.ts`: four old cases asserted the "raw wire first" behaviour (for example `decode('"bob"')` returned `'"bob"'`, and `decode('alice')` returned `'alice'`). They now assert JSON text semantics. The new or rewritten cases are:
  - `decode('"hello"')` returns `hello`.
  - JSON-looking strings stored as JSON strings round-trip.
  - `decode('42')` under a string schema is rejected.
  - `decode('not json')` rejects with `RUNTIME.DECODE_FAILED`, the exact message and the `SyntaxError` cause.
  - All four failed before the codec change (same log).

## Validation

| Command | Log (`wip/validation/`) | Result |
| --- | --- | --- |
| `pnpm --filter @internal/driver-postgres test` | `driver-test.log` | 187/187 passed, 19 files. Before the expectation updates, 19 failed, all of them `pg`-parsed number assertions |
| driver-postgres `typecheck` / `lint` | `driver-typecheck.log` / `driver-lint.log` | pass / pass (only existing no-bare-cast infos in files I did not touch) |
| `pnpm --filter @internal/extension-arktype-json test` | `arktype-json-test.log` | 57/57 passed, 6 files |
| arktype-json `typecheck` / `lint` | `arktype-json-typecheck.log` / `arktype-json-lint.log` | pass / pass (after an import-order fix) |
| `pnpm --filter @internal/target-postgres test` | `target-postgres-test.log` | 2914 passed, 18 skipped |
| `pnpm --filter @internal/adapter-postgres test` | `adapter-postgres-test.log` | 986 passed, 1 expected fail, 1 skipped |
| `pnpm --filter @internal/postgres-codec-testkit test` | `postgres-codec-testkit-test.log` | 240/240 |
| `pnpm --filter @internal/sql-runtime test` | `sql-runtime-test.log` | 368/368 |
| `pnpm test:packages` | `test-packages.log` | 21425 passed. 3 suites failed (see below) |
| `pnpm typecheck` | `typecheck.log` | 171/171 tasks passed |
| `pnpm build` | `build.log` | pass |
| `pnpm lint:deps` | `lint-deps.log` | no violations |
| `pnpm lint:throws` | `lint-throws.log` | delta 0 |
| `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD` | `upgrade-coverage.log` | pass |
| ports `data_types/{json,bool,int,float,bytes,decimal}` tests, each file run on its own from `test/integration` | `ports-<type>.log` | json 12/12, bool 4/4, int 4/4, float 4/4, bytes 6/6, decimal 4/4 |

The 3 suites that failed in `test:packages` are `all-shells-tarball`, `module-identity` and `cross-shell-tarball`. They failed during their scratch `pnpm install`, which refused `@vercel/detect-agent@1.2.5` with "High-risk trust downgrade (possible package takeover)". This is a registry or environment problem and has nothing to do with this change.

## Left out, and why

- I did not narrow the codec wire types. The spec puts this out of scope.
- One risk for the reviewer. In `packages/2-sql/5-runtime/src/codecs/decoding.ts`, a projection item without a codec passes the wire value through unchanged. An example is a computed expression whose projection carries no codec ref. Such a column now arrives as a string where `pg` used to give a number or boolean. Raw statements are safe, because they declare a row spec with a codec for each column. No package test or ports test failed because of this. But a full search of every computed projection was not part of this dispatch.
- Three commit bodies are hard-wrapped at about 72 columns, which breaks the "never hard-wrap" rule. I did not amend them, because rewriting history is not allowed.
- `pnpm-lock.yaml` was already modified when I started. I did not stage it.

## Commits (`git log --oneline origin/main..HEAD`)

```
03937ebf77 docs(driver-postgres): describe the server text parser policy
8728ca473a fix(arktype-json): parse wire text as JSON before validating
148a1ec3da fix(driver-postgres): return every runtime column as server text
31cc56e942 test(driver-postgres): restore passing JSON regression ports
7e15f67f0b fix(driver-postgres): preserve JSON text for codec decoding
```
