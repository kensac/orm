import { describe, expect, it } from 'vitest';
import {
  canonicalizeContractToObject,
  drill,
  drillDomainModel,
  minimal,
  sqlPreserveEmpty,
  UNBOUND,
  unboundStorage,
  unboundTables,
} from './canonicalization-helpers';

describe('default omission', () => {
  it('strips _generated key from nested objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        meta: { _generated: 'should be removed', kept: 'yes' } as Record<string, unknown>,
      }),
    );
    const meta = result['meta'] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('_generated');
    expect(meta['kept']).toBe('yes');
  });

  it('preserves nullable: false on fields (ADR 172: always explicit)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField['nullable']).toBe(false);
  });

  it('strips generated: false', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, generated: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('generated');
  });

  it('preserves a strict nested list descriptor', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              tags: {
                type: { kind: 'scalar', codecId: 'text' },
                nullable: false,
                many: { elementNullable: false },
              },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const tagsField = drillDomainModel(result, 'User', 'fields', 'tags');
    expect(tagsField).toEqual({
      type: { kind: 'scalar', codecId: 'text' },
      nullable: false,
      many: { elementNullable: false },
    });
  });

  it('omits many: false on non-list model and value-object fields', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'text' }, nullable: false, many: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
        valueObjects: {
          Address: {
            fields: {
              city: { type: { kind: 'scalar', codecId: 'text' }, nullable: false, many: false },
            },
          },
        },
      }),
    );
    const nameField = drillDomainModel(result, 'User', 'fields', 'name');
    expect(nameField).not.toHaveProperty('many');
    const cityField = drill(
      result,
      'domain',
      'namespaces',
      UNBOUND,
      'valueObjects',
      'Address',
      'fields',
      'city',
    );
    expect(cityField).not.toHaveProperty('many');
  });

  it('preserves a literal false column default value via the family hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          task: {
            columns: {
              done: {
                codecId: 'pg/bool@1',
                dataType: 'pg/bool',
                nullable: false,
                default: { kind: 'literal', value: false },
              },
            },
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const done = drill(unboundTables(result), 'task', 'columns', 'done');
    expect(done['default']).toEqual({ kind: 'literal', value: false });
  });

  it('preserves a literal empty-array column default value via the family hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          task: {
            columns: {
              labels: {
                codecId: 'pg/text_array@1',
                dataType: 'pg/text-array',
                nullable: false,
                default: { kind: 'literal', value: [] },
              },
            },
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const labels = drill(unboundTables(result), 'task', 'columns', 'labels');
    expect(labels['default']).toEqual({ kind: 'literal', value: [] });
  });

  it('strips onDelete: noAction and onUpdate: noAction', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            foreignKeys: {
              fk_user: { onDelete: 'noAction', onUpdate: 'noAction', columns: ['user_id'] },
            },
          },
        }),
      }),
    );
    const fk = drill(unboundTables(result), 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('onDelete');
    expect(fk).not.toHaveProperty('onUpdate');
  });

  it('preserves required empty objects at top level', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(drill(result, 'domain', 'namespaces', UNBOUND, 'models')).toEqual({});
    expect(result['extensions']).toEqual({});
    expect(result['capabilities']).toEqual({});
    expect(result['meta']).toEqual({});
  });

  it('strips empty storage.namespaces[X].entries.table without a shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(minimal({ storage: unboundStorage({}) }));
    const ns = drill(result, 'storage', 'namespaces', UNBOUND) as Record<string, unknown>;
    expect(ns).not.toHaveProperty('tables');
  });

  it('preserves empty storage.namespaces[].entries.table when shouldPreserveEmpty hook returns true', () => {
    const result = canonicalizeContractToObject(minimal({ storage: unboundStorage({}) }), {
      shouldPreserveEmpty: sqlPreserveEmpty,
    });
    expect(unboundTables(result)).toEqual({});
  });

  it('preserves empty roots', () => {
    const result = canonicalizeContractToObject(minimal({ roots: {} }));
    expect(result['roots']).toEqual({});
  });

  it('preserves empty model relations', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const user = drillDomainModel(result, 'User');
    expect(user['relations']).toEqual({});
  });

  it('preserves empty model fields, as a variant with no field of its own has', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          Chore: {
            fields: {},
            storage: { namespaceId: '__unbound__', table: 'chores', fields: {} },
            relations: {},
          },
        },
      }),
    );
    expect(drillDomainModel(result, 'Chore')['fields']).toEqual({});
  });

  it('preserves empty table uniques, indexes, and foreignKeys when shouldPreserveEmpty hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: { columns: {}, uniques: [], indexes: [], foreignKeys: {} },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const table = drill(unboundTables(result), 'users');
    expect(table['uniques']).toEqual([]);
    expect(table['indexes']).toEqual([]);
    expect(table['foreignKeys']).toEqual({});
  });

  it('strips false-valued FK boolean fields without shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            foreignKeys: {
              fk_user: { columns: ['user_id'], constraint: false, index: false },
            },
          },
        }),
      }),
    );
    const fk = drill(unboundTables(result), 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('constraint');
    expect(fk).not.toHaveProperty('index');
  });

  it('preserves false-valued FK boolean fields in array-form foreignKeys when hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            columns: {},
            foreignKeys: [{ columns: ['user_id'], constraint: false, index: false }],
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const table = drill(unboundTables(result), 'posts');
    const fks = table['foreignKeys'] as Array<Record<string, unknown>>;
    expect(fks[0]?.['constraint']).toBe(false);
    expect(fks[0]?.['index']).toBe(false);
  });

  it('preserves empty execution.mutations.defaults', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'exec', mutations: { defaults: [] } },
      }),
    );
    const mutations = drill(result, 'execution', 'mutations');
    expect(mutations['defaults']).toEqual([]);
  });

  it('preserves empty extension namespace entries', () => {
    const result = canonicalizeContractToObject(minimal({ extensions: { paradedb: {} } }));
    expect(drill(result, 'extensions')['paradedb']).toEqual({});
  });

  it('preserves empty per-namespace table entries when shouldPreserveEmpty hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({ tasks: {} }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    expect(unboundTables(result)['tasks']).toEqual({});
  });

  it('preserves empty model storage (embedded documents)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          Address: {
            fields: { street: { type: { kind: 'scalar', codecId: 'string' }, nullable: false } },
            storage: {},
            relations: {},
            owner: 'User',
          },
        },
      }),
    );
    const address = drillDomainModel(result, 'Address');
    expect(address['storage']).toEqual({});
  });

  it('strips non-required empty objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, extra: {} },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('extra');
  });

  it('preserves ISO date strings in meta', () => {
    const isoString = '2024-01-01T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        meta: { createdAt: isoString } as Record<string, unknown>,
      }),
    );
    expect(drill(result, 'meta')['createdAt']).toBe(isoString);
  });

  it('preserves null values (not treated as default)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, default: null },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField['default']).toBeNull();
  });
});

describe('typeParams canonicalization', () => {
  it('strips empty storage.types[].typeParams even when SQL shouldPreserveEmpty hook is provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: { storageHash: 'stub', types: { MyType: { typeParams: {} } } },
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType).not.toHaveProperty('typeParams');
  });

  it('strips empty storage.types[].typeParams without shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {},
          types: { MyType: { typeParams: {} } },
        },
      }),
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType).not.toHaveProperty('typeParams');
  });

  it('preserves non-empty storage.types[].typeParams', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {},
          types: { MyType: { typeParams: { length: 10 } } },
        },
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType['typeParams']).toEqual({ length: 10 });
  });
});
