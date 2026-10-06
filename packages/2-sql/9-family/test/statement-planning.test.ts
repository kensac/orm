import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  type ControlPolicy,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  ResolvedModelRename,
  ResolvedStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import {
  describeStatement,
  modelRenameStorageEffect,
  planStatements,
} from '../src/core/migrations/statement-planning';

interface ModelSpec {
  readonly table: string;
  readonly namespace?: string;
  readonly control?: ControlPolicy;
}

function model(namespaceId: string, table: string): ContractModelBase {
  return { fields: {}, relations: {}, storage: { table, namespaceId, fields: {} } };
}

function contractOf(models: Record<string, ModelSpec>): Contract<SqlStorage> {
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
                    columns: {},
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
              inNamespace(id).map(([name, spec]) => [name, model(id, spec.table)]),
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

function renameModel(from: string, to: string, fromNs = 'app', toNs = fromNs): ResolvedModelRename {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespace: asNamespaceId(fromNs), model: from },
    to: { namespace: asNamespaceId(toNs), model: to },
  };
}

const renameField: ResolvedStatement = {
  kind: 'rename',
  entity: 'field',
  from: { namespace: asNamespaceId('app'), model: 'User', field: 'name' },
  to: { namespace: asNamespaceId('app'), model: 'User', field: 'fullName' },
};

function tablesOf(present: ReadonlySet<string>): SchemaTables {
  return {
    hasTable: (namespaceId, table) => present.has(`${namespaceId}.${table}`),
    hasColumn: () => false,
    namespacesWithTable: () => [],
  };
}

/** A target whose calls are strings and whose working schema is a set of qualified table names. */
function fakeTarget(initial: readonly string[]) {
  const present = new Set(initial);
  return {
    tables: () => tablesOf(present),
    renameCall: (rename: { namespaceId: string; from: string; to: string }) =>
      `${rename.namespaceId}.${rename.from}->${rename.to}`,
    apply: (call: string) => {
      const [from, to] = call.split('->');
      const namespaceId = from?.split('.')[0];
      present.delete(from ?? '');
      present.add(`${namespaceId}.${to}`);
    },
    operationCount: () => 2,
    operationClasses: () => ['widening'] as const,
  };
}

function planned<T>(result: ReturnType<typeof planStatements<T>>) {
  if (!result.ok) throw new Error(`expected a plan, got: ${result.failure.summary}`);
  return result.value;
}

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

describe('modelRenameStorageEffect', () => {
  it('is unchanged when both models map to the same table', () => {
    const origin = contractOf({ Profile: { table: 'profile' } });
    const destination = contractOf({ User: { table: 'profile' } });
    const statement = renameModel('Profile', 'User');
    expect(modelRenameStorageEffect(statement, origin, destination)).toEqual({ kind: 'unchanged' });
  });

  it('is a table rename when the table name changes', () => {
    const origin = contractOf({ Profile: { table: 'Profile' } });
    const destination = contractOf({ User: { table: 'User' } });
    expect(modelRenameStorageEffect(renameModel('Profile', 'User'), origin, destination)).toEqual({
      kind: 'renameTable',
      rename: { namespaceId: 'app', from: 'Profile', to: 'User' },
    });
  });

  it('is a namespace move when the namespace changes', () => {
    const origin = contractOf({ User: { table: 'User', namespace: 'auth' } });
    const destination = contractOf({ User: { table: 'User', namespace: 'billing' } });
    expect(
      modelRenameStorageEffect(renameModel('User', 'User', 'auth', 'billing'), origin, destination),
    ).toEqual({
      kind: 'moveNamespace',
      from: { namespaceId: 'auth', table: 'User' },
      to: { namespaceId: 'billing', table: 'User' },
    });
  });
});

describe('describeStatement', () => {
  it('names models without their namespace when the contract has one namespace', () => {
    const origin = contractOf({ Profile: { table: 'Profile' } });
    const destination = contractOf({ User: { table: 'User' } });
    expect(describeStatement(renameModel('Profile', 'User'), origin, destination)).toBe(
      'rename model "Profile" to "User"',
    );
  });

  it('names models with their namespace when the contract has several', () => {
    const origin = contractOf({
      Profile: { table: 'Profile' },
      Bill: { table: 'Bill', namespace: 'billing' },
    });
    const destination = contractOf({
      User: { table: 'User' },
      Bill: { table: 'Bill', namespace: 'billing' },
    });
    expect(describeStatement(renameModel('Profile', 'User'), origin, destination)).toBe(
      'rename model "app.Profile" to "app.User"',
    );
  });

  it('names a field with its model', () => {
    const contract = contractOf({ User: { table: 'User' } });
    expect(describeStatement(renameField, contract, contract)).toBe(
      'rename field "User.name" to "User.fullName"',
    );
  });
});

