import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  type ControlPolicy,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  MigrationOperationClass,
  ResolvedFieldRename,
  ResolvedModelRename,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { ResolvedColumnRename } from '../src/core/migrations/resolve-column-rename';
import type { ResolvedTableRename } from '../src/core/migrations/resolve-table-rename';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import type { planStatements } from '../src/core/migrations/statement-planning';

export interface ModelSpec {
  readonly table: string;
  readonly namespace?: string;
  readonly control?: ControlPolicy;
  /** Field name to column name; `null` for a relation field, which has no column. */
  readonly fields?: Readonly<Record<string, string | null>>;
}

const text = { dataType: 'test/text', codecId: 'test/text@1', nullable: false };

function model(namespaceId: string, spec: ModelSpec): ContractModelBase {
  const fields = Object.entries(spec.fields ?? {});
  const columns = fields.flatMap(([field, column]) =>
    column === null ? [] : [[field, column] as const],
  );
  return {
    fields: Object.fromEntries(
      columns.map(([field]) => [
        field,
        { nullable: false, type: { kind: 'scalar', codecId: 'test/text@1' } },
      ]),
    ),
    relations: Object.fromEntries(
      fields
        .filter(([, column]) => column === null)
        .map(([field]) => [
          field,
          {
            to: { namespace: asNamespaceId(namespaceId), model: 'Other' },
            cardinality: '1:N',
            on: { localFields: ['id'], targetFields: ['ownerId'] },
          },
        ]),
    ),
    storage: {
      table: spec.table,
      namespaceId,
      fields: Object.fromEntries(columns.map(([field, column]) => [field, { column }])),
    },
  };
}

export function contractOf(models: Record<string, ModelSpec>): Contract<SqlStorage> {
  const namespaceIds = [...new Set(Object.values(models).map((spec) => spec.namespace ?? 'app'))];
  const inNamespace = (id: string) =>
    Object.entries(models).filter(([, spec]) => (spec.namespace ?? 'app') === id);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: Object.fromEntries(
        namespaceIds.map((id) => [
          id,
          createTestSqlNamespace({
            id,
            entries: {
              table: Object.fromEntries(
                inNamespace(id).map(([, spec]) => [
                  spec.table,
                  new StorageTable({
                    columns: Object.fromEntries(
                      Object.values(spec.fields ?? {}).flatMap((column) =>
                        column === null ? [] : [[column, text]],
                      ),
                    ),
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                    ...(spec.control === undefined ? {} : { control: spec.control }),
                  }),
                ]),
              ),
            },
          }),
        ]),
      ),
    }),
    domain: {
      namespaces: Object.fromEntries(
        namespaceIds.map((id) => [
          id,
          {
            models: Object.fromEntries(
              inNamespace(id).map(([name, spec]) => [name, model(id, spec)]),
            ),
          },
        ]),
      ),
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function renameModel(
  from: string,
  to: string,
  fromNs = 'app',
  toNs = fromNs,
): ResolvedModelRename {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespace: asNamespaceId(fromNs), model: from },
    to: { namespace: asNamespaceId(toNs), model: to },
  };
}

export function renameField(
  model: string,
  from: string,
  to: string,
  newModel = model,
): ResolvedFieldRename {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespace: asNamespaceId('app'), model, field: from },
    to: { namespace: asNamespaceId('app'), model: newModel, field: to },
  };
}

export function renameFieldIn(
  namespace: string,
  model: string,
  from: string,
  to: string,
): ResolvedFieldRename {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespace: asNamespaceId(namespace), model, field: from },
    to: { namespace: asNamespaceId(namespace), model, field: to },
  };
}

/**
 * A target whose calls are strings and whose working schema maps each qualified table name to its
 * columns.
 */
export function fakeTarget(
  initial: readonly string[],
  columns: Readonly<Record<string, readonly string[]>> = {},
  operationClasses: readonly MigrationOperationClass[] = ['widening'],
  sameColumnName: (left: string, right: string) => boolean = (left, right) => left === right,
) {
  const tables = new Map(initial.map((table) => [table, new Set(columns[table] ?? [])]));
  const schemaTables: SchemaTables = {
    hasTable: (namespaceId, table) => tables.has(`${namespaceId}.${table}`),
    hasColumn: (namespaceId, table, column) =>
      tables.get(`${namespaceId}.${table}`)?.has(column) === true,
    columnsNamed: (namespaceId, table, column) =>
      [...(tables.get(`${namespaceId}.${table}`) ?? [])].filter((existing) =>
        sameColumnName(existing, column),
      ),
    namespacesWithTable: () => [],
  };
  return {
    tables: () => schemaTables,
    renameCall: (rename: ResolvedTableRename) =>
      `table ${rename.namespaceId}.${rename.from} -> ${rename.to}`,
    renameColumnCall: (rename: ResolvedColumnRename) =>
      `column ${rename.namespaceId}.${rename.table}.${rename.from} -> ${rename.to}`,
    apply: (call: string) => {
      const [kind, from, , to] = call.split(' ');
      if (from === undefined || to === undefined) return;
      const parts = from.split('.');
      if (kind === 'table') {
        const [namespaceId] = parts;
        const existing = tables.get(from) ?? new Set<string>();
        tables.delete(from);
        tables.set(`${namespaceId}.${to}`, existing);
        return;
      }
      const [namespaceId, table, column] = parts;
      const existing = tables.get(`${namespaceId}.${table}`);
      existing?.delete(column ?? '');
      existing?.add(to);
    },
    operationCount: () => 2,
    operationClasses: () => operationClasses,
  };
}

export function planned<T>(result: ReturnType<typeof planStatements<T>>) {
  if (!result.ok) throw new Error(`expected a plan, got: ${result.failure.summary}`);
  return result.value;
}

export function rejection<T>(result: ReturnType<typeof planStatements<T>>) {
  if (result.ok) throw new Error('expected a rejection');
  return result.failure;
}

export const ALL_CLASSES = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
