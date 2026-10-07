# Handover: Data types own column types, after slices 1 and 2

Written 2026-10-07 by session minerva-41 (worktree `data-types-column-types-review-015bc5`), stopping at a usage limit. This file lives on branch `handover/data-types-value-ownership` (remote `bot`) with the two design documents under `projects/data-types-completion/value-ownership/`. Do not merge that branch; delete it once its contents have a home.

## Transcript

Will authorizes reading the previous session's transcript, although it is outside your worktree: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-data-types-column-types-review-015bc5/e7074612-1d96-4e34-88e8-248ff9bb4119.jsonl`. It is large; search it, do not read it whole. Subagent transcripts are in the `e7074612-1d96-4e34-88e8-248ff9bb4119/subagents/` folder beside it. The second half of the transcript is a design discussion with Will; the design documents below are its result and are the thing to read first.

## What is done

- Slice 1 (TML-3386, prisma/orm#30547) and slice 2 (TML-3388, prisma/orm#30576) are merged on `main`. Slice 2 landed as one squashed commit because the DCO app could not read its 415 commits.
- prisma/orm#30617 (golden manifest entry for the ORM client's polymorphism fixture) and prisma/orm#30626 (two sentences in the pending upgrade guide: run the data type script before any re-emit; the application logs nothing for an unsigned database) are merged.
- Will is cutting a release with `main` as it stands. The release notes should say that the `dataType` of SQLite datetime and JSON columns changes once more in the following release.

## The design change

The final reviews of slice 2 exposed that the form a value takes in the contract had two owners (the data type's `toCanonicalForm` on Postgres, the codec descriptor's on SQLite, with `canonicalFormOf` choosing). Will and I redesigned the split; Will then discussed it with Serhii and reports the direction is agreed. Read, in this order:

1. `projects/data-types-completion/value-ownership/design.md`: the design. A data type is a value we store and owns PSL syntax, the contract form, parameters and casts, and declares what it is stored as. A codec converts a `DataTypeValue` to and from the runtime value and the wire, and defines nothing. Date and time literals get tags (`` timestamptz`…` ``, `` datetime`…` ``); `sqlite/datetime` and `sqlite/json` return as data types; `canonicalFormOf` and both `toCanonicalForm` fields are deleted; codecs get `fromDataTypeValue`/`toDataTypeValue`/`fromWire`/`toWire`, data types get `fromContract`/`toContract`; verify compares storage declarations and `DataTypeValue`s.
2. `projects/data-types-completion/value-ownership/discussion-codec-and-data-type.md`: the scenario-driven version written for the Serhii discussion.

Decisions Will made in the discussion that the documents record and that are not to be reopened: no `parse()` on data types outside the tag; no cast from the text type into dates; `DataTypeValue` is the handover and only the type constructs one; `fromContract`/`toContract` as names; `DataTypeValue` as the noun until a better one appears; verify compares what the database can show (storage), not data type ids; SQLite datetime keeps `.000Z`; `String @default(json`…`)` on SQLite is dropped; `sqlite/bigint` stays deleted.

## What comes next

1. Turn `design.md` into the ADR 254 amendment (rewrite "Canonical form", "Casts", "Written values", the SQLite paragraph; retire ADR 184's claim that codecs own contract serialization) and a slice plan under `projects/data-types-completion/`, placed before slice 3. Hand both to Will for review before building anything (his standing rule: no building before design review).
2. Slice 3's plan needs one correction from the discussion: verify compares storage declarations, not data type ids; resolving a catalog text to a data type is `contract infer`'s job alone.
3. The work on hold listed in the brief that started the discussion: TML-3404 and TML-3405 close by the design; TML-3406 stays independent; TML-3394 and TML-3396 close by the tags' `parse` becoming the one place date text is read.
4. Follow-ups found on the way, to file at close-out: `apps/telemetry-backend/test/handler.test.ts` fails on `main` (expects a `Date` from a Temporal codec); `migration status --json` prints an unexpanded `{bin}`; `projects/data-types-completion/deferred.md` has the rest.

## Housekeeping for Will

Branches to delete (the auto mode classifier refuses deletes from agents): `tml-3388-merge-s1-final-wip`, `tml-3388-handover`, `data-types-completion`, and this branch once absorbed. The bot's `GH_TOKEN` was printed into a subagent transcript during QA (no file, nothing pushed); rotating it may be wise.

## Rules from Will, confirmed again this session

- Subagents on Opus (`model: "opus"`), never Fable, for implementation and review.
- Never run the full `test:integration`, `test:e2e` or `test:all` suites locally, nor several packages' whole suites at once; run test files by explicit path, one package at a time.
- Work on one slice at a time.
- Run `node`, `pnpm` and `git commit` through `mise exec --`. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines anywhere. Push only to remote `bot`. Never rebase, amend or force-push unless Will says so, and then do it yourself at once, without a backup branch.
- Working files under `wip/` in the worktree, never `/tmp`. No question UI, no `spawn_task`. Write in plain English, briefly. Do not hand Will commands to run that you can run yourself. In design discussion, take positions reasoned from the code; do not propose rules to avoid thinking a case through, and do not ask Will to decide details he does not care about.
