# Code review: TML-3443, the Postgres runtime driver returns every column as server text

Range: `origin/main...HEAD` on `leibniz-53/postgres-driver-text-only`. Round 1 reviewed 7e15f67f0b through 03937ebf77. Round 2 reviewed 03937ebf77..270215239e. Round 3 reviewed 270215239e..65a348be53. Round 4 reviews 823c86daaf. Spec: `wip/drive/TML-3443/spec.md`.

Verdict: READY FOR PR. Round 4 fixes F09: a computed projection now gets the fallback codec ref only when its codec can be built without type parameters. The new enum integration test fails without the fix and passes with it (reproduced here). No findings are open.

## Summary

Round 3 makes three changes:

- `codecRefOf(field, ctx)` now gives a codec-less projection a `{ codecId }` ref only when the composed stack registers that id (`ctx.knowsCodec`). On SQLite, which has no `pg/bool@1`, `fns.eq` and `fns.exists` again return SQLite's `1` and `0` instead of throwing `RUNTIME.CODEC_DESCRIPTOR_MISSING`.
- The mutation `returning` projection uses the same function (F07).
- The upgrade fragment gains the `point`/`circle` bullet, a corrected number bullet, a narrower driver detection rule, and a second entry for hand-built test contexts. The implementer ran the skill's extension-entry procedure, and it reproduces the arktype-json source exactly (F08).

In round 3 the guard only checked that a descriptor existed for the codec id, not whether it could be built without type parameters. That gap was F09, and round 4 (823c86daaf) closes it.

## What looks solid

- `descriptorFor` takes the bare codec id: `CodecDescriptorRegistry.descriptorFor(codecId: string)`. The registry indexes descriptors by id whether or not they take parameters (`codec-descriptor.ts` line 22). So `knowsCodec` answers correctly whether the id is registered. What it cannot answer is whether `{ codecId }` alone is enough to build the codec, and that is F09.
- The SQLite test proves the fix. With the round 2 versions of `builder-base.ts`, `mutation-impl.ts` and `sql.ts`, rebuilt, `sqlite-comparison-projections.test.ts` fails 2 of 2 with "No codec descriptor registered for codecId 'pg/bool@1'". At HEAD it passes 2 of 2. The new unit case "a computed projection whose codec id the stack does not register carries no codec" also fails on the round 2 builder (implementer log).
- F07: all three `returning` paths (insert, update, delete) now pass `ctx` and use `codecRefOf`. A column missing from `rowFields` still gets no codec. The new unit case passes on the round 2 code too, because these scopes carry storage. The implementer reports this honestly: the case guards the ref but does not show a gap, because there is none in production.
- The `raw-sql-composition.test.ts` stub change is the minimum needed. `sql()` now reads `context.codecDescriptors`, and the stub's `descriptorFor: () => undefined` stamps no fallback refs. The file's assertions are about composed SQL text, not decoding.
- The fragment's first entry:
  - The narrowed pattern `@internal/driver-postgres/runtime[\s\S]*\.query\(` needs the import and a later `.query(` call, so the four driver-wiring files no longer match.
  - The prose now says `int8` and `numeric` already arrived as text, and lists `point` and `circle`.
  - The skill's procedure (restore the base, apply the prose, compare with HEAD) found no source difference in `arktype-json/src`. That is recorded in the dispatch 3 report.
