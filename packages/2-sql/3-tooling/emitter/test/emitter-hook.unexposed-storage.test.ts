import { generateContractDts } from '@internal/emitter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

const column = (codecId: string, nativeType: string, nullable = false) => ({
  codecId,
  nativeType,
  nullable,
});

function section(dts: string, start: string, end: string): string {
  const from = dts.indexOf(start);
  expect(from, `section ${start}`).toBeGreaterThanOrEqual(0);
  return dts.slice(from, dts.indexOf(end, from));
}

describe('storage the domain does not expose', () => {
  const contract = createContract({
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: {
            User: {
              storage: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                table: 'user',
                fields: { id: { column: 'id' }, email: { column: 'email' } },
              },
              fields: {
                id: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'pg/int4@1' },
                },
                email: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'pg/text@1' },
                },
              },
              relations: {},
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: column('pg/int4@1', 'int4'),
                  email: column('pg/text@1', 'text'),
                  legacy_key: column('pg/text@1', 'text', true),
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              _prisma_migrations: {
                columns: { id: column('pg/text@1', 'text') },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
  });
  const dts = generateContractDts(contract, sqlEmission, [], testHashes);

  it('leaves an unmapped column and an unmodelled table out of the model types', () => {
    const models = section(dts, 'export namespace Models', '\n}\n');
    expect(models).toContain('email:');
    expect(models).not.toContain('legacy_key');
    expect(models).not.toContain('legacyKey');
    expect(models).not.toContain('_prisma_migrations');
    for (const types of ['FieldOutputTypes', 'FieldInputTypes']) {
      const fieldTypes = section(dts, `export type ${types} =`, '\n');
      expect(fieldTypes).toContain('readonly email:');
      expect(fieldTypes).not.toContain('legacy');
      expect(fieldTypes).not.toContain('_prisma_migrations');
    }
  });

  it('keeps them in the storage types', () => {
    for (const types of ['StorageColumnTypes', 'StorageColumnInputTypes']) {
      const storage = section(dts, `export type ${types} =`, '\n');
      expect(storage).toContain('readonly legacy_key:');
      expect(storage).toContain('readonly _prisma_migrations:');
    }
  });
});
