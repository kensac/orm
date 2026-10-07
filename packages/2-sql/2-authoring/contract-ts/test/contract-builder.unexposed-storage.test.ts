/**
 * Storage the domain does not expose, built from contract definition nodes: a field marked `unexposed` gives its table a column and its model no field, and a model marked `unexposed` gives storage a table and the domain no model and no root. Exposure is a domain choice, so the storage hash is the same either way.
 */
import type { Contract } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { withTestTypes } from '../../../1-core/contract/test/test-type-lookups';
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
  return buildSqlContractFromDefinition(
    {
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
    },
    ...withTestTypes(),
  );
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
      buildSqlContractFromDefinition(
        {
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
        },
        ...withTestTypes(),
      ),
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

describe('combinations the builder refuses for storage the domain does not expose', () => {
  function buildModels(models: Parameters<typeof buildSqlContractFromDefinition>[0]['models']) {
    return () =>
      buildSqlContractFromDefinition(
        {
          warnings: undefined,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          models,
        },
        ...withTestTypes(),
      );
  }

  const user = {
    modelName: 'User',
    tableName: 'user',
    fields: [column('id', 'id', int4), column('email', 'email', text)],
    id: { columns: ['id'] },
  } as const;

  const post = {
    modelName: 'Post',
    tableName: 'post',
    fields: [
      column('id', 'id', int4),
      { ...column('reviewerId', 'reviewer_id', int4, true), unexposed: true },
    ],
    id: { columns: ['id'] },
    foreignKeys: [
      { columns: ['reviewer_id'], references: { model: 'User', table: 'user', columns: ['id'] } },
    ],
  } as const;

  it('refuses an unexposed model that shares its base model table', () => {
    expect(
      buildModels([
        user,
        {
          modelName: 'Admin',
          tableName: 'user',
          sharesBaseTable: true,
          unexposed: true,
          fields: [],
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Model "Admin" is not exposed to the ORM but shares its base model\'s table as a single-table variant; a variant is part of its base model\'s domain, so it cannot be unexposed alone.',
        meta: { modelName: 'Admin', reason: 'unexposed-variant' },
      }),
    );
  });

  it('refuses an unexposed model that declares a relation', () => {
    expect(
      buildModels([
        user,
        {
          modelName: 'Ledger',
          tableName: 'ledger',
          unexposed: true,
          fields: [column('id', 'id', int4), column('userId', 'user_id', int4)],
          id: { columns: ['id'] },
          relations: [
            {
              fieldName: 'user',
              toModel: 'User',
              toTable: 'user',
              cardinality: 'N:1',
              nullable: false,
              on: {
                parentTable: 'ledger',
                parentColumns: ['user_id'],
                childTable: 'user',
                childColumns: ['id'],
              },
            },
          ],
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "Ledger.user" is declared on a model that is not exposed to the ORM; an unexposed model has no domain model to carry it.',
        meta: { modelName: 'Ledger', relationName: 'user', reason: 'relation-on-unexposed-model' },
      }),
    );
  });

  it('refuses a relation to an unexposed model', () => {
    expect(
      buildModels([
        {
          ...user,
          relations: [
            {
              fieldName: 'ledgers',
              toModel: 'Ledger',
              toTable: 'ledger',
              cardinality: '1:N',
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'ledger',
                childColumns: ['user_id'],
              },
            },
          ],
        },
        {
          modelName: 'Ledger',
          tableName: 'ledger',
          unexposed: true,
          fields: [column('id', 'id', int4), column('userId', 'user_id', int4)],
          id: { columns: ['id'] },
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "User.ledgers" targets model "Ledger", which is not exposed to the ORM; a relation can only reach an exposed model.',
        meta: { modelName: 'User', relationName: 'ledgers', reason: 'relation-to-unexposed-model' },
      }),
    );
  });

  it('refuses a relation whose own column belongs to an unexposed field', () => {
    expect(
      buildModels([
        user,
        {
          ...post,
          relations: [
            {
              fieldName: 'reviewer',
              toModel: 'User',
              toTable: 'user',
              cardinality: 'N:1',
              nullable: true,
              on: {
                parentTable: 'post',
                parentColumns: ['reviewer_id'],
                childTable: 'user',
                childColumns: ['id'],
              },
            },
          ],
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "Post.reviewer" joins on column "reviewer_id" of model "Post", whose field "reviewerId" is not exposed to the ORM; a relation can only join on exposed fields.',
        meta: {
          modelName: 'Post',
          relationName: 'reviewer',
          fieldName: 'reviewerId',
          reason: 'relation-on-unexposed-field',
        },
      }),
    );
  });

  it('refuses a relation whose target column belongs to an unexposed field', () => {
    expect(
      buildModels([
        {
          ...user,
          relations: [
            {
              fieldName: 'reviewedPosts',
              toModel: 'Post',
              toTable: 'post',
              cardinality: '1:N',
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'post',
                childColumns: ['reviewer_id'],
              },
            },
          ],
        },
        post,
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "User.reviewedPosts" joins on column "reviewer_id" of model "Post", whose field "reviewerId" is not exposed to the ORM; a relation can only join on exposed fields.',
        meta: {
          modelName: 'User',
          relationName: 'reviewedPosts',
          fieldName: 'reviewerId',
          reason: 'relation-on-unexposed-field',
        },
      }),
    );
  });
});
