import type { ContractModel } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  generateModelRelationsType,
  generateModelsType,
  generateRootsType,
} from '../src/domain-type-generation';

describe('generateModelsType', () => {
  const noopStorage = () => 'Record<string, never>';

  function makeModel(overrides: Partial<ContractModel> = {}): ContractModel {
    return {
      fields: {},
      relations: {},
      storage: { storageHash: 'test' },
      ...overrides,
    };
  }

  it('returns Record<string, never> for empty models', () => {
    expect(generateModelsType({}, noopStorage)).toBe('Record<string, never>');
  });

  it('generates model with fields, relations, and storage', () => {
    const models: Record<string, ContractModel> = {
      User: makeModel({
        fields: {
          name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false, many: false },
        },
        relations: { posts: { to: crossRef('Post'), cardinality: '1:N' } },
      }),
    };
    const result = generateModelsType(models, () => '{ readonly table: "users" }');
    expect(result).toContain('readonly User:');
    expect(result).toContain('readonly codecId: "sql/text@1"');
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Post"');
    expect(result).toContain('readonly table: "users"');
  });

  it('quotes model names that are not bare identifiers', () => {
    const models: Record<string, ContractModel> = { 'Data Row': makeModel() };
    expect(generateModelsType(models, noopStorage)).toContain('readonly "Data Row": {');
  });

  it('sorts models by name', () => {
    const models: Record<string, ContractModel> = {
      Zebra: makeModel(),
      Alpha: makeModel(),
    };
    const result = generateModelsType(models, noopStorage);
    const alphaIdx = result.indexOf('Alpha');
    const zebraIdx = result.indexOf('Zebra');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('passes modelName and model to the storage callback', () => {
    const model = makeModel();
    const models: Record<string, ContractModel> = { User: model };
    const storageFn = vi.fn(() => 'Record<string, never>');
    generateModelsType(models, storageFn);
    expect(storageFn).toHaveBeenCalledWith('User', model);
  });

  it('includes owner when present', () => {
    const models: Record<string, ContractModel> = {
      Comment: makeModel({ owner: 'Post' }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly owner: "Post"');
  });

  it('includes discriminator when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ discriminator: { field: 'type' } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly discriminator: { readonly field: "type" }');
  });

  it('includes variants when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ variants: { Dog: { value: 'dog' }, Cat: { value: 'cat' } } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly variants:');
    expect(result).toContain('readonly Dog:');
    expect(result).toContain('readonly Cat:');
  });

  it('includes base when present', () => {
    const models: Record<string, ContractModel> = {
      Dog: makeModel({ base: crossRef('Animal') }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Animal"');
  });
});

describe('generateRootsType', () => {
  it('returns Record<string, never> for undefined roots', () => {
    expect(generateRootsType(undefined)).toBe('Record<string, never>');
  });

  it('returns Record<string, never> for empty roots', () => {
    expect(generateRootsType({})).toBe('Record<string, never>');
  });

  it('generates literal object type for roots', () => {
    const result = generateRootsType({ users: crossRef('User'), posts: crossRef('Post') });
    expect(result).toContain(
      'readonly users: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "User" }',
    );
    expect(result).toContain(
      'readonly posts: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
    );
  });
});

describe('generateModelRelationsType', () => {
  it('returns empty object for empty relations', () => {
    expect(generateModelRelationsType({})).toBe('Record<string, never>');
  });

  it('generates relation with to and cardinality', () => {
    const result = generateModelRelationsType({
      posts: { to: crossRef('Post'), cardinality: '1:N' },
    });
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Post"');
    expect(result).toContain('readonly cardinality: "1:N"');
  });

  it('generates relation with on (localFields/targetFields)', () => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['_id'] },
      },
    });
    expect(result).toContain('readonly model: "User"');
    expect(result).toContain('readonly cardinality: "N:1"');
    expect(result).toContain('readonly localFields: readonly ["authorId"]');
    expect(result).toContain('readonly targetFields: readonly ["_id"]');
  });

  it.each([true, false])('renders nullable: %s on a to-one relation', (nullable) => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable,
        on: { localFields: ['authorId'], targetFields: ['_id'] },
      },
    });
    expect(result).toContain(`readonly cardinality: "N:1"; readonly nullable: ${nullable};`);
  });

  it('skips non-object relations', () => {
    const result = generateModelRelationsType({
      bad: 'not an object' as unknown as Record<string, unknown>,
    });
    expect(result).toBe('Record<string, never>');
  });

  it('generates multiple relations', () => {
    const result = generateModelRelationsType({
      author: { to: crossRef('User'), cardinality: 'N:1' },
      comments: { to: crossRef('Comment'), cardinality: '1:N' },
    });
    expect(result).toContain('readonly author:');
    expect(result).toContain('readonly comments:');
  });

  it('omits to when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { cardinality: '1:N' },
    });
    expect(result).toContain('readonly cardinality: "1:N"');
    expect(result).not.toContain('readonly to:');
  });

  it('omits cardinality when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { to: crossRef('Post') },
    });
    expect(result).toContain('readonly model: "Post"');
    expect(result).not.toContain('readonly cardinality:');
  });

  it('skips relation object with no recognized properties', () => {
    const result = generateModelRelationsType({
      empty: { unknown: true },
    });
    expect(result).toBe('Record<string, never>');
  });

  it('throws CONTRACT.RELATION_INVALID when relation has on but missing localFields/targetFields', () => {
    let thrown: unknown;
    try {
      generateModelRelationsType({
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: { parentCols: ['userId'], childCols: ['id'] },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'CONTRACT.RELATION_INVALID' });
    expect((thrown as Error).message).toContain('missing localFields or targetFields');
  });

  it('emits never for a cross-space relation (Option B non-navigable)', () => {
    const crossSpaceRef = { namespace: '__unbound__', model: 'User', space: 'supabase' };
    const result = generateModelRelationsType({
      user: {
        to: crossSpaceRef,
        cardinality: 'N:1',
        on: { localFields: ['userId'], targetFields: ['id'] },
      },
    });
    expect(result).toBe('{ readonly user: never }');
  });

  it('emits never only for cross-space relations; local relations are unaffected', () => {
    const localRef = crossRef('Post');
    const crossSpaceRef = { namespace: 'auth', model: 'User', space: 'supabase' };
    const result = generateModelRelationsType({
      posts: { to: localRef, cardinality: '1:N' },
      user: { to: crossSpaceRef, cardinality: 'N:1' },
    });
    expect(result).toContain('readonly posts: {');
    expect(result).toContain('readonly user: never');
    // local relation should not be never
    expect(result).not.toContain('readonly posts: never');
  });

  it('local relation to.space is absent and the relation is not never', () => {
    const result = generateModelRelationsType({
      author: { to: crossRef('User'), cardinality: 'N:1' },
    });
    // local relation must not be emitted as never
    expect(result).not.toContain('readonly author: never');
    // the CrossReference for a local relation must not include a `space` property
    expect(result).not.toContain('readonly space:');
  });

  it('emits through literal for N:M relations with junction metadata', () => {
    const result = generateModelRelationsType({
      tags: {
        to: crossRef('Tag'),
        cardinality: 'N:M',
        through: {
          table: 'post_tags',
          namespaceId: 'public',
          parentColumns: ['postId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(result).toContain('readonly model: "Tag"');
    expect(result).toContain('readonly cardinality: "N:M"');
    expect(result).toContain('readonly through:');
    expect(result).toContain('readonly table: "post_tags"');
    expect(result).toContain('readonly namespaceId: "public"');
    expect(result).toContain('readonly parentColumns: readonly ["postId"]');
    expect(result).toContain('readonly childColumns: readonly ["tagId"]');
    expect(result).toContain('readonly targetColumns: readonly ["id"]');
  });

  it('emits through with multi-column keys', () => {
    const result = generateModelRelationsType({
      roles: {
        to: crossRef('Role'),
        cardinality: 'N:M',
        through: {
          table: 'user_roles',
          namespaceId: 'public',
          parentColumns: ['userId', 'tenantId'],
          childColumns: ['roleId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(result).toContain('readonly parentColumns: readonly ["userId", "tenantId"]');
  });

  it('omits through when not present (non-N:M relations unchanged)', () => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
    });
    expect(result).not.toContain('readonly through:');
    expect(result).toContain('readonly localFields: readonly ["authorId"]');
  });
});
