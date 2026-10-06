import type { Contract, ContractWithDomain } from '@internal/contract/types';
import type {
  AppliedStatement,
  FieldCoordinate,
  MigrationOperationClass,
  MigrationOperationPolicy,
  ModelCoordinate,
  ResolvedModelRename,
  ResolvedStatement,
} from '@internal/framework-components/control';
import { type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { controlPolicyForCall } from './control-policy';
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
  | { readonly kind: 'moveNamespace'; readonly from: ModelTable; readonly to: ModelTable }
  | { readonly kind: 'noTable'; readonly model: ModelCoordinate };

function modelTable(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ModelTable | undefined {
  const storage =
    contract.domain.namespaces[coordinate.namespace]?.models[coordinate.model]?.storage;
  const table = storage?.['table'];
  const namespaceId = storage?.['namespaceId'];
  return typeof table === 'string' && typeof namespaceId === 'string'
    ? { namespaceId, table }
    : undefined;
}

/**
 * The storage effect of a model rename: the origin model's table compared with the destination
 * model's. Equal tables mean the rename needs no storage change.
 */
export function modelRenameStorageEffect(
  statement: ResolvedModelRename,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): ModelStorageEffect {
  const from = modelTable(fromContract, statement.from);
  if (from === undefined) return { kind: 'noTable', model: statement.from };
  const to = modelTable(contract, statement.to);
  if (to === undefined) return { kind: 'noTable', model: statement.to };
  if (from.namespaceId !== to.namespaceId) return { kind: 'moveNamespace', from, to };
  if (from.table === to.table) return { kind: 'unchanged' };
  return {
    kind: 'renameTable',
    rename: { namespaceId: from.namespaceId, from: from.table, to: to.table },
  };
}

function modelName(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? `${coordinate.namespace}.${coordinate.model}`
    : coordinate.model;
}

function fieldName(contract: ContractWithDomain, coordinate: FieldCoordinate): string {
  return `${modelName(contract, coordinate)}.${coordinate.field}`;
}

/**
 * The text that reports a statement, in domain names: a model or field is named with its
 * namespace only when its contract has more than one.
 */
export function describeStatement(
  statement: ResolvedStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  if (statement.entity === 'model') {
    return `rename model "${modelName(fromContract, statement.from)}" to "${modelName(contract, statement.to)}"`;
  }
  return `rename field "${fieldName(fromContract, statement.from)}" to "${fieldName(contract, statement.to)}"`;
}

/** What a target supplies for planning statements against its working schema. */
export interface StatementPlanningTarget<TCall> {
  /** The tables of the working schema as earlier statements have left it. */
  tables(): SchemaTables;
  /** The call that renames a table, with its companions, computed against the working schema. */
  renameCall(rename: ResolvedTableRename): TCall;
  /** Applies a call to the working schema. */
  apply(call: TCall): void;
  operationCount(call: TCall): number;
  /** The class of each operation the call produces: the call's own and its companions'. */
  operationClasses(call: TCall): readonly MigrationOperationClass[];
}

export interface PlannedStatements<TCall> {
  readonly calls: readonly TCall[];
  readonly renames: readonly ResolvedTableRename[];
  readonly appliedStatements: readonly AppliedStatement[];
}

function rejected(
  statement: ResolvedStatement,
  summary: string,
  why: string,
  table: ModelTable | undefined,
  refusedOperationClass?: MigrationOperationClass,
): SqlPlannerConflict {
  return {
    kind: 'statementRejected',
    summary,
    why,
    statement,
    ...(refusedOperationClass === undefined ? {} : { refusedOperationClass }),
    ...(table === undefined
      ? {}
      : {
          location: {
            namespaceId: table.namespaceId,
            entityKind: 'table',
            entityName: table.table,
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

function planModelRename<TCall>(
  statement: ResolvedModelRename,
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy,
  target: StatementPlanningTarget<TCall>,
): Result<
  { readonly call: TCall; readonly rename: ResolvedTableRename } | undefined,
  SqlPlannerConflict
> {
  const effect = modelRenameStorageEffect(statement, fromContract, contract);
  if (effect.kind === 'unchanged') return ok(undefined);
  if (effect.kind === 'noTable') {
    return notOk(
      rejected(
        statement,
        `Model "${qualified(effect.model)}" has no table in its contract`,
        'A model rename is planned from the tables of the two models, and this model names none.',
        undefined,
      ),
    );
  }
  if (effect.kind === 'moveNamespace') {
    return notOk(
      rejected(
        statement,
        `Moving a model to another namespace is not supported in this release: "${qualified(statement.from)}" to "${qualified(statement.to)}"`,
        `The model's table would move from namespace "${effect.from.namespaceId}" to namespace "${effect.to.namespaceId}".`,
        effect.from,
      ),
    );
  }
  const { rename } = effect;
  const destinationTable = { namespaceId: rename.namespaceId, table: rename.to };
  const label = `Cannot rename table "${rename.from}" to "${rename.to}"`;
  const controlPolicy = tableControlPolicy(contract, destinationTable);
  if (controlPolicy !== 'managed') {
    return notOk(
      rejected(
        statement,
        `${label}: the table's control policy is "${controlPolicy}"`,
        'A statement can only rename a table whose control policy is "managed".',
        destinationTable,
      ),
    );
  }
  const tables = target.tables();
  if (!tables.hasTable(rename.namespaceId, rename.from)) {
    return notOk(
      rejected(
        statement,
        `${label}: the schema being planned from has no table "${rename.from}"`,
        'The origin contract names the table, but the schema the plan starts from does not have it.',
        { namespaceId: rename.namespaceId, table: rename.from },
      ),
    );
  }
  if (tables.hasTable(rename.namespaceId, rename.to)) {
    return notOk(
      rejected(
        statement,
        `${label}: the schema being planned from already has a table "${rename.to}"`,
        'A rename cannot replace a table that already exists.',
        destinationTable,
      ),
    );
  }
  const call = target.renameCall(rename);
  const refused = target
    .operationClasses(call)
    .find((operationClass) => !policy.allowedOperationClasses.includes(operationClass));
  if (refused !== undefined) {
    return notOk(
      rejected(
        statement,
        `${label}: the plan does not allow "${refused}" operations`,
        `The rename produces a "${refused}" operation, and this command plans only ${policy.allowedOperationClasses.map((c) => `"${c}"`).join(', ')} operations.`,
        destinationTable,
        refused,
      ),
    );
  }
  target.apply(call);
  return ok({ call, rename });
}

/**
 * Plans the statements in order against a target's working schema: each model rename becomes a
 * table rename computed against the schema earlier statements left, then applied to it. The first
 * statement that cannot be planned fails the whole plan with a `statementRejected` conflict.
 */
export function planStatements<TCall>(input: {
  readonly statements: readonly ResolvedStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly policy: MigrationOperationPolicy;
  readonly target: StatementPlanningTarget<TCall>;
}): Result<PlannedStatements<TCall>, SqlPlannerConflict> {
  const calls: TCall[] = [];
  const renames: ResolvedTableRename[] = [];
  const appliedStatements: AppliedStatement[] = [];
  const { fromContract, contract } = input;
  for (const statement of input.statements) {
    if (fromContract === null) {
      return notOk(
        rejected(
          statement,
          'Statements need an origin contract, and this plan has none',
          'A statement names entities of the origin contract, so the plan must start from one.',
          undefined,
        ),
      );
    }
    if (statement.entity === 'field') {
      return notOk(
        rejected(
          statement,
          `Field statements are not planned yet: ${describeStatement(statement, fromContract, contract)}`,
          'This planner plans model renames only.',
          undefined,
        ),
      );
    }
    const planned = planModelRename(statement, fromContract, contract, input.policy, input.target);
    if (!planned.ok) return planned;
    if (planned.value !== undefined) {
      calls.push(planned.value.call);
      renames.push(planned.value.rename);
    }
    appliedStatements.push({
      statement,
      description: describeStatement(statement, fromContract, contract),
      operationCount:
        planned.value === undefined ? 0 : input.target.operationCount(planned.value.call),
    });
  }
  return ok({ calls, renames, appliedStatements });
}
