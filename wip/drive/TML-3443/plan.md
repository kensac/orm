# Slice plan: TML-3443

One implementation dispatch, then `/drive-code-review`, fix round, manual QA, PR.

## Dispatch 1 — driver policy, arktype-json decode, tests, README, upgrade fragment

Order inside the dispatch:

1. Write the failing tests first: driver text test for the non-JSON types, arktype-json integration and unit tests. Run them and record that they fail.
2. Driver: identity policy, renames, update `postgres-driver.ts` imports, fix `temporal-text-parsers.lazy-pg-types.test.ts`.
3. `pnpm --filter @internal/driver-postgres build` so downstream packages see the new dist.
4. arktype-json decode change.
5. README and upgrade fragment.
6. Validation list from spec. Save each command's output to a file under `wip/validation/` and read the file.
7. Commit in small signed commits: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines.

Model: opus. Time box: 90 minutes of work. Halt and report if any of the ports integration tests for bool, int, float, bytes or decimal fail after the driver change, since that means a consumer depends on pg parsing that the spec did not find.

## Review

`/drive-code-review` without the walkthrough. Reviewer brief must grant an execution budget and name the codec probes from `drive/calibration/dod.md`: build each value the way the driver produces it, and remove the fix to show which test fails.

## QA

Run the arktype-json example or the `examples/` app that uses JSON columns, if one exists, against a dev database. Otherwise run the ports JSON tests and the driver tests as the QA evidence.
