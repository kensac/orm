import { describe, expect, it } from 'vitest';
import { orderTopLevel } from '../src/canonicalization';
import {
  canonicalizeContract,
  canonicalizeContractToObject,
  crossRef,
  drill,
  drillDomainModel,
  minimal,
  UNBOUND,
} from './canonicalization-helpers';

describe('canonicalizeContractToObject', () => {
  it('returns an object with top-level keys in canonical order', () => {
    const result = canonicalizeContractToObject(minimal());
    const keys = Object.keys(result);
    expect(keys).toEqual([
      'targetFamily',
      'target',
      'profileHash',
      'roots',
      'domain',
      'storage',
      'capabilities',
      'extensions',
      'meta',
    ]);
  });

  it('preserves additionalProperties:false when a family preserve-empty hook opts in', () => {
    const result = canonicalizeContractToObject(
      minimal({
        targetFamily: 'mongo',
        target: 'mongo',
        storage: {
          storageHash: 'stub',
          namespaces: {
            [UNBOUND]: {
              id: UNBOUND,
              entries: {
                collection: {
                  users: {
                    validator: {
                      jsonSchema: {
                        bsonType: 'object',
                        properties: { _id: { bsonType: 'objectId' } },
                        additionalProperties: false,
                      },
                      validationLevel: 'strict',
                      validationAction: 'error',
                    },
                  },
                },
              },
            },
          },
        },
      }),
      { shouldPreserveEmpty: (path) => path[path.length - 1] === 'additionalProperties' },
    );
    const jsonSchema = drill(
      result,
      'storage',
      'namespaces',
      UNBOUND,
      'entries',
      'collection',
      'users',
      'validator',
      'jsonSchema',
    );
    expect(jsonSchema['additionalProperties']).toBe(false);
  });

  it('includes schemaVersion when provided', () => {
    const result = canonicalizeContractToObject(minimal(), { schemaVersion: '1.0' });
    expect(result['schemaVersion']).toBe('1.0');
    expect(Object.keys(result)[0]).toBe('schemaVersion');
  });

  it('includes roots when provided', () => {
    const result = canonicalizeContractToObject(minimal({ roots: { users: crossRef('User') } }));
    expect(result['roots']).toEqual({ users: crossRef('User') });
  });

  it('includes execution when provided', () => {
    const input = minimal({
      execution: { executionHash: 'exec', mutations: { defaults: [] } },
    });
    const result = canonicalizeContractToObject(input);
    expect(result['execution']).toEqual({
      executionHash: 'exec',
      mutations: { defaults: [] },
    });
  });

  it('includes storageHash when provided inside storage', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'abc', namespaces: {} } }),
    );
    expect(drill(result, 'storage')['storageHash']).toBe('abc');
  });

  it('includes profileHash', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'def' }));
    expect(result['profileHash']).toBe('def');
  });

  it('keeps storageHash inside storage', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 's', namespaces: {} } }),
    );
    expect(result).not.toHaveProperty('storageHash');
    expect(drill(result, 'storage')['storageHash']).toBe('s');
  });

  it('keeps executionHash inside execution', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'e', mutations: { defaults: [] } },
      }),
    );
    expect(result).not.toHaveProperty('executionHash');
    expect(drill(result, 'execution')['executionHash']).toBe('e');
  });

  it('places profileHash in canonical top-level order', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'p' }));
    const keys = Object.keys(result);
    const ordered = keys.filter((k) => ['profileHash', 'roots'].includes(k));
    expect(ordered).toEqual(['profileHash', 'roots']);
  });

  it('excludes keys not in the Contract schema', () => {
    const input = minimal({ zebra: 'z' });
    const result = canonicalizeContractToObject(input);
    expect(result).not.toHaveProperty('zebra');
  });

  it('includes defaultControlPolicy when set on the contract', () => {
    const result = canonicalizeContractToObject(minimal({ defaultControlPolicy: 'external' }));
    expect(result['defaultControlPolicy']).toBe('external');
  });

  it('omits defaultControlPolicy when not set', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(result).not.toHaveProperty('defaultControlPolicy');
  });

  it('places defaultControlPolicy after extensions and before meta', () => {
    const result = canonicalizeContractToObject(minimal({ defaultControlPolicy: 'tolerated' }));
    const keys = Object.keys(result);
    expect(keys.indexOf('extensions')).toBeLessThan(keys.indexOf('defaultControlPolicy'));
    expect(keys.indexOf('defaultControlPolicy')).toBeLessThan(keys.indexOf('meta'));
  });

  it('sorts object keys recursively', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'text' }, nullable: false },
              age: { type: { kind: 'scalar', codecId: 'int' }, nullable: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const userFields = drillDomainModel(result, 'User', 'fields');
    expect(Object.keys(userFields)).toEqual(['age', 'name']);
  });
});

