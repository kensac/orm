import type { Contract, ContractWithDomain, ModelStorageBase } from '@internal/contract/types';
import type {
  AppliedStatement,
  FieldCoordinate,
  MigrationOperationClass,
  MigrationOperationPolicy,
  ModelCoordinate,
  ResolvedFieldRename,
  ResolvedModelRename,
  ResolvedStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type SqlModelStorage, type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { controlPolicyForCall } from './control-policy';
import type { ResolvedColumnRename } from './resolve-column-rename';
import type { ResolvedTableRename } from './resolve-table-rename';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';

/** Where a model's rows live: a table in a storage namespace. */
export interface ModelTable {
  readonly namespaceId: string;
  readonly table: string;
}

/** What a model rename does to storage. */
export type ModelStorageEffect =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'renameTable'; readonly rename: ResolvedTableRename }
  | { readonly kind: 'moveNamespace'; readonly from: ModelTable; readonly to: ModelTable };

/** What a field rename does to storage. */
export type FieldStorageEffect =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'renameColumn';
      /** The origin model's table, as the origin contract names it. */
      readonly table: ModelTable;
      readonly from: string;
      readonly to: string;
    };

/** A model the contract stores in no table, so a statement on it has no storage effect. */
export interface NoTable {
  readonly kind: 'noTable';
  readonly model: ModelCoordinate;
}

/** A field stored in a column on one side of a statement only, which no rename can map. */
export interface ColumnOnOneSide {
  readonly kind: 'columnOnOneSide';
}

function isSqlModelStorage(storage: ModelStorageBase): storage is SqlModelStorage {
  return (
    typeof storage['table'] === 'string' &&
    typeof storage['namespaceId'] === 'string' &&
    typeof storage['fields'] === 'object' &&
    storage['fields'] !== null
  );
}

/** The storage of a model the contract stores in a table, or `undefined` for any other model. */
function sqlModelStorage(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): SqlModelStorage | undefined {
  const storage =
    contract.domain.namespaces[coordinate.namespace]?.models[coordinate.model]?.storage;
  return storage !== undefined && isSqlModelStorage(storage) ? storage : undefined;
}

