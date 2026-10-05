# TML-3443 dispatch 2 report

All in-scope findings are fixed. Every integration file the review named now passes when run on its own. I did not push.

## Per finding

- **F01 / D01, marker `canonical_version`.** In `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`, `decodePostgresMarkerRow` now converts a text `canonical_version` to a number. It accepts only `-?\d+`. Any other text becomes `CONTRACT.MARKER_ROW_CORRUPT`. A value that is not text, or a missing key, stays as it was. My first version added an `undefined` key, which broke `marker-ledger-writes.test.ts`. Commit e0706d27c4 fixes that.
  - Evidence: `test/runtime-marker-read.integration.test.ts` is new. It seeds a marker with `canonical_version` set to `1` and to `null`, then reads it with `createPostgresAdapter().profile.readMarker` over `@internal/driver-postgres/runtime`. Before the fix, the `1` case failed with "canonical_version must be a number or null (was a string)" (`wip/validation/round2-marker-before.log`).
  - Evidence: two new unit cases in `control-adapter.test.ts` cover `'7'` read as 7, and `'1.5'` rejected as corrupt. With the `origin/main` version of `control-adapter.ts`, both fail (`round2-control-adapter-reverted.log`).
- **F02, sql-builder projections without a codec.** In `packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`, all three `ProjectionItem.of` sites in `resolveSelectArgs` now use `codecRefOf(field)`, which is `field.codec ?? { codecId: field.codecId }`.
  - Evidence: two new unit cases in `test/runtime/builders.test.ts` check that `fns.eq` and `fns.exists` projections carry `{ codecId: 'pg/bool@1' }`. With the old `builder-base.ts`, both fail (`round2-sqlbuilder-builders-reverted.log`).
  - Evidence: a new integration case in `test/integration/test/sql-builder/select.test.ts` selects `fns.eq`, `fns.exists` and `cosineDistance` and asserts `{ id: 1, isFirst: true, hasComments: true, distance: 0 }`. Before the fix it got `isFirst: 't'` (`round2-select-before.log`).
  - The three integration tests the review named now pass: `raw-sql.integration` 8/8 and `extension-functions` 62/62.
- **F03 / F04, interval text.** In `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`, `pgIntervalDecode` reads ISO 8601 text first. Otherwise it uses `postgresIntervalFields`. If neither matches, it throws `RUNTIME.DECODE_FAILED` with the message "must be an ISO-8601 duration or PostgreSQL interval text". I deleted the two comments about values that `pg` used to parse.
  - Evidence: `packages/3-targets/6-adapters/postgres-codec-testkit/test/interval-runtime-read.integration.test.ts` is new. It reads an `interval` column and an `interval[]` column through the runtime driver, then decodes them. Both cases failed before the fix (`round2-interval-before.log`).
  - Evidence: in `packages/3-targets/3-targets/postgres/test/codecs.test.ts`, the old "rejects `1 day`" case is replaced by two cases: "reads PostgreSQL interval text" and "rejects text that is neither". Both fail with the `origin/main` helper (`round2-codecs-reverted.log`).
- **D03, arktype-json error context.** This is a deviation from the brief. The brief asked for a plain `new Error(...)` with a cause. That raised the `lint:throws` count from 40 to 41 (shown in an earlier run of `round2-lint-throws.log`), and the CI ratchet would fail. So the codec now calls `JSON.parse` directly and lets the `SyntaxError` escape, which is what `pg/json@1` does. The runtime then wraps it in `RUNTIME.DECODE_FAILED` with `table`, `column`, `codec` and `wirePreview`, and puts the `SyntaxError` on `cause`. The cost is that the user sees the JavaScript `SyntaxError` text, not the custom sentence.
  - Evidence: the unit test asserts a `SyntaxError`.
  - Evidence: a new runtime-level case in `arktype-json-codec.driver.integration.test.ts` reads a text column through the runtime driver, then runs `buildDecodeContext` and `decodeRow` from `@internal/sql-runtime/test/utils`. It asserts the error code, a message naming `documents.body`, the details and the cause. It failed against the round-1 codec, because the codec's own structured error passed through without column details (`round2-arktype-before.log`).
