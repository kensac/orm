# Handover: TML-3443, Postgres runtime driver returns every column as server text

Written 2026-10-05 by agent leibniz-53 for a fresh session in a fresh worktree. Read this file first, then the PR, then the reviews under `reviews/` in this directory.

## Context, in one paragraph

A colleague's PR prisma/orm#30582 fixed a JSON decoding bug in the standard Postgres driver by adding the `json` and `jsonb` OIDs to the driver's allowlist of types that `pg` must not parse. Will and I agreed in discussion that the allowlist is the wrong shape (it grows by one OID per bug, and that patch regressed the arktype-json extension), and that the runtime driver should return every column as server text and let codecs do all decoding. Will's instruction was to do that under the Drive process. The work is done, reviewed, QA'd, and open as PR prisma/orm#30597. Will has said the scope grew more than he expected (bug fix versus refactoring) and wants a serious review before merge. That review is the next step.

## Where everything is

- PR: https://github.com/prisma/orm/pull/30597, branch `leibniz-53/postgres-driver-text-only`, pushed to the `bot` remote (`git@github-wmadden-electric:prisma/prisma.git`). Head at handover: `59d6501219` (merge of origin/main). CI auto-fix was on in the old session; turn it on again in the new session with the ccd_pr tools after binding the PR.
- Linear: TML-3443 (In Review, PR linked). Follow-ups filed: TML-3444, TML-3445, TML-3446, TML-3447, TML-3449. Their descriptions are self-contained.
- The colleague's PR #30582 is still open with Will's changes-requested review and one approval from kristof-siket. Nobody has commented on it about #30597. #30597 keeps its two commits unchanged and says it supersedes it. Closing or commenting on it is Will's call.
- Process artifacts (this directory, pushed on branch `leibniz-53/tml-3443-handover`): `spec.md`, `plan.md`, `round-2-brief.md`, `round-3-brief.md`, `dispatch-1-report.md`, `dispatch-2-report.md`, `dispatch-3-report.md` (round 4 is a section at its end), `qa-report.md`, `pr-body.md`, `reviews/system-design-review.md`, `reviews/code-review.md`. The manual QA run log is `wip/qa/qa-run.log`. The script `wip/qa/server-text-qa.ts` could not be committed (the pre-commit hook cannot re-stage a formatted file on an ignored path); it exists only in the old worktree on Will's machine, and `qa-report.md` describes what it did well enough to rewrite.
- Validation logs (`wip/validation/*.log`, 84 MB) were not pushed. Every result is summarised in the dispatch reports.
- Transcript of the old session: exported to `/Users/wmadden/Downloads/session-export-1791216008209.zip` on Will's machine (conversation plus subagent transcripts). The session is titled "leibniz-53: Evaluate PR 30582 JSON text decoding fix" in the Claude desktop app.

## What the PR contains, and why it grew

The driver change is three lines: `serverTextTypes` in `packages/3-targets/7-drivers/postgres/src/server-text-types.ts` returns the identity parser for every OID, and the buffered, cursor and named-cursor paths pass it. `controlTextTypes` (pg parsing, arrays as text) is unchanged for the control driver. `explain` passes no policy.

Everything else is what the text policy exposed. Three readers relied on `pg` parsing and `pg` had been silently covering for them:

