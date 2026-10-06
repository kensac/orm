import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

function resolve(
  renames: readonly string[],
  origin: ReturnType<typeof contractOf>,
  destination: ReturnType<typeof contractOf>,
) {
  return resolveStatements({
    renames,
    origin: { kind: 'contract', contract: origin },
    destination,
  });
}

const nameToFullName = {
  origin: contractOf({ app: { models: { User: { fields: ['id', 'name'] } } } }),
  destination: contractOf({ app: { models: { User: { fields: ['id', 'fullName'] } } } }),
};

const renamedUser = {
  kind: 'rename',
  entity: 'field',
  from: { namespace: 'app', model: 'User', field: 'name' },
  to: { namespace: 'app', model: 'User', field: 'fullName' },
};

describe('resolveStatements, field renames', () => {
  it('resolves Model.field on both sides', () => {
    const { origin, destination } = nameToFullName;
    expect(expectValue(resolve(['User.name:User.fullName'], origin, destination))).toEqual([
      renamedUser,
    ]);
  });

  it('resolves namespace.Model.field on both sides', () => {
    const { origin, destination } = nameToFullName;
    expect(expectValue(resolve(['app.User.name:app.User.fullName'], origin, destination))).toEqual([
      renamedUser,
    ]);
  });

  it('looks the old field up in the model an earlier statement renamed', () => {
    const origin = contractOf({ app: { models: { A: { fields: ['x'] } } } });
    const destination = contractOf({ app: { models: { B: { fields: ['y'] } } } });
    expect(expectValue(resolve(['A:B', 'B.x:B.y'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespace: 'app', model: 'A' },
        to: { namespace: 'app', model: 'B' },
      },
      {
        kind: 'rename',
        entity: 'field',
        from: { namespace: 'app', model: 'A', field: 'x' },
        to: { namespace: 'app', model: 'B', field: 'y' },
      },
    ]);
  });

  describe('fields cannot move between models', () => {
    it('refuses old and new sides naming the old and new names of a renamed model', () => {
      const origin = contractOf({ app: { models: { A: { fields: ['x'] } } } });
      const destination = contractOf({ app: { models: { B: { fields: ['y'] } } } });
      expectFailure(
        resolve(['A:B', 'A.x:B.y'], origin, destination),
        INVALID,
        '--rename A.x:B.y',
        'a field cannot move between models',
      );
    });

    it('refuses old and new sides naming two models both contracts have', () => {
      const origin = contractOf({
        app: { models: { User: { fields: ['a'] }, Post: { fields: ['c'] } } },
      });
      const destination = contractOf({
        app: { models: { User: { fields: ['c'] }, Post: { fields: ['b'] } } },
      });
      expectFailure(
        resolve(['User.a:Post.b'], origin, destination),
        INVALID,
        'a field cannot move between models',
      );
    });
  });

  describe('names that do not resolve', () => {
    it('refuses an old field the origin model does not have, naming its fields', () => {
      const { origin, destination } = nameToFullName;
      expectFailure(
        resolve(['User.email:User.fullName'], origin, destination),
        UNRESOLVED,
        'origin model "app.User" has no field "email"',
        'id, name',
      );
    });

    it('refuses a new field the destination model does not have, naming its fields', () => {
      const { origin, destination } = nameToFullName;
      expectFailure(
        resolve(['User.name:User.email'], origin, destination),
        UNRESOLVED,
        'destination model "app.User" has no field "email"',
        'fullName, id',
      );
    });

    it('refuses a new field the origin model already has', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name', 'fullName'] } } } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'field "fullName" already exists on the origin model "app.User"',
      );
    });

    it('refuses an old field the destination model still has', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name'] } } } });
      const destination = contractOf({
        app: { models: { User: { fields: ['name', 'fullName'] } } },
      });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'field "name" still exists on the destination model "app.User"',
      );
    });

    it('refuses a model with no origin counterpart', () => {
      const origin = contractOf({ app: { models: {} } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'no counterpart in the origin contract',
      );
    });
  });

  describe('entity kinds', () => {
    it('resolves a relation field like any field', () => {
      const origin = contractOf({ app: { models: { User: { relations: ['posts'] } } } });
      const destination = contractOf({ app: { models: { User: { relations: ['articles'] } } } });
      expect(expectValue(resolve(['User.posts:User.articles'], origin, destination))).toEqual([
        {
          kind: 'rename',
          entity: 'field',
          from: { namespace: 'app', model: 'User', field: 'posts' },
          to: { namespace: 'app', model: 'User', field: 'articles' },
        },
      ]);
    });

    it('resolves a field of a variant', () => {
      const origin = contractOf({
        app: { models: { Pet: {}, Dog: { base: 'Pet', fields: ['bark'] } } },
      });
      const destination = contractOf({
        app: { models: { Pet: {}, Dog: { base: 'Pet', fields: ['woof'] } } },
      });
      expect(expectValue(resolve(['Dog.bark:Dog.woof'], origin, destination))).toHaveLength(1);
    });

    it('refuses a field of a value object, saying value object renames are not supported', () => {
      const origin = contractOf({ app: { valueObjects: { Address: ['street'] } } });
      const destination = contractOf({ app: { valueObjects: { Address: ['road'] } } });
      expectFailure(
        resolve(['app.Address.street:app.Address.road'], origin, destination),
        UNRESOLVED,
        'value object renames are not supported in this release',
      );
    });
  });

  describe('repeated names across statements', () => {
    it('refuses renaming one field twice', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name'] } } } });
      const destination = contractOf({
        app: { models: { User: { fields: ['fullName', 'title'] } } },
      });
      expectFailure(
        resolve(['User.name:User.fullName', 'User.name:User.title'], origin, destination),
        INVALID,
        'already renames "app.User.name"',
      );
    });
  });
});
