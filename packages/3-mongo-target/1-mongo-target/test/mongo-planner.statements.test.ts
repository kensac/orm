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

function contractWithModel(model: string, collection: string): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: { [model]: { fields: {}, relations: {}, storage: { collection } } },
        },
      },
    },
    storage: {
      storageHash: `storage-${collection}`,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: { [collection]: new MongoCollection({}) } },
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
    contract: contractWithModel('User', 'users'),
    schema: new MongoSchemaIR([new MongoSchemaCollection({ name: 'profiles' })]),
    policy: ALL_CLASSES_POLICY,
    fromContract: contractWithModel('Profile', 'profiles'),
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
      'collection.users.create',
      'collection.profiles.drop',
    ]);
    expect(result.appliedStatements).toEqual([]);
  });

  it('refuses the first statement, plans nothing, and says how to keep the documents', () => {
    expect(plan([modelRename, fieldRename])).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRejected',
          summary:
            'MongoDB does not apply rename statements in this release, so nothing was planned: rename model "Profile" to "User"',
          why: 'Without the statement, the plan drops collection "profiles" and its documents and creates collection "users". To keep the documents, rename the collection yourself, for example with db.profiles.renameCollection("users") in mongosh, then run the command again without --rename.',
          statement: modelRename,
        },
      ],
    });
  });

  it('names a field through the model the destination contract names, and says how to move its values', () => {
    const result = plan([fieldRename]);
    if (result.kind !== 'failure') throw new Error('Expected failure');
    expect(result.conflicts).toMatchObject([
      {
        kind: 'statementRejected',
        summary: expect.stringContaining('rename field "User.name" to "User.fullName"'),
        why: 'Without the statement, existing documents in collection "profiles" keep the field "name" and nothing moves its values to "fullName". To keep them, move them yourself with an update that uses $rename, for example db.profiles.updateMany({}, { $rename: { name: "fullName" } }) in mongosh, then run the command again without --rename.',
        statement: fieldRename,
      },
    ]);
  });
});
