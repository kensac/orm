import { describe, expect, it } from 'vitest';
import {
  canonicalizeContractToObject,
  drill,
  drillDomainModel,
  minimal,
  sqlSortStorage,
  UNBOUND,
  unboundStorage,
  unboundTables,
} from './canonicalization-helpers';

describe('index and unique sorting', () => {
  it('sorts indexes by name when sortStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [{ name: 'idx_z' }, { name: 'idx_a' }, { name: 'idx_m' }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(['idx_a', 'idx_m', 'idx_z']);
  });

  it('sorts uniques by name when sortStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [{ name: 'uq_z' }, { name: 'uq_a' }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<{ name: string }>;
    expect(uniques.map((u) => u.name)).toEqual(['uq_a', 'uq_z']);
  });

  it('handles storage without namespaces (no-op)', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'stub', namespaces: {} } }),
    );
    expect(result['storage']).toBeDefined();
  });

  it('preserves ISO date string defaults through sort', () => {
    const isoString = '2024-06-15T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              createdAt: {
                type: { kind: 'scalar', codecId: 'timestamp' },
                nullable: false,
                default: isoString,
              },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const field = drillDomainModel(result, 'User', 'fields', 'createdAt');
    expect(field['default']).toBe(isoString);
  });

  it('sorts indexes without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [{ columns: ['b'] }, { name: 'idx_a', columns: ['a'] }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<{ name?: string }>;
    expect(indexes[0]?.['name']).toBeUndefined();
    expect(indexes[1]?.['name']).toBe('idx_a');
  });

  it('sorts uniques without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [{ columns: ['b'] }, { name: 'uq_a', columns: ['a'] }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<{ name?: string }>;
    expect(uniques[0]?.['name']).toBeUndefined();
    expect(uniques[1]?.['name']).toBe('uq_a');
  });

  it('handles non-object table entries gracefully', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({ bad: null as unknown as Record<string, unknown> }),
      }),
    );
    expect(unboundTables(result)['bad']).toBeNull();
  });

  it('passes non-object namespace values through unchanged', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {
            broken: null as unknown as Record<string, unknown>,
          },
        },
      }),
    );
    const storage = drill(result, 'storage');
    expect((storage['namespaces'] as Record<string, unknown>)['broken']).toBeNull();
  });

  it('passes namespaces without a table slot through unchanged (e.g. Mongo)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {
            [UNBOUND]: {
              id: UNBOUND,
              entries: { collection: { posts: { columns: {} } } },
            },
          },
        },
      }),
    );
    const ns = drill(result, 'storage', 'namespaces', UNBOUND);
    expect(ns).not.toHaveProperty('tables');
    expect(ns).not.toHaveProperty('collections');
    expect(drill(ns, 'entries', 'collection')).toEqual({ posts: {} });
  });
});

describe('array sort with nullish entries', () => {
  it('sorts indexes containing nullish entries without throwing', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [null, null] as unknown as Record<string, unknown>[],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<unknown>;
    expect(indexes).toHaveLength(2);
  });

  it('sorts uniques containing nullish entries without throwing', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [null, null] as unknown as Record<string, unknown>[],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<unknown>;
    expect(uniques).toHaveLength(2);
  });
});
