# Handover: collection scopes project

**Written:** 2026-10-05, by session bragi-59 (prometheus-67's successor), just before a rate limit. **Transcript of that session:** `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prometheus-67-transcript-38822b/4e95a23c-54dc-4602-9d06-65d2f2811331.jsonl` (JSONL; grep for `"role":"user"` to read Will's messages, the rulings are all there). The operator is Will. Work with him as the brief in `~/.claude/CLAUDE.md` says: design with him, execute through the Drive process without interrupting him, run `/drive-code-review` on every slice, fix, verify, then hand to him.

## What the project is

A developer writes named queries once and uses them anywhere a collection of the model appears, with sound types. Read `spec.md` and `plan.md` in this folder, then ADR 258, ADR 259 and ADR 260. The vocabulary is final and must not be reopened:

- A **scope** is a function from a collection to a collection, as in Rails. A class method such as `published()` is a named scope. `apply(fn)` on a collection runs any function on it (chosen over `pipe`, `chain`, `tap`, `mixin`). "Step" and "fragment" are not public names.
- `db.orm.scope(fields, body)` is a scope for any model that has the declared fields, declared with the contract DSL's field builders (`field.temporal.timestamptz().optional()`) or `{ codecId, nullable }` for packages. `db.orm.public.Post.scope(body)` is a scope for one model. `orderByField(collection, name, direction, allowed)` turns a request's sort field into an order.
- Rejected by Will and not to be proposed again: a `when()` combinator; `modelStep`; declaring a scope's fields by pointing at an existing model's field; `pipe` as the name. Default scopes per model are a later discussion, after the pending work merges.

## Branches and pull requests (all on the `bot` remote; push only there)

| PR | Branch | Base | State at handover |
| --- | --- | --- | --- |
| prisma/orm#30543 design (ADR 258, 259) | `collection-chaining-and-fragments-design` | main | Approved by Will. |
| prisma/orm#30560 slice 1 (collection keeps its class, `apply`, `Scope`) | `tml-3403-collection-keeps-its-class` | design branch | Approved by Will before the formal review. A fix round from `formal-reviews/slice-1/` was in progress; see below. |
| prisma/orm#30564 slice 2 (`db.orm.scope`, `Post.scope`, `orderByField`) | `tml-3436-fragment-helpers` | slice 1 branch | Will requested changes on the old `modelStep` name (resolved, thread answered). Fix round from `formal-reviews/slice-2/` in progress, CI red; see below. |
| prisma/orm#30561 FK backing rule | `index-types-declare-foreign-key-backing` | main | Ready for Will's review, untouched. |
| prisma/orm#30562 slice 3 (weighted full-text index as index type `fullText`) | `weighted-full-text-index` | #30561's branch | Fix round from `formal-reviews/slice-3/` in progress; see below. |
| prisma/orm#30428 ADR 260 (scope builder for index types) | `model-scopes-design` | design branch | Draft. This folder lives here. Slice 4 is built from it after slices 1 and 3 merge. |

Read `git log bot/<branch>` for the current tips; implementers were told to push WIP commits before the rate limit. A commit whose message starts with `WIP:` says what is done and what is not.

## The formal reviews and the rulings

`/drive-code-review` (two passes, architect and principal engineer, personas installed at `~/.claude/skills/drive-agent-personas/`) ran on all three slices on 2026-10-05. The artifacts are in `formal-reviews/slice-{1,2,3}/`. The rulings sent to the implementers, finding by finding, are in the transcript; search it for "Rulings:" and "Ruling on F10". In short:

**Slice 1:** rename `CollectionStateOf` → `CollectionTypeStateOf`, `HasState` → `HasTypeState`, symbol `StateType` → `TypeState` (so "state" alone means the run-time `CollectionState`); keep `Scope<In, Out>` unconstrained (a one-model scope may narrow the row); fix `deleteAll` on an `Omit` receiver (TS2589); widen the upgrade entry to `distinct`/`distinctOn` explicit type arguments; ADR 258 corrections (variant records the filter fact; symbol-key reason; the TML-3434 sentence; measured numbers); a direct subtyping type test; the demo's declaration-emit test in the ordinary test run. Slice 2 must merge slice 1 after the renames land.

