import { asNamespaceId } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  ResolvedStatement,
} from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const NAMESPACE = asNamespaceId('__unbound__');

function contractWithCollections(collections: readonly string[]): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash: `storage-${collections.join('-')}`,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: Object.fromEntries(
              collections.map((name) => [name, new MongoCollection({})]),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

const modelRename: ResolvedStatement = {
  kind: 'rename',
  entity: 'model',
  from: { namespace: NAMESPACE, model: 'Profile' },
  to: { namespace: NAMESPACE, model: 'User' },
};

const fieldRename: ResolvedStatement = {
  kind: 'rename',
  entity: 'field',
  from: { namespace: NAMESPACE, model: 'Profile', field: 'name' },
  to: { namespace: NAMESPACE, model: 'User', field: 'fullName' },
};

function plan(statements: readonly ResolvedStatement[]) {
  return new MongoMigrationPlanner().plan({
    contract: contractWithCollections(['User']),
    schema: new MongoSchemaIR([new MongoSchemaCollection({ name: 'Profile' })]),
    policy: ALL_CLASSES_POLICY,
    fromContract: contractWithCollections(['Profile']),
    statements,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
}

describe('MongoMigrationPlanner with statements', () => {
  it('plans the rename as a collection drop and create when no statement is given', async () => {
    const result = plan([]);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected success');
    const operations = await Promise.all(result.plan.operations);
    expect(operations.map((operation) => operation.id)).toEqual([
      'collection.User.create',
      'collection.Profile.drop',
    ]);
    expect(result.appliedStatements).toEqual([]);
  });

  it('refuses the first statement and plans nothing', () => {
    expect(plan([modelRename, fieldRename])).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRejected',
          summary:
            'MongoDB does not apply rename statements in this release, so nothing was planned: rename model "Profile" to "User"',
          why: 'The MongoDB planner cannot carry out a rename yet. Without the statement, the same change is planned as removing the old name and adding the new one.',
          statement: modelRename,
        },
      ],
    });
  });

  it('names a field through the model the destination contract names', () => {
    const result = plan([fieldRename]);
    if (result.kind !== 'failure') throw new Error('Expected failure');
    expect(result.conflicts).toMatchObject([
      {
        kind: 'statementRejected',
        summary: expect.stringContaining('rename field "User.name" to "User.fullName"'),
        statement: fieldRename,
      },
    ]);
  });
});