describe('canonicalizeContract', () => {
  it('returns a JSON string', () => {
    const result = canonicalizeContract(minimal());
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('serializes number values in meta', () => {
    const result = canonicalizeContract(
      minimal({
        meta: { limit: 42 } as Record<string, unknown>,
      }),
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(drill(parsed, 'meta')['limit']).toBe(42);
  });

  it('produces identical output as JSON.stringify of canonicalizeContractToObject', () => {
    const input = minimal({
      storage: { storageHash: 'test', namespaces: {} },
      profileHash: 'profile',
    });
    const objResult = canonicalizeContractToObject(input);
    const strResult = canonicalizeContract(input);
    expect(JSON.parse(strResult)).toEqual(objResult);
  });
});

describe('orderTopLevel', () => {
  it('places known keys in canonical order followed by unknown keys sorted alphabetically', () => {
    const result = orderTopLevel({
      zebra: 'z',
      target: 'postgres',
      apple: 'a',
      targetFamily: 'sql',
    });
    expect(Object.keys(result)).toEqual(['targetFamily', 'target', 'apple', 'zebra']);
  });

  it('places domain before storage', () => {
    const result = orderTopLevel({
      storage: {},
      domain: { namespaces: { [UNBOUND]: { models: {} } } },
      target: 'postgres',
    });
    const keys = Object.keys(result);
    expect(keys.indexOf('domain')).toBeLessThan(keys.indexOf('storage'));
  });
});

describe('canonicalize with valueObjects', () => {
  it('includes valueObjects under domain.namespaces when present', () => {
    const contract = minimal({
      valueObjects: {
        Address: {
          fields: {
            street: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            city: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
    });
    const result = canonicalizeContractToObject(contract);
    const vo = drill(result, 'domain', 'namespaces', UNBOUND, 'valueObjects');
    expect(vo).toHaveProperty('Address');
  });

  it('omits valueObjects from namespace output when absent', () => {
    const contract = minimal();
    const result = canonicalizeContractToObject(contract);
    const ns = drill(result, 'domain', 'namespaces', UNBOUND);
    expect(ns).not.toHaveProperty('valueObjects');
  });
});

describe('domain plane', () => {
  it('emits domain.namespaces in canonical output', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(drill(result, 'domain', 'namespaces', UNBOUND, 'models')).toEqual({});
  });
});

describe('framework canonicalizer has no SQL/Mongo storage path knowledge', () => {
  it('canonicalization.ts does not hardcode tables, indexes, uniques, or foreignKeys path guards', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '../src/canonicalization.ts');
    const source = await readFile(sourcePath, 'utf8');
    // Strip comments so doc-comment prose (e.g. markdown `indexes` references)
    // doesn't trip the path-literal guard; only real code literals must fail.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Path literals are forbidden regardless of quoting style (single, double,
    // or backtick) so a hardcoded token can't slip past in a different quote.
    const forbiddenPathLiterals = ['tables', 'indexes', 'uniques', 'foreignKeys'];
    for (const token of forbiddenPathLiterals) {
      const quotedLiteral = new RegExp(`['"\`]${token}['"\`]`);
      expect(
        code,
        `framework canonicalizer must not reference the ${token} path literal`,
      ).not.toMatch(quotedLiteral);
    }
    // Helper identifiers are bare references, so a plain substring check suffices.
    const forbiddenIdentifiers = [
      'sortIndexesAndUniques',
      'sortTableArrays',
      'isNamespaceTable',
      'isRequiredNamespaceTables',
      'isStorageTypeTypeParams',
      'isFkBooleanField',
    ];
    for (const token of forbiddenIdentifiers) {
      expect(source, `framework canonicalizer must not reference ${token}`).not.toContain(token);
    }
  });
});
