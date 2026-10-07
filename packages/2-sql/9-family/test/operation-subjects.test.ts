import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type CallSubjects,
  planSubjects,
  type SubjectTarget,
} from '../src/core/migrations/operation-subjects';
import { contractOf, renameField, renameModel } from './statement-fixtures';

const app = asNamespaceId('app');

function table(name: string, storageName = name): SubjectTarget {
  return { storageName, table: { namespaceId: 'app', table: name, column: undefined } };
}

function column(tableName: string, columnName: string): SubjectTarget {
  return {
    storageName: `${tableName}.${columnName}`,
    table: { namespaceId: 'app', table: tableName, column: columnName },
  };
}

function losing(...targets: readonly SubjectTarget[]): CallSubjects {
  return { operationCount: 1, dataLoss: targets, accessWidening: [] };
}

const unchanged: CallSubjects = { operationCount: 1, dataLoss: [], accessWidening: [] };

const origin = contractOf({
  Legacy: { table: 'legacy', fields: { id: 'id' } },
  User: { table: 'user', fields: { id: 'id', name: 'full_name' } },
});

describe('planSubjects', () => {
  it('names the model of a dropped table and the field of a dropped column', () => {
    expect(
      planSubjects([unchanged, losing(table('legacy')), losing(column('user', 'full_name'))], {
        fromContract: origin,
        contract: contractOf({ User: { table: 'user', fields: { id: 'id' } } }),
        statements: [],
      }),
    ).toEqual({
      dataLoss: [
        { operationIndex: 1, subject: { kind: 'model', namespaceId: app, model: 'Legacy' } },
        {
          operationIndex: 2,
          subject: { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
        },
      ],
      accessWidening: [],
    });
  });

  it('counts every operation of a call with companions before the next call', () => {
    expect(
      planSubjects(
        [{ operationCount: 3, dataLoss: [], accessWidening: [] }, losing(table('legacy'))],
        { fromContract: origin, contract: origin, statements: [] },
      ).dataLoss,
    ).toEqual([
      { operationIndex: 3, subject: { kind: 'model', namespaceId: app, model: 'Legacy' } },
    ]);
  });

  it('finds a table and a column renamed earlier in the plan under their origin names', () => {
    const destination = contractOf({
      Account: { table: 'account', fields: { id: 'id', displayName: 'display_name' } },
    });
    const from = contractOf({
      User: { table: 'user', fields: { id: 'id', name: 'full_name' } },
    });
    expect(
      planSubjects([losing(column('account', 'display_name'))], {
        fromContract: from,
        contract: destination,
        statements: [
          renameModel('User', 'Account'),
          renameField('User', 'name', 'displayName', 'Account'),
        ],
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'field', namespaceId: app, model: 'User', field: 'name' },
      },
    ]);
  });

  it('names storage the origin contract does not declare by its storage name', () => {
    expect(
      planSubjects([losing(table('audit_log', 'public.audit_log'), column('user', 'nickname'))], {
        fromContract: origin,
        contract: origin,
        statements: [],
      }).dataLoss,
    ).toEqual([
      { operationIndex: 0, subject: { kind: 'storage', name: 'public.audit_log' } },
      { operationIndex: 0, subject: { kind: 'storage', name: 'user.nickname' } },
    ]);
  });

  it('names every subject by its storage name when the plan has no origin contract', () => {
    expect(
      planSubjects([losing(table('legacy'), column('user', 'full_name'))], {
        fromContract: null,
        contract: origin,
        statements: [],
      }).dataLoss,
    ).toEqual([
      { operationIndex: 0, subject: { kind: 'storage', name: 'legacy' } },
      { operationIndex: 0, subject: { kind: 'storage', name: 'user.full_name' } },
    ]);
  });

  it('names a subject with no table, such as a type, by its storage name', () => {
    expect(
      planSubjects([losing({ storageName: 'public.mood', table: undefined })], {
        fromContract: origin,
        contract: origin,
        statements: [],
      }).dataLoss,
    ).toEqual([{ operationIndex: 0, subject: { kind: 'storage', name: 'public.mood' } }]);
  });

  it('lists access-widening operations with the model of their table', () => {
    expect(
      planSubjects(
        [unchanged, { operationCount: 1, dataLoss: [], accessWidening: [table('user')] }],
        { fromContract: origin, contract: origin, statements: [] },
      ),
    ).toEqual({
      dataLoss: [],
      accessWidening: [
        { operationIndex: 1, subject: { kind: 'model', namespaceId: app, model: 'User' } },
      ],
    });
  });
});
