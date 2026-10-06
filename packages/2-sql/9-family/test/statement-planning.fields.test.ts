import { describe, expect, it } from 'vitest';
import {
  fieldRenameStorageEffect,
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

const origin = contractOf({ User: { table: 'User', fields: { id: 'id', name: 'name' } } });
const destination = contractOf({
  User: { table: 'User', fields: { id: 'id', fullName: 'fullName' } },
});

describe('fieldRenameStorageEffect', () => {
  it('is a column rename when the column name changes', () => {
    expect(
      fieldRenameStorageEffect(renameField('User', 'name', 'fullName'), origin, destination),
    ).toEqual({
      kind: 'renameColumn',
      table: { namespaceId: 'app', table: 'User' },
      from: 'name',
      to: 'fullName',
    });
  });

  it('is unchanged when both fields map to the same column', () => {
    const mapped = contractOf({ User: { table: 'User', fields: { fullName: 'name' } } });
    expect(
      fieldRenameStorageEffect(renameField('User', 'name', 'fullName'), origin, mapped),
    ).toEqual({ kind: 'unchanged' });
  });

  it('is unchanged for a relation field, which has no column', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { articles: null } } });
    expect(
      fieldRenameStorageEffect(renameField('User', 'posts', 'articles'), before, after),
    ).toEqual({ kind: 'unchanged' });
  });
});

describe('planStatements, field renames', () => {
  it('renames the column and reports the statement', () => {
    const statement = renameField('User', 'name', 'fullName');
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [statement],
          fromContract: origin,
          contract: destination,
          target: fakeTarget(['app.User'], { 'app.User': ['id', 'name'] }),
        }),
      ),
    ).toEqual({
      calls: ['column app.User.name -> fullName'],
      renames: [],
      columnRenames: [{ namespaceId: 'app', table: 'User', from: 'name', to: 'fullName' }],
      appliedStatements: [
        {
          statement,
          description: 'rename field "User.name" to "User.fullName"',
          operationCount: 2,
        },
      ],
    });
  });

  it('renames the column on the table an earlier statement renamed', () => {
    const before = contractOf({ Profile: { table: 'Profile', fields: { name: 'name' } } });
    const after = contractOf({ User: { table: 'User', fields: { fullName: 'fullName' } } });
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [
            renameModel('Profile', 'User'),
            renameField('Profile', 'name', 'fullName', 'User'),
          ],
          fromContract: before,
          contract: after,
          target: fakeTarget(['app.Profile'], { 'app.Profile': ['name'] }),
        }),
      ).calls,
    ).toEqual(['table app.Profile -> User', 'column app.User.name -> fullName']);
  });

  it('applies a relation field rename with no operations', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { articles: null } } });
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [renameField('User', 'posts', 'articles')],
          fromContract: before,
          contract: after,
          target: fakeTarget(['app.User']),
        }),
      ),
    ).toMatchObject({ calls: [], columnRenames: [], appliedStatements: [{ operationCount: 0 }] });
  });

  it('rejects a rename whose column the schema being planned from does not have', () => {
    const statement = renameField('User', 'name', 'fullName');
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [statement],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['id'] }),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRejected',
      statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'User', column: 'name' },
    });
    expect(conflict.summary).toContain('has no column "name"');
  });

  it('rejects a rename onto a column the schema being planned from already has', () => {
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['name', 'fullName'] }),
      }),
    );
    expect(conflict.summary).toContain('already has a column "fullName"');
  });

  it('rejects a field that has a column on one side only', () => {
    const before = contractOf({ User: { table: 'User', fields: { posts: null } } });
    const after = contractOf({ User: { table: 'User', fields: { title: 'title' } } });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'posts', 'title')],
        fromContract: before,
        contract: after,
        target: fakeTarget(['app.User']),
      }),
    );
    expect(conflict.kind).toBe('statementRejected');
    expect(conflict.summary).toContain('column on one side only');
  });

  it('rejects a column rename the policy does not allow', () => {
    const conflict = rejection(
      planStatements({
        policy: { allowedOperationClasses: ['additive'] },
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: destination,
        target: fakeTarget(['app.User'], { 'app.User': ['name'] }),
      }),
    );
    expect(conflict).toMatchObject({
      kind: 'statementRejected',
      refusedOperationClass: 'widening',
    });
  });

  it('rejects renaming a column of a table whose control policy is not managed', () => {
    const external = contractOf({
      User: { table: 'User', control: 'external', fields: { fullName: 'fullName' } },
    });
    const conflict = rejection(
      planStatements({
        policy: ALL_CLASSES,
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: origin,
        contract: external,
        target: fakeTarget(['app.User'], { 'app.User': ['name'] }),
      }),
    );
    expect(conflict.summary).toContain('control policy is "external"');
  });
});
