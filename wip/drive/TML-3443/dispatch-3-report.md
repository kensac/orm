# TML-3443 dispatch 3 report

All three items are done. The SQLite risk was real, and I applied the minimum fix. Nothing is pushed.

## D12: SQLite and the hard-coded `pg/bool@1`

### The test, run on the round-2 code

The new test is `test/integration/test/sql-builder/sqlite-comparison-projections.test.ts`. It runs a SQLite sql-builder select that projects `fns.eq` and `fns.exists`. On the round-2 code it threw `RUNTIME.CODEC_DESCRIPTOR_MISSING` ("No codec descriptor registered for codecId 'pg/bool@1'"). See `wip/validation/round3-sqlite-before.log`.

### The fix I chose

I applied the minimum fix: fall back to the codec id only when the composed stack registers it. I did not apply the brief's preferred fix, where the target supplies the boolean codec, because it is not a focused change:

- SQLite registers no boolean codec at all. Its codecs are integer, bigint, bigintnumber, real, text, blob, datetime and json. So "the target supplies the boolean codec" means adding a new SQLite codec first.
- `BooleanCodecType` is typed as `{ codecId: 'pg/bool@1' }` throughout the public `expression.ts` surface. Changing that is a type-level change to the lane.

### What changed

- `BuilderContext` has a new field, `knowsCodec(codecId)`. `sql()` builds it from `context.codecDescriptors.descriptorFor`.
- `codecRefOf(field, ctx)` returns the field's own codec ref if it has one. If not, it returns `{ codecId }` only when `knowsCodec` returns true, and `undefined` otherwise.
- On SQLite, `fns.eq` and `fns.exists` projections therefore return the integers `1` and `0` that SQLite returns, which is the same as before this branch. The test asserts exactly that.
- On Postgres, `pg/bool@1` is registered, so the round-2 behaviour stays: `true` and `false`. The `select.test.ts` integration case still passes.

### Gap that remains

The row type says `boolean`, but on SQLite the value is `1` or `0`. That was already true before this branch. Closing it needs a SQLite boolean codec plus a lane codec that comes from the target. I recommend a follow-up ticket for it.

### Proof

- The new unit case in `packages/2-sql/4-lanes/sql-builder/test/runtime/builders.test.ts` checks that a computed projection whose codec id the stack does not register carries no codec. It fails with the round-2 builder (`round3-builders-reverted.log`).
- The SQLite integration file passes 2/2 after the fix (`round3-sqlite-after.log`).

### Other changes this needed

- **Test stubs.** `sql()` now reads `context.codecDescriptors`, so hand-built stub contexts need that field:
  - `builders.test.ts`: its stub now registers `pg/bool@1`, `pg/int4@1` and `pg/text@1`.
  - `packages/3-extensions/postgres/test/raw-sql-composition.test.ts`: it failed with "Cannot read properties of undefined (reading 'descriptorFor')", so its stub now has `codecDescriptors: { descriptorFor: () => undefined }`. I found this failure with `pnpm test:packages`.
- **Upgrade fragment.** Because of the stub change, the fragment has a second entry, `sql-builder-reads-codec-descriptors`, for extension authors whose tests build such contexts.
- **D13 stays deferred.** `codecRefOf` still exists, so D13 goes to TML-3444 as the brief planned.

## F07: `buildReturningProjections`

`packages/2-sql/4-lanes/sql-builder/src/runtime/mutation-impl.ts` now passes `ctx` and uses `codecRefOf(field, ctx)`, the same treatment as the select sites. The new unit case "returning projections carry the codec of each returned column" covers insert and update `returning`. It also passes with the round-2 code, because these scopes carry storage, so it guards the codec ref but does not show the gap. This matches the reviewer's finding that no production path is wrong today.

## F08: upgrade fragment

### Edits

- Added a bullet: `point` and `circle` arrive as geometric text, such as `(1,2)` and `<(1,2),3>`.
- Corrected the number bullet. `int8` and `numeric` already arrived as text before this branch.
- Narrowed the driver detection pattern to `@internal/driver-postgres/runtime[\s\S]*\.query\(`. I ran both patterns over the tracked `.ts` files outside `test/` directories:
  - The four driver-wiring files no longer match: `postgres.ts`, `postgres-options.ts`, `postgres-serverless.ts` and `supabase.ts`.
  - The codec pattern matches arktype-json, pgvector, postgis and the Postgres target's own codec files.
  - pgvector and postgis need no change, because their types were never parsed by `pg`.

### The procedure, from `skills-contrib/record-upgrade-instructions/SKILL.md`

I ran the extension-entry procedure in a disposable `git worktree` at `wip/fragment-check`, checked out at HEAD a44ff2b705, and removed it afterwards.

1. I ran `git restore --source=origin/main -- packages/3-extensions/`.
2. I applied the prose to the restored arktype-json codec as a consumer would. Following "parse it with `JSON.parse` before you validate it", `decodeWireValue` became `validateSchema(schema, typeof wire === 'string' ? JSON.parse(wire) : wire)`. That made the old `parseJsonText` and the `isRuntimeError` import unused, so I removed them.
3. Source check: `git diff --no-index` between the restored `arktype-json/src` and HEAD's `arktype-json/src` shows no difference. The only non-test path that still differs is `arktype-json/README.md`. That is the PR's own documentation of the new error, not a consumer code change.
4. Test check: `git diff --exit-code origin/main -- 'packages/3-extensions/*/test/**'` exits 0, and there are no untracked test files.
5. Test suite: with HEAD's tests the suite passes 58/58. With the base unit test file added next to them, 5 of its cases fail (`round3-fragment-base-tests.log`). Those 5 cases assert the old "raw wire first" behaviour, for example that `'"bob"'` decodes to `'"bob"'`. This PR rewrote them on purpose, so this is the expected result.