- The fragment's second entry, `sql-builder-reads-codec-descriptors`, is correct, and its prose tells a consumer exactly what to add. Its detection rule, `as unknown as ExecutionContext`, also matches casts that never reach `sql()`. That is harmless, because the prose says when to act.
- Round 2 items that still hold:
  - F01: `decodeMarkerInteger` accepts only `^-?\d+$`, which covers everything PostgreSQL prints for an `int4`. The conversion runs only when `canonical_version` is a string. A row without the key gets no key added, so the `marker-ledger-writes` tests keep their exact row shape. A number from the control driver passes through unchanged. Text that is not an integer throws a `TypeError` inside the existing `try`, so it becomes `CONTRACT.MARKER_ROW_CORRUPT` with the reason in `why`. The new runtime test reads the marker through `@internal/driver-postgres/runtime` and `createPostgresAdapter().profile.readMarker`, for both `1` and `null`.
  - F02: `codecRefOf(field)` is `field.codec ?? { codecId: field.codecId }`. It is applied at all three sites in `resolveSelectArgs`. The fallback matches what `expression.ts` already does for parameters. The integration case asserts decoded JavaScript values, `{ id: 1, isFirst: true, hasComments: true, distance: 0 }`, not just the AST.
  - F03: `intervalTextFields` tries ISO 8601 first and PostgreSQL text second. A value matching neither throws `RUNTIME.DECODE_FAILED` naming both forms. The runtime-driver test reads a real `interval` column and an `interval[]` column, including negative and mixed-sign components, and both decode.
  - D03: letting the `SyntaxError` escape is acceptable. It is what `pg/json@1` already does. The runtime wraps the error in `RUNTIME.DECODE_FAILED` with `table`, `column`, `codec` and `wirePreview`, and keeps the `SyntaxError` as `cause`. The runtime-level test asserts all of these, and the message `Failed to decode column documents.body with codec 'arktype/json@1': …not valid JSON`. Before round 2, the codec's own structured error passed through `decodeField` unchanged, so it carried no column details. The cost is small: a caller that invokes `codec.decode` directly gets a bare `SyntaxError`. The README now says what the runtime reports. `lint:throws` stays at 40 (delta 0, re-run here).
  - D05 and D06: the driver README states the guarantee in ADR 030's term "wire value", names the marker check as a codec-less reader that must parse text itself, and says `explain` passes no `types` option. I confirmed the `explain` claim in `postgres-driver.ts` lines 336-357. ADR 251 now says direct callers see every column as raw server text.
  - D07: the fragment has one change entry with a kebab-case id, a one-line summary, a whole-file detection rule, and prose that describes only consumer action. This matches the skill's format. The codec pattern uses token boundaries (`(?<![\w$])…(?![\w$])`), as the skill asks.
  - D08: `openDevDriver` and `queryRowsInMode` in `test/sql-queryable-test-utils.ts` replace three copies of the setup and row-collection code. The three test files stay separate. `queryRowsInMode` builds a fresh prepared-statement handle per call, which matches the old per-file helpers.
  - F04, F05, F06: the two stale comments are deleted, the arktype-json README names the new error, and the checklist uses `→ PASS`.
- All eleven fix commits carry both sign-offs. The diff adds no `TODO`, `any`, `@ts-expect-error` or biome suppression.

## Already addressed

