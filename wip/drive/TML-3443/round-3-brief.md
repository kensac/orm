# Round 3 brief

Reviews updated in place: wip/drive/TML-3443/reviews/code-review.md (F07, F08) and wip/drive/TML-3443/reviews/system-design-review.md (D12, D13, D14). Read the three new findings in full.

## In scope

- D12, SQLite. `BOOL_FIELD` in packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts hardcodes `pg/bool@1`. After round 2, `codecRefOf` stamps that id on `fns.eq` and `fns.exists` projections, and the runtime resolves the id at decode time. SQLite registers no `pg/bool@1`, so a SQLite select that projects such an expression may now throw `RUNTIME.CODEC_DESCRIPTOR_MISSING`. First write the test: a SQLite sql-builder select that projects `fns.eq` and `fns.exists` (find how other SQLite integration tests are set up; `grep -rln sqlite test/integration/test` lists them) and asserts the decoded booleans. Run it on the round-2 code and record the result. If it throws: the right fix is for the boolean result codec to come from the target the way aggregate results already do (see how `aggregates.resolve(...).output` supplies a codec ref), so the field carries its codec from construction and `codecRefOf`'s fallback is not needed; if that is more than a focused change, apply the minimum fix (fall back to `{ codecId }` only when the composed codec registry knows the id, or keep passthrough for an unknown id) and say in the report which you did and why. If it does not throw, say why (for example SQLite returns 0/1 and the resolver tolerates the id), keep the test, and leave the code.
- F07: packages/2-sql/4-lanes/sql-builder/src/runtime/mutation-impl.ts lines 97–105, `buildReturningProjections` uses `rowFields[col]?.codec` without the fallback. Apply the same treatment as the select sites (or whatever D12's fix becomes) and add a unit test that the returning projection carries a codec ref.
- F08: run the upgrade fragment procedure from skills-contrib/record-upgrade-instructions/SKILL.md lines 77–128 (restore packages/3-extensions to the base, apply the fragment, compare with HEAD) and write the result into wip/drive/TML-3443/dispatch-3-report.md. Add `point` and `circle` to the fragment's list of types `pg` used to parse. Narrow the detection rule if it is cheap to exclude the four driver-wiring files; otherwise leave it.

## Declined or deferred

- D13 (scopes without contract storage lose type parameters): goes to TML-3444 unless D12's fix removes `codecRefOf`, in which case say so.
- D14 (interval dispatch duplicated between `pgIntervalCanonical` and `intervalTextFields`): TML-3445.

## Validation

Same package suites as round 2 plus `pnpm --filter @internal/sql-builder test`, the SQLite integration file you add, and the sql-builder integration files individually. `pnpm typecheck`, lint on touched packages, `pnpm lint:deps`, `pnpm lint:throws`, upgrade coverage. Logs under wip/validation/round3-*.log. Small signed commits as before. Report to wip/drive/TML-3443/dispatch-3-report.md and return it.
