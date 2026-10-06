import { describe, expect, it } from 'vitest';
import {
  describeStatement,
  modelRenameStorageEffect,
  planStatements,
} from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  planned,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

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

  it('names the old field through the model as the statement does, after a model rename', () => {
    const origin = contractOf({ Profile: { table: 'Profile' } });
    const destination = contractOf({ User: { table: 'User' } });
    expect(
      describeStatement(renameField('Profile', 'name', 'fullName', 'User'), origin, destination),
    ).toBe('rename field "User.name" to "User.fullName"');
  });

  it('names a field with its model', () => {
    const contract = contractOf({ User: { table: 'User' } });
    expect(describeStatement(renameField('User', 'name', 'fullName'), contract, contract)).toBe(
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
      calls: ['table app.Profile -> User', 'table app.Post -> Article'],
      renames: [
        { namespaceId: 'app', from: 'Profile', to: 'User' },
        { namespaceId: 'app', from: 'Post', to: 'Article' },
      ],
      columnRenames: [],
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