| ID | Finding | Fixed in | Proving test, and the result with the fix reverted |
| --- | --- | --- | --- |
| F01 | The runtime marker check rejects a numeric `canonical_version` | 5adeb11ba4, e0706d27c4 | `adapter-postgres` `runtime-marker-read.integration.test.ts` and two `control-adapter.test.ts` cases. With `control-adapter.ts` from 03937ebf77, 3 of 3 fail (`review-r2-f01-reverted.log`). |
| F02 | sql-builder projections without a codec return text | cbbdd38ab6 | `sql-builder` `builders.test.ts`, 2 cases. With `builder-base.ts` from 03937ebf77, 2 of 2 fail (`review-r2-f02-reverted.log`). The integration case in `select.test.ts` failed before the fix (implementer log `round2-select-before.log`). |
| F03 | `pg/interval@1` flat reads fail on server text | cf0157c9ec | `target-postgres` `codecs.test.ts`, 2 cases. With `codec-helpers.ts` from 03937ebf77, 2 of 2 fail (`review-r2-f03-reverted.log`). `interval-runtime-read.integration.test.ts` passes at HEAD and failed before the fix (implementer log `round2-interval-before.log`). |
| F04 | Codec comments describe `pg`-parsed values | cf0157c9ec | Documentation only: both comments are deleted. |
| F05 | The arktype-json README does not mention the decode error | b9b592ab86 | Documentation only. |
| F06 | The checklist uses `→ passing` | b9b592ab86 | Documentation only. |
| D03 | The arktype-json decode error loses the column context | b808ebad38, 270215239e | The `arktype-json` unit case and the runtime-level case in `arktype-json-codec.driver.integration.test.ts`. With `arktype-json-codec.ts` from 03937ebf77, 2 of 2 fail (`review-r2-d03-reverted.log`). |
| D05 | The driver README overstates the guarantee and leaves out `explain` | b9b592ab86 | Documentation only. Checked against `postgres-driver.ts`. |
| D06 | ADR 251 is too narrow about direct callers | b9b592ab86 | Documentation only. |
| D07 | The upgrade fragment declares no change | b9b592ab86 | `check:upgrade-coverage` passes (re-run here). See F08 for the execution check. |
| D08 | Three copies of the driver test helpers | 99ca87a706 | Driver suite 187 of 187 (implementer log). |
| F07 | The mutation `returning` projection omits the codec fallback | 71c7819c78 | `builders.test.ts` "returning projections carry the codec of each returned column". It passes on the round 2 code too, because production scopes carry storage. It guards the ref; there was no failing production path to show. |
| F08 | The upgrade fragment was not checked by running it, and lacked `point`/`circle` | a44ff2b705 | The skill's extension-entry procedure was run in a disposable worktree. The arktype-json source matches HEAD, and the base tests fail only on the 5 cases the PR deliberately rewrote (dispatch 3 report, `round3-fragment-base-tests.log`). `check:upgrade-coverage` passes. |
| D12 | The hard-coded `pg/bool@1` fallback breaks SQLite projections | 71c7819c78, 65a348be53 | `sqlite-comparison-projections.test.ts`. With round 2 `builder-base.ts`, `mutation-impl.ts` and `sql.ts`, rebuilt, 2 of 2 fail with `No codec descriptor registered for codecId 'pg/bool@1'` (`review-r3-sqlite-reverted.log`). At HEAD 2 of 2 pass (`review-r3-sqlite-head.log`). |
| F09 | A computed projection whose codec needs type parameters fails with `RUNTIME.TYPE_PARAMS_INVALID` | 823c86daaf | `select.test.ts` "a raw expression typed by a codec that needs type parameters returns the stored text". With the 65a348be53 versions of `builder-base.ts` and `sql.ts`, rebuilt, it fails in both projects (`review-r4-select-reverted.log`). At HEAD it passes, along with `sqlite-comparison-projections`, 14 of 14 (`review-r4-select-head.log`). The `builders.test.ts` stub case fails on the old code (implementer log `round4-builders-reverted.log`). |

## Findings

No open findings.

Round 4 check of F09 (823c86daaf):

- `descriptorMaterializesWithoutTypeParams` returns true only when a descriptor is registered and either it has no `paramsSchema`, or its schema validates `{}` with no issues.
  - This is the same test the runtime applies: `validateCodecTypeParams` (resolve-codec.ts lines 53-90) validates `ref.typeParams ?? {}` and throws on issues or on a `Promise`. So a ref the lane stamps is exactly a ref the runtime can build.
  - Treating a `Promise` result as "cannot build" matches the runtime, which refuses async validators.
  - Arktype's Standard Schema `validate` is synchronous, so arktype param schemas such as `pgEnumParamsSchema` and `arktypeJsonParamsSchema` are judged by their real result.
  - A success result has no `issues` key, so `result.issues === undefined` is the right test.
- The rename is complete. `git grep knowsCodec` outside `wip/` finds nothing. The field's doc comment describes the new meaning.
- Cost: one `validate({})` per computed projection at build time, and only for fields without a codec. This is negligible.
- The fuller fix is still open: `table.columns` carrying full codec refs, so a raw expression typed by an enum column decodes through the real codec instead of returning text. The dispatch report tracks it as TML-3449 and TML-3444. It is not a regression: `main` also returns the text.

## Deferred