describe('planStatements', () => {
  it('applies model renames in order and reports each with its operation count', () => {
    const origin = contractOf({ Profile: { table: 'Profile' }, Post: { table: 'Post' } });
    const destination = contractOf({ User: { table: 'User' }, Article: { table: 'Article' } });
    const result = planStatements({
      policy: ALL_CLASSES,
      statements: [renameModel('Profile', 'User'), renameModel('Post', 'Article')],
      fromContract: origin,
      contract: destination,
      target: fakeTarget(['app.Profile', 'app.Post']),
    });
    expect(planned(result)).toEqual({
      calls: ['app.Profile->User', 'app.Post->Article'],
      renames: [
        { namespaceId: 'app', from: 'Profile', to: 'User' },
        { namespaceId: 'app', from: 'Post', to: 'Article' },
      ],
      appliedStatements: [
        {
          statement: renameModel('Profile', 'User'),
          description: 'rename model "Profile" to "User"',
          operationCount: 2,
        },
        {
          statement: renameModel('Post', 'Article'),
          description: 'rename model "Post" to "Article"',
          operationCount: 2,
        },
      ],
    });
  });

  it('applies a statement whose table does not change with no operations', () => {
    const result = planStatements({
      policy: ALL_CLASSES,
      statements: [renameModel('Profile', 'User')],
      fromContract: contractOf({ Profile: { table: 'profile' } }),
      contract: contractOf({ User: { table: 'profile' } }),
      target: fakeTarget(['app.profile']),
    });
    expect(planned(result)).toMatchObject({
      calls: [],
      renames: [],
      appliedStatements: [{ operationCount: 0 }],
    });
  });

  function rejection(result: ReturnType<typeof planStatements<string>>) {
    if (result.ok) throw new Error('expected a rejection');
    return result.failure;
  }

  it('rejects moving a model to another namespace, naming both coordinates', () => {
    const statement = renameModel('User', 'User', 'auth', 'billing');
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [statement],
        fromContract: contractOf({ User: { table: 'User', namespace: 'auth' } }),
        contract: contractOf({ User: { table: 'User', namespace: 'billing' } }),
        target: fakeTarget(['auth.User']),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRejected',
      statement,
      location: { namespaceId: 'auth', entityKind: 'table', entityName: 'User' },
    });
    expect(conflict.summary).toContain('not supported in this release');
    expect(conflict.summary).toContain('"auth.User"');
    expect(conflict.summary).toContain('"billing.User"');
  });

  it.each(['external', 'observed', 'tolerated'] as const)(
    'rejects renaming a table whose control policy is %s',
    (control) => {
      const conflict = rejection(
        planStatements({
          policy: ALL_CLASSES,
          statements: [renameModel('Profile', 'User')],
          fromContract: contractOf({ Profile: { table: 'Profile' } }),
          contract: contractOf({ User: { table: 'User', control } }),
          target: fakeTarget(['app.Profile']),
        }),
      );
      expect(conflict).toMatchObject({
        kind: 'statementRejected',
        location: { namespaceId: 'app', entityKind: 'table', entityName: 'User' },
      });
      expect(conflict.summary).toContain(`control policy is "${control}"`);
    },
  );

  it('rejects a rename whose table the schema being planned from does not have', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget([]),
      }),
    );
    expect(conflict.kind).toBe('statementRejected');
    expect(conflict.summary).toContain('has no table "Profile"');
  });

  it('rejects a rename whose new table the schema being planned from already has', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile', 'app.User']),
      }),
    );
    expect(conflict.summary).toContain('already has a table "User"');
  });

  it('rejects a rename whose operations the policy does not allow', () => {
    const statement = renameModel('Profile', 'User');
    const conflict = rejection(
      planStatements({
        policy: { allowedOperationClasses: ['additive'] },
        statements: [statement],
        fromContract: contractOf({ Profile: { table: 'Profile' } }),
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile']),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRejected',
      statement,
      refusedOperationClass: 'widening',
    });
    expect(conflict.summary).toContain('does not allow "widening" operations');
  });

  it('rejects a field statement until field renames are planned', () => {
    const contract = contractOf({ User: { table: 'User' } });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField],
        fromContract: contract,
        contract,
        target: fakeTarget(['app.User']),
      }),
    );
    expect(conflict).toMatchObject({ kind: 'statementRejected', statement: renameField });
  });

  it('rejects statements when there is no origin contract', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameModel('Profile', 'User')],
        fromContract: null,
        contract: contractOf({ User: { table: 'User' } }),
        target: fakeTarget(['app.Profile']),
      }),
    );
    expect(conflict.kind).toBe('statementRejected');
  });
});