- **D05, driver README.** The guarantee is now stated in ADR 030's term "wire value", with interval text as one of the examples. The README also says that a reader using rows without a codec, such as the marker check, must parse the text itself. It says `explain` passes no `types` option and uses default `pg` parsing.
- **D06, ADR 251.** Line 38 now says direct driver callers see every column, arrays included, as raw server text.
- **D07, upgrade fragment.** `upgrade-instructions/pending/postgres-driver-server-text/extension/instructions.md` has one change, `postgres-codecs-decode-server-text`, with short prose. The prose covers bool, numbers, bytea, interval and JSON text, and says direct `driver.query` callers now get strings. Detection matches files that use `PostgresCodecDescriptor` or `definePostgresCodecs`, or that import `@internal/driver-postgres/runtime`. The coverage check passes.
- **D08, shared test helpers.** `openDevDriver` and `queryRowsInMode` now live in `packages/3-targets/7-drivers/postgres/test/sql-queryable-test-utils.ts`. The json-text, server-text and temporal-text files use them and stay separate.
- **F05.** The arktype-json README now names the decode error for text that is not JSON.
- **F06.** The six JSON lines in `projects/port-all-tests/checklists/engines-queries.md` now say `→ PASS`.

## Validation

All logs are under `wip/validation/`.

| Command | Log | Result |
| --- | --- | --- |
| `pnpm build` | `round2-build.log` | pass |
| driver-postgres tests | `round2-pkg-driver-postgres.log` | 187/187 |
| extension-arktype-json tests | `round2-pkg-extension-arktype-json.log` | 58/58 |
| target-postgres tests | `round2-pkg-target-postgres.log` | 2915 passed, 18 skipped |
| adapter-postgres tests | `round2-pkg-adapter-postgres.log` | 990 passed, 1 expected fail, 1 skipped |
| sql-builder tests | `round2-pkg-sql-builder.log` | 181/181 |
| sql-runtime tests | `round2-pkg-sql-runtime.log` | 368/368 |
| postgres-codec-testkit tests | `round2-pkg-postgres-codec-testkit.log` | 242/242 |
| `pnpm typecheck` | `round2-typecheck.log` | 171/171 tasks |
| `pnpm lint` in each touched package (driver, arktype-json, target-postgres, adapter-postgres, codec-testkit, sql-builder, test/integration) | `round2-*-lint.log` | pass |
| `pnpm lint:deps` | `round2-lint-deps.log` | pass |
| `pnpm lint:throws` | `round2-lint-throws.log` | delta 0 |
| `check:upgrade-coverage --mode pr --prev origin/main --head HEAD` | `round2-upgrade-coverage.log` | pass |
| `test/sql-builder/*`, 15 files, each run on its own | `round2-int-sql-builder_*.log` | all pass, including extension-functions 62/62, raw-sql 8/8 and select 10/10 |
| raw-query, raw-prepared, rewriting-middleware | `round2-int-*.log` | 16/16, 6/6, 4/4 |
| value-objects integration and e2e (single files) | `round2-int-value-objects_*.log` | 12/12, 6/6 |
| ports data_types json, bool, int, float, bytes, decimal | `round2-int-ports_*.log` | 12, 4, 4, 4, 6 and 4, all passing |

## Left out

- **D03 wording.** The custom error message was dropped, as explained under D03.
- **Upgrade fragment check.** I did not run the record-upgrade-instructions skill's step that restores `packages/3-extensions/` to `<base>`, applies the fragment, and compares the result. The fragment is prose only, and the only extension code change is arktype-json's decode, which the prose describes.
- **Interval styles.** Intervals under the `sql_standard` or `postgres_verbose` IntervalStyle still fail to decode. That was also true before this branch, because the interval parser `pg` uses reads only the `postgres` style.
- **Declined items.** D04, the enforcement half of D02, and D09 to D11 were declined, as the brief says.
- **`pnpm-lock.yaml`.** It is still modified and unstaged, as it was before this dispatch.

## Commits (`git log --oneline origin/main..HEAD`)

```
270215239e fix(arktype-json): let the JSON.parse SyntaxError reach the runtime
e0706d27c4 fix(adapter-postgres): convert canonical_version only when it is text
99ca87a706 test(driver-postgres): share driver setup and read-mode helpers
b9b592ab86 docs: describe the server text wire contract for extension authors
b808ebad38 fix(arktype-json): let the runtime add column context to JSON text errors
cf0157c9ec fix(target-postgres): decode PostgreSQL interval text
cbbdd38ab6 fix(sql-builder): give every select projection a codec ref
5adeb11ba4 fix(adapter-postgres): read marker canonical_version from server text
03937ebf77 docs(driver-postgres): describe the server text parser policy
8728ca473a fix(arktype-json): parse wire text as JSON before validating
148a1ec3da fix(driver-postgres): return every runtime column as server text
31cc56e942 test(driver-postgres): restore passing JSON regression ports
7e15f67f0b fix(driver-postgres): preserve JSON text for codec decoding
```
