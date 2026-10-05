# Round 2 brief: fix review findings

Reviews: wip/drive/TML-3443/reviews/code-review.md (F01–F06) and wip/drive/TML-3443/reviews/system-design-review.md (D01–D11). Read both in full before starting.

## In scope, fix now

- F01 / D01: runtime marker reader. Decode `canonical_version` in `decodePostgresMarkerRow` (packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts) from text to number when it is a string, next to the `invariants` conversion. Add a runtime-adapter test that reads a marker with `canonical_version = 1` through the runtime driver (the way `packages/2-sql/5-runtime/test/utils.ts` `writeTestContractMarker` writes it). Then run the integration files the review names as failing: test/integration/test/sql-builder/*, raw-query, raw-prepared, rewriting-middleware, value-objects, each individually, and record the results.
- F02: sql-builder projections without a codec. At the three `ProjectionItem.of` sites in `resolveSelectArgs` (packages/2-sql/4-lanes/sql-builder/src/builder-base.ts around lines 316–356) use `field.codec ?? { codecId: field.codecId }` so every projection carries a codec ref. Add tests that select `fns.eq`, `fns.exists` and an extension operation and assert decoded JavaScript values (`true`, numbers), not text. The failing files the review names (raw-sql.integration "rawSql in aliased select…", "rawSql with a literal scalar…", extension-functions "fullTextRank normalizes…") must pass.
- F03 / F04: `pgIntervalDecode` in packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts must read Postgres interval text such as `1 day 02:03:04` using the existing `postgresIntervalFields`, keeping ISO 8601 text working. Add a flat-read test through the runtime driver (a real `interval` column read and decoded). Delete the two comments at codec-helpers.ts lines 473–478 and 509 that describe values `pg` used to parse.
- D03: `parseJsonText` in arktype-json throws a plain `Error` with message `arktype-json wire value is not JSON text` and `cause` set, so the runtime wraps it with table, column and wire preview. Update the unit test to assert the message and cause, and add a runtime-level test (through `@internal/driver-postgres/runtime` plus the runtime decode, or the ORM, whichever is cheaper in that package) that the error carries the column context. If a runtime-level test is not reachable from the arktype-json package, say so and keep the unit test.
- D05: driver README. Say that `explain` passes no `types` option and uses `pg` default parsing. State the guarantee in ADR 030's term: the text `query` yields is the wire value every Postgres codec decodes.
- D06: ADR 251 line 38: direct driver callers see every column as raw text, not only registered array columns.
- D07: upgrade fragment. Replace `changes: []` with one change entry plus short prose: a Postgres codec written by an extension author now receives the server text for its type instead of the value `pg` used to parse (bool `t`/`f`, numbers as decimal text, bytea as `\x` hex, interval text, JSON text), and direct `driver.query` callers receive strings. Follow the shape of other fragments under upgrade-instructions/pending/ and the record-upgrade-instructions skill at skills-contrib/record-upgrade-instructions/SKILL.md. Re-run `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD` after committing.
- D08: move the shared `openDriver` and `rows` helpers from the json-text, server-text and temporal-text driver integration tests into packages/3-targets/7-drivers/postgres/test/sql-queryable-test-utils.ts. Keep the three files separate.
- F05: arktype-json README lists the decode error for text that is not JSON.
- F06: projects/port-all-tests/checklists/engines-queries.md lines 219–223 and 225 use `→ PASS` like the rest of the file.

## Declined, do not do

- D04 rename of `controlTextTypes` and the file: the control-plane follow-up deletes that policy, so renaming now is churn.
- D02 enforcement (making a codec-less runtime projection an error): new ticket, after this PR.
- D09, D10, D11: named follow-ups.

## Validation, in addition to the spec list

Each integration file individually from test/integration: sql-builder/*, raw-query, raw-prepared, rewriting-middleware, value-objects, extension-functions, raw-sql, and the ports data_types files for json, bool, int, float, bytes, decimal. Package suites for driver-postgres, extension-arktype-json, target-postgres, adapter-postgres, sql-builder, sql-runtime, postgres-codec-testkit. `pnpm typecheck`, `pnpm lint` on touched packages, `pnpm lint:deps`, `pnpm lint:throws`, upgrade coverage. Save every output under wip/validation/round2-*.log.

Commit in small signed commits as before. Write the report to wip/drive/TML-3443/dispatch-2-report.md: per finding, what changed and which test proves it; validation table; anything left out.
