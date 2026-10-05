# Project plan — Migration statements

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9), plan issue [TML-3474](https://linear.app/prisma-company/issue/TML-3474) · **Shaping PR:** prisma/orm#30604 · **Working branch:** `tml-3474-migration-statements`

## Summary

Four slices. The first three stack: the statement surface with renames, then the refusal and consent model, then the scaffolded verbs and the remaining nouns. The fourth, Mongo, builds on the second and runs in parallel with the third. Each slice is one PR, stacked on the working branch until the shaping PR merges and then retargeted to `main`.

## Slices

### Slice 1 — Statements on the command line, and renames of models and fields on Postgres and SQLite

**Linear:** [TML-3475](https://linear.app/prisma-company/issue/TML-3475) · **Folder:** `slices/renames/`

**Outcome.** Both commands accept `--rename old:new` for models and fields, including a model rename across namespaces. The framework parses each statement, resolves it against the origin and destination contracts, and applies it in order to a working copy of the origin. The SQL planners emit the table or column rename and every companion rename, with names from the destination contract. `db update` resolves its origin contract from the marker hash through the snapshot store and fails every rename when it cannot. An unusable statement is an error. Non-data drops are widening. The written migration is what a user could write by hand.

**Builds on.** The planner substrate from prisma/orm#30570, without its contract section.

**Hands to.** A statement type the framework owns, parsed and resolved, delivered to every family planner as resolved entities; the working-copy mechanism statements apply to; the origin-contract resolution for `db update`; a column rename operation on both SQL targets.

### Slice 2 — Both commands refuse data loss by default, and `--delete` is the per-operation consent

**Linear:** [TML-3476](https://linear.app/prisma-company/issue/TML-3476) · **Folder:** `slices/refusal/`

**Outcome.** `migration plan` refuses any plan that loses data, with the error `db update` uses. The refusal lists each destructive operation with the statements that resolve it. `--delete` consents to one operation, for namespaces, models and fields, and replaces `--confirm` on both commands. The terminal consent question asks per operation. Upgrade fragments record both changes; the CLI README describes statements and consent.

**Builds on.** Slice 1.

**Hands to.** The refusal shape every later verb hooks its statements into; the per-operation consent model; `--confirm` gone.

### Slice 3 — Convert and backfill scaffold the placeholder migration, and the remaining nouns

**Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477) · **Folder:** `slices/convert-backfill/`

**Outcome.** `--convert` scaffolds the type change with the placeholder in the slot that carries the conversion, and `--backfill` the backfill transform; both refused on `db update`; the scaffolding stops being automatic. `--rename` on enum values and namespaces and `--convert` on a variant plan the row updates and the schema rename. `--delete` on an enum value nulls where nullable, else refuses.

**Builds on.** Slice 2.

**Hands to.** Project close-out for the SQL targets.

### Slice 4 — The same statements on MongoDB

**Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Folder:** `slices/mongo/`

**Outcome.** The Mongo planner takes the same resolved statements: collection rename, document rewrites for field and value object field renames, drops and unsets for deletes, a data transform scaffold for convert, under the slice 2 refusal and consent model. No family vocabulary enters the framework.

**Builds on.** Slice 2.

**Hands to.** Project close-out for Mongo.

## Sequencing

- **Stack:** slice 1 → slice 2 → slice 3.
- **Parallel:** slice 4 runs beside slice 3 once slice 2 has merged.

## Dependencies

- Nothing external. The shelved prisma/orm#30570 is a source to copy from, not a dependency; its branch stays as a draft.
- Users get the feature through the next published CLI release after slice 2 merges; slices 1 and 2 together are the minimum that changes behaviour a user sees.

## Close-out (required)

- [ ] Verify every project DoD item in [`spec.md`](./spec.md)
- [ ] Write the ADR and amend ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/migration-statements/**`
- [ ] Delete `projects/migration-statements/`