- The bodies of commits 148a1ec3da and 8728ca473a are hard-wrapped at about 72 columns. Fixing them would rewrite history, which is not allowed.
- Narrowing the codec wire-type unions to `string`. The spec puts this out of scope. After F03, the object branch of `pgIntervalDecode` has no producer left.
- Intervals under the `sql_standard` or `postgres_verbose` IntervalStyle still fail to decode. That was also true before this branch, because the interval parser `pg` used read only the `postgres` style. Changing it is a codec change beyond this slice.
- arktype-json rejects a JSON string that a driver has already parsed. No such driver exists in the repository.
- Making a codec-less runtime projection an error (the enforcement half of D02). The coordinator declined it for a separate ticket.
- The raw statement path has the same class of problem as F09, and it predates this branch. `rawQueryDecodeContext` (packages/2-sql/5-runtime/src/codecs/decoding.ts lines 98-123) resolves each row-spec column with `forCodecRef({ codecId: column.codecId })`, so a row spec that names an enum column's codec id without parameters already fails the same way on `origin/main`. This branch did not change it, so it is out of scope. Fixing F09 by carrying full codec refs through `table.columns` would fix both.
- A SQLite boolean codec, so that `fns.eq` on SQLite returns a boolean instead of `1`/`0` while the row type says `boolean`. This is not a regression, it needs a new codec, and the dispatch 3 report recommends a ticket.

## Probe results

### Round 4

- Revert probe: I wrote the 65a348be53 versions of `packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts` and `sql.ts` into place, ran `pnpm --filter @internal/sql-builder build`, then `pnpm test test/sql-builder/select.test.ts` from `test/integration`. Result: the new enum case failed in both projects, 10 of 12 passed (`review-r4-select-reverted.log`).
- I restored the files with `git checkout`, rebuilt, and re-ran `select` and `sqlite-comparison-projections`: 14 of 14 (`review-r4-select-head.log`). `git status` shows only `M pnpm-lock.yaml`.

### Round 3

All logs are under `wip/validation/`. `git status` shows only `M pnpm-lock.yaml`. The sql-builder dist was rebuilt from HEAD after the revert probe, and the probe test file was deleted.

- Revert probe for D12: I wrote the 270215239e versions of `builder-base.ts`, `mutation-impl.ts` and `sql.ts` into place and ran `pnpm --filter @internal/sql-builder build`, then `pnpm test test/sql-builder/sqlite-comparison-projections.test.ts` from `test/integration`. Result: 2 failed, `No codec descriptor registered for codecId 'pg/bool@1'` (`review-r3-sqlite-reverted.log`). After `git checkout` of the directory and a rebuild, `sqlite-comparison-projections`, `select` and `mutation` gave 24 of 24 across both projects (`review-r3-sqlite-head.log`).
- Required type parameters: a throwaway script validated `{}` against every Postgres descriptor's `paramsSchema`. Of 40 descriptors, only `pg/enum@1` rejects it (`review-r3-required-params.log`).
- F09 probe: a temporary `test/integration/test/sql-builder/zz-review-probe.test.ts` selected `fns.raw\`'happy'\`.returns('pg/enum@1')`. The projection gets `{"codecId":"pg/enum@1"}`, and the query fails with `RUNTIME.TYPE_PARAMS_INVALID` (`review-r3-param-probe.log`). The file was deleted afterwards.


### Round 2

All logs are under `wip/validation/`. After each revert, the file was restored with `git checkout -- <file>`. `git status` shows only `M pnpm-lock.yaml`.

- Revert probes. For each fix, I wrote the 03937ebf77 version of the one changed source file into place, ran the proving tests, and restored the file:
  - F01, `control-adapter.ts`: `pnpm --filter @internal/adapter-postgres test test/runtime-marker-read.integration.test.ts test/control-adapter.test.ts` gives 3 failed of 71: "reads canonical_version integer text as a number", "rejects canonical_version text that is not an integer…", and "reads canonical_version 1 as the stored value". The `null` case passes in both versions, as expected.
  - F02, `builder-base.ts`: `pnpm --filter @internal/sql-builder test test/runtime/builders.test.ts` gives 2 failed of 57, both new cases.
  - F03, `codec-helpers.ts`: `pnpm --filter @internal/target-postgres test test/codecs.test.ts` gives 2 failed of 63, both new cases.
  - D03, `arktype-json-codec.ts`: `pnpm --filter @internal/extension-arktype-json test` gives 2 failed of 58, the unit case and the runtime-level column-context case.
- At HEAD, after `pnpm build` (`review-r2-build.log`):
  - adapter-postgres marker and control-adapter files: 71 of 71.
  - `interval-runtime-read.integration.test.ts`: 2 of 2.
  - arktype-json: 58 of 58.
