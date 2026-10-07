import type { NamespaceId } from '@internal/contract/types';

export interface ModelCoordinate {
  readonly namespace: NamespaceId;
  readonly model: string;
}

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
 * A statement the user gave on the command line, resolved against the origin
 * and destination contracts into domain coordinates. `from` is a coordinate of
 * the origin contract and `to` a coordinate of the destination contract.
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
