# System design review: prisma/orm#30475

Reviewer lens: architect (naming, typology, layer placement, conceptual integrity). Range: `origin/main...HEAD` on `gagarin/fix-cli-contract-reference-forms` (commits `a930072e21`, `20615a96f0`, `a08c5532ac`, `b2eb5aad3f`). Spec: `wip/review/spec.md` (inferred).

## Verdict

CONCERNS. The behaviour the spec asks for is reached, and the three commands that read `@db` now agree on what it means. But the change teaches the CLI a second copy of the reserved-reference vocabulary that the parser already owns, adds a third helper for "a database with no marker is at the empty contract", and leaves the rule for which commands accept `@empty`, `@contract`, and `@db` as a target different in each command. None of these block the fix. S01, S02, and S04 are the ones worth settling before merge, because each new consumer will copy whichever shape is in place.

## The problem and the new guarantees

A contract reference is a string the user types (`--to`, `--from`, a positional) that names one contract hash. One parser, `parseContractRef` in `packages/1-framework/3-tooling/migration/src/refs/contract-ref.ts`, owns the grammar: hash, hex prefix, ref name, migration directory name, `<dir>^`, and three reserved tokens. The reserved tokens differ in what they need:

- `@empty` needs nothing. It resolves to `EMPTY_CONTRACT_HASH`.
- `@contract` needs the emitted contract's hash, passed in `ctx.contractHash`.
- `@db` needs the live database. The parser cannot read it, so it returns a placeholder (`hash: ''`, provenance `reserved-db`) and relies on each caller to check the provenance.

Before this change, `migration status` and `db migrate` called the parser without `contractHash` and never resolved `@db`, so both tokens failed or misbehaved; `db update --to @db` reached the snapshot resolver with an empty hash; and help text advertised `./path`, which no parser accepts.

After this change the system guarantees:

1. Help briefs list only the forms each command accepts (no `./path`).
2. `migration status`, `db migrate --show`, and `db migrate` resolve `@contract` offline and `@db` from the app-space marker after connecting. A database with no marker resolves `@db` to `EMPTY_CONTRACT_HASH` in all three.
3. A database that needs no change is not handed to the runner, including the case "no marker, target is the empty contract" (`planRequiresExecution` in `packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts`).
4. `db update --to` refuses the three reserved tokens before preparing the run.
5. `migration status` reports `MIGRATION.MARKER_NOT_IN_HISTORY` whenever the marker is not a graph node, with no special case for the emitted contract's hash.

Guarantee 5 is a real simplification: `isGraphNode` replaces a hand-written three-way check, and the status command now uses the same membership test as `migration ref set` and the aggregate.

## Subsystem fit and dependency direction

The layers involved:

