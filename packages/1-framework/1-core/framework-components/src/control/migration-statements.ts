import type { ContractWithDomain, NamespaceId } from '@internal/contract/types';

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
 * A statement as a plan applied it: `operationIds` are the ids of the plan's operations the
 * statement accounts for, in plan order, and empty when the storage did not change.
 */
export interface AppliedMigrationStatement {
  readonly statement: ResolvedMigrationStatement;
  readonly operationIds: readonly string[];
}

function modelName(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? `${coordinate.namespaceId}.${coordinate.model}`
    : coordinate.model;
}

/**
 * The text that reports a statement, in domain names: a model or field is named with its
 * namespace only when its contract has more than one. A field is named through its model as the
 * destination contract names it, as the statement itself is written.
 */
export function describeMigrationStatement(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  if (statement.entity === 'model') {
    return `rename model "${modelName(fromContract, statement.from)}" to "${modelName(contract, statement.to)}"`;
  }
  const model = modelName(contract, statement.to);
  return `rename field "${model}.${statement.from.field}" to "${model}.${statement.to.field}"`;
}