**Slice 2:** `allowed` required on `orderByField`; `update`, `updateAll`, `deleteAll`, `updateAndCount`, `deleteAndCount` throw `ORM.ARGUMENT_INVALID` when the collection has a limit or offset (with an upgrade entry); codec ids constrained to the contract's codecs; run-time checks on what a body returns and on `Post.scope`'s receiver; `ScopeFieldSpec` → `DeclaredField`, `ScopeRow` → `ScopeModelAccessor`, `ScopeQuery` → `ScopeCollection`, `OrderableFieldName` → `OrderableFieldNames`, module `query-fragments.ts` → `scopes.ts`; the facts type stays separate from ADR 258's state (tried, unsound); three new tests (same-shaped models in two namespaces, a namespace named `scope`, a row-keeping model scope). All of that landed in b0b3de7e81. Still open at handover: **F10**, the cost on a 200-model contract (18,182 per definition, 55,242 first use, because accepted collections were a union over every model); ruling: check the declared fields against the receiver's own model, namespace and contract only, keep every refusal in the type tests, remeasure both contracts into ADR 259. And two CI failures on b0b3de7e81: `lint:framework-vocabulary` (two lines from the new `ScalarFieldDeclaration` types in `packages/1-framework/1-core/framework-components/src/shared/column-spec.ts`; reword, do not raise the threshold) and `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts` on the new fixtures.

**Slice 3:** `accessMethod` on `IndexTypeEntry` (default the type literal; `fullText` sets `gin`) read by the schema-node conversion; `options.fields` → `weightGroups` everywhere including ADR 260's example (storage hash changes; re-emit fixtures and the demo); one validator for the weight-group rules; `options` accepts a value or a function and `resolveOptions` goes; the `fullTextIndex` TypeScript helper warns on `map:` without `where:`; a planner test that weight, order or language changes drop and recreate while a prefix change renames; the text-columns rule enforced at contract load if layering allows; object option values canonicalised before hashing; the upgrade entry says existing full-text indexes are dropped and recreated once; ADR 210's three stale sections; search document as a first-class expression deferred to slice 4.

## What to do next, in order

1. Read the WIP state of the three branches. Finish whatever the WIP commits say is unfinished. Use Opus implementers (`model: "opus"`), one per branch, in their own worktrees; brief them with the rulings above and the standing rules (below).
2. Slice 2 merges slice 1's branch after slice 1's renames are pushed.
3. One short verification pass per PR (a reviewer that re-reads the artifacts and checks each finding at the new tip), CI green, then rewrite each PR description for the end state (grounding example first, decision, what it adds, alternatives last; `Agent: <your name>` above the attribution line; no narration of earlier revisions). Mark them ready and tell Will.
4. After slices 1 and 3 merge: slice 4 (scope builder, ADR 260, spec in `slices/`; its two open points are closed in `spec.md`) through the Drive process, with `/drive-code-review`. Then manual QA across the feature, then Will's final verification. Then the default-scopes discussion.

Tickets filed so far: TML-3403, 3425–3431, 3433–3438, 3454. Deferred items are in `deferred.md`.

## Standing rules (from Will's CLAUDE.md and memory; all of them bind)

Name yourself first (`bash ~/.claude/scripts/agent-name.sh`). Push only through the `bot` remote; commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; never add AI attribution lines; never amend, rebase, squash or force-push; run node, pnpm and commits through `mise exec --`; never run `pnpm test:integration`, `test:e2e` or `test:all` in full, only single files or packages; stay inside your worktree, no `/tmp`, working files under `wip/`; no question UI, no spawn_task chips; subagents on Opus; plain English, short, no hard-wrapped markdown; PR titles `TML-NNNN: sentence`; keep the CI monitor on; do not report status while checks run; make engineering decisions yourself and bring Will only design changes, once, with a recommendation.
