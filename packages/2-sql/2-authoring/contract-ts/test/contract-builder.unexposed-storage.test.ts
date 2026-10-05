/**
 * Storage the domain does not expose, built from contract definition nodes: a field marked `unexposed` gives its table a column and its model no field, and a model marked `unexposed` gives storage a table and the domain no model and no root. Exposure is a domain choice, so the storage hash is the same either way.
 */
import type { Contract } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { FieldNode } from '../src/contract-definition';
import { modelsOf } from './contract-test-helpers';
import { unboundTables } from './unbound-tables';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const text = { codecId: 'pg/text@1', nativeType: 'text' } as const;

function column(
  fieldName: string,
  columnName: string,
  descriptor: FieldNode['descriptor'],
  nullable = false,
): FieldNode {
  return { fieldName, columnName, descriptor, nullable, many: false };
}

function build(options: { readonly legacyKeyExposed: boolean; readonly ledgerExposed: boolean }) {
  return buildSqlContractFromDefinition({
    warnings: undefined,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    models: [
      {
        modelName: 'User',
        tableName: 'user',
        fields: [
          column('id', 'id', int4),
          column('email', 'email', text),
          {
            ...column('legacyKey', 'legacy_key', text, true),
            ...(options.legacyKeyExposed ? {} : { unexposed: true }),
          },
        ],
        id: { columns: ['id'] },
      },
      {
        modelName: 'Ledger',
        tableName: '_prisma_migrations',
        ...(options.ledgerExposed ? {} : { unexposed: true }),
        fields: [
          column('id', 'id', text),
          column('migrationName', 'migration_name', text),
          column('userId', 'user_id', int4, true),
        ],
        id: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['user_id'],
            references: { model: 'User', table: 'user', columns: ['id'] },
          },
        ],
      },
    ],
  });
}

describe('storage the domain does not expose', () => {
  const contract = build({ legacyKeyExposed: false, ledgerExposed: false });

  it('keeps an unexposed column in its table and out of the model', () => {
    expect(Object.keys(unboundTables(contract.storage)['user']?.columns ?? {})).toEqual([
      'id',
      'email',
      'legacy_key',
    ]);
    const user = modelsOf(contract)['User'];
    expect(Object.keys(user?.fields ?? {})).toEqual(['id', 'email']);
    expect(Object.keys(user?.storage['fields'] ?? {})).toEqual(['id', 'email']);
  });

  it('keeps an unexposed table and its foreign key in storage, with no model and no root', () => {
    const ledger = unboundTables(contract.storage)['_prisma_migrations'];
    expect(Object.keys(ledger?.columns ?? {})).toEqual(['id', 'migration_name', 'user_id']);
    expect(ledger?.foreignKeys.map((fk) => fk.source.columns)).toEqual([['user_id']]);
    expect(Object.keys(modelsOf(contract))).toEqual(['User']);
    expect(Object.keys(contract.roots)).toEqual(['user']);
  });

  it('validates after a JSON round trip', () => {
    const envelope = JSON.parse(JSON.stringify(contract)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('has the storage hash of the same storage exposed', () => {
    const exposed = build({ legacyKeyExposed: true, ledgerExposed: true });

    expect(Object.keys(modelsOf(exposed))).toEqual(['User', 'Ledger']);
    expect(contract.storage.storageHash).toBe(exposed.storage.storageHash);
  });

  it('refuses a generated default on an unexposed field, which the ORM never writes', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'user',
            fields: [
              column('id', 'id', int4),
              {
                ...column('token', 'token', text),
                unexposed: true,
                executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
              },
            ],
            id: { columns: ['id'] },
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          modelName: 'User',
          fieldName: 'token',
          reason: 'executionDefaults-on-unexposed-field',
        },
      }),
    );
  });
});