- Integration files at HEAD, each run on its own from `test/integration` (`review-r2-int-*.log`): `sql-builder/select` 10/10, `raw-sql.integration` 8/8, `extension-functions` 62/62, `execution` 6/6, `mutation` 12/12, `raw-query.integration` 16/16, `raw-prepared.integration` 6/6, `rewriting-middleware.integration` 4/4.
- `pnpm lint:throws`: current 40, merge-base 40, delta 0 (`review-r2-lint-throws.log`).
- `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD`: passes (`review-r2-upgrade-coverage.log`).
- Fragment detection: a throwaway script applied both `matches` patterns, without flags, to every tracked `packages/3-extensions/*/src/**/*.ts` file. It matched arktype-json, pgvector and postgis codecs, plus four driver-wiring files (`review-r2-detect.log`).

### Round 1


All logs are under `wip/validation/`. After every probe, the tree was restored: `git status` shows only `M pnpm-lock.yaml`, the driver was rebuilt from the branch source, and all probe files were deleted.

#### Probe 1: codec probes

Command: a temporary file `packages/3-targets/6-adapters/postgres-codec-testkit/test/zz-review-probe.integration.test.ts`, run with `mise exec -- pnpm --filter @internal/postgres-codec-testkit test test/zz-review-probe.integration.test.ts`. It stores a literal, reads it back through `@internal/driver-postgres/runtime` (URL binding, `createDevDatabase`), and calls the registry codec's `decode`. Arrays go through `parsePostgresListText` plus the element `decode`.

At HEAD (`review-codec-probe-head.log`), 40 of 43 cases pass:

- Pass: `pg/bool@1` (`t`, `f`); `pg/int2@1`; `pg/int4@1`; `pg/int@1`; `sql/int@1`; `pg/int8@1` (int8 max); `pg/int8number@1`; `pg/unboundedint@1`; `pg/float4@1` (`1.5`, `NaN`); `pg/float8@1` (`0.1`, `NaN`, `Infinity`, `-Infinity`); `sql/float@1` (`NaN`); `pg/float@1`; `pg/numeric@1` (`123.4500`, `NaN`); `pg/bytea@1` (`\x0102ff`); `pg/uuid@1`; `pg/json@1` and `pg/jsonb@1` (string, number-looking string, object, array); `pg/enum@1`; `sql/char@1`; `pg/timetz@1`; `pg/inet@1`; `pg/timestamptz-temporal@1`; `pg/date-string@1`. Arrays of bool, int4, int8, float8 (with `NaN` and `-Infinity`), numeric, bytea, uuid, jsonb and enum also pass.
- Fail: `pg/interval@1` for `interval '1 day 02:03:04'` and `interval '1 year 2 months'`, and `interval[]` (F03).

With the old policy restored (`review-codec-probe-reverted.log`), only `interval[]` fails. So the scalar interval failure is new on this branch.

Revert run. I wrote the 31cc56e942 policy body (temporal, JSON and array OIDs as text) into `src/server-text-types.ts` under the name `serverTextTypes`, then rebuilt the driver (`review-driver-build-reverted.log`).

- `driver.server-text.integration.test.ts`: 6 of 6 fail (`review-driver-tests-reverted.log`).
- `server-text-types.lazy-pg-types.test.ts`: "returns server text for every OID at runtime without touching pg.types" fails. The other three cases pass.
- `driver.json-text.integration.test.ts`: passes, because the colleague's policy already returned JSON as text.
- arktype-json, all 57 tests: pass (`review-arktype-reverted.log`). The arktype tests depend on the codec change, not on this branch's driver change, because 31cc56e942 already sends jsonb as text.
- sql-builder `execution`, `extension-functions`, `raw-sql` and my codec-less probe: 82 of 82 pass (`review-sqlbuilder-reverted.log`). This confirms that F01 and F02 are new.

I restored the file with `git checkout -- packages/3-targets/7-drivers/postgres/src/server-text-types.ts`. I did not use `git checkout -- .`, because that would also have discarded the existing `pnpm-lock.yaml` change. Then I rebuilt (`review-driver-build-restored.log`).