The second entry, `sql-builder-reads-codec-descriptors`, was added after this run. It only affects test stubs, which the procedure excludes. Its only instance in this repo is the `raw-sql-composition.test.ts` stub.

## Validation

All logs are under `wip/validation/round3-*.log`.

| Command | Result |
| --- | --- |
| `pnpm build` | pass |
| driver-postgres tests | 187/187 |
| extension-arktype-json tests | 58/58 |
| target-postgres tests | 2915 passed, 18 skipped |
| adapter-postgres tests | 990 passed, 1 expected fail, 1 skipped |
| sql-builder tests | 183/183 |
| sql-runtime tests | 368/368 |
| postgres-codec-testkit tests | 242/242 |
| `@internal/postgres` `raw-sql-composition.test.ts` | 8/8 |
| `pnpm test:packages` | 21437 passed. Only the 3 tarball suites fail, on the same registry "High-risk trust downgrade" refusal as before. |
| `pnpm typecheck` | 171/171 tasks |
| lint: sql-builder, test/integration, extension-postgres | pass |
| typecheck: test/integration | pass |
| `pnpm lint:deps` | pass |
| `pnpm lint:throws` | change of 0 |
| `check:upgrade-coverage --mode pr --prev origin/main --head HEAD` | pass |
| `test/sql-builder/*.test.ts`, 16 files including the new SQLite file, each run on its own | all pass |
| raw-query, raw-prepared, rewriting-middleware, value-objects integration | 16/16, 6/6, 4/4, 12/12 |
| ports data_types json, bool, int, float, bytes, decimal | 12, 4, 4, 4, 6 and 4, all passing |

## Left out

- **Target-supplied boolean codec.** The brief's preferred D12 fix needs a new SQLite boolean codec and a type change to `BooleanCodecType`. I recommend a follow-up ticket for it, together with the gap that the row type says `boolean` while SQLite returns `1` or `0`.
- **D13** goes to TML-3444, because `codecRefOf` stays.
- **D14** goes to TML-3445.

## Commits added this round

```
65a348be53 test(postgres): give the raw-sql stub context codec descriptors
a44ff2b705 docs(upgrade): list point and circle and narrow driver detection
71c7819c78 fix(sql-builder): stamp a computed codec ref only when the stack registers it
```

## Round 4: F09, codecs that need type parameters

### The problem

`knowsCodec` returned true for any registered codec id, including ids whose descriptor needs type parameters. `pg/enum@1` is one: it requires `typeName`. So `fns.raw\`'happy'\`.returns('pg/enum@1')` was given the codec ref `{ codecId: 'pg/enum@1' }`, and decoding failed with `RUNTIME.TYPE_PARAMS_INVALID`. On main, the same query returned the stored text.

### Test first

The new case "a raw expression typed by a codec that needs type parameters returns the stored text" is in `test/integration/test/sql-builder/select.test.ts`. On HEAD 65a348be53 it failed with "Invalid typeParams for codec 'pg/enum@1': typeName must be a string (was missing)" (`wip/validation/round4-select-before.log`).

### Fix (minimum only)

- `sql()` now decides with `descriptorMaterializesWithoutTypeParams(descriptor)`. It returns true only when a descriptor is registered and either:
  - the descriptor has no `paramsSchema`, or
  - its schema accepts `{}` synchronously, with no issues.
- The `BuilderContext` field is renamed from `knowsCodec` to `materializesWithoutTypeParams`.
- `codecRefOf` uses that field. A computed result whose codec needs parameters gets no codec ref, and returns the stored text as it did on main.
- I did not do the fuller fix, where `table.columns` carries full codec refs. That stays with TML-3449 and TML-3444.

### Proof

- The integration case passes after the fix: `select.test.ts` 12/12.
- A new unit case in `builders.test.ts` uses a stub descriptor whose schema rejects `{}`, and checks that the projection carries no codec. With HEAD's `builder-base.ts` and `sql.ts` it fails (`round4-builders-reverted.log`). After the fix it passes.

### Validation

Logs are in `wip/validation/round4-*.log`.

| Command | Result |
| --- | --- |
| sql-builder package tests | 184/184 |
| sql-builder typecheck and lint | pass |
| `test/integration` lint | pass |
| All 16 `test/sql-builder` integration files, each run on its own (includes `select` 12/12 and `sqlite-comparison-projections` 2/2) | pass |
| `@internal/postgres` `raw-sql-composition.test.ts` | 8/8 |
| `pnpm typecheck` | pass |
| `pnpm lint:deps` | pass |
| `pnpm lint:throws` | change of 0 |
| Upgrade coverage | pass |

### Commit

```
823c86daaf fix(sql-builder): stamp a computed codec ref only when it needs no type parameters
```
