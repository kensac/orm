import type { NamespaceId } from '@internal/contract/types';

/** A model: its namespace and its name as the contract source writes it, never a table name. */
export interface ModelCoordinate {
  readonly namespaceId: NamespaceId;
  readonly model: string;
}

/**
 * A field of a model, named as the contract's model names it. A MongoDB contract keys a model's
 * fields by their stored names, so there it is the stored field name.
 */
export interface FieldCoordinate extends ModelCoordinate {
  readonly field: string;
}

export interface ResolvedModelRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'model';
  readonly from: ModelCoordinate;
  readonly to: ModelCoordinate;
}

export interface ResolvedFieldRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'field';
  readonly from: FieldCoordinate;
  readonly to: FieldCoordinate;
}

/**
 * A statement resolved against the origin and destination contracts into domain coordinates:
 * `from` is a coordinate of the origin contract and `to` one of the destination contract. Each
 * member's `entity` names the kind of coordinate its sides use, so another kind of entity is a
 * further member with its own coordinate type.
 */
export type ResolvedMigrationStatement =
  | ResolvedModelRenameStatement
  | ResolvedFieldRenameStatement;

/**
 * A statement as a plan applied it: `description` is the family's text for it, written from the
 * statement's domain coordinates, and `operationCount` the number of operations it produced (zero
 * when the storage did not change).
 */
export interface AppliedMigrationStatement {
  readonly statement: ResolvedMigrationStatement;
  readonly description: string;
  readonly operationCount: number;
}
