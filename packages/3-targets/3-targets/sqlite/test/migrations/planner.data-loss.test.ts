import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

const columnTypes = {
  text: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
  integer: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
  'text?': { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
} as const;

type ColumnType = keyof typeof columnTypes;

/** A model per table, each field stored in the column of the same name. */
function contract(
  seed: string,
  tables: Readonly<Record<string, Readonly<Record<string, ColumnType>>>>,
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([table, columns]) => [
                table,
                new StorageTable({
                  columns: Object.fromEntries(
                    Object.entries(columns).map(([column, type]) => [column, columnTypes[type]]),
                  ),
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({
      models: Object.fromEntries(
        Object.entries(tables).map(([table, columns]) => [
          table,
          {
            fields: Object.fromEntries(
              Object.keys(columns).map((column) => [
                column,
                { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/text@1' } },
              ]),
            ),
            relations: {},
            storage: {
              table,
              namespaceId: UNBOUND_NAMESPACE_ID,
              fields: Object.fromEntries(
                Object.keys(columns).map((column) => [column, { column }]),
              ),
            },
          },
        ]),
      ),
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function planned(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  options: {
    readonly fromContract?: Contract<SqlStorage> | null;
    readonly statements?: readonly ResolvedMigrationStatement[];
  } = {},
) {
  const fromContract = options.fromContract === undefined ? from : options.fromContract;
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
    fromContract,
    origin: planOriginOf(fromContract),
    statements: options.statements ?? [],
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  const labels = (await Promise.all(result.plan.operations)).map((op) => op.label);
  return {
    dataLoss: result.dataLoss.map(({ operationIndex, subject }) => ({
      operation: labels[operationIndex],
      subject,
    })),
    accessWidening: result.accessWidening,
  };
}

describe('SQLite planner, data loss', () => {
  it('names the model of a dropped table and the field of a dropped column', async () => {
    const from = contract('from', {
      Legacy: { id: 'integer' },
      User: { id: 'integer', email: 'text', nickname: 'text' },
    });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });

    expect(await planned(from, to)).toEqual({
      dataLoss: [
        {
          operation: 'Drop column nickname on User',
          subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
        },
        {
          operation: 'Drop table Legacy',
          subject: { kind: 'model', namespaceId: unbound, model: 'Legacy' },
        },
      ],
      accessWidening: [],
    });
  });

  it('names the field whose type a recreate changes, at the recreate', async () => {
    const from = contract('from', { User: { id: 'integer', age: 'text' } });
    const to = contract('to', { User: { id: 'integer', age: 'integer' } });

    expect((await planned(from, to)).dataLoss).toEqual([
      {
        operation: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
      },
    ]);
  });

  it('names a column a widening recreate leaves behind once, at the recreate', async () => {
    const from = contract('from', { User: { id: 'integer', email: 'text?', nickname: 'text' } });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });

    expect((await planned(from, to)).dataLoss).toEqual([
      {
        operation: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
    ]);
  });

  it('names storage by the names the database has when the plan has no origin contract', async () => {
    const from = contract('from', {
      Legacy: { id: 'integer' },
      User: { id: 'integer', email: 'text', nickname: 'text' },
    });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });

    expect((await planned(from, to, { fromContract: null })).dataLoss).toEqual([
      {
        operation: 'Drop column nickname on User',
        subject: { kind: 'storage', name: 'User.nickname' },
      },
      { operation: 'Drop table Legacy', subject: { kind: 'storage', name: 'Legacy' } },
    ]);
  });
});