function modelTable(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ModelTable | undefined {
  const storage = sqlModelStorage(contract, coordinate);
  return storage === undefined
    ? undefined
    : { namespaceId: storage.namespaceId, table: storage.table };
}

/**
 * The storage effect of a model rename: the origin model's table compared with the destination
 * model's. Equal tables mean the rename needs no storage change.
 */
export function modelRenameStorageEffect(
  statement: ResolvedModelRename,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): Result<ModelStorageEffect, NoTable> {
  const from = modelTable(fromContract, statement.from);
  if (from === undefined) return notOk({ kind: 'noTable', model: statement.from });
  const to = modelTable(contract, statement.to);
  if (to === undefined) return notOk({ kind: 'noTable', model: statement.to });
  if (from.namespaceId !== to.namespaceId) return ok({ kind: 'moveNamespace', from, to });
  if (from.table === to.table) return ok({ kind: 'unchanged' });
  return ok({
    kind: 'renameTable',
    rename: { namespaceId: from.namespaceId, from: from.table, to: to.table },
  });
}

function fieldColumn(
  contract: ContractWithDomain,
  coordinate: FieldCoordinate,
): string | undefined {
  const fields = sqlModelStorage(contract, coordinate)?.fields;
  return fields !== undefined && Object.hasOwn(fields, coordinate.field)
    ? fields[coordinate.field]?.column
    : undefined;
}

/**
 * The storage effect of a field rename: the origin field's column compared with the destination
 * field's. A relation field has no column on either side, and equal columns need no change.
 */
export function fieldRenameStorageEffect(
  statement: ResolvedFieldRename,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): Result<FieldStorageEffect, NoTable | ColumnOnOneSide> {
  const table = modelTable(fromContract, statement.from);
  if (table === undefined) return notOk({ kind: 'noTable', model: statement.from });
  const from = fieldColumn(fromContract, statement.from);
  const to = fieldColumn(contract, statement.to);
  if (from === undefined && to === undefined) return ok({ kind: 'unchanged' });
  if (from === undefined || to === undefined) return notOk({ kind: 'columnOnOneSide' });
  if (from === to) return ok({ kind: 'unchanged' });
  return ok({ kind: 'renameColumn', table, from, to });
}

function modelName(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? `${coordinate.namespace}.${coordinate.model}`
    : coordinate.model;
}

/**
 * The text that reports a statement, in domain names: a model or field is named with its
 * namespace only when its contract has more than one. A field is named through its model as the
 * destination contract names it, as the statement itself is written.
 */
export function describeStatement(
  statement: ResolvedStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  if (statement.entity === 'model') {
    return `rename model "${modelName(fromContract, statement.from)}" to "${modelName(contract, statement.to)}"`;
  }
  const model = modelName(contract, statement.to);
  return `rename field "${model}.${statement.from.field}" to "${model}.${statement.to.field}"`;
}

/** What a target supplies for planning statements against its working schema. */
export interface StatementPlanningTarget<TCall> {
  /** The tables of the working schema as earlier statements have left it. */
  tables(): SchemaTables;
  /** The call that renames a table, with its companions, computed against the working schema. */
  renameCall(rename: ResolvedTableRename): TCall;
  /** The call that renames a column, with its companions, computed against the working schema. */
  renameColumnCall(rename: ResolvedColumnRename): TCall;
  /** Applies a call to the working schema. */
  apply(call: TCall): void;
  operationCount(call: TCall): number;
  /** The class of each operation the call produces: the call's own and its companions'. */
  operationClasses(call: TCall): readonly MigrationOperationClass[];
}

export interface PlannedStatements<TCall> {
  readonly calls: readonly TCall[];
  readonly renames: readonly ResolvedTableRename[];
  readonly columnRenames: readonly ResolvedColumnRename[];
  readonly appliedStatements: readonly AppliedStatement[];
}

interface ConflictLocation extends ModelTable {
  readonly column?: string;
}

const DRIFTED =
  'so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.';

function rejected(
  statement: ResolvedStatement,
  summary: string,
  why: string,
  location: ConflictLocation | undefined,
  refusedOperationClass?: MigrationOperationClass,
): SqlPlannerConflict {
  return {
    kind: 'statementRejected',
    summary,
    why,
    statement,
    ...(refusedOperationClass === undefined ? {} : { refusedOperationClass }),
    ...(location === undefined
      ? {}
      : {
          location: {
            namespaceId: location.namespaceId,
            entityKind: 'table',
            entityName: location.table,
            ...(location.column === undefined ? {} : { column: location.column }),
          },
        }),
  };
}

function qualified(coordinate: ModelCoordinate): string {
  return `${coordinate.namespace}.${coordinate.model}`;
}

function tableControlPolicy(contract: Contract<SqlStorage>, table: ModelTable) {
  const node = contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table];
  return controlPolicyForCall(
    {
      namespaceId: table.namespaceId,
      entityKind: 'table',
      entityName: table.table,
      ...(StorageTable.is(node) && node.control !== undefined
        ? { explicitNodeControlPolicy: node.control }
        : {}),
      createsNewObject: false,
    },
    contract.defaultControlPolicy,
  );
}

function tableKey(table: ModelTable): string {
  return JSON.stringify([table.namespaceId, table.table]);
}

class StatementPlanner<TCall> {
  readonly #fromContract: Contract<SqlStorage>;
  readonly #contract: Contract<SqlStorage>;
  readonly #policy: MigrationOperationPolicy;
  readonly #target: StatementPlanningTarget<TCall>;
  /** The name each table renamed so far has in the working schema, keyed by its origin name. */
  readonly #renamedTables = new Map<string, string>();
  readonly calls: TCall[] = [];
  readonly renames: ResolvedTableRename[] = [];
  readonly columnRenames: ResolvedColumnRename[] = [];

  constructor(input: {
    readonly fromContract: Contract<SqlStorage>;
    readonly contract: Contract<SqlStorage>;
    readonly policy: MigrationOperationPolicy;
    readonly target: StatementPlanningTarget<TCall>;
  }) {
    this.#fromContract = input.fromContract;
    this.#contract = input.contract;
    this.#policy = input.policy;
    this.#target = input.target;
  }

  /** Plans one statement; the result is its number of operations. */
  plan(statement: ResolvedStatement): Result<number, SqlPlannerConflict> {
    return statement.entity === 'model' ? this.#planModel(statement) : this.#planField(statement);
  }