At HEAD, `pnpm --filter @internal/driver-postgres test` gives 187 of 187 (`review-driver-test-head.log`), and `pnpm --filter @internal/postgres-codec-testkit test` gives 240 of 240 (`review-codec-testkit.log`). The conformance suite uses `@internal/driver-postgres/control` and `decodeJson` on a JSON projection. It does not exercise runtime-driver text through `decode`.

#### Probe 2: codec-less projection cells

`decodeCtx.codecs` is filled in `buildDecodeContext` (decoding.ts lines 125-166). It gets one entry per projection item whose `item.codec` is set, through `contractCodecs.forCodecRef`. Raw statements get one entry per declared row-spec column (lines 98-123). An affected-count statement, or a missing contract codec registry, gets none.

- With the existing seeding (`review-sqlbuilder-existing.log`), every test in `execution.test.ts` and `extension-functions.test.ts` fails with `CONTRACT.MARKER_ROW_CORRUPT` (F01).
- I temporarily changed `packages/2-sql/5-runtime/test/utils.ts` line 243 to `canonicalVersion: undefined`, then reverted it. With that change, a temporary sql-builder probe plus the existing `extension-functions`, `raw-sql`, `select`, `group-by` and `subquery` files gave 12 failures out of 96 (`review-codecless-probe-nullmarker.log`). The failures were the codec-less values in the F02 table. The plans' projection items show `codec: null` for `isFirst` and `distance`.
- ORM paths, with the same temporary change: `aggregate`, `group-by`, `contributed-aggregates`, `relation-order-by`, `count-terminal-interleaving`, `raw-query.integration` and `raw-prepared.integration` give 86 of 86 (`review-orm-paths.log`). `include-codec-canonical-json.test.ts` gives 8 of 8 without the change (`review-include-canonical-json.log`).

#### Probe 3: arktype-json

Command: a temporary `packages/3-extensions/arktype-json/test/zz-review-probe.driver.integration.test.ts`, run with `mise exec -- pnpm --filter @internal/extension-arktype-json test test/zz-review-probe.driver.integration.test.ts` (`review-arktype-probe.log`). It writes jsonb through the runtime driver, then decodes each row two ways: `codec.decode(row.v)` (flat) and `codec.decodeJson(JSON.parse(json_build_object('v', v)::text).v)` (the include path).

Schemas and stored values:

- `type('string')`: `plain`, `123`, `true`, `null`, `"quoted"`, the empty string, `{"a":1}`
- `type('number')`: `0`, `123`, `-1.5`, `1e21`
- `type('boolean')`: `true`, `false`
- `type('string | number')`: `'123'`, `123`, `'x'`, `0`
- `type({ a: 'string' })`: `{a:'x'}`, `{a:'123'}`

Result: 5 of 5 pass. The flat and include results equal the stored values exactly. A stored JSON string that looks like a number (`'123'`) stays a string under both `string` and `string | number`.


## Acceptance-criteria verification

The acceptance criteria are unchanged from round 2. F09 fell outside them, because no done condition covers computed projections, and it is now fixed.

| AC | Done condition | Verdict | Evidence |
| --- | --- | --- | --- |
| AC1 | Driver integration test reads bool, int2, int4, float8 (`NaN`, `Infinity`), bytea, oid, interval, json and jsonb through buffered, cursor and named cursor on `pgClient` and `pgPool`, asserts exact server text, and asserts `pg.types` globals are unchanged | PASS | `driver.server-text.integration.test.ts`. It failed 6 of 6 with the old policy in round 1. |
| AC2 | arktype-json integration test: the string schema decodes exactly, and an object schema decodes an object. Both fail before the codec change. | WEAK | The object case passed before the codec change, so it does not show the bug. |
| AC3 | Unit test: `decode('"hello"')` returns `hello`, and `decode('not json')` rejects | PASS | The unit test and the runtime-level column-context test both fail when the fix is reverted. |
| AC4 | No reference to `temporalTextTypes` or `PG_TYPES_ARRAY_OIDS` outside the control policy's needs | PASS | Unchanged. |
| AC5 | The validation command list passes | PASS | Dispatch 3 validation table, and the re-runs here. |

| Verdict | Count |
| --- | --- |
| PASS | 4 |
| FAIL | 0 |
| NOT VERIFIED | 0 |
| WEAK | 1 |
