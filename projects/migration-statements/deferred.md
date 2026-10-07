# Deferred — Migration statements

Items found during delivery that are out of the current slice's scope. Each names where it came from and what would resolve it. Transient; migrated or dropped at close-out.

## A model that keeps its name but changes its table (`@@map`) has no statement

**Found:** slice 1, dispatch 4 review (2026-10-06).

A user keeps `model User` and changes `@@map("users")` to `@@map("app_users")`. The diff shows a dropped table and a created one, exactly like a rename, but there is no model rename to state: `--rename User:User` is unresolved because the new name already exists in the origin. In `migration plan` the user can write `this.renameTable({ table: 'users', to: 'app_users' })` by hand; in `db update` there is no way to avoid the drop and create. Slice 1 refuses a field statement on such a model with `statementRejected` (D4-1) so it never plans a column rename on a table the diff then drops.

**Options:** let a same-coordinate model statement (`--rename User:User`) mean "this model's storage was renamed"; or add a storage-level statement; or accept the hand-written route for this case. Decide with the operator before slice 2 writes the refusal text, because the refusal will otherwise suggest a `--rename` that cannot resolve.

**Decided 2026-10-07 by Will:** no statement for this case in this project. Slice 2's refusal keeps slice 1's manual steps for both commands. A statement that can name storage objects rather than models and fields is wanted later; Will floated `--rename table/users:app_users` as an illustration only, and the syntax needs a critical design discussion and a survey of established prior art before anything is chosen.

## A model move across namespaces (`auth.User:public.User`)

**Found:** slice 1, dispatch 3 (2026-10-06). Resolves but is refused with `statementRejected`; needs a `set schema` operation with its working-schema step and companion names. Scheduled for slice 3 with the namespace renames (recorded in `plan.md`).

## A codec's `onFieldEvent` hook sees different events under `db update` with and without a snapshot

**Found:** slice 1, dispatch 5 review (2026-10-06). Changed by slice 2, dispatch 4 (2026-10-08).

Since slice 2, `db update` reads the origin contract from the snapshot store on every run and passes it to the planner whenever the snapshot exists, with or without statements. So field-event planning sees the prior contract and reports only real changes on every run with a snapshot; on a run without one (no marker, a marker whose hash has no snapshot, or an unreadable snapshot) it has no prior contract and reports every column as added. No codec in the repository implements `onFieldEvent` today, so nothing observable differs. If a codec starts relying on the hook under `db update`, decide what it should see when the snapshot is missing.

## Which field name a MongoDB statement uses

**Found:** slice 1, dispatch 7 review (2026-10-07). For slice 4.

On SQL a statement names the model's field (`User.fullName`), and the storage bridge maps it to a column. On MongoDB every authoring surface keys a model's `fields` by the stored name (`@map("_id")` gives `fields._id`), so a statement resolved today against a Mongo contract names the stored field (`User._id`). Slice 4 must decide whether Mongo statements name the model's field or the stored field, and make the resolver agree on both families.

## A SQLite column rename followed by a table rebuild builds the replacement index twice

**Found:** slice 1, whole-slice code review (2026-10-07), finding F04.

When one plan renames a column on SQLite and a later step rebuilds the same table, the column rename's companion index replacement (drop and create) runs, then the rebuild creates the index again. Rows are kept; one index build is wasted. Removing the companion would need the planner to rewrite statement calls after the diff, and then re-running `migration.ts` (whose `renameColumn` cannot see the later rebuild) would no longer reproduce `ops.json`. Fixing it properly needs operations that carry dependency information, which the design notes already name as a direction.