  #controlPolicyRefusal(
    statement: ResolvedStatement,
    label: string,
    destinationTable: ModelTable,
  ): SqlPlannerConflict | undefined {
    const controlPolicy = tableControlPolicy(this.#contract, destinationTable);
    if (controlPolicy === 'managed') return undefined;
    return rejected(
      statement,
      `${label}: the table's control policy is "${controlPolicy}"`,
      `Statements rename only tables, and columns of tables, whose control policy is "managed"; table "${destinationTable.table}" is "${controlPolicy}". Make the change in the database yourself and leave out this statement.`,
      destinationTable,
    );
  }

  #emit(
    statement: ResolvedStatement,
    label: string,
    location: ConflictLocation,
    call: TCall,
  ): Result<number, SqlPlannerConflict> {
    const refused = this.#target
      .operationClasses(call)
      .find((operationClass) => !this.#policy.allowedOperationClasses.includes(operationClass));
    if (refused !== undefined) {
      return notOk(
        rejected(
          statement,
          `${label}: the plan does not allow "${refused}" operations`,
          `The rename produces a "${refused}" operation, and this command plans only ${this.#policy.allowedOperationClasses.map((c) => `"${c}"`).join(', ')} operations. Leave out this statement, or make the change with a command that allows "${refused}" operations, such as migration plan.`,
          location,
          refused,
        ),
      );
    }
    this.#target.apply(call);
    this.calls.push(call);
    return ok(this.#target.operationCount(call));
  }

  #planModel(statement: ResolvedModelRename): Result<number, SqlPlannerConflict> {
    const worked = modelRenameStorageEffect(statement, this.#fromContract, this.#contract);
    if (!worked.ok) {
      return notOk(
        rejected(
          statement,
          `Model "${qualified(worked.failure.model)}" has no table in its contract`,
          `A model rename renames the model's table, and model "${qualified(worked.failure.model)}" has none in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok(0);
    if (effect.kind === 'moveNamespace') {
      return notOk(
        rejected(
          statement,
          `Moving a model to another namespace is not supported in this release: "${qualified(statement.from)}" to "${qualified(statement.to)}"`,
          `The model's table would move from namespace "${effect.from.namespaceId}" to namespace "${effect.to.namespaceId}". Leave out this statement and move the table yourself in a hand-written migration, or keep the model in namespace "${effect.from.namespaceId}".`,
          effect.from,
        ),
      );
    }
    const { rename } = effect;
    const destinationTable = { namespaceId: rename.namespaceId, table: rename.to };
    const label = `Cannot rename table "${rename.from}" to "${rename.to}"`;
    const policyRefusal = this.#controlPolicyRefusal(statement, label, destinationTable);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const tables = this.#target.tables();
    if (!tables.hasTable(rename.namespaceId, rename.from)) {
      return notOk(
        rejected(
          statement,
          `${label}: the schema being planned from has no table "${rename.from}"`,
          `The database has no table "${rename.from}", although the contract it was last updated to names it, ${DRIFTED}`,
          { namespaceId: rename.namespaceId, table: rename.from },
        ),
      );
    }
    const [taken] = tables
      .tablesNamed(rename.namespaceId, rename.to)
      .filter((table) => table !== rename.from);
    if (taken !== undefined) {
      return notOk(
        rejected(
          statement,
          `${label}: the schema being planned from already has a table "${rename.to}"${taken === rename.to ? '' : `, as "${taken}"`}`,
          `A rename cannot replace a table that already exists. Rename or drop table "${taken}" first, or leave out this statement.`,
          destinationTable,
        ),
      );
    }
    const planned = this.#emit(statement, label, destinationTable, this.#target.renameCall(rename));
    if (planned.ok) {
      this.renames.push(rename);
      this.#renamedTables.set(
        tableKey({ namespaceId: rename.namespaceId, table: rename.from }),
        rename.to,
      );
    }
    return planned;
  }

  #planField(statement: ResolvedFieldRename): Result<number, SqlPlannerConflict> {
    const worked = fieldRenameStorageEffect(statement, this.#fromContract, this.#contract);
    if (!worked.ok && worked.failure.kind === 'noTable') {
      return notOk(
        rejected(
          statement,
          `Model "${qualified(worked.failure.model)}" has no table in its contract`,
          `A field rename renames the field's column, and model "${qualified(worked.failure.model)}" has no table in its contract. Leave out this statement.`,
          undefined,
        ),
      );
    }
    if (!worked.ok) {
      return notOk(
        rejected(
          statement,
          `Field "${qualified(statement.from)}.${statement.from.field}" has a column on one side only of ${describeStatement(statement, this.#fromContract, this.#contract)}`,
          'A field rename renames a column or changes nothing in storage, and this field gains or loses its column. Leave out this statement and plan the change without it.',
          undefined,
        ),
      );
    }
    const effect = worked.value;
    if (effect.kind === 'unchanged') return ok(0);
    const table = this.#renamedTables.get(tableKey(effect.table)) ?? effect.table.table;
    const destinationTable = modelTable(this.#contract, statement.to);
    if (
      destinationTable !== undefined &&
      (destinationTable.namespaceId !== effect.table.namespaceId ||
        destinationTable.table !== table)
    ) {
      return notOk(
        rejected(
          statement,
          `Cannot rename column "${table}"."${effect.from}": the model's table changes from "${table}" to "${destinationTable.table}", and no statement renames the table`,
          `The column would be renamed on a table the plan then drops and creates under the new name, and a migration that only changes the table name is planned the same way. Instead, rename the table by hand first, with ...this.renameTable({ ${effect.table.namespaceId === UNBOUND_NAMESPACE_ID ? '' : `schema: "${effect.table.namespaceId}", `}table: "${table}", to: "${destinationTable.table}" }) in its own migration.ts, then plan the field rename on top of it.`,
          { namespaceId: effect.table.namespaceId, table, column: effect.from },
        ),
      );
    }
    const rename: ResolvedColumnRename = {
      namespaceId: effect.table.namespaceId,
      table,
      from: effect.from,
      to: effect.to,
    };
    const tableLocation = { namespaceId: rename.namespaceId, table };
    const label = `Cannot rename column "${table}"."${rename.from}" to "${rename.to}"`;
    const policyRefusal = this.#controlPolicyRefusal(statement, label, tableLocation);
    if (policyRefusal !== undefined) return notOk(policyRefusal);
    const tables = this.#target.tables();
    if (!tables.hasColumn(rename.namespaceId, table, rename.from)) {
      return notOk(
        rejected(
          statement,
          `${label}: the schema being planned from has no column "${rename.from}" on table "${table}"`,
          `The database has no column "${rename.from}" on table "${table}", although the contract it was last updated to names it, ${DRIFTED}`,
          { ...tableLocation, column: rename.from },
        ),
      );
    }
    const [taken] = tables
      .columnsNamed(rename.namespaceId, table, rename.to)
      .filter((column) => column !== rename.from);
    if (taken !== undefined) {
      return notOk(
        rejected(
          statement,
          `${label}: the schema being planned from already has a column "${taken}" on table "${table}"`,
          `A rename cannot replace a column that already exists. Rename or drop column "${taken}" of table "${table}" first, or leave out this statement.`,
          { ...tableLocation, column: rename.to },
        ),
      );
    }
    const planned = this.#emit(
      statement,
      label,
      { ...tableLocation, column: rename.from },
      this.#target.renameColumnCall(rename),
    );
    if (planned.ok) this.columnRenames.push(rename);
    return planned;
  }
}