- `@internal/migration-tools` (`packages/1-framework/3-tooling/migration`) owns the reference grammar, `ContractRef`, `EMPTY_CONTRACT_HASH`, and graph membership. It has no database access.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/ref-resolution.ts` is described in its header as "client-free contract/migration reference resolution for commands, wrapping migration-tools' parsers with the CLI error mapping".
- Command handlers (`src/orm/migrate.ts`, `src/orm/migration/status.ts`, `src/orm/db/update.ts`) and the control-api operation `migrate-show.ts` decide when to connect.

Placing `@db` resolution in the CLI is correct: only the CLI holds a connection, and the parser cannot. Dependency direction is preserved; every new import points from the CLI to migration-tools. The defects are about which layer owns the vocabulary, not about import direction (S01, S02).

## Does the change agree with itself across commands?

| Input | `migration status` | `db migrate --show` | `db migrate` | `db update` | `migration plan` |
| --- | --- | --- | --- | --- | --- |
| `--to @contract` | emitted hash | emitted hash | emitted hash | refused, `REF_WRONG_GRAMMAR` | not found (no `contractHash` passed) |
| `--to @db`, marked database | marker hash | marker hash | marker hash, no-op for app space | refused | placeholder `''` reaches resolver |
| `--to @db`, unmarked database | empty contract | empty contract | empty contract, "Already up to date" | refused | same as above |
| `--to @empty` | empty contract | empty contract | no-op or `PATH_UNREACHABLE` | refused | refused, "only valid as an origin" |
| `--from @db` | live origin | live origin | n/a | n/a | placeholder `''` |

The three commands that read `@db` agree on the unmarked database: all route through `liveMarkerRefHash`. They agree because they share one helper, which is good. They decide *whether* `@db` is in play with three separately written blocks (S03), and the target column disagrees across commands on `@empty` and `@contract` (S04, S05).

## Findings

### S01 — The reserved-token vocabulary now has two owners

Location: `packages/1-framework/3-tooling/cli/src/control-api/operations/ref-resolution.ts` (`LIVE_MARKER_REF`, `RESERVED_CONTRACT_REFS`, `isReservedContractRef`, `isLiveMarkerRef`); `packages/1-framework/3-tooling/migration/src/refs/contract-ref.ts`; `packages/1-framework/3-tooling/migration/src/refs/types.ts`.

Issue: The parser owns the tokens `@contract`, `@db`, `@empty` as string literals and reports them through provenance kinds `reserved-contract`, `reserved-db`, `reserved-empty`. The change adds a second set of the same literals in the CLI and switches detection from provenance to string comparison. The concept now has four names: the token `@db`, the provenance `reserved-db`, the CLI constant `LIVE_MARKER_REF`, and the predicate `isLiveMarkerRef`. A fifth reserved token added to the parser would not be refused by `db update` and not routed around the parser by status or migrate.

The move also removes the last CLI branch on `provenance.kind === 'reserved-db'` (the old guard in `migrate-show.ts`). The parser's placeholder `hash: ''` is still returned to four callers that do not check for it: `resolveContractRefToSnapshot` (used by `db sign` and `db update`), `migration ref set` (`operations/ref.ts`), and both `migration plan` resolvers (`operations/plan-resolution.ts`). The parser's own comment says the empty hash is "enforced by convention". After this change no caller follows that convention.

Suggestion: Make the type carry the rule. Change `ContractRef` so the `@db` case has no hash (for example a separate result variant `{ kind: 'live-marker' }` beside `{ hash, provenance }`). The compiler then forces every caller to handle it, and the commands that support `@db` branch on the parse result rather than on the raw string. If that is out of scope for this pull request, at minimum export the token constants and an `isReservedContractRef` predicate from `@internal/migration-tools/ref-resolution`, beside the parser, and have the CLI import them. Either way the CLI should not hold its own copy of the token list.

### S02 — "No marker means the empty contract" is written three ways in this diff, under a name that encodes one caller

Location: `ref-resolution.ts` (`liveMarkerRefHash`); `operations/migration-status-overlay.ts` (`originHashForStatus`, pre-existing); `operations/migrate.ts` (`planRequiresExecution`, inline `?? EMPTY_CONTRACT_HASH`); `operations/migrate-show.ts` line ~204 (the inverse, `EMPTY_CONTRACT_HASH → null`).

Issue: `liveMarkerRefHash(marker)` returns `marker?.storageHash ?? EMPTY_CONTRACT_HASH`. `originHashForStatus(markerHash)` returns `markerHash ?? EMPTY_CONTRACT_HASH`. They are the same rule. `planRequiresExecution` now inlines it a third time. The name `liveMarkerRefHash` fails the consumer-versus-essence probe: it describes the `@db` token that calls it, not what it computes. Read cold, it suggests it resolves a ref, when it maps a marker record to the contract hash the database is at. The same rule is in migration-tools already (`resolve-recorded-path.ts`, `compute-extension-space-apply-path.ts`), so it is a domain rule, not a CLI concern.

Suggestion: Add one function to migration-tools next to `EMPTY_CONTRACT_HASH`, named for what it is (for example `contractHashAtMarker(marker)`), and use it in place of `liveMarkerRefHash`, `originHashForStatus`, and the inline expression in `planRequiresExecution`. The wider sweep of the roughly ten pre-existing `?? EMPTY_CONTRACT_HASH` sites in `cli/src` and `migration/src` is a referral (see Referrals).

### S03 — Three commands decide "is the live marker involved?" with three separately written blocks

Location: `operations/migrate-show.ts` lines ~100–130; `orm/migration/status.ts` lines ~256–280; `orm/migrate.ts` lines ~359–388.

Issue: `migrate-show.ts` and `status.ts` each compute `fromLiveMarker`, `toLiveMarker`, `liveOrigin`, and `needsLiveMarker`/`needsDatabase` with the same expressions, then choose between `requireLiveDatabaseForLiveMarkerRef` and `requireLiveDatabase` with the same ternary. `migrate.ts` expresses the same decision a third way (`offlineTarget === undefined`). The call shape for the parser also differs: `migrate-show.ts` calls `parseContractRef` plus `mapRefResolutionError` directly, while `status.ts` and `migrate.ts` call the `resolveContractRef` wrapper. The commands agree today on what `@db` means because each author copied the same lines. That agreement is not held by any shared structure.

`migrate-show.ts` also keeps its older connection check (around line 208) after the new one at the top. The new one already returns when the connection is missing, so the second is unreachable. Route that to the code-review pass.

Suggestion: One helper in `ref-resolution.ts` that takes `{ from, to }` and returns `{ liveOrigin, liveTarget, needsDatabase }`, plus one function that performs the connection check for that result. Each command then reads one value instead of re-deriving it. Use `resolveContractRef` in `migrate-show.ts` so all three commands call the parser the same way.

### S04 — No single rule decides which reserved tokens a `--to` accepts

Location: `orm/migrate.ts` (`--to` brief and `resolveRequestedTarget`); `orm/migration/status.ts` (`--to` brief); `operations/migrate-show.ts`; `orm/db/update.ts`; `operations/plan-resolution.ts` (`resolveToForPlan`, pre-existing).

Issue: `migration plan --to @empty` is refused with `MIGRATION.REF_WRONG_GRAMMAR` and the message that `@empty` "is only valid as an origin". `db update --to @empty` is refused. `db migrate --to @empty`, `db migrate --show --to @empty`, and `migration status --to @empty` are accepted and advertised in help. In `db migrate`, which only replays existing migrations, a target of the empty contract can only produce "Already up to date" (empty database) or `MIGRATION.PATH_UNREACHABLE` (any marked database). The spec frames this as "the empty contract is a valid target only when the database is already there". That rule is coherent only as a description of the outcome. As a design rule it describes a target that never causes work. The same holds for `db migrate --to @db` for the app space: by construction the target equals the marker, so it is always a no-op for the app space. It still applies pending extension-space migrations, because `--to` only selects the app-space target. That is a surprising consequence of a form that looks like "do nothing".

Suggestion: Pick one rule and apply it in one place. The rule `migration plan` already uses is the clearest: `@empty` names an origin, not a target. Under that rule every `--to` refuses `@empty` through the shared wrong-grammar mapper, and `db migrate` help stops listing it. For `@db` as a `db migrate` target, either refuse it with the same mapper (it never changes the app space) or keep it and say in the help that it leaves the app space where it is. If the team prefers to accept every reserved token wherever it can be resolved, then `migration plan --to @empty` and `db update --to @contract` (S05) are the outliers to change instead. The spec's FR7 asks for the current behaviour, so this choice belongs to the spec owner. My recommendation is the "origin, not target" rule for `@empty`.

### S05 — `db update` refuses reserved tokens in the handler, while `db sign` shares the resolver and refuses them differently

Location: `orm/db/update.ts` (handler guard); `operations/contract-snapshot-resolution.ts`; `orm/db/sign.ts` (`CONTRACT_REF_BRIEF`).

Issue: `db sign` and `db update` both resolve their contract through `resolveContractRefToSnapshot`, and their help now lists the same forms. `db update` refuses `@empty`, `@db`, `@contract` with `MIGRATION.REF_WRONG_GRAMMAR` in its handler. `db sign` still lets them through to the shared resolver, where `@db` reaches it with the placeholder hash and `@empty` and `@db` end as `MIGRATION.SNAPSHOT_MISSING` (a spec non-goal) and `@contract` ends as not-found. Two commands with the same accepted grammar reject the same input with different codes. The refusal also lives in the wrong layer: the resolver is the thing that cannot handle these tokens, so the resolver should say so.

Separately, the reason given for `@contract` is not accurate. The error says reserved references name state "rather than a contract on disk", but `@contract` is the emitted `contract.json`, which is on disk and is exactly what `db update` uses when `--to` is omitted.

Suggestion: Move the refusal into `resolveContractRefToSnapshot`, expressed as a `wrong-grammar` resolution error and mapped through `mapRefResolutionError`, so `db sign` and `db update` agree without either handler knowing the token list. Decide `@contract` on its merits: either accept it in `db update` as the same as omitting `--to`, or keep refusing it with a reason that is true ("`db update --to` names a migration destination; omit `--to` for the emitted contract"). If changing `db sign`'s code is out of scope, record the divergence as known debt.

### S06 — A second constructor for `MIGRATION.REF_WRONG_GRAMMAR`, placed in shared utilities

Location: `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` (`errorUpdateTargetReservedRef`, `UPDATE_TARGET_FORMS`).

Issue: The error-reference entry describes `REF_WRONG_GRAMMAR` as "raised by the shared ref-resolution mapper". `migration plan` follows that: it builds a `wrong-grammar` resolution error and maps it. `errorUpdateTargetReservedRef` constructs the same code by hand with its own `why`, `fix`, and `meta`. The name encodes one command (`Update`), and `.cursor/rules/cli-error-handling.mdc` says a command-specific factory lives with the command, not in `src/utils/cli-errors.ts`. The error-reference edit then has to describe this site as an exception ("Also raised by `db update --to` …").

Suggestion: Follow S05: produce a `wrong-grammar` resolution error at the resolver and map it with `mapRefResolutionError`. That removes `errorUpdateTargetReservedRef` and the special paragraph in `docs/reference/error-reference.md`. If the factory stays, move it next to `db update`.

### S07 — Help briefs for the same grammar are written separately in each command

Location: `orm/db/sign.ts` (`CONTRACT_REF_BRIEF`); `orm/db/update.ts` (`--to` brief); `orm/migrate.ts` (`--to`, `--from`); `orm/migration/status.ts` (`--to`, `--from`); `orm/migration/plan.ts` (`--from`).

Issue: The root cause of the `./path` defect was that each command spelled out the form list by hand and they drifted from the parser. The change fixes every list but keeps them hand-written in six places. `CONTRACT_REF_BRIEF` is local to `sign.ts` though `update.ts` has the same list as a separate literal. Read cold, `CONTRACT_REF_BRIEF` claims to be the brief for "a contract reference" in general, but it lists only the subset without reserved tokens. The spec names this risk ("drift is caught only by reading").

Suggestion: One shared module of form lists named for the set they describe (for example the on-disk forms, and the on-disk forms plus reserved tokens), used by every command's brief. Then the next change to the grammar is one edit. A test that renders each command's help and checks the listed forms against what the command's resolver accepts would hold this in place.

### S08 — `requireLiveDatabaseForLiveMarkerRef` is not shaped like its sibling

Location: `ref-resolution.ts` (`requireLiveDatabaseForLiveMarkerRef`); `utils/cli-errors.ts` (`requireLiveDatabase`).

Issue: The sibling takes `commandName` (no `{bin}` prefix) and `retryCommand`. The new helper takes `command` with `{bin}` included, builds the retry command itself, and does not pass a `commandName` through. So the connection-required envelope carries `commandName` on one path of `db migrate --show` and not on the other. The retry command echoes only `--from`, `--to`, and `--db`, dropping other flags the user passed (`--space`, `--json`). The name is long and says how it is used rather than what it checks.

Suggestion: Give it the sibling's parameter names (`commandName`, plus the flags to echo) and pass `commandName` through. If S03 is adopted, this becomes the connection check for the shared "live marker use" result, and the name can follow from that. Retry-command completeness is a buildability question for the code-review pass.

### S09 — "The origin is live" has a third definition in the `--show` presenter

Location: `orm/migrate.ts` (`showPresentations` call, `database:` argument); `operations/migrate-show.ts` (`usedLiveMarker: liveOrigin`).

Issue: The operation now returns `usedLiveMarker`, meaning the origin came from the live marker (no `--from`, or `--from @db`). The command handler ignores it and decides whether to print the database line with `args.flags.from === undefined`. With `--from @db` the preview reads the database but does not say which one.

Suggestion: Drive the presenter from `plan.usedLiveMarker`. Correctness of the output belongs to the code-review pass; the structural point is that the operation's result should be the single source for this fact.

### S10 — `refName` now carries reserved tokens

Location: `orm/migrate.ts` (`ifDefined('refName', args.flags.to)` passed to `client.migrate`); `operations/migrate.ts` (`refName` documented as "Resolved name of the user-supplied app-space ref").

Issue: The handler passes the raw `--to` string as `refName`. Before this change that already included hashes and directory names. Now it also includes `@db`, `@contract`, and `@empty`, which then appear in `pathDecision.refName` in the JSON output. The field name and its documentation say "ref name"; the value is any contract reference. `RequestedTarget.refName` in the same handler is correctly `undefined` for non-ref targets, so the handler holds both the right value and the wrong one.

Suggestion: Pass `target.refName` when the field means a ref, or rename the field to what it is (the user's `--to` text, for diagnostics) and update its doc comment. Pre-existing in part; the change widens it.

### S11 — Test strategy proves the runner rule at unit level only

Location: `cli/test/control-api/migrate-plan-requires-execution.test.ts`; `cli/test/orm/migrate.test.ts`; `cli/test/orm/migrate-show.test.ts`; `cli/test/orm/migration-status.test.ts`.

Issue: AC7 ("`db migrate --to @db` on an unmarked database, and `--to @empty` on an empty database, do not invoke the runner") is shown only by unit tests of `planRequiresExecution`, which had to be exported for the purpose. The command tests in `migrate.test.ts` mock `client.migrate`, so they show what the handler passes in, not whether the runner is reached. No test covers `--to @empty` for `db migrate`, `db migrate --show`, or `migration status`, though all three advertise it. No test covers `db migrate --to @db` with an extension space that has pending work (S04). No test checks help text against the accepted grammar (S07). The unit test builds `PerSpacePlan` values through `as unknown as`, which the repo rules discourage.

Suggestion: Add one control-api-level test of `executeMigrate` with a fake family that records runner calls, covering the unmarked database with an empty-contract target and the declared-state plan that must still run. Add the `--to @empty` cases for whichever rule S04 settles. Keep the `planRequiresExecution` unit test if it earns its keep, but build its inputs through a typed fixture. Test mechanics go to the code-review pass.

## Names introduced or changed

| Name | Probe result | Note |
| --- | --- | --- |
| `isReservedContractRef` | Reads cold correctly. | Wrong owner; belongs beside the parser (S01). |
| `isLiveMarkerRef` | Synonym for the parser's `reserved-db`. | One concept, four names (S01). |
| `liveMarkerRefHash` | Fails consumer-versus-essence. | Names the caller, not the rule; duplicates `originHashForStatus` (S02). |
| `requireLiveDatabaseForLiveMarkerRef` | Fails symmetry with `requireLiveDatabase`. | Parameter names and envelope differ (S08). |
| `CONTRACT_REF_BRIEF` | Fails reads-cold. | Claims the general grammar, lists a subset; local to one command (S07). |
| `errorUpdateTargetReservedRef` | Encodes one consumer; wrong file. | Second constructor for a mapper-owned code (S06). |
| `resolveRequestedTarget` | Reads correctly. | Taking `RefResolutionContext` instead of loose `refs`, `graph` is an improvement. |
| `liveMarkerTarget` | Reads correctly. | Local to the handler; fine. |
| `planRequiresExecution` (exported) | Reads correctly. | Exported for a test only; rule inside should use the S02 helper. |

## Out of this lens

Buildability and correctness, for the code-review pass:

- The unreachable second connection check in `migrate-show.ts` (S03).
- Retry-command completeness in `requireLiveDatabaseForLiveMarkerRef` (S08).
- The missing database line for `--show --from @db` (S09).
- Whether `contractAt`, snapshot lookup, and `--advance-ref` behave for an `@db` target equal to `EMPTY_CONTRACT_HASH`.
- The `as unknown as PerSpacePlan` casts in the new unit test.

Learnability, for a devrel pass:

- Help for `migration status --from` ("computed offline, unless --from or --to is @db") describes the mechanism. A user wants to know when the command connects.
- Help says `@db` is "the live marker". With extension spaces it is the app space's marker only.

Scope, for the spec owner:

- Whether `@empty` and `@db` should be accepted as `db migrate` targets at all (S04). FR7 asks for the current behaviour.
- Whether to change the `ContractRef` type in migration-tools in this pull request or a follow-up (S01).
- A sweep of the pre-existing `?? EMPTY_CONTRACT_HASH` sites onto the S02 helper is follow-up work.
