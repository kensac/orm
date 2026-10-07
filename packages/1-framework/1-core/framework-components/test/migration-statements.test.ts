import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  describeMigrationStatement,
  type ResolvedMigrationStatement,
} from '../src/control/migration-statements';

function contractWith(models: Readonly<Record<string, readonly string[]>>): ContractWithDomain {
  return {
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(models).map(([namespaceId, names]) => [
          namespaceId,
          {
            models: Object.fromEntries(
              names.map((name) => [name, { fields: {}, relations: {}, storage: {} }]),
            ),
          },
        ]),
      ),
    },
  };
}

const app = asNamespaceId('app');

function renameModel(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: app, model: from },
    to: { namespaceId: app, model: to },
  };
}

function renameField(
  fromModel: string,
  toModel: string,
  from: string,
  to: string,
): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: app, model: fromModel, field: from },
    to: { namespaceId: app, model: toModel, field: to },
  };
}

describe('describeMigrationStatement', () => {
  it('names models without their namespace when the contract has one namespace', () => {
    expect(
      describeMigrationStatement(
        renameModel('Profile', 'User'),
        contractWith({ app: ['Profile'] }),
        contractWith({ app: ['User'] }),
      ),
    ).toBe('rename model "Profile" to "User"');
  });

  it('names models with their namespace when the contract has several', () => {
    expect(
      describeMigrationStatement(
        renameModel('Profile', 'User'),
        contractWith({ app: ['Profile'], billing: ['Bill'] }),
        contractWith({ app: ['User'], billing: ['Bill'] }),
      ),
    ).toBe('rename model "app.Profile" to "app.User"');
  });

  it('names the old field through the model as the destination names it', () => {
    expect(
      describeMigrationStatement(
        renameField('Profile', 'User', 'name', 'fullName'),
        contractWith({ app: ['Profile'] }),
        contractWith({ app: ['User'] }),
      ),
    ).toBe('rename field "User.name" to "User.fullName"');
  });
});
