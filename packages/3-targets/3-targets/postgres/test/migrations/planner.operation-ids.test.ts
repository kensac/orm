import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { stubLowerer } from './rename-table-fixtures';

const NAMESPACES = ['auth', 'billing'] as const;
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

function model(namespaceId: string, table: string): ContractModelBase {
  return {
    fields: {},
    relations: {},
    storage: { table, namespaceId, fields: {} },
  };
}

/** The same model and table name in two schemas. */
function contractWithTableInBothSchemas(table: string, hashSeed: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: Object.fromEntries(
        NAMESPACES.map((id) => [
          id,
          postgresCreateNamespace({
            id,
            entries: {
              table: {
                [table]: new StorageTable({
                  columns: { id: int4, email: text, note: text },
                  primaryKey: { columns: ['id'] },
                  uniques: [{ columns: ['email'] }],
                  indexes: [],
                  foreignKeys: [],
                }),
              },
            },
          }),
        ]),
      ),
    }),
    domain: {
      namespaces: Object.fromEntries(
        NAMESPACES.map((id) => [id, { models: { [table]: model(id, table) } }]),
      ),
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function renameIn(namespaceId: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(namespaceId), model: 'Profile' },
    to: { namespaceId: asNamespaceId(namespaceId), model: 'User' },
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

async function idsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  return (await Promise.all(result.plan.operations)).map((op) => op.id);
}

describe('Postgres operation ids for same-named tables in two schemas', () => {
  const from = contractWithTableInBothSchemas('Profile', 'from');
  const to = contractWithTableInBothSchemas('User', 'to');

  it('are unique when both tables are renamed, and each statement names its own operations', async () => {
    const result = plan(from, to, [renameIn('auth'), renameIn('billing')]);
    const ids = await idsOf(result);
    expect(new Set(ids).size).toBe(ids.length);
    const [auth, billing] = result.appliedStatements.map((applied) => applied.operationIds);
    expect(auth).toContain('renameTable.auth.Profile');
    expect(billing).toContain('renameTable.billing.Profile');
    expect(auth?.filter((id) => billing?.includes(id))).toEqual([]);
  });

  it('are unique when both tables are dropped and created again', async () => {
    const ids = await idsOf(plan(from, to, []));
    expect(ids).toEqual(
      expect.arrayContaining([
        'dropTable.auth.Profile',
        'dropTable.billing.Profile',
        'table.auth.User',
        'table.billing.User',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