/**
 * Plans the statements in order against a target's working schema: each model rename becomes a
 * table rename and each field rename a column rename, computed against the schema earlier
 * statements left, then applied to it. The first statement that cannot be planned fails the whole
 * plan with a `statementRejected` conflict that carries the statement.
 */
export function planStatements<TCall>(input: {
  readonly statements: readonly ResolvedStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly policy: MigrationOperationPolicy;
  readonly target: StatementPlanningTarget<TCall>;
}): Result<PlannedStatements<TCall>, SqlPlannerConflict> {
  const { fromContract, contract } = input;
  const [first] = input.statements;
  if (first === undefined) {
    return ok({ calls: [], renames: [], columnRenames: [], appliedStatements: [] });
  }
  if (fromContract === null) {
    return notOk(
      rejected(
        first,
        'Statements need an origin contract, and this plan has none',
        'A statement names models and fields of the origin contract, and this plan has none. Plan from a contract that has the old names, or leave out the statement.',
        undefined,
      ),
    );
  }
  const planner = new StatementPlanner({ ...input, fromContract });
  const appliedStatements: AppliedStatement[] = [];
  for (const statement of input.statements) {
    const operationCount = planner.plan(statement);
    if (!operationCount.ok) return operationCount;
    appliedStatements.push({
      statement,
      description: describeStatement(statement, fromContract, contract),
      operationCount: operationCount.value,
    });
  }
  return ok({
    calls: planner.calls,
    renames: planner.renames,
    columnRenames: planner.columnRenames,
    appliedStatements,
  });
}