1. The runtime marker check reads marker rows with no codecs; `canonical_version` arrives as text and the row schema wants a number. Fixed in `decodePostgresMarkerRow` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`). Latent in production (every writer stores null) but every integration test seeds `1`, so CI fails without it.
2. sql-builder computed projections (`fns.eq`, `fns.exists`, `fns.raw(...).returns(...)`, extension operations) were built with no codec ref, so the runtime passed the wire value through: `true` became `'t'`. Fixed by stamping `{ codecId }` from the field in `resolveSelectArgs` and the `returning` paths (`packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`, `mutation-impl.ts`). That fix broke SQLite (no `pg/bool@1` codec) and enum-typed raw expressions (`pg/enum@1` needs type parameters), so it is guarded: `BuilderContext.materializesWithoutTypeParams(codecId)` built in `sql.ts` from `context.codecDescriptors.descriptorFor`. Both cases keep main's behaviour. This is the part Will should look at hardest; the architect review calls it a mechanism standing in for a missing concept (a target-supplied boolean codec), tracked as TML-3449.
3. `pg/interval@1` only parsed ISO 8601 text, never the text Postgres prints. Fixed in `codec-helpers.ts` to read both.

Plus: arktype-json now parses wire text then validates and lets a `JSON.parse` `SyntaxError` reach the runtime (same as `pg/json@1`); tests for all of the above; driver README, ADR 251, arktype-json README; an upgrade fragment with two entries; shared driver test helpers; port ledgers updated for six JSON tests that now pass.

Four review rounds. Round 1 found the three readers. Round 2 found the SQLite break. Round 3 found the enum break. Round 4 verdict: READY FOR PR, no open findings.

## Validation and QA evidence

After merging origin/main: build, typecheck (171 tasks), lint on every touched package, lint:deps, lint:throws (no increase), upgrade coverage, and package suites for driver-postgres, extension-arktype-json, target-postgres, adapter-postgres, sql-builder, sql-runtime and postgres-codec-testkit all pass. The 16 sql-builder integration files, raw-query, raw-prepared, rewriting-middleware, value-objects and the ports data_types files for json, bool, int, float, bytes and decimal pass when run individually. The full integration and e2e suites were never run locally, by rule; CI runs them.

Manual QA: `wip/qa/server-text-qa.ts` runs through the public `@prisma/orm-postgres` client against a dev database with jsonb, bool, int4, float8, bytea, interval and native enum columns. 24 cases pass, including the colleague's original `update ... returning` reproduction. One pre-existing behaviour noted: SQL NULL and JSON null in a jsonb column both read back as `null`.

## Next steps

1. Bring the PR to Will for the serious review he asked for. Open with the "why it grew" section above. Expect questions on the sql-builder guard.
2. Act on his review. If he wants scope cut: the marker, sql-builder and interval fixes cannot be cut because CI fails without them. The arktype-json change cannot be cut because the text policy regresses it otherwise. Docs, the upgrade fragment and the shared test helpers are the only separable parts.
3. CI: bind the PR in the new session and turn auto-fix on. Known noise: the three tarball test suites fail locally on a registry "trust downgrade" refusal for `@vercel/detect-agent@1.2.5`; unrelated. Supabase acceptance Docker rate-limit failures are also known noise.
4. Before merge: every review thread must be resolved (merge queue requirement), including CodeRabbit's. Move TML-3443 to "Ready to be merged".
5. Tyler (Platform Architect) suggested using pg's `TypeOverrides` instead of the custom policy. My assessment, agreed with Will: it fits the control policy (would remove the one remaining `blindCast`) but not the runtime policy, because its fallback to `pg-types` is the thing we removed. The control policy is slated for deletion in TML-3446, so do nothing in this PR; if TML-3446 keeps a pg-parsed control policy, build it on `TypeOverrides` there. Will may want a reply sent to Tyler.
6. After merge: close #30582 with a pointer to #30597 (Will's call), and TML-3443 closes via the GitHub integration.

## Rules that applied, in case the new session lacks them

Use `mise exec --` for node, pnpm and git commits. Push only through the `bot` remote. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines. Never amend, squash, rebase or force-push. Never run the full integration or e2e suites locally. Subagents run on Opus. Working files stay in `wip/` inside the worktree.

## Local state at handover

The worktree `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/prisma-orm-bugfix-review-56e0fe` has one unstaged change, `pnpm-lock.yaml`, which was there before I started (it removes a stale CLI e2e fixture entry). It is not part of the PR and I did not commit it. The local branch `pr-30582` is a fetch of the colleague's PR head.
